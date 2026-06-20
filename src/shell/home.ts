import type { GameEntry } from './types';
import { navigate } from './nav';

/**
 * 渲染首页游戏列表到 root，返回 cleanup 函数
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
    const card = document.createElement('div');
    card.className = 'game-card';

    const name = document.createElement('h2');
    name.className = 'game-card__name';
    name.textContent = entry.kind === 'internal' ? entry.module.name : entry.name;

    const desc = document.createElement('p');
    desc.className = 'game-card__desc';
    desc.textContent = entry.kind === 'internal' ? entry.module.desc : entry.desc;

    card.appendChild(name);
    card.appendChild(desc);

    if (entry.kind === 'internal') {
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.dataset['gameId'] = entry.module.id;
      const id = entry.module.id;
      const onClick = () => {
        navigate(`/${id}`);
      };
      const onKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') onClick();
      };
      card.addEventListener('click', onClick);
      card.addEventListener('keydown', onKeydown);
    } else {
      const anchor = document.createElement('a');
      anchor.href = entry.url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.className = 'game-card__link';
      anchor.textContent = '前往 →';
      card.appendChild(anchor);
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
