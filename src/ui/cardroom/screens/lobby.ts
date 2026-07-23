/**
 * lobby.ts — 出牌类联机大厅页（公共层）。
 * 横屏优先：顶栏(品牌+你好) + 左「开局」(建房/[匹配]) + 右「大厅」(公开房列表/观战)。
 * 纯渲染 + 回调，不碰 WS。掼蛋与干瞪眼共用：
 *   - seatChoice 传了才渲染座位数分段器（干瞪眼 [2,3,4,5]）；不传=不渲染，掼蛋 DOM 零变化。
 *   - onMatch 传了才渲染「随机匹配」（掼蛋有；干瞪眼 v1 无——maxSeats=5 会死等，另开票）。
 *   - onCreate 收对象 { isPrivate?, seats? }，同时承载掼蛋的私密位与干瞪眼的座位数。
 */
import './lobby.css';
import { el, text, button, type LobbyRoom } from './types';

export interface LobbyOpts {
  nick: string;
  rooms?: LobbyRoom[];
  /** 顶栏品牌，默认「掼蛋」。 */
  brand?: string;
  onCreate: (o: { isPrivate?: boolean; seats?: number }) => void;
  /** 传了才渲染「随机匹配」按钮与等待态。 */
  onMatch?: () => void;
  /** 「匹配中…等待凑齐 N 人」的 N，默认 4。 */
  matchSeats?: number;
  /** 传了才渲染座位数分段器（如 [2,3,4,5]）。 */
  seatChoice?: number[];
  /** 分段器初始选中，默认取 seatChoice[0]。 */
  defaultSeats?: number;
  /** 建房按钮文案，默认「建房邀请」。 */
  createLabel?: string;
  /** 分段器下方的小字说明（如「真人没凑齐也能开打，空座补 AI」）。 */
  seatNote?: string;
  onSpectate: (code: string) => void;
  onJoin: (code: string) => void;
  onRefresh: () => void;
}

export interface LobbyHandle {
  update: (rooms: LobbyRoom[]) => void;
  setMatching: (on: boolean) => void;   // 匹配中：禁用按钮 + 显等待态（无 onMatch 时为空操作）
  cleanup: () => void;
}

