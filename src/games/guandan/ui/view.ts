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
import { sortHand, rankValue } from '../engine/cards';
import { isDealOver, ranking } from '../engine/game';
import { enumerateFollows } from '../engine/legal';
import { cardEl, rankName } from './render';
import { sortComboCards } from './combo-order';
import { VOICE_CLIPS } from './voice-clips';
import type { DealOutcome, TributePrompt, GameDriver } from '../driver/types';

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

/** AI 等本句报牌播完才出下一手：剩余毫秒（注入给 driver，保持 driver DOM-free）。 */
export function speechBusyMs(): number { return Math.max(0, gdSpeakEndAt - performance.now()); }

/** 联机整盘结束「再来一盘」只对房主显示（本地恒 true）。控制器在挂联机牌桌前调 setTableHost。 */
let tableIsHost = true;
export function setTableHost(v: boolean): void { tableIsHost = v; }

/** 联机各座昵称（view 座序，已 egocentric 旋转；本地为 null→用 你/下家/对家/上家）。 */
let seatNames: (string | null)[] | null = null;
export function setSeatNames(names: (string | null)[] | null): void { seatNames = names; }

/** 观战：观众没有自己的手牌（服务端只下发公开态，底部手牌全是占位牌）——底部不渲染大手牌、不显示
 *  出牌按钮，只看四家公开信息(头像/名/张数)与桌面出牌。控制器挂牌桌前 setSpectator(mySeat==='spectator')。 */
let spectator = false;
export function setSpectator(v: boolean): void { spectator = v; }

/** iOS：音频要用户手势解锁。首次点击时用无声 clip 预热，之后 AI/对家出牌语音也能响。
 *  预热源必须真无声：WebKit 上 play 刚 resolve 时 pause()/muted 不可靠（元素报 paused 但管线继续放完），
 *  拿真实语音 clip + muted 预热会整段出声（Safari 进大厅播报「不要」bug）。
 *  本地由「开始游戏」遮罩调；联机由前置 UI 的点击手势调。 */
const SILENT_CLIP = // 50ms 静音 WAV(8kHz/16bit/mono)，播完自停，无需 pause/muted
  'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
export function primeAudio(): void {
  try {
    if (!gdAudio) gdAudio = new Audio();
    gdAudio.src = SILENT_CLIP;
    const pr = gdAudio.play();
    if (pr && typeof pr.catch === 'function') pr.catch(() => { /* 被拦截无妨：speak 有系统语音兜底 */ });
  } catch { /* ignore */ }
}

// 三种头像图案：在线=简笔人像；掉线=灰人像+右下断线角标(橙)；AI接管=机器人头
const PERSON_SVG =                                                // 人像：头+肩，整体在圆内垂直居中
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<circle cx="12" cy="8" r="4.2" fill="currentColor"/>' +
  '<path d="M3.5 20 C3.5 13.8 8 12 12 12 C16 12 20.5 13.8 20.5 20 Z" fill="currentColor"/>' +
  '</svg>';
const OFFLINE_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<circle cx="11" cy="8.5" r="4" fill="currentColor"/>' +
  '<path d="M3 20.5 C3 14.6 7 12.8 11 12.8 C12.5 12.8 14 13.05 15.3 13.7 L15.3 20.5 Z" fill="currentColor"/>' +
  '<circle cx="18" cy="17.6" r="5" fill="#c8612a"/>' +          /* 断线角标：橙圆 */
  '<path d="M15.7 19.9 L20.3 15.3" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/>' + /* 斜杠 */
  '</svg>';
