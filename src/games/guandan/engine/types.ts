export type Suit = 'S' | 'H' | 'D' | 'C';                 // ♠♥♦♣
export type Rank = 2|3|4|5|6|7|8|9|10|11|12|13|14;        // 2..10, J=11 Q=12 K=13 A=14
export type Card =
  | { kind: 'normal'; suit: Suit; rank: Rank; id: number } // id 唯一 0..107
  | { kind: 'joker'; big: boolean; id: number };           // big=true 大王, false 小王
export const LEVEL: Rank = 2;                              // 一期固定打 2

export type ComboType =
  | 'single' | 'pair' | 'triple' | 'tripleWithPair'
  | 'straight' | 'consecPairs' | 'consecTriples'
  | 'bomb' | 'straightFlush' | 'kingBomb';

// key=主点数（顺子/连对/钢板取最高位自然序；三带二取三同点；单/对/三取该点）
// power=跨牌型比较用的全序（仅炸弹类间 + 压非炸弹时用）；非炸弹 power=0
export interface Combo { type: ComboType; cards: Card[]; length: number; key: number; power: number; }

export type Seat = 0 | 1 | 2 | 3;                          // 0下 1右 2上 3左；逆时针 (i+1)%4
