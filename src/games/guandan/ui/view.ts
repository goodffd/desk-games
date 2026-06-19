/**
 * view.ts — 掼蛋游戏视图：mount(root) → unmount
 *
 * 职责：
 * 1. 初始化一局（随机洗牌、随机首攻、createDeal）
 * 2. 全量渲染桌面 DOM（四座布局、出牌展示、玩家手牌、按钮）
 * 3. 玩家交互：选牌 → 出牌（isLegalPlay 校验）/ 不要
 * 4. AI 自动推进循环（轮到 AI → choosePlay → 600ms 延迟 → play/pass → 重渲染）
 * 5. 局终：显示名次弹层 + 重新发牌
 * 6. unmount：清 setTimeout、清 DOM
 */

import './guandan.css';

import type { Card, Seat } from '../engine/types';
import { LEVEL } from '../engine/types';
import { makeDeck, deal, sortHand } from '../engine/cards';
import { createDeal, play, pass, isDealOver, ranking, levelGain } from '../engine/game';
import type { DealState } from '../engine/game';
import { isLegalPlay } from '../engine/legal';
import { choosePlay } from '../ai/ai';
import { cardEl, comboTypeLabel, rankName } from './render';

// 人类座位固定为 0
const HUMAN_SEAT: Seat = 0;

// 座位名称
const SEAT_LABELS: Record<Seat, string> = {
  0: '你',
  1: '右家',
  2: '对家',
  3: '左家',
};

