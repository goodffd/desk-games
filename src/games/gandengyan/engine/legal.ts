import type { Card, Combo, Play, Rank, WildAssign } from './types';
import { MAX_BOMB_SIZE, RANK_A } from './types';
import { beats, comboIdentity, identify } from './combos';

/**
 * 合法出牌枚举：给一手牌，列出所有能打出去的组合（含每张王的指派）。
 *
 * **按牌型结构生成，不是暴力枚举子集。** 这一点是刻意的：
 * 测试那边用「暴力穷举子集 × 指派」当独立 oracle，双向对照本模块的产出。
 * 如果这里也写成暴力穷举，那条完备性属性就成了自己验自己，永远不会红。
 *
 * 生成出来的每一个候选，最后都还要过一遍 `identify` 才算数——
 * 牌型规则的真相只有一份，枚举器不复制判定。
 */

interface HandIndex {
  byRank: Map<Rank, Card[]>;
  jokers: Card[];
}

function indexHand(hand: readonly Card[]): HandIndex {
  const byRank = new Map<Rank, Card[]>();
  const jokers: Card[] = [];
  for (const c of hand) {
    if (c.kind === 'joker') { jokers.push(c); continue; }
    const bucket = byRank.get(c.rank);
    if (bucket) bucket.push(c); else byRank.set(c.rank, [c]);
  }
  return { byRank, jokers };
}

/** 一个「要凑什么」的需求：点数 → 需要几张。 */
type Need = readonly (readonly [Rank, number])[];

/**
 * 列出把 `need` 凑齐的所有**用牌方式**（真牌与王的不同搭配算不同方式）。
 *
 * 点数 2 只能用真牌填——**王不能替 2**。
 */
function fills(need: Need, idx: HandIndex): { cards: Card[]; assign: WildAssign[] }[] {
  const out: { cards: Card[]; assign: WildAssign[] }[] = [];

  const walk = (i: number, jokersUsed: number, cards: Card[], assign: WildAssign[]): void => {
    if (i === need.length) { out.push({ cards, assign }); return; }
    const [rank, count] = need[i]!;
    const real = idx.byRank.get(rank) ?? [];
    const maxJokers = rank === 2 ? 0 : Math.min(count, idx.jokers.length - jokersUsed);
    for (let j = 0; j <= maxJokers; j++) {
      const fromReal = count - j;
      if (fromReal > real.length) continue;
      const picked = idx.jokers.slice(jokersUsed, jokersUsed + j);
      walk(
        i + 1,
        jokersUsed + j,
        [...cards, ...real.slice(0, fromReal), ...picked],
        [...assign, ...picked.map((jk) => ({ jokerId: jk.id, rank }))],
      );
    }
  };

  walk(0, 0, [], []);
  return out;
}

/** 本副牌里出现过的点数 + 王能替的全部点数，作为「凑哪个点」的候选。 */
function candidateRanks(): Rank[] {
  return [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as Rank[];
}

/**
 * 列出这手牌所有能**领出**的打法。
 *
 * 去重口径：同一组牌 + 同一个牌型标识只留一条。花色不影响任何判定，
 * 所以「用黑桃 5 还是红桃 5」不算两种打法；但「用真牌还是用王」算——
 * 它决定手里剩下什么，对后续完全不同。
 */
export function enumerateLeads(hand: readonly Card[]): Play[] {
  const idx = indexHand(hand);
  const found = new Map<string, Play>();

  const consider = (cards: Card[], assign: WildAssign[]): void => {
    const combo = identify(cards, assign);
    if (!combo) return;
    const key = `${[...cards].map((c) => c.id).sort((a, b) => a - b).join(',')}#${comboIdentity(combo)}`;
    if (!found.has(key)) found.set(key, { cards, assign, combo });
  };

  const emit = (need: Need): void => {
    for (const f of fills(need, idx)) consider(f.cards, f.assign);
  };

  for (const r of candidateRanks()) {
    emit([[r, 1]]);                                    // 单张（王单出会被 identify 拒掉）
    emit([[r, 2]]);                                    // 对子
    for (let size = 3; size <= MAX_BOMB_SIZE; size++) emit([[r, size]]); // 炸弹
  }

  // 顺子：≥3 张，起点 3、封顶 A，2 不入顺
  for (let len = 3; len <= RANK_A - 3 + 1; len++) {
    for (let s = 3; s + len - 1 <= RANK_A; s++) {
      emit(Array.from({ length: len }, (_, k) => [(s + k) as Rank, 1] as const));
    }
  }

  // 连对：≥2 对，边界同顺子
  for (let pairs = 2; pairs <= RANK_A - 3 + 1; pairs++) {
    for (let s = 3; s + pairs - 1 <= RANK_A; s++) {
      emit(Array.from({ length: pairs }, (_, k) => [(s + k) as Rank, 2] as const));
    }
  }

  // 王炸：两张王一起打，不给指派
  if (idx.jokers.length === 2) consider([...idx.jokers], []);

  return [...found.values()];
}

/** 列出这手牌所有能**压住 `current`** 的打法。 */
export function enumerateFollows(hand: readonly Card[], current: Combo): Play[] {
  return enumerateLeads(hand).filter((p) => beats(current, p.combo));
}

/**
 * 这一手出牌合不合法：牌都在手里、指派站得住、牌型认得出，且（跟牌时）压得住桌面。
 * 判定全部委托给 `identify` / `beats`，本函数只做归属校验。
 */
export function isLegalPlay(
  hand: readonly Card[],
  cards: readonly Card[],
  assign: readonly WildAssign[],
  current: Combo | null,
): boolean {
  const handIds = new Set(hand.map((c) => c.id));
  const playIds = new Set(cards.map((c) => c.id));
  if (playIds.size !== cards.length) return false;
  for (const c of cards) if (!handIds.has(c.id)) return false;

  const combo = identify(cards, assign);
  if (!combo) return false;
  return current === null || beats(current, combo);
}
