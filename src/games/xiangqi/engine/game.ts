import type { Board, Color, GameStatus, Move, Square } from './types';
import { opponent, squaresEqual } from './types';
import { cloneBoard, initialBoard, pieceAt } from './board';
import { pseudoLegalMoves } from './moves';
import { isInCheck, isSquareAttacked } from './rules';
import { adjudicateRepetition } from './repetition';
import type { PlyInfo } from './repetition';

// 应用一步着法，返回新棋盘（纯函数，不改入参）。吃子即覆盖目标格。
export function applyMove(board: Board, move: Move): Board {
  const next = cloneBoard(board);
  const moving = next[move.from.row][move.from.col];
  next[move.from.row][move.from.col] = null;
  next[move.to.row][move.to.col] = moving;
  return next;
}

// 某格棋子的全部合法着法：伪合法着法中，过滤掉「走后己方仍/将被将军（含照面）」的。
export function legalMovesFrom(board: Board, from: Square): Square[] {
  const piece = pieceAt(board, from);
  if (!piece) return [];
  return pseudoLegalMoves(board, from).filter((to) => {
    const after = applyMove(board, { from, to });
    return !isInCheck(after, piece.color);
  });
}

// 指定颜色的全部合法着法
export function allLegalMoves(board: Board, color: Color): Move[] {
  const moves: Move[] = [];
  for (let row = 0; row < board.length; row++) {
    for (let col = 0; col < board[row].length; col++) {
      const p = board[row][col];
      if (!p || p.color !== color) continue;
      for (const to of legalMovesFrom(board, { row, col })) {
        moves.push({ from: { row, col }, to });
      }
    }
  }
  return moves;
}

// 某格的子是否「有根」（被己方保护，可被回吃）。把该格临时换成敌方子探测己方是否攻击此格。
function isDefended(board: Board, q: Square): boolean {
  const p = pieceAt(board, q);
  if (!p) return false;
  const owner = p.color;
  const b2 = cloneBoard(board);
  b2[q.row][q.col] = { type: 'soldier', color: opponent(owner) }; // 假想可吃目标
  return isSquareAttacked(b2, q, owner);
}

// byColor 是否（非将地）威胁吃一枚无根的非将敌子——长捉判定用。
export function hasUndefendedCaptureThreat(board: Board, byColor: Color): boolean {
  const enemy = opponent(byColor);
  for (let row = 0; row < board.length; row++) {
    for (let col = 0; col < board[row].length; col++) {
      const p = board[row][col];
      if (!p || p.color !== byColor) continue;
      for (const to of legalMovesFrom(board, { row, col })) {
        const target = pieceAt(board, to);
        if (target && target.color === enemy && target.type !== 'general' && !isDefended(board, to)) {
          // 排除献/兑：举棋的捉子 (row,col) 自身挂着（被敌攻击且无根）则非真捉
          const attacker = { row, col };
          const hanging = isSquareAttacked(board, attacker, enemy) && !isDefended(board, attacker);
          if (!hanging) return true;
        }
      }
    }
  }
  return false;
}

// 轮到 turn 行棋时的局面状态：无合法着法即判负（将死或困毙皆判负，符合象棋规则）。
export function computeStatus(board: Board, turn: Color): GameStatus {
  if (allLegalMoves(board, turn).length === 0) {
    return opponent(turn) === 'red' ? 'red_win' : 'black_win';
  }
  return 'playing';
}

// 每子映射唯一单字：chariot/cannon 首字母同为 'c' 会碰撞，污染重复局面判定，故显式映射。导出供单测。
const TYPE_CHAR: Record<string, string> = { general: 'g', advisor: 'a', elephant: 'e', horse: 'h', chariot: 'c', cannon: 'p', soldier: 's' };
export function positionKey(board: Board, turn: Color): string {
  return turn + '|' + board
    .map((row) => row.map((p) => (p ? p.color[0] + (TYPE_CHAR[p.type] || p.type[0]) : '..')).join(''))
    .join('/');
}

interface Snapshot {
  board: Board;
  turn: Color;
  status: GameStatus;
}

