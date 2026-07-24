/**
 * 干瞪眼游戏模块入口（控制器）。
 * 进 `/gandengyan` 直接进联机大厅：昵称 → 大厅（建房选人数 / 输房号加入 / 观战）→ 房间 → 牌桌。
 * 单机就是「建房 → 开打」，空座由服务端补 AI；界面上没有单独的单机入口。
 * 控制器只编排：会话收发 + 换屏 + 挂牌桌；**规则与 AI 全在服务端**。
 */
import type { GameModule } from '../../shell/types';
import type { Card } from './engine/types';
import { navigate } from '../../shell/nav';
import { CardRoomSession } from '../../ui/cardroom/session';
import { renderLobby, renderNickname, renderRoom, type LobbyRoom } from '../../ui/cardroom/screens';
import { mountTable, type TableState } from './ui/table';
import './ui/gandengyan.css';

/** 房间/牌桌用到的座位信息（原在 ui/screens.ts；三屏已迁公共层，此处自留一份）。 */
interface SeatInfo { seat: number; nick: string | null; online: boolean; ai: boolean }

function mount(root: HTMLElement): () => void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const session = new CardRoomSession(`${proto}://${location.host}/ws-gandengyan`, { keyPrefix: 'gdy' });

  let screen: { cleanup(): void } | null = null;
  let table: ReturnType<typeof mountTable> | null = null;
  let lobbyH: ReturnType<typeof renderLobby> | null = null;
  let roomH: ReturnType<typeof renderRoom> | null = null;

  let mySeat: number | 'spectator' | null = null;
  let isHost = false;
  let seats: (SeatInfo | null)[] = [];
  let lastState: TableState | null = null;
  let myHand: Card[] = [];
  let pendingRejoin = false;

  const names = (): (string | null)[] => seats.map((s) => (s ? s.nick : null));

  function clear(): void {
    screen?.cleanup(); table?.cleanup();
    screen = null; table = null; lobbyH = null; roomH = null;
    root.innerHTML = '';
  }

  function toast(text: string): void {
    const t = document.createElement('div');
    t.className = 'gy__toast';
    t.textContent = text;
    root.appendChild(t);
    window.setTimeout(() => t.remove(), 3500);
  }

  function showNickname(): void {
    clear();
    const h = renderNickname(root, {
      initial: session.nick,
      brand: '干瞪眼',
      subtitle: '大一法则：跟牌必须点数正好大一级',
      placeholder: '起个名字',
      onSubmit: (n) => { session.setNick(n); session.send({ t: 'hello', nick: n }); },
    });
    screen = h;
    session.on('nick-taken', () => h.showError('这个名字被占了，换一个'));
  }

  function showLobby(): void {
    clear();
    mySeat = null; isHost = false;
    session.clearRoom();          // 在大厅=不在任何房；清凭据，免得下次刷新拿旧房号去撞
    lobbyH = renderLobby(root, {
      nick: session.nick,
      brand: '干瞪眼',
      seatChoice: [2, 3, 4, 5],
      defaultSeats: 3,
      createLabel: '建房',
      seatNote: '真人没凑齐也能开打，空座由服务端补 AI',
      onCreate: (o) => session.send({ t: 'create', seats: o.seats }),
      onJoin: (code) => session.send({ t: 'join', code }),
      onSpectate: (code) => session.send({ t: 'spectate', code }),
      onRefresh: () => session.send({ t: 'lobby' }),
    });
    screen = lobbyH;
    session.send({ t: 'lobby' });
  }

  function showRoom(code: string): void {
    const st = { seats, you: mySeat, isHost };
    if (roomH) { roomH.update(st); return; }
    clear();
    roomH = renderRoom(root, {
      code, initial: st, seatCount: seats.length, teams: false,
      onTakeSeat: (seat) => session.send({ t: 'take-seat', seat }),
      onStart: () => session.send({ t: 'start' }),
      onLeave: () => { session.clearRoom(); navigate('/'); },
    });
    screen = roomH;
  }

  function ensureTable(): void {
    if (table || mySeat === null) return;
    clear();
    table = mountTable(root, {
      mySeat,
      names: names(),
      onPlay: (cardIds, assign) => session.send({ t: 'play', cardIds, assign }),
      onPass: () => session.send({ t: 'pass' }),
      onRestart: () => session.send({ t: 'restart' }),
      onLeave: () => { session.clearRoom(); navigate('/'); },
    });
    if (lastState) table.render(lastState, myHand);
  }

  // ── 会话事件 → 屏幕状态机 ──
  session.onOpen(() => {
    if (session.savedRoom()?.token) { pendingRejoin = true; return; }  // 有凭据：等自动 rejoin 的结果
    showNickname();
  });
  session.on('hello-ok', () => showLobby());
  session.on('lobby', (m) => lobbyH?.update((m as { rooms: LobbyRoom[] }).rooms));
  session.on('created', () => { isHost = true; });
  session.on('room', (m) => {
    pendingRejoin = false;
    const r = m as { code: string; status: 'waiting' | 'playing'; seats: (SeatInfo | null)[]; you: number | 'spectator' | null };
    mySeat = r.you; seats = r.seats;
    if (typeof r.you === 'number') session.saveRoom(r.code, r.you, r.seats[r.you]?.nick ?? session.nick);
    if (r.status === 'waiting') showRoom(r.code);
    else if (table && lastState) { table.markResync(); table.render(lastState, myHand); }   // 重连回牌桌：抑制下一帧误报旧出牌
  });
  session.on('spectating', (m) => {
    pendingRejoin = false;
    mySeat = 'spectator';
    seats = (m as { seats: (SeatInfo | null)[] }).seats;
    ensureTable();
  });
  session.on('rejoined', (m) => { pendingRejoin = false; mySeat = (m as { seat: number }).seat; ensureTable(); table?.markResync(); });   // 重连成功：下一份 state 只登记基线不报
  session.on('started', () => ensureTable());
  session.on('state', (m) => {
    lastState = m as unknown as TableState;
    if (mySeat !== null) ensureTable();
    table?.render(lastState, myHand);
  });
  session.on('hand', (m) => {
    myHand = (m as { cards: Card[] }).cards;
    if (lastState) table?.render(lastState, myHand);
  });
  session.on('room-closed', () => { session.clearRoom(); toast('房间解散了'); showLobby(); });
  session.on('error', (m) => {
    const msg = (m as { msg: string }).msg;
    // 自动 rejoin 在途却收到 error = 重连失败（服务端重启/座位被收回）：别把人晾在再也不更新的牌桌上
    if (pendingRejoin || (!screen && !table)) { pendingRejoin = false; session.clearRoom(); showNickname(); }
    else if (table) table.hint(msg);
    else toast(msg);
  });

  session.connect();
  return () => { clear(); session.dispose(); };
}

export const gandengyanModule: GameModule = {
  id: 'gandengyan',
  name: '干瞪眼',
  desc: '大一法则出牌类，2–5 人：在线对战，可一人对 AI 或凑真人',
  mount,
};
