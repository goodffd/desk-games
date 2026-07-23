/**
 * 干瞪眼 AI：启发式 + 记牌。纯函数、无 DOM、无网络——engine 是规则唯一真相，AI 只在
 * engine 枚举出的合法候选里挑，绝不自己造牌（故「永不非法」由 enumerate + 模糊测试兜底）。
 *
 * 决策只用**公开信息**：自己的手牌 + 桌面当前牌 + 全场已出牌（state.played）。不看别家手牌、
 * 不看牌堆——记牌记的是「未知池里各点数还剩几张」，据此估「我领这手下家接得上的概率」。
 *
 * 三条 owner 定的启发式（SPEC / #14）：
 *   - 留 2 与炸弹当逃生口（单张2/对2压任意、炸弹压非炸），不到万不得已不花。
 *   - 优先拆手里难出的牌（低单张、孤张），把好牌/逃生口留到后面。
 *   - 王优先搭进顺子与对子，而不是做炸——王炸/带王炸是最大的浪费。
 */
import type { Card, Combo, Play, Rank } from '../engine/types';
import { power } from '../engine/types';
import { enumerateLeads, enumerateFollows } from '../engine/legal';

export interface AiView {
  hand: readonly Card[];
  /** 桌面当前牌；null = 轮到我领出。 */
  current: Combo | null;
  /** 全场已出过的牌（公开）。用于记牌估未知池分布。 */
  played: readonly Card[];
  seatCount: number;
}

/** 一副牌里每个自然点数各 4 张（2..A），王另计 2 张。 */
const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

/** 记牌：未知池（别家手牌 + 牌堆）里每个自然点数还剩几张 = 4 − 我手 − 已出。 */
function unseenByRank(view: AiView): Map<Rank, number> {
  const seen = new Map<Rank, number>();
  const bump = (cards: readonly Card[]) => {
    for (const c of cards) if (c.kind === 'normal') seen.set(c.rank, (seen.get(c.rank) ?? 0) + 1);
  };
  bump(view.hand);
  bump(view.played);
  const unseen = new Map<Rank, number>();
  for (const r of RANKS) unseen.set(r, Math.max(0, 4 - (seen.get(r) ?? 0)));
  return unseen;
}

const isBomb = (t: Combo['type']): boolean => t === 'bomb' || t === 'jokerBomb';
const spent2 = (cards: readonly Card[]): number => cards.filter((c) => c.kind === 'normal' && c.rank === 2).length;

/**
 * 给一手候选打分（越高越该出）。领出与跟牌共用，`lead` 时叠加记牌的「下家难接」加成。
 * 权重是原则化拍的（本项目无强弱对打台架，不做数值寻优）：逃生口/废王的惩罚要压得住多甩牌的诱惑。
 */
function score(p: Play, view: AiView, unseen: Map<Rank, number>, lead: boolean): number {
  const { combo, cards, assign } = p;
  const bomb = isBomb(combo.type);
  let s = 0;

  s += 3 * cards.length;                                   // 多甩牌：清手是目标

  // 逃生口：炸弹、单张/对 2 是大一法则的唯一例外，留着救命
  if (bomb) s -= 5 * cards.length;                         // 花一个炸很贵
  if (combo.type === 'jokerBomb') s -= 20;                 // 王炸最亏（两张王全烧了）
  s -= 6 * spent2(cards);                                  // 每花一张 2 都心疼

  // 王：搭进顺子/对子是正用，进炸是浪费
  if (bomb) s -= 8 * assign.length;                        // 炸里每带一张王都是浪费
  else s += 4 * assign.length;                             // 顺/对里用王把死牌盘活，鼓励

  // 拆难出的牌：优先甩低单张/孤张，把高牌与逃生口留后面
  const shedPower = cards.reduce((n, c) => n + (c.kind === 'normal' ? power(c.rank) : 16), 0) / cards.length;
  s += (15 - shedPower) * 0.4;                             // 平均越低越优先甩

  // 记牌：领出时，下家越难接越好（我大概率赢这轮 → 摸牌 + 继续领）
  if (lead && combo.type === 'single') {
    // 单张跟牌要点数正好大一级；看未知池里「大一级」那点还剩几张，越少越安全
    const nextRank = (combo.key + 1) as Rank;
    const followers = nextRank <= 14 ? (unseen.get(nextRank) ?? 0) : 0;
    s += (4 - followers) * 1.2;                            // 4→没剩(安全)加成大；0→都在别家手里，扣
  }
  return s;
}

/** 从候选里挑分最高的一手。`options` 非空。 */
function best(options: Play[], view: AiView, unseen: Map<Rank, number>, lead: boolean): Play {
  let top = options[0]!;
  let topScore = score(top, view, unseen, lead);
  for (let i = 1; i < options.length; i++) {
    const sc = score(options[i]!, view, unseen, lead);
    if (sc > topScore) { top = options[i]!; topScore = sc; }
  }
  return top;
}

/**
 * 选一手出（含每张王的指派）；返回 null = 过。
 *   - 领出：无合法手（手里只剩王）→ null（服务端据此顺延）；否则挑最优领出。
 *   - 跟牌：跟不上 → null；要得起时，若唯一能压的手要烧炸弹/王炸而手牌还不紧张，选择过（留逃生口）。
 */
export function chooseGandengyanPlay(view: AiView): Play | null {
  const unseen = unseenByRank(view);

  if (view.current === null) {
    const leads = enumerateLeads(view.hand);
    if (leads.length === 0) return null;
    return best(leads, view, unseen, true);
  }

  const follows = enumerateFollows(view.hand, view.current);
  if (follows.length === 0) return null;
  const pick = best(follows, view, unseen, false);
  // 要得起也可以过：若最优跟牌得烧炸弹/王炸，且手牌不紧张（>3 张），留着逃生口，过。
  const urgent = view.hand.length <= 3;
  if (!urgent && isBomb(pick.combo.type)) {
    const nonBomb = follows.filter((f) => !isBomb(f.combo.type));
    if (nonBomb.length === 0) return null;                 // 只有炸能压 → 忍住，过
    return best(nonBomb, view, unseen, false);
  }
  return pick;
}
