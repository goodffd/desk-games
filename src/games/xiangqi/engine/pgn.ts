import type { GameStatus } from './types';
import { Game, applyMove } from './game';
import { toFen, fromFen } from './fen';
import { moveToIccs, iccsToMove, moveToChinese } from './notation';
import { initialBoard, cloneBoard } from './board';

export interface GameMeta {
  event?: string;
  date?: string;
  red?: string;
  black?: string;
}

function resultTag(status: GameStatus): string {
  return status === 'red_win' ? '1-0'
    : status === 'black_win' ? '0-1'
    : status === 'draw' ? '1/2-1/2'
    : '*';
}

// Game → PGN 式文本
export function gameToPgn(game: Game, meta: GameMeta = {}): string {
  const start = game.startPosition;
  const moves = game.getMoves();
  const lines: string[] = [];
  // 假设 meta 字段不含 " 或 ]（本地单用户场景，UI 控制输入）；不做转义。
  lines.push(`[Event "${meta.event ?? '中国象棋对局'}"]`);
  if (meta.date) lines.push(`[Date "${meta.date}"]`);
  lines.push(`[Red "${meta.red ?? '红方'}"]`);
  lines.push(`[Black "${meta.black ?? '黑方'}"]`);
  lines.push(`[Result "${resultTag(game.status)}"]`);

  const startFen = toFen(start.board, start.turn);
  if (startFen !== toFen(initialBoard(), 'red')) lines.push(`[FEN "${startFen}"]`);
  lines.push('');

  let board = cloneBoard(start.board);
  const tokens: string[] = [];
  for (let i = 0; i < moves.length; i++) {
    if (i % 2 === 0) tokens.push(`${i / 2 + 1}.`);
    tokens.push(`${moveToIccs(moves[i])} {${moveToChinese(board, moves[i])}}`);
    board = applyMove(board, moves[i]);
  }
  tokens.push(resultTag(game.status));
  lines.push(tokens.join(' '));
  return lines.join('\n');
}

// 注意：遇到非法/无法重放的着法会抛错（fail-loud）。调用方需自行 try/catch
//（UI 导入处即如此）。残局库等外部来源的容错加载由其自身定义，不在此兜底。
// PGN 式文本 → Game（读 FEN + ICCS 逐手重放）
export function pgnToGame(text: string): Game {
  const fenMatch = /\[FEN\s+"([^"]+)"\]/.exec(text);
  let game: Game;
  if (fenMatch) {
    const { board, turn } = fromFen(fenMatch[1]);
    game = Game.fromPosition(board, turn);
  } else {
    game = new Game();
  }
  const cleaned = text
    .replace(/\[[^\]]*\]/g, ' ') // 去 tag
    .replace(/\{[^}]*\}/g, ' ')  // 去中文注释
    .replace(/(1-0|0-1|1\/2-1\/2|\*)/g, ' ') // 去结果
    .replace(/\d+\./g, ' ');     // 去回合号
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  for (const tk of tokens) {
    if (!/^[a-i]\d-[a-i]\d$/.test(tk)) continue;
    if (!game.move(iccsToMove(tk))) throw new Error('PGN 重放遇非法着法: ' + tk);
  }
  return game;
}
