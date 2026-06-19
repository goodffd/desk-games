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
