/**
 * render.ts — 掼蛋 UI 的 DOM 渲染工具（无状态，纯 DOM）。
 *
 * 牌面本身已抽到共享的 src/ui/cards/（花色图 / 小丑图 / 字体 / 几何两个游戏共用）；
 * 这里只留掼蛋专有的东西：cardEl（把逢人配判断喂给共享牌面）+ 牌型中文名 / 报牌语音 / 名次。
 */

import type { Card, Rank, ComboType, Combo } from '../engine/types';
import { cardFace } from '../../../ui/cards/card-face';
import type { FaceCard } from '../../../ui/cards/types';
import '../../../ui/cards/card-face.css';
import '../../../ui/cards/joker-img.css';
import '../../../ui/cards/rank-font.css';

/**
 * 创建一张牌的 DOM。逢人配（红心级牌）是掼蛋规则，在这里判定后，把「角标放金『配』字」
 * 作为 cornerBadge 交给共享牌面——共享层不认识逢人配。
 */
export function cardEl(card: Card, level: Rank, small = false): HTMLElement {
  const wild = card.kind === 'normal' && card.suit === 'H' && card.rank === level;
  return cardFace(card as FaceCard, {
    small,
    cornerBadge: wild ? { text: '配', className: 'dgc-card__suit--wild' } : null,
  });
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

/** 牌点读音（途游黑话）：A=尖 Q=圈 J=钩，大小王中文，K/数字照读。
 *  key = combo.key（单张/对子/三同张点数 rankValue）：级牌=15、小王=16、大王=17 */
function rankSpeech(key: number, level: Rank): string {
  if (key === 17) return '大王';
  if (key === 16) return '小王';
  const r = key === 15 ? level : key; // 级牌按其自然点数（固定打 2 → “2”）
  switch (r) {
    case 14: return '尖'; // A
    case 13: return 'K';
    case 12: return '圈'; // Q
    case 11: return '钩'; // J
    default: return String(r); // 2-10
  }
}

/** 出牌语音：报牌型 / 报点数 */
export function comboSpeech(combo: Combo, level: Rank): string {
  switch (combo.type) {
    case 'single': return rankSpeech(combo.key, level);
    case 'pair': return '对' + rankSpeech(combo.key, level);
    case 'triple': return '3条' + rankSpeech(combo.key, level);
    case 'tripleWithPair': return '三带二';
    case 'straight': return '顺子';
    case 'straightFlush': return '同花顺';
    case 'consecPairs': return '三连对'; // 掼蛋连对固定 3 对(六张)，无四/五连对
    case 'consecTriples': return '钢板';
    case 'bomb': return '炸弹';
    case 'kingBomb': return '天王炸';
    default: return comboTypeLabel(combo.type);
  }
}

/** 名次文字 */
export function rankName(rankIndex: number): string {
  const NAMES = ['头游', '二游', '三游', '末游'];
  return NAMES[rankIndex] ?? `第${rankIndex + 1}`;
}
