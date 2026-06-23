import type { Board, Color, Move, PieceType } from './types';
import { opponent } from './types';
import { pieceAt } from './board';
import { allLegalMoves, applyMove } from './game';

// 子力价值（将极大，确保不会为吃子放弃将的安全——实际由合法着法保证不送将）
const PIECE_VALUE = {
  general: 100000,
  chariot: 900,
  cannon: 450,
  horse: 450,
  advisor: 200,
  elephant: 200,
  soldier: 100,
} as const;

const MATE = 1_000_000;

// 轻量位置分（远小于子力，仅用于鼓励出动/过河、并打破同分僵局，不会引起子力层面误判）。
// 一律按「己方视角」：advance=离本方底线的前进格数，center=列居中度。
function positionalValue(type: PieceType, color: Color, row: number, col: number): number {
  const advance = color === 'red' ? 9 - row : row;
  const center = 4 - Math.abs(col - 4); // 0..4
  switch (type) {
    case 'soldier':
      return advance * 3 + (advance >= 5 ? center * 2 : 0); // 鼓励过河与中路推进
    case 'horse':
      return advance > 0 ? center * 3 + Math.min(advance, 5) * 2 : 0; // 出动并占中
    case 'cannon':
      return center * 2 + (advance > 0 ? 4 : 0);
    case 'chariot':
      return center * 2 + Math.min(advance, 4) * 2; // 出车、控线
    default:
      return 0; // 士/象/将留守，不另加
  }
}

// 从 color 视角的局面评估：（己方 - 对方）的子力 + 位置分。
export function evaluate(board: Board, color: Color): number {
  let score = 0;
  for (let row = 0; row < board.length; row++) {
    for (let col = 0; col < board[row].length; col++) {
      const p = board[row][col];
      if (!p) continue;
      const v = PIECE_VALUE[p.type] + positionalValue(p.type, p.color, row, col);
      score += p.color === color ? v : -v;
    }
  }
  return score;
}

// 吃子着法优先（被吃子价值高者更先），改进 α-β 剪枝效率
function orderMoves(board: Board, moves: Move[]): Move[] {
  return [...moves].sort((a, b) => captureValue(board, b) - captureValue(board, a));
}
function captureValue(board: Board, m: Move): number {
  const t = pieceAt(board, m.to);
  return t ? PIECE_VALUE[t.type] : 0;
}

// 静止搜索：叶子处只把吃子着法走完再评估，消除水平线效应（避免「吃完就被吃回」误判为得子）。
function quiesce(board: Board, color: Color, alpha: number, beta: number): number {
  const standPat = evaluate(board, color);
  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;

  const captures = allLegalMoves(board, color).filter((m) => pieceAt(board, m.to) !== null);
  for (const m of orderMoves(board, captures)) {
    const child = applyMove(board, m);
    const score = -quiesce(child, opponent(color), -beta, -alpha);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

// negamax + α-β。ply = 距根步数，用于偏好更快的杀。
function negamax(board: Board, color: Color, depth: number, ply: number, alpha: number, beta: number): number {
  const moves = allLegalMoves(board, color);
  if (moves.length === 0) return -(MATE - ply); // 无着可走 = 本方负（将死/困毙），越快越糟
  if (depth === 0) return quiesce(board, color, alpha, beta);

  let best = -Infinity;
  for (const m of orderMoves(board, moves)) {
    const child = applyMove(board, m);
    const score = -negamax(child, opponent(color), depth - 1, ply + 1, -beta, -alpha);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break; // 剪枝
  }
  return best;
}

// 棋力分档：深度越深越强；入门档加失误概率让新手能赢。
export type AiLevel = 'beginner' | 'easy' | 'medium';
export const AI_LEVELS: Record<AiLevel, { label: string; depth: number; blunderChance: number }> = {
  beginner: { label: '入门', depth: 1, blunderChance: 0.4 },
  easy: { label: '初级', depth: 2, blunderChance: 0 },
  medium: { label: '中级', depth: 3, blunderChance: 0 },
};

// 按棋力选着：以一定概率走随机合法着（失误），否则按该档深度搜索。rand 可注入便于测试。
export function chooseMove(
  board: Board,
  color: Color,
  level: AiLevel,
  rand: () => number = Math.random,
): Move | null {
  const moves = allLegalMoves(board, color);
  if (moves.length === 0) return null;
  const cfg = AI_LEVELS[level];
  if (cfg.blunderChance > 0 && rand() < cfg.blunderChance) {
    return moves[Math.floor(rand() * moves.length)];
  }
  return searchBestMove(board, color, cfg.depth);
}

// 为 color 搜索最佳着法。无合法着法返回 null。
export function searchBestMove(board: Board, color: Color, depth = 3): Move | null {
  const moves = allLegalMoves(board, color);
  if (moves.length === 0) return null;

  let bestMove: Move = moves[0];
  let bestScore = -Infinity;
  let alpha = -Infinity;
  const beta = Infinity;
  for (const m of orderMoves(board, moves)) {
    const child = applyMove(board, m);
    const score = -negamax(child, opponent(color), depth - 1, 1, -beta, -alpha);
    if (score > bestScore) {
      bestScore = score;
      bestMove = m;
    }
    if (bestScore > alpha) alpha = bestScore;
  }
  return bestMove;
}
