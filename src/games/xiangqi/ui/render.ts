import type { Board, Color, Move, Piece, PieceType, Square } from '../engine/types';
import { COLS, ROWS } from '../engine/types';
import type { SidePalette, Theme } from './themes';

// 动画中的「飞行棋子」：渲染时跳过 skip 格、改在 (x,y) 处画该棋子
export interface AnimState {
  skip: Square;
  piece: Piece;
  x: number;
  y: number;
}

export const MARGIN = 30;
export const CELL = 60;
const PIECE_R = 26;

// 逻辑画布尺寸（坐标系基准；DPR 缩放在 main 里处理）
export const BOARD_W = MARGIN * 2 + (COLS - 1) * CELL; // 540
export const BOARD_H = MARGIN * 2 + (ROWS - 1) * CELL; // 600

export function pointX(col: number): number {
  return MARGIN + col * CELL;
}
export function pointY(row: number): number {
  return MARGIN + row * CELL;
}

// 像素坐标 → 最近的棋盘交点；超出容差返回 null
export function pixelToSquare(px: number, py: number): Square | null {
  const col = Math.round((px - MARGIN) / CELL);
  const row = Math.round((py - MARGIN) / CELL);
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
  const dx = px - pointX(col);
  const dy = py - pointY(row);
  if (Math.hypot(dx, dy) > CELL * 0.5) return null;
  return { row, col };
}

const CHARS: Record<PieceType, [string, string]> = {
  // [red, black]
  general: ['帅', '将'],
  advisor: ['仕', '士'],
  elephant: ['相', '象'],
  horse: ['马', '马'],
  chariot: ['车', '车'],
  cannon: ['炮', '炮'],
  soldier: ['兵', '卒'],
};

function charFor(type: PieceType, color: Color): string {
  return CHARS[type][color === 'red' ? 0 : 1];
}

// 首选嵌入子集字体 XiangqiKai（四系统一致），后面是系统兜底（万一字体没加载好）
const PIECE_FONT = '30px "XiangqiKai", "Weibei SC", "STXinwei", "STLiti", "STKaiti", "PingFang SC", serif';

function line(ctx: CanvasRenderingContext2D, c1: number, r1: number, c2: number, r2: number) {
  ctx.beginPath();
  ctx.moveTo(pointX(c1), pointY(r1));
  ctx.lineTo(pointX(c2), pointY(r2));
  ctx.stroke();
}

// 兵/炮起始点的「╗╔╝╚」定位记号
function drawPositionMark(ctx: CanvasRenderingContext2D, col: number, row: number, t: Theme) {
  const x = pointX(col);
  const y = pointY(row);
  const gap = 5;
  const len = 7;
  ctx.strokeStyle = t.mark;
  ctx.lineWidth = 1.2;
  for (const sx of [-1, 1]) {
    if (col === 0 && sx < 0) continue; // 左边界点不画左侧
    if (col === COLS - 1 && sx > 0) continue; // 右边界点不画右侧
    for (const sy of [-1, 1]) {
      const cx = x + sx * gap;
      const cy = y + sy * gap;
      ctx.beginPath();
      ctx.moveTo(cx, cy + sy * len);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + sx * len, cy);
      ctx.stroke();
    }
  }
}

