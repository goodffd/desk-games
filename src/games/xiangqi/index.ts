import type { GameModule } from '../../shell/types';
import { mountXiangqi } from './ui/main';

export const xiangqiModule: GameModule = {
  id: 'xiangqi',
  name: '象棋',
  desc: '中国象棋，2 人联机对弈 / 单机对 AI',
  mount: mountXiangqi,
};
