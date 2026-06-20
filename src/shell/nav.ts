/** 游戏大厅 SPA 路径导航：改 URL(pushState) + 触发 popstate 让壳按新路径重渲染。
 *  与象棋一致用真路径（/guandan、/），不用 hash。服务端对非 /xiangqi 路径都回大厅 SPA，故深链/刷新可用。 */
export function navigate(path: string): void {
  if (location.pathname === path) return;
  history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
