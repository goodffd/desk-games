/**
 * rules.ts — 规则介绍弹层（公共层，掼蛋 + 干瞪眼共用）。
 * 绿毡金线卡片，分节列玩法/牌型/机制/结算；X / 点外 / Esc 关闭。
 * 内容由各游戏传 RulesDoc（各游戏各写各的，见 games/<name>/rules.ts）；组件只管渲染，不认识任何规则。
 */
import './rules.css';
import { el, text } from './types';

/** 一行规则：k=加粗术语（可选，如「炸弹」），v=说明。只有 v = 普通条目。 */
export interface RulesRow { k?: string; v: string }
export interface RulesSection { h: string; rows: RulesRow[] }
export interface RulesDoc {
  /** 一句话概览，置顶。 */
  tagline?: string;
  sections: RulesSection[];
}

/** 打开规则弹层。追加到 document.body（覆盖全屏），关闭即移除。 */
export function showRules(brand: string, doc: RulesDoc): void {
  const overlay = el('div', 'cr-rules');
  const panel = el('div', 'cr-rules__panel');

  const head = el('div', 'cr-rules__head');
  head.appendChild(text('div', 'cr-rules__title', `${brand} · 规则`));
  const close = document.createElement('button');
  close.className = 'cr-rules__close';
  close.type = 'button';
  close.setAttribute('aria-label', '关闭');
  close.textContent = '×';
  head.appendChild(close);
  panel.appendChild(head);

  const body = el('div', 'cr-rules__body');
  if (doc.tagline) body.appendChild(text('div', 'cr-rules__tagline', doc.tagline));
  for (const sec of doc.sections) {
    const s = el('section', 'cr-rules__sec');
    s.appendChild(text('h3', 'cr-rules__h', sec.h));
    const rows = el('div', 'cr-rules__rows');
    for (const row of sec.rows) {
      const r = el('div', 'cr-rules__row');
      if (row.k) r.appendChild(text('span', 'cr-rules__k', row.k));
      r.appendChild(text('span', 'cr-rules__v', row.v));
      rows.appendChild(r);
    }
    s.appendChild(rows);
    body.appendChild(s);
  }
  panel.appendChild(body);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  const dispose = (): void => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') dispose(); };
  close.addEventListener('click', dispose);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dispose(); });   // 点卡片外的遮罩关闭
  document.addEventListener('keydown', onKey);
}

/** 造一个「规则介绍」触发按钮，点开弹层。 */
export function rulesLink(brand: string, doc: RulesDoc): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'cr-rules-link';
  b.type = 'button';
  b.textContent = '📖 规则介绍';
  b.addEventListener('click', () => showRules(brand, doc));
  return b;
}
