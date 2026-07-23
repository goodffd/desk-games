/**
 * 牌桌座位环形布局。纯函数，可单测——牌桌本体是 DOM，测不了，但「座位摆在哪」是算术，能测。
 *
 * 座位沿一个椭圆分布，**视角座（自己）恒在正下方**（egocentric）：调用方先把服务端座号
 * 换成视角座号 `v = (serverSeat - mySeat + n) % n`，再喂给这里。v=0 落在底部中央。
 *
 * n=4 时四个座正好落在 底/右/顶/左，与掼蛋固定 4 座的方位一致（掼蛋自己的布局不迁移，
 * 这里只用一条单测钉死这个对应关系，作为几何契约）。
 */

export type SeatEdge = 'bottom' | 'right' | 'top' | 'left';
export interface SeatAnchor { leftPct: number; topPct: number; edge: SeatEdge }

/** 角度（度）落在哪条边。0°=底，顺时针（sin 正）到右。 */
function edgeOf(deg: number): SeatEdge {
  const d = ((deg % 360) + 360) % 360;
  if (d >= 315 || d < 45) return 'bottom';
  if (d < 135) return 'right';
  if (d < 225) return 'top';
  return 'left';
}

/**
 * n 个座位在椭圆上的锚点（百分比），v=0 在正下方，其余按 v·360/n 顺时针排开。
 * @param rxPct 椭圆横向半径（占容器宽的百分比）
 * @param ryPct 椭圆纵向半径
 */
export function seatRing(n: number, rxPct = 38, ryPct = 34): SeatAnchor[] {
  const out: SeatAnchor[] = [];
  for (let v = 0; v < n; v++) {
    const deg = (v * 360) / n;
    const rad = (deg * Math.PI) / 180;
    out.push({
      leftPct: 50 + rxPct * Math.sin(rad),
      topPct: 50 + ryPct * Math.cos(rad),   // cos>0 → 下方（top 百分比大）
      edge: edgeOf(deg),
    });
  }
  return out;
}
