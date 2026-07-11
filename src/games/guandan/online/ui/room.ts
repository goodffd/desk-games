/**
 * room.ts — 联机房间页（等待开打，Plan 3 Task 9）。
 * 十字环桌：对门(上)/你(下)/上下家(左右)，中央房号(可复制)+开打。挑空位入座。
 * 纯渲染 + 回调，不碰 WS（控制器在回调里发 take-seat/start/leave）。
 */
import './lobby.css';
import type { SeatInfo } from '../protocol';
import type { Seat } from '../../engine/types';

export interface RoomState {
  seats: (SeatInfo | null)[];   // 4 座（服务端原座序）
  you: Seat | 'spectator' | null;
  isHost: boolean;
}
export interface RoomOpts {
  code: string;
  initial: RoomState;
  onTakeSeat: (seat: Seat) => void;
  onStart: () => void;
  onLeave: () => void;
}
export interface RoomHandle {
  update: (s: RoomState) => void;
  cleanup: () => void;
}

// 服务端座 → 十字格位（固定：座 0下/1右/2上/3左，所有人看到同一布局，不 egocentric）。
const POS_CLASS = ['gd-room__seat--bottom', 'gd-room__seat--right', 'gd-room__seat--top', 'gd-room__seat--left'];

export function renderRoom(root: HTMLElement, opts: RoomOpts): RoomHandle {
  root.innerHTML = '';
  const wrap = el('div', 'gd-lobby gd-lobby--page gd-room');

  // 顶栏：房号(可复制) + 离开
  const header = el('div', 'gd-lobby__header');
  const codeWrap = el('div', 'gd-room__codewrap');
  codeWrap.appendChild(text('span', 'gd-room__codelabel', '房号'));
  const codeEl = text('span', 'gd-room__code', opts.code);
  codeWrap.appendChild(codeEl);
  const copied = text('span', 'gd-room__copied', '已复制');
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
  header.appendChild(button('gd-lobby__btn--ghost gd-lobby__mini', '离开', opts.onLeave));
  wrap.appendChild(header);

  // 环桌
  const table = el('div', 'gd-room__table');
  const seatEls: HTMLElement[] = [];
  for (let i = 0; i < 4; i++) { const s = el('div', 'gd-room__seat'); table.appendChild(s); seatEls.push(s); }
  const center = el('div', 'gd-room__center');
  table.appendChild(center);
  wrap.appendChild(table);

  root.appendChild(wrap);

  function renderState(st: RoomState): void {
    // 房间页固定座位（不 egocentric）：座0=房主恒在底、1右/2上/3左，所有人看到同一布局，
    // 入座不翻转（避免「房主在底→自己跳到底」的晕）。你那座靠 is-you 高亮 +（你）标。
    for (let s = 0; s < 4; s++) {
      const serverSeat = s as Seat;
      const elx = seatEls[s]!;
      elx.className = `gd-room__seat ${POS_CLASS[serverSeat]} gd-room__seat--team${serverSeat % 2}`;
      elx.innerHTML = '';
      const info = st.seats[serverSeat] ?? null;
      const isYou = st.you === serverSeat;
      elx.appendChild(avatar(serverSeat % 2, !!info));
      if (info) {
        const name = text('div', 'gd-room__name', info.nick + (isYou ? '（你）' : ''));
        if (isYou) elx.classList.add('is-you');
        elx.appendChild(name);
      } else {
        const take = button('gd-lobby__btn--ghost gd-room__take', '＋ 入座', () => opts.onTakeSeat(serverSeat));
        elx.appendChild(take);
      }
    }
    // 中央：房号信息 + 开打/等待
    center.innerHTML = '';
    const filled = st.seats.filter(Boolean).length;
    center.appendChild(text('div', 'gd-room__center-count', `${filled} / 4 就座`));
    if (st.isHost) {
      const startBtn = button('gd-room__start', '开打', opts.onStart);
      startBtn.disabled = filled < 1; // ≥1 人(房主已坐)即可开打，空座由 AI 补
      center.appendChild(startBtn);
      if (filled < 4) center.appendChild(text('div', 'gd-room__hint', `空 ${4 - filled} 座将由 AI 补`));
    } else {
      center.appendChild(text('div', 'gd-room__hint', '等房主开打（空座由 AI 补）'));
    }
  }
  renderState(opts.initial);

  return { update: renderState, cleanup: (): void => { root.innerHTML = ''; } };
}

function avatar(team: number, filled: boolean): HTMLElement {
  const a = el('div', `gd-room__avatar gd-room__avatar--team${team}${filled ? '' : ' is-empty'}`);
  a.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<circle cx="12" cy="9" r="4.2" fill="currentColor"/>' +
    '<path d="M3.5 21 C3.5 14.8 8 13 12 13 C16 13 20.5 14.8 20.5 21 Z" fill="currentColor"/></svg>';
  return a;
}

function el(tag: string, cls: string): HTMLElement { const e = document.createElement(tag); e.className = cls; return e; }
function text(tag: string, cls: string, t: string): HTMLElement { const e = el(tag, cls); e.textContent = t; return e; }
function button(modifiers: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = ('gd-lobby__btn ' + modifiers).trim();
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