const AI_SVG =                                                    // 方头机器人：头+天线队伍色(深背景可见)、眼/嘴深色挖空；天线+头整体在圆内垂直居中
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<line x1="12" y1="5.6" x2="12" y2="9" stroke="currentColor" stroke-width="1.7"/>' +   /* 天线杆 */
  '<circle cx="12" cy="5.2" r="1.5" fill="currentColor"/>' +                             /* 天线顶 */
  '<rect x="5" y="8.8" width="14" height="11" rx="3" fill="currentColor"/>' +            /* 方头(队伍色) */
  '<circle cx="9.5" cy="13.8" r="1.6" fill="#1d242e"/>' +                                /* 眼 */
  '<circle cx="14.5" cy="13.8" r="1.6" fill="#1d242e"/>' +
  '<rect x="9" y="16.8" width="6" height="1.5" rx="0.7" fill="#1d242e"/>' +              /* 嘴 */
  '</svg>';
/** 头像：圆形，按状态出图案——在线人像(队伍配色)/掉线灰人像+断线标/AI机器人头 */
function avatarEl(seat: Seat, status: 'online' | 'disconnected' | 'ai' = 'online'): HTMLElement {
  const av = document.createElement('div');
  if (status === 'ai') { av.className = `gd-avatar gd-avatar--team${seat % 2}`; av.innerHTML = AI_SVG; }       // 机器人，头用该座队伍色(同人像)
  else if (status === 'disconnected') { av.className = 'gd-avatar gd-avatar--offline'; av.innerHTML = OFFLINE_SVG; }
  else { av.className = `gd-avatar gd-avatar--team${seat % 2}`; av.innerHTML = PERSON_SVG; }
  return av;
}

