import type { Card, Play } from '../engine/types';
import { comboIdentity, enumerateIdentities } from '../engine/combos';
import { sortHand } from '../engine/cards';

/** 干瞪眼牌桌。规则判定一律走 engine，这里不另写一套。 */

export interface SeatView {
  seat: number; count: number; online: boolean; ai: boolean; disconnected?: boolean;
  lastPlay?: { cards: Card[] } | 'pass' | null;
}
export interface TableState {
  phase: 'playing' | 'dealResult';
  turn: number;
  deckCount: number;
  current: { type: string; length: number; key: number; cards: Card[]; assign: { jokerId: number; rank: number }[]; by: number } | null;
  seats: SeatView[];
  turnRemainMs?: number;
  result?: { winner: number | null; pay: number[]; gain: number; stalemate: boolean };
}
export interface TableApi {
  mySeat: number | 'spectator';
  names: (string | null)[];
  onPlay(cardIds: number[], assign: { jokerId: number; rank: number }[]): void;
  onPass(): void;
  onRestart(): void;
  onLeave(): void;
}

const SUIT: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RANK: Record<number, string> = { 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

export function cardLabel(c: Card): string {
  if (c.kind === 'joker') return c.big ? '大王' : '小王';
  return `${SUIT[c.suit] ?? ''}${RANK[c.rank] ?? String(c.rank)}`;
}
/** 打出去的牌带上「这张王算几点」，否则别人看不懂桌面 */
function playedLabel(c: Card, assign: { jokerId: number; rank: number }[]): string {
  if (c.kind !== 'joker') return cardLabel(c);
  const a = assign.find((x) => x.jokerId === c.id);
  return a ? `${cardLabel(c)}(=${RANK[a.rank] ?? a.rank})` : cardLabel(c);
}
const COMBO_CN: Record<string, string> = {
  single: '单张', pair: '对子', run: '顺子', pairRun: '连对', bomb: '炸弹', jokerBomb: '王炸',
};

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function mountTable(root: HTMLElement, api: TableApi): {
  render(state: TableState, hand: Card[]): void;
  hint(msg: string): void;
  cleanup(): void;
} {
  root.innerHTML = '';
  const wrap = el('div', 'gy');
  const bar = el('div', 'gy__bar');
  const title = el('div', 'gy__title', '干瞪眼');
  const deckEl = el('div', 'gy__deck', '');
  const back = el('button', 'gy__back', '返回大厅');
  back.addEventListener('click', () => api.onLeave());
  bar.append(title, deckEl, back);

  const seatsEl = el('div', 'gy__seats');
  const tableEl = el('div', 'gy__table');
  const hintEl = el('div', 'gy__hint', '');
  const handEl = el('div', 'gy__hand');
  const chooserEl = el('div', 'gy__chooser');
  const actions = el('div', 'gy__actions');
  const playBtn = el('button', 'gy__btn gy__btn--play', '出牌') as HTMLButtonElement;
  const passBtn = el('button', 'gy__btn', '不要') as HTMLButtonElement;
  const againBtn = el('button', 'gy__btn gy__btn--play', '再来一局') as HTMLButtonElement;
  againBtn.style.display = 'none';
  actions.append(playBtn, passBtn, againBtn);

  wrap.append(bar, seatsEl, tableEl, hintEl, chooserEl, handEl, actions);
  root.appendChild(wrap);

  let selected = new Set<number>();
  let myHand: Card[] = [];
  let latest: TableState | null = null;
  let hintTimer = 0;

  const hint = (msg: string): void => {
    hintEl.textContent = msg;
    window.clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => { hintEl.textContent = ''; }, 4000);
  };

  /** 出牌：含王且有多种打法时，先让玩家点一下选哪种（engine 说了算，界面不猜） */
  function attemptPlay(): void {
    const picked = myHand.filter((c) => selected.has(c.id));
    if (!picked.length) { hint('先选牌'); return; }
    const options: Play[] = enumerateIdentities(picked, latest?.current
      ? ({ type: latest.current.type, cards: latest.current.cards, length: latest.current.length, key: latest.current.key } as never)
      : null);
    if (options.length === 0) { hint('这手牌出不了'); return; }
    if (options.length === 1) { commit(options[0]!); return; }
    renderChooser(options);
  }

  function commit(p: Play): void {
    chooserEl.innerHTML = '';
    api.onPlay(p.cards.map((c) => c.id), p.assign);
    selected = new Set();
  }

  function renderChooser(options: Play[]): void {
    chooserEl.innerHTML = '';
    chooserEl.appendChild(el('span', 'gy__chooser-label', '这手牌有几种打法，选一种：'));
    for (const p of options) {
      const name = COMBO_CN[p.combo.type] ?? p.combo.type;
      const detail = p.cards.map((c) => playedLabel(c, p.assign)).join(' ');
      const b = el('button', 'gy__chip', `${name} ${detail}`);
      b.addEventListener('click', () => commit(p));
      chooserEl.appendChild(b);
    }
  }

  playBtn.addEventListener('click', attemptPlay);
  passBtn.addEventListener('click', () => { chooserEl.innerHTML = ''; api.onPass(); });
  againBtn.addEventListener('click', () => api.onRestart());

  function render(state: TableState, hand: Card[]): void {
    latest = state;
    myHand = sortHand(hand);
    const mine = typeof api.mySeat === 'number' ? api.mySeat : -1;
    const myTurn = state.phase === 'playing' && state.turn === mine;

    deckEl.textContent = `牌堆 ${state.deckCount} 张`;

    seatsEl.innerHTML = '';
    for (const s of state.seats) {
      const box = el('div', `gy__seat${s.seat === state.turn && state.phase === 'playing' ? ' gy__seat--turn' : ''}`);
      const who = api.names[s.seat] ?? (s.ai ? 'AI' : `座${s.seat}`);
      box.appendChild(el('div', 'gy__seat-name', s.seat === mine ? `${who}（你）` : who));
      box.appendChild(el('div', 'gy__seat-count', `${s.count} 张`));
      const tag = s.disconnected ? '掉线了' : (s.ai ? 'AI 接管' : '');
      if (tag) box.appendChild(el('div', 'gy__seat-tag', tag));
      seatsEl.appendChild(box);
    }

    tableEl.innerHTML = '';
    if (state.phase === 'dealResult' && state.result) {
      const r = state.result;
      const who = r.winner === null ? '无人收分（并列僵局）' : `${api.names[r.winner] ?? `座${r.winner}`} 赢了`;
      tableEl.appendChild(el('div', 'gy__over', who));
      tableEl.appendChild(el('div', 'gy__over-detail',
        r.pay.map((p, i) => `${api.names[i] ?? `座${i}`} ${p === 0 ? '—' : `-${p}`}`).join('   ')));
      againBtn.style.display = '';
      playBtn.style.display = 'none';
      passBtn.style.display = 'none';
    } else {
      againBtn.style.display = 'none';
      playBtn.style.display = '';
      passBtn.style.display = '';
      if (state.current) {
        const c = state.current;
        tableEl.appendChild(el('div', 'gy__cur-label',
          `${api.names[c.by] ?? `座${c.by}`} 出了 ${COMBO_CN[c.type] ?? c.type}`));
        const row = el('div', 'gy__cur');
        for (const card of c.cards) row.appendChild(el('span', 'gy__card gy__card--played', playedLabel(card, c.assign)));
        tableEl.appendChild(row);
      } else {
        tableEl.appendChild(el('div', 'gy__cur-label', myTurn ? '轮到你领出' : '等待领出'));
      }
    }

    handEl.innerHTML = '';
    if (typeof api.mySeat === 'number') {
      for (const c of myHand) {
        const b = el('button', `gy__card${selected.has(c.id) ? ' gy__card--on' : ''}`, cardLabel(c));
        b.addEventListener('click', () => {
          if (selected.has(c.id)) selected.delete(c.id); else selected.add(c.id);
          chooserEl.innerHTML = '';
          render(state, hand);
        });
        handEl.appendChild(b);
      }
    }

    playBtn.disabled = !myTurn;
    passBtn.disabled = !myTurn || state.current === null;   // 领出不能不要
  }

  return {
    render,
    hint,
    cleanup(): void { window.clearTimeout(hintTimer); root.innerHTML = ''; },
  };
}
