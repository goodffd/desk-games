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

/** 大小王牌面：小丑图（背景图见 joker-img.css，owner 提供）+ 竖排 JOKER。
 *  大王=彩色原图+红 JOKER；小王=整体 CSS 转灰+黑 JOKER（见 guandan.css）。 */
function jokerInner(big: boolean): string {
  const word = big ? '#d2362f' : '#1a1a1a';
  return `<div class="gd-joker-fig"></div><span class="gd-joker-word" style="color:${word}">JOKER</span>`;
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
  const isWild = lbl.suit === '配';

  // 角标（左上）：点数 + 花色。花色用 GDSuit 字体，四花色同度量同大小；逢人配则花色位置放金「配」
  const corner = document.createElement('div');
  corner.className = 'gd-card__corner';
  const rankSpan = document.createElement('span');
  rankSpan.className = 'gd-card__rank';
  rankSpan.textContent = lbl.rank;
  const suitSpan = document.createElement('span');
  suitSpan.className = isWild ? 'gd-card__suit gd-card__suit--wild' : 'gd-card__suit';
  suitSpan.textContent = lbl.suit; // ♠♥♦♣ 或 配
  corner.appendChild(rankSpan);
  corner.appendChild(suitSpan);
  el.appendChild(corner);

  // 牌身中心大花色（途游：一张牌=角标花色+中心花色，两处）；逢人配中心为真实红心
  const pip = document.createElement('span');
  pip.className = 'gd-card__pip';
  pip.textContent = SUIT_SYMBOL[card.suit] ?? '';
  el.appendChild(pip);

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
