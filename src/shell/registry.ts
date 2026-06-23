import type { GameEntry } from './types';
import { guandanModule } from '../games/guandan/index';
import { xiangqiModule } from '../games/xiangqi/index';

/** 构建游戏注册表（全内置模块） */
export function buildRegistry(): GameEntry[] {
  return [
    { kind: 'internal', module: guandanModule },
    { kind: 'internal', module: xiangqiModule },
  ];
}
