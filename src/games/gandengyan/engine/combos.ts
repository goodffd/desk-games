import type { Card, Combo, Play, Rank, WildAssign } from './types';
import { MAX_BOMB_SIZE, POWER_TWO, RANK_A, power } from './types';

/** 王能替的最小点数：3。**替不了 2**——2 的特权不许被百搭复制。 */
const MIN_WILD_RANK = 3;

/**
 * 牌型识别与压制判定。engine 是规则唯一真相，UI 与 AI 不得另写一套判定。
 *
 * 大一法则是主干：跟牌须**同牌型、同张数、关键点数正好大一级**。
 * 上家出 5，你手里握着 K 和 A 也只能干瞪眼——只能出 6。
 *
 * 例外只有三个逃生口，它们**不走大一那条链**：
 *   ① 单张 2 压任意单张   ② 对 2 压任意对子   ③ 炸弹压任意非炸牌型
 *
 * 尚未实现：王的百搭与显式指派（#7）。在那之前，除了「大王 + 小王 = 王炸」，
 * 任何含王的组合都不成牌型。
 */

/**
 * 按指派把这一组牌折算成一串自然点数（升序）；指派不合法就返回 `null`。
 *
 * 引擎**只校验不推断**：指派由出牌方给出，这里逐条查——
 * 每张王恰好一条指派、指派只能指向本次打出的王、点数只能是 3~A。
 * 少一条、多一条、同一张王指派两次、指到普通牌、指到不存在的牌，一律不认。
 */
function effectiveRanks(cards: readonly Card[], assign: readonly WildAssign[]): Rank[] | null {
  const jokerIds = new Set(cards.filter((c) => c.kind === 'joker').map((c) => c.id));
  if (assign.length !== jokerIds.size) return null;              // 缺项 / 多项

  const byId = new Map<number, Rank>();
  for (const a of assign) {
    if (!jokerIds.has(a.jokerId)) return null;                   // 指到不存在的牌或普通牌
    if (byId.has(a.jokerId)) return null;                        // 同一张王指派两次
    if (!Number.isInteger(a.rank) || a.rank < MIN_WILD_RANK || a.rank > RANK_A) return null; // 越界；也挡住替 2
    byId.set(a.jokerId, a.rank);
  }

  const rs: Rank[] = [];
  for (const c of cards) rs.push(c.kind === 'joker' ? byId.get(c.id)! : c.rank);
  return rs.sort((a, b) => a - b);
}

/** 连续递增且不含 2（2 不入顺、也不入连对；A 只当最高位，自然序 3..14 天然满足）。 */
function isConsecutive(ranks: readonly Rank[]): boolean {
  if (ranks.some((r) => r === 2)) return false;
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i]! !== ranks[i - 1]! + 1) return false;
  }
  return true;
}

/** 王炸：恰好一张大王 + 一张小王。单张王出不去，两张王也只有这一种用法。 */
function identifyJokerBomb(cards: readonly Card[]): Combo | null {
  if (cards.length !== 2) return null;
  const jokers = cards.filter((c) => c.kind === 'joker');
  if (jokers.length !== 2) return null;
  const big = jokers.filter((c) => c.kind === 'joker' && c.big).length;
  if (big !== 1) return null; // 一副牌里大小王各一张，两张同色王不成王炸
  return { type: 'jokerBomb', cards: [...cards], length: 2, key: 0 };
}

/**
 * 认这一组牌是什么牌型；认不出来返回 `null`。
 *
 * 顺子与连对走**自然序**且封顶在 A：`2` 不参与，`A` 只当最高位，
 * 所以 `A23`、`KA2`、`A2345` 全部不成立。顺子长度不限，连对 2 对起。
 * 炸弹 3 或 4 张同点，**同一个炸最多 4 张**。
 */
export function identify(cards: readonly Card[], assign: readonly WildAssign[] = []): Combo | null {
  if (cards.length === 0) return null;

  const jokerCount = cards.reduce((n, c) => n + (c.kind === 'joker' ? 1 : 0), 0);

  // 王不能单独打出——给了指派也不行。这条制造了「手里只剩一张王就动不了」的局面，
  // 正是 #8 僵局规则要收的场。
  if (cards.length === 1 && jokerCount === 1) return null;

  // 双王不给指派 = 王炸；给了指派就按指派算（两张王当一对 5 也是合法的一种解释）。
  if (jokerCount === 2 && assign.length === 0) return identifyJokerBomb(cards);

  const ranks = effectiveRanks(cards, assign);
  if (!ranks) return null;
  const cs = [...cards];

  if (ranks.length === 1) {
    return { type: 'single', cards: cs, length: 1, key: power(ranks[0]!) };
  }

  if (ranks.length === 2 && ranks[0] === ranks[1]) {
    return { type: 'pair', cards: cs, length: 2, key: power(ranks[0]!) };
  }

  // 炸弹：3~4 张同点。超过 4 张一律不认——一副牌里同点只有 4 张，
  // 别让「张数越多越大」自然延伸出 5 张、6 张炸（#7 的王当替身时尤其危险）。
  const allSame = ranks.every((r) => r === ranks[0]);
  if (allSame && ranks.length >= 3) {
    if (ranks.length > MAX_BOMB_SIZE) return null;
    return { type: 'bomb', cards: cs, length: ranks.length, key: power(ranks[0]!) };
  }

  // 顺子：≥3 张、点数互不相同且连续
  if (ranks.length >= 3 && isConsecutive(ranks)) {
    return { type: 'run', cards: cs, length: ranks.length, key: ranks[ranks.length - 1]! };
  }

  // 连对：偶数张、≥2 对、每对同点且各对点数连续
  if (ranks.length >= 4 && ranks.length % 2 === 0) {
    const tops: Rank[] = [];
    for (let i = 0; i < ranks.length; i += 2) {
      if (ranks[i] !== ranks[i + 1]) { tops.length = 0; break; }
      tops.push(ranks[i]!);
    }
    if (tops.length >= 2 && isConsecutive(tops)) {
      return { type: 'pairRun', cards: cs, length: ranks.length, key: tops[tops.length - 1]! };
    }
  }

  return null;
}

