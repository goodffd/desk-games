import type { GameEntry, GameModule } from './types';

// 掼蛋 stub（Task 8 占位，Task 9 替换为真实 UI）
const guandanStub: GameModule = {
  id: 'guandan',
  name: '掼蛋',
  desc: '升级类扑克，2v2 四人局，支持对 AI 单局',
  mount(root: HTMLElement): () => void {
    root.innerHTML = '<div style="padding:2rem;text-align:center;font-size:1.2rem">掼蛋（开发中）</div>';
    return () => {
      root.innerHTML = '';
    };
  },
};

/**
 * 构建游戏注册表
 * @param xiangqiUrl 象棋外链，由调用方注入（main.ts 负责 try/catch 读 links.ts）
 */
export function buildRegistry(xiangqiUrl: string = '#'): GameEntry[] {
  return [
    { kind: 'internal', module: guandanStub },
    {
      kind: 'external',
      id: 'xiangqi',
      name: '象棋',
      desc: '中国象棋，点击前往在线对局',
      url: xiangqiUrl,
    },
  ];
}
