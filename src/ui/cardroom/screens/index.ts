/**
 * 出牌类联机前置三屏（昵称/大厅/房间）公共层。掼蛋与干瞪眼共用同一套渲染与样式；
 * 差异（品牌文案 / 座位数分段器 / 随机匹配 / 队色）全走参数，默认值精确复现掼蛋。
 */
export { renderNickname, type NicknameOpts, type NicknameHandle } from './nickname';
export { renderLobby, type LobbyOpts, type LobbyHandle } from './lobby';
export { renderRoom, type RoomOpts, type RoomHandle } from './room';
export type { LobbyRoom, RoomState, SeatOccupant } from './types';
