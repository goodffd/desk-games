/**
 * view.ts — 掼蛋游戏视图：mount(root) → unmount
 *
 * 途游式牌桌：四家围坐（你=下 / 下家=右 / 对家=上 / 上家=左），每家一个头像(按队伍配色)，
 * 各家"上一手"摆在各自座位旁（朝中心），当前出牌方头像高亮；底部大手牌扇形。
 * 引擎只存当前最高一手(state.current)，视图层用 lastPlays 记录每家本圈的上一手。
 */

import './guandan.css';
import './joker-img.css';
import { navigate } from '../../../shell/nav';

import type { Card, Seat, Combo } from '../engine/types';
import { LEVEL } from '../engine/types';
import { makeDeck, deal, sortHand, rankValue } from '../engine/cards';
import { createDeal, play, pass, isDealOver, ranking, levelGain } from '../engine/game';
import type { DealState } from '../engine/game';
import { isLegalPlay } from '../engine/legal';
import { choosePlay } from '../ai/ai';
import { cardEl, comboTypeLabel, rankName } from './render';

const HUMAN_SEAT: Seat = 0;

// 座位名称。出牌序 0→1→2→3（逆时针）：座1=右(下家) 座2=上(对家) 座3=左(上家)
const SEAT_LABELS: Record<Seat, string> = { 0: '你', 1: '下家', 2: '对家', 3: '上家' };
// 屏幕方位
const SEAT_POS: Record<Seat, string> = { 0: 'bottom', 1: 'right', 2: 'top', 3: 'left' };

type LastPlay = Combo | 'pass' | null;

