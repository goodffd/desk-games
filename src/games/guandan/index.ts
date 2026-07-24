/**
 * 掼蛋游戏模块入口（控制器）。
 * 入口：`/guandan` → 直接进联机大厅（无单机/联机选择页；单机已并入联机=1人+3AI、空座服务端补）。
 * 联机状态机：昵称 → 大厅(建房/匹配/加入/观战) → 房间(挑座/开打) → 牌桌(OnlineDriver)。
 * 控制器只编排：session 收发 + UI 切换 + 开打挂牌桌 + 掉线/重连 toast。规则/AI 全在服务端。
 */
import type { GameModule } from '../../shell/types';
import type { Seat } from './engine/types';
import { navigate } from '../../shell/nav';
import { OnlineDriver } from './driver/online-driver';
import { OnlineSession } from './online/session';
import { c2s, type LobbyRoom, type SeatInfo } from './online/protocol';
import { mountTable, primeAudio, setTableHost, setSeatNames, setSpectator } from './ui/view';
import { GUANDAN_RULES } from './rules';
import {
  renderNickname, renderLobby, renderRoom,
  type NicknameHandle, type LobbyHandle, type RoomHandle, type RoomState,
} from '../../ui/cardroom/screens';

/** 掼蛋联机牌局：昵称→大厅(建房/匹配/加入/观战)→房间→牌桌。单人=建房→开打，空座服务端补 AI。 */
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
  let pendingRejoin = false; // 自动 rejoin 在途（onOpen 见 savedRoom 置位，成功进房/牌桌清除）；失败据此回昵称页
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
    t.className = 'cr-toast';
    t.textContent = text;
    root.appendChild(t);
    window.setTimeout(() => t.remove(), 3800);
  }

  function showNickname(): void {
    clearScreen();
    nickH = renderNickname(root, {
      initial: session.nick,
      rules: GUANDAN_RULES,
      onSubmit: (n) => { primeAudio(); session.setNick(n); session.send(c2s.hello(n)); },
    });
  }
  function showLobby(): void {
    clearScreen();
    mySeat = null; isHost = false;
    session.clearRoom(); // 在大厅=不在任何房；清重连凭据，避免下次刷新拿旧房号去 rejoin 死房
    lobbyH = renderLobby(root, {
      nick: session.nick, rooms: [],
      onCreate: (o) => session.send(c2s.create(o.isPrivate ?? false)),
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
      code, initial: state, seatCount: 4, teams: true,
      onTakeSeat: (s) => session.send(c2s.takeSeat(s as Seat)),
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
  session.onOpen(() => {
    if (session.savedRoom()?.token) { pendingRejoin = true; return; } // 有会话令牌：session 自动 rejoin，等结果；标记在途，失败回昵称页(无 token 的旧凭据不空等)
    showNickname();
  });
  session.on('hello-ok', () => showLobby());
  session.on('rename-ok', () => showLobby());
  session.on('nick-taken', () => nickH?.showError('昵称已被占用，换一个'));
  session.on('lobby', (m) => lobbyH?.update((m as { rooms: LobbyRoom[] }).rooms));
  session.on('created', () => { isHost = true; });
  session.on('room', (m) => {
    pendingRejoin = false;
    const r = m as { code: string; status: 'waiting' | 'playing'; seats: (SeatInfo | null)[]; you: Seat | 'spectator' | null };
    mySeat = r.you;
    roomSeats = r.seats; applySeatNames(); // 牌桌昵称（联机中 room 不再来，故这里抓住）
    if (typeof r.you === 'number') session.saveRoom(r.code, r.you, r.seats[r.you]?.nick ?? session.nick); // 重连凭据：带本座真实昵称
    if (r.status === 'waiting') showRoom(r.code, r.seats, r.you);
  });
  session.on('spectating', (m) => {
    pendingRejoin = false;
    mySeat = 'spectator';
    roomSeats = (m as { seats: (SeatInfo | null)[] }).seats; applySeatNames();
    ensureTable();
  });
  session.on('rejoined', (m) => { pendingRejoin = false; mySeat = (m as { seat: Seat }).seat; applySeatNames(); ensureTable(); });
  session.on('started', () => ensureTable());
  session.on('state', () => { if (mySeat !== null) ensureTable(); }); // 观战/重连首个 state 兜底挂台
  // 掉线/AI接管/回来 全靠座位头像图案显示(state 带 seatStatus)，不再弹一闪而过的顶部 toast。
  session.on('room-closed', () => { session.clearRoom(); toast('房间已解散'); showLobby(); });
  session.on('error', (m) => {
    const msg = (m as { msg: string }).msg;
    lobbyH?.setMatching(false);
    // 自动 rejoin 在途却收到 error = 重连失败(服务端重启房间没了/座位被收回)——无论当前停在哪屏(含旧牌桌)
    // 都清陈旧房况、回昵称页，不把玩家晾在再也不会更新的冻结牌桌上；空屏(页面刚载)同样回昵称页。
    if (pendingRejoin || (!nickH && !lobbyH && !roomH && !tableCleanup)) {
      pendingRejoin = false;
      session.clearRoom();
      showNickname();
    } else if (onTable && driver) {
      driver.emitHint(msg, 'warn'); // 牌桌内错误(如出牌不合规)走游戏内提示条：贴近出牌按钮、随牌桌旋转，不用屏幕顶 toast(那个在 .gd-game 外、不旋转、飘到顶)
    } else {
      toast(msg);
    }
  });

  session.connect();
  return () => { clearScreen(); session.dispose(); };
}

function mount(root: HTMLElement): () => void {
  // 进掼蛋直接进联机大厅（昵称→大厅：建房/随机匹配/输房号加入/观战）。单机已并入联机——
  // 想一个人打就建房→开打，空座自动补 AI；界面无单独「单机」入口，也无 ?debug 隐藏入口。
  return onlineMount(root);
}

export const guandanModule: GameModule = {
  id: 'guandan',
  name: '掼蛋',
  desc: '升级类扑克，2v2 四人局：在线对战，可一人对 AI 或凑真人组队',
  mount,
};
