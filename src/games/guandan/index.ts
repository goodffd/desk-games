/**
 * 掼蛋游戏模块入口（控制器）
 * 导出 guandanModule: GameModule（接入壳 registry）。
 *
 * 路由分流（SPEC：正常=联机、本地对 AI=调试）：
 *  - `/guandan?debug` → 本地对 3 AI（LocalDriver，开发不起服务端就能调引擎/UI）。
 *  - `/guandan`（正常）→ 联机流（昵称→大厅→建房/匹配→OnlineDriver 牌桌）。**Task 10 接入**。
 */

import type { GameModule } from '../../shell/types';
import { LocalDriver } from './driver/local-driver';
import { mountTable, speechBusyMs } from './ui/view';

function mount(root: HTMLElement): () => void {
  // Task 6：先打通 ?debug 本地通路（注入 view 的 speechBusyMs，让 AI 等报牌播完）。
  // 正常联机流在 Task 10 接入；本任务两条路径暂都走本地 LocalDriver，保证可运行。
  const driver = new LocalDriver({ speechBusyMs });
  return mountTable(root, driver);
}

export const guandanModule: GameModule = {
  id: 'guandan',
  name: '掼蛋',
  desc: '升级类扑克，2v2 四人局，1 人类对 3 AI，固定打 2',
  mount,
};
