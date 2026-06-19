/**
 * render.ts — DOM 渲染工具函数（无状态，纯 DOM）
 *
 * 提供：
 * - cardEl(card, level, small?) → HTMLElement
 * - cardLabel(card, level) → { rank: string; suit: string; colorClass: string }
 * - comboTypeLabel(type) → string（中文牌型名）
 */

import type { Card, Rank, ComboType } from '../engine/types';

const RANK_DISPLAY: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7',
  8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

const SUIT_SYMBOL: Record<string, string> = {
  S: '♠', H: '♥', D: '♦', C: '♣',
};

export interface CardLabel {
  rank: string;
  suit: string;
  colorClass: string;
}

/** 生成牌面显示标签 */
export function cardLabel(card: Card, level: Rank): CardLabel {
  if (card.kind === 'joker') {
    return {
      rank: card.big ? '大' : '小',
      suit: card.big ? '王' : '王',
      colorClass: card.big ? 'gd-card--joker-big' : 'gd-card--joker-small',
    };
  }
  const isWild = card.suit === 'H' && card.rank === level;
  const rankStr = RANK_DISPLAY[card.rank] ?? String(card.rank);
  const isRed = card.suit === 'H' || card.suit === 'D';
  return {
    rank: rankStr,
    suit: isWild ? '配' : SUIT_SYMBOL[card.suit] ?? card.suit,
    colorClass: isRed ? 'gd-card--red' : 'gd-card--black',
  };
}

/** 大小王牌面：内联小丑 SVG + JOKER 字（各端一致、可着色，不引图片）。
 *  大王=彩色小丑+红 JOKER；小王=灰色小丑+黑 JOKER。 */
function jokerInner(big: boolean): string {
  const c = big
    ? { hatA: '#d23b35', hatB: '#2f8f5b', hatC: '#e0a838', bell: '#f3c623', band: '#6a3fb0', skin: '#f8d9b0', cheek: '#f4a6a0', nose: '#d2362f', ink: '#5b3a1a', collar: '#f3ecd9', suitA: '#d23b35', suitB: '#e0a838', shoe: '#6a3fb0', word: '#d2362f' }
    : { hatA: '#9a9a9a', hatB: '#aeaeae', hatC: '#888888', bell: '#cfcfcf', band: '#7a7a7a', skin: '#dcdcdc', cheek: '#c6c6c6', nose: '#bbbbbb', ink: '#555555', collar: '#ededed', suitA: '#9a9a9a', suitB: '#bcbcbc', shoe: '#777777', word: '#1a1a1a' };
  return `<svg class="gd-joker-fig" viewBox="0 0 44 76" aria-hidden="true">`
    // 帽子三尖 + 铃铛
    + `<path d="M15 13 Q3 14 5 28 L11 23 Q12 16 19 14 Z" fill="${c.hatA}"/><circle cx="5" cy="29" r="2.4" fill="${c.bell}"/>`
    + `<path d="M29 13 Q41 14 39 28 L33 23 Q32 16 25 14 Z" fill="${c.hatB}"/><circle cx="39" cy="29" r="2.4" fill="${c.bell}"/>`
    + `<path d="M15 13 Q22 0 29 13 L26 18 Q22 14 18 18 Z" fill="${c.hatC}"/><circle cx="22" cy="2" r="2.4" fill="${c.bell}"/>`
    // 大头 + 帽檐
    + `<circle cx="22" cy="29" r="13" fill="${c.skin}"/>`
    + `<path d="M10 15 Q22 9 34 15 L34 19 Q22 12 10 19 Z" fill="${c.band}"/>`
    // 脸：眼/腮/鼻/嘴
    + `<circle cx="17.5" cy="29" r="1.7" fill="${c.ink}"/><circle cx="26.5" cy="29" r="1.7" fill="${c.ink}"/>`
    + `<circle cx="14.5" cy="33" r="2.1" fill="${c.cheek}"/><circle cx="29.5" cy="33" r="2.1" fill="${c.cheek}"/>`
    + `<circle cx="22" cy="32.5" r="1.7" fill="${c.nose}"/>`
    + `<path d="M17.5 36 Q22 40.5 26.5 36" stroke="${c.ink}" stroke-width="1.3" fill="none" stroke-linecap="round"/>`
    // 皱领
    + `<path d="M12 41 Q15 46 18 41 Q22 46 26 41 Q29 46 32 41 L30 45 Q22 49 14 45 Z" fill="${c.collar}" stroke="${c.ink}" stroke-width="0.4"/>`
    // 身体（两色小丑衣）+ 扣子
    + `<path d="M16 45 L28 45 L30 64 L14 64 Z" fill="${c.suitA}"/>`
    + `<path d="M22 45 L28 45 L30 64 L22 64 Z" fill="${c.suitB}"/>`
    + `<circle cx="22" cy="51" r="1.1" fill="${c.bell}"/><circle cx="22" cy="57" r="1.1" fill="${c.bell}"/>`
    // 手臂 + 袖口铃铛
    + `<path d="M16 46 Q9 50 11 57" stroke="${c.suitA}" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="11" cy="58" r="2" fill="${c.bell}"/>`
    + `<path d="M28 46 Q35 50 33 57" stroke="${c.suitB}" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="33" cy="58" r="2" fill="${c.bell}"/>`
    // 腿 + 翘头鞋
    + `<rect x="18" y="63" width="2.6" height="7" fill="${c.suitB}"/><rect x="23.4" y="63" width="2.6" height="7" fill="${c.suitA}"/>`
    + `<path d="M14 70 Q12 73.5 18 72.5 L20.6 70.5 Z" fill="${c.shoe}"/><path d="M30 70 Q32 73.5 26 72.5 L23.4 70.5 Z" fill="${c.shoe}"/>`
    + `</svg><span class="gd-joker-word" style="color:${c.word}">JOKER</span>`;
}

