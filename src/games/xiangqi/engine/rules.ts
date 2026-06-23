import type { Board, Color, Square } from './types';
import { opponent, squaresEqual } from './types';
import { pieceAt } from './board';
import { pseudoLegalMoves } from './moves';

// 找到指定颜色的将/帅位置；找不到返回 null（理论上不该发生）
export function findGeneral(board: Board, color: Color): Square | null {
  for (let row = 0; row < board.length; row++) {
    for (let col = 0; col < board[row].length; col++) {
      const p = board[row][col];
      if (p && p.type === 'general' && p.color === color) return { row, col };
    }
  }
  return null;
}

// 某格是否被 byColor 任一棋子攻击（按走子规则，含炮隔架、蹩马腿等）
export function isSquareAttacked(board: Board, sq: Square, byColor: Color): boolean {
  for (let row = 0; row < board.length; row++) {
    for (let col = 0; col < board[row].length; col++) {
      const p = board[row][col];
      if (!p || p.color !== byColor) continue;
      const moves = pseudoLegalMoves(board, { row, col });
      if (moves.some((m) => squaresEqual(m, sq))) return true;
    }
  }
  return false;
}

// 将帅照面：两将同列且中间无任何子
export function generalsFacing(board: Board): boolean {
  const red = findGeneral(board, 'red');
  const black = findGeneral(board, 'black');
  if (!red || !black) return false;
  if (red.col !== black.col) return false;
  const lo = Math.min(red.row, black.row);
  const hi = Math.max(red.row, black.row);
  for (let r = lo + 1; r < hi; r++) {
    if (pieceAt(board, { row: r, col: red.col })) return false;
  }
  return true;
}

// 指定颜色是否被将军：将的位置被对方攻击，或将帅照面
export function isInCheck(board: Board, color: Color): boolean {
  if (generalsFacing(board)) return true;
  const g = findGeneral(board, color);
  if (!g) return true; // 将被吃 = 视为被将（终局）
  return isSquareAttacked(board, g, opponent(color));
}
