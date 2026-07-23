/**
 * room.ts — 出牌类联机房间页（等待开打，公共层）。
 * 十字环桌：座 0（房主）恒在底，其余按座数分居四周；中央房号(可复制)+开打。挑空位入座。
 * **不 egocentric**：所有人看到同一布局（座 0 在底），入座不翻转——房间页有意如此。
 * 纯渲染 + 回调，不碰 WS（控制器在回调里发 take-seat/start/leave）。
 *
 * 座数→格位查表：n=4 恰好复现掼蛋的 下/右/上/左（POS_CLASS），故掼蛋像素零回归；
 * n=2/3/5 用同一 3×3 网格的其余格位（含角落格，掼蛋从不落到那里）。
 */
import './lobby.css';
import { el, text, button, type RoomState } from './types';

/** 座 i（服务端原座序，非 egocentric）→ 3×3 网格格位类后缀。座 0 恒在底。 */
const LAYOUTS: Record<number, string[]> = {
  2: ['bottom', 'top'],
  3: ['bottom', 'right', 'left'],
  4: ['bottom', 'right', 'top', 'left'],        // 掼蛋：与旧 POS_CLASS 逐项一致
  5: ['bottom', 'right', 'tr', 'tl', 'left'],
};

export interface RoomOpts {
  code: string;
  initial: RoomState;
  /** 座位总数（掼蛋 4；干瞪眼 2-5）。 */
  seatCount: number;
  /** 队色：掼蛋 true（座%2 分金/蓝）；干瞪眼 false（全金，无队）。默认 false。 */
  teams?: boolean;
  onTakeSeat: (seat: number) => void;
  onStart: () => void;
  onLeave: () => void;
}
export interface RoomHandle {
  update: (s: RoomState) => void;
  cleanup: () => void;
}

export function renderRoom(root: HTMLElement, opts: RoomOpts): RoomHandle {
  root.innerHTML = '';
  const n = opts.seatCount;
  const teams = opts.teams ?? false;
  const cells = LAYOUTS[n] ?? LAYOUTS[4]!;
  const wrap = el('div', 'cr-lobby cr-lobby--page cr-room');

  // 顶栏：房号(可复制) + 离开
  const header = el('div', 'cr-lobby__header');
  const codeWrap = el('div', 'cr-room__codewrap');
  codeWrap.appendChild(text('span', 'cr-room__codelabel', '房号'));
  codeWrap.appendChild(text('span', 'cr-room__code', opts.code));
  const copied = text('span', 'cr-room__copied', '已复制');
  copied.style.opacity = '0';
  codeWrap.appendChild(copied);
  codeWrap.title = '点击复制房号';
  codeWrap.addEventListener('click', () => {
    void navigator.clipboard?.writeText(opts.code).then(() => {
      copied.style.opacity = '1';
      window.setTimeout(() => { copied.style.opacity = '0'; }, 1200);
    }).catch(() => { /* 不支持剪贴板：静默 */ });
  });
  header.appendChild(codeWrap);
  header.appendChild(button('cr-lobby__btn--ghost cr-lobby__mini', '离开', opts.onLeave));
  wrap.appendChild(header);

  // 环桌
  const table = el('div', 'cr-room__table');
  const seatEls: HTMLElement[] = [];
  for (let i = 0; i < n; i++) { const s = el('div', 'cr-room__seat'); table.appendChild(s); seatEls.push(s); }
  const center = el('div', 'cr-room__center');
  table.appendChild(center);
  wrap.appendChild(table);

  root.appendChild(wrap);

  function renderState(st: RoomState): void {
    for (let s = 0; s < n; s++) {
      const elx = seatEls[s]!;
      const teamCls = teams ? ` cr-room__seat--team${s % 2}` : '';
      elx.className = `cr-room__seat cr-room__seat--${cells[s]}${teamCls}`;
      elx.innerHTML = '';
      const info = st.seats[s] ?? null;
      const isYou = st.you === s;
      elx.appendChild(avatar(teams ? s % 2 : 0, !!info));
      if (info) {
        elx.appendChild(text('div', 'cr-room__name', (info.nick ?? '玩家') + (isYou ? '（你）' : '')));
        if (isYou) elx.classList.add('is-you');
      } else {
        elx.appendChild(button('cr-lobby__btn--ghost cr-room__take', '＋ 入座', () => opts.onTakeSeat(s)));
      }
    }
    // 中央：就座数 + 开打/等待
    center.innerHTML = '';
    const filled = st.seats.filter(Boolean).length;
    center.appendChild(text('div', 'cr-room__center-count', `${filled} / ${n} 就座`));
    if (st.isHost) {
      const startBtn = button('cr-room__start', '开打', opts.onStart);
      startBtn.disabled = filled < 1; // ≥1 人(房主已坐)即可开打，空座由 AI 补
      center.appendChild(startBtn);
      if (filled < n) center.appendChild(text('div', 'cr-room__hint', `空 ${n - filled} 座将由 AI 补`));
    } else {
      center.appendChild(text('div', 'cr-room__hint', '等房主开打（空座由 AI 补）'));
    }
  }
  renderState(opts.initial);

  return { update: renderState, cleanup: (): void => { root.innerHTML = ''; } };
}

function avatar(team: number, filled: boolean): HTMLElement {
  const a = el('div', `cr-room__avatar cr-room__avatar--team${team}${filled ? '' : ' is-empty'}`);
  a.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<circle cx="12" cy="9" r="4.2" fill="currentColor"/>' +
    '<path d="M3.5 21 C3.5 14.8 8 13 12 13 C16 13 20.5 14.8 20.5 21 Z" fill="currentColor"/></svg>';
  return a;
}
