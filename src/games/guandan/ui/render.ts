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

/** 花色 SVG 路径（24×24 viewBox），fill=currentColor 跟随红/黑色，各端一致不掉系统 emoji */
const SUIT_PATH: Record<string, string> = {
  S: 'M12 2c0 4.5-7 7-7 12 0 2.2 1.8 4 4 4 .8 0 1.5-.2 2.1-.6-.3 1.6-1.1 3-2.6 4.2h7c-1.5-1.2-2.3-2.6-2.6-4.2.6.4 1.3.6 2.1.6 2.2 0 4-1.8 4-4 0-5-7-7.5-7-12z',
  H: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
  D: 'M12 2 L19 12 L12 22 L5 12 Z',
  C: 'M12 2a3 3 0 0 0-2.6 4.5A3 3 0 1 0 8.7 13c.8.5 1.8.6 2.6.4-.2 1.6-1.1 3-2.6 4.2h7c-1.5-1.2-2.4-2.6-2.6-4.2.8.2 1.8.1 2.6-.4A3 3 0 1 0 14.6 6.5 3 3 0 0 0 12 2z',
};

const SVG_NS = 'http://www.w3.org/2000/svg';
function suitSvg(suit: string, cls: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', SUIT_PATH[suit] ?? '');
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}

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

  // 途游式角标（左上）：点数 + 小花色
  const corner = document.createElement('div');
  corner.className = 'gd-card__corner';
  const rankSpan = document.createElement('span');
  rankSpan.className = 'gd-card__rank';
  rankSpan.textContent = lbl.rank;
  corner.appendChild(rankSpan);
  corner.appendChild(suitSvg(card.suit, 'gd-card__suit'));
  el.appendChild(corner);

  // 中心大花色
  el.appendChild(suitSvg(card.suit, 'gd-card__pip'));

  // 逢人配：右上金徽章
  if (isWild) {
    const tag = document.createElement('span');
    tag.className = 'gd-card__wild-tag';
    tag.textContent = '配';
    el.appendChild(tag);
  }

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
