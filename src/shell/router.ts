import type { GameEntry } from './types';
import { renderHome } from './home';

export type ParsedHash =
  | { view: 'home' }
  | { view: 'game'; id: string };

/**
 * 解析 location.hash 字符串
 * '' | '#' | '#/' | '/' → home
 * '#/guandan' → { view:'game', id:'guandan' }
 */
export function parseHash(hash: string): ParsedHash {
  // 去掉前导 # 和 /
  const stripped = hash.replace(/^#?\/?/, '').trim();
  if (!stripped) return { view: 'home' };
  return { view: 'game', id: stripped };
}

/**
 * 根据 hash 渲染到 root，返回 cleanup 函数
 * - home：渲染首页列表
 * - game id（internal）：mount 游戏模块
 * - game id（external）：不在 SPA 内路由，回退首页
 */
export function route(
  registry: GameEntry[],
  hash: string,
  root: HTMLElement,
): () => void {
  const parsed = parseHash(hash);

  if (parsed.view === 'home') {
    return renderHome(registry, root);
  }

  // 查找对应 entry
  const entry = registry.find(e =>
    e.kind === 'internal' ? e.module.id === parsed.id : e.id === parsed.id,
  );

  if (!entry) {
    // 找不到对应游戏，渲染首页作为兜底
    return renderHome(registry, root);
  }

  if (entry.kind === 'external') {
    // 外链游戏不在 SPA 内路由，渲染首页
    return renderHome(registry, root);
  }

  // internal：mount 游戏
  return entry.module.mount(root);
}
