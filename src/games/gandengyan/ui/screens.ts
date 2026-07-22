/** 干瞪眼的三个前置屏：起昵称 → 大厅 → 房间。牌桌在 table.ts。 */

export interface SeatInfo { seat: number; nick: string | null; online: boolean; ai: boolean }
export interface LobbyRoom { code: string; status: 'waiting' | 'playing'; players: string[]; spectators: number }

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function button(cls: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `gy__btn ${cls}`.trim();
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

export function renderNickname(root: HTMLElement, opts: { initial: string; onSubmit(nick: string): void }): {
  showError(msg: string): void; cleanup(): void;
} {
  root.innerHTML = '';
  const wrap = el('div', 'gy gy--center');
  wrap.appendChild(el('div', 'gy__title', '干瞪眼'));
  wrap.appendChild(el('div', 'gy__sub', '大一法则：跟牌必须点数正好大一级'));
  const input = document.createElement('input');
  input.className = 'gy__input';
  input.placeholder = '起个名字';
  input.maxLength = 12;
  input.value = opts.initial;
  const err = el('div', 'gy__err', '');
  const submit = (): void => {
    const n = input.value.trim();
    if (!n) { err.textContent = '请输入昵称'; input.focus(); return; }
    err.textContent = '';
    opts.onSubmit(n);
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  wrap.append(input, button('gy__btn--play', '进入大厅', submit), err);
  root.appendChild(wrap);
  input.focus();
  return {
    showError: (m: string): void => { err.textContent = m; input.focus(); input.select(); },
    cleanup: (): void => { root.innerHTML = ''; },
  };
}

export function renderLobby(root: HTMLElement, opts: {
  nick: string;
  onCreate(seats: number): void;
  onJoin(code: string): void;
  onSpectate(code: string): void;
  onRefresh(): void;
}): { update(rooms: LobbyRoom[]): void; cleanup(): void } {
  root.innerHTML = '';
  const wrap = el('div', 'gy');
  wrap.appendChild(el('div', 'gy__title', `干瞪眼 · ${opts.nick}`));

  const mk = el('div', 'gy__row');
  mk.appendChild(el('span', 'gy__label', '开一桌：'));
  const seatSel = document.createElement('select');
  seatSel.className = 'gy__select';
  for (const n of [2, 3, 4, 5]) {
    const o = document.createElement('option');
    o.value = String(n); o.textContent = `${n} 人`;
    if (n === 3) o.selected = true;
    seatSel.appendChild(o);
  }
  mk.append(seatSel, button('gy__btn--play', '建房', () => opts.onCreate(Number(seatSel.value))));
  wrap.appendChild(mk);
  wrap.appendChild(el('div', 'gy__note', '真人没凑齐也能开打，空座由服务端补 AI'));

  const jr = el('div', 'gy__row');
  const jin = document.createElement('input');
  jin.className = 'gy__input gy__input--code';
  jin.placeholder = '6 位房号';
  jin.maxLength = 6;
  jin.addEventListener('input', () => { jin.value = jin.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  const doJoin = (): void => { if (jin.value.trim().length >= 4) opts.onJoin(jin.value.trim()); };
  jin.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
  jr.append(el('span', 'gy__label', '输房号：'), jin, button('', '加入', doJoin));
  wrap.appendChild(jr);

  const head = el('div', 'gy__row');
  head.append(el('span', 'gy__label', '房间列表'), button('', '刷新', () => opts.onRefresh()));
  wrap.appendChild(head);
  const list = el('div', 'gy__list');
  wrap.appendChild(list);
  root.appendChild(wrap);

  return {
    update(rooms: LobbyRoom[]): void {
      list.innerHTML = '';
      if (!rooms.length) { list.appendChild(el('div', 'gy__note', '还没有人开桌')); return; }
      for (const r of rooms) {
        const row = el('div', 'gy__list-row');
        row.appendChild(el('span', 'gy__code', r.code));
        row.appendChild(el('span', 'gy__note', `${r.players.length} 人${r.players.length ? '：' + r.players.join('、') : ''}`));
        row.appendChild(r.status === 'playing'
          ? button('', '观战', () => opts.onSpectate(r.code))
          : button('', '加入', () => opts.onJoin(r.code)));
        list.appendChild(row);
      }
    },
    cleanup: (): void => { root.innerHTML = ''; },
  };
}

export function renderRoom(root: HTMLElement, opts: {
  code: string;
  onTakeSeat(seat: number): void;
  onStart(): void;
  onLeave(): void;
}): { update(seats: (SeatInfo | null)[], you: number | 'spectator' | null, isHost: boolean): void; cleanup(): void } {
  root.innerHTML = '';
  const wrap = el('div', 'gy');
  const head = el('div', 'gy__row');
  head.append(el('span', 'gy__code', opts.code), el('span', 'gy__note', '把房号告诉朋友'), button('', '离开', () => opts.onLeave()));
  wrap.appendChild(head);
  const seatsEl = el('div', 'gy__seats');
  wrap.appendChild(seatsEl);
  const startWrap = el('div', 'gy__row');
  wrap.appendChild(startWrap);
  root.appendChild(wrap);

  return {
    update(seats, you, isHost): void {
      seatsEl.innerHTML = '';
      seats.forEach((s, i) => {
        const box = el('div', 'gy__seat');
        if (s) {
          box.appendChild(el('div', 'gy__seat-name', you === i ? `${s.nick}（你）` : (s.nick ?? '玩家')));
        } else {
          box.appendChild(el('div', 'gy__seat-name', '空位'));
          box.appendChild(button('', '＋ 入座', () => opts.onTakeSeat(i)));
        }
        seatsEl.appendChild(box);
      });
      startWrap.innerHTML = '';
      if (isHost) {
        startWrap.appendChild(button('gy__btn--play', '开打', () => opts.onStart()));
        startWrap.appendChild(el('span', 'gy__note', '空座会由服务端补 AI'));
      } else {
        startWrap.appendChild(el('span', 'gy__note', '等房主开打'));
      }
    },
    cleanup: (): void => { root.innerHTML = ''; },
  };
}
