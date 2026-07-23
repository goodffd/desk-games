/**
 * 共享牌面的结构类型。**不 import 任何 engine**——掼蛋与干瞪眼各自的 Card 都与它同构，
 * 靠结构兼容（duck typing）传进来即可，牌面组件不认识任何一方的规则。
 */
export type CardSuit = 'S' | 'H' | 'D' | 'C';
export type CardRank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export type FaceCard =
  | { kind: 'normal'; suit: CardSuit; rank: CardRank; id: number }
  | { kind: 'joker'; big: boolean; id: number };
