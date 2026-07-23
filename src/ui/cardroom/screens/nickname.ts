/**
 * nickname.ts — 出牌类联机昵称页（公共层）。
 * 绿毡金线品牌页 + 昵称输入。纯渲染 + 回调，不碰 WS（控制器在 onSubmit 里发 hello）。
 * 掼蛋与干瞪眼共用同一套；品牌/副标题/占位符经参数区分，默认值精确复现掼蛋。
 */
import './lobby.css';
import { el, text } from './types';

export interface NicknameOpts {
  /** 预填昵称（localStorage 记忆）。 */
  initial?: string;
  /** 品牌大标题，默认「掼蛋」。 */
  brand?: string;
  /** 副标题，默认「网络对战 · 4 人整盘」。 */
  subtitle?: string;
  /** 输入框占位符，默认「比如：阿东」。 */
  placeholder?: string;
  /** 点「进入大厅」/回车，昵称非空时回调。 */
  onSubmit: (nick: string) => void;
}

export interface NicknameHandle {
  /** 外部（控制器收到 nick-taken）调：显示错误 + 重新可输入。 */
  showError: (msg: string) => void;
  cleanup: () => void;
}

const MAX_NICK = 12;

export function renderNickname(root: HTMLElement, opts: NicknameOpts): NicknameHandle {
  root.innerHTML = '';
  const wrap = el('div', 'cr-lobby');

  const brand = el('div', 'cr-lobby__brand');
  brand.appendChild(text('div', 'cr-lobby__title', opts.brand ?? '掼蛋'));
  brand.appendChild(text('div', 'cr-lobby__subtitle', opts.subtitle ?? '网络对战 · 4 人整盘'));
  wrap.appendChild(brand);

  const card = el('div', 'cr-lobby__card');
  card.appendChild(text('div', 'cr-lobby__card-title', '取个名字，进大厅'));

  const field = el('div', 'cr-lobby__field');
  field.appendChild(text('label', 'cr-lobby__label', '昵称'));
  const input = document.createElement('input');
  input.className = 'cr-lobby__input';
  input.maxLength = MAX_NICK;
  input.placeholder = opts.placeholder ?? '比如：阿东';
  input.value = (opts.initial ?? '').slice(0, MAX_NICK);
  input.autocomplete = 'off';
  field.appendChild(input);
  card.appendChild(field);

  const err = el('div', 'cr-lobby__err');
  card.appendChild(err);

  const btn = document.createElement('button');
  btn.className = 'cr-lobby__btn';
  btn.textContent = '进入大厅';
  card.appendChild(btn);
  wrap.appendChild(card);

  const submit = (): void => {
    const nick = input.value.trim();
    if (!nick) { err.textContent = '请输入昵称'; input.focus(); return; }
    err.textContent = '';
    opts.onSubmit(nick);
  };
  btn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  input.addEventListener('input', () => { if (err.textContent) err.textContent = ''; });

  root.appendChild(wrap);
  setTimeout(() => input.focus(), 0);

  return {
    showError: (msg: string): void => { err.textContent = msg; input.focus(); input.select(); },
    cleanup: (): void => { root.innerHTML = ''; },
  };
}
