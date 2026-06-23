import type { Board, Color, Move, PieceType } from './types';
import { ROWS, COLS } from './types';

/* ============ ICCS 坐标记法（项目内部一致约定） ============ */
// 纵线 col 0..8 → 'a'..'i'（红方视角左→右）；横线用 row 0..9（0=黑方底线）。
const FILES = 'abcdefghi';

export function moveToIccs(move: Move): string {
  return FILES[move.from.col] + move.from.row + '-' + FILES[move.to.col] + move.to.row;
}

export function iccsToMove(s: string): Move {
  const m = /^([a-i])(\d)-([a-i])(\d)$/.exec(s.trim());
  if (!m) throw new Error('非法 ICCS 着法: ' + s);
  return {
    from: { col: FILES.indexOf(m[1]), row: Number(m[2]) },
    to: { col: FILES.indexOf(m[3]), row: Number(m[4]) },
  };
}

/* ============ 中文记谱 ============ */
const PIECE_CHAR: Record<PieceType, [string, string]> = {
  general: ['帅', '将'], advisor: ['仕', '士'], elephant: ['相', '象'],
  horse: ['马', '马'], chariot: ['车', '车'], cannon: ['炮', '炮'], soldier: ['兵', '卒'],
};
const RED_DIGITS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const BLACK_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
// 进/退后接「步数」的直行子；其余（马象士）接「目标纵线」
const STEP_PIECES = new Set<PieceType>(['chariot', 'cannon', 'general', 'soldier']);

function charToType(ch: string): PieceType | null {
  for (const t of Object.keys(PIECE_CHAR) as PieceType[]) {
    if (PIECE_CHAR[t][0] === ch || PIECE_CHAR[t][1] === ch) return t;
  }
  return null;
}
function numStr(n: number, color: Color): string {
  return (color === 'red' ? RED_DIGITS : BLACK_DIGITS)[n - 1];
}
function parseNum(s: string, color: Color): number {
  const i = (color === 'red' ? RED_DIGITS : BLACK_DIGITS).indexOf(s);
  return i < 0 ? 0 : i + 1;
}
// 纵线号 ↔ col 互逆：COLS - col，自身即逆（COLS - (COLS - col) === col）。两方数值相同，仅数字体系不同。
function fileNum(col: number): number { return COLS - col; }
function colFromFileNum(n: number): number { return COLS - n; }
function sameFileRows(board: Board, type: PieceType, color: Color, col: number): number[] {
  const rs: number[] = [];
  for (let r = 0; r < ROWS; r++) {
    const p = board[r][col];
    if (p && p.type === type && p.color === color) rs.push(r);
  }
  return rs;
}

// 着法前局面 board + move → 中文记谱
export function moveToChinese(board: Board, move: Move): string {
  const p = board[move.from.row][move.from.col];
  if (!p) throw new Error('起点无子: ' + JSON.stringify(move));
  const { color, type } = p;
  const ch = PIECE_CHAR[type][color === 'red' ? 0 : 1];
  const dr = move.to.row - move.from.row;
  const forward = color === 'red' ? dr < 0 : dr > 0;

  let verb: string;
  let target: string;
  if (dr === 0) {
    verb = '平';
    target = numStr(fileNum(move.to.col), color);
  } else {
    verb = forward ? '进' : '退';
    target = STEP_PIECES.has(type)
      ? numStr(Math.abs(dr), color)
      : numStr(fileNum(move.to.col), color);
  }

  const onFile = sameFileRows(board, type, color, move.from.col);
  if (onFile.length >= 2) {
    const frontToBack = color === 'red' ? onFile : [...onFile].reverse();
    const idx = frontToBack.indexOf(move.from.row);
    const prefix = onFile.length === 2 ? (idx === 0 ? '前' : '后') : numStr(idx + 1, color);
    return prefix + ch + verb + target;
  }
  return ch + numStr(fileNum(move.from.col), color) + verb + target;
}

// 中文记谱 + 着法前局面 + 走方 → Move
export function chineseToMove(board: Board, color: Color, s: string): Move {
  const str = s.trim();
  if (str.length < 4) throw new Error('中文记谱过短: ' + s);
  const c0 = str[0], c1 = str[1], verbCh = str[2], numCh = str[3];

  let type: PieceType;
  let from: { row: number; col: number };

  const t0 = charToType(c0);
  if (t0 !== null) {
    // 常规式：子名 + 起纵线
    type = t0;
    const fnum = parseNum(c1, color);
    if (fnum === 0) throw new Error('无法解析起纵线: ' + s);
    const col = colFromFileNum(fnum);
    const rows = sameFileRows(board, type, color, col);
    if (rows.length === 0) throw new Error('该纵线无对应子: ' + s);
    if (rows.length > 1) throw new Error('同纵线多子，需用前/后消歧: ' + s); // 常规式歧义不能静默取第一个
    from = { row: rows[0], col };
  } else {
    // 位置式：前/后/序数 + 子名
    const t = charToType(c1);
    if (!t) throw new Error('无法解析子名: ' + s);
    type = t;
    let col = -1, rows: number[] = [];
    // 已知限制：若同名多子分布在两列以上，取 col 最小的列；局面真歧义时无法精确解析（见计划「已知限制」）
    for (let cc = 0; cc < COLS; cc++) {
      const rs = sameFileRows(board, type, color, cc);
      if (rs.length >= 2) { col = cc; rows = rs; break; }
    }
    if (col < 0) throw new Error('无可消歧的同纵线多子: ' + s);
    const frontToBack = color === 'red' ? rows : [...rows].reverse();
    let idx: number;
    if (c0 === '前') idx = 0;
    else if (c0 === '后') idx = frontToBack.length - 1;
    else {
      const n = parseNum(c0, color);
      if (n === 0) throw new Error('非法序数: ' + s);
      idx = n - 1;
    }
    if (idx < 0 || idx >= frontToBack.length) throw new Error('序数越界: ' + s);
    from = { row: frontToBack[idx], col };
  }

  // 红进=row减、红退=row增；黑反之
  const sign = (verbCh === '进') === (color === 'red') ? -1 : 1;
  let to: { row: number; col: number };
  if (verbCh === '平') {
    const fnum = parseNum(numCh, color);
    if (fnum === 0) throw new Error('非法目标纵线: ' + s);
    to = { row: from.row, col: colFromFileNum(fnum) };
  } else if (verbCh === '进' || verbCh === '退') {
    if (STEP_PIECES.has(type)) {
      const steps = parseNum(numCh, color);
      if (steps === 0) throw new Error('非法步数: ' + s);
      to = { row: from.row + sign * steps, col: from.col };
    } else {
      const fnum = parseNum(numCh, color);
      if (fnum === 0) throw new Error('非法目标纵线: ' + s);
      const toCol = colFromFileNum(fnum);
      const dc = Math.abs(toCol - from.col);
      const dr = type === 'horse' ? (dc === 1 ? 2 : 1) : type === 'elephant' ? 2 : 1;
      to = { row: from.row + sign * dr, col: toCol };
    }
  } else {
    throw new Error('非法动向: ' + s);
  }
  return { from, to };
}
