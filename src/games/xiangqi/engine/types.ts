// 棋子颜色：红先黑后
export type Color = 'red' | 'black';

// 棋子类型
export type PieceType =
  | 'general' // 将 / 帅
  | 'advisor' // 士 / 仕
  | 'elephant' // 象 / 相
  | 'horse' // 马
  | 'chariot' // 车
  | 'cannon' // 炮
  | 'soldier'; // 兵 / 卒

export interface Piece {
  type: PieceType;
  color: Color;
}

// 坐标：row 0..9（0 = 顶部黑方底线，9 = 底部红方底线），col 0..8（从红方视角左到右）
export interface Square {
  row: number;
  col: number;
}

export interface Move {
  from: Square;
  to: Square;
}

// 棋盘：board[row][col]，空位为 null。10 行 × 9 列。
export type Board = (Piece | null)[][];

export const ROWS = 10;
export const COLS = 9;

export type GameStatus =
  | 'playing'
  | 'red_win'
  | 'black_win'
  | 'draw';

export function opponent(color: Color): Color {
  return color === 'red' ? 'black' : 'red';
}

export function squaresEqual(a: Square, b: Square): boolean {
  return a.row === b.row && a.col === b.col;
}

export function inBounds(sq: Square): boolean {
  return sq.row >= 0 && sq.row < ROWS && sq.col >= 0 && sq.col < COLS;
}