function randomShuffle(n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** 出牌展示排序：同点数聚一起，组越大越靠前（三带二=三同在前/对子在后；连对/钢板/顺子自然成组） */
function sortComboCards(cards: Card[]): Card[] {
  const cnt = new Map<number, number>();
  for (const c of cards) { const v = rankValue(c, LEVEL); cnt.set(v, (cnt.get(v) ?? 0) + 1); }
  return [...cards].sort((a, b) => {
    const va = rankValue(a, LEVEL), vb = rankValue(b, LEVEL);
    const ca = cnt.get(va)!, cb = cnt.get(vb)!;
    if (ca !== cb) return cb - ca; // 大组在前
    return va - vb;                // 同组按点数升序
  });
}

function startNewDeal(): DealState {
  const deck = makeDeck();
  const hands = deal(deck, randomShuffle);
  const sortedHands = hands.map(h => sortHand(h, LEVEL));
  const firstLeader = Math.floor(Math.random() * 4) as Seat;
  return createDeal(sortedHands, firstLeader, LEVEL);
}

/** 头像：圆形 + 简笔人像，按队伍(座%2)配色 */
function avatarEl(seat: Seat): HTMLElement {
  const av = document.createElement('div');
  av.className = `gd-avatar gd-avatar--team${seat % 2}`;
  av.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<circle cx="12" cy="9" r="4.2" fill="currentColor"/>' +
    '<path d="M3.5 21 C3.5 14.8 8 13 12 13 C16 13 20.5 14.8 20.5 21 Z" fill="currentColor"/>' +
    '</svg>';
  return av;
}

export function mount(root: HTMLElement): () => void {
  let state = startNewDeal();
  let selectedIds = new Set<number>();
  let dragging = false;   // 滑动选牌进行中
  let dragMode = true;    // 本次划动目标态：true=选中 / false=取消
  let lastPlays: Record<Seat, LastPlay> = { 0: null, 1: null, 2: null, 3: null };
  const timers: number[] = [];

  const sortedHand = (seat: Seat): Card[] => sortHand(state.hands[seat]!, LEVEL);

  // ── DOM 骨架 ───────────────────────────────────────────────
  root.innerHTML = '';
  const gameEl = document.createElement('div');
  gameEl.className = 'gd-game';

  // 顶栏
  const topbar = document.createElement('div');
  topbar.className = 'gd-topbar';
  const topbarTitle = document.createElement('span');
  topbarTitle.className = 'gd-topbar__title';
  topbarTitle.textContent = '掼蛋';
  const backBtn = document.createElement('button');
  backBtn.className = 'gd-topbar__back';
  backBtn.textContent = '← 返回大厅';
  backBtn.addEventListener('click', () => { navigate('/'); });
  topbar.appendChild(topbarTitle);
  topbar.appendChild(backBtn);

  // 牌桌（绝对定位四家 + 四个出牌区 + 中央状态）
  const tableEl = document.createElement('div');
  tableEl.className = 'gd-table';

  const seatEls: Record<Seat, HTMLElement> = { 0: el(), 1: el(), 2: el(), 3: el() };
  const playEls: Record<Seat, HTMLElement> = { 0: el(), 1: el(), 2: el(), 3: el() };
  function el(): HTMLElement { return document.createElement('div'); }
  for (const s of [0, 1, 2, 3] as Seat[]) {
    seatEls[s].className = `gd-seat gd-seat--${SEAT_POS[s]}`;
    playEls[s].className = `gd-play gd-play--${SEAT_POS[s]}`;
  }
  // 三家对手 + 三个出牌区放进牌桌；玩家(0)出牌区也在牌桌底部（手牌在下方 bottomArea）
  for (const s of [1, 2, 3] as Seat[]) tableEl.appendChild(seatEls[s]);
  for (const s of [0, 1, 2, 3] as Seat[]) tableEl.appendChild(playEls[s]);

  const statusEl = document.createElement('div');
  statusEl.className = 'gd-turn-status';
  tableEl.appendChild(statusEl);

  // 底部：玩家信息 + 手牌 + 按钮
  const bottomArea = document.createElement('div');
  bottomArea.className = 'gd-bottom-area';
  bottomArea.appendChild(seatEls[0]);   // 玩家信息行（头像+名+张数）
  const handEl = document.createElement('div');
  handEl.className = 'gd-player-hand';
  bottomArea.appendChild(handEl);

  const hintEl = document.createElement('div');
  hintEl.className = 'gd-hint';
  bottomArea.appendChild(hintEl);

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
  bottomArea.appendChild(actionsEl);

  gameEl.appendChild(topbar);
  gameEl.appendChild(tableEl);
  gameEl.appendChild(bottomArea);
  root.appendChild(gameEl);

  // ── 渲染 ───────────────────────────────────────────────────

  /** 座位信息块（头像 + 名 + 张数/名次）。用于三家对手与玩家自己 */
  function renderSeatInfo(seat: Seat): void {
    const elx = seatEls[seat]!;
    elx.innerHTML = '';
    const active = state.turn === seat && !isDealOver(state);
    elx.classList.toggle('is-active', active);

    elx.appendChild(avatarEl(seat));

    const info = document.createElement('div');
    info.className = 'gd-seat__info';
    const name = document.createElement('span');
    name.className = 'gd-seat__name';
    name.textContent = SEAT_LABELS[seat];
    info.appendChild(name);

    const finishIdx = state.finished.indexOf(seat);
    if (finishIdx >= 0) {
      const badge = document.createElement('span');
      badge.className = 'gd-seat__rank';
      badge.textContent = rankName(finishIdx);
      info.appendChild(badge);
    } else {
      const count = document.createElement('span');
      count.className = 'gd-seat__count';
      count.textContent = `${state.hands[seat]!.length}`;
      info.appendChild(count);
    }
    elx.appendChild(info);
  }

  /** 某家"上一手"的展示（牌 / 不要 / 空） */
  function renderPlay(seat: Seat): void {
    const elx = playEls[seat]!;
    elx.innerHTML = '';
    const lp = lastPlays[seat];
    if (lp === null) { elx.classList.remove('has-play'); return; }
    elx.classList.add('has-play');
    if (lp === 'pass') {
      const pass = document.createElement('div');
      pass.className = 'gd-play__pass';
      pass.textContent = '不要';
      elx.appendChild(pass);
    } else {
      const cardsDiv = document.createElement('div');
      cardsDiv.className = 'gd-play__cards';
      for (const c of sortComboCards(lp.cards).slice(0, 14)) cardsDiv.appendChild(cardEl(c, LEVEL, true));
      elx.appendChild(cardsDiv);
      const type = document.createElement('div');
      type.className = 'gd-play__type';
      type.textContent = comboTypeLabel(lp.type);
      elx.appendChild(type);
    }
  }

  /** 选/弃一张牌：更新集合 + 直接切类，不整屏重渲（保证滑动顺滑；选牌不影响按钮态） */
  function applyCardSelect(id: number, sel: boolean): void {
    const ce = handEl.querySelector(`.gd-card[data-card-id="${id}"]`) as HTMLElement | null;
    if (sel) { selectedIds.add(id); ce?.classList.add('is-selected'); }
    else { selectedIds.delete(id); ce?.classList.remove('is-selected'); }
  }
  /** 屏幕坐标下的手牌 id（滑动经过判定，鼠标/触摸通用） */
  function cardIdAtPoint(x: number, y: number): number | null {
    const t = document.elementFromPoint(x, y);
    const card = t && (t as HTMLElement).closest('.gd-card');
    if (!card || !handEl.contains(card)) return null;
    const id = (card as HTMLElement).dataset['cardId'];
    return id ? Number(id) : null;
  }

  /** 玩家手牌（扇形，可选） */
  function renderHand(): void {
    handEl.innerHTML = '';
    // 展示顺序：左→右 大→小（即从右到左 小→大）。级牌仅次于大小王由 rankValue/sortHand 保证
    const cards = [...sortedHand(HUMAN_SEAT)].reverse();
    for (const card of cards) {
      const ce = cardEl(card, LEVEL);
      if (selectedIds.has(card.id)) ce.classList.add('is-selected');
      // 滑动选牌：按下即定本次目标态(选/弃)并应用到起手牌；滑过的牌由全局 pointermove 接力
      ce.addEventListener('pointerdown', (e) => {
        if (state.turn !== HUMAN_SEAT || isDealOver(state)) return;
        e.preventDefault();                    // 防文本选择/触摸滚动
        dragging = true;
        dragMode = !selectedIds.has(card.id);  // 起手牌决定本次划动是"选"还是"取消"
        applyCardSelect(card.id, dragMode);
      });
      handEl.appendChild(ce);
    }
    // 动态重叠：按可用宽度算每张露出量，既放得下 27 张又尽量露出点数/花色
    const cw = 80, n = cards.length;
    if (n > 1) {
      const availW = (gameEl.clientWidth || 900) - 16;
      let step = (availW - cw) / (n - 1);
      step = Math.max(26, Math.min(step, 30));
      const m = (step - cw) / 2;
      handEl.querySelectorAll('.gd-card').forEach(c => { (c as HTMLElement).style.margin = `0 ${m}px`; });
    }
  }

  function renderStatus(): void {
    if (isDealOver(state)) { statusEl.textContent = ''; statusEl.className = 'gd-turn-status'; return; }
    const isFreeLead = state.current === null;
    if (state.turn === HUMAN_SEAT) {
      statusEl.textContent = isFreeLead ? '该你出牌' : '请出牌或不要';
      statusEl.className = 'gd-turn-status gd-turn-status--yours';
    } else {
      statusEl.textContent = `${SEAT_LABELS[state.turn]} 思考中…`;
      statusEl.className = 'gd-turn-status';
    }
  }

  function renderButtons(): void {
    const isHumanTurn = state.turn === HUMAN_SEAT && !isDealOver(state);
    playBtn.disabled = !isHumanTurn;
    passBtn.disabled = !isHumanTurn || state.current === null;
  }

  function renderAll(): void {
    for (const s of [0, 1, 2, 3] as Seat[]) { renderSeatInfo(s); renderPlay(s); }
    renderHand();
    renderStatus();
    renderButtons();
  }

  // ── 出牌（视图层同时维护 lastPlays） ────────────────────────
  function applyPlay(seat: Seat, cards: Card[]): void {
    const wasLead = state.current === null;
    state = play(state, seat, cards);
    if (wasLead) lastPlays = { 0: null, 1: null, 2: null, 3: null }; // 新一圈：清掉上圈
    lastPlays[seat] = state.current ? state.current.combo : null;
  }
  function applyPass(seat: Seat): void {
    state = pass(state, seat);
    lastPlays[seat] = 'pass';
  }

  function getSelectedCards(): Card[] {
    return state.hands[HUMAN_SEAT]!.filter(c => selectedIds.has(c.id));
  }

  function afterAction(): void {
    selectedIds.clear();
    showHint('', 'info');
    renderAll();
    if (isDealOver(state)) showResult();
    else if (state.turn !== HUMAN_SEAT) scheduleAi();
  }

  function handlePlay(): void {
    const cards = getSelectedCards();
    if (cards.length === 0) { showHint('请先选择要出的牌', 'error'); return; }
    if (!isLegalPlay(cards, state.current?.combo ?? null, state.hands[HUMAN_SEAT]!, LEVEL)) {
      showHint('所选牌不合法，请重新选择', 'error'); return;
    }
    applyPlay(HUMAN_SEAT, cards);
    afterAction();
  }

  function handlePass(): void {
    if (state.current === null) return;
    applyPass(HUMAN_SEAT);
    afterAction();
  }

  // ── AI 自动推进 ────────────────────────────────────────────
  function scheduleAi(): void {
    if (isDealOver(state) || state.turn === HUMAN_SEAT) return;
    const t = window.setTimeout(() => {
      if (isDealOver(state) || state.turn === HUMAN_SEAT) return;
      const seat = state.turn;
      const decision = choosePlay(state, seat);
      try {
        if (decision === null) applyPass(seat);
        else applyPlay(seat, decision);
      } catch (e) {
        console.error('AI step error', e);
        return;
      }
      renderAll();
      if (isDealOver(state)) showResult();
      else if (state.turn !== HUMAN_SEAT) scheduleAi();
    }, 650);
    timers.push(t);
  }

  // ── 局终 ───────────────────────────────────────────────────
  function showResult(): void {
    const ranks = ranking(state);
    const gain = levelGain(state);
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
    const gainEl = document.createElement('div');
    gainEl.className = 'gd-result__gain';
    gainEl.textContent = `${gain.team === 0 ? '你方（你&对家）' : '对手（上家&下家）'} 升 ${gain.gain} 级`;
    box.appendChild(gainEl);
    const restartBtn = document.createElement('button');
    restartBtn.className = 'gd-btn gd-btn--restart';
    restartBtn.textContent = '重新发牌';
    restartBtn.addEventListener('click', () => {
      overlay.remove();
      state = startNewDeal();
      selectedIds.clear();
      lastPlays = { 0: null, 1: null, 2: null, 3: null };
      clearHint();
      renderAll();
      if (state.turn !== HUMAN_SEAT) scheduleAi();
    });
    box.appendChild(restartBtn);
    overlay.appendChild(box);
    gameEl.appendChild(overlay);
  }

  // ── 提示 ───────────────────────────────────────────────────
  function showHint(msg: string, type: 'error' | 'info'): void {
    hintEl.textContent = msg;
    hintEl.className = `gd-hint gd-hint--${type}`;
  }
  function clearHint(): void { hintEl.textContent = ''; hintEl.className = 'gd-hint'; }

  // ── 绑定 + 初次渲染 ────────────────────────────────────────
  playBtn.addEventListener('click', handlePlay);
  passBtn.addEventListener('click', handlePass);

  // 滑动选牌：手牌区内 pointermove 经过的牌切到同一目标态；任意处松手结束
  const onHandPointerMove = (e: PointerEvent): void => {
    if (!dragging) return;
    const id = cardIdAtPoint(e.clientX, e.clientY);
    if (id !== null && selectedIds.has(id) !== dragMode) applyCardSelect(id, dragMode);
  };
  const onPointerUp = (): void => { dragging = false; };
  handEl.addEventListener('pointermove', onHandPointerMove);
  window.addEventListener('pointerup', onPointerUp);

  renderAll();
  if (state.turn !== HUMAN_SEAT) scheduleAi();

  return () => {
    for (const t of timers) clearTimeout(t);
    timers.length = 0;
    window.removeEventListener('pointerup', onPointerUp);
    root.innerHTML = '';
  };
}
