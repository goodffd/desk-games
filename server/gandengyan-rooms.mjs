// 干瞪眼房间：通用牌类房间层（card-rooms.mjs）+ 干瞪眼适配器。
//
// 跟掼蛋的适配器比，这份短得多——干瞪眼**没有任何要房间层等着做的事**：
//   - 不自动续局：本局结算不跨局累计，打完由房主点「再来一局」
//   - 没有进贡，也就没有「谁发呆就替他还贡」这类催办
// 剩下的只有「把在线态和倒计时写进自己的公开态」。
import { CardRoomRegistry, defaultCode } from './card-rooms.mjs';

/** 把干瞪眼的对局驱动包成房间层认识的运行器。 */
function wrapDriver(d) {
  return {
    raw: d,
    start: () => d.start(),
    setAI: (seat, on) => d.setAI(seat, on),
    syncSeat: (seat) => d.syncSeat(seat),
    spectatorSync: (client) => d.spectatorSync(client),
    broadcastState: () => [d.broadcastState()],

    canForceAutoPlay: () => true,
    forceAutoPlay: () => d.forceAutoPlay(),
    canStepAI: () => true,
    stepAI: () => d.stepAI(),
    canNextDeal: () => false,          // 不自动续局
    nextDeal: () => [],
    forceAutoReturn: () => [],

    turnSeat: () => (d.phase === 'playing' ? d.state.turn : null),
    progress: () => d.ply,
    /** 本局打完就算「可以再来一局」——干瞪眼一局一结算，没有整盘的概念。 */
    isOver: () => d.phase === 'dealResult',

    /** 房间层不认识的消息原样送到这里。干瞪眼认出牌与过牌两种。 */
    handleGameMessage(seat, msg) {
      if (msg.t === 'play') return d.handlePlay(seat, msg.cardIds, msg.assign);
      if (msg.t === 'pass') return d.handlePass(seat);
      return null;
    },
  };
}

function gandengyanAdapter(makeDriver) {
  return {
    minSeats: 2,
    maxSeats: 5,   // 房主建房时在这个区间里选

    createRunner(room) {
      const d = makeDriver ? makeDriver(room) : null;
      return d ? wrapDriver(d) : null;
    },

    /** 房间层给事实，干瞪眼自己写进自己的公开态。 */
    decorate(outbound, { presence, turnRemainMs }) {
      for (const o of outbound) {
        const m = o && o.msg;
        if (!m || m.t !== 'state') continue;
        if (turnRemainMs != null && m.phase === 'playing') m.turnRemainMs = turnRemainMs;
        if (Array.isArray(m.seats)) {
          for (const sp of m.seats) {
            const p = presence[sp.seat];
            sp.online = !!(p && p.online);
            sp.disconnected = !!(p && p.disconnected);
            sp.ai = !!(p && p.ai);
          }
        }
      }
      return outbound;
    },

    autoAdvance: () => null,       // 打完就停在结算，等房主再来一局
    pendingDecision: () => null,   // 没有进贡这类要催的环节
    clearPendingOn: () => false,
  };
}

export class RoomRegistry extends CardRoomRegistry {
  constructor(
    codeGen = defaultCode,
    makeDriver = null,
    turnTimeoutMs = 0,
    disconnectGraceMs = 0,
    disconnectGraceMisses = 2,
    nicks = undefined,   // 传入则与其它游戏共用一套昵称占用表（全服唯一）
    aiDelayMs = null,    // AI 每手思考延迟；冒烟时调小以免一局磨很久
  ) {
    super({
      adapter: gandengyanAdapter(makeDriver),
      codeGen,
      turnTimeoutMs,
      disconnectGraceMs,
      disconnectGraceMisses,
      ...(nicks ? { nicks } : {}),
      ...(aiDelayMs != null ? { aiDelayMs } : {}),
    });
  }
}
