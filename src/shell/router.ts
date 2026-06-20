import type { GameEntry } from './types';
import { renderHome } from './home';

export type ParsedRoute =
  | { view: 'home' }
  | { view: 'game'; id: string };

/**
 * 解析 location.pathname（真路径，不用 hash；与象棋 /xiangqi 一致）
 * '/' | '' → home
 * '/guandan' | '/guandan/' | '/guandan/xxx' → { view:'game', id:'guandan' }
 */
export function parsePath(pathname: string): ParsedRoute {
  const stripped = pathname.replace(/^\/+/, '').replace(/\/+$/, '').trim();
  if (!stripped) return { view: 'home' };
  const id = stripped.split('/')[0] || stripped; // 只取第一段
  return { view: 'game', id };
}

/**
 * 根据 pathname 渲染到 root，返回 cleanup 函数
 * - home：渲染首页列表
 * - game id（internal）：mount 游戏模块
 * - game id（external / 未知）：不在本 SPA 内路由，回退首页
 */
export function route(
  registry: GameEntry[],
  pathname: string,
  root: HTMLElement,
): () => void {
  const parsed = parsePath(pathname);

  if (parsed.view === 'home') {
    return renderHome(registry, root);
  }

  const entry = registry.find(e =>
    e.kind === 'internal' ? e.module.id === parsed.id : e.id === parsed.id,
  );

  if (!entry || entry.kind === 'external') {
    // 未知游戏 / 外链游戏（象棋由服务端 /xiangqi 直接服务）不在本 SPA 内路由，回退首页
    return renderHome(registry, root);
  }

  return entry.module.mount(root);
}
