import type { Card, Combo, ComboType, Play, WildAssign } from '../engine/types';
import { enumerateIdentities } from '../engine/combos';
import { enumerateLeads } from '../engine/legal';
import { sortHand } from '../engine/cards';
import { cardFace } from '../../../ui/cards/card-face';
import type { CardRank, FaceCard } from '../../../ui/cards/types';
import { seatRing } from '../../../ui/cards/layout';
import '../../../ui/cards/card-face.css';
import '../../../ui/cards/joker-img.css';
import '../../../ui/cards/rank-font.css';
import './gandengyan.css';

/**
 * 干瞪眼牌桌。用共享牌面（cardFace）+ 环形座位（seatRing）自成一套，掼蛋牌桌一行不动。
 * 规则判定一律走 engine（歧义 enumerateIdentities）；界面不猜。
 */

const COMBO_CN: Record<string, string> = {
  single: '单张', pair: '对子', run: '顺子', pairRun: '连对', bomb: '炸弹', jokerBomb: '王炸',
};

export interface SeatView {
  seat: number; count: number; online: boolean; ai: boolean; disconnected?: boolean;
  lastPlay?: { cards: Card[]; assign?: WildAssign[] } | 'pass' | null;
}
export interface TableState {
  phase: 'playing' | 'dealResult';
  turn: number;
  deckCount: number;
  current: { type: string; length: number; key: number; cards: Card[]; assign: WildAssign[]; by: number } | null;
  lastActor?: number | null;
  seats: SeatView[];
  turnRemainMs?: number;
  result?: {
    winner: number | null; pay: number[]; gain: number; stalemate: boolean; hands: number[];
    base?: number; bombsPlayed?: number; bombMultiplier?: number;
    seats?: SettleSeatView[];   // 逐座明细（#16 结算表逐项展开）
  };
}
/** 一座的结算明细，与引擎 SettleSeat 同构（服务端下发）。 */
export interface SettleSeatView {
  seat: number; handCount: number; wildCount: number; twoCount: number;
  spring: boolean; personalMultiplier: number; pay: number;
}
export interface TableApi {
  mySeat: number | 'spectator';
  names: (string | null)[];
  onPlay(cardIds: number[], assign: WildAssign[]): void;
  onPass(): void;
  onRestart(): void;
  onLeave(): void;
}

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
/** 一张出过的牌的元素：王带上被指派的点数（药丸），别人才看得懂桌面 */
function playedCard(c: Card, assign: WildAssign[] | undefined, small: boolean): HTMLElement {
  const a = assign?.find((x) => x.jokerId === c.id);
  return cardFace(c as FaceCard, { small, assignedRank: (a?.rank ?? null) as CardRank | null });
}

