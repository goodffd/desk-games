import type { Board, Color, Move } from './types';
import { opponent } from './types';
import { initialBoard } from './board';
import { applyMove } from './game';
import { chineseToMove } from './notation';
import { toFen } from './fen';

export interface BookNode { zh: string; comment?: string; children: BookNode[]; }
export interface Opening { id: string; name: string; roots: BookNode[]; }

export interface BookEntry { moves: { move: Move; zh: string }[]; openings: string[]; }
export type BookIndex = Map<string, BookEntry>;

// 10 套主流开局，含变着。每条谱线手写中文记谱（红汉字 / 黑 ASCII 数字），过引擎重放校验合法性。
export const OPENINGS: Opening[] = [
  {
    id: 'zhongpao-pingfengma',
    name: '中炮对屏风马',
    roots: [
      { zh: '炮二平五', children: [
        { zh: '马8进7', children: [
          { zh: '马二进三', children: [
            { zh: '车9平8', comment: '屏风马正变', children: [] },
            { zh: '卒3进1', comment: '挺三卒变', children: [] },
          ] },
        ] },
      ] },
    ],
  },
  {
    id: 'xianrenzhilu',
    name: '仙人指路',
    roots: [
      { zh: '兵七进一', children: [
        { zh: '卒7进1', comment: '对兵局', children: [] },
        { zh: '炮2平3', comment: '卒底炮', children: [] },
        { zh: '马8进7', children: [] },
      ] },
    ],
  },
  {
    id: 'shunpao',
    name: '顺炮',
    roots: [
      { zh: '炮二平五', children: [
        { zh: '炮8平5', comment: '顺手炮', children: [
          { zh: '马二进三', children: [
            { zh: '马8进7', children: [] },
          ] },
        ] },
      ] },
    ],
  },
  {
    id: 'liepao',
    name: '列炮',
    roots: [
      { zh: '炮二平五', children: [
        { zh: '炮2平5', comment: '逆手炮（列炮）', children: [
          { zh: '马二进三', children: [
            { zh: '马2进3', children: [] },
          ] },
        ] },
      ] },
    ],
  },
  {
    id: 'zhongpao-fangongma',
    name: '中炮对反宫马',
    roots: [
      { zh: '炮二平五', children: [
        { zh: '马2进3', children: [
          { zh: '马二进三', children: [
            { zh: '炮8平6', comment: '反宫马', children: [] },
          ] },
        ] },
      ] },
    ],
  },
  {
    id: 'feixiang',
    name: '飞相局',
    roots: [
      { zh: '相三进五', children: [
        { zh: '炮8平5', comment: '左中炮反击', children: [] },
        { zh: '卒3进1', children: [] },
      ] },
    ],
  },
  {
    id: 'qima',
    name: '起马局',
    roots: [
      { zh: '马二进三', children: [
        { zh: '卒3进1', children: [] },
        { zh: '马8进7', children: [] },
      ] },
    ],
  },
  {
    id: 'guogongpao',
    name: '过宫炮',
    roots: [
      { zh: '炮二平六', children: [
        { zh: '马8进7', children: [] },
      ] },
    ],
  },
  {
    id: 'shijiaopao',
    name: '仕角炮',
    roots: [
      { zh: '炮二平四', children: [
        { zh: '马8进7', children: [] },
      ] },
    ],
  },
  {
    id: 'tingsanbing',
    name: '挺三兵',
    roots: [
      { zh: '兵三进一', children: [
        { zh: '卒3进1', children: [] },
      ] },
    ],
  },
];

function walk(board: Board, turn: Color, nodes: BookNode[], name: string, index: BookIndex): void {
  for (const node of nodes) {
    const move = chineseToMove(board, turn, node.zh); // 非法/无法解析 → 抛错（测试捕获）
    const key = toFen(board, turn);
    let entry = index.get(key);
    if (!entry) { entry = { moves: [], openings: [] }; index.set(key, entry); }
    if (!entry.moves.some((m) => m.zh === node.zh)) entry.moves.push({ move, zh: node.zh });
    if (!entry.openings.includes(name)) entry.openings.push(name);
    walk(applyMove(board, move), opponent(turn), node.children, name, index);
  }
}

// 重放全书构建 FEN→续着索引（异途同归自动按 FEN 合并）
export function buildBookIndex(): BookIndex {
  const index: BookIndex = new Map();
  for (const op of OPENINGS) walk(initialBoard(), 'red', op.roots, op.name, index);
  return index;
}

// 当前局面 → 续着+开局名；不在书内返回 null（出谱）
export function lookupBook(index: BookIndex, board: Board, turn: Color): BookEntry | null {
  return index.get(toFen(board, turn)) ?? null;
}
