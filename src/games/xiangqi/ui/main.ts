import './style.css';
import { XIANGQI_HTML } from './template';
import { isInCheck } from '../engine/rules';
import { render, pixelToSquare, pointX, pointY, BOARD_W, BOARD_H } from './render';
import { easeInOutQuad, lerp } from './anim';
import { GameController } from './controller';
import type { Move, Color, Square } from '../engine/types';
import { moveToIccs, iccsToMove } from '../engine/notation';
import { OnlineSession } from './online';
import type { OnlineMsg, LobbyRoom } from './online';
import { createClock, startTurn, tick, display } from '../engine/clock';
import type { ClockMode, ClockState } from '../engine/clock';
import type { AiLevel } from '../engine/ai';
import { clearSaved, today, saveTheme, loadTheme, saveMuted, loadMuted, saveBookHint, loadBookHint, loadNick, saveNick, defaultNick } from './persist';
import { buildBookIndex, lookupBook, OPENINGS } from '../engine/openings';
import { BrowseSession } from '../engine/browse';
import { play, setMuted, isMuted, initSound, resumeAudio, unlockOnFirstGesture } from './sound';
import { gameToPgn, pgnToGame } from '../engine/pgn';
import { themeByKey, DEFAULT_THEME_KEY } from './themes';
import { ENDGAMES, EndgameLine } from '../engine/endgames';
import { fromFen } from '../engine/fen';
import { Game } from '../engine/game';

