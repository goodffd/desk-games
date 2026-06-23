import type { Board, Color } from './types';
import { opponent } from './types';
import { initialBoard } from './board';
import { applyMove } from './game';
import { chineseToMove } from './notation';
import type { BookNode, Opening } from './openings';

// 纯逻辑：沿一棵开局谱树前进/后退，按需选变着。无 DOM，可单测。
export class BrowseSession {
  private path: BookNode[] = [];
  constructor(public readonly opening: Opening) {}

  // 当前局面（从初始重放 path）
  position(): { board: Board; turn: Color } {
    let board = initialBoard();
    let turn: Color = 'red';
    for (const node of this.path) {
      const m = chineseToMove(board, turn, node.zh);
      board = applyMove(board, m);
      turn = opponent(turn);
    }
    return { board, turn };
  }

  moves(): string[] {
    return this.path.map((n) => n.zh);
  }

  // 可前进的分支：当前节点的 children（path 空时为 roots）
  frontier(): BookNode[] {
    return this.path.length === 0 ? this.opening.roots : this.path[this.path.length - 1].children;
  }

  canNext(): boolean { return this.frontier().length > 0; }
  canPrev(): boolean { return this.path.length > 0; }

  next(childIdx = 0): void {
    const f = this.frontier();
    if (f[childIdx]) this.path.push(f[childIdx]);
  }
  prev(): void { this.path.pop(); }
  reset(): void { this.path = []; }
}