function drawBoard(ctx: CanvasRenderingContext2D, t: Theme) {
  // 棋盘底（1 stop 纯色，多 stop 斜向渐变）
  if (t.boardBg.length === 1) {
    ctx.fillStyle = t.boardBg[0];
  } else {
    const bg = ctx.createLinearGradient(0, 0, BOARD_W, BOARD_H);
    t.boardBg.forEach((c, i) => bg.addColorStop(i / (t.boardBg.length - 1), c));
    ctx.fillStyle = bg;
  }
  ctx.fillRect(0, 0, BOARD_W, BOARD_H);

  const left = pointX(0);
  const right = pointX(COLS - 1);
  const top = pointY(0);
  const bot = pointY(ROWS - 1);

  // 外双框
  ctx.strokeStyle = t.frame;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(left - 12, top - 12, right - left + 24, bot - top + 24);
  ctx.lineWidth = 1;
  ctx.strokeRect(left - 7, top - 7, right - left + 14, bot - top + 14);

  // 网格（细线）
  ctx.strokeStyle = t.line;
  ctx.lineWidth = 1;
  for (let r = 0; r < ROWS; r++) line(ctx, 0, r, COLS - 1, r);
  line(ctx, 0, 0, 0, ROWS - 1);
  line(ctx, COLS - 1, 0, COLS - 1, ROWS - 1);
  for (let c = 1; c < COLS - 1; c++) {
    line(ctx, c, 0, c, 4); // 楚河处断开
    line(ctx, c, 5, c, ROWS - 1);
  }

  // 九宫斜线
  line(ctx, 3, 0, 5, 2);
  line(ctx, 5, 0, 3, 2);
  line(ctx, 3, 7, 5, 9);
  line(ctx, 5, 7, 3, 9);

  // 兵炮定位记号
  for (const [c, r] of [[1, 2], [7, 2], [1, 7], [7, 7]] as const) drawPositionMark(ctx, c, r, t);
  for (const c of [0, 2, 4, 6, 8]) {
    drawPositionMark(ctx, c, 3, t);
    drawPositionMark(ctx, c, 6, t);
  }

  // 楚河漢界（书法体，宽字距）
  ctx.fillStyle = t.river;
  ctx.font = '32px "XiangqiKai", "STKaiti", "KaiTi", "PingFang SC", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const midY = (pointY(4) + pointY(5)) / 2;
  ctx.fillText('楚    河', pointX(2), midY);
  ctx.fillText('漢    界', pointX(6), midY);
}

// ivory：凸起骨牙圆盘（接触投影 + 盘侧厚度 + 顶面径向 + 倒角 + 阴刻圈 + 阴刻字）
function drawIvoryPiece(ctx: CanvasRenderingContext2D, x: number, y: number, ch: string, side: SidePalette) {
  const R = PIECE_R;
  const ty = y - 2;
  ctx.save();
  ctx.shadowColor = 'rgba(28,22,12,0.5)';
  ctx.shadowBlur = 7;
  ctx.shadowOffsetY = 5;
  ctx.beginPath();
  ctx.arc(x, y + 1, R, 0, Math.PI * 2);
  ctx.fillStyle = side.base;
  ctx.fill();
  ctx.restore();

  const top = ctx.createRadialGradient(x - R * 0.35, ty - R * 0.4, R * 0.15, x, ty, R);
  top.addColorStop(0, side.topStops[0]);
  top.addColorStop(0.55, side.topStops[1]);
  top.addColorStop(1, side.topStops[2]);
  ctx.beginPath();
  ctx.arc(x, ty, R - 2, 0, Math.PI * 2);
  ctx.fillStyle = top;
  ctx.fill();

  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(x, ty, R - 3, Math.PI * 1.08, Math.PI * 1.92);
  ctx.strokeStyle = 'rgba(255,250,238,0.4)';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, ty, R - 3, Math.PI * 0.08, Math.PI * 0.92);
  ctx.strokeStyle = 'rgba(120,92,52,0.4)';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, ty, R - 7, 0, Math.PI * 2);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = side.edge;
  ctx.stroke();

  ctx.font = PIECE_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = side.charUnderlay;
  ctx.fillText(ch, x, ty + 1.3);
  ctx.fillStyle = side.char;
  ctx.fillText(ch, x, ty);
}

// luminous：暗盘 + 发光阴刻字（夜间）
function drawLuminousPiece(ctx: CanvasRenderingContext2D, x: number, y: number, ch: string, side: SidePalette) {
  const R = PIECE_R;
  const ty = y - 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 4;
  ctx.beginPath();
  ctx.arc(x, y + 1, R, 0, Math.PI * 2);
  ctx.fillStyle = side.base;
  ctx.fill();
  ctx.restore();

  const top = ctx.createRadialGradient(x - R * 0.3, ty - R * 0.35, R * 0.1, x, ty, R);
  top.addColorStop(0, side.topStops[0]);
  top.addColorStop(1, side.topStops[2]);
  ctx.beginPath();
  ctx.arc(x, ty, R - 2, 0, Math.PI * 2);
  ctx.fillStyle = top;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, ty, R - 3, 0, Math.PI * 2);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = side.edge;
  ctx.stroke();

  ctx.save();
  ctx.font = PIECE_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = side.char;
  ctx.shadowBlur = 10;
  ctx.fillStyle = side.char;
  ctx.fillText(ch, x, ty);
  ctx.fillText(ch, x, ty); // 叠一层加强辉光
  ctx.restore();
}

