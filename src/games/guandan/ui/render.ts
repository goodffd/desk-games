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
    ? { lobeL: '#d23b35', lobeR: '#2f8f5b', lobeC: '#e0a838', bell: '#f3c623', face: '#f6d3a8', band: '#6a3fb0', ink: '#5b3a1a', nose: '#d2362f', word: '#d2362f' }
    : { lobeL: '#9a9a9a', lobeR: '#aeaeae', lobeC: '#888888', bell: '#cfcfcf', face: '#dcdcdc', band: '#777777', ink: '#555555', nose: '#bbbbbb', word: '#1a1a1a' };
  return `<svg class="gd-joker-fig" viewBox="0 0 40 44" aria-hidden="true">`
    + `<path d="M20 16 Q6 16 5 30 L11 25 Q12 19 20 18 Z" fill="${c.lobeL}"/><circle cx="5" cy="31" r="2.6" fill="${c.bell}"/>`
    + `<path d="M20 16 Q34 16 35 30 L29 25 Q28 19 20 18 Z" fill="${c.lobeR}"/><circle cx="35" cy="31" r="2.6" fill="${c.bell}"/>`
    + `<path d="M13 14 Q20 2 27 14 L24 19 Q20 15 16 19 Z" fill="${c.lobeC}"/><circle cx="20" cy="4" r="2.6" fill="${c.bell}"/>`
    + `<circle cx="20" cy="29" r="10" fill="${c.face}"/>`
    + `<path d="M10 23 Q20 17 30 23 L30 27 Q20 21 10 27 Z" fill="${c.band}"/>`
    + `<circle cx="16.5" cy="28" r="1.4" fill="${c.ink}"/><circle cx="23.5" cy="28" r="1.4" fill="${c.ink}"/>`
    + `<circle cx="20" cy="31" r="1.3" fill="${c.nose}"/>`
    + `<path d="M16 33 Q20 37 24 33" stroke="${c.ink}" stroke-width="1.3" fill="none" stroke-linecap="round"/>`
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
