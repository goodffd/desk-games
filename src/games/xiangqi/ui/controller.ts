import { Game } from '../engine/game';
import { pieceAt } from '../engine/board';
import { chooseMove } from '../engine/ai';
import type { AiLevel } from '../engine/ai';
import { squaresEqual } from '../engine/types';
import type { Board, Color, GameStatus, Move, Square } from '../engine/types';

/**
 * 交互状态机：持有 Game 与「选中格 / 合法目标」UI 状态，
 * 不依赖 DOM 或 Canvas，可独立单测。main.ts 只负责像素↔格映射与绘制。
 */
export class GameController {
  private game: Game;
  selected: Square | null = null;
  legalDests: Square[] = [];
  lastMove: Move | null = null; // 最近一步（起点/落点），供 UI 高亮
  lastCapture = false; // 最近一步是否吃子，供音效判断
  aiColor: Color | null = null; // null = 双人；否则电脑执该色
  aiLevel: AiLevel = 'easy'; // 电脑棋力档

  constructor(game?: Game) {
    this.game = game ?? new Game();
  }

  // 设置电脑执子方（null 关闭，回到双人）与棋力档
  setAi(color: Color | null, level: AiLevel = 'easy'): void {
    this.aiColor = color;
    this.aiLevel = level;
  }

  // 仅切换棋力档（保留人机/执子方设置）
  setLevel(level: AiLevel): void {
    this.aiLevel = level;
  }

  // 若轮到电脑且对局进行中，按棋力选着落子，返回所走着法；否则 null
  maybeAiMove(): Move | null {
    if (this.status !== 'playing') return null;
    if (this.aiColor === null || this.turn !== this.aiColor) return null;
    const m = chooseMove(this.board, this.turn, this.aiLevel);
    if (!m) return null;
    this.lastCapture = pieceAt(this.board, m.to) !== null;
    this.game.move(m);
    this.lastMove = m;
    this.clearSelection();
    return m;
  }

  get board(): Board {
    return this.game.board;
  }
  get turn(): Color {
    return this.game.turn;
  }
  get status(): GameStatus {
    return this.game.status;
  }

  // 点击某一交点。返回本次点击是否真正走了子。
  click(sq: Square): boolean {
    if (this.status !== 'playing') return false;

    // 已选中且点的是合法目标 → 走子
    if (this.selected && this.legalDests.some((d) => squaresEqual(d, sq))) {
      const from = this.selected;
      this.lastCapture = pieceAt(this.board, sq) !== null;
      const moved = this.game.move({ from, to: sq });
      if (moved) this.lastMove = { from, to: sq };
      this.clearSelection();
      return moved;
    }

    // 否则尝试（重新）选择己方棋子；点空格/对方子则取消选择
    const p = pieceAt(this.board, sq);
    if (p && p.color === this.turn) {
      this.selected = sq;
      this.legalDests = this.game.legalMoves(sq);
    } else {
      this.clearSelection();
    }
    return false;
  }

  // 应用一步外部（远端）着法，绕过本地选子/颜色校验（颜色由联机层保证）。
  applyExternalMove(m: Move): boolean {
    const willCapture = pieceAt(this.board, m.to) !== null; // 须在 move 前读，落点随后被走来的子占据
    const moved = this.game.move(m);
    if (moved) { this.lastMove = m; this.lastCapture = willCapture; } // 与 click/maybeAiMove 一致，供音效正确判断吃子
    this.clearSelection();
    return moved;
  }

  undo(): void {
    this.game.undo();
    this.lastMove = null;
    this.clearSelection();
  }

  reset(): void {
    this.game = new Game();
    this.lastMove = null;
    this.clearSelection();
  }

  // 供存档：取当前 Game
  getGame(): Game {
    return this.game;
  }

  // 供读档：换上一个 Game（来自 PGN 重放）
  loadGame(game: Game): void {
    this.game = game;
    this.lastMove = null;
    this.clearSelection();
  }

  private clearSelection(): void {
    this.selected = null;
    this.legalDests = [];
  }
}
