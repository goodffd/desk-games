/** 游戏模块接口：内置游戏需实现此接口 */
export interface GameModule {
  id: string;
  name: string;
  desc: string;
  /** 挂载游戏到容器，返回 unmount 清理函数 */
  mount(root: HTMLElement): () => void;
}

/** 注册表项：内置游戏或外链游戏 */
export type GameEntry =
  | { kind: 'internal'; module: GameModule }
  | { kind: 'external'; id: string; name: string; desc: string; url: string };
