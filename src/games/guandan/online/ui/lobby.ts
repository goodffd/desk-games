/**
 * lobby.ts — 联机大厅页（Plan 3 Task 8）。
 * 横屏优先：顶栏(掼蛋+你好) + 左「开局」(建房/匹配) + 右「大厅」(公开房列表/观战)。
 * 纯渲染 + 回调，不碰 WS（控制器在回调里发 create/match/spectate/lobby）。
 */
import './lobby.css';
import type { LobbyRoom } from '../protocol';

export interface LobbyOpts {
  nick: string;
  rooms: LobbyRoom[];
  onCreate: () => void;                 // 建房邀请（房号约朋友）
  onMatch: () => void;                  // 随机匹配
  onSpectate: (code: string) => void;   // 观战进行中的公开房
  onJoin: (code: string) => void;       // 输房号加入好友的房
  onRefresh: () => void;                // 刷新大厅房列表
}

export interface LobbyHandle {
  update: (rooms: LobbyRoom[]) => void;
  setMatching: (on: boolean) => void;   // 匹配中：禁用按钮 + 显等待态
  cleanup: () => void;
}

export function renderLobby(root: HTMLElement, opts: LobbyOpts): LobbyHandle {
  root.innerHTML = '';
  const wrap = el('div', 'gd-lobby gd-lobby--page');

  const header = el('div', 'gd-lobby__header');
  header.appendChild(text('span', 'gd-lobby__brand-sm', '掼蛋'));
  header.appendChild(text('span', 'gd-lobby__hello', `你好，${opts.nick}`));
  wrap.appendChild(header);

  const cols = el('div', 'gd-lobby__cols');

  // 左：开局
  const left = el('div', 'gd-lobby__panel');
  left.appendChild(text('div', 'gd-lobby__panel-title', '开始一局'));
  const createBtn = button('', '建房邀请', opts.onCreate);
  const matchBtn = button('', '随机匹配', opts.onMatch);
  left.append(createBtn, matchBtn);
  const matchState = el('div', 'gd-lobby__match');
  matchState.textContent = '匹配中…等待凑齐 4 人';
  matchState.style.display = 'none';
  left.appendChild(matchState);
  // 输房号加入好友的房
  left.appendChild(text('div', 'gd-lobby__or', '— 或 输房号加入 —'));
  const joinRow = el('div', 'gd-lobby__joinrow');
  const joinInput = document.createElement('input');
  joinInput.className = 'gd-lobby__input gd-lobby__joininput';
  joinInput.maxLength = 6;
  joinInput.placeholder = '6 位房号';
  joinInput.autocomplete = 'off';
  joinInput.addEventListener('input', () => { joinInput.value = joinInput.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  const doJoin = (): void => { const c = joinInput.value.trim(); if (c.length >= 4) opts.onJoin(c); };
  joinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
  const joinBtn = button('gd-lobby__btn--ghost gd-lobby__mini', '加入', doJoin);
  joinRow.append(joinInput, joinBtn);
  left.appendChild(joinRow);
  cols.appendChild(left);

  // 右：大厅
  const right = el('div', 'gd-lobby__panel');
  const rhead = el('div', 'gd-lobby__panel-head');
  rhead.appendChild(text('div', 'gd-lobby__panel-title', '大厅'));
  rhead.appendChild(button('gd-lobby__btn--ghost gd-lobby__mini', '刷新', opts.onRefresh));
  right.appendChild(rhead);
  const list = el('div', 'gd-lobby__roomlist');
  right.appendChild(list);
  cols.appendChild(right);

  wrap.appendChild(cols);
  root.appendChild(wrap);

  function renderRooms(rooms: LobbyRoom[]): void {
    list.innerHTML = '';
    if (!rooms.length) {
      list.appendChild(text('div', 'gd-lobby__empty', '暂无公开房间。建个房，把房号发给朋友。'));
      return;
    }
    for (const r of rooms) {
      const row = el('div', 'gd-lobby__room');
      row.appendChild(text('span', 'gd-lobby__room-code', r.code));
      const meta = el('span', 'gd-lobby__room-meta');
      meta.textContent = `${r.players.length}人${r.players.length ? '：' + r.players.join('、') : ''}`;
      row.appendChild(meta);
      const playing = r.status === 'playing';
      row.appendChild(text('span', `gd-lobby__badge gd-lobby__badge--${playing ? 'playing' : 'waiting'}`, playing ? '进行中' : '等待中'));
      row.appendChild(playing
        ? button('gd-lobby__btn--ghost gd-lobby__mini', '观战', () => opts.onSpectate(r.code))
        : button('gd-lobby__btn--ghost gd-lobby__mini', '加入', () => opts.onJoin(r.code)));
      list.appendChild(row);
    }
  }
  renderRooms(opts.rooms);

  return {
    update: renderRooms,
    setMatching: (on: boolean): void => {
      matchState.style.display = on ? 'block' : 'none';
      matchBtn.disabled = on;
      createBtn.disabled = on;
    },
    cleanup: (): void => { root.innerHTML = ''; },
  };
}

function el(tag: string, cls: string): HTMLElement { const e = document.createElement(tag); e.className = cls; return e; }
function text(tag: string, cls: string, t: string): HTMLElement { const e = el(tag, cls); e.textContent = t; return e; }
/** modifiers 只传修饰类（如 'gd-lobby__btn--ghost gd-lobby__mini'），base 恒前置。 */
function button(modifiers: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = ('gd-lobby__btn ' + modifiers).trim();
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
