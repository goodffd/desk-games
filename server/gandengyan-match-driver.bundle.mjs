// src/games/gandengyan/engine/types.ts
var MAX_BOMB_SIZE = 4;
var RANK_A = 14;
var POWER_TWO = 15;
function power(rank) {
  return rank === 2 ? POWER_TWO : rank;
}

// src/games/gandengyan/engine/cards.ts
var SUITS = ["S", "H", "D", "C"];
var RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
var MIN_SEATS = 2;
var MAX_SEATS = 5;
var DEALER_CARDS = 6;
var OTHER_CARDS = 5;
function makeDeck() {
  const deck = [];
  let id = 0;
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ kind: "normal", suit, rank, id: id++ });
  }
  deck.push({ kind: "joker", big: false, id: id++ });
  deck.push({ kind: "joker", big: true, id: id++ });
  return deck;
}
function dealHands(deck, seatCount, dealer, shuffle) {
  if (!Number.isInteger(seatCount) || seatCount < MIN_SEATS || seatCount > MAX_SEATS) {
    throw new Error(`\u4EBA\u6570\u53EA\u80FD\u662F ${MIN_SEATS}~${MAX_SEATS}\uFF0C\u6536\u5230 ${seatCount}`);
  }
  if (!Number.isInteger(dealer) || dealer < 0 || dealer >= seatCount) {
    throw new Error(`\u5E84\u7684\u5EA7\u4F4D\u53F7\u8D8A\u754C\uFF1A${dealer}\uFF08\u672C\u5C40 ${seatCount} \u4EBA\uFF09`);
  }
  const perm = shuffle(deck.length);
  const shuffled = perm.map((i) => deck[i]);
  const hands = Array.from({ length: seatCount }, () => []);
  let cursor = 0;
  for (let seat = 0; seat < seatCount; seat++) {
    const want = seat === dealer ? DEALER_CARDS : OTHER_CARDS;
    hands[seat] = shuffled.slice(cursor, cursor + want);
    cursor += want;
  }
  return { hands, deck: shuffled.slice(cursor) };
}
function sortValue(c) {
  if (c.kind === "joker") return c.big ? 17 : 16;
  return power(c.rank);
}
function sortHand(cards) {
  return [...cards].sort((a, b) => sortValue(a) - sortValue(b));
}

// src/games/gandengyan/engine/combos.ts
var MIN_WILD_RANK = 3;
function effectiveRanks(cards, assign) {
  const jokerIds = new Set(cards.filter((c) => c.kind === "joker").map((c) => c.id));
  if (assign.length !== jokerIds.size) return null;
  const byId = /* @__PURE__ */ new Map();
  for (const a of assign) {
    if (!jokerIds.has(a.jokerId)) return null;
    if (byId.has(a.jokerId)) return null;
    if (!Number.isInteger(a.rank) || a.rank < MIN_WILD_RANK || a.rank > RANK_A) return null;
    byId.set(a.jokerId, a.rank);
  }
  const rs = [];
  for (const c of cards) rs.push(c.kind === "joker" ? byId.get(c.id) : c.rank);
  return rs.sort((a, b) => a - b);
}
function isConsecutive(ranks) {
  if (ranks.some((r) => r === 2)) return false;
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] !== ranks[i - 1] + 1) return false;
  }
  return true;
}
function identifyJokerBomb(cards) {
  if (cards.length !== 2) return null;
  const jokers = cards.filter((c) => c.kind === "joker");
  if (jokers.length !== 2) return null;
  const big = jokers.filter((c) => c.kind === "joker" && c.big).length;
  if (big !== 1) return null;
  return { type: "jokerBomb", cards: [...cards], length: 2, key: 0 };
}
function identify(cards, assign = []) {
  if (cards.length === 0) return null;
  const jokerCount = cards.reduce((n, c) => n + (c.kind === "joker" ? 1 : 0), 0);
  if (cards.length === 1 && jokerCount === 1) return null;
  if (jokerCount === 2 && assign.length === 0) return identifyJokerBomb(cards);
  const ranks = effectiveRanks(cards, assign);
  if (!ranks) return null;
  const cs = [...cards];
  if (ranks.length === 1) {
    return { type: "single", cards: cs, length: 1, key: power(ranks[0]) };
  }
  if (ranks.length === 2 && ranks[0] === ranks[1]) {
    return { type: "pair", cards: cs, length: 2, key: power(ranks[0]) };
  }
  const allSame = ranks.every((r) => r === ranks[0]);
  if (allSame && ranks.length >= 3) {
    if (ranks.length > MAX_BOMB_SIZE) return null;
    return { type: "bomb", cards: cs, length: ranks.length, key: power(ranks[0]) };
  }
  if (ranks.length >= 3 && isConsecutive(ranks)) {
    return { type: "run", cards: cs, length: ranks.length, key: ranks[ranks.length - 1] };
  }
  if (ranks.length >= 4 && ranks.length % 2 === 0) {
    const tops = [];
    for (let i = 0; i < ranks.length; i += 2) {
      if (ranks[i] !== ranks[i + 1]) {
        tops.length = 0;
        break;
      }
      tops.push(ranks[i]);
    }
    if (tops.length >= 2 && isConsecutive(tops)) {
      return { type: "pairRun", cards: cs, length: ranks.length, key: tops[tops.length - 1] };
    }
  }
  return null;
}
function comboIdentity(c) {
  return `${c.type}|${c.length}|${c.key}`;
}
function isTwo(combo) {
  return (combo.type === "single" || combo.type === "pair") && combo.key === POWER_TWO;
}
function isBomb(combo) {
  return combo.type === "bomb" || combo.type === "jokerBomb";
}
function beats(prev, next) {
  if (next.type === "jokerBomb") return prev.type !== "jokerBomb";
  if (prev.type === "jokerBomb") return false;
  if (next.type === "bomb") {
    if (prev.type !== "bomb") return true;
    if (next.length !== prev.length) return next.length > prev.length;
    return next.key > prev.key;
  }
  if (prev.type === "bomb") return false;
  if (next.type !== prev.type || next.length !== prev.length) return false;
  if (isTwo(next) && !isTwo(prev)) return true;
  return next.key === prev.key + 1 && next.key <= RANK_A;
}

