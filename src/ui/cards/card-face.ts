import type { CardRank, CardSuit, FaceCard } from './types';
import { SUIT_IMG } from './suits';

/**
 * 共享牌面 DOM 工厂。掼蛋与干瞪眼共用同一套花色图 / 小丑图 / 字体 / 几何——
 * 真正值钱的美术资产与 owner 磨过约 20 轮的牌面几何只此一份。
 *
 * 类名一律 dgc-*（desk-games card）。样式在 card-face.css，图在 suits.ts / joker-img.css，
 * 字体在 rank-font.css。**这里不认识任何一方的规则**：逢人配是掼蛋的、王的指派是干瞪眼的，
 * 都由调用方通过 opts 传进来（cornerBadge / assignedRank），牌面组件只管画。
 *
 * DOM 结构与掼蛋原 cardEl 逐字节对应（只 gd- → dgc-），由 tests/card-face-dom.test.ts 锁死。
 */

const RANK_DISPLAY: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7',
  8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};
const SUIT_SYMBOL: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

export function rankText(r: CardRank): string { return RANK_DISPLAY[r] ?? String(r); }
export function suitSymbol(s: CardSuit): string { return SUIT_SYMBOL[s] ?? s; }

/** 调试/无障碍文本：'♠A' / '大王' / '大王(=6)'（带指派时） */
export function cardText(c: FaceCard, assignedRank?: CardRank | null): string {
  if (c.kind === 'joker') {
    const base = c.big ? '大王' : '小王';
    return assignedRank != null ? `${base}(=${rankText(assignedRank)})` : base;
  }
  return `${suitSymbol(c.suit)}${rankText(c.rank)}`;
}

/** 花色图：按高缩放、自然宽度；加 dgc-suit-<花色> 类做单花色微调（方块菱形面积小，CSS 放大补偿） */
function suitImg(suit: string, cls: string): HTMLImageElement {
  const img = document.createElement('img');
  img.className = `${cls} dgc-suit-${suit}`;
  img.src = SUIT_IMG[suit] ?? '';
  img.alt = '';
  return img;
}

/** 大小王牌面：小丑图（背景图见 joker-img.css）+ 竖排 JOKER。大王彩+红字，小王 CSS 转灰+黑字。 */
function jokerInner(big: boolean): string {
  const word = big ? '#d2362f' : '#1a1a1a';
  const letters = [...'JOKER'].map((ch) => `<span>${ch}</span>`).join('');
  return `<div class="dgc-joker-fig"></div><span class="dgc-joker-word" style="color:${word}">${letters}</span>`;
}

export interface CardFaceOptions {
  /** 出牌区 / 别家的小牌 */
  small?: boolean;
  /**
   * 角标花色位改放一个短标记，而不是花色图。掼蛋逢人配传
   * `{ text: '配', className: 'dgc-card__suit--wild' }`。
   */
  cornerBadge?: { text: string; className?: string } | null;
  /**
   * 「这张牌当前被算作某点数」——干瞪眼的王。渲染成牌底金色药丸。掼蛋恒 null。
   */
  assignedRank?: CardRank | null;
  /** 游戏侧钩子，如 gy-card--dead */
  extraClass?: string;
}

/** 造一张牌的 DOM。根元素恒带 data-card-id。 */
export function cardFace(card: FaceCard, opts: CardFaceOptions = {}): HTMLElement {
  const el = document.createElement('div');
  el.className = 'dgc-card';
  if (opts.small) el.classList.add('dgc-card--small');
  if (opts.extraClass) el.classList.add(opts.extraClass);

  if (card.kind === 'joker') {
    el.classList.add('dgc-card--joker', card.big ? 'dgc-card--joker-big' : 'dgc-card--joker-small');
    el.innerHTML = jokerInner(card.big);
    if (opts.assignedRank != null) el.appendChild(assignPill(opts.assignedRank));
    el.dataset['cardId'] = String(card.id);
    return el;
  }

  const isRed = card.suit === 'H' || card.suit === 'D';
  el.classList.add(isRed ? 'dgc-card--red' : 'dgc-card--black');

  // 角标（左上）：点数 + 花色（或短标记）。手牌横排 / 出牌竖排由 CSS 控。
  const corner = document.createElement('div');
  corner.className = 'dgc-card__corner';
  const rankSpan = document.createElement('span');
  rankSpan.className = 'dgc-card__rank';
  const r = rankText(card.rank);
  if (/[JQKA]/.test(r)) rankSpan.classList.add('dgc-card__rank--alpha'); // 字母比数字宽，横向收窄
  if (r === '10') rankSpan.classList.add('dgc-card__rank--ten');         // 两位数太宽，横向压缩
  rankSpan.textContent = r;
  corner.appendChild(rankSpan);
  if (opts.cornerBadge) {
    const b = document.createElement('span');
    b.className = ['dgc-card__suit', opts.cornerBadge.className].filter(Boolean).join(' ');
    b.textContent = opts.cornerBadge.text;
    corner.appendChild(b);
  } else {
    corner.appendChild(suitImg(card.suit, 'dgc-card__suit'));
  }
  el.appendChild(corner);

  // 右下角大花色（途游式：左上角标 + 右下大花色填满整张牌）
  el.appendChild(suitImg(card.suit, 'dgc-card__pip'));

  if (opts.assignedRank != null) el.appendChild(assignPill(opts.assignedRank));

  el.dataset['cardId'] = String(card.id);
  return el;
}

/** 牌底金色药丸：显示这张王被算作几点。只写数字（GDRank 子集含 0-9，不含 '='）。 */
function assignPill(rank: CardRank): HTMLElement {
  const pill = document.createElement('div');
  pill.className = 'dgc-card__assign';
  pill.textContent = rankText(rank);
  return pill;
}
