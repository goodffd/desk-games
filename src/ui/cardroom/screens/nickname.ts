/**
 * nickname.ts — 出牌类联机昵称页（公共层）。
 * 绿毡金线品牌页 + 昵称输入。纯渲染 + 回调，不碰 WS（控制器在 onSubmit 里发 hello）。
 * 掼蛋与干瞪眼共用同一套；品牌/副标题/占位符经参数区分，默认值精确复现掼蛋。
 */
import './lobby.css';
import { el, text } from './types';
import { rulesLink, type RulesDoc } from './rules';

export interface NicknameOpts {
  /** 预填昵称（localStorage 记忆）。 */
  initial?: string;
  /** 品牌大标题，默认「掼蛋」。 */
  brand?: string;
  /** 副标题，默认「网络对战 · 4 人整盘」。 */
  subtitle?: string;
  /** 输入框占位符，默认「比如：阿东」。 */
  placeholder?: string;
  /** 规则介绍：传了就在卡片下显示「📖 规则介绍」链接，点开弹层。 */
  rules?: RulesDoc;
  /**
   * 传了就在左上角渲染「← 返回游戏厅」，点了回调（控制器走 navigate('/')）。
   * 昵称页是壳内 mount 的第一屏，没有浏览器后退入口，不给出口人就退不出去。
   */
  onBack?: () => void;
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

  // 卡片下方一行次要动作：「📖 规则介绍 · ← 返回游戏厅」。
  // 由左到右是承诺递减（了解 → 离开）；放这儿而不是左上角，是因为手机上左上角单手够不着，
  // 而这一屏是表单页，返回不是打到一半要跑的高频退出，落在拇指自然区更合适。
  // 返回键写「游戏厅」不写「大厅」：同屏主按钮「进入大厅」进的是本游戏的联机大厅，两个「大厅」会打架。
  const actions = el('div', 'cr-lobby__actions');
  if (opts.rules) actions.appendChild(rulesLink(opts.brand ?? '掼蛋', opts.rules));
  if (opts.rules && opts.onBack) actions.appendChild(text('span', 'cr-lobby__actions-sep', '·'));
  if (opts.onBack) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'cr-lobby__back';
    back.appendChild(text('span', 'cr-lobby__back-arrow', '←'));
    back.appendChild(text('span', 'cr-lobby__back-label', '返回游戏厅'));
    back.addEventListener('click', opts.onBack);
    actions.appendChild(back);
  }
  if (actions.childElementCount) wrap.appendChild(actions);

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
