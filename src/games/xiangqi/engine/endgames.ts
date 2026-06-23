import type { Board, Color } from './types';
import { opponent } from './types';
import { applyMove } from './game';
import { chineseToMove } from './notation';
import { fromFen } from './fen';

export interface Endgame {
  id: string;
  name: string;
  fen: string; // A1 通行象棋 FEN（FEN 由摆子经 toFen 生成、isInCheck 核验起始安静）
  goal: '红胜' | '和';
  solution: string[]; // 中文记谱，从 fen 局面起；合法性由 tests/endgames.test.ts 兜底
}

// 6 个实用短残局。解法为示意主线（短小合法），实战可在「打这盘」自行延展。
export const ENDGAMES: Endgame[] = [
  {
    id: 'che-shi',
    name: '单车巧胜单士',
    fen: '4k4/4a4/9/9/9/R8/9/9/9/4K4 w',
    goal: '红胜',
    solution: ['车九进五', '将5平4'],
  },
  {
    id: 'shuangche-shi',
    name: '双车胜单士',
    fen: '4k4/4a4/9/9/9/2R3R2/9/9/9/4K4 w',
    goal: '红胜',
    solution: ['车七进五', '将5平4'],
  },
  {
    id: 'paobing-shi',
    name: '炮兵胜单士',
    fen: '3ak4/9/4C4/3P5/9/9/9/9/9/4K4 w',
    goal: '红胜',
    solution: ['兵六进一', '士6进5'],
  },
  {
    id: 'mapao-shixiang',
    name: '马炮胜士象',
    fen: '3ak4/9/2b1N4/9/9/6C2/9/9/9/4K4 w',
    goal: '红胜',
    solution: ['马五进七', '将5平4'],
  },
  {
    id: 'che-dibing-he',
    name: '车低兵难胜士象全（和）',
    fen: '3aka3/9/2b1P1b2/9/9/3R5/9/9/9/4K4 w',
    goal: '和',
    solution: ['兵五平四', '士4进5'],
  },
  {
    id: 'mabing-shixiang',
    name: '马双兵胜士象',
    fen: '2bak4/9/4N4/3P1P3/9/9/9/9/9/4K4 w',
    goal: '红胜',
    solution: ['马五进七', '将5平4'],
  },
];

// 线性步进器：从残局 FEN 起逐手走解法（无分支），纯逻辑可单测
export class EndgameLine {
  private idx = 0;
  constructor(public readonly eg: Endgame) {}

  // 当前局面（从 FEN 起重放已走解法手）
  position(): { board: Board; turn: Color } {
    const start = fromFen(this.eg.fen);
    let board: Board = start.board;
    let turn: Color = start.turn;
    for (let i = 0; i < this.idx; i++) {
      const m = chineseToMove(board, turn, this.eg.solution[i]);
      board = applyMove(board, m);
      turn = opponent(turn);
    }
    return { board, turn };
  }

  moves(): string[] { return this.eg.solution.slice(0, this.idx); }
  canNext(): boolean { return this.idx < this.eg.solution.length; }
  canPrev(): boolean { return this.idx > 0; }
  next(): void { if (this.canNext()) this.idx++; }
  prev(): void { if (this.canPrev()) this.idx--; }
  reset(): void { this.idx = 0; }
}
