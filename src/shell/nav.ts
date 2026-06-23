/** 游戏大厅 SPA 路径导航：改 URL(pushState) + 触发 popstate 让壳按新路径重渲染。
 *  用真路径（/guandan、/），不用 hash。服务端对所有路径都回大厅 SPA(象棋已内置，/xiangqi 由前端路由 mount)，故深链/刷新可用。 */
export function navigate(path: string): void {
  if (location.pathname === path) return;
  history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