export function renderLobby(root: HTMLElement, opts: LobbyOpts): LobbyHandle {
  root.innerHTML = '';
  const wrap = el('div', 'cr-lobby cr-lobby--page');

  const header = el('div', 'cr-lobby__header');
  header.appendChild(text('span', 'cr-lobby__brand-sm', opts.brand ?? '掼蛋'));
  header.appendChild(text('span', 'cr-lobby__hello', `你好，${opts.nick}`));
  wrap.appendChild(header);

  const cols = el('div', 'cr-lobby__cols');

  // 左：开局
  const left = el('div', 'cr-lobby__panel');
  left.appendChild(text('div', 'cr-lobby__panel-title', '开始一局'));

  // 座位数分段器（可选）——传了才渲染，掼蛋不传，此块整体不出现
  let selectedSeats = opts.defaultSeats ?? opts.seatChoice?.[0];
  if (opts.seatChoice && opts.seatChoice.length) {
    const seg = el('div', 'cr-lobby__seatchoice');
    const btns: HTMLButtonElement[] = [];
    for (const n of opts.seatChoice) {
      const b = document.createElement('button');
      b.className = 'cr-lobby__seatchoice-btn' + (n === selectedSeats ? ' is-on' : '');
      b.textContent = `${n}`;
      b.addEventListener('click', () => {
        selectedSeats = n;
        btns.forEach((x, i) => x.classList.toggle('is-on', opts.seatChoice![i] === n));
      });
      btns.push(b);
      seg.appendChild(b);
    }
    left.appendChild(seg);
    if (opts.seatNote) left.appendChild(text('div', 'cr-lobby__seatnote', opts.seatNote));
  }

  const createBtn = button('', opts.createLabel ?? '建房邀请', () => opts.onCreate({ isPrivate: false, seats: selectedSeats }));
  left.appendChild(createBtn);

  // 随机匹配（可选）
  let matchBtn: HTMLButtonElement | null = null;
  let matchState: HTMLElement | null = null;
  if (opts.onMatch) {
    matchBtn = button('', '随机匹配', opts.onMatch);
    left.appendChild(matchBtn);
    matchState = el('div', 'cr-lobby__match');
    matchState.textContent = `匹配中…等待凑齐 ${opts.matchSeats ?? 4} 人`;
    matchState.style.display = 'none';
    left.appendChild(matchState);
  }

  // 输房号加入好友的房
  left.appendChild(text('div', 'cr-lobby__or', '— 或 输房号加入 —'));
  const joinRow = el('div', 'cr-lobby__joinrow');
  const joinInput = document.createElement('input');
  joinInput.className = 'cr-lobby__input cr-lobby__joininput';
  joinInput.maxLength = 6;
  joinInput.placeholder = '6 位房号';
  joinInput.autocomplete = 'off';
  joinInput.addEventListener('input', () => { joinInput.value = joinInput.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  const doJoin = (): void => { const c = joinInput.value.trim(); if (c.length >= 4) opts.onJoin(c); };
  joinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
  const joinBtn = button('cr-lobby__btn--ghost cr-lobby__mini', '加入', doJoin);
  joinRow.append(joinInput, joinBtn);
  left.appendChild(joinRow);
  cols.appendChild(left);

  // 右：大厅
  const right = el('div', 'cr-lobby__panel');
  const rhead = el('div', 'cr-lobby__panel-head');
  rhead.appendChild(text('div', 'cr-lobby__panel-title', '大厅'));
  rhead.appendChild(button('cr-lobby__btn--ghost cr-lobby__mini', '刷新', opts.onRefresh));
  right.appendChild(rhead);
  const list = el('div', 'cr-lobby__roomlist');
  right.appendChild(list);
  cols.appendChild(right);

  wrap.appendChild(cols);
  root.appendChild(wrap);

  const showSeatCount = !!(opts.seatChoice && opts.seatChoice.length);   // 干瞪眼才显示「N 人桌」

  function renderRooms(rooms: LobbyRoom[]): void {
    list.innerHTML = '';
    if (!rooms.length) {
      list.appendChild(text('div', 'cr-lobby__empty', '暂无公开房间。建个房，把房号发给朋友。'));
      return;
    }
    for (const r of rooms) {
      const row = el('div', 'cr-lobby__room');
      row.appendChild(text('span', 'cr-lobby__room-code', r.code));
      if (showSeatCount && r.seatCount) row.appendChild(text('span', 'cr-lobby__room-cap', `${r.seatCount} 人桌`));
      const meta = el('span', 'cr-lobby__room-meta');
      meta.textContent = `${r.players.length}人${r.players.length ? '：' + r.players.join('、') : ''}`;
      row.appendChild(meta);
      const playing = r.status === 'playing';
      row.appendChild(text('span', `cr-lobby__badge cr-lobby__badge--${playing ? 'playing' : 'waiting'}`, playing ? '进行中' : '等待中'));
      row.appendChild(playing
        ? button('cr-lobby__btn--ghost cr-lobby__mini', '观战', () => opts.onSpectate(r.code))
        : button('cr-lobby__btn--ghost cr-lobby__mini', '加入', () => opts.onJoin(r.code)));
      list.appendChild(row);
    }
  }
  renderRooms(opts.rooms ?? []);

  return {
    update: renderRooms,
    setMatching: (on: boolean): void => {
      if (matchState) matchState.style.display = on ? 'block' : 'none';
      if (matchBtn) matchBtn.disabled = on;
      createBtn.disabled = on;
    },
    cleanup: (): void => { root.innerHTML = ''; },
  };
}
