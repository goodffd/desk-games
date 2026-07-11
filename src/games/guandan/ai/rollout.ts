/**
 * Guandan AI 残局 determinized rollout — 纯函数，NEVER imports DOM。
 * 诚实：不偷看对手真手牌。做法=从"未现身牌"(unseen)按各家已知张数随机采样若干副可能手牌，
 * 用基策略把每种可能推演到局终，取"团队收益期望最高"的一手。
 * 打分权重：本队头游(×10) > 双下(+4) > 自己早走(3−名次)。仅残局触发，推演短、成本可控。
 */
import type { Card, Seat } from '../engine/types';
import { type DealState, play, pass, isDealOver } from '../engine/game';
import { enumerateLeads, enumerateFollows } from '../engine/legal';
import { computeUnseen } from './counting';

const K_ROLLOUTS = 10;     // 每候选采样局数（真残局方差低，可多采几局）
const CANDIDATE_CAP = 8;   // 候选手上限（控成本）
const MAX_STEPS = 200;     // 单次推演步数保险丝
const OVERRIDE_MARGIN = 0.5; // 别的候选须比启发式选择高出此分才覆盖（防噪声负优化）

type BasePolicy = (s: DealState, seat: Seat, unseen: Card[]) => Card[] | null;

/** 确定性 LCG（AI 须为状态的可复现函数，不用 Math.random）。 */
function makeRng(seed: number): () => number {
  let st = (seed >>> 0) || 1;
  return () => (st = (Math.imul(st, 1664525) + 1013904223) >>> 0);
}
function shuffled(cards: Card[], rng: () => number): Card[] {
  const a = [...cards];
  for (let i = a.length - 1; i > 0; i--) { const j = rng() % (i + 1); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
}

/** 候选手：领牌=所有合法领(截断)；跟牌=所有合法跟 + 不要(null)。null 表示 pass。 */
function candidates(s: DealState, seat: Seat): (Card[] | null)[] {
  const hand = s.hands[seat]!;
  const level = s.level;
  let combos: Card[][];
  if (s.current === null) {
    combos = enumerateLeads(hand, level).map(c => c.cards);
  } else {
    combos = enumerateFollows(hand, s.current.combo, level).map(c => c.cards);
  }
  // 去重（同一组牌的不同 reading）：按 id 集合签名
  const seen = new Set<string>();
  const uniq: Card[][] = [];
  for (const cards of combos) {
    const key = cards.map(c => c.id).sort((a, b) => a - b).join(',');
    if (!seen.has(key)) { seen.add(key); uniq.push(cards); }
  }
  const out: (Card[] | null)[] = uniq;
  if (s.current !== null) out.push(null); // 跟牌可不要
  return out;
}

/** 一组牌的 id 签名（去重/比较用）；null=pass。 */
function moveKey(m: Card[] | null): string {
  return m === null ? 'PASS' : m.map(c => c.id).sort((a, b) => a - b).join(',');
}

/** 从 unseen 按各家张数采样一副 determinized 全局态（自己手牌保真）。 */
function determinize(s: DealState, seat: Seat, unseen: Card[], rng: () => number): DealState {
  const pool = shuffled(unseen, rng);
  let idx = 0;
  const hands = s.hands.map((h, i) => {
    if (i === seat) return h;               // 自己真手牌
    const slice = pool.slice(idx, idx + h.length); // 其余按已知张数发采样牌
    idx += h.length;
    return slice;
  });
  return { ...s, hands };
}

/** 局终团队打分（从 seat 视角）。 */
function scoreOutcome(st: DealState, seat: Seat): number {
  const myTeam = seat % 2;
  const rank = st.finished;
  const teamHead = (rank[0]! % 2) === myTeam ? 1 : 0;
  const doubleDown = teamHead === 1 && (rank[1]! % 2) === myTeam ? 1 : 0;
  const myIndex = rank.indexOf(seat); // 0..3，越小越早走
  return teamHead * 10 + doubleDown * 4 + (3 - myIndex);
}

/** 一次推演：采样→出候选手→基策略跑到局终→打分。异常局面记 0 分（跳过）。 */
function playout(s: DealState, seat: Seat, move: Card[] | null, unseen: Card[], base: BasePolicy, rng: () => number): number {
  try {
    let st = determinize(s, seat, unseen, rng);
    st = move === null ? pass(st, seat) : play(st, seat, move);
    for (let step = 0; step < MAX_STEPS && !isDealOver(st); step++) {
      const t = st.turn;
      const mv = base(st, t, computeUnseen(st, t));
      st = mv === null ? pass(st, t) : play(st, t, mv);
    }
    return isDealOver(st) ? scoreOutcome(st, seat) : 0;
  } catch {
    return 0;
  }
}

/**
 * 残局精算（精修式）：把启发式选择 incumbent 纳入候选集，对每个候选跑 K 次 determinized 推演，
 * 取平均分。只有别的候选比 incumbent 高出 OVERRIDE_MARGIN 才覆盖，否则用 incumbent——保证不劣于启发式。
 */
export function endgameRollout(
  s: DealState, seat: Seat, unseen: Card[], base: BasePolicy, incumbent: Card[] | null,
): Card[] | null {
  // 候选集 = 合法手，且确保含 incumbent；截断但 incumbent 永不被截掉。
  const incKey = moveKey(incumbent);
  const all = candidates(s, seat);
  const capped = all.slice(0, CANDIDATE_CAP);
  if (!capped.some(m => moveKey(m) === incKey)) capped.push(incumbent);

  const baseSeed = (s.played?.length ?? 0) * 131 + seat * 17 + unseen.length;
  const scoreOf = (move: Card[] | null, ci: number): number => {
    let sum = 0;
    for (let k = 0; k < K_ROLLOUTS; k++) {
      sum += playout(s, seat, move, unseen, base, makeRng(baseSeed + ci * 1009 + k * 7919));
    }
    return sum / K_ROLLOUTS;
  };

  const incScore = scoreOf(incumbent, 999);
  let best: Card[] | null = incumbent;
  let bestScore = incScore;
  capped.forEach((move, ci) => {
    if (moveKey(move) === incKey) return;
    const avg = scoreOf(move, ci);
    if (avg > bestScore + OVERRIDE_MARGIN && avg > incScore + OVERRIDE_MARGIN) {
      bestScore = avg; best = move;
    }
  });
  return best;
}