// solid：实色双拼盘 + 白字（素雅扁平）
function drawSolidPiece(ctx: CanvasRenderingContext2D, x: number, y: number, ch: string, side: SidePalette) {
  const R = PIECE_R;
  const ty = y - 1;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 3;
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fillStyle = side.base;
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(x, ty, R, 0, Math.PI * 2);
  ctx.fillStyle = side.base;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = side.edge;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, ty, R - 4, 0, Math.PI * 2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.stroke();

  ctx.font = PIECE_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = side.char;
  ctx.fillText(ch, x, ty);
}

function drawPieceAt(ctx: CanvasRenderingContext2D, x: number, y: number, type: PieceType, color: Color, t: Theme) {
  const side = color === 'red' ? t.red : t.black;
  const ch = charFor(type, color);
  if (t.pieceStyle === 'ivory') drawIvoryPiece(ctx, x, y, ch, side);
  else if (t.pieceStyle === 'luminous') drawLuminousPiece(ctx, x, y, ch, side);
  else drawSolidPiece(ctx, x, y, ch, side);
}

function drawPiece(ctx: CanvasRenderingContext2D, sq: Square, type: PieceType, color: Color, t: Theme) {
  drawPieceAt(ctx, pointX(sq.col), pointY(sq.row), type, color, t);
}

// 最近一步高亮：起点（浅）+ 落点（深），按走子方分色
function drawLastMove(ctx: CanvasRenderingContext2D, move: Move, mover: Color, t: Theme) {
  const half = CELL * 0.44;
  const base = mover === 'red' ? t.lastMoveRed : t.lastMoveBlack;
  const cell = (sq: Square, alpha: number) => {
    ctx.fillStyle = `rgba(${base},${alpha})`;
    ctx.beginPath();
    ctx.roundRect(pointX(sq.col) - half, pointY(sq.row) - half, half * 2, half * 2, 6);
    ctx.fill();
  };
  cell(move.from, 0.2);
  cell(move.to, 0.42);
}

function drawSelection(ctx: CanvasRenderingContext2D, sq: Square, t: Theme) {
  const x = pointX(sq.col);
  const y = pointY(sq.row);
  ctx.save();
  ctx.shadowColor = `rgba(${t.accent},0.85)`;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(x, y, PIECE_R + 2, 0, Math.PI * 2);
  ctx.strokeStyle = `rgb(${t.accent})`;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

function drawMoveHint(ctx: CanvasRenderingContext2D, sq: Square, capture: boolean, t: Theme) {
  const x = pointX(sq.col);
  const y = pointY(sq.row);
  if (capture) {
    ctx.beginPath();
    ctx.arc(x, y, PIECE_R + 3, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${t.accent},0.9)`;
    ctx.lineWidth = 3;
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${t.accent},0.7)`;
    ctx.fill();
  }
}

// 开局谱着提示：金色书签点（描环 + 实心点），区别于青玉选中/着法点
function drawBookHints(ctx: CanvasRenderingContext2D, squares: Square[]) {
  for (const sq of squares) {
    const x = pointX(sq.col);
    const y = pointY(sq.row);
    ctx.beginPath();
    ctx.arc(x, y, PIECE_R + 1, 0, Math.PI * 2);
    ctx.strokeStyle = '#d8b777';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#d8b777';
    ctx.fill();
  }
}

export function render(
  ctx: CanvasRenderingContext2D,
  board: Board,
  selected: Square | null,
  legalDests: Square[],
  lastMove: Move | null,
  anim: AnimState | null,
  theme: Theme,
  bookHints: Square[] = [],
) {
  ctx.clearRect(0, 0, BOARD_W, BOARD_H);
  drawBoard(ctx, theme);

  if (lastMove) {
    const mover = board[lastMove.to.row][lastMove.to.col]; // 走后棋子在落点
    drawLastMove(ctx, lastMove, mover ? mover.color : 'red', theme);
  }

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (anim && anim.skip.row === r && anim.skip.col === c) continue; // 跳过飞行棋子的落点
      const p = board[r][c];
      if (p) drawPiece(ctx, { row: r, col: c }, p.type, p.color, theme);
    }
  }

  if (selected) drawSelection(ctx, selected, theme);
  for (const d of legalDests) {
    const capture = board[d.row][d.col] !== null;
    drawMoveHint(ctx, d, capture, theme);
  }

  if (bookHints.length) drawBookHints(ctx, bookHints);

  if (anim) drawPieceAt(ctx, anim.x, anim.y, anim.piece.type, anim.piece.color, theme); // 飞行棋子画最上层
}
