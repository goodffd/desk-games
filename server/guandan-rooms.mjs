// 掼蛋房间：通用牌类房间层（card-rooms.mjs）+ 掼蛋适配器。
//
// 房间层只管座位、转发、回合计时、掉线宽限，**不拆对局消息**；
// 掼蛋独有的东西全在这个文件里：
//   - 公开态长什么样（往哪儿写 turnRemainMs、座位在线态）
//   - 单局结算后停留几秒再续局
//   - 还贡超时（且只在不止 1 个真人时才催）
//   - play / pass / tribute-return 这三种对局消息怎么落到 MatchDriver 上
//
// 对外签名与旧实现完全一致（位置参数），既有调用方与测试一个字不用改。
import { CardRoomRegistry, defaultCode } from './card-rooms.mjs';

/**
 * 把掼蛋的 MatchDriver 包成房间层认识的「运行器」。
 * 房间层只通过这层薄壳跟 driver 打交道，不直接读它的字段。
 */
function wrapDriver(d) {
  return {
    raw: d,
    start: () => (d.start ? d.start() : []),
    setAI: d.setAI ? ((seat, on) => d.setAI(seat, on)) : null,
    syncSeat: d.syncSeat ? ((seat) => d.syncSeat(seat)) : null,
    spectatorSync: d.spectatorSync ? ((client) => d.spectatorSync(client)) : null,
    broadcastState: d.broadcastState ? (() => [d.broadcastState()]) : null,

    canForceAutoPlay: () => typeof d.forceAutoPlay === 'function',
    forceAutoPlay: () => (d.forceAutoPlay ? d.forceAutoPlay() : []),
    canStepAI: () => typeof d.stepAI === 'function',
    stepAI: () => (d.stepAI ? d.stepAI() : []),
    canNextDeal: () => typeof d.nextDeal === 'function',
    nextDeal: () => d.nextDeal(),
    forceAutoReturn: () => (d.forceAutoReturn ? d.forceAutoReturn() : []),

    /** 轮到哪座；不在对局中返回 null（房间层据此决定要不要给回合计时） */
    turnSeat: () => ((d.phase === 'playing' && d.state && typeof d.state.turn === 'number') ? d.state.turn : null),
    /** 单调递增的行棋计数：用来区分「真出了一手」与「纯重广播」 */
    progress: () => (typeof d.ply === 'number' ? d.ply : 0),
    isOver: () => !!(d.match && d.match.over),

    /** 房间层不认识的消息原样送到这里。掼蛋认这三种，其余丢掉。 */
    handleGameMessage(seat, msg) {
      if (msg.t === 'play') return d.handlePlay(seat, Array.isArray(msg.cardIds) ? msg.cardIds : []); // 防畸形 cardIds 抛异常被顶层静默吞
      if (msg.t === 'pass') return d.handlePass(seat);
      if (msg.t === 'tribute-return') return d.handleTributeReturn(seat, msg.cardId);
      return null;
    },
  };
}

/** 掼蛋适配器：告诉房间层「几个座、怎么建运行器、事实往哪儿写、什么时候自动往下走」。 */
function guandanAdapter(makeDriver, { tributeTimeoutMs = 0, dealResultLingerMs = 0 } = {}) {
  return {
    minSeats: 4,
    maxSeats: 4,   // 掼蛋固定 4 人 2v2

    createRunner(room) {
      const d = makeDriver ? makeDriver(room) : null;
      return d ? wrapDriver(d) : null;
    },

    /**
     * 房间层把事实交过来，由掼蛋自己写进自己的公开态。
     * - 本回合剩余毫秒：只写进对局中的公开态，别盖到结算/进贡弹层上
     * - 座位在线态：以房间层的真实连接为准（driver 那边是「驱动视角」，掉线宽限座在它眼里仍是在线），
     *   客户端据此在头像上显示「掉线了 / AI 接管中」
     */
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

    /** 单局结算后停留几秒再续局：让玩家看清名次与末游剩牌，否则弹层被下一局瞬间覆盖。 */
    autoAdvance(outbound, runner) {
      const settled = outbound.some((o) => o.msg && o.msg.t === 'state' && o.msg.phase === 'dealResult');
      if (!settled || !runner.canNextDeal()) return null;
      return { delayMs: dealResultLingerMs, run: () => runner.nextDeal() };
    },

    /**
     * 还贡超时。**只在不止 1 个真人时才催**：多人才需防一人发呆卡住别人；
     * 单机（1 真人 + AI）没人等你，让你慢慢选（= 本地单机版的手感）。
     */
    pendingDecision(outbound, { humans }, runner) {
      const needs = outbound.some((o) => o.msg && o.msg.t === 'need-tribute');
      if (!needs || humans <= 1 || !tributeTimeoutMs) return null;
      return { delayMs: tributeTimeoutMs, run: () => runner.forceAutoReturn() };
    },

    /** 回到对局中 = 还贡这一步过去了，不用再催。 */
    clearPendingOn(outbound) {
      return outbound.some((o) => o.msg && o.msg.t === 'state' && o.msg.phase === 'playing');
    },
  };
}

/** 对外签名与旧实现完全一致，调用方与既有测试无需改动。 */
export class RoomRegistry extends CardRoomRegistry {
  constructor(
    codeGen = defaultCode,
    makeDriver = null,
    tributeTimeoutMs = 0,
    turnTimeoutMs = 0,
    disconnectGraceMs = 0,
    disconnectGraceMisses = 2,
    dealResultLingerMs = 0,
    nicks = undefined,   // 传入则与其它游戏共用一套昵称占用表（全服唯一）
  ) {
    super({
      adapter: guandanAdapter(makeDriver, { tributeTimeoutMs, dealResultLingerMs }),
      codeGen,
      turnTimeoutMs,
      disconnectGraceMs,
      disconnectGraceMisses,
      ...(nicks ? { nicks } : {}),
    });
  }
}