// src/games/gandengyan/engine/legal.ts
function indexHand(hand) {
  const byRank = /* @__PURE__ */ new Map();
  const jokers = [];
  for (const c of hand) {
    if (c.kind === "joker") {
      jokers.push(c);
      continue;
    }
    const bucket = byRank.get(c.rank);
    if (bucket) bucket.push(c);
    else byRank.set(c.rank, [c]);
  }
  return { byRank, jokers };
}
function fills(need, idx) {
  const out = [];
  const walk = (i, jokersUsed, cards, assign) => {
    if (i === need.length) {
      out.push({ cards, assign });
      return;
    }
    const [rank, count] = need[i];
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
        [...assign, ...picked.map((jk) => ({ jokerId: jk.id, rank }))]
      );
    }
  };
  walk(0, 0, [], []);
  return out;
}
function candidateRanks() {
  return [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
}
function enumerateLeads(hand) {
  const idx = indexHand(hand);
  const found = /* @__PURE__ */ new Map();
  const consider = (cards, assign) => {
    const combo = identify(cards, assign);
    if (!combo) return;
    const key = `${[...cards].map((c) => c.id).sort((a, b) => a - b).join(",")}#${comboIdentity(combo)}`;
    if (!found.has(key)) found.set(key, { cards, assign, combo });
  };
  const emit = (need) => {
    for (const f of fills(need, idx)) consider(f.cards, f.assign);
  };
  for (const r of candidateRanks()) {
    emit([[r, 1]]);
    emit([[r, 2]]);
    for (let size = 3; size <= MAX_BOMB_SIZE; size++) emit([[r, size]]);
  }
  for (let len = 3; len <= RANK_A - 3 + 1; len++) {
    for (let s = 3; s + len - 1 <= RANK_A; s++) {
      emit(Array.from({ length: len }, (_, k) => [s + k, 1]));
    }
  }
  for (let pairs = 2; pairs <= RANK_A - 3 + 1; pairs++) {
    for (let s = 3; s + pairs - 1 <= RANK_A; s++) {
      emit(Array.from({ length: pairs }, (_, k) => [s + k, 2]));
    }
  }
  if (idx.jokers.length === 2) consider([...idx.jokers], []);
  return [...found.values()];
}
function enumerateFollows(hand, current) {
  return enumerateLeads(hand).filter((p) => beats(current, p.combo));
}
function hasAnyPlay(hand, current) {
  return current === null ? enumerateLeads(hand).length > 0 : enumerateFollows(hand, current).length > 0;
}
function isLegalPlay(hand, cards, assign, current) {
  const handIds = new Set(hand.map((c) => c.id));
  const playIds = new Set(cards.map((c) => c.id));
  if (playIds.size !== cards.length) return false;
  for (const c of cards) if (!handIds.has(c.id)) return false;
  const combo = identify(cards, assign);
  if (!combo) return false;
  return current === null || beats(current, combo);
}

// src/games/gandengyan/engine/game.ts
function createDeal(init) {
  const seatCount = init.hands.length;
  if (seatCount < MIN_SEATS || seatCount > MAX_SEATS) {
    throw new Error(`\u4EBA\u6570\u53EA\u80FD\u662F ${MIN_SEATS}~${MAX_SEATS}\uFF0C\u6536\u5230 ${seatCount}`);
  }
  if (!Number.isInteger(init.dealer) || init.dealer < 0 || init.dealer >= seatCount) {
    throw new Error(`\u5E84\u7684\u5EA7\u4F4D\u53F7\u8D8A\u754C\uFF1A${init.dealer}\uFF08\u672C\u5C40 ${seatCount} \u4EBA\uFF09`);
  }
  return {
    seatCount,
    hands: init.hands.map((h) => [...h]),
    deck: [...init.deck],
    played: [],
    current: null,
    turn: init.dealer,
    passesInRow: 0,
    leadPassesInRow: 0,
    stalemate: false,
    bombsPlayed: 0,
    hasPlayed: Array.from({ length: seatCount }, () => false),
    winner: null
  };
}
function isDealOver(s) {
  return s.winner !== null || s.stalemate;
}
function nextSeat(s, seat) {
  return (seat + 1) % s.seatCount;
}
function whyCannotBeat(prev, next) {
  if (prev.type === "jokerBomb") return "\u684C\u9762\u662F\u738B\u70B8\uFF0C\u538B\u4E00\u5207\uFF0C\u6CA1\u6709\u4E1C\u897F\u538B\u5F97\u4F4F\u5B83";
  if (prev.type === "bomb") {
    return next.type === "bomb" ? `\u684C\u9762\u662F ${prev.length} \u5F20\u70B8(\u70B9\u6570 ${prev.key})\uFF0C\u8981\u538B\u5B83\u5F97\u5F20\u6570\u66F4\u591A\uFF0C\u6216\u540C\u5F20\u6570\u800C\u70B9\u6570\u66F4\u5927` : `\u684C\u9762\u662F ${prev.length} \u5F20\u70B8\uFF0C\u53EA\u6709\u66F4\u5927\u7684\u70B8\u5F39\u6216\u738B\u70B8\u538B\u5F97\u4F4F`;
  }
  if (isBomb(next)) return "\u5185\u90E8\u9519\u8BEF\uFF1A\u70B8\u5F39\u672C\u5E94\u538B\u5F97\u4F4F\u4EFB\u610F\u975E\u70B8\u724C\u578B";
  if (next.type !== prev.type || next.length !== prev.length) {
    return `\u684C\u9762\u662F ${prev.type}(${prev.length} \u5F20)\uFF0C\u8DDF\u724C\u5FC5\u987B\u540C\u724C\u578B\u3001\u540C\u5F20\u6570`;
  }
  return `\u684C\u9762\u662F ${prev.type}(\u5173\u952E\u70B9\u6570 ${prev.key})\uFF0C\u8DDF\u724C\u7684\u5173\u952E\u70B9\u6570\u987B\u6B63\u597D\u5927\u4E00\u7EA7\uFF082 \u4E0E\u70B8\u5F39\u53E6\u6709\u7279\u6743\uFF0C\u4E0D\u8D70\u8FD9\u6761\u94FE\uFF09`;
}
function fewestCardsWinner(s) {
  let best = Infinity;
  let winner = null;
  let tied = false;
  for (let seat = 0; seat < s.seatCount; seat++) {
    const n = s.hands[seat].length;
    if (n < best) {
      best = n;
      winner = seat;
      tied = false;
    } else if (n === best) tied = true;
  }
  return tied ? null : winner;
}
function assertActionable(s, seat) {
  if (isDealOver(s)) throw new Error("\u672C\u5C40\u5DF2\u7ED3\u675F\uFF0C\u4E0D\u80FD\u518D\u51FA\u724C\u6216\u8FC7\u724C");
  if (seat !== s.turn) throw new Error(`\u8FD8\u6CA1\u8F6E\u5230\u5EA7 ${seat}\uFF0C\u5F53\u524D\u662F\u5EA7 ${s.turn} \u7684\u56DE\u5408`);
}
function play(s, seat, cards, assign = []) {
  assertActionable(s, seat);
  const hand = s.hands[seat];
  const handIds = new Set(hand.map((c) => c.id));
  const playIds = new Set(cards.map((c) => c.id));
  if (playIds.size !== cards.length) throw new Error("\u540C\u4E00\u5F20\u724C\u4E0D\u80FD\u51FA\u4E24\u6B21");
  for (const c of cards) {
    if (!handIds.has(c.id)) throw new Error(`\u5EA7 ${seat} \u624B\u91CC\u6CA1\u6709\u8FD9\u5F20\u724C\uFF08id=${c.id}\uFF09`);
  }
  const combo = identify(cards, assign);
  if (!combo) {
    const jokers = cards.filter((c) => c.kind === "joker").length;
    throw new Error(
      jokers === 0 ? "\u8FD9\u624B\u724C\u4E0D\u5408\u6CD5\uFF1A\u8BA4\u4E0D\u51FA\u724C\u578B" : cards.length === 1 ? "\u8FD9\u624B\u724C\u4E0D\u5408\u6CD5\uFF1A\u738B\u4E0D\u80FD\u5355\u72EC\u6253\u51FA" : assign.length !== jokers ? `\u8FD9\u624B\u724C\u4E0D\u5408\u6CD5\uFF1A${jokers} \u5F20\u738B\u8981 ${jokers} \u6761\u6307\u6D3E\uFF0C\u6536\u5230 ${assign.length} \u6761` : "\u8FD9\u624B\u724C\u4E0D\u5408\u6CD5\uFF1A\u6309\u4F60\u7ED9\u7684\u6307\u6D3E\u8BA4\u4E0D\u51FA\u724C\u578B\uFF08\u738B\u4E0D\u80FD\u66FF 2\uFF1B\u6307\u6D3E\u987B\u6307\u5411\u672C\u6B21\u6253\u51FA\u7684\u738B\uFF09"
    );
  }
  if (s.current && !beats(s.current.combo, combo)) {
    throw new Error(`\u538B\u4E0D\u4F4F\uFF1A${whyCannotBeat(s.current.combo, combo)}`);
  }
  const rest = hand.filter((c) => !playIds.has(c.id));
  const hands = s.hands.map((h, i) => i === seat ? rest : h);
  const bombsPlayed = s.bombsPlayed + (isBomb(combo) ? 1 : 0);
  const hasPlayed = s.hasPlayed.map((p, i) => i === seat ? true : p);
  if (rest.length === 0) {
    return {
      ...s,
      hands,
      played: [...s.played, ...cards],
      bombsPlayed,
      hasPlayed,
      current: { combo, by: seat },
      passesInRow: 0,
      leadPassesInRow: 0,
      winner: seat
    };
  }
  return {
    ...s,
    hands,
    played: [...s.played, ...cards],
    bombsPlayed,
    hasPlayed,
    current: { combo, by: seat },
    passesInRow: 0,
    leadPassesInRow: 0,
    // 有人出牌 → 顺延计数清零，不会攒到误判僵局
    turn: nextSeat(s, seat)
  };
}
function pass(s, seat) {
  assertActionable(s, seat);
  if (s.current === null) {
    if (hasAnyPlay(s.hands[seat], null)) {
      throw new Error("\u8F6E\u5230\u4F60\u9886\u51FA\uFF0C\u684C\u9762\u4E3A\u7A7A\u65F6\u5FC5\u987B\u51FA\u724C\uFF0C\u4E0D\u80FD\u8FC7");
    }
    const leadPassesInRow = s.leadPassesInRow + 1;
    if (leadPassesInRow >= s.seatCount) {
      return { ...s, leadPassesInRow, stalemate: true, winner: fewestCardsWinner(s) };
    }
    return { ...s, leadPassesInRow, turn: nextSeat(s, seat) };
  }
  const passesInRow = s.passesInRow + 1;
  if (passesInRow >= s.seatCount - 1) {
    const roundWinner = s.current.by;
    const drawn = s.deck.length > 0 ? s.deck[0] : null;
    return {
      ...s,
      hands: drawn ? s.hands.map((h, i) => i === roundWinner ? [...h, drawn] : h) : s.hands,
      deck: drawn ? s.deck.slice(1) : s.deck,
      current: null,
      turn: roundWinner,
      passesInRow: 0
    };
  }
  return { ...s, passesInRow, turn: nextSeat(s, seat) };
}
function settle(s, base) {
  if (!isDealOver(s)) throw new Error("\u672C\u5C40\u672A\u7ED3\u675F\uFF0C\u4E0D\u80FD\u7ED3\u7B97");
  if (s.winner === null) {
    return { winner: null, pay: s.hands.map(() => 0), gain: 0 };
  }
  const winner = s.winner;
  const bombMultiplier = 2 ** s.bombsPlayed;
  const pay = s.hands.map((hand, seat) => {
    if (seat === winner) return 0;
    let personal = 1;
    for (const c of hand) {
      if (c.kind === "joker" || c.rank === 2) personal *= 2;
    }
    if (!s.hasPlayed[seat]) personal *= 2;
    return base * hand.length * bombMultiplier * personal;
  });
  return { winner, pay, gain: pay.reduce((a, b) => a + b, 0) };
}

// server/gandengyan-match-driver.ts
var err = (seat, msg) => ({ to: "seat", seat, msg: { t: "error", msg } });
var defaultShuffle = (n) => Array.from({ length: n }, (_, i) => i);
function sanitizeAssign(raw) {
  if (raw === void 0 || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") return null;
    const { jokerId, rank } = a;
    if (typeof jokerId !== "number" || !Number.isFinite(jokerId)) return null;
    if (typeof rank !== "number" || !Number.isFinite(rank)) return null;
    out.push({ jokerId, rank });
  }
  return out;
}
var GandengyanDriver = class {
  constructor(opts = {}) {
    this.lastActor = null;
    this.phase = "playing";
    /** 单调递增的行棋数：房间层据它区分「真出了一手」与「纯重广播」，避免观众进场刷新真人倒计时。 */
    this.ply = 0;
    /** 当前桌面牌的指派（公开态要带上，重连的人才知道那张王算几点）。 */
    this.currentAssign = [];
    this.seatCount = opts.seatCount ?? 5;
    this.shuffle = opts.shuffle ?? defaultShuffle;
    this.base = opts.base ?? 1;
    this.online = Array.from({ length: this.seatCount }, () => true);
    this.lastPlays = Array.from({ length: this.seatCount }, () => null);
    const dealer = opts.dealer ?? 0;
    const dealt = dealHands(makeDeck(), this.seatCount, dealer, this.shuffle);
    this.state = createDeal({ hands: dealt.hands, deck: dealt.deck, dealer });
  }
  start() {
    return [this.broadcastState(), ...this.handMsgs()];
  }
  /**
   * 公开态。**这里面绝不能出现牌堆内容**——只报还剩几张。
   * 桌面当前牌连同它的指派一起下发。
   */
  publicState() {
    const s = this.state;
    const base = {
      phase: this.phase,
      turn: s.turn,
      current: s.current ? {
        type: s.current.combo.type,
        length: s.current.combo.length,
        key: s.current.combo.key,
        cards: s.current.combo.cards,
        assign: this.currentAssign,
        by: s.current.by
      } : null,
      lastActor: this.lastActor,
      deckCount: s.deck.length,
      // 只报张数，不报是哪些牌
      seats: Array.from({ length: this.seatCount }, (_, i) => ({
        seat: i,
        count: s.hands[i].length,
        lastPlay: this.lastPlays[i] ?? null,
        online: this.online[i],
        ai: !this.online[i]
      }))
    };
    if (this.phase === "dealResult") {
      const r = settle(s, this.base);
      base["result"] = {
        winner: r.winner,
        pay: r.pay,
        gain: r.gain,
        stalemate: s.stalemate,
        hands: s.hands.map((h) => h.length)
      };
    }
    return base;
  }
  broadcastState() {
    return { to: "all", msg: { t: "state", ...this.publicState() } };
  }
  /** 私发各座手牌——**只发给本人**。 */
  handMsgs() {
    return Array.from({ length: this.seatCount }, (_, i) => ({
      to: "seat",
      seat: i,
      msg: { t: "hand", cards: sortHand(this.state.hands[i]) }
    }));
  }
  syncSeat(seat) {
    return [
      { to: "seat", seat, msg: { t: "state", ...this.publicState() } },
      { to: "seat", seat, msg: { t: "hand", cards: sortHand(this.state.hands[seat]) } }
    ];
  }
  /** 观众只补公开态，绝不给手牌。 */
  spectatorSync(_client) {
    return [{ to: "all", msg: { t: "state", ...this.publicState() } }];
  }
  handlePlay(seat, cardIds, rawAssign) {
    if (this.phase !== "playing") return [err(seat, "\u672C\u5C40\u5DF2\u7ED3\u675F")];
    if (this.state.turn !== seat) return [err(seat, "\u8FD8\u6CA1\u8F6E\u5230\u4F60")];
    const ids = Array.isArray(cardIds) ? cardIds : null;
    if (!ids) return [err(seat, "\u51FA\u724C\u683C\u5F0F\u4E0D\u5BF9")];
    const cards = this.cardsByIds(seat, ids);
    if (!cards) return [err(seat, "\u724C\u4E0D\u5728\u4F60\u624B\u91CC")];
    const assign = sanitizeAssign(rawAssign);
    if (!assign) return [err(seat, "\u738B\u7684\u6307\u6D3E\u683C\u5F0F\u4E0D\u5BF9")];
    if (!isLegalPlay(this.state.hands[seat], cards, assign, this.state.current?.combo ?? null)) {
      return [err(seat, "\u8FD9\u624B\u724C\u51FA\u4E0D\u4E86")];
    }
    this.applyPlay(seat, cards, assign);
    return this.afterAction();
  }
  handlePass(seat) {
    if (this.phase !== "playing") return [err(seat, "\u672C\u5C40\u5DF2\u7ED3\u675F")];
    if (this.state.turn !== seat) return [err(seat, "\u8FD8\u6CA1\u8F6E\u5230\u4F60")];
    try {
      this.state = pass(this.state, seat);
    } catch (e) {
      return [err(seat, e.message)];
    }
    this.lastPlays[seat] = "pass";
    this.lastActor = seat;
    this.ply++;
    return this.afterAction();
  }
  /** 回合超时托管 / AI 座代打：挑一手合法的出；实在没得出就过。
   *  本期用「枚举里的第一手」这种确定性挑法，真正的启发式 AI 是 #14 的事。 */
  forceAutoPlay() {
    if (this.phase !== "playing") return [];
    const seat = this.state.turn;
    const hand = this.state.hands[seat];
    const cur = this.state.current?.combo ?? null;
    const options = cur === null ? enumerateLeads(hand) : enumerateFollows(hand, cur);
    if (options.length === 0) return this.handlePass(seat);
    const p = options[0];
    this.applyPlay(seat, p.cards, p.assign);
    return this.afterAction();
  }
  setAI(seat, on) {
    this.online[seat] = !on;
    return [this.broadcastState()];
  }
  /** 玩一手 AI：轮到的是 AI 座才动，否则返回空（房间层据此逐手带延迟驱动）。 */
  stepAI() {
    if (this.phase !== "playing") return [];
    if (this.online[this.state.turn]) return [];
    return this.forceAutoPlay();
  }
  // ── 内部 ──────────────────────────────────────────────────────────────
  applyPlay(seat, cards, assign) {
    const wasLead = this.state.current === null;
    this.state = play(this.state, seat, cards, assign);
    if (wasLead) this.lastPlays = this.lastPlays.map(() => null);
    this.lastPlays[seat] = { cards, assign };
    this.currentAssign = assign;
    this.lastActor = seat;
    this.ply++;
  }
  afterAction() {
    if (isDealOver(this.state)) this.phase = "dealResult";
    return [this.broadcastState(), ...this.handMsgs()];
  }
  /** 按 id 从该座手牌里取牌；有一张不在自己手上就整手作废（防拿别人的牌 / 不存在的 id / 重复 id）。 */
  cardsByIds(seat, ids) {
    const hand = this.state.hands[seat];
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const id of ids) {
      if (typeof id !== "number" || seen.has(id)) return null;
      seen.add(id);
      const c = hand.find((x) => x.id === id);
      if (!c) return null;
      out.push(c);
    }
    return out.length ? out : null;
  }
};
export {
  GandengyanDriver
};
