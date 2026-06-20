/**
 * render.ts — DOM 渲染工具函数（无状态，纯 DOM）
 *
 * 提供：
 * - cardEl(card, level, small?) → HTMLElement
 * - cardLabel(card, level) → { rank: string; suit: string; colorClass: string }
 * - comboTypeLabel(type) → string（中文牌型名）
 */

import type { Card, Rank, ComboType } from '../engine/types';
import { SUIT_IMG } from './suits';

const RANK_DISPLAY: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7',
  8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

const SUIT_SYMBOL: Record<string, string> = {
  S: '♠', H: '♥', D: '♦', C: '♣',
};

/** 花色图（Seedream 生成，已去白底+正色）；按高度缩放，自然宽度，四花色一致 */
function suitImg(suit: string, cls: string): HTMLImageElement {
  const img = document.createElement('img');
  img.className = cls;
  img.src = SUIT_IMG[suit] ?? '';
  img.alt = '';
  return img;
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
  // 逐字母竖列：用 flex column + line-height 精确压缩字母竖向间距，不靠 writing-mode 的不可控 advance
  const letters = [...'JOKER'].map((ch) => `<span>${ch}</span>`).join('');
  return `<div class="gd-joker-fig"></div><span class="gd-joker-word" style="color:${word}">${letters}</span>`;
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

  // 角标（左上）：点数 + 花色。手牌横排 / 出牌竖排由 CSS 控；逢人配花色位放金「配」
  const corner = document.createElement('div');
  corner.className = 'gd-card__corner';
  const rankSpan = document.createElement('span');
  rankSpan.className = 'gd-card__rank';
  if (/[JQKA]/.test(lbl.rank)) rankSpan.classList.add('gd-card__rank--alpha'); // 字母比数字宽，单独横向收窄
  if (lbl.rank === '10') rankSpan.classList.add('gd-card__rank--ten');         // 两位数太宽，横向压缩+缩小1/0间距
  rankSpan.textContent = lbl.rank;
  corner.appendChild(rankSpan);
  if (isWild) {
    const w = document.createElement('span');
    w.className = 'gd-card__suit gd-card__suit--wild';
    w.textContent = '配';
    corner.appendChild(w);
  } else {
    corner.appendChild(suitImg(card.suit, 'gd-card__suit'));
  }
  el.appendChild(corner);

  // 右下角大花色（途游：左上角标 + 右下大花色填满整张牌）
  el.appendChild(suitImg(card.suit, 'gd-card__pip'));

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
