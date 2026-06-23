// 滑动动画的纯数学工具（无 DOM 依赖，可单测）

// 线性插值
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// 二次缓入缓出，t 越界夹紧到 [0,1]
export function easeInOutQuad(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}