// 生成 0..n-1 的随机置换（Fisher-Yates，UI 层允许使用 Math.random）
function randomShuffle(n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** 发起一局：返回初始 DealState */
function startNewDeal(): DealState {
  const deck = makeDeck();
  const hands = deal(deck, randomShuffle);
  const sortedHands = hands.map(h => sortHand(h, LEVEL));
  const firstLeader = Math.floor(Math.random() * 4) as Seat;
  return createDeal(sortedHands, firstLeader, LEVEL);
}

export function mount(root: HTMLElement): () => void {
  // ── 状态 ──────────────────────────────────────────────────────────────────
  let state = startNewDeal();
  let selectedIds = new Set<number>();   // 玩家选中的牌 id
  const timers: number[] = [];            // 记录所有 setTimeout id，unmount 时清

  // 玩家每次出牌/不要后，都要重新排序手牌（AI 不需要，已 sortHand 过）
  // 保持手牌排序（每次 render 前都重排）
  function sortedHand(seat: Seat): Card[] {
    return sortHand(state.hands[seat]!, LEVEL);
  }

  // ── DOM 骨架 ──────────────────────────────────────────────────────────────
  root.innerHTML = '';
  const gameEl = document.createElement('div');
  gameEl.className = 'gd-game';

  // 顶部返回栏
  const topbar = document.createElement('div');
  topbar.className = 'gd-topbar';
  const topbarTitle = document.createElement('span');
  topbarTitle.className = 'gd-topbar__title';
  topbarTitle.textContent = '掼蛋';
  const backBtn = document.createElement('button');
  backBtn.className = 'gd-topbar__back';
  backBtn.textContent = '← 返回大厅';
  backBtn.addEventListener('click', () => { location.hash = '#/'; });
  topbar.appendChild(topbarTitle);
  topbar.appendChild(backBtn);

  // 主桌面
  const tableEl = document.createElement('div');
  tableEl.className = 'gd-table';

  // 四个座位区
  const seatEls: Record<Seat, HTMLElement> = {
    0: document.createElement('div'),
    1: document.createElement('div'),
    2: document.createElement('div'),
    3: document.createElement('div'),
  };
  const SEAT_POSITIONS: Record<Seat, string> = {
    0: 'bottom', 1: 'right', 2: 'top', 3: 'left',
  };
  for (const s of [0, 1, 2, 3] as Seat[]) {
    seatEls[s].className = `gd-seat gd-seat--${SEAT_POSITIONS[s]}`;
    tableEl.appendChild(seatEls[s]);
  }

  // 中央出牌展示区
  const centerEl = document.createElement('div');
  centerEl.className = 'gd-center';
  tableEl.appendChild(centerEl);

  // 按钮区（在 gameEl 底部，bottom seat 下方）
  const actionsEl = document.createElement('div');
  actionsEl.className = 'gd-actions';
  const playBtn = document.createElement('button');
  playBtn.className = 'gd-btn gd-btn--play';
  playBtn.textContent = '出牌';
  const passBtn = document.createElement('button');
  passBtn.className = 'gd-btn gd-btn--pass';
  passBtn.textContent = '不要';
  actionsEl.appendChild(playBtn);
  actionsEl.appendChild(passBtn);

  // 提示文字
  const hintEl = document.createElement('div');
  hintEl.className = 'gd-hint';

  gameEl.appendChild(topbar);
  gameEl.appendChild(tableEl);
  gameEl.appendChild(hintEl);
  gameEl.appendChild(actionsEl);
  root.appendChild(gameEl);

  // ── 渲染函数 ──────────────────────────────────────────────────────────────

  /** 渲染单个非人类座位（显示背面牌 + 状态标签） */
  function renderAiSeat(seat: Seat): void {
    const el = seatEls[seat]!;
    el.innerHTML = '';

    const label = document.createElement('div');
    label.className = 'gd-seat__label';
    if (state.turn === seat && !isDealOver(state)) label.classList.add('is-active');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'gd-seat__label-name';
    nameSpan.textContent = SEAT_LABELS[seat];

    const countSpan = document.createElement('span');
    countSpan.className = 'gd-seat__card-count';
    const finishIdx = state.finished.indexOf(seat);
    if (finishIdx >= 0) {
      const badge = document.createElement('span');
      badge.className = 'gd-seat__rank';
      badge.textContent = rankName(finishIdx);
      label.appendChild(nameSpan);
      label.appendChild(badge);
    } else {
      countSpan.textContent = `${state.hands[seat]!.length}张`;
      label.appendChild(nameSpan);
      label.appendChild(countSpan);
    }

    el.appendChild(label);

    // 背面牌堆
    if (finishIdx < 0 && state.hands[seat]!.length > 0) {
      const backEl = document.createElement('div');
      backEl.className = 'gd-hand-back';
      const shown = Math.min(state.hands[seat]!.length, 8);
      for (let i = 0; i < shown; i++) {
        const bc = document.createElement('div');
        bc.className = 'gd-hand-back__card';
        backEl.appendChild(bc);
      }
      el.appendChild(backEl);
    }
  }

  /** 渲染中央出牌展示区（四格：各家最近一手 / 状态） */
  function renderCenter(): void {
    centerEl.innerHTML = '';

    const area = document.createElement('div');
    area.className = 'gd-played-area';

    // 4 个位置对应 4 个座位
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      const slot = document.createElement('div');
      slot.className = 'gd-played-slot';

      // 是否是当前出牌者（current.by）
      const isCurrent = state.current !== null && state.current.by === seat;
      if (isCurrent) slot.classList.add('gd-played-slot--current');

      const slotLabel = document.createElement('div');
      slotLabel.className = 'gd-played-slot__label';
      slotLabel.textContent = SEAT_LABELS[seat];
      slot.appendChild(slotLabel);

      // 显示该座位当前桌面状态
      if (state.current !== null && state.current.by === seat) {
        // 这家是当前出牌者
        const cardsDiv = document.createElement('div');
        cardsDiv.className = 'gd-played-slot__cards';
        const combo = state.current.combo;
        for (const c of combo.cards.slice(0, 8)) {
          cardsDiv.appendChild(cardEl(c, LEVEL, true));
        }
        if (combo.cards.length > 8) {
          const more = document.createElement('span');
          more.style.fontSize = '0.7rem';
          more.style.color = 'var(--text-dim)';
          more.textContent = `+${combo.cards.length - 8}`;
          cardsDiv.appendChild(more);
        }
        const typeLabel = document.createElement('div');
        typeLabel.style.fontSize = '0.7rem';
        typeLabel.style.color = 'var(--gold)';
        typeLabel.textContent = comboTypeLabel(combo.type);
        slot.appendChild(cardsDiv);
        slot.appendChild(typeLabel);
      } else if (state.finished.includes(seat)) {
        const finishIdx = state.finished.indexOf(seat);
        const badge = document.createElement('span');
        badge.className = 'gd-seat__rank';
        badge.textContent = rankName(finishIdx);
        slot.appendChild(badge);
      } else {
        // 空位
      }

      area.appendChild(slot);
    }

    centerEl.appendChild(area);

    // 当前状态提示
    if (!isDealOver(state)) {
      const turnInfo = document.createElement('div');
      turnInfo.style.fontSize = '0.75rem';
      turnInfo.style.color = 'var(--text-dim)';
      const isFreeLead = state.current === null;
      if (state.turn === HUMAN_SEAT) {
        turnInfo.textContent = isFreeLead ? '自由出牌' : '请出牌或不要';
        turnInfo.style.color = 'var(--gold)';
      } else {
        turnInfo.textContent = `${SEAT_LABELS[state.turn]} 思考中…`;
      }
      centerEl.appendChild(turnInfo);
    }
  }

  /** 渲染玩家手牌（扇形交互） */
  function renderPlayerHand(): void {
    const el = seatEls[HUMAN_SEAT]!;
    el.innerHTML = '';

    // 标签行
    const label = document.createElement('div');
    label.className = 'gd-seat__label';
    if (state.turn === HUMAN_SEAT && !isDealOver(state)) label.classList.add('is-active');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'gd-seat__label-name';
    nameSpan.textContent = SEAT_LABELS[HUMAN_SEAT];

    const finishIdx = state.finished.indexOf(HUMAN_SEAT);
    if (finishIdx >= 0) {
      const badge = document.createElement('span');
      badge.className = 'gd-seat__rank';
      badge.textContent = rankName(finishIdx);
      label.appendChild(nameSpan);
      label.appendChild(badge);
    } else {
      const countSpan = document.createElement('span');
      countSpan.className = 'gd-seat__card-count';
      countSpan.textContent = `${state.hands[HUMAN_SEAT]!.length}张`;
      label.appendChild(nameSpan);
      label.appendChild(countSpan);
    }
    el.appendChild(label);

    // 手牌
    const hand = sortedHand(HUMAN_SEAT);
    const handEl = document.createElement('div');
    handEl.className = 'gd-player-hand';

    for (const card of hand) {
      const ce = cardEl(card, LEVEL);
      if (selectedIds.has(card.id)) ce.classList.add('is-selected');
      ce.addEventListener('click', () => {
        if (state.turn !== HUMAN_SEAT || isDealOver(state)) return;
        if (selectedIds.has(card.id)) {
          selectedIds.delete(card.id);
        } else {
          selectedIds.add(card.id);
        }
        renderAll();
      });
      handEl.appendChild(ce);
    }

    el.appendChild(handEl);
  }

  /** 更新按钮状态 */
  function renderButtons(): void {
    const isHumanTurn = state.turn === HUMAN_SEAT && !isDealOver(state);
    const isFreeLead = state.current === null;

    playBtn.disabled = !isHumanTurn;
    passBtn.disabled = !isHumanTurn || isFreeLead;
  }

  /** 全量渲染 */
  function renderAll(): void {
    for (const s of [1, 2, 3] as Seat[]) renderAiSeat(s);
    renderPlayerHand();
    renderCenter();
    renderButtons();
  }

  // ── 出牌逻辑 ──────────────────────────────────────────────────────────────

  /** 获取玩家当前选中的牌（从手牌中匹配 id） */
  function getSelectedCards(): Card[] {
    const hand = state.hands[HUMAN_SEAT]!;
    return hand.filter(c => selectedIds.has(c.id));
  }

  function handlePlay(): void {
    const cards = getSelectedCards();
    if (cards.length === 0) {
      showHint('请先选择要出的牌', 'error');
      return;
    }
    const hand = state.hands[HUMAN_SEAT]!;
    const legal = isLegalPlay(cards, state.current?.combo ?? null, hand, LEVEL);
    if (!legal) {
      showHint('所选牌不合法，请重新选择', 'error');
      return;
    }
    state = play(state, HUMAN_SEAT, cards);
    selectedIds.clear();
    showHint('', 'info');
    renderAll();
    if (!isDealOver(state)) {
      scheduleAi();
    } else {
      showResult();
    }
  }

  function handlePass(): void {
    if (state.current === null) return; // 首攻不能不要（按钮已禁用，双保险）
    state = pass(state, HUMAN_SEAT);
    selectedIds.clear();
    showHint('', 'info');
    renderAll();
    if (!isDealOver(state)) {
      scheduleAi();
    } else {
      showResult();
    }
  }

  // ── AI 自动推进 ──────────────────────────────────────────────────────────

  function scheduleAi(): void {
    if (isDealOver(state)) return;
    if (state.turn === HUMAN_SEAT) return;

    const t = window.setTimeout(() => {
      if (isDealOver(state)) return;
      if (state.turn === HUMAN_SEAT) return;

      const seat = state.turn;
      const decision = choosePlay(state, seat);

      try {
        if (decision === null) {
          state = pass(state, seat);
        } else {
          state = play(state, seat, decision);
        }
      } catch (e) {
        // 引擎 throw 说明状态不一致；放弃此步，避免死循环
        console.error('AI step error', e);
        return;
      }

      renderAll();

      if (isDealOver(state)) {
        showResult();
      } else if (state.turn !== HUMAN_SEAT) {
        scheduleAi();
      }
    }, 600);
    timers.push(t);
  }

  // ── 局终 ─────────────────────────────────────────────────────────────────

  function showResult(): void {
    const ranks = ranking(state);
    const gain = isDealOver(state) ? levelGain(state) : null;

    const overlay = document.createElement('div');
    overlay.className = 'gd-overlay';

    const box = document.createElement('div');
    box.className = 'gd-result';

    const title = document.createElement('div');
    title.className = 'gd-result__title';
    title.textContent = '本局结束';
    box.appendChild(title);

    const rankList = document.createElement('ul');
    rankList.className = 'gd-result__ranking';
    for (let i = 0; i < ranks.length; i++) {
      const li = document.createElement('li');
      li.textContent = `${rankName(i)}：${SEAT_LABELS[ranks[i]!]}`;
      rankList.appendChild(li);
    }
    box.appendChild(rankList);

    if (gain) {
      const gainEl = document.createElement('div');
      gainEl.className = 'gd-result__gain';
      const teamLabel = gain.team === 0 ? '你方（0&2队）' : '对手（1&3队）';
      gainEl.textContent = `${teamLabel} 升 ${gain.gain} 级`;
      box.appendChild(gainEl);
    }

    const restartBtn = document.createElement('button');
    restartBtn.className = 'gd-btn gd-btn--restart';
    restartBtn.textContent = '重新发牌';
    restartBtn.addEventListener('click', () => {
      overlay.remove();
      state = startNewDeal();
      selectedIds.clear();
      clearHint();
      renderAll();
      if (state.turn !== HUMAN_SEAT) scheduleAi();
    });
    box.appendChild(restartBtn);

    overlay.appendChild(box);
    gameEl.appendChild(overlay);
  }

  // ── 提示 ─────────────────────────────────────────────────────────────────

  function showHint(msg: string, type: 'error' | 'info'): void {
    hintEl.textContent = msg;
    hintEl.className = `gd-hint gd-hint--${type}`;
  }

  function clearHint(): void {
    hintEl.textContent = '';
    hintEl.className = 'gd-hint';
  }

  // ── 绑定事件 ─────────────────────────────────────────────────────────────

  playBtn.addEventListener('click', handlePlay);
  passBtn.addEventListener('click', handlePass);

  // ── 初次渲染 ─────────────────────────────────────────────────────────────

  renderAll();

  // 若首攻是 AI，立刻开始推进
  if (state.turn !== HUMAN_SEAT) {
    scheduleAi();
  }

  // ── 返回 unmount ─────────────────────────────────────────────────────────

  return () => {
    for (const t of timers) clearTimeout(t);
    timers.length = 0;
    root.innerHTML = '';
  };
}
