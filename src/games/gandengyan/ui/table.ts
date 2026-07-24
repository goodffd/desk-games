import type { Card, Combo, ComboType, Play, WildAssign } from '../engine/types';
import { enumerateIdentities } from '../engine/combos';
import { enumerateLeads, enumerateFollows } from '../engine/legal';
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
  const passBtn = el('button', 'gy__btn gy__btn--pass', '不要') as HTMLButtonElement;
  actions.append(playBtn, passBtn);   // 「再来一局」在结算弹层里，不在这条动作栏
  wrap.append(bar, board, hintEl, chooserEl, handEl, actions);
  root.appendChild(wrap);

  let selected = new Set<number>();
  let myHand: Card[] = [];
  let latest: TableState | null = null;
  let hintTimer = 0;

  // 回合倒计时（读秒）：客户端每 250ms 走一格，服务端 turnRemainMs 播种、AI 座无 timer 用本地 20s 兜底。
  const TURN_SECONDS = 20;
  let timedSeat: number | null = null;
  let turnStartedAt = 0;
  let turnTotalSec = TURN_SECONDS;
  let turnSeeded = false;      // 本回合是否已用服务端剩余播种（首个带 turnRemainMs 的 state 回合号没变，需补播种一次）
  let turnTick = 0;

  /**
   * 座位显示名：有昵称用昵称（真人，含掉线真人）；AI 补位空座——多个 AI 时按服务端座序编号
   * 「AI 1 / AI 2 …」互相区分（所有客户端看到一致），只有一个 AI 就叫「AI」；否则「座N」。
   * render 与结算屏共用。
   */
  const nameOf = (seat: number): string => {
    if (api.names[seat]) return api.names[seat]!;
    const seatList = latest?.seats ?? [];
    const s = seatList.find((x) => x.seat === seat);
    if (s?.ai) {
      const aiSeats = seatList.filter((x) => x.ai).map((x) => x.seat).sort((a, b) => a - b);
      return aiSeats.length > 1 ? `AI ${aiSeats.indexOf(seat) + 1}` : 'AI';
    }
    return `座${seat}`;
  };

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
  // 右键出牌（参考掼蛋）：牌桌上单击右键 = 出牌，仅我回合且已选牌、出牌没禁用时触发；一律屏蔽浏览器右键菜单
  wrap.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!playBtn.disabled && selected.size > 0) attemptPlay();
  });

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
      // 轮到这一座：座位上放读秒小闹钟（含 AI 座，AI 无服务端 timer 用本地 20s 兜底）。
      // 秒数由 paintClock 每 250ms 刷、闹钟图标 CSS 摇摆动画——等谁、还剩几秒一目了然。
      if (s.seat === state.turn && state.phase === 'playing') {
        const clock = el('div', 'gy__seat-clock');
        clock.appendChild(el('span', 'gy__seat-clock-icon', '⏰'));
        clock.appendChild(el('span', 'gy__seat-clock-sec', ''));
        box.appendChild(clock);
      }
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
      // 倒计时不再放中央，改到「轮到那一座」的座位上（见座位循环的 gy__seat-clock）
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
    // 手里根本没有能出的一手（跟牌压不住 / 领出只剩王无合法领出）→ 出牌禁用、只能不要（参考掼蛋）。
    // 领出确无合法出牌时允许过——服务端顺延出牌权；跟牌要得起也能过。
    const cur = currentCombo();
    const mustPass = myTurn && (cur === null ? enumerateLeads(myHand).length === 0 : enumerateFollows(myHand, cur).length === 0);
    playBtn.disabled = !myTurn || mustPass;
    passBtn.disabled = !myTurn || (state.current === null && !mustPass);

    syncTurnTimer(state);   // 座位闹钟已在上面画好，这里播种/启停读秒
  }

  /** 回合切换或首个服务端剩余到达时重新播种，并启停每 250ms 的读秒；仿掼蛋 view.ts。 */
  function syncTurnTimer(state: TableState): void {
    const active = state.phase === 'playing' ? state.turn : null;
    const haveServer = active !== null && state.turnRemainMs != null;
    if (active !== timedSeat || (haveServer && !turnSeeded)) {
      timedSeat = active;
      turnStartedAt = performance.now();
      turnTotalSec = haveServer ? state.turnRemainMs! / 1000 : TURN_SECONDS;  // 服务端权威剩余 / AI 座本地 20s 兜底
      turnSeeded = haveServer;
    }
    if (active === null) {
      if (turnTick) { window.clearInterval(turnTick); turnTick = 0; }
      return;
    }
    if (!turnTick) turnTick = window.setInterval(paintClock, 250);
    paintClock();
  }
  /** 把当前回合座的闹钟秒数刷成实际剩余（≤5s 转红加急）。查 DOM 取当前那格，render 重建后也不会拿到旧引用。 */
  function paintClock(): void {
    if (timedSeat === null || latest?.turn !== timedSeat || latest?.phase !== 'playing') {
      if (turnTick) { window.clearInterval(turnTick); turnTick = 0; }
      return;
    }
    const remain = Math.max(0, turnTotalSec - (performance.now() - turnStartedAt) / 1000);
    const clock = seatsEl.querySelector('.gy__seat--turn .gy__seat-clock');
    if (!clock) return;
    const sec = clock.querySelector('.gy__seat-clock-sec');
    if (sec) sec.textContent = `${Math.ceil(remain)}s`;
    clock.classList.toggle('gy__seat-clock--low', remain <= 5);
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
    cleanup(): void { window.clearTimeout(hintTimer); if (turnTick) window.clearInterval(turnTick); root.innerHTML = ''; },
  };
}
