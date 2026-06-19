/**
 * 掼蛋游戏模块入口
 * 导出 guandanModule: GameModule（接入壳 registry）
 */

import type { GameModule } from '../../shell/types';
import { mount } from './ui/view';

export const guandanModule: GameModule = {
  id: 'guandan',
  name: '掼蛋',
  desc: '升级类扑克，2v2 四人局，1 人类对 3 AI，固定打 2',
  mount,
};
