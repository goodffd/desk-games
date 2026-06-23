import type { Board, Color, Piece, PieceType } from './types';
import { ROWS, COLS } from './types';
import { emptyBoard } from './board';

// 棋子类型 ↔ FEN 字母（通行象棋 FEN）
const TYPE_TO_LETTER: Record<PieceType, string> = {
  chariot: 'r', horse: 'n', elephant: 'b', advisor: 'a',
  general: 'k', cannon: 'c', soldier: 'p',
};
const LETTER_TO_TYPE: Record<string, PieceType> = {
  r: 'chariot', n: 'horse', b: 'elephant', a: 'advisor',
  k: 'general', c: 'cannon', p: 'soldier',
};

function pieceLetter(p: Piece): string {
  const l = TYPE_TO_LETTER[p.type];
  return p.color === 'red' ? l.toUpperCase() : l;
}

// 局面 → FEN（大写红、小写黑；尾部 w=红 / b=黑）
export function toFen(board: Board, turn: Color): string {
  const rows: string[] = [];
  for (let r = 0; r < ROWS; r++) {
    let line = '';
    let empties = 0;
    for (let c = 0; c < COLS; c++) {
      const p = board[r][c];
      if (!p) { empties++; continue; }
      if (empties > 0) { line += String(empties); empties = 0; }
      line += pieceLetter(p);
    }
    if (empties > 0) line += String(empties);
    rows.push(line);
  }
  return rows.join('/') + ' ' + (turn === 'red' ? 'w' : 'b');
}

// FEN → 局面。行数≠10 / 列数≠9 / 非法字符 / 缺轮走方 均抛错。
export function fromFen(fen: string): { board: Board; turn: Color } {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 2) throw new Error('FEN 缺少轮走方: ' + fen);
  const placement = parts[0];
  const side = parts[1];
  if (side !== 'w' && side !== 'b') throw new Error('FEN 轮走方非法: ' + side);

  // 轮走方之后的多余字段（如步数时钟 "0 1"）有意忽略，只取局面 + 走方
  const rowStrs = placement.split('/');
  if (rowStrs.length !== ROWS) throw new Error('FEN 行数必须为 10，实得 ' + rowStrs.length);

  const board = emptyBoard();
  for (let r = 0; r < ROWS; r++) {
    let c = 0;
    for (const ch of rowStrs[r]) {
      if (ch === '0') throw new Error('FEN 空位计数不能为 0: ' + rowStrs[r]);
      if (ch >= '1' && ch <= '9') {
        c += Number(ch);
      } else {
        const lower = ch.toLowerCase();
        const type = LETTER_TO_TYPE[lower];
        if (!type) throw new Error('FEN 非法字符: ' + ch);
        if (c >= COLS) throw new Error('FEN 第 ' + r + ' 行超出 9 列');
        board[r][c] = { type, color: ch === lower ? 'black' : 'red' };
        c++;
      }
    }
    if (c !== COLS) throw new Error('FEN 第 ' + r + ' 行列数必须为 9，实得 ' + c);
  }
  return { board, turn: side === 'w' ? 'red' : 'black' };
}
