import type { Board, Color, Piece, PieceType, Square } from './types';
import { ROWS, COLS } from './types';

export function emptyBoard(): Board {
  return Array.from({ length: ROWS }, () => Array<Piece | null>(COLS).fill(null));
}

export function pieceAt(board: Board, sq: Square): Piece | null {
  return board[sq.row][sq.col];
}

// 深拷贝棋盘（着法应用时用，保持引擎纯函数、不改入参）
export function cloneBoard(board: Board): Board {
  return board.map((row) => row.map((p) => (p ? { ...p } : null)));
}

// 标准开局摆子。背排（车马象士将士象马车）+ 炮 + 兵卒。
export function initialBoard(): Board {
  const board = emptyBoard();
  const backRank: PieceType[] = [
    'chariot', 'horse', 'elephant', 'advisor', 'general', 'advisor', 'elephant', 'horse', 'chariot',
  ];

  const place = (row: number, col: number, type: PieceType, color: Color) => {
    board[row][col] = { type, color };
  };

  // 黑方（顶部 row 0-3）
  backRank.forEach((type, col) => place(0, col, type, 'black'));
  place(2, 1, 'cannon', 'black');
  place(2, 7, 'cannon', 'black');
  for (const col of [0, 2, 4, 6, 8]) place(3, col, 'soldier', 'black');

  // 红方（底部 row 9,7,6）
  backRank.forEach((type, col) => place(9, col, type, 'red'));
  place(7, 1, 'cannon', 'red');
  place(7, 7, 'cannon', 'red');
  for (const col of [0, 2, 4, 6, 8]) place(6, col, 'soldier', 'red');

  return board;
}
