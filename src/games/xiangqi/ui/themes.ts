// 主题皮肤：调色板 + 棋子风格。仅驱动 Canvas 棋盘渲染（render.ts），不碰页面外框。
export type PieceStyle = 'ivory' | 'luminous' | 'solid';

// 单方棋子调色。
// ivory：topStops=顶面径向渐变，base=底盘骨色；luminous/solid：base=盘色（topStops 备用）。
export interface SidePalette {
  topStops: [string, string, string];
  base: string;
  edge: string; // 盘边 / 阴刻圈
  char: string; // 字色
  charUnderlay: string; // ivory 阴刻浅高光；luminous/solid 用 'transparent'
}

export interface Theme {
  key: string;
  name: string;
  boardBg: string[]; // 1 stop=纯色，多 stop=斜向线性渐变
  line: string;
  frame: string;
  river: string; // 楚河汉界文字
  mark: string; // 兵炮定位记号
  pieceStyle: PieceStyle;
  red: SidePalette;
  black: SidePalette;
  accent: string; // "r,g,b"：选中环 + 着法提示
  lastMoveRed: string; // "r,g,b"：最近一步（红走）
  lastMoveBlack: string; // "r,g,b"：最近一步（黑走）
}

export const THEMES: Theme[] = [
  {
    key: 'cinnabar',
    name: '朱砂水墨',
    boardBg: ['#eedfba', '#e7d6ad', '#dcc99c'],
    line: '#3a332a',
    frame: '#2a241b',
    river: 'rgba(35,30,21,0.5)',
    mark: '#3a332a',
    pieceStyle: 'ivory',
    red: { topStops: ['#f6ead0', '#eaddbd', '#dccaa0'], base: '#cbb98f', edge: '#c0392b', char: '#c0392b', charUnderlay: 'rgba(255,255,255,0.55)' },
    black: { topStops: ['#f6ead0', '#eaddbd', '#dccaa0'], base: '#cbb98f', edge: '#262320', char: '#262320', charUnderlay: 'rgba(255,255,255,0.55)' },
    accent: '63,107,94',
    lastMoveRed: '192,57,43',
    lastMoveBlack: '40,33,22',
  },
  {
    key: 'wood',
    name: '原木棋枰',
    boardBg: ['#d8a766', '#ca9c54', '#c8924f'],
    line: '#6b431f',
    frame: '#482c14',
    river: 'rgba(72,44,20,0.55)',
    mark: '#6b431f',
    pieceStyle: 'ivory',
    red: { topStops: ['#f0d9ac', '#ecd2a4', '#dcbd86'], base: '#b8935a', edge: '#a83224', char: '#a83224', charUnderlay: 'rgba(255,255,255,0.5)' },
    black: { topStops: ['#f0d9ac', '#ecd2a4', '#dcbd86'], base: '#b8935a', edge: '#1f6b46', char: '#1f6b46', charUnderlay: 'rgba(255,255,255,0.5)' },
    accent: '47,107,70',
    lastMoveRed: '168,50,36',
    lastMoveBlack: '31,107,70',
  },
  {
    key: 'night',
    name: '夜间墨玉',
    boardBg: ['#232b34', '#151b22', '#0e1318'],
    line: 'rgba(150,180,195,0.42)',
    frame: 'rgba(185,205,215,0.6)',
    river: 'rgba(180,205,215,0.45)',
    mark: 'rgba(150,180,195,0.42)',
    pieceStyle: 'luminous',
    red: { topStops: ['#3a2a27', '#2d2220', '#221a18'], base: '#2d2220', edge: '#5a3d38', char: '#ff7d6a', charUnderlay: 'transparent' },
    black: { topStops: ['#243038', '#1a2228', '#141a1f'], base: '#1a2228', edge: '#3a4852', char: '#74dcc6', charUnderlay: 'transparent' },
    accent: '111,224,204',
    lastMoveRed: '255,125,106',
    lastMoveBlack: '116,220,198',
  },
  {
    key: 'plain',
    name: '素雅纸枰',
    boardBg: ['#f6f3ec'],
    line: '#c2b596',
    frame: '#9c8d6e',
    river: 'rgba(120,110,90,0.5)',
    mark: '#c2b596',
    pieceStyle: 'solid',
    red: { topStops: ['#c0392b', '#c0392b', '#c0392b'], base: '#c0392b', edge: '#9c2c20', char: '#ffffff', charUnderlay: 'transparent' },
    black: { topStops: ['#2f2f33', '#2f2f33', '#2f2f33'], base: '#2f2f33', edge: '#1b1b20', char: '#ffffff', charUnderlay: 'transparent' },
    accent: '63,143,125',
    lastMoveRed: '192,57,43',
    lastMoveBlack: '47,47,51',
  },
];

export const DEFAULT_THEME_KEY = 'cinnabar';

export function themeByKey(key: string): Theme {
  return THEMES.find((t) => t.key === key) ?? THEMES[0];
}
