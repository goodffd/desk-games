/**
 * LocalDriver 纯逻辑单测（Plan 2 Task 2）。
 *
 * 验 LocalDriver 在不碰 DOM 的前提下完整承载「本地引擎 + AI 调度 + 进贡」：
 *  - 注入即时 schedule（同步跑完 AI）、确定性 shuffle、speechBusyMs=0、firstLeader，
 *    使整盘推进可重复、可断言。
 *  - 不依赖 DOM：本文件在默认 node 环境跑，driver 绝不 import 浏览器 API。
 *
 * 覆盖计划 Task 2 的 5 条断言：发牌/AI 自动推进、人类出牌(合法/非法)+onChange、
 * onSpeak 报牌、一局打完 onResult 一次、进贡 onTribute + resolve 开新局。
 */

import { describe, it, expect } from 'vitest';
import type { Card, Seat } from '../src/games/guandan/engine/types';
import { rankValue } from '../src/games/guandan/engine/cards';
import { isDealOver } from '../src/games/guandan/engine/game';
import { autoReturn, returnableCards } from '../src/games/guandan/engine/match';
import { LocalDriver } from '../src/games/guandan/driver/local-driver';
import type { GameSnapshot, TributePrompt } from '../src/games/guandan/driver/types';

/** 即时调度：同步执行（单测里让 AI 一口气推进到底，无定时器）。 */
const immediate = (fn: () => void): number => { fn(); return 0; };

/**
 * 确定性 shuffle，并保证「非抗贡」：把两张大王(deck id 105/107)分到 seat0/seat1。
 * 单贡只看末游一人手牌、双贡看三游+末游(=另一整队 {0,2} 或 {1,3})合计——
 * 两张大王分属不同队的两个座位(0 与 1)，任一末游单座或任一整队都至多持 1 张大王 → resist 必为 false。
 */
function splitJokerShuffle(n: number): number[] {
  const perm = Array.from({ length: n }, (_, i) => i);
  if (n === 108) {
    [perm[0], perm[105]] = [perm[105]!, perm[0]!]; // 大王105 → 位0 → seat0
    [perm[1], perm[107]] = [perm[107]!, perm[1]!]; // 大王107 → 位1 → seat1
  }
  return perm;
}

interface DriverProbe {
  driver: LocalDriver;
  changes: number;
  speaks: string[];
  results: number;
  lastSettleWinTeam: () => number | null;
  tributes: TributePrompt[];
  hints: string[];
}

function makeDriver(opts: { firstLeader?: Seat; schedule?: (fn: () => void, ms: number) => number } = {}): DriverProbe {
  const driver = new LocalDriver({
    shuffle: splitJokerShuffle,
    schedule: opts.schedule ?? immediate,
    clearScheduled: () => {},
    speechBusyMs: () => 0,
    firstLeader: () => opts.firstLeader ?? 1,
  });
  const probe: DriverProbe = {
    driver,
    changes: 0,
    speaks: [],
    results: 0,
    lastSettleWinTeam: () => lastWin,
    tributes: [],
    hints: [],
  };
  let lastWin: number | null = null;
  driver.onChange(() => { probe.changes++; });
  driver.onSpeak((t) => { probe.speaks.push(t); });
  driver.onResult((settle) => { probe.results++; lastWin = settle.winTeam; });
  driver.onTribute((p) => { probe.tributes.push(p); });
  driver.onHint((t) => { probe.hints.push(t); });
  return probe;
}

const snap = (p: DriverProbe): GameSnapshot => p.driver.snapshot();

/** 驱整盘到一局结束：人类座超时托管自动出，AI 由即时 schedule 同步推进。 */
function playDealToEnd(p: DriverProbe): void {
  p.driver.start();
  for (let i = 0; i < 600 && !isDealOver(snap(p).state); i++) {
    if (snap(p).state.turn === 0) p.driver.timeoutSeat(0);
    else break; // 即时 schedule 下 AI 应已自动推进到人类回合或结束；卡住则下面断言会失败
  }
}

