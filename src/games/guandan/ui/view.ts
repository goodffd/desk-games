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

import type { Card, Seat, Combo, Rank } from '../engine/types';
import { makeDeck, deal, sortHand, rankValue } from '../engine/cards';
import { createDeal, play, pass, isDealOver, ranking } from '../engine/game';
import type { DealState } from '../engine/game';
import { isLegalPlay } from '../engine/legal';
import { choosePlay } from '../ai/ai';
import { cardEl, comboSpeech, rankName } from './render';
import { VOICE_CLIPS } from './voice-clips';
import {
  startMatch, settleDeal, planTribute, autoReturn, applyTribute, dealLevel,
  returnableCards, type MatchState, type TributePlan,
} from '../engine/match';

/** 级别(Rank 2..14) → 显示文字（打几）。 */
function levelLabel(r: Rank): string {
  return r === 11 ? 'J' : r === 12 ? 'Q' : r === 13 ? 'K' : r === 14 ? 'A' : String(r);
}

/** 队名：队 0 = 我方(你&对家)，队 1 = 对方(上家&下家)。 */
const teamName = (t: 0 | 1): string => (t === 0 ? '我方' : '对方');

/** 简短牌名（进贡提示用）。 */
function cardBrief(c: Card, level: Rank): string {
  if (c.kind === 'joker') return c.big ? '大王' : '小王';
  if (c.suit === 'H' && c.rank === level) return '红心配';
  const SU: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
  return `${levelLabel(c.rank)}${SU[c.suit] ?? ''}`;
}