export function mountTable(root: HTMLElement, api: TableApi): {
  render(state: TableState, hand: Card[]): void;
  hint(msg: string): void;
  cleanup(): void;
} {
  root.innerHTML = '';
  const wrap = el('div', 'gy');
  const bar = el('div', 'gy__bar');
  bar.append(el('div', 'gy__title', '干瞪眼'), el('div', 'gy__deck', ''), (() => {
    const b = el('button', 'gy__back', '返回大厅'); b.addEventListener('click', () => api.onLeave()); return b;
  })());
  const board = el('div', 'gy__board');       // 座位环 + 中央出牌区
  const seatsEl = el('div', 'gy__seats');
  const centerEl = el('div', 'gy__center');
  board.append(seatsEl, centerEl);
  const hintEl = el('div', 'gy__hint', '');
  const chooserEl = el('div', 'gy__chooser');
  const handEl = el('div', 'gy__hand');
  const actions = el('div', 'gy__actions');
  const playBtn = el('button', 'gy__btn gy__btn--play', '出牌') as HTMLButtonElement;
  const passBtn = el('button', 'gy__btn', '不要') as HTMLButtonElement;
  actions.append(playBtn, passBtn);   // 「再来一局」在结算弹层里，不在这条动作栏
  wrap.append(bar, board, hintEl, chooserEl, handEl, actions);
  root.appendChild(wrap);

  let selected = new Set<number>();
  let myHand: Card[] = [];
  let latest: TableState | null = null;
  let hintTimer = 0;

  /** 座位显示名：有昵称用昵称，AI 空座显示「AI」，否则「座N」。render 与结算屏共用。 */
  const nameOf = (seat: number): string =>
    api.names[seat] ?? (latest?.seats.find((x) => x.seat === seat)?.ai ? 'AI' : `座${seat}`);

  const hint = (msg: string): void => {
    hintEl.textContent = msg;
    window.clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => { hintEl.textContent = ''; }, 4000);
  };

  /** 桌面当前牌整成 engine 认识的 Combo，供歧义判断时判「压不压得住」 */
  function currentCombo(): Combo | null {
    if (!latest?.current) return null;
    const c = latest.current;
    return { type: c.type as ComboType, cards: c.cards, length: c.length, key: c.key };
  }

  function attemptPlay(): void {
    const picked = myHand.filter((c) => selected.has(c.id));
    if (!picked.length) { hint('先选牌'); return; }
    const options: Play[] = enumerateIdentities(picked, currentCombo());
    if (options.length === 0) { hint('这手牌出不了'); return; }
    if (options.length === 1) { commit(options[0]!); return; }
    renderChooser(options);          // 真有歧义（多种牌型标识）才让玩家选
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
      const chip = el('button', 'gy__chip', '');
      chip.appendChild(el('span', 'gy__chip-name', name));
      for (const c of p.cards) chip.appendChild(playedCard(c, p.assign, true));
      chip.addEventListener('click', () => commit(p));
      chooserEl.appendChild(chip);
    }
  }

  playBtn.addEventListener('click', attemptPlay);
  passBtn.addEventListener('click', () => { chooserEl.innerHTML = ''; api.onPass(); });

  function render(state: TableState, hand: Card[]): void {
    latest = state;
    myHand = sortHand(hand);
    const n = state.seats.length;
    const mine = typeof api.mySeat === 'number' ? api.mySeat : 0;   // 观战视角基准 0
    const iAmSeat = typeof api.mySeat === 'number';
    const myTurn = state.phase === 'playing' && iAmSeat && state.turn === mine;

    bar.querySelector('.gy__deck')!.textContent = `牌堆 ${state.deckCount} 张`;

    // 座位环：把服务端座号转成视角座号（自己恒在底部），按 seatRing 定位
    const ring = seatRing(n);
    seatsEl.innerHTML = '';
    for (const s of state.seats) {
      const v = ((s.seat - mine) % n + n) % n;
      const anchor = ring[v]!;
      const box = el('div', `gy__seat gy__seat--${anchor.edge}${s.seat === state.turn && state.phase === 'playing' ? ' gy__seat--turn' : ''}`);
      box.style.left = `${anchor.leftPct}%`;
      box.style.top = `${anchor.topPct}%`;
      const who = nameOf(s.seat);
      box.appendChild(el('div', 'gy__seat-name', s.seat === mine && iAmSeat ? `${who}（你）` : who));
      const meta = el('div', 'gy__seat-meta', `${s.count} 张`);
      if (s.disconnected) meta.appendChild(el('span', 'gy__seat-tag', ' 掉线'));  // AI 座名字已是「AI」，不再重复标注
      box.appendChild(meta);
      // 座位最近出的一手（小牌）
      if (s.lastPlay && s.lastPlay !== 'pass') {
        const lp = el('div', 'gy__seat-play');
        for (const c of s.lastPlay.cards) lp.appendChild(playedCard(c, s.lastPlay.assign, true));
        box.appendChild(lp);
      } else if (s.lastPlay === 'pass') {
        box.appendChild(el('div', 'gy__seat-pass', '不要'));
      }
      seatsEl.appendChild(box);
    }

    // 中央：当前桌面牌 + 倒计时
    centerEl.innerHTML = '';
    if (state.phase === 'playing') {
      if (state.current) {
        const c = state.current;
        centerEl.appendChild(el('div', 'gy__cur-by', `${nameOf(c.by)} 出了 ${COMBO_CN[c.type] ?? c.type}`));
        const row = el('div', 'gy__cur');
        for (const card of c.cards) row.appendChild(playedCard(card, c.assign, false));
        centerEl.appendChild(row);
      } else {
        centerEl.appendChild(el('div', 'gy__cur-by', myTurn ? '轮到你领出' : '等待领出'));
      }
      if (myTurn && state.turnRemainMs != null) {
        centerEl.appendChild(el('div', 'gy__clock', `${Math.ceil(state.turnRemainMs / 1000)}s`));
      }
    }

    // 结算弹层
    if (state.phase === 'dealResult' && state.result) {
      renderResult(state.result);
    } else {
      wrap.querySelector('.gy__result')?.remove();
    }

    // 自己的手牌
    handEl.innerHTML = '';
    if (iAmSeat) {
      for (const c of myHand) {
        const face = cardFace(c as FaceCard, { extraClass: selected.has(c.id) ? 'gy-card--on' : undefined });
        face.addEventListener('click', () => {
          if (selected.has(c.id)) selected.delete(c.id); else selected.add(c.id);
          chooserEl.innerHTML = '';
          render(state, hand);
        });
        handEl.appendChild(face);
      }
    }

    const over = state.phase === 'dealResult';
    playBtn.style.display = over || !iAmSeat ? 'none' : '';
    passBtn.style.display = over || !iAmSeat ? 'none' : '';
    // 领出确无合法出牌（手里只剩王）时允许过——服务端会顺延出牌权；跟牌时要得起也能过。
    const canLead = state.current !== null || enumerateLeads(myHand).length > 0;
    playBtn.disabled = !myTurn;
    passBtn.disabled = !myTurn || (state.current === null && canLead);
  }

  /**
   * 一座赔付的「每一乘」摆开，每一乘写清是谁贡献的（不用「个人倍数」这种抽象标签，玩家看不懂）：
   *   剩 5 张 · 春天 ×2 = 10
   *   剩 5 张 · 1 炸 ×2 · 2 张王 ×4 · 1 张2 ×2 = 320
   */
  function breakdownText(d: SettleSeatView, r: NonNullable<TableState['result']>): string {
    const parts = [`剩 ${d.handCount} 张`];
    if ((r.base ?? 1) !== 1) parts.unshift(`底 ${r.base}`);
    if ((r.bombMultiplier ?? 1) > 1) parts.push(`${r.bombsPlayed} 炸 ×${r.bombMultiplier}`);
    if (d.wildCount) parts.push(`${d.wildCount} 张王 ×${2 ** d.wildCount}`);
    if (d.twoCount) parts.push(`${d.twoCount} 张2 ×${2 ** d.twoCount}`);
    if (d.spring) parts.push('春天 ×2');
    return parts.join(' · ');
  }

  function renderResult(r: NonNullable<TableState['result']>): void {
    wrap.querySelector('.gy__result')?.remove();
    const box = el('div', 'gy__result');
    box.appendChild(el('div', 'gy__result-title', r.winner === null ? '无人收分（并列僵局）' : `${nameOf(r.winner)} 赢了`));
    const rows = el('div', 'gy__result-rows');
    const detailOf = (i: number): SettleSeatView | undefined => r.seats?.find((d) => d.seat === i);
    r.pay.forEach((p, i) => {
      const line = el('div', 'gy__result-row');
      const head = el('div', 'gy__result-head');
      head.appendChild(el('span', 'gy__result-who', `${nameOf(i)}${i === r.winner ? '（赢）' : ''}`));
      head.appendChild(el('span', 'gy__result-pay', i === r.winner ? `+${r.gain}` : (p ? `-${p}` : '—')));
      line.appendChild(head);
      // 输家：逐项展开这笔赔付的乘法链（赢家无赔付、僵局无人收分，都不展开）
      const d = detailOf(i);
      if (r.winner !== null && i !== r.winner && p > 0 && d) {
        line.appendChild(el('div', 'gy__result-calc', `${breakdownText(d, r)} = ${p}`));
      } else if (d) {
        line.appendChild(el('div', 'gy__result-calc', `剩 ${d.handCount} 张`));
      }
      rows.appendChild(line);
    });
    box.appendChild(rows);
    // AC2：赢家得分 = 各输家赔付之和，界面上对得上
    if (r.winner !== null) {
      box.appendChild(el('div', 'gy__result-sum', `赢家 +${r.gain} = 各输家赔付之和`));
    }
    if (api.mySeat !== 'spectator') {   // 观战者不给再来一局
      const again = el('button', 'gy__btn gy__btn--play gy__result-again', '再来一局');
      again.addEventListener('click', () => api.onRestart());
      box.appendChild(again);
    }
    wrap.appendChild(box);
  }

  return {
    render,
    hint,
    cleanup(): void { window.clearTimeout(hintTimer); root.innerHTML = ''; },
  };
}