/**
 * 创建一张牌的 DOM 元素
 * @param card    要渲染的牌
 * @param level   当前级别点数（用于判断逢人配）
 * @param small   是否使用小尺寸（AI 座位出牌展示）
 */
export function cardEl(card: Card, level: Rank, small = false): HTMLElement {
  const el = document.createElement('div');
  el.className = 'gd-card';
  if (small) el.classList.add('gd-card--small');

  if (card.kind === 'joker') {
    el.classList.add('gd-card--joker', card.big ? 'gd-card--joker-big' : 'gd-card--joker-small');
    el.innerHTML = jokerInner(card.big);
    el.dataset['cardId'] = String(card.id);
    return el;
  }

  const lbl = cardLabel(card, level);
  el.classList.add(lbl.colorClass);

  const rankSpan = document.createElement('span');
  rankSpan.className = 'gd-card__rank';
  rankSpan.textContent = lbl.rank;

  const suitSpan = document.createElement('span');
  suitSpan.className = 'gd-card__suit';
  suitSpan.textContent = lbl.suit;

  el.appendChild(rankSpan);
  el.appendChild(suitSpan);

  // 存储牌 id 用于交互
  el.dataset['cardId'] = String(card.id);

  return el;
}

/** 牌型中文名 */
export function comboTypeLabel(type: ComboType): string {
  const MAP: Record<ComboType, string> = {
    single: '单张',
    pair: '对子',
    triple: '三同张',
    tripleWithPair: '三带二',
    straight: '顺子',
    consecPairs: '连对',
    consecTriples: '钢板',
    bomb: '炸弹',
    straightFlush: '同花顺',
    kingBomb: '四大天王',
  };
  return MAP[type] ?? type;
}

/** 名次文字 */
export function rankName(rankIndex: number): string {
  const NAMES = ['头游', '二游', '三游', '末游'];
  return NAMES[rankIndex] ?? `第${rankIndex + 1}`;
}