const HUMAN_SEAT: Seat = 0;
const TURN_SECONDS = 20;   // 每回合倒计时秒数，超时自动出牌

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
function sortComboCards(cards: Card[], level: Rank): Card[] {
  const cnt = new Map<number, number>();
  for (const c of cards) { const v = rankValue(c, level); cnt.set(v, (cnt.get(v) ?? 0) + 1); }
  return [...cards].sort((a, b) => {
    const va = rankValue(a, level), vb = rankValue(b, level);
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

/** 发一局：按级牌 level 发牌+排序+定首攻（首局随机首攻；后续局由调用方传 hands/firstLeader）。 */
function startNewDeal(level: Rank, hands?: Card[][], firstLeader?: Seat): DealState {
  const dealt = hands ?? deal(makeDeck(), randomShuffle);
  const sortedHands = dealt.map(h => sortHand(h, level));
  const leader = firstLeader ?? (Math.floor(Math.random() * 4) as Seat);
  return createDeal(sortedHands, leader, level);
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
  let match: MatchState = startMatch();          // 整盘状态（两队级别/庄家/打A过A）
  let state = startNewDeal(dealLevel(match));     // 当前这一局
  let started = false;    // 点「开始游戏」后才置 true：之前不显示「思考中」等状态文字
  let selectedIds = new Set<number>();
  let dragging = false;   // 滑动选牌进行中
  let dragMode = true;    // 本次划动目标态：true=选中 / false=取消
  let lastPlays: Record<Seat, LastPlay> = { 0: null, 1: null, 2: null, 3: null };
  let lastActor: Seat | null = null; // 最近出牌/不要的人：其出牌区浮到手牌区之上，其余沉到手牌区之下
  const timers: number[] = [];
  let timedSeat: Seat | null = null; // 当前在倒计时的座位
  let turnStartedAt = 0;             // 本回合开始时间戳
  let turnTick: number | null = null;

  const sortedHand = (seat: Seat): Card[] => sortHand(state.hands[seat]!, state.level);

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
  // 顶栏中央：两队当前级别（打几），跨局实时更新
  const levelsEl = document.createElement('div');
  levelsEl.className = 'gd-topbar__levels';
  const backBtn = document.createElement('button');
  backBtn.className = 'gd-topbar__back';
  backBtn.textContent = '← 返回大厅';
  backBtn.addEventListener('click', () => { navigate('/'); });
  topbar.appendChild(topbarTitle);
  topbar.appendChild(levelsEl);
  topbar.appendChild(backBtn);
  function renderLevels(): void {
    levelsEl.innerHTML =
      `<span class="gd-lv gd-lv--me">我方 打${levelLabel(match.levels[0])}</span>` +
      `<span class="gd-lv__sep">·</span>` +
      `<span class="gd-lv gd-lv--them">对方 打${levelLabel(match.levels[1])}</span>`;
  }
  renderLevels();

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
  // 三家对手座位都挂 gameEl，按整局全高定位（手机牌桌被手牌压扁成窄条，挂 tableEl 会跑偏/串叠）
  // 四家出牌区也都挂 gameEl，按整局全高摆成围绕中心的菱形

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

  // 手牌行（你的头像不再在此：改为绝对定位到底部正中，与对家上下对称）
  const handRow = document.createElement('div');
  handRow.className = 'gd-hand-row';
  const handEl = document.createElement('div');
  handEl.className = 'gd-player-hand';
  handRow.appendChild(handEl);
  bottomArea.appendChild(handRow);

  // playfield = 菜单栏下方的「可玩区」：四家座位/出牌区都相对它定位，
  // 故 top:50%=可玩区竖向居中、对家(top:D)与你(bottom:D)关于可玩区上下对称、上家/下家居中。
  const playfield = document.createElement('div');
  playfield.className = 'gd-playfield';
  playfield.appendChild(tableEl);
  playfield.appendChild(bottomArea);
  playfield.appendChild(seatEls[0]); // 你(底部正中，与对家对称)
  playfield.appendChild(seatEls[1]); // 下家(右)
  playfield.appendChild(seatEls[2]); // 对家(上)
  playfield.appendChild(seatEls[3]); // 上家(左)
  // 四家出牌区菱形（围绕中心，朝各自方向偏，不压头像/手牌）
  playfield.appendChild(playEls[0]); // 你(下)
  playfield.appendChild(playEls[1]); // 下家(右)
  playfield.appendChild(playEls[2]); // 对家(上)
  playfield.appendChild(playEls[3]); // 上家(左)
  gameEl.appendChild(topbar);
  gameEl.appendChild(playfield);
  root.appendChild(gameEl);

  // ── 渲染 ───────────────────────────────────────────────────

  /** 座位信息块（头像 + 名 + 张数/名次）。用于三家对手与玩家自己 */
  function renderSeatInfo(seat: Seat): void {
    const elx = seatEls[seat]!;
    elx.innerHTML = '';
    const active = started && state.turn === seat && !isDealOver(state);
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
    // 轮到该家：信息下方放倒计时（闹钟动画），替代原「思考中」；超时自动出牌
    if (active) {
      const timer = document.createElement('div');
      timer.className = 'gd-seat__timer';
      timer.innerHTML = '<span class="gd-seat__clock">⏰</span><span class="gd-seat__timer-sec">' + TURN_SECONDS + '</span>';
      info.appendChild(timer);
    }
    elx.appendChild(info);
  }

  /** 某家"上一手"的展示（牌 / 不要 / 空） */
  function renderPlay(seat: Seat): void {
    const elx = playEls[seat]!;
    elx.innerHTML = '';
    // 最近出牌的人浮到手牌区之上(z 7>手牌6)，其余各家沉到手牌区之下(z 3<手牌6) → 只挡当前这手，不挡选牌
    elx.style.zIndex = seat === lastActor ? '7' : '3';
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
      for (const c of sortComboCards(lp.cards, state.level).slice(0, 14)) cardsDiv.appendChild(cardEl(c, state.level, true));
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
    const ce = cardEl(card, state.level);
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
      const v = rankValue(card, state.level);
      if (!at.has(v)) { at.set(v, groups.length); groups.push([]); }
      groups[at.get(v)!]!.push(card);
    }
    // 每列(同点数)内按花色排序：DOM 上→下 = 方块→梅花→红心→黑桃，即视觉上 黑桃在底、方块在顶。
    // 升序排，同花色自然相邻不被其他花色错开。大小王无花色，留在本列原位(各自单独成列)。
    const SUIT_ORDER: Record<string, number> = { D: 0, C: 1, H: 2, S: 3 };
    const suitKey = (c: Card): number => (c.kind === 'joker' ? -1 : (SUIT_ORDER[c.suit] ?? 0));
    for (const g of groups) g.sort((a, b) => suitKey(a) - suitKey(b));
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
      const availW = (gameEl.clientWidth || 800) - 30; // 你头像已移出手牌行，手牌占满整宽(留点边)
      // 列推进至少容下最宽角标(点数+花色)+缝，角标花色不被下一列盖。
      // 量点数宽(文字可靠)+按高估花色宽+间距——花色是图片宽度异步，直接量角标会漏掉它
      let maxRank = 0; // 视觉宽度(getBoundingClientRect 含 scaleX 压缩)，压缩后的「10」让列更紧凑
      handEl.querySelectorAll('.gd-card__rank').forEach((c) => { maxRank = Math.max(maxRank, c.getBoundingClientRect().width); });
      const suitH = ((handEl.querySelector('.gd-card__suit') as HTMLElement)?.offsetHeight) || 14;
      const suitW = suitH * 1.15; // 花色按高度估宽(最宽红心≈1.08)，不依赖异步图片宽度
      const maxCorner = maxRank + 4 + suitW; // 点数 + 间距 + 花色
      const fitStep = (availW - colW) / (nc - 1);
      const step = Math.min(fitStep, maxCorner + 6); // 列叠紧些：角标右留 ~2-3px 缝(牌缩小后角标也小，够用)
      const ml = step - colW;                // 负=列间重叠
      colEls.forEach((c, i) => { if (i > 0) (c as HTMLElement).style.marginLeft = `${ml}px`; });
    }
    // 「你」头像已绝对定位在底部正中(CSS)，不再随手牌动态摆位。
  }

  function renderStatus(): void {
    // 仅我方回合显中央状态；对手「思考中」移到各自头像上方(见 renderSeatInfo)
    if (!started || isDealOver(state) || state.turn !== HUMAN_SEAT) {
      statusEl.textContent = ''; statusEl.className = 'gd-turn-status'; return;
    }
    statusEl.textContent = state.current === null ? '该你出牌' : '请出牌或不要';
    statusEl.className = 'gd-turn-status gd-turn-status--yours';
  }

  function renderButtons(): void {
    const isHumanTurn = state.turn === HUMAN_SEAT && !isDealOver(state);
    actionsEl.style.display = isHumanTurn ? 'flex' : 'none'; // 途游式：仅轮到我时显示按钮
    playBtn.disabled = !isHumanTurn;
    passBtn.disabled = !isHumanTurn || state.current === null; // 自己领出时不能"不要"
  }

  /** 最新那手牌(z7=lastActor 的出牌区)是否几何上压到「具体某张手牌」 → 决定手牌要不要淡。
   *  所有人(含我自己)统一判定。不能用手牌容器整体包围盒：手牌是「同点数列底部对齐、各列高低不一」
   *  的阶梯形，容器矩形把短列上方的空角也算进去，出牌区落在空角会误判成压到。改为逐张牌矩形相交，
   *  且实质相交(两向都≥12px)才算压到——边缘相切不算，避免别家一出牌手牌就闪透明。 */
  function latestPlayCoversHand(): boolean {
    if (lastActor === null) return false;
    const pe = playEls[lastActor]!;
    if (!pe.classList.contains('has-play')) return false;
    const pr = pe.getBoundingClientRect();
    for (const card of Array.from(handEl.querySelectorAll('.gd-card'))) {
      const cr = card.getBoundingClientRect();
      const ix = Math.min(pr.right, cr.right) - Math.max(pr.left, cr.left);
      const iy = Math.min(pr.bottom, cr.bottom) - Math.max(pr.top, cr.top);
      if (ix >= 12 && iy >= 12) return true;
    }
    return false;
  }

  function renderAll(): void {
    for (const s of [0, 1, 2, 3] as Seat[]) { renderSeatInfo(s); renderPlay(s); }
    renderHand();
    renderStatus();
    renderButtons();
    syncTurnTimer();
    // 手牌半透明：最新那手牌(z7=lastActor，浮在手牌之上)——无论谁出的、含我自己——只要几何上压到我的
    // 手牌区，手牌就淡到 45%，让被盖住的牌/「不要」透出来看清；没压到就不淡。
    // 90° 旋转下各元素包围盒仍是正交矩形，元素间矩形相交判断准确。
    handEl.classList.toggle('gd-hand--dim', latestPlayCoversHand());
  }

  // ── 出牌（视图层同时维护 lastPlays） ────────────────────────
  function applyPlay(seat: Seat, cards: Card[]): void {
    const wasLead = state.current === null;
    state = play(state, seat, cards);
    if (wasLead) lastPlays = { 0: null, 1: null, 2: null, 3: null }; // 新一圈：清掉上圈
    lastPlays[seat] = state.current ? state.current.combo : null;
    lastActor = seat; // 这家刚出牌：其出牌区浮到手牌之上，下一家出牌时再沉下去
    if (state.current) speak(comboSpeech(state.current.combo, state.level)); // 语音：牌型/具体点数(见 comboSpeech)
  }
  function applyPass(seat: Seat): void {
    state = pass(state, seat);
    lastPlays[seat] = 'pass';
    lastActor = seat;
    speak('不要');
    // 一圈结束（其余全过）→ 赢家领新圈：清掉桌面所有出牌/不要，免得盖住赢家(尤其我)选牌
    if (state.current === null && !isDealOver(state)) {
      lastPlays = { 0: null, 1: null, 2: null, 3: null };
      lastActor = null;
    }
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

  // ── 回合倒计时（替代「思考中」）：超时自动出牌 ──────────────────
  /** 在 renderAll 后调用：检测回合切换 → 重置计时；启停 tick。 */
  function syncTurnTimer(): void {
    const active = (started && !isDealOver(state)) ? state.turn : null;
    if (active !== timedSeat) { timedSeat = active; turnStartedAt = performance.now(); }
    if (active === null) {
      if (turnTick !== null) { window.clearInterval(turnTick); turnTick = null; }
      return;
    }
    if (turnTick === null) turnTick = window.setInterval(tickTurn, 250);
    paintTurnTimer();
  }
  function paintTurnTimer(): void {
    if (timedSeat === null) return;
    const remain = Math.max(0, TURN_SECONDS - (performance.now() - turnStartedAt) / 1000);
    const sec = seatEls[timedSeat]!.querySelector('.gd-seat__timer-sec');
    if (sec) sec.textContent = String(Math.ceil(remain));
    const t = seatEls[timedSeat]!.querySelector('.gd-seat__timer');
    if (t) t.classList.toggle('gd-seat__timer--low', remain <= 5);
  }
  function tickTurn(): void {
    if (timedSeat === null || !started || isDealOver(state) || state.turn !== timedSeat) {
      if (turnTick !== null) { window.clearInterval(turnTick); turnTick = null; }
      return;
    }
    const remain = TURN_SECONDS - (performance.now() - turnStartedAt) / 1000;
    paintTurnTimer();
    if (remain <= 0) {
      const seat = timedSeat;
      if (turnTick !== null) { window.clearInterval(turnTick); turnTick = null; }
      autoPlayTimeout(seat);
    }
  }
  /** 回合超时：自动出一手（AI 策略兜底，保证合法）。 */
  function autoPlayTimeout(seat: Seat): void {
    if (!started || isDealOver(state) || state.turn !== seat) return;
    try {
      const decision = choosePlay(state, seat);
      if (decision === null) applyPass(seat);
      else applyPlay(seat, decision);
    } catch (e) {
      console.error('autoPlay error', e);
      if (state.current !== null) applyPass(seat); else return;
    }
    afterAction();
  }

  function handlePlay(): void {
    const cards = getSelectedCards();
    if (cards.length === 0) { showHint('请先选择要出的牌', 'error'); return; }
    if (!isLegalPlay(cards, state.current?.combo ?? null, state.hands[HUMAN_SEAT]!, state.level)) {
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
    timers.push(window.setTimeout(act, 1200 + Math.floor(Math.random() * 1300))); // 思考 1.2~2.5s(让倒计时可见)+ 等上句报牌播完
  }

  // ── 局终 / 整盘编排 ─────────────────────────────────────────
  /** 重置整盘从打 2 开打（再来一盘）。 */
  function freshMatch(): void {
    match = startMatch();
    state = startNewDeal(dealLevel(match));
    selectedIds.clear();
    lastPlays = { 0: null, 1: null, 2: null, 3: null };
    lastActor = null;
    renderLevels();
    clearHint();
    renderAll();
    if (state.turn !== HUMAN_SEAT) scheduleAi();
  }

  /** 进贡结束后真正开新局（清状态、渲染、AI 接手）。 */
  function startDealAfterTribute(level: Rank, tributed: Card[][], firstLeader: Seat): void {
    state = startNewDeal(level, tributed, firstLeader);
    selectedIds.clear();
    lastPlays = { 0: null, 1: null, 2: null, 3: null };
    lastActor = null;
    renderAll();
    if (state.turn !== HUMAN_SEAT) scheduleAi();
  }

  /** 进下一局：按新级牌发牌 → 进贡/还贡(人类收贡手选、AI 自动) → 定首攻开局。 */
  function nextDeal(): void {
    const finished = ranking(state);     // 上一局名次（settle 已用，进贡再用）
    const level = dealLevel(match);      // 新级牌 = 上局赢家队级别
    const dealt = deal(makeDeck(), randomShuffle);
    const plan = planTribute(finished, dealt, level);
    if (plan.resist) {
      startDealAfterTribute(level, dealt, plan.firstLeader);
      showHint('对方持两张大王，抗贡！本局免进贡', 'info');
      return;
    }
    // 进贡阶段（含进贡动画 + 人类还贡手选）
    showTribute(dealt, plan, level, (returns) => {
      const tributed = applyTribute(dealt, plan, returns);
      startDealAfterTribute(level, tributed, plan.firstLeader);
      const parts = plan.exchanges.map(ex =>
        `${SEAT_LABELS[ex.giver]}进贡${cardBrief(ex.tribute, level)}给${SEAT_LABELS[ex.receiver]}`);
      showHint(parts.join('；'), 'info');
    });
  }

  /**
   * 进贡阶段弹层：展示进贡(动画滑入) + 人类收贡时手选 ≤10 还贡。点「确定」回调 returns 开局。
   * 人类为收贡方时须手选；AI 收贡 autoReturn；人类仅为进贡方时无需选(进贡牌自动取最大)。
   */
  function showTribute(dealt: Card[][], plan: TributePlan, level: Rank, onDone: (returns: Card[]) => void): void {
    const overlay = document.createElement('div');
    overlay.className = 'gd-overlay';
    const box = document.createElement('div');
    box.className = 'gd-tribute';
    const title = document.createElement('div');
    title.className = 'gd-result__title';
    title.textContent = '进贡 · 还贡';
    box.appendChild(title);

    const returns: Card[] = new Array(plan.exchanges.length);
    let humanIdx = -1; // 人类作为收贡方的 exchange 下标

    plan.exchanges.forEach((ex, i) => {
      const row = document.createElement('div');
      row.className = 'gd-tribute__row';
      const g = document.createElement('span');
      g.className = 'gd-tribute__who'; g.textContent = SEAT_LABELS[ex.giver];
      const arrow = document.createElement('span');
      arrow.className = 'gd-tribute__arrow'; arrow.textContent = '进贡 ⟶';
      const card = cardEl(ex.tribute, level, true);
      card.classList.add('gd-tribute__fly');
      const r = document.createElement('span');
      r.className = 'gd-tribute__who'; r.textContent = SEAT_LABELS[ex.receiver];
      row.append(g, arrow, card, r);
      box.appendChild(row);
      if (ex.receiver === HUMAN_SEAT) humanIdx = i;
      else returns[i] = autoReturn(dealt[ex.receiver]!, level);
    });

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'gd-btn gd-btn--restart';

    if (humanIdx >= 0) {
      const ex = plan.exchanges[humanIdx]!;
      const cands = returnableCards(dealt[HUMAN_SEAT]!, level);
      const pool = sortHand(cands.length ? cands : dealt[HUMAN_SEAT]!, level); // 无≤10兜底全手牌
      const hint = document.createElement('div');
      hint.className = 'gd-tribute__hint';
      hint.textContent = `你收到 ${cardBrief(ex.tribute, level)}，选一张${cands.length ? ' ≤10 ' : ''}牌还贡给 ${SEAT_LABELS[ex.giver]}`;
      box.appendChild(hint);
      const picks = document.createElement('div');
      picks.className = 'gd-tribute__picks';
      for (const c of pool) {
        const ce = cardEl(c, level, true);
        ce.classList.add('gd-tribute__pickcard');
        ce.addEventListener('click', () => {
          returns[humanIdx] = c;
          picks.querySelectorAll('.gd-tribute__pickcard').forEach(x => x.classList.remove('is-picked'));
          ce.classList.add('is-picked');
          confirmBtn.disabled = false;
        });
        picks.appendChild(ce);
      }
      box.appendChild(picks);
      confirmBtn.disabled = true; // 须先选还贡牌
    }

    confirmBtn.textContent = '确定，开局';
    confirmBtn.addEventListener('click', () => {
      overlay.remove();
      onDone(returns);
    });
    box.appendChild(confirmBtn);
    overlay.appendChild(box);
    gameEl.appendChild(overlay);
  }

  function showResult(): void {
    const ranks = ranking(state);
    const settle = settleDeal(match, ranks);
    match = settle.match;            // 升级 / 打A过A 已结算
    renderLevels();

    const overlay = document.createElement('div');
    overlay.className = 'gd-overlay';
    const box = document.createElement('div');
    box.className = 'gd-result';
    const title = document.createElement('div');
    title.className = 'gd-result__title';
    title.textContent = settle.passedA ? `🎉 ${teamName(settle.winTeam)}打 A 过 A，赢下整盘！` : '本局结束';
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
    if (settle.passedA) {
      gainEl.textContent = `${teamName(settle.winTeam)}（${settle.winTeam === 0 ? '你&对家' : '上家&下家'}）打 A 过 A，胜！`;
    } else if (settle.demoted) {
      gainEl.textContent = `${teamName(settle.winTeam)}连续卡 A 三次，降回 打2`;
    } else if (settle.stuck) {
      gainEl.textContent = `${teamName(settle.winTeam)}卡 A（对家末游、差一级没过），继续打 A`;
    } else {
      gainEl.textContent = `${teamName(settle.winTeam)}升 ${settle.gain} 级 → 打${levelLabel(match.levels[settle.winTeam])}`;
    }
    box.appendChild(gainEl);

    // 末游没出完的牌（本局结束时仍在手）
    const last = ranks[3]!;
    const leftover = sortHand(state.hands[last]!, state.level);
    if (leftover.length > 0) {
      const lbl = document.createElement('div');
      lbl.className = 'gd-result__leftlabel';
      lbl.textContent = `末游 ${SEAT_LABELS[last]} 剩 ${leftover.length} 张`;
      box.appendChild(lbl);
      const lcards = document.createElement('div');
      lcards.className = 'gd-result__leftover';
      for (const c of leftover) lcards.appendChild(cardEl(c, state.level, true));
      box.appendChild(lcards);
    }

    const btn = document.createElement('button');
    btn.className = 'gd-btn gd-btn--restart';
    btn.textContent = settle.match.over ? '再来一盘' : '下一局';
    btn.addEventListener('click', () => {
      overlay.remove();
      if (settle.match.over) freshMatch();
      else nextDeal();
    });
    box.appendChild(btn);
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
  // 转屏/缩放后重算手牌重叠（可用宽度变了），避免溢出
  const onResize = (): void => { renderHand(); };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  renderAll();
  // 内嵌字体(GDRank)异步加载：首次布局可能用 fallback 字体量角标宽度→步进算错→角标花色跨叠。
  // 字体就绪后重算手牌，确保步进按真实点数宽度计算。
  if (document.fonts?.ready) void document.fonts.ready.then(() => { renderHand(); });

  // 「开始游戏」遮罩：点一下=用户手势，解锁 iOS 音频（首轮 AI 出牌语音才响），再开局
  const startOverlay = document.createElement('div');
  startOverlay.className = 'gd-start';
  const startBtn = document.createElement('button');
  startBtn.className = 'gd-start__btn';
  startBtn.textContent = '开始游戏';
  startOverlay.appendChild(startBtn);
  startBtn.addEventListener('click', () => {
    primeAudio();
    startOverlay.remove();
    started = true;
    renderAll(); // 开始后才显示状态/思考中浮标
    if (state.turn !== HUMAN_SEAT) scheduleAi();
  });
  gameEl.appendChild(startOverlay);

  return () => {
    for (const t of timers) clearTimeout(t);
    timers.length = 0;
    if (turnTick !== null) { window.clearInterval(turnTick); turnTick = null; }
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
    root.innerHTML = '';
  };
}