const REPETITION_TRIGGER = 3; // 同一局面出现三次后触发循环裁决

export class Game {
  board: Board;
  turn: Color;
  status: GameStatus;
  private history: Snapshot[] = [];
  private positions: string[] = []; // positions[k] = 第 k 步后的局面键（[0]=初始）
  private plies: PlyInfo[] = []; // plies[k] = 第 k+1 步的属性
  private startBoard: Board;
  private startTurn: Color;
  private moveList: Move[] = [];

  constructor() {
    this.board = initialBoard();
    this.turn = 'red';
    this.status = computeStatus(this.board, this.turn);
    this.positions.push(positionKey(this.board, this.turn));
    this.startBoard = cloneBoard(this.board);
    this.startTurn = this.turn;
  }

  // 从自定义局面构造（测试 / 残局用）
  static fromPosition(board: Board, turn: Color): Game {
    const g = new Game();
    g.board = cloneBoard(board);
    g.turn = turn;
    g.status = computeStatus(g.board, g.turn);
    g.history = [];
    g.positions = [positionKey(g.board, g.turn)];
    g.plies = [];
    g.startBoard = cloneBoard(board);
    g.startTurn = turn;
    g.moveList = [];
    return g;
  }

  legalMoves(from: Square): Square[] {
    if (this.status !== 'playing') return [];
    const piece = pieceAt(this.board, from);
    if (!piece || piece.color !== this.turn) return [];
    return legalMovesFrom(this.board, from);
  }

  // 落子。非法或非当前方棋子返回 false 且不改变状态。
  move(m: Move): boolean {
    if (this.status !== 'playing') return false;
    const piece = pieceAt(this.board, m.from);
    if (!piece || piece.color !== this.turn) return false;
    const legal = legalMovesFrom(this.board, m.from);
    if (!legal.some((to) => squaresEqual(to, m.to))) return false;

    const mover = this.turn;
    this.history.push({ board: cloneBoard(this.board), turn: this.turn, status: this.status });
    this.moveList.push({ from: { ...m.from }, to: { ...m.to } });
    this.board = applyMove(this.board, m);
    this.turn = opponent(this.turn);
    this.status = computeStatus(this.board, this.turn);

    // 记录本步属性：是否将军（走后对方被将）/ 是否捉无根子
    this.plies.push({
      mover,
      gaveCheck: isInCheck(this.board, this.turn),
      chaseThreat: hasUndefendedCaptureThreat(this.board, mover),
    });

    const key = positionKey(this.board, this.turn);
    this.positions.push(key);
    this.maybeAdjudicateRepetition(key);
    return true;
  }

  // 局面三次重复时，按长将/长捉/消极循环裁决
  private maybeAdjudicateRepetition(key: string): void {
    if (this.status !== 'playing') return;
    const occurrences = this.positions.filter((k) => k === key).length;
    if (occurrences < REPETITION_TRIGGER) return;
    // 取最近一个完整循环：上一次出现该局面到现在之间的着法
    const n = this.positions.length - 1; // 当前局面在 positions 的下标
    let prev = -1;
    for (let j = n - 1; j >= 0; j--) {
      if (this.positions[j] === key) { prev = j; break; }
    }
    if (prev < 0) return;
    const cycle = this.plies.slice(prev, n); // plies[prev..n-1] 构成一圈
    this.status = adjudicateRepetition(cycle);
  }

  // 悔棋，恢复上一步前的完整状态。
  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.board = prev.board;
    this.turn = prev.turn;
    this.status = prev.status;
    this.positions.pop();
    this.plies.pop();
    this.moveList.pop();
    return true;
  }

  // 起始局面（深拷贝），供 PGN 重放
  get startPosition(): { board: Board; turn: Color } {
    return { board: cloneBoard(this.startBoard), turn: this.startTurn };
  }

  // 已走着法序列（深拷贝）
  getMoves(): Move[] {
    return this.moveList.map((m) => ({ from: { ...m.from }, to: { ...m.to } }));
  }
}