export function mountTable(root: HTMLElement, driver: GameDriver): () => void {
  // 牌桌视图：driver 注入（OnlineDriver；规则/AI/进贡全在服务端，单机=联机1人+3AI）。view 只读快照渲染、调动作、订阅事件。
  // 渲染镜像：onChange 把 driver.snapshot() 拷进这些变量后 renderAll（渲染函数体原样不改）。
  const snap0 = driver.snapshot();
  let state = snap0.state;            // 当前这一局引擎态
  let match = snap0.match;            // 整盘状态（两队级别/庄家/打A过A）
  let started = snap0.started;        // 点「开始游戏」后才 true（由 driver 同步）
  let lastPlays: Record<Seat, LastPlay> = snap0.lastPlays;
  let lastActor: Seat | null = snap0.lastActor; // 最近出牌/不要者：其出牌区浮到手牌区之上
  let snapTurnRemainMs: number | undefined = snap0.turnRemainMs; // 联机服务端权威「本回合剩余毫秒」
  let snapSeatStatus: ('online' | 'disconnected' | 'ai')[] | undefined = snap0.seatStatus; // 各座连接态（头像显示掉线/AI接管）
  const selectedIds = new Set<number>();
  let dragging = false;   // 滑动选牌进行中
  let dragMode = true;    // 本次划动目标态：true=选中 / false=取消
  let timedSeat: Seat | null = null; // 当前在倒计时的座位
  let turnStartedAt = 0;             // 本回合开始时间戳
  let turnTotalSec = TURN_SECONDS;   // 本回合倒计时总秒数：联机=服务端权威剩余(turnRemainMs)，本地=TURN_SECONDS
  let turnSeeded = false;            // 本回合是否已用服务端 turnRemainMs 播种（mountTable 初始空快照会先锁座，需补播种一次）
  let turnTick: number | null = null;
  // 弹层引用：onChange 时按 phase 收（本地按钮点击也会直接收，二者幂等；联机无按钮场景靠 phase 收）
  let tributeOverlay: HTMLElement | null = null;
  let resultOverlay: HTMLElement | null = null;
  // 进贡弹层的还贡槽（receiver 座 → 该行还贡牌容器）+ 本轮进贡快照 + 我选的还贡牌（供更新式揭示 + 开局汇总）
  let tributeSlots: Map<number, HTMLElement> | null = null;
  let lastTribute: TributePrompt | null = null;
  let humanReturnCard: Card | null = null;

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

    // 掉线/AI接管直接换头像图案（不再用外挂文字标记，免位置/叠手牌问题）
    const conn = snapSeatStatus?.[seat] ?? 'online';
    elx.appendChild(avatarEl(seat, conn));

    const info = document.createElement('div');
    info.className = 'gd-seat__info';
    const name = document.createElement('span');
    name.className = 'gd-seat__name';
    name.textContent = seatNames?.[seat] || SEAT_LABELS[seat]; // 联机用昵称，本地用 你/下家/对家/上家
    info.appendChild(name);

    // 张数/名次 + 闹钟 包成一个不换行小组：左右家(贴屏幕边)昵称占一行、这组整体落到第二行内部并排，不各自换行
    const meta = document.createElement('div');
    meta.className = 'gd-seat__meta';
    const finishIdx = state.finished.indexOf(seat);
    if (finishIdx >= 0) {
      const badge = document.createElement('span');
      badge.className = 'gd-seat__rank';
      badge.textContent = rankName(finishIdx);
      meta.appendChild(badge);
    } else {
      const len = state.hands[seat]!.length;
      if (len <= 10) { // 仅剩 10 张及以下才显示张数，并光晕醒目提醒
        const count = document.createElement('span');
        count.className = 'gd-seat__count gd-seat__count--alert';
        count.textContent = `${len}`;
        meta.appendChild(count);
      }
    }
    // 轮到该家：放倒计时（闹钟动画），替代原「思考中」；超时自动出牌
    if (active) {
      const timer = document.createElement('div');
      timer.className = 'gd-seat__timer';
      timer.innerHTML = '<span class="gd-seat__clock">⏰</span><span class="gd-seat__timer-sec">' + TURN_SECONDS + '</span>';
      meta.appendChild(timer);
    }
    if (meta.childNodes.length) info.appendChild(meta);
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
      // 牌型不再用文字说明，改用语音播报（driver.onSpeak → speak）
    }
  }

  /** 选/弃一张牌：更新集合 + 直接切类，不整屏重渲（保证滑动顺滑；选牌不影响按钮态） */
  function applyCardSelect(id: number, sel: boolean): void {
    const ce = handEl.querySelector(`.gd-card[data-card-id="${id}"]`) as HTMLElement | null;
    if (sel) { selectedIds.add(id); ce?.classList.add('is-selected'); }
    else { selectedIds.delete(id); ce?.classList.remove('is-selected'); }
  }
  /** 清空选中（集合 + 视觉 is-selected 一并清，保持两者同步）。 */
  function clearSelection(): void {
    selectedIds.clear();
    handEl.querySelectorAll('.gd-card.is-selected').forEach((ce) => ce.classList.remove('is-selected'));
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
      if (e.button !== 0) return;            // 只响应左键/触摸(button 0)；右键留给"右键出牌"，不误切选中
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
    if (spectator) return; // 观战无自己的手牌（底部占位牌不渲染，避免显示「一对黑桃2」占位牌）
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
      // 手机：列叠更紧，但仍须完整露出角标(点数+花色)——缝从桌面的 6px 收到 2px，
      // 不能再切进花色(否则左上花色被下一张盖、跨牌叠加)。
      const isMobile = window.matchMedia('(max-width: 520px), (max-height: 520px)').matches;
      const cap = maxCorner + (isMobile ? 2 : 6);
      const step = Math.min(fitStep, cap); // 列少时按 cap 摆(手机缝更小=叠更多)，列多时按 fitStep 收紧不溢出
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
    const isHumanTurn = !spectator && started && state.turn === HUMAN_SEAT && !isDealOver(state);
    actionsEl.style.display = isHumanTurn ? 'flex' : 'none'; // 途游式：仅轮到我时显示按钮
    // 跟牌(current!=null)时手里没有能压当前牌的(含炸弹)→出牌禁用、只能不要，对称于"领出时不能不要"
    const mustPass = isHumanTurn && state.current !== null
      && enumerateFollows(state.hands[HUMAN_SEAT]!, state.current.combo, state.level).length === 0;
    playBtn.disabled = !isHumanTurn || mustPass;
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
    // 手牌与最新那手牌(z7=lastActor)的层叠/透明，按是否轮到我分两套：
    // · 轮到我出牌：手牌浮到 z7 之上(gd-hand--ontop)，把压住我手牌的别家牌盖回去 → 手牌完整不透明、好选牌；
    // · 没轮到我：手牌在 z7 之下，最新那手牌(无论谁出的、含我自己)只要几何上压到我「具体某张牌」，
    //   手牌就淡到 45%(gd-hand--dim)，让被盖住的牌/「不要」凸显；没压到不淡。
    // 90° 旋转下各元素包围盒仍是正交矩形，元素间矩形相交判断准确。
    const myTurn = started && !isDealOver(state) && state.turn === HUMAN_SEAT;
    handEl.classList.toggle('gd-hand--ontop', myTurn);
    handEl.classList.toggle('gd-hand--dim', !myTurn && started && !isDealOver(state) && latestPlayCoversHand());
  }

  // ── 出牌（牌局推进在服务端，经 driver；view 只取选中牌、转 driver） ──
  function getSelectedCards(): Card[] {
    return state.hands[HUMAN_SEAT]!.filter(c => selectedIds.has(c.id));
  }

  // ── 回合倒计时（替代「思考中」）：超时自动出牌 ──────────────────
  /** 在 renderAll 后调用：检测回合切换 → 重置计时；启停 tick。 */
  function syncTurnTimer(): void {
    const active = (started && !isDealOver(state)) ? state.turn : null;
    const haveServer = active !== null && snapTurnRemainMs != null;
    // 播种时机：回合切换，或「同一回合首次拿到服务端剩余」——挂台初始用空快照(turn=0)会先锁座，
    // 第一个带 turnRemainMs 的真实 state 回合号没变，需在此补播种一次，否则倒计时一直停在 TURN_SECONDS。
    if (active !== timedSeat || (haveServer && !turnSeeded)) {
      timedSeat = active; turnStartedAt = performance.now();
      turnTotalSec = haveServer ? snapTurnRemainMs! / 1000 : TURN_SECONDS; // 联机=服务端权威剩余，本地→TURN_SECONDS
      turnSeeded = haveServer;
    }
    if (active === null) {
      if (turnTick !== null) { window.clearInterval(turnTick); turnTick = null; }
      return;
    }
    if (turnTick === null) turnTick = window.setInterval(tickTurn, 250);
    paintTurnTimer();
  }
  function paintTurnTimer(): void {
    if (timedSeat === null) return;
    const remain = Math.max(0, turnTotalSec - (performance.now() - turnStartedAt) / 1000);
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
    const remain = turnTotalSec - (performance.now() - turnStartedAt) / 1000;
    paintTurnTimer();
    if (remain <= 0) {
      const seat = timedSeat;
      if (turnTick !== null) { window.clearInterval(turnTick); turnTick = null; }
      driver.timeoutSeat(seat); // 超时托管：本地 driver 用 choosePlay 替该座出一手；联机为 no-op(服务端到点即托管)
    }
  }

  function handlePlay(): void {
    const cards = getSelectedCards();
    if (cards.length === 0) { showHint('请先选择要出的牌', 'error'); return; }
    if (!driver.play(cards)) { showHint('所选牌不合法，请重新选择', 'error'); return; }
    // 不在此乐观清选中：联机 play 只是发包(返 true)、服务端可能判不合规。清选中交给"出牌被接受→
    // 新状态重渲手牌"(打出的牌已离手、自然不再选中)；被拒时保留选中，玩家可直接再点出牌重试(而非提示请选牌)。
    showHint('', 'info');
  }

  function handlePass(): void {
    clearSelection(); // 不要时清掉已选的牌，否则选中态一直留到下次轮到我
    driver.pass(); // 领出(current=null)时 driver 返回 false，等价原 early-return
  }

  // ── 局终 / 整盘编排（弹层在 view；牌局推进/结算/进贡决策在服务端，经 driver） ──
  /**
   * 进贡阶段弹层：展示进贡(动画滑入) + 人类收贡时手选 ≤10 还贡。点「确定」回调 returns 开局。
   * 人类为收贡方时须手选；AI 收贡走 chooseReturn(智能还贡)；人类仅为进贡方时无需选(进贡牌自动取最大)。
   */
  /** 填一个还贡槽（receiver 的还贡行显示其还的牌）。 */
  function fillReturnSlot(receiver: number, card: Card, level: Rank): void {
    const slot = tributeSlots?.get(receiver);
    if (!slot) return;
    slot.innerHTML = '';
    const ce = cardEl(card, level, true);
    ce.classList.add('gd-tribute__fly');
    slot.appendChild(ce);
  }
  /** 批量填已知还贡（AI/他人已还的 + 我已选的）。 */
  function fillReturns(returns: TributePrompt['returns'], level: Rank): void {
    if (!tributeSlots) return;
    for (const { receiver, card } of returns) fillReturnSlot(receiver, card, level);
    if (humanReturnCard) fillReturnSlot(HUMAN_SEAT, humanReturnCard, level);
  }

  function showTribute(p: TributePrompt): void {
    const { exchanges, returns, myReturnOptions, level } = p;
    lastTribute = p;

    // 已有弹层（联机后续 state 陆续揭示还贡）→ 只更新还贡槽，不重建（保留手选 UI 与已选态）
    if (tributeOverlay && tributeSlots) { fillReturns(returns, level); return; }

    humanReturnCard = null;
    const overlay = document.createElement('div');
    overlay.className = 'gd-overlay';
    tributeOverlay = overlay;
    tributeSlots = new Map();
    const box = document.createElement('div');
    box.className = 'gd-tribute';
    const title = document.createElement('div');
    title.className = 'gd-result__title';
    title.textContent = '进贡 · 还贡';
    box.appendChild(title);

    const who = (seat: Seat): HTMLElement => {
      const s = document.createElement('span'); s.className = 'gd-tribute__who'; s.textContent = SEAT_LABELS[seat]; return s;
    };
    const arrow = (t: string): HTMLElement => {
      const a = document.createElement('span'); a.className = 'gd-tribute__arrow'; a.textContent = t; return a;
    };

    exchanges.forEach((ex) => {
      // 进贡行：giver 进贡⟶ [大牌] receiver
      const giveRow = document.createElement('div');
      giveRow.className = 'gd-tribute__row';
      const gcard = cardEl(ex.tribute, level, true); gcard.classList.add('gd-tribute__fly');
      giveRow.append(who(ex.giver), arrow('进贡 ⟶'), gcard, who(ex.receiver));
      box.appendChild(giveRow);
      // 还贡行：receiver 还贡⟶ [小牌/占位] giver
      const backRow = document.createElement('div');
      backRow.className = 'gd-tribute__row gd-tribute__row--return';
      const slot = document.createElement('span');
      slot.className = 'gd-tribute__retslot';
      slot.textContent = ex.receiver === HUMAN_SEAT ? '待选' : '还贡中';
      tributeSlots!.set(ex.receiver, slot);
      backRow.append(who(ex.receiver), arrow('还贡 ⟶'), slot, who(ex.giver));
      box.appendChild(backRow);
    });
    fillReturns(returns, level); // 填已知还贡（AI/他人已还的）

    if (myReturnOptions) {
      // 我收贡：手选一张 ≤10 还贡 → resolve(选的牌 id)
      const ex = exchanges.find((e) => e.receiver === HUMAN_SEAT)!;
      const hint = document.createElement('div');
      hint.className = 'gd-tribute__hint';
      hint.textContent = `你收到 ${cardBrief(ex.tribute, level)}，选一张牌还贡给 ${SEAT_LABELS[ex.giver]}`;
      box.appendChild(hint);
      const picks = document.createElement('div');
      picks.className = 'gd-tribute__picks';
      let pickedId: number | null = null;
      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'gd-btn gd-btn--restart';
      confirmBtn.textContent = '确定，开局';
      confirmBtn.disabled = true; // 须先选还贡牌
      for (const c of sortHand(myReturnOptions, level)) {
        const ce = cardEl(c, level, true);
        ce.classList.add('gd-tribute__pickcard');
        ce.addEventListener('click', () => {
          pickedId = c.id;
          picks.querySelectorAll('.gd-tribute__pickcard').forEach(x => x.classList.remove('is-picked'));
          ce.classList.add('is-picked');
          confirmBtn.disabled = false;
          humanReturnCard = c;                    // 记住我还的牌（供还贡槽/开局汇总）
          fillReturnSlot(HUMAN_SEAT, c, level);   // 我的还贡行立即显示所选牌
        });
        picks.appendChild(ce);
      }
      box.appendChild(picks);
      // 收弹层 + 开局汇总交给 phase 切换统一处理（本地 resolve 同步开局、联机等服务端）
      confirmBtn.addEventListener('click', () => { p.resolve(pickedId); });
      box.appendChild(confirmBtn);
    } else if (!driver.autoAdvance) {
      // 本地非收贡方：AI 还贡已在还贡行显示，点确定开局
      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'gd-btn gd-btn--restart';
      confirmBtn.textContent = '确定，开局';
      confirmBtn.addEventListener('click', () => { p.resolve(null); });
      box.appendChild(confirmBtn);
    } else {
      // 联机非收贡方：等服务端收齐（还贡行会随 state 陆续填上真牌）
      const waiting = document.createElement('div');
      waiting.className = 'gd-tribute__hint';
      waiting.textContent = '等待各家还贡…';
      box.appendChild(waiting);
    }

    overlay.appendChild(box);
    gameEl.appendChild(overlay);
  }

  /** 开局时的进贡·还贡汇总提示（谁进贡什么给谁、谁还什么给谁）。 */
  function tributeSummaryHint(p: TributePrompt): string {
    return p.exchanges.map((ex) => {
      const ret = ex.receiver === HUMAN_SEAT
        ? humanReturnCard
        : (p.returns.find((r) => r.receiver === ex.receiver)?.card ?? null);
      const give = `${SEAT_LABELS[ex.giver]}进贡${cardBrief(ex.tribute, p.level)}给${SEAT_LABELS[ex.receiver]}`;
      const back = ret ? `，${SEAT_LABELS[ex.receiver]}还${cardBrief(ret, p.level)}给${SEAT_LABELS[ex.giver]}` : '';
      return give + back;
    }).join('；');
  }

  function showResult(o: DealOutcome): void {
    const settle = o.settle;
    const ranks = ranking(state);
    // settle 由 driver 结算并经 onResult 载荷传入；match 已结算同步进镜像、renderLevels 已在 onResult handler 调。
    // 先清掉已存在的结算弹层：dealResult/matchOver 阶段内若有人掉线/重连，服务端会重广播同一份
    // result → onState 再次 fireResult；不清旧弹层会逐次叠加半透明黑背景(越来越暗)且泄漏 DOM。
    if (resultOverlay) { resultOverlay.remove(); resultOverlay = null; }

    const overlay = document.createElement('div');
    overlay.className = 'gd-overlay';
    resultOverlay = overlay;
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

    // 末游没出完的牌：用 driver 提供的 leftover（联机别家手牌是占位，不能读 state.hands）。
    // 整盘结束(matchOver)不显示——拿下整盘后末游剩牌无意义；且双下提前收盘时 finished 仅 2 人、
    // ranks[3] 为 undefined，显示会成"末游 undefined 剩xx张"。仅单局结算(dealResult)才展示。
    const last = ranks[3]!;
    const leftover = sortHand(o.leftover, state.level);
    if (leftover.length > 0 && !settle.match.over) {
      const lbl = document.createElement('div');
      lbl.className = 'gd-result__leftlabel';
      lbl.textContent = `末游 ${SEAT_LABELS[last]} 剩 ${leftover.length} 张`;
      box.appendChild(lbl);
      const lcards = document.createElement('div');
      lcards.className = 'gd-result__leftover';
      for (const c of leftover) lcards.appendChild(cardEl(c, state.level, true));
      box.appendChild(lcards);
    }

    const closeResult = (): void => {
      overlay.remove(); if (resultOverlay === overlay) resultOverlay = null;
      selectedIds.clear(); clearHint();
    };
    if (settle.match.over) {
      if (!driver.autoAdvance || tableIsHost) {
        // 整盘结束 → 再来一盘（本地 freshMatch；联机房主 freshMatch=发 restart）
        const btn = document.createElement('button');
        btn.className = 'gd-btn gd-btn--restart';
        btn.textContent = '再来一盘';
        btn.addEventListener('click', () => { closeResult(); driver.freshMatch(); });
        box.appendChild(btn);
      } else {
        // 联机非房主：等房主再来一盘
        const waiting = document.createElement('div');
        waiting.className = 'gd-result__gain';
        waiting.textContent = '等房主再来一盘…';
        box.appendChild(waiting);
      }
    } else if (!driver.autoAdvance) {
      // 本地 → 手动「下一局」（进贡/抗贡）
      const btn = document.createElement('button');
      btn.className = 'gd-btn gd-btn--restart';
      btn.textContent = '下一局';
      btn.addEventListener('click', () => { closeResult(); driver.nextDealOrResult(); });
      box.appendChild(btn);
    } else {
      // 联机非整盘结束 → 服务端自动续局，无按钮（下个 state 到→phase 变→onChange 收弹层）
      const waiting = document.createElement('div');
      waiting.className = 'gd-result__gain';
      waiting.textContent = '下一局准备中…';
      box.appendChild(waiting);
    }
    overlay.appendChild(box);
    gameEl.appendChild(overlay);
  }

  // ── 提示 ───────────────────────────────────────────────────
  let hintTimer: number | null = null;
  function showHint(msg: string, type: 'error' | 'info'): void {
    hintEl.textContent = msg;
    hintEl.className = `gd-hint gd-hint--${type}`;
    if (hintTimer !== null) { window.clearTimeout(hintTimer); hintTimer = null; }
    // 提示几秒后自动消失(像 toast，不再一直挂到下次出牌)：错误 3.5s；进贡摘要等 info 给 6s 便于看清谁贡给谁
    if (msg) hintTimer = window.setTimeout(() => { hintEl.textContent = ''; hintEl.className = 'gd-hint'; hintTimer = null; }, type === 'error' ? 3500 : 6000);
  }
  function clearHint(): void { if (hintTimer !== null) { window.clearTimeout(hintTimer); hintTimer = null; } hintEl.textContent = ''; hintEl.className = 'gd-hint'; }

  // ── 绑定 + 初次渲染 ────────────────────────────────────────
  playBtn.addEventListener('click', handlePlay);
  passBtn.addEventListener('click', handlePass);
  // 右键出牌：牌桌区单击鼠标右键 = 出牌(等同点出牌按钮)，仅我回合且已选牌时触发；一律屏蔽浏览器右键菜单
  gameEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!playBtn.disabled && getSelectedCards().length > 0) handlePlay();
  });

  // ── driver 事件 → view 渲染/弹层/语音/提示 ──────────────
  // onChange：拷快照进镜像变量 + 顶栏级别 + 整屏渲染（renderAll 等渲染函数体不变）。
  function syncFromDriver(): void {
    const s = driver.snapshot();
    state = s.state; match = s.match; lastPlays = s.lastPlays; lastActor = s.lastActor; started = s.started;
    snapTurnRemainMs = s.turnRemainMs; // 联机服务端权威剩余，syncTurnTimer 回合切换时据此播种
    snapSeatStatus = s.seatStatus;     // 各座连接态，renderSeatInfo 据此显示掉线/AI接管
  }
  driver.onChange(() => {
    syncFromDriver();
    // 按 phase 收弹层：本地按钮点击也会直接收(幂等)；联机无按钮场景(自动续局/非收贡)靠这里收。
    const phase = driver.snapshot().phase;
    if (phase !== 'tribute') {
      if (tributeOverlay) { tributeOverlay.remove(); tributeOverlay = null; }
      // 开局：顶一条进贡·还贡汇总（谁进贡什么给谁、谁还什么给谁），保证还贡明牌可见
      if (lastTribute) { selectedIds.clear(); showHint(tributeSummaryHint(lastTribute), 'info'); lastTribute = null; humanReturnCard = null; tributeSlots = null; }
    }
    if (phase !== 'dealResult' && phase !== 'matchOver' && resultOverlay) { resultOverlay.remove(); resultOverlay = null; }
    renderLevels(); renderAll();
  });
  driver.onSpeak((text) => speak(text));                                              // 报牌/不要语音
  driver.onHint((text, kind) => showHint(text, kind === 'warn' ? 'error' : 'info'));  // 抗贡等提示
  driver.onResult((o) => { syncFromDriver(); renderLevels(); showResult(o); });        // 局终结算弹层
  driver.onTribute((p) => showTribute(p));                                            // 进贡/还贡弹层

  // 滑动选牌：手牌区内 pointermove 经过的牌切到同一目标态；任意处松手结束
  const onHandPointerMove = (e: PointerEvent): void => {
    if (!dragging) return;
    const id = cardIdAtPoint(e.clientX, e.clientY);
    if (id !== null && selectedIds.has(id) !== dragMode) applyCardSelect(id, dragMode);
  };
  const onPointerUp = (): void => { dragging = false; };
  handEl.addEventListener('pointermove', onHandPointerMove);
  window.addEventListener('pointerup', onPointerUp);

  // 转屏/缩放后重算手牌重叠（可用宽度变了），避免溢出
  const onResize = (): void => { if (started) renderHand(); };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  // 挂载时不渲染这副牌——开始遮罩是半透明黑，若此时 renderAll 会把手牌透过遮罩半隐半现露出来。
  // 牌面留到点「开始游戏」后(startBtn 里 renderAll)再生成。顶栏级别(renderLevels)已在上方单独渲染。
  // 内嵌字体(GDRank)异步加载会重算手牌步进，但同样只在已开始时才重算(开始前没有手牌可算)。
  if (document.fonts?.ready) void document.fonts.ready.then(() => { if (started) renderHand(); });

  if (started) {
    // 联机：进牌桌时服务端已开打（snapshot.started=true），直接渲染。音频解锁已在前置 UI 手势完成。
    renderLevels();
    renderAll();
  } else {
    // 本地：「开始游戏」遮罩——点一下=用户手势，解锁 iOS 音频（首轮 AI 语音才响），再 driver.start()。
    const startOverlay = document.createElement('div');
    startOverlay.className = 'gd-start';
    const startBtn = document.createElement('button');
    startBtn.className = 'gd-start__btn';
    startBtn.textContent = '开始游戏';
    startOverlay.appendChild(startBtn);
    startBtn.addEventListener('click', () => {
      primeAudio();
      startOverlay.remove();
      driver.start(); // started=true + onChange(整屏渲染) + 非我回合起 AI
    });
    gameEl.appendChild(startOverlay);
  }

  return () => {
    driver.dispose(); // 清 driver 的 AI 定时器
    if (turnTick !== null) { window.clearInterval(turnTick); turnTick = null; }
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
    root.innerHTML = '';
  };
}
