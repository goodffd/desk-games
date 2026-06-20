/**
 * view.ts — 掼蛋游戏视图：mount(root) → unmount
 *
 * 途游式牌桌：四家围坐（你=下 / 下家=右 / 对家=上 / 上家=左），每家一个头像(按队伍配色)，
 * 各家"上一手"摆在各自座位旁（朝中心），当前出牌方头像高亮；底部大手牌扇形。
 * 引擎只存当前最高一手(state.current)，视图层用 lastPlays 记录每家本圈的上一手。
 */

import './guandan.css';
import './joker-img.css';
import './rank-font.css';
import { navigate } from '../../../shell/nav';

import type { Card, Seat, Combo } from '../engine/types';
import { LEVEL } from '../engine/types';
import { makeDeck, deal, sortHand, rankValue } from '../engine/cards';
import { createDeal, play, pass, isDealOver, ranking, levelGain } from '../engine/game';
import type { DealState } from '../engine/game';
import { isLegalPlay } from '../engine/legal';
import { choosePlay } from '../ai/ai';
import { cardEl, comboSpeech, rankName } from './render';
import { VOICE_CLIPS } from './voice-clips';

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

/** 选系统里最自然的中文语音：增强/高级/Siri/网络语音优先，其次知名本地语音 */
let gdVoice: SpeechSynthesisVoice | null = null;
function pickVoice(): SpeechSynthesisVoice | null {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return null;
    const cn = synth.getVoices().filter(
      (v) => /zh([-_](cn|hans|sg))?/i.test(v.lang) || /chinese|中文|普通话|mandarin/i.test(v.name),
    );
    if (!cn.length) return null;
    const score = (v: SpeechSynthesisVoice): number => {
      const n = v.name.toLowerCase();
      let s = 0;
      if (/premium|enhanced|超清|高级|增强|神经|neural/.test(n)) s += 100;
      if (/siri/.test(n)) s += 60;
      if (/tingting|婷婷|meijia|美佳|sinji|li-?mu|yu-?shu/.test(n)) s += 30;
      if (!v.localService) s += 25; // 网络语音通常更自然
      if (/cn|hans/i.test(v.lang)) s += 10;
      return s;
    };
    return [...cn].sort((a, b) => score(b) - score(a))[0] ?? cn[0]!;
  } catch { return null; }
}
if (typeof window !== 'undefined' && window.speechSynthesis) {
  gdVoice = pickVoice();
  window.speechSynthesis.onvoiceschanged = (): void => { gdVoice = pickVoice(); };
}

/** 系统语音兜底（zh-CN），用挑好的高质量语音；不支持则静默 */
function speakTTS(text: string): void {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    if (!gdVoice) gdVoice = pickVoice();
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    if (gdVoice) u.voice = gdVoice;
    u.rate = 0.97;
    u.pitch = 1.08;
    synth.speak(u);
  } catch { /* 不支持语音则静默 */ }
}

/** 语音播报：优先播预生成的豆包2.0真人级 clip（自然有感情），无 clip / 被拦截则退回系统语音。
 *  iOS 需先有用户手势解锁音频（点出牌/进入即解锁），之后 AI 出牌也能响。
 *  gdSpeakEndAt = 本句预计结束时间戳，AI 出牌据此等本句报牌播完再出，避免被打断截断。 */
