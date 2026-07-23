/**
 * 出牌类公共前置屏（昵称/大厅/房间）的共享类型。
 * 只描述「渲染三屏需要什么」，不绑定任何一个游戏的协议——两边各自的 SeatInfo/LobbyRoom
 * 都能赋值进来（房间只读 nick，大厅只读 code/status/players）。
 */

/** 大厅房列表一行（掼蛋 protocol.LobbyRoom、干瞪眼本地 LobbyRoom 均结构兼容）。 */
export interface LobbyRoom {
  code: string;
  status: 'waiting' | 'playing';
  players: string[];
  spectators?: number;
}

/** 房间页每座只需要昵称；空座为 null。两边的 SeatInfo[] 都可赋值。 */
export type SeatOccupant = { nick: string | null } | null;

export interface RoomState {
  seats: readonly SeatOccupant[];
  you: number | 'spectator' | null;
  isHost: boolean;
}

function elx(tag: string, cls: string): HTMLElement { const e = document.createElement(tag); e.className = cls; return e; }
function textx(tag: string, cls: string, t: string): HTMLElement { const e = elx(tag, cls); e.textContent = t; return e; }
/** 主/次按钮：base 类 cr-lobby__btn 恒前置，modifiers 只传修饰类。 */
function buttonx(modifiers: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = ('cr-lobby__btn ' + modifiers).trim();
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

export { elx as el, textx as text, buttonx as button };