/**
 * 牌型标识 = `牌型 | 张数 | 关键点数`，**花色不进标识**。
 *
 * 它回答的是「这一手打出去之后，对外呈现的身份是什么」。两种指派只要标识相同，
 * 就是同一手牌——`王 + 黑桃5` 当对 5 时，王算红桃 5 还是方块 5 没有任何区别，
 * 界面不该为此打断玩家。
 */
export function comboIdentity(c: Combo): string {
  return `${c.type}|${c.length}|${c.key}`;
}

/**
 * 枚举这一组牌**所有牌型标识互不相同**的合法解释，每种标识留一个代表。
 *
 * 这是界面判断「要不要弹二选一」的唯一入口：返回多于一项就是歧义。
 * 王最多两张，点数 3~A 共 12 种，所以最多 12² = 144 次试探，随手就跑完。
 *
 * 为什么不能像掼蛋那样「枚举所有指派、取最强的那个」自动定案（见 ADR-0002）：
 * 大一法则下 `王+5+6` 出成 567 比出成 456「更强」，但下家要 678 才接得上 vs
 * 要 567 才接得上——哪个更难被接取决于对手手牌，**不存在支配解**。
 * 自动定案等于替玩家做了一个实打实影响胜负的决定。
 */
export function enumerateIdentities(cards: readonly Card[], current: Combo | null = null): Play[] {
  const jokers = cards.filter((c) => c.kind === 'joker');
  const found = new Map<string, Play>();

  const tryAssign = (assign: WildAssign[]): void => {
    const combo = identify(cards, assign);
    if (!combo) return;
    if (current && !beats(current, combo)) return; // 跟牌语境：压不住的解释不算数
    const key = comboIdentity(combo);
    if (!found.has(key)) found.set(key, { cards: [...cards], assign, combo });
  };

  tryAssign([]); // 无王的普通牌型，以及双王当王炸

  if (jokers.length === 1) {
    for (let r = MIN_WILD_RANK; r <= RANK_A; r++) {
      tryAssign([{ jokerId: jokers[0]!.id, rank: r as Rank }]);
    }
  } else if (jokers.length === 2) {
    for (let a = MIN_WILD_RANK; a <= RANK_A; a++) {
      for (let b = MIN_WILD_RANK; b <= RANK_A; b++) {
        tryAssign([
          { jokerId: jokers[0]!.id, rank: a as Rank },
          { jokerId: jokers[1]!.id, rank: b as Rank },
        ]);
      }
    }
  }

  return [...found.values()];
}

/**
 * 这一组牌在**当前语境下**有没有歧义：存在多于一种牌型标识的合法解释。
 *
 * `current` 为 `null` 表示领出（全部合法解释都算）；给了桌面牌就表示跟牌
 * （只算压得住它的那些解释）。**领出与跟牌一视同仁**，这是 owner 2026-07-22 拍板的
 * 唯一一条规则——原先「歧义只发生在领出」的设想已被证伪，见 ADR-0002 修订一节。
 */
export function isAmbiguous(cards: readonly Card[], current: Combo | null = null): boolean {
  return enumerateIdentities(cards, current).length > 1;
}

/** 这一手是不是「2」（单张 2 或对 2）——两个逃生口的判据。 */
export function isTwo(combo: Combo): boolean {
  return (combo.type === 'single' || combo.type === 'pair') && combo.key === POWER_TWO;
}

/** 炸弹类（含王炸）。 */
export function isBomb(combo: Combo): boolean {
  return combo.type === 'bomb' || combo.type === 'jokerBomb';
}

/**
 * `next` 能不能压住 `prev`。
 *
 * 判定顺序就是规则的优先级，从最硬的往下走：
 *   1. 王炸压一切，且没有东西压得住它
 *   2. 炸弹压任意非炸牌型；炸弹之间**先比张数、同张数比点数且「大就行」**（不受大一约束）
 *   3. 普通牌型之间：先看逃生口（单张 2 压任意单张、对 2 压任意对子），
 *      再走大一法则——同牌型、同张数、关键点数正好大一级
 *
 * 注意大一那条链**只在 3..A 之间**：2 的权重虽然是 15，但它不是「A+1」，
 * 它出手靠的是自己的特权。顺子与连对没有特权，所以顶格顺子 `QKA` 之上
 * 真的接不了任何普通顺子（2 不入顺，A 已封顶），只能炸。
 */
export function beats(prev: Combo, next: Combo): boolean {
  // 1. 王炸
  if (next.type === 'jokerBomb') return prev.type !== 'jokerBomb';
  if (prev.type === 'jokerBomb') return false;

  // 2. 炸弹
  if (next.type === 'bomb') {
    if (prev.type !== 'bomb') return true;                            // 炸弹压任意非炸
    if (next.length !== prev.length) return next.length > prev.length; // 先比张数
    return next.key > prev.key;                                        // 同张数比点数，大就行
  }
  if (prev.type === 'bomb') return false;                              // 普通牌压不住炸弹

  // 3. 普通牌型
  if (next.type !== prev.type || next.length !== prev.length) return false;
  if (isTwo(next) && !isTwo(prev)) return true;                        // 逃生口：2 的特权
  return next.key === prev.key + 1 && next.key <= RANK_A;              // 大一法则，链条封顶在 A
}
