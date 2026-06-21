import type { Card, Seat, Rank } from '../src/games/guandan/engine/types';
import { dealHands, startMatch, dealLevel, settleDeal, type MatchState, type SettleResult } from '../src/games/guandan/engine/match';
import { createDeal, play, pass, isDealOver, ranking, type DealState } from '../src/games/guandan/engine/game';
import { sortHand } from '../src/games/guandan/engine/cards';
import { isLegalPlay } from '../src/games/guandan/engine/legal';
import { choosePlay } from '../src/games/guandan/ai/ai';

export type Outbound = { to: 'all' | 'seat'; seat?: Seat; msg: any };

interface PendingResult {
  finished: Seat[];
  settle: SettleResult;
  lastHand: Card[];
}

export class MatchDriver {
  match: MatchState;
  state: DealState;
  online: boolean[] = [true, true, true, true]; // 座位是否真人在线（false=AI 接管）
  shuffle: (n: number) => number[];
  lastPlays: ({ cards: Card[] } | 'pass' | null)[] = [null, null, null, null];
  lastActor: Seat | null = null;
  phase: 'playing' | 'dealResult' | 'tribute' | 'matchOver' = 'playing';
  pendingResult: PendingResult | null = null;
  constructor(opts: { shuffle?: (n: number) => number[] } = {}) {
    this.shuffle = opts.shuffle ?? defaultShuffle;
    this.match = startMatch();
    this.state = createDeal([[], [], [], []], 0, dealLevel(this.match)); // 占位，start() 真发牌
    this.phase = 'playing';
    this.pendingResult = null;
  }
  start(): Outbound[] {
    const hands = dealHands(this.shuffle);
    this.state = createDeal(hands, 0, dealLevel(this.match)); // 首局首攻=座位0（无进贡）
    this.lastPlays = [null, null, null, null];
    this.lastActor = null;
    this.phase = 'playing';
    this.pendingResult = null;
    return [this.broadcastState(), ...this.handMsgs()];
  }
  publicState() {
    const s = this.state;
    const base = {
      phase: this.phase, turn: s.turn, current: s.current ? { ...s.current.combo, by: s.current.by } : null,
      lastActor: this.lastActor,
      seats: ([0, 1, 2, 3] as Seat[]).map(i => ({
        seat: i, count: s.hands[i]!.length,
        lastPlay: this.lastPlays[i] ?? null, finishRank: rankOf(s.finished, i), online: this.online[i], ai: !this.online[i],
      })),
      level: s.level, levels: this.match.levels, trumpTeam: this.match.trumpTeam, dealNo: this.match.dealNo,
    };
    if ((this.phase === 'dealResult' || this.phase === 'matchOver') && this.pendingResult) {
      const { finished, settle, lastHand } = this.pendingResult;
      const result = {
        ranking: finished,
        gain: settle.gain,
        passedA: settle.passedA,
        stuck: settle.stuck,
        demoted: settle.demoted,
        lastHand,
      };
      if (this.phase === 'matchOver') {
        return { ...base, result, winner: settle.match.winner };
      }
      return { ...base, result };
    }
    return base;
  }
  broadcastState(): Outbound { return { to: 'all', msg: { t: 'state', ...this.publicState() } }; }
  handMsgs(): Outbound[] {
    return ([0, 1, 2, 3] as Seat[]).map(i => ({
      to: 'seat', seat: i, msg: { t: 'hand', cards: sortHand(this.state.hands[i]!, this.state.level) },
    }));
  }
  syncSeat(seat: Seat): Outbound[] {
    return [
      { to: 'seat', seat, msg: { t: 'state', ...this.publicState() } },
      { to: 'seat', seat, msg: { t: 'hand', cards: sortHand(this.state.hands[seat]!, this.state.level) } },
    ];
  }
  spectatorSync(_client: unknown): Outbound[] {
    return [{ to: 'all', msg: { t: 'state', ...this.publicState() } }];
  }

  // ── PUBLIC: validate → applyPlay → afterAction → driveAI ──────────────────
  handlePlay(seat: Seat, cardIds: number[]): Outbound[] {
    if (this.state.turn !== seat) return [err(seat, '还没轮到你')];
    const cards = this.cardsByIds(seat, cardIds);
    if (!cards) return [err(seat, '牌不在你手里')];
    if (!isLegalPlay(cards, this.state.current?.combo ?? null, this.state.hands[seat]!, this.state.level))
      return [err(seat, '不合规')];
    this.applyPlay(seat, cards);
    return [...this.afterAction(seat), ...this.driveAI()];
  }
  handlePass(seat: Seat): Outbound[] {
    if (this.state.turn !== seat) return [err(seat, '还没轮到你')];
    if (this.state.current === null) return [err(seat, '领出不能不要')];
    this.applyPass(seat);
    return [...this.afterAction(seat), ...this.driveAI()];
  }

  // ── PRIVATE: state-advancing core (no driveAI) ────────────────────────────
  private applyPlay(seat: Seat, cards: Card[]): void {
    const wasLead = this.state.current === null;
    this.state = play(this.state, seat, cards);
    if (wasLead) this.lastPlays = [null, null, null, null];
    this.lastPlays[seat] = { cards };
    this.lastActor = seat;
  }
  private applyPass(seat: Seat): void {
    this.state = pass(this.state, seat);
    this.lastPlays[seat] = 'pass';
    this.lastActor = seat;
  }

  // ── AI 接管 ───────────────────────────────────────────────────────────────
  setAI(seat: Seat, on: boolean): Outbound[] {
    this.online[seat] = !on;
    const out: Outbound[] = [this.broadcastState()];
    out.push(...this.driveAI());
    return out;
  }

  private driveAI(): Outbound[] {
    const out: Outbound[] = [];
    let guard = 0;
    while (!isDealOver(this.state) && !this.online[this.state.turn] && guard++ < 200) {
      const seat = this.state.turn;
      const decision = choosePlay(this.state, seat);
      if (decision === null) {
        this.applyPass(seat);
      } else {
        this.applyPlay(seat, decision);
      }
      out.push(...this.afterAction(seat));
    }
    return out;
  }

  private afterAction(actor: Seat): Outbound[] {
    const out: Outbound[] = [];
    if (isDealOver(this.state)) {
      const finished = ranking(this.state);
      const settle = settleDeal(this.match, finished);
      this.match = settle.match;
      const lastSeat = finished[3] as Seat;
      this.phase = settle.match.over ? 'matchOver' : 'dealResult';
      this.pendingResult = { finished, settle, lastHand: this.state.hands[lastSeat]! };
      out.push(this.broadcastState());
    } else {
      out.push(this.broadcastState(), { to: 'seat', seat: actor, msg: { t: 'hand', cards: sortHand(this.state.hands[actor]!, this.state.level) } });
    }
    return out;
  }
  private cardsByIds(seat: Seat, ids: number[]): Card[] | null {
    const hand = this.state.hands[seat]!; const out: Card[] = [];
    for (const id of ids) { const c = hand.find(x => x.id === id); if (!c) return null; out.push(c); }
    return out.length ? out : null;
  }
}

function err(seat: Seat, msg: string): Outbound { return { to: 'seat', seat, msg: { t: 'error', msg } }; }

function rankOf(finished: Seat[], seat: Seat): 1 | 2 | 3 | 4 | null {
  const i = finished.indexOf(seat); return i === -1 ? null : ((i + 1) as 1 | 2 | 3 | 4);
}
function defaultShuffle(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]!; a[i] = a[j]!; a[j] = t; }
  return a;
}
