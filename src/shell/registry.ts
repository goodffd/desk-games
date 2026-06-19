import type { GameEntry } from './types';
import { guandanModule } from '../games/guandan/index';

/**
 * 构建游戏注册表
 * @param xiangqiUrl 象棋外链，由调用方注入（main.ts 负责 try/catch 读 links.ts）
 */
export function buildRegistry(xiangqiUrl: string = '#'): GameEntry[] {
  return [
    { kind: 'internal', module: guandanModule },
    {
      kind: 'external',
      id: 'xiangqi',
      name: '象棋',
      desc: '中国象棋，点击前往在线对局',
      url: xiangqiUrl,
    },
  ];
}