describe('LocalDriver — 发牌与开局', () => {
  it('构造即发 4×27 张、未开始；start 后 started=true', () => {
    const p = makeDriver({ schedule: () => 0 }); // schedule 不执行：AI 不推进，便于看初始发牌
    const s0 = snap(p);
    expect(s0.started).toBe(false);
    expect(s0.state.hands.map((h) => h.length)).toEqual([27, 27, 27, 27]);
    expect(s0.state.hands.flat()).toHaveLength(108);

    p.driver.start();
    expect(snap(p).started).toBe(true);
    expect(p.changes).toBeGreaterThanOrEqual(1); // start 触发一次 onChange
  });

  it('start 后非我回合 → AI 自动推进（即时 schedule）', () => {
    const p = makeDriver({ firstLeader: 1 }); // 首攻 seat1(AI)
    p.driver.start();
    const s = snap(p);
    // AI 同步推进到人类回合(或本局已结束)；至少有一家 AI 出过牌
    expect(s.lastActor).not.toBeNull();
    expect(s.state.turn === 0 || isDealOver(s.state)).toBe(true);
    expect(s.state.hands.flat().length).toBeLessThan(108); // 领出方必出过牌
  });
});

describe('LocalDriver — 人类出牌', () => {
  it('合法单张：受理、turn 前移、该座 lastPlays 有值、onChange 触发', () => {
    // schedule 不执行：隔离 AI，单看人类出牌的即时效果（否则即时 schedule 下 AI 同步转回 seat0）
    const p = makeDriver({ firstLeader: 0, schedule: () => 0 });
    p.driver.start();
    const before = snap(p);
    expect(before.state.turn).toBe(0);
    const beforeChanges = p.changes;

    // 取手牌里最小一张单出（单张领出恒合法）
    const hand = [...before.state.hands[0]!].sort((a, b) => rankValue(a, before.state.level) - rankValue(b, before.state.level));
    const single = hand[0]!;
    const ok = p.driver.play([single]);

    expect(ok).toBe(true);
    const after = snap(p);
    expect(after.state.turn).not.toBe(0);              // 轮转走了
    expect(after.lastPlays[0]).not.toBeNull();          // seat0 桌面有牌
    expect(after.lastPlays[0]).not.toBe('pass');
    expect(after.state.hands[0]!.some((c) => c.id === single.id)).toBe(false); // 已出
    expect(p.changes).toBeGreaterThan(beforeChanges);   // onChange 触发
  });

  it('非法出牌：返回 false、状态不变、不触发 onChange', () => {
    const p = makeDriver({ firstLeader: 0, schedule: () => 0 }); // 不让 AI 推进，便于对比状态
    p.driver.start();
    const before = snap(p);
    const beforeChanges = p.changes;

    // 选两张点数不同的牌作「领出」——2 张只能是对子(同点)，点数不同必非法
    const hand = before.state.hands[0]!;
    const a = hand[0]!;
    const b = hand.find((c) => rankValue(c, before.state.level) !== rankValue(a, before.state.level))!;
    const ok = p.driver.play([a, b]);

    expect(ok).toBe(false);
    const after = snap(p);
    expect(after.state.turn).toBe(0);                       // turn 未动
    expect(after.state.hands[0]!.length).toBe(before.state.hands[0]!.length); // 手牌未减
    expect(after.lastPlays[0]).toBeNull();
    expect(p.changes).toBe(beforeChanges);                  // 无 onChange
  });

  it('领出(current=null)不能不要：pass 返回 false', () => {
    const p = makeDriver({ firstLeader: 0, schedule: () => 0 });
    p.driver.start();
    expect(snap(p).state.current).toBeNull();
    expect(p.driver.pass()).toBe(false);
  });
});

