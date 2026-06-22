/**
 * 掼蛋游戏模块入口（控制器）。
 * 路由分流：`/guandan?debug` → 本地对 AI(LocalDriver)；`/guandan` → 联机流。
 * 联机状态机：昵称 → 大厅(建房/匹配/加入/观战) → 房间(挑座/开打) → 牌桌(OnlineDriver)。
 * 控制器只编排：session 收发 + UI 切换 + 开打挂牌桌 + 掉线/重连 toast。规则/AI 全在服务端。
 */
import type { GameModule } from '../../shell/types';
import type { Seat } from './engine/types';
import { navigate } from '../../shell/nav';
import { LocalDriver } from './driver/local-driver';
import { OnlineDriver } from './driver/online-driver';
import { OnlineSession } from './online/session';
import { c2s, type LobbyRoom, type SeatInfo } from './online/protocol';
import './online/ui/lobby.css';
import { mountTable, speechBusyMs, primeAudio, setTableHost, setSeatNames, setSpectator } from './ui/view';
import { renderNickname, type NicknameHandle } from './online/ui/nickname';
import { renderLobby, type LobbyHandle } from './online/ui/lobby';
import { renderRoom, type RoomHandle, type RoomState } from './online/ui/room';

const SEAT_LABELS: Record<number, string> = { 0: '你', 1: '下家', 2: '对家', 3: '上家' };