let gdAudio: HTMLAudioElement | null = null;
let gdSpeakEndAt = 0;
function speak(text: string): void {
  try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
  const now = performance.now();
  const clip = VOICE_CLIPS[text];
  if (clip) {
    try {
      if (!gdAudio) gdAudio = new Audio();
      gdAudio.pause();
      gdSpeakEndAt = now + 1300; // 保守估计，metadata 就绪后按真实时长校准
      gdAudio.onloadedmetadata = (): void => {
        const d = gdAudio?.duration ?? 0;
        if (isFinite(d) && d > 0) gdSpeakEndAt = performance.now() + d * 1000 + 200; // +200ms 小停顿
      };
      gdAudio.onended = (): void => { gdSpeakEndAt = 0; };
      gdAudio.src = clip;
      gdAudio.currentTime = 0;
      const p = gdAudio.play();
      if (p && typeof p.catch === 'function') p.catch(() => { gdSpeakEndAt = 0; speakTTS(text); }); // 被拦截 → 系统语音
      return;
    } catch { gdSpeakEndAt = 0; /* 落到系统语音 */ }
  }
  gdSpeakEndAt = now + 900; // 系统语音时长难测，给个估计，AI 也稍等
  speakTTS(text);
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
  // 对家(2)座位留在牌桌顶部；上家(3,左)/下家(1,右)座位改挂 gameEl，按整局全高竖向居中
  //（手机牌桌被手牌区压扁成窄条，若挂 tableEl 则 top:50% 只是窄条中点→旋转后跑偏到屏幕一侧）
  tableEl.appendChild(seatEls[2]);
  // 对家(2)/你(0)出牌区留牌桌；上家(3)/下家(1)出牌区跟随其座位挂 gameEl，与头像同高(top:50%)对齐
  for (const s of [0, 2] as Seat[]) tableEl.appendChild(playEls[s]);

  const statusEl = document.createElement('div');
  statusEl.className = 'gd-turn-status';
  tableEl.appendChild(statusEl);

  // 底部（上→下）：提示、按钮、你信息(头像)、手牌。按钮在头像上方，仅轮到我时显示
  const bottomArea = document.createElement('div');
  bottomArea.className = 'gd-bottom-area';

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
  bottomArea.appendChild(actionsEl);    // 按钮(在手牌上方)

  // 你的头像+名放手牌左侧（途游式：自己头像在手牌左侧，与牌留间隔）
  const handRow = document.createElement('div');
  handRow.className = 'gd-hand-row';
  handRow.appendChild(seatEls[0]);      // 你：手牌左侧
  const handEl = document.createElement('div');
  handEl.className = 'gd-player-hand';
  handRow.appendChild(handEl);
  bottomArea.appendChild(handRow);

  gameEl.appendChild(topbar);
  gameEl.appendChild(tableEl);
  gameEl.appendChild(bottomArea);
  gameEl.appendChild(seatEls[1]); // 下家(右)：相对 gameEl 全高竖向居中
  gameEl.appendChild(seatEls[3]); // 上家(左)：相对 gameEl 全高竖向居中
  gameEl.appendChild(playEls[1]); // 下家出牌区：跟随座位挂 gameEl，同高对齐
  gameEl.appendChild(playEls[3]); // 上家出牌区：同上
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
      const len = state.hands[seat]!.length;
      if (len <= 10) { // 仅剩 10 张及以下才显示张数，并光晕醒目提醒
        const count = document.createElement('span');
        count.className = 'gd-seat__count gd-seat__count--alert';
        count.textContent = `${len}`;
        info.appendChild(count);
      }
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
      // 牌型不再用文字说明，改用语音播报（见 applyPlay → speak）
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

  /** 造一张手牌（含选中态 + 滑动选牌按下事件） */
  function makeHandCard(card: Card): HTMLElement {
    const ce = cardEl(card, LEVEL);
    if (selectedIds.has(card.id)) ce.classList.add('is-selected');
    ce.addEventListener('pointerdown', (e) => {
      if (state.turn !== HUMAN_SEAT || isDealOver(state)) return;
      e.preventDefault();                    // 防文本选择/触摸滚动
      dragging = true;
      dragMode = !selectedIds.has(card.id);  // 起手牌决定本次划动是"选"还是"取消"
      applyCardSelect(card.id, dragMode);
    });
    return ce;
  }

  /** 玩家手牌：桌面=重叠扇形；手机=途游式同点数堆成一列省横向空间 */
  function renderHand(): void {
    handEl.innerHTML = '';
    // 展示顺序：左→右 大→小。级牌仅次于大小王由 rankValue/sortHand 保证
    const cards = [...sortedHand(HUMAN_SEAT)].reverse();
    // 桌面与手机统一：同点数堆成一列向上叠、列间重叠（途游式，省横向空间且角标花色不跨叠）
    handEl.classList.add('gd-hand--cols');

    const groups: Card[][] = [];
    const at = new Map<number, number>();
    for (const card of cards) {
      const v = rankValue(card, LEVEL);
      if (!at.has(v)) { at.set(v, groups.length); groups.push([]); }
      groups[at.get(v)!]!.push(card);
    }
    for (const g of groups) {
      const col = document.createElement('div');
      col.className = 'gd-hand-col';
      for (const card of g) col.appendChild(makeHandCard(card));
      handEl.appendChild(col);
    }
    // 按可用宽度横向收紧：列多则列间重叠，整排不溢出屏幕
    const colEls = handEl.querySelectorAll('.gd-hand-col');
    const nc = colEls.length;
    if (nc > 1) {
      const colW = (colEls[0] as HTMLElement).offsetWidth || 54;
      const meW = (seatEls[0] as HTMLElement)?.offsetWidth || 0; // 你头像占手牌左侧，可用宽要减掉，否则溢出
      const availW = (gameEl.clientWidth || 800) - meW - 20 - 10;
      // 列推进至少容下最宽角标(点数+花色)+缝，角标花色不被下一列盖。
      // 量点数宽(文字可靠)+按高估花色宽+间距——花色是图片宽度异步，直接量角标会漏掉它
      let maxRank = 0; // 视觉宽度(getBoundingClientRect 含 scaleX 压缩)，压缩后的「10」让列更紧凑
      handEl.querySelectorAll('.gd-card__rank').forEach((c) => { maxRank = Math.max(maxRank, c.getBoundingClientRect().width); });
      const suitH = ((handEl.querySelector('.gd-card__suit') as HTMLElement)?.offsetHeight) || 14;
      const suitW = suitH * 1.15; // 花色按高度估宽(最宽红心≈1.08)，不依赖异步图片宽度
      const maxCorner = maxRank + 4 + suitW; // 点数 + 间距 + 花色
      const fitStep = (availW - colW) / (nc - 1);
      const step = Math.min(fitStep, maxCorner + 9); // 角标右边留 ~5px 清楚的缝，花色不贴下一列；右下大花色可被盖一部分
      const ml = step - colW;                // 负=列间重叠
      colEls.forEach((c, i) => { if (i > 0) (c as HTMLElement).style.marginLeft = `${ml}px`; });
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
    actionsEl.style.display = isHumanTurn ? 'flex' : 'none'; // 途游式：仅轮到我时显示按钮
    playBtn.disabled = !isHumanTurn;
    passBtn.disabled = !isHumanTurn || state.current === null; // 自己领出时不能"不要"
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
    if (state.current) speak(comboSpeech(state.current.combo, LEVEL)); // 语音：牌型/具体点数(见 comboSpeech)
  }
  function applyPass(seat: Seat): void {
    state = pass(state, seat);
    lastPlays[seat] = 'pass';
    speak('不要');
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
    const act = (): void => {
      if (isDealOver(state) || state.turn === HUMAN_SEAT) return;
      // 上一手报牌还在播就再等，等播完再出，语音不被下一手打断截断
      const left = gdSpeakEndAt - performance.now();
      if (left > 0) { timers.push(window.setTimeout(act, Math.min(left + 50, 1600))); return; }
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
    };
    timers.push(window.setTimeout(act, 450)); // 基础思考时间；再叠加等上句报牌播完
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

  // iOS：音频要用户手势解锁。首次在游戏内按下时静音预热一下，之后 AI 出牌的语音也能响
  const primeAudio = (): void => {
    try {
      if (!gdAudio) gdAudio = new Audio();
      gdAudio.muted = true;
      gdAudio.src = VOICE_CLIPS['不要'] ?? '';
      const pr = gdAudio.play();
      if (pr && typeof pr.then === 'function') {
        pr.then(() => { if (gdAudio) { gdAudio.pause(); gdAudio.currentTime = 0; gdAudio.muted = false; } })
          .catch(() => { if (gdAudio) gdAudio.muted = false; });
      }
    } catch { /* ignore */ }
  };
  gameEl.addEventListener('pointerdown', primeAudio, { once: true });

  // 转屏/缩放后重算手牌重叠（可用宽度变了），避免溢出
  const onResize = (): void => { renderHand(); };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  renderAll();
  // 内嵌字体(GDRank)异步加载：首次布局可能用 fallback 字体量角标宽度→步进算错→角标花色跨叠。
  // 字体就绪后重算手牌，确保步进按真实点数宽度计算。
  if (document.fonts?.ready) void document.fonts.ready.then(() => { renderHand(); });
  if (state.turn !== HUMAN_SEAT) scheduleAi();

  return () => {
    for (const t of timers) clearTimeout(t);
    timers.length = 0;
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
    root.innerHTML = '';
  };
}