describe('LocalDriver — 语音/结算/进贡', () => {
  it('出牌/不要全程触发 onSpeak（报牌文案非空）', () => {
    const p = makeDriver({ firstLeader: 1 });
    playDealToEnd(p);
    expect(p.speaks.length).toBeGreaterThan(0);
    expect(p.speaks.every((s) => typeof s === 'string' && s.length > 0)).toBe(true);
    expect(p.speaks).toContain('不要'); // 一整局必有人不要
  });

  it('一局打完 → onResult 触发一次、winTeam 有效', () => {
    const p = makeDriver({ firstLeader: 1 });
    playDealToEnd(p);
    expect(isDealOver(snap(p).state)).toBe(true);
    expect(p.results).toBe(1);
    expect([0, 1]).toContain(p.lastSettleWinTeam());
  });

  it('nextDealOrResult：非抗贡 → onTribute(exchanges 非空)；resolve → onChange + 新局', () => {
    const p = makeDriver({ firstLeader: 1 });
    playDealToEnd(p);
    expect(isDealOver(snap(p).state)).toBe(true);

    const changesBefore = p.changes;
    p.driver.nextDealOrResult();

    expect(p.tributes).toHaveLength(1);          // 进贡阶段(splitJokerShuffle 保证非抗贡)
    const prompt = p.tributes[0]!;
    expect(prompt.plan.resist).toBe(false);
    expect(prompt.plan.exchanges.length).toBeGreaterThan(0);

    // 用 autoReturn 兜底每个收贡侧还贡，确定开新局
    const returns: Card[] = prompt.plan.exchanges.map((ex) => autoReturn(prompt.dealt[ex.receiver]!, prompt.level));
    prompt.resolve(returns);

    expect(p.changes).toBeGreaterThan(changesBefore);     // resolve 触发 onChange
    const fresh = snap(p);
    expect(isDealOver(fresh.state)).toBe(false);          // 新局开始
    expect(fresh.state.hands.flat().length).toBe(108);    // 重新发满
    expect(fresh.lastActor).toBeNull();                   // 新局桌面清空
  });

  // 收贡手选路径的逻辑闸：真机冒烟里 AI 太强、自动人类难赢→收贡 UI 难触发，
  // 故这里确定性验「resolve 用调用方指定(非 autoReturn)的还贡牌」确实流转——
  // showTribute 的手选 DOM 本次重构未改，关键就是这张人选牌能否经 resolve 进 giver 手牌。
  it('resolve 用调用方指定(非 autoReturn)的还贡牌 → 该牌确进 giver 新手牌、进贡牌离开 giver', () => {
    const p = makeDriver({ firstLeader: 1 });
    playDealToEnd(p);
    p.driver.nextDealOrResult();
    const prompt = p.tributes[0]!;
    const ex = prompt.plan.exchanges[0]!;

    // 收贡方可还的 ≤10 牌里挑「最大」一张（autoReturn 取最小，故必不同）模拟人类手选
    const pool = returnableCards(prompt.dealt[ex.receiver]!, prompt.level);
    expect(pool.length).toBeGreaterThan(0);
    const chosen = pool.reduce((a, b) => (rankValue(b, prompt.level) > rankValue(a, prompt.level) ? b : a));
    const auto = autoReturn(prompt.dealt[ex.receiver]!, prompt.level);
    expect(chosen.id).not.toBe(auto.id); // 确与 autoReturn 不同，才真验「用了人选牌」

    const returns: Card[] = prompt.plan.exchanges.map((e, i) =>
      i === 0 ? chosen : autoReturn(prompt.dealt[e.receiver]!, prompt.level));
    prompt.resolve(returns);

    const hands = p.driver.snapshot().state.hands;
    expect(hands[ex.giver]!.some((c) => c.id === chosen.id)).toBe(true);      // 人选还贡牌进了 giver
    expect(hands[ex.giver]!.some((c) => c.id === ex.tribute.id)).toBe(false); // 进贡牌已离开 giver
    expect(hands[ex.receiver]!.some((c) => c.id === ex.tribute.id)).toBe(true); // 进贡牌到了 receiver
  });
});
