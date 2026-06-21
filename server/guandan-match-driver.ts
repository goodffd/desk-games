import type { Card, Seat, Rank } from '../src/games/guandan/engine/types';
import { dealHands, startMatch, dealLevel, type MatchState } from '../src/games/guandan/engine/match';
import { createDeal, play, pass, isDealOver, type DealState } from '../src/games/guandan/engine/game';
import { sortHand } from '../src/games/guandan/engine/cards';
import { isLegalPlay } from '../src/games/guandan/engine/legal';

export type Outbound = { to: 'all' | 'seat'; seat?: Seat; msg: any };

export class MatchDriver {
  match: MatchState;
  state: DealState;
  online: boolean[] = [true, true, true, true]; // 座位是否真人在线（false=AI 接管）
  shuffle: (n: number) => number[];
  lastPlays: ({ cards: Card[] } | 'pass' | null)[] = [null, null, null, null];
  lastActor: Seat | null = null;
  constructor(opts: { shuffle?: (n: number) => number[] } = {}) {
    this.shuffle = opts.shuffle ?? defaultShuffle;
    this.match = startMatch();
    this.state = createDeal([[], [], [], []], 0, dealLevel(this.match)); // 占位，start() 真发牌
  }
  start(): Outbound[] {
    const hands = dealHands(this.shuffle);
    this.state = createDeal(hands, 0, dealLevel(this.match)); // 首局首攻=座位0（无进贡）
    this.lastPlays = [null, null, null, null];
    this.lastActor = null;
    return [this.broadcastState(), ...this.handMsgs()];
  }
  publicState() {
    const s = this.state;
    return {
      phase: 'playing', turn: s.turn, current: s.current ? { ...s.current.combo, by: s.current.by } : null,
      lastActor: this.lastActor,
      seats: ([0, 1, 2, 3] as Seat[]).map(i => ({
        seat: i, count: s.hands[i]!.length,
        lastPlay: this.lastPlays[i] ?? null, finishRank: rankOf(s.finished, i), online: this.online[i], ai: !this.online[i],
      })),
      level: s.level, levels: this.match.levels, trumpTeam: this.match.trumpTeam, dealNo: this.match.dealNo,
    };
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
  handlePlay(seat: Seat, cardIds: number[]): Outbound[] {
    if (this.state.turn !== seat) return [err(seat, '还没轮到你')];
    const cards = this.cardsByIds(seat, cardIds);
    if (!cards) return [err(seat, '牌不在你手里')];
    if (!isLegalPlay(cards, this.state.current?.combo ?? null, this.state.hands[seat]!, this.state.level))
      return [err(seat, '不合规')];
    const wasLead = this.state.current === null;
    this.state = play(this.state, seat, cards);
    if (wasLead) this.lastPlays = [null, null, null, null];
    this.lastPlays[seat] = { cards };
    this.lastActor = seat;
    return this.afterAction(seat);
  }
  handlePass(seat: Seat): Outbound[] {
    if (this.state.turn !== seat) return [err(seat, '还没轮到你')];
    if (this.state.current === null) return [err(seat, '领出不能不要')];
    this.state = pass(this.state, seat);
    this.lastPlays[seat] = 'pass';
    this.lastActor = seat;
    return this.afterAction(seat);
  }
  private afterAction(actor: Seat): Outbound[] {
    const out: Outbound[] = [this.broadcastState(), { to: 'seat', seat: actor, msg: { t: 'hand', cards: sortHand(this.state.hands[actor]!, this.state.level) } }];
    // Task 13 会在这里追加：deal over → settle/tribute；AI 续手
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