export function mountXiangqi(root: HTMLElement): () => void {
  const host = document.createElement('div');
  host.className = 'xq-root';
  host.innerHTML = XIANGQI_HTML;
  root.appendChild(host);
  const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => host.querySelector(sel) as T;

  const listeners: Array<{ t: EventTarget; type: string; fn: EventListenerOrEventListenerObject }> = [];
  const on = (t: EventTarget, type: string, fn: EventListenerOrEventListenerObject) => { t.addEventListener(type, fn); listeners.push({ t, type, fn }); };

  const canvas = $('#board') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const statusEl = $('#status') as HTMLDivElement;
  const turnTextEl = statusEl.querySelector('.turn-text') as HTMLSpanElement;
  const sealChopEl = statusEl.querySelector('.seal-chop') as HTMLSpanElement;

  const modeBtn = $('#mode') as HTMLButtonElement;
  const undoBtn = $('#undo') as HTMLButtonElement;
  const restartBtn = $('#restart') as HTMLButtonElement;
  const levelField = $('#level-field') as HTMLDivElement;
  const levelSel = $('#level') as HTMLSelectElement;

  const THINK_DELAY = 650; // 电脑落子前的思考停顿（ms），让走棋看得清

  function currentLevel(): AiLevel {
    return levelSel.value as AiLevel;
  }
  const ANIM_MS = 280; // 棋子滑动时长
  const controller = new GameController();
  const exportBtn = $('#export-pgn') as HTMLButtonElement;
  const importBtn = $('#import-pgn') as HTMLButtonElement;
  const importFile = $('#import-file') as HTMLInputElement;
  const themeSel = $('#theme') as HTMLSelectElement;
  let theme = themeByKey(loadTheme() || DEFAULT_THEME_KEY);
  themeSel.value = theme.key;

  const muteBtn = $('#mute') as HTMLButtonElement;
  function syncMuteBtn() { muteBtn.textContent = isMuted() ? '🔇 静音' : '🔊 音效'; }
  initSound(loadMuted());
  unlockOnFirstGesture();   // 首次任意触摸即解锁音频（iOS Web Audio 必需）
  syncMuteBtn();

  const bookIndex = buildBookIndex();
  let bookHintOn = loadBookHint();
  let bookHints: Square[] = [];
  const bookBtn = $('#book-hint') as HTMLButtonElement;
  const bookLine = $('#book-line') as HTMLDivElement;
  const bookBadge = $('#book-badge') as HTMLSpanElement;
  const bookMovesEl = $('#book-moves') as HTMLSpanElement;
  function syncBookBtn() { bookBtn.textContent = bookHintOn ? '📖 开局提示·开' : '📖 开局提示·关'; }
  syncBookBtn();

  const browseBtn = $('#browse') as HTMLButtonElement;
  const browsePanel = $('#browse-panel') as HTMLDivElement;
  const openSel = $('#open-sel') as HTMLSelectElement;
  const bPrev = $('#b-prev') as HTMLButtonElement;
  const bNext = $('#b-next') as HTMLButtonElement;
  const bExit = $('#b-exit') as HTMLButtonElement;
  const varField = $('#var-field') as HTMLDivElement;
  const varSel = $('#var-sel') as HTMLSelectElement;
  const bMoves = $('#b-moves') as HTMLDivElement;
  let browsing = false;
  let session: BrowseSession | null = null;
  OPENINGS.forEach((o) => { const opt = document.createElement('option'); opt.value = o.id; opt.textContent = o.name; openSel.appendChild(opt); });

  const endgameBtn = $('#endgame') as HTMLButtonElement;
  const resetEgBtn = $('#reset-eg') as HTMLButtonElement;
  const endgamePanel = $('#endgame-panel') as HTMLDivElement;
  const egSel = $('#eg-sel') as HTMLSelectElement;
  const egGoal = $('#eg-goal') as HTMLSpanElement;
  const egPlay = $('#eg-play') as HTMLButtonElement;
  const egSolve = $('#eg-solve') as HTMLButtonElement;
  const egPrev = $('#eg-prev') as HTMLButtonElement;
  const egNext = $('#eg-next') as HTMLButtonElement;
  const egExit = $('#eg-exit') as HTMLButtonElement;
  const egMoves = $('#eg-moves') as HTMLDivElement;
  let inEndgame = false;
  let egLine: EndgameLine | null = null;
  let currentEgFen: string | null = null;
  ENDGAMES.forEach((e) => { const o = document.createElement('option'); o.value = e.id; o.textContent = e.name; egSel.appendChild(o); });
  function curEg() { return ENDGAMES.find((e) => e.id === egSel.value) || ENDGAMES[0]; }

  const onlineBtn = $('#online') as HTMLButtonElement;
  const onlinePanel = $('#online-panel') as HTMLDivElement;
  const oGate = $('#o-gate') as HTMLDivElement;
  const oNickInput = $('#o-nick-input') as HTMLInputElement;
  const oEnter = $('#o-enter') as HTMLButtonElement;
  const oGateMsg = $('#o-gate-msg') as HTMLSpanElement;
  const oLobby = $('#o-lobby') as HTMLDivElement;
  const oMeNick = $('#o-me-nick') as HTMLElement;
  const oRename = $('#o-rename') as HTMLButtonElement;
  const oCreate = $('#o-create') as HTMLButtonElement;
  const oPrivate = $('#o-private') as HTMLInputElement;
  const oRoomList = $('#o-room-list') as HTMLDivElement;
  const oCodeInput = $('#o-code-input') as HTMLInputElement;
  const oCodeSubmit = $('#o-code-submit') as HTMLButtonElement;
  const oExit = $('#o-exit') as HTMLButtonElement;
  const oLobbyMsg = $('#o-lobby-msg') as HTMLDivElement;
  const oUnavailable = $('#o-unavailable') as HTMLDivElement;
  const oWaiting = $('#o-waiting') as HTMLDivElement;
  const oWaitTitle = $('#o-wait-title') as HTMLDivElement;
  const oWaitCode = $('#o-wait-code') as HTMLDivElement;
  const oWaitCodeVal = $('#o-wait-code-val') as HTMLElement;
  const oWaitCopy = $('#o-wait-copy') as HTMLButtonElement;
  const oCancel = $('#o-cancel') as HTMLButtonElement;
  const oSpectateView = $('#o-spectate') as HTMLDivElement;
  const oSpectateBanner = $('#o-spectate-banner') as HTMLDivElement;
  const oSpectateExit = $('#o-spectate-exit') as HTMLButtonElement;
  const onlineActions = $('#online-actions') as HTMLDivElement;
  const oGameMsg = $('#o-game-msg') as HTMLSpanElement;
  const oGameExit = $('#o-game-exit') as HTMLButtonElement;
  const oResign = $('#o-resign') as HTMLButtonElement;
  const oDraw = $('#o-draw') as HTMLButtonElement;
  const oUndo = $('#o-undo') as HTMLButtonElement;
  const onlineOffer = $('#online-offer') as HTMLDivElement;
  const oOfferText = $('#o-offer-text') as HTMLSpanElement;
  const oAccept = $('#o-accept') as HTMLButtonElement;
  const oDecline = $('#o-decline') as HTMLButtonElement;

  const clockModeSel = $('#clock-mode') as HTMLSelectElement;
  const clockParams = $('#clock-params') as HTMLDivElement;
  const mainMinInput = $('#clock-main-min') as HTMLInputElement;
  const byoSecInput = $('#clock-byo-sec') as HTMLInputElement;
  const byoUnit = $('#clock-byo-unit') as HTMLSpanElement;
  const clocksEl = $('#clocks') as HTMLDivElement;
  const clockRedEl = $('#clock-red') as HTMLSpanElement;
  const clockBlackEl = $('#clock-black') as HTMLSpanElement;
  const clockRedT = clockRedEl.querySelector('.t') as HTMLSpanElement;
  const clockBlackT = clockBlackEl.querySelector('.t') as HTMLSpanElement;
  let clock: ClockState | null = null;
  let clockStack: ClockState[] = [];
  let clockTimer: number | null = null;
  let timeoutLoser: Color | null = null;

  let aiThinking = false;
  let animating = false;

  let online: OnlineSession | null = null;
  let onlineColor: Color | null = null;
  let onlineResult: string | null = null;
  let pendingOffer: 'draw' | 'undo' | null = null;
  let spectating = false;
  let myNick = '';
  let pendingRename = '';
  let redNick = '', blackNick = '';
  let roomCode = '';            // 当前房间码（重连用）
  let reconnecting = false;     // 自己掉线、正在自动重连
  let awaitingSync = false;     // 重连成功(rejoined)后等对方 sync 期间：禁点，防基于旧盘走子致双方局面不一致
  let reconnectTries = 0;
  let wasSpectating = false;    // 掉线前是玩家还是观战（决定重连用 rejoin 还是 spectate）
  let intentionalClose = false; // 主动退出(exit/backToLobby)关闭，不触发自动重连
  let peerDown = false;         // 对手掉线中 → 在场方顶部醒目显示「对方掉线，等待重连」

  // 高 DPR 清晰渲染：放大绘图缓冲，逻辑坐标仍用 BOARD_W×BOARD_H
  function setupCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = BOARD_W * dpr;
    canvas.height = BOARD_H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // 显示尺寸交给 CSS 做响应式
  }

  function busy(): boolean {
    return aiThinking || animating;
  }

  function updateBookHints() {
    if (!bookHintOn) { bookHints = []; bookLine.hidden = true; return; }
    bookLine.hidden = false;
    const e = lookupBook(bookIndex, controller.board, controller.turn);
    if (e) {
      bookHints = e.moves.map((m) => m.move.to);
      bookBadge.className = 'book-badge';
      bookBadge.textContent = e.openings.join(' / ');
      bookMovesEl.innerHTML = '谱着：' + e.moves.map((m) => `<span class="k">${m.zh}</span>`).join(' / ');
    } else {
      bookHints = [];
      bookBadge.className = 'book-badge off';
      bookBadge.textContent = '已出谱';
      bookMovesEl.textContent = '';
    }
  }

  function refresh() {
    updateBookHints();
    render(ctx, controller.board, controller.selected, controller.legalDests, controller.lastMove, null, theme, bookHints);
    updateStatus();
    updateControls();
  }

  // 本局组（悔棋/重新开局/导出）仅在已走子时显示——没开局就不显示
  const grpGame = $('#grp-game') as HTMLDivElement;
  function updateControls() { grpGame.hidden = controller.getGame().getMoves().length === 0; }

  function chopChar(red: boolean): string {
    return red ? '帅' : '将';
  }

  function updateStatus() {
    if (onlineResult) { statusEl.className = 'seal over'; turnTextEl.textContent = onlineResult; return; }
    if (timeoutLoser) {
      statusEl.className = 'seal over';
      turnTextEl.textContent = (timeoutLoser === 'red' ? '红方' : '黑方') + '超时负';
      return;
    }
    const s = controller.status;
    if (s === 'red_win' || s === 'black_win' || s === 'draw') {
      statusEl.className = 'seal over';
      turnTextEl.textContent =
        s === 'red_win' ? '红方胜' : s === 'black_win' ? '黑方胜' : '和棋';
      return;
    }
    const red = controller.turn === 'red';
    const checking = isInCheck(controller.board, controller.turn);
    statusEl.className = 'seal ' + (red ? 'turn-red' : 'turn-black') + (checking ? ' check' : '');
    sealChopEl.textContent = chopChar(red);
    const side = red ? '红方' : '黑方';
    turnTextEl.textContent = checking ? `${side}将军` : `${side}走`;
    if ((isOnline() || isSpectating()) && redNick && blackNick) {   // 双方都在(已配对/观战)才显示昵称；等待房不显示
      // 昵称用无衬线 span（任意字，各平台一致），固定词「红方走」仍走 --font-display 嵌入楷体
      const nk = document.createElement('span');
      nk.className = 'turn-nick';
      nk.textContent = `（红 ${redNick} / 黑 ${blackNick}）`;
      turnTextEl.appendChild(nk);
    }
    if (peerDown && isOnline() && !onlineResult) turnTextEl.textContent = '对方掉线，等待重连…';
  }

  // 每步落子后按 胜负 > 将军 > 吃子 > 落子 优先级播一个音
  function playMoveSound() {
    if (controller.status !== 'playing') { play(controller.status === 'draw' ? 'move' : 'win'); return; } // 和棋不放胜利琶音
    if (isInCheck(controller.board, controller.turn)) { play('check'); return; }
    play(controller.lastCapture ? 'capture' : 'move');
  }

  function renderClocks() {
    if (!clock) return;
    clockRedT.textContent = display(clock.red);
    clockBlackT.textContent = display(clock.black);
    clockRedEl.classList.toggle('running', clock.running === 'red' && !timeoutLoser);
    clockBlackEl.classList.toggle('running', clock.running === 'black' && !timeoutLoser);
  }
  function stopClockTimer() { if (clockTimer !== null) { clearInterval(clockTimer); clockTimer = null; } }
  function startClockTimer() {
    stopClockTimer();
    if (!clock) return;
    clockTimer = window.setInterval(() => {
      if (!clock) { stopClockTimer(); return; }
      if (controller.status !== 'playing') { stopClockTimer(); return; } // 棋盘已分胜负则停钟
      clock = tick(clock, 100);
      renderClocks();
      if (clock.flagged) { timeoutLoser = clock.flagged; play('win'); stopClockTimer(); renderClocks(); updateStatus(); }
    }, 100);
  }
  // 一手走完：切钟到新走方（controller.turn 已是新方）
  function onMovePlayed() {
    if (!clock || timeoutLoser) return;
    clockStack.push(clock);
    clock = startTurn(clock, controller.turn);
    renderClocks();
    if (controller.status !== 'playing') stopClockTimer();
  }
  // 重开/换模式后把钟归零并重新跑（保留当前 config）
  function resetClock() {
    if (!clock) return;
    clock = startTurn(createClock(clock.config), 'red');
    clockStack = [];
    timeoutLoser = null;
    renderClocks();
    startClockTimer();
  }
  function applyClockMode() {
    const mode = clockModeSel.value;
    stopClockTimer(); timeoutLoser = null; clockStack = [];
    if (mode === 'off') { clock = null; clocksEl.hidden = true; clockParams.hidden = true; refresh(); return; }
    clockParams.hidden = false;
    byoSecInput.hidden = mode !== 'byoyomi';
    byoUnit.hidden = mode !== 'byoyomi'; // 「秒读秒」标签随读秒输入框一起显隐，避免包干模式下悬空
    const mainMs = Math.max(1, Number(mainMinInput.value) || 10) * 60000;
    const byoyomiMs = Math.max(5, Number(byoSecInput.value) || 30) * 1000;
    clock = startTurn(createClock({ mode: mode as ClockMode, mainMs, byoyomiMs }), controller.turn);
    clocksEl.hidden = false;
    renderClocks();
    startClockTimer();
    refresh();
  }

  // 让棋子从起点滑到落点（move 已应用，棋子已在 to）。结束后回调。
  function playMoveAnimation(move: Move, onDone: () => void) {
    const piece = controller.board[move.to.row][move.to.col];
    if (!piece) {
      onDone();
      return;
    }
    const fromX = pointX(move.from.col);
    const fromY = pointY(move.from.row);
    const toX = pointX(move.to.col);
    const toY = pointY(move.to.row);
    const start = performance.now();
    animating = true;

    const frame = (now: number) => {
      const elapsed = now - start;
      const t = easeInOutQuad(elapsed / ANIM_MS);
      render(ctx, controller.board, null, [], controller.lastMove, {
        skip: move.to,
        piece,
        x: lerp(fromX, toX, t),
        y: lerp(fromY, toY, t),
      }, theme, bookHints);
      if (elapsed < ANIM_MS) {
        requestAnimationFrame(frame);
      } else {
        animating = false;
        onDone();
      }
    };
    requestAnimationFrame(frame);
  }

  function renderBrowse() {
    if (!session) return;
    const pos = session.position();
    render(ctx, pos.board, null, [], null, null, theme, []);
    const zhs = session.moves();
    bMoves.innerHTML = zhs.length
      ? zhs.map((z, i) => `<span class="m${i === zhs.length - 1 ? ' on' : ''}">${i % 2 === 0 ? Math.floor(i / 2) + 1 + '.' : ''}${z}</span>`).join(' ')
      : '（开局起始局面，点「下一步」打谱）';
    bPrev.disabled = !session.canPrev();
    bNext.disabled = !session.canNext();
    const f = session.frontier();
    if (f.length > 1) {
      varField.hidden = false;
      varSel.innerHTML = f.map((n, i) => `<option value="${i}">${n.zh}${n.comment ? '（' + n.comment + '）' : ''}</option>`).join('');
    } else {
      varField.hidden = true;
      varSel.value = '0'; // 重置：避免上个多变着节点选过的 index 残留，喂给 bNext 致 next() 越界空转、按钮可点却卡死
    }
  }
  function enterBrowse() {
    browsing = true;
    browsePanel.hidden = false;
    ($('.controls') as HTMLElement).hidden = true;
    // 浏览模式干净接管：隐藏对局提示行与棋钟，并暂停计时（避免后台跑超时）
    bookLine.hidden = true;
    clocksEl.hidden = true;
    stopClockTimer();
    session = new BrowseSession(OPENINGS.find((o) => o.id === openSel.value) || OPENINGS[0]);
    renderBrowse();
  }
  function exitBrowse() {
    browsing = false;
    browsePanel.hidden = true;
    ($('.controls') as HTMLElement).hidden = false;
    session = null;
    // 恢复对局态：提示行由 refresh→updateBookHints 复原；棋钟若在用则重显并续走
    if (clock) {
      clocksEl.hidden = false;
      renderClocks();
      startClockTimer();
    }
    refresh();
  }

  function renderEndgame() {
    if (!inEndgame) return;
    const eg = curEg();
    egGoal.textContent = '目标：' + eg.goal;
    if (egLine) {
      const pos = egLine.position();
      render(ctx, pos.board, null, [], null, null, theme, []);
      egMoves.hidden = false;
      const zhs = egLine.moves();
      egMoves.innerHTML = zhs.length ? zhs.map((z, i) => `<span class="m${i === zhs.length - 1 ? ' on' : ''}">${z}</span>`).join(' ') : '（残局起始，点「下一步」看解法）';
      egPrev.hidden = false; egNext.hidden = false; egPrev.disabled = !egLine.canPrev(); egNext.disabled = !egLine.canNext();
    } else {
      const { board } = fromFen(eg.fen);
      render(ctx, board, null, [], null, null, theme, []);
      egMoves.hidden = true; egPrev.hidden = true; egNext.hidden = true;
    }
  }
  function enterEndgame() {
    inEndgame = true; egLine = null;
    endgamePanel.hidden = false;
    ($('.controls') as HTMLElement).hidden = true;
    bookLine.hidden = true; clocksEl.hidden = true; stopClockTimer();
    renderEndgame();
  }
  function exitEndgame() {
    inEndgame = false; egLine = null;
    endgamePanel.hidden = true;
    ($('.controls') as HTMLElement).hidden = false;
    if (clock) { clocksEl.hidden = false; renderClocks(); startClockTimer(); }
    refresh();
  }
  function playEndgame() {
    const eg = curEg();
    const { board, turn } = fromFen(eg.fen);
    controller.loadGame(Game.fromPosition(board, turn));
    currentEgFen = eg.fen;
    resetEgBtn.hidden = false;
    inEndgame = false; egLine = null; endgamePanel.hidden = true;
    ($('.controls') as HTMLElement).hidden = false;
    if (clock) { clocksEl.hidden = false; resetClock(); } // 残局练习是新一局：恢复并重置时钟（enterEndgame 曾停钟藏钟）
    refresh();
  }

  function aiTurnPending(): boolean {
    return (
      controller.aiColor !== null &&
      controller.status === 'playing' &&
      controller.turn === controller.aiColor
    );
  }

  // 若轮到电脑：先显示思考提示，停顿后搜索落子并滑动
  function maybeRunAi() {
    if (timeoutLoser) return;
    if (!aiTurnPending()) return;
    aiThinking = true;
    statusEl.className = 'seal turn-' + controller.turn;
    sealChopEl.textContent = chopChar(controller.turn === 'red');
    turnTextEl.textContent = '电脑思考中…';
    setTimeout(() => {
      const m = controller.maybeAiMove();
      aiThinking = false;
      if (m) { onMovePlayed(); playMoveSound(); playMoveAnimation(m, refresh); }
      else refresh();
    }, THINK_DELAY);
  }

  function isOnline() { return online !== null && onlineColor !== null; }
  function isSpectating() { return online !== null && spectating; }

  type OnlineView = 'gate' | 'lobby' | 'waiting' | 'game' | 'spectate' | 'unavailable';
  // 联机面板 5 个互斥视图统一管显隐；每次切换清掉上一视图的临时文字，杜绝「连接中」等残留
  function setOnlineView(v: OnlineView): void {
    oUnavailable.hidden = v !== 'unavailable';
    oGate.hidden = v !== 'gate';
    oLobby.hidden = v !== 'lobby';
    oWaiting.hidden = v !== 'waiting';
    oSpectateView.hidden = v !== 'spectate';
    onlinePanel.hidden = v === 'game';   // 对局中面板让位给棋盘 + 操作条
    onlineActions.hidden = v !== 'game';
    if (v === 'game') { oResign.hidden = oDraw.hidden = oUndo.hidden = false; } // 新局/重连回对局：恢复对局操作按钮（finishOnlineGame 终局时会隐藏它们）
    onlineOffer.hidden = true;           // 求和/悔棋弹框仅在收到请求时显式弹
    oGateMsg.textContent = ''; oLobbyMsg.textContent = ''; oGameMsg.textContent = '';
  }

  // 联机对局终局：隐藏认输/求和/悔棋，但保留操作条上的「退出」按钮可点，避免终局后无出口死锁（退出按钮原在 online-actions 内，整体隐藏会一起没掉）
  function finishOnlineGame(result: string): void {
    onlineResult = result;
    oResign.hidden = oDraw.hidden = oUndo.hidden = true;
    onlineOffer.hidden = true;
    onlineActions.hidden = false;
    updateStatus();
  }

  function newOnlineSession(): OnlineSession {
    const s = new OnlineSession();
    s.onState = (st) => {
      if (st !== 'closed') return;
      if (intentionalClose) { intentionalClose = false; return; }      // 主动退出，不重连
      if (roomCode) { setTimeout(attemptReconnect, reconnectTries === 0 ? 400 : 1200); return; }  // 掉线 → 自动重连
      if (isOnline()) {
        if (onlinePanel.hidden) finishOnlineGame('连接已断');   // 真在对局视图(面板让位棋盘)才按终局处理
        else { setOnlineView('waiting'); oWaitTitle.textContent = '连接已断，点「取消」返回大厅重试'; oWaitCode.hidden = true; } // 建房等待中掉线：留等待视图靠「取消」退出，不浮出对局操作条
      }
      else if (isSpectating()) { oSpectateBanner.textContent = '连接已断'; }
    };
    s.onMessage = onOnlineMsg;
    return s;
  }

  // 自己掉线后自动重连：连 WS → (玩家)rejoin / (观战)spectate 同一房间码；昵称随 rejoin 走，绕开判重
  function attemptReconnect() {
    if (!roomCode) return;
    if (reconnectTries >= 6) {
      reconnecting = false;
      if (wasSpectating) oSpectateBanner.textContent = '连接断开，重连失败，请退出重试';
      else finishOnlineGame('连接断开，重连失败');
      clearOnlineSession();
      return;
    }
    reconnecting = true; reconnectTries++;
    const tip = `连接断开，重连中…(${reconnectTries})`;
    if (wasSpectating) oSpectateBanner.textContent = tip; else oGameMsg.textContent = tip;
    online = newOnlineSession();
    online.connect(() => { if (wasSpectating) online!.spectate(roomCode); else online!.rejoin(roomCode, myNick); });
  }

  // 联机对局状态存 sessionStorage：刷新/切后台回来可自动重连（仅当前标签页）
  const ONLINE_SKEY = 'xiangqi:online';
  function saveOnlineSession() { try { sessionStorage.setItem(ONLINE_SKEY, JSON.stringify({ code: roomCode, nick: myNick, spectate: wasSpectating })); } catch { /* 忽略 */ } }
  function clearOnlineSession() { try { sessionStorage.removeItem(ONLINE_SKEY); } catch { /* 忽略 */ } }
  function loadOnlineSession(): { code: string; nick: string; spectate: boolean } | null { try { const s = sessionStorage.getItem(ONLINE_SKEY); return s ? JSON.parse(s) : null; } catch { return null; } }

  function enterOnline() {
    if (busy()) return;
    ($('.controls') as HTMLElement).hidden = true;
    bookLine.hidden = true; clocksEl.hidden = true; stopClockTimer(); timeoutLoser = null; // 清本地超时残留，否则联机落子被 645 行 `if(timeoutLoser)return` 拦死
    onlinePanel.hidden = false;
    if (!new OnlineSession().available()) { setOnlineView('unavailable'); return; }
    setOnlineView('gate');
    oNickInput.value = loadNick() || defaultNick();
    oNickInput.focus();
  }

  function exitOnline() {   // 彻底退出联机，回到本地
    intentionalClose = true; online?.close(); online = null;
    onlineColor = null; onlineResult = null; pendingOffer = null;
    spectating = false; redNick = blackNick = ''; roomCode = ''; reconnecting = false; reconnectTries = 0; peerDown = false; awaitingSync = false;
    clearOnlineSession();
    onlinePanel.hidden = true; onlineActions.hidden = true; onlineOffer.hidden = true;
    ($('.controls') as HTMLElement).hidden = false;
    controller.reset();
    if (clock) { clocksEl.hidden = false; resetClock(); } // 回本地新局：重置时钟(含清 timeoutLoser)，不沿用旧的已超时/已耗尽钟
    refresh();
  }

  // 取消房间 / 退出对局或观战 → 关旧连接(服务器清掉旧房)再重连重 hello，回到大厅
  function backToLobby() {
    intentionalClose = true; online?.close();
    onlineColor = null; spectating = false; onlineResult = null; pendingOffer = null; redNick = blackNick = '';
    roomCode = ''; reconnecting = false; reconnectTries = 0; peerDown = false; awaitingSync = false;
    clearOnlineSession();
    controller.reset(); refresh();   // 重置棋盘 + 重绘，清掉顶部残留的「（红 X / 黑 ）」
    setOnlineView('waiting'); oWaitTitle.textContent = '返回大厅中…'; oWaitCode.hidden = true;
    online = newOnlineSession();
    online.connect(() => online!.hello(myNick));
  }

  function submitNick() {
    const nick = oNickInput.value.trim();
    if (!nick) { oGateMsg.textContent = '请输入昵称'; return; }
    myNick = nick;
    oGateMsg.textContent = '连接中…';
    if (!online) { online = newOnlineSession(); online.connect(() => online!.hello(myNick)); }
    else online.hello(myNick);
  }

  function enterLobby() {
    saveNick(myNick);
    setOnlineView('lobby');
    oMeNick.textContent = myNick;
    online!.subscribeLobby();
  }

  function escapeHtml(s: string): string { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)); }

  function renderLobby(rooms: LobbyRoom[]) {
    oRoomList.innerHTML = '';
    if (!rooms.length) { oRoomList.innerHTML = '<div class="o-room-empty">暂无房间，点上面「＋ 创建房间」开一个</div>'; return; }
    for (const r of rooms) {
      const row = document.createElement('div'); row.className = 'o-room-row';
      const info = document.createElement('span'); info.className = 'o-room-info';
      const btn = document.createElement('button'); btn.className = 'btn';
      if (r.status === 'waiting') {
        info.innerHTML = `「${escapeHtml(r.host)}」的房间 <span class="o-room-sub">等待中</span>`;
        btn.textContent = '加入'; btn.classList.add('btn-primary');
        btn.onclick = () => { online!.joinRoom(r.code); };
      } else {
        const p = r.players || ['?', '?'];
        info.innerHTML = `${escapeHtml(p[0])} <span class="o-room-sub">vs</span> ${escapeHtml(p[1])} <span class="o-room-sub">· 观战 ${r.spectators}</span>`;
        btn.textContent = '观战';
        btn.onclick = () => { roomCode = r.code; wasSpectating = true; online!.spectate(r.code); };
      }
      row.appendChild(info); row.appendChild(btn); oRoomList.appendChild(row);
    }
  }

  function onOnlineMsg(m: OnlineMsg) {
    switch (m.t) {
      case 'hello-ok': enterLobby(); break;
      case 'rename-ok': myNick = pendingRename || myNick; oMeNick.textContent = myNick; oNickInput.value = myNick; saveNick(myNick); break;
      case 'nick-taken':
        if (!oGate.hidden) { oGateMsg.textContent = '该昵称已被占用，换一个'; oNickInput.focus(); }
        else { oLobbyMsg.textContent = '该昵称已被占用，改名失败'; }
        break;
      case 'lobby': if ('rooms' in m) renderLobby(m.rooms); break;
      case 'created':
        onlineColor = 'red'; redNick = myNick; blackNick = '';
        controller.reset(); refresh();
        setOnlineView('waiting');
        oWaitTitle.textContent = m.isPrivate ? '私密房已创建，把房间码发给对方加入：' : '房间已创建，在大厅等待对手加入…（也可把房间码发给对方直接加入）';
        oWaitCode.hidden = false; oWaitCodeVal.textContent = m.code;
        break;
      case 'paired':
        onlineColor = m.color; onlineResult = null; pendingOffer = null; spectating = false; wasSpectating = false; awaitingSync = false;
        roomCode = m.code; reconnecting = false; reconnectTries = 0; peerDown = false; saveOnlineSession();
        redNick = m.color === 'red' ? m.you : m.opponent; blackNick = m.color === 'red' ? m.opponent : m.you;
        controller.reset();
        setOnlineView('game');
        refresh();
        break;
      case 'rejoined':   // 自己重连成功，回到对局（局面随后由对方 sync 同步过来）
        onlineColor = m.color; spectating = false; wasSpectating = false; reconnecting = false; reconnectTries = 0; awaitingSync = true;
        onlineResult = null; pendingOffer = null; peerDown = false; saveOnlineSession();
        redNick = m.color === 'red' ? m.you : m.opponent; blackNick = m.color === 'red' ? m.opponent : m.you;
        setOnlineView('game'); oGameMsg.textContent = '已重连'; refresh();
        break;
      case 'spectating':
        spectating = true; onlineColor = null; wasSpectating = true; reconnecting = false; reconnectTries = 0;
        saveOnlineSession();
        redNick = m.players[0]; blackNick = m.players[1];
        setOnlineView('spectate');
        oSpectateBanner.textContent = `观战中 · 红 ${redNick} vs 黑 ${blackNick}（同步中…）`;
        break;
      case 'need-sync':
        awaitingSync = false; // 被选为同步源 = 本方棋盘即权威，不再等待（兼解：重连后对方又掉线再回来时我方残留 awaitingSync 致走子卡住）
        online!.send({ t: 'sync', pgn: gameToPgn(controller.getGame(), {}) });
        break;
      case 'sync':
        try { controller.loadGame(pgnToGame(m.pgn)); awaitingSync = false; refresh(); if (isSpectating()) oSpectateBanner.textContent = `观战中 · 红 ${redNick} vs 黑 ${blackNick}`; }
        catch { awaitingSync = false; if (isSpectating()) oSpectateBanner.textContent = '同步失败，请退出重试'; else oGameMsg.textContent = '同步失败，请「退出」重连重试'; } // 解析失败也解锁：否则重连方 awaitingSync 永久 true、无法落子且(玩家分支)原本连提示都没有
        break;
      case 'error':
        if (reconnecting) {   // 重连/重新观战失败：对局已结束（双方都掉线、房已删）
          reconnecting = false; reconnectTries = 0; roomCode = ''; clearOnlineSession();
          if (wasSpectating) oSpectateBanner.textContent = '对局已结束，请退出';
          else finishOnlineGame('对局已结束');
        } else if (isSpectating()) oSpectateBanner.textContent = m.msg;
        else { roomCode = ''; wasSpectating = false; oLobbyMsg.textContent = m.msg; } // 大厅内加入/观战失败：清掉乐观写入的房码，防 WS 断后空转重连死房
        break;
      case 'peer-left': finishOnlineGame('对方已离开'); break;
      case 'peer-disconnected': if (!isSpectating()) { peerDown = true; oGameMsg.textContent = ''; updateStatus(); } break;
      case 'peer-reconnected': if (!isSpectating()) { peerDown = false; oGameMsg.textContent = '对方已重连'; updateStatus(); } break;
      case 'room-closed': oSpectateBanner.textContent = '该对局已结束/中断，可退出观战'; clearOnlineSession(); roomCode = ''; break; // 房已删，清房码防 WS 断开后误重连死房
      case 'move': {
        const mv = iccsToMove(m.iccs);
        const ok = controller.applyExternalMove(mv);
        if (ok) playMoveSound();   // 对方/被观战方落子也出音效，与本地一致
        if (ok && controller.lastMove) playMoveAnimation(controller.lastMove, refresh); else refresh();
        break;
      }
      case 'resign':
        if (isSpectating()) oSpectateBanner.textContent = '观战 · 一方认输';
        else finishOnlineGame('对方认输，你赢了');
        break;
      case 'draw-offer': if (!isSpectating()) { pendingOffer = 'draw'; oOfferText.textContent = '对方求和'; onlineOffer.hidden = false; } break;
      case 'draw-accept':
        if (isSpectating()) oSpectateBanner.textContent = '观战 · 双方和棋';
        else { pendingOffer = null; finishOnlineGame('和棋（对方接受求和）'); }
        break;
      case 'draw-decline': if (!isSpectating()) oGameMsg.textContent = '对方拒绝求和'; break;
      case 'undo-request': if (!isSpectating()) { pendingOffer = 'undo'; oOfferText.textContent = '对方请求悔棋'; onlineOffer.hidden = false; } break;
      case 'undo-accept': onlineOffer.hidden = true; pendingOffer = null; controller.undo(); controller.undo(); refresh(); break;
      case 'undo-decline': if (!isSpectating()) oGameMsg.textContent = '对方拒绝悔棋'; break;
    }
  }

  on(canvas, 'click', (ev: Event) => {
    if (browsing || inEndgame || isSpectating() || reconnecting || awaitingSync || (isOnline() && (onlineResult || controller.turn !== onlineColor))) return;
    if (timeoutLoser) return;
    if (busy() || aiTurnPending()) return; // 电脑回合/动画中不接受点击
    resumeAudio();
    const mev = ev as MouseEvent;
    const rect = canvas.getBoundingClientRect();
    const px = ((mev.clientX - rect.left) / rect.width) * BOARD_W;
    const py = ((mev.clientY - rect.top) / rect.height) * BOARD_H;
    const sq = pixelToSquare(px, py);
    if (!sq) return;
    const moved = controller.click(sq);
    if (moved) {
      onMovePlayed();
      playMoveSound();
      if (isOnline()) online!.send({ t: 'move', iccs: moveToIccs(controller.lastMove!) });
      playMoveAnimation(controller.lastMove!, () => {
        refresh();
        maybeRunAi();
      });
    } else {
      refresh();
    }
  });

  on(modeBtn, 'click', () => {
    if (busy()) return;
    // 双人 ↔ 人机（电脑执黑），切换即重开
    controller.setAi(controller.aiColor ? null : 'black', currentLevel());
    controller.reset();
    resetClock();
    modeBtn.textContent = controller.aiColor ? '人机' : '双人';
    levelField.hidden = controller.aiColor === null; // 仅人机模式显示棋力
    refresh();
    maybeRunAi(); // 若将来支持电脑执红，开局即应着
  });

  on(levelSel, 'change', () => {
    controller.setLevel(currentLevel()); // 即时生效于电脑后续着法
  });

  on(undoBtn, 'click', () => {
    if (busy()) return;
    controller.undo();
    if (clock && clockStack.length) clock = clockStack.pop()!;
    if (controller.aiColor && controller.turn === controller.aiColor) {
      controller.undo();
      if (clock && clockStack.length) clock = clockStack.pop()!;
    }
    timeoutLoser = null;
    if (clock) { renderClocks(); startClockTimer(); }
    refresh();
  });

  on(restartBtn, 'click', () => {
    if (busy()) return;
    controller.reset();
    resetClock();
    clearSaved();
    currentEgFen = null; resetEgBtn.hidden = true;
    refresh();
    maybeRunAi();
  });

  // 导出棋谱：下载 .pgn 文件
  on(exportBtn, 'click', () => {
    const text = gameToPgn(controller.getGame(), { date: today() });
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `xiangqi-${Date.now()}.pgn`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  // 导入棋谱：选文件 → 重放
  on(importBtn, 'click', () => importFile.click());
  on(importFile, 'change', async () => {
    const f = importFile.files?.[0];
    if (!f) return;
    try {
      const g = pgnToGame(await f.text());
      controller.setAi(null); // 导入的谱按双人复盘
      modeBtn.textContent = '双人';
      levelField.hidden = true;
      controller.loadGame(g);
      timeoutLoser = null; if (clock) resetClock(); // 清本地超时残留 + 为导入局起新钟，否则状态条卡在「超时负」压住实际局面
      refresh();
    } catch (e) {
      alert('棋谱解析失败：' + (e as Error).message);
    } finally {
      importFile.value = ''; // 允许重复导入同一文件
    }
  });

  // 主题切换：即时重绘 + 记住选择
  on(themeSel, 'change', () => {
    theme = themeByKey(themeSel.value);
    saveTheme(theme.key);
    refresh();
  });

  on(clockModeSel, 'change', applyClockMode);
  on(mainMinInput, 'change', () => { if (clockModeSel.value !== 'off') applyClockMode(); });
  on(byoSecInput, 'change', () => { if (clockModeSel.value !== 'off') applyClockMode(); });

  on(muteBtn, 'click', () => {
    resumeAudio();
    setMuted(!isMuted());
    saveMuted(isMuted());
    syncMuteBtn();
  });

  on(bookBtn, 'click', () => {
    bookHintOn = !bookHintOn;
    saveBookHint(bookHintOn);
    syncBookBtn();
    refresh();
  });

  on(browseBtn, 'click', () => { if (busy()) return; if (browsing) exitBrowse(); else enterBrowse(); });
  on(openSel, 'change', () => { if (!browsing) return; session = new BrowseSession(OPENINGS.find((o) => o.id === openSel.value)!); renderBrowse(); });
  on(bNext, 'click', () => { if (!session) return; session.next(Number(varSel.value) || 0); renderBrowse(); });
  on(bPrev, 'click', () => { if (!session) return; session.prev(); renderBrowse(); });
  on(bExit, 'click', exitBrowse);

  on(endgameBtn, 'click', () => { if (busy()) return; if (inEndgame) exitEndgame(); else enterEndgame(); });
  on(egSel, 'change', () => { if (!inEndgame) return; egLine = null; renderEndgame(); });
  on(egPlay, 'click', playEndgame);
  on(egSolve, 'click', () => { egLine = new EndgameLine(curEg()); renderEndgame(); });
  on(egPrev, 'click', () => { if (egLine) { egLine.prev(); renderEndgame(); } });
  on(egNext, 'click', () => { if (egLine) { egLine.next(); renderEndgame(); } });
  on(egExit, 'click', exitEndgame);
  on(resetEgBtn, 'click', () => {
    if (!currentEgFen) return;
    const { board, turn } = fromFen(currentEgFen);
    controller.loadGame(Game.fromPosition(board, turn));
    refresh();
  });

  // 顶部「联机」按钮：未联机→进入；已在联机的任意状态(含对局,此时面板隐藏)→退出
  on(onlineBtn, 'click', () => { if (online === null && busy()) return; if (!onlinePanel.hidden || online !== null) exitOnline(); else enterOnline(); });
  on(oEnter, 'click', submitNick);
  on(oNickInput, 'keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') submitNick(); });
  on(oRename, 'click', () => { const n = prompt('改昵称', myNick); const t = (n || '').trim(); if (!t) return; pendingRename = t; online?.rename(t); });
  on(oCreate, 'click', () => { online?.createRoom(oPrivate.checked); });
  on(oCodeSubmit, 'click', () => { const c = oCodeInput.value.trim().toUpperCase(); if (c) online?.joinRoom(c); });
  on(oExit, 'click', exitOnline);
  on(oCancel, 'click', backToLobby);
  on(oSpectateExit, 'click', backToLobby);
  on(oGameExit, 'click', backToLobby);
  on(oWaitCopy, 'click', () => { try { navigator.clipboard?.writeText(oWaitCodeVal.textContent || ''); oWaitCopy.textContent = '已复制'; setTimeout(() => { oWaitCopy.textContent = '复制'; }, 1500); } catch { /* 降级：手动选取 */ } });
  on(oResign, 'click', () => { if (!isOnline()) return; online!.send({ t: 'resign' }); finishOnlineGame('你已认输'); });
  on(oDraw, 'click', () => { if (isOnline()) { online!.send({ t: 'draw-offer' }); oGameMsg.textContent = '已发出求和，等待对方'; } });
  on(oUndo, 'click', () => { if (isOnline()) { online!.send({ t: 'undo-request' }); oGameMsg.textContent = '已请求悔棋，等待对方'; } });
  on(oAccept, 'click', () => {
    onlineOffer.hidden = true;
    if (pendingOffer === 'draw') { online!.send({ t: 'draw-accept' }); finishOnlineGame('和棋'); }
    else if (pendingOffer === 'undo') { online!.send({ t: 'undo-accept' }); controller.undo(); controller.undo(); refresh(); }
    pendingOffer = null;
  });
  on(oDecline, 'click', () => {
    onlineOffer.hidden = true;
    if (pendingOffer === 'draw') online!.send({ t: 'draw-decline' });
    else if (pendingOffer === 'undo') online!.send({ t: 'undo-decline' });
    pendingOffer = null;
  });

  // 启动时若有上次对局，自动续局。
  // 已知限制：人机模式（aiColor）不进 PGN，续局后回到双人，需手动再开人机。
  clearSaved();   // 刷新即重新开局：不再自动续局，并清掉旧版遗留的自动存档

  // 控件折叠组：点头部（箭头）展开/收起
  host.querySelectorAll<HTMLElement>('.fold-head').forEach((h) => on(h, 'click', () => h.parentElement!.classList.toggle('open')));

  setupCanvas();
  refresh();

  // 嵌入的楷书子集字体加载完后重绘一次，避免首帧用系统兜底字体（确保四系统字形一致）。
  document.fonts?.load('30px "XiangqiKai"', '帅将仕士相象马车炮兵卒楚河漢界').then(refresh).catch(() => {});

  // 刷新/切后台回来：若 sessionStorage 有进行中的联机对局/观战，自动重连回房间
  const onlineSaved = loadOnlineSession();
  if (onlineSaved && onlineSaved.code && onlineSaved.nick) {
    myNick = onlineSaved.nick; roomCode = onlineSaved.code; wasSpectating = !!onlineSaved.spectate;
    ($('.controls') as HTMLElement).hidden = true;
    bookLine.hidden = true; clocksEl.hidden = true; stopClockTimer();
    onlinePanel.hidden = false;
    if (wasSpectating) { spectating = true; setOnlineView('spectate'); oSpectateBanner.textContent = '重连中…'; }
    else { onlineColor = 'red'; setOnlineView('game'); oGameMsg.textContent = '重连中…'; }
    attemptReconnect();
  }

  const cleanup = () => {
    listeners.forEach(({ t, type, fn }) => t.removeEventListener(type, fn));
    host.remove();
  };
  return cleanup;   // 5c/5d 再补定时器/ws 清理
}
