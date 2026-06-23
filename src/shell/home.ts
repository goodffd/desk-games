import type { GameEntry } from './types';
import { navigate } from './nav';

/**
 * 渲染首页游戏列表到 root，返回 cleanup 函数。
 * 两类卡片交互一致：**整张卡片可点**进入。
 * - 内置游戏：div + click → SPA navigate(/id)
 * - 外链游戏：整卡就是 <a href>，同标签页进入
 */
export function renderHome(registry: GameEntry[], root: HTMLElement): () => void {
  root.innerHTML = '';

  const container = document.createElement('div');
  container.className = 'home';

  const title = document.createElement('h1');
  title.className = 'home__title';
  title.textContent = '游戏厅';
  container.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'home__grid';

  for (const entry of registry) {
    const isInternal = entry.kind === 'internal';
    const card: HTMLElement = document.createElement(isInternal ? 'div' : 'a');
    card.className = 'game-card';

    const name = document.createElement('h2');
    name.className = 'game-card__name';
    name.textContent = isInternal ? entry.module.name : entry.name;

    const desc = document.createElement('p');
    desc.className = 'game-card__desc';
    desc.textContent = isInternal ? entry.module.desc : entry.desc;

    card.appendChild(name);
    card.appendChild(desc);

    if (isInternal) {
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.dataset['gameId'] = entry.module.id;
      const id = entry.module.id;
      const onClick = () => navigate(`/${id}`);
      const onKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
      };
      card.addEventListener('click', onClick);
      card.addEventListener('keydown', onKeydown);
    } else {
      // 整张卡片即链接：同标签页进入外链游戏
      (card as HTMLAnchorElement).href = entry.url;
      card.dataset['gameId'] = entry.id;
    }

    grid.appendChild(card);
  }

  container.appendChild(grid);
  root.appendChild(container);

  return () => {
    root.innerHTML = '';
  };
}
