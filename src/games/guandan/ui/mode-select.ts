/**
 * mode-select.ts — 掼蛋模式选择页（正门入口）。
 * 进入 /guandan 先到这：并排两模式——「单机对战」(联机 1人 + 3 AI，即点即玩) ｜
 * 「4 人联机」(建房/匹配真人 2v2)。纯渲染 + 回调，不碰引擎/WS：控制器(index.ts)
 * 在回调里走单机(联机 1人+3AI)或联机流。复用联机前置页的绿毡金线品牌视觉(lobby.css)，
 * 两模式并排布局见 mode-select.css。
 */
import '../online/ui/lobby.css';
import './mode-select.css';

export interface ModeSelectOpts {
  /** 选「单机对战」。 */
  onSingle: () => void;
  /** 选「4 人联机」。 */
  onOnline: () => void;
}

export function renderModeSelect(root: HTMLElement, opts: ModeSelectOpts): () => void {
  root.innerHTML = '';
  const wrap = el('div', 'gd-lobby');

  const brand = el('div', 'gd-lobby__brand');
  brand.appendChild(text('div', 'gd-lobby__title', '掼蛋'));
  brand.appendChild(text('div', 'gd-lobby__subtitle', '升级类扑克 · 2v2 四人局'));
  wrap.appendChild(brand);

  const modes = el('div', 'gd-modes');
  modes.appendChild(makeMode('单机对战', '你 + 3 位 AI · 即点即玩', opts.onSingle));
  modes.appendChild(makeMode('4 人联机', '建房或匹配 · 真人 2v2', opts.onOnline));
  wrap.appendChild(modes);

  root.appendChild(wrap);
  return (): void => { root.innerHTML = ''; };
}

function makeMode(title: string, subtitle: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'gd-mode';
  b.type = 'button';
  b.appendChild(text('div', 'gd-mode__title', title));
  b.appendChild(text('div', 'gd-mode__subtitle', subtitle));
  b.addEventListener('click', onClick);
  return b;
}

function el(tag: string, cls: string): HTMLElement { const e = document.createElement(tag); e.className = cls; return e; }
function text(tag: string, cls: string, t: string): HTMLElement { const e = el(tag, cls); e.textContent = t; return e; }
