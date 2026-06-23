import type { Board, Color, Square } from './types';
import { COLS, ROWS, inBounds } from './types';
import { pieceAt } from './board';

// 九宫：列 3-5；红方 row 7-9，黑方 row 0-2
function inPalace(sq: Square, color: Color): boolean {
  if (sq.col < 3 || sq.col > 5) return false;
  return color === 'red' ? sq.row >= 7 && sq.row <= 9 : sq.row >= 0 && sq.row <= 2;
}

// 是否在己方半河之内（象不可过河）。红方 row>=5，黑方 row<=4。
function onOwnSide(row: number, color: Color): boolean {
  return color === 'red' ? row >= 5 : row <= 4;
}

// 是否已过河（兵卒横走判定）。红方 row<=4，黑方 row>=5。
function crossedRiver(row: number, color: Color): boolean {
  return color === 'red' ? row <= 4 : row >= 5;
}

// 红方向前 = row 减小；黑方向前 = row 增大
function forwardDir(color: Color): number {
  return color === 'red' ? -1 : 1;
}

/**
 * 生成某一格棋子的全部「伪合法」着法目标。
 * 伪合法 = 满足走子规则、不落在己方子上，但不检查走后己方是否被将军（由 game 层过滤）。
 */
export function pseudoLegalMoves(board: Board, from: Square): Square[] {
  const piece = pieceAt(board, from);
  if (!piece) return [];
  const color = piece.color;
  const out: Square[] = [];

  // 仅当目标在界内、且不是己方子时收入
  const tryAdd = (row: number, col: number) => {
    const to = { row, col };
    if (!inBounds(to)) return;
    const target = pieceAt(board, to);
    if (target && target.color === color) return;
    out.push(to);
  };

  switch (piece.type) {
    case 'general': {
      const steps = [
        [from.row - 1, from.col],
        [from.row + 1, from.col],
        [from.row, from.col - 1],
        [from.row, from.col + 1],
      ];
      for (const [r, c] of steps) {
        if (inPalace({ row: r, col: c }, color)) tryAdd(r, c);
      }
      break;
    }

    case 'advisor': {
      const steps = [
        [from.row - 1, from.col - 1],
        [from.row - 1, from.col + 1],
        [from.row + 1, from.col - 1],
        [from.row + 1, from.col + 1],
      ];
      for (const [r, c] of steps) {
        if (inPalace({ row: r, col: c }, color)) tryAdd(r, c);
      }
      break;
    }

    case 'elephant': {
      const diags = [
        [-2, -2, -1, -1],
        [-2, 2, -1, 1],
        [2, -2, 1, -1],
        [2, 2, 1, 1],
      ];
      for (const [dr, dc, er, ec] of diags) {
        const r = from.row + dr;
        const c = from.col + dc;
        if (!inBounds({ row: r, col: c })) continue;
        if (!onOwnSide(r, color)) continue; // 不可过河
        const eye = { row: from.row + er, col: from.col + ec }; // 象眼
        if (pieceAt(board, eye)) continue; // 塞象眼
        tryAdd(r, c);
      }
      break;
    }

    case 'horse': {
      // [dr, dc, legDr, legDc]
      const jumps = [
        [-2, -1, -1, 0],
        [-2, 1, -1, 0],
        [2, -1, 1, 0],
        [2, 1, 1, 0],
        [-1, -2, 0, -1],
        [1, -2, 0, -1],
        [-1, 2, 0, 1],
        [1, 2, 0, 1],
      ];
      for (const [dr, dc, lr, lc] of jumps) {
        const leg = { row: from.row + lr, col: from.col + lc };
        if (!inBounds(leg) || pieceAt(board, leg)) continue; // 蹩马腿
        tryAdd(from.row + dr, from.col + dc);
      }
      break;
    }

    case 'chariot': {
      const dirs = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ];
      for (const [dr, dc] of dirs) {
        let r = from.row + dr;
        let c = from.col + dc;
        while (inBounds({ row: r, col: c })) {
          const target = pieceAt(board, { row: r, col: c });
          if (!target) {
            out.push({ row: r, col: c });
          } else {
            if (target.color !== color) out.push({ row: r, col: c }); // 吃敌方
            break; // 遇子即止
          }
          r += dr;
          c += dc;
        }
      }
      break;
    }

    case 'cannon': {
      const dirs = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ];
      for (const [dr, dc] of dirs) {
        let r = from.row + dr;
        let c = from.col + dc;
        // 第一段：未遇炮架前，沿空格移动
        while (inBounds({ row: r, col: c }) && !pieceAt(board, { row: r, col: c })) {
          out.push({ row: r, col: c });
          r += dr;
          c += dc;
        }
        // 遇到炮架后，继续找架后第一个子
        if (inBounds({ row: r, col: c })) {
          r += dr;
          c += dc;
          while (inBounds({ row: r, col: c })) {
            const target = pieceAt(board, { row: r, col: c });
            if (target) {
              if (target.color !== color) out.push({ row: r, col: c }); // 隔架吃敌方
              break;
            }
            r += dr;
            c += dc;
          }
        }
      }
      break;
    }

    case 'soldier': {
      const fd = forwardDir(color);
      tryAdd(from.row + fd, from.col); // 向前一步
      if (crossedRiver(from.row, color)) {
        tryAdd(from.row, from.col - 1); // 过河后可横走
        tryAdd(from.row, from.col + 1);
      }
      break;
    }
  }

  // 防御：确保所有目标在界内（兜底，理论上 tryAdd 已保证）
  return out.filter((s) => s.row >= 0 && s.row < ROWS && s.col >= 0 && s.col < COLS);
}