function onlineMount(root: HTMLElement): () => void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const session = new OnlineSession(`${proto}://${location.host}/ws-guandan`);

  let nickH: NicknameHandle | null = null;
  let lobbyH: LobbyHandle | null = null;
  let roomH: RoomHandle | null = null;
  let tableCleanup: (() => void) | null = null;
  let driver: OnlineDriver | null = null;

  let mySeat: Seat | 'spectator' | null = null;
  let isHost = false;
  let onTable = false;
  let roomSeats: (SeatInfo | null)[] = []; // 最近的座位昵称（牌桌 state 不带昵称，从 room/spectating 取）

  function applySeatNames(): void {
    if (mySeat === null || !roomSeats.length) { setSeatNames(null); return; }
    const base = typeof mySeat === 'number' ? mySeat : 0; // egocentric：view 座 i → 服务端座
    const names = [0, 1, 2, 3].map((v) => {
      const ss = (v + base) % 4;
      const nick = roomSeats[ss]?.nick ?? null;
      return (typeof mySeat === 'number' && ss === mySeat && nick) ? `${nick}（你）` : nick;
    });
    setSeatNames(names);
    if (onTable && driver) driver.requestRender(); // rejoin 后 'room' 晚于挂台，补刷一帧让名字就位
  }

  function clearScreen(): void {
    nickH?.cleanup(); lobbyH?.cleanup(); roomH?.cleanup(); tableCleanup?.();
    nickH = lobbyH = roomH = null; tableCleanup = null;
    if (driver) { driver.dispose(); driver = null; }
    onTable = false;
    root.innerHTML = '';
  }

  function toast(text: string): void {
    const t = document.createElement('div');
    t.className = 'gd-toast';
    t.textContent = text;
    root.appendChild(t);
    window.setTimeout(() => t.remove(), 3800);
  }
  function peerLabel(serverSeat: number): string {
    const base = typeof mySeat === 'number' ? mySeat : 0;
    return SEAT_LABELS[(serverSeat - base + 4) % 4] ?? '某家';
  }

  function showNickname(): void {
    clearScreen();
    nickH = renderNickname(root, {
      initial: session.nick,
      onSubmit: (n) => { primeAudio(); session.setNick(n); session.send(c2s.hello(n)); },
    });
  }
  function showLobby(): void {
    clearScreen();
    mySeat = null; isHost = false;
    session.clearRoom(); // 在大厅=不在任何房；清重连凭据，避免下次刷新拿旧房号去 rejoin 死房
    lobbyH = renderLobby(root, {
      nick: session.nick, rooms: [],
      onCreate: () => session.send(c2s.create(false)),
      onMatch: () => { lobbyH?.setMatching(true); session.send(c2s.match()); },
      onJoin: (code) => session.send(c2s.join(code)),
      onSpectate: (code) => session.send(c2s.spectate(code)),
      onRefresh: () => session.send(c2s.lobby()),
    });
    session.send(c2s.lobby());
  }
  function showRoom(code: string, seats: (SeatInfo | null)[], you: Seat | 'spectator' | null): void {
    const state: RoomState = { seats, you, isHost };
    if (roomH) { roomH.update(state); return; }
    clearScreen();
    roomH = renderRoom(root, {
      code, initial: state,
      onTakeSeat: (s) => session.send(c2s.takeSeat(s)),
      onStart: () => session.send(c2s.start()),
      onLeave: () => { session.clearRoom(); navigate('/'); },
    });
  }
  function ensureTable(): void {
    if (onTable || mySeat === null) return;
    clearScreen();
    onTable = true;
    setTableHost(isHost);
    setSpectator(mySeat === 'spectator'); // 观战：底部不渲染手牌、不显示出牌按钮
    applySeatNames(); // 牌桌渲染前确保各座昵称就位
    driver = new OnlineDriver(session, mySeat);
    tableCleanup = mountTable(root, driver);
  }

  // ── session 事件 → 状态机 ──
  session.onOpen(() => { if (!session.savedRoom()) showNickname(); }); // 有房况：session 自动 rejoin，等 rejoined
  session.on('hello-ok', () => showLobby());
  session.on('rename-ok', () => showLobby());
  session.on('nick-taken', () => nickH?.showError('昵称已被占用，换一个'));
  session.on('lobby', (m) => lobbyH?.update((m as { rooms: LobbyRoom[] }).rooms));
  session.on('created', () => { isHost = true; });
  session.on('room', (m) => {
    const r = m as { code: string; status: 'waiting' | 'playing'; seats: (SeatInfo | null)[]; you: Seat | 'spectator' | null };
    mySeat = r.you;
    roomSeats = r.seats; applySeatNames(); // 牌桌昵称（联机中 room 不再来，故这里抓住）
    // 重连凭据：带本座真实昵称（服务端座位昵称，非共享 gd_nick——多标签会被覆盖致 rejoin 拿错座）
    if (typeof r.you === 'number') session.saveRoom(r.code, r.you, r.seats[r.you]?.nick ?? session.nick);
    if (r.status === 'waiting') showRoom(r.code, r.seats, r.you);
  });
  session.on('spectating', (m) => {
    mySeat = 'spectator';
    roomSeats = (m as { seats: (SeatInfo | null)[] }).seats; applySeatNames();
    ensureTable();
  });
  session.on('rejoined', (m) => { mySeat = (m as { seat: Seat }).seat; applySeatNames(); ensureTable(); });
  session.on('started', () => ensureTable());
  session.on('state', () => { if (mySeat !== null) ensureTable(); }); // 观战/重连首个 state 兜底挂台
  session.on('peer-offline', (m) => toast(`${peerLabel((m as { seat: number }).seat)} 掉线了`)); // 先宽限等重连，连续没回才转AI
  session.on('peer-back', (m) => toast(`${peerLabel((m as { seat: number }).seat)} 回来了`));
  session.on('room-closed', () => { session.clearRoom(); toast('房间已解散'); showLobby(); });
  session.on('error', (m) => {
    const msg = (m as { msg: string }).msg;
    lobbyH?.setMatching(false);
    // 空屏=重连(rejoin)失败(常见于服务端重启后房间没了、或座位被收回)→ 清陈旧房况、回昵称页，不卡死
    if (!nickH && !lobbyH && !roomH && !tableCleanup) {
      session.clearRoom();
      showNickname();
    } else {
      toast(msg);
    }
  });

  session.connect();
  return () => { clearScreen(); session.dispose(); };
}

function mount(root: HTMLElement): () => void {
  if (new URLSearchParams(location.search).has('debug')) {
    setSeatNames(null); // 本地用 你/下家/对家/上家
    setSpectator(false); // 本地恒为玩家
    return mountTable(root, new LocalDriver({ speechBusyMs }));
  }
  return onlineMount(root);
}

export const guandanModule: GameModule = {
  id: 'guandan',
  name: '掼蛋',
  desc: '升级类扑克，2v2 四人局，建房或匹配 4 人联机（?debug 单机对 AI）',
  mount,
};
