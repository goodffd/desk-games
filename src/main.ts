import './shell/shell.css';
import { buildRegistry } from './shell/registry';
import { route } from './shell/router';

async function loadXiangqiUrl(): Promise<string> {
  // links.ts 在 .gitignore，不进仓库；运行时若存在则用真实 URL
  // import.meta.glob 在 build 时不强制文件存在（匹配零文件不报错）
  const modules = import.meta.glob('./shell/links.ts');
  const loader = modules['./shell/links.ts'];
  if (loader) {
    try {
      const mod = await loader() as { XIANGQI_URL?: string };
      return typeof mod.XIANGQI_URL === 'string' ? mod.XIANGQI_URL : '#';
    } catch {
      return '#';
    }
  }
  return '#';
}

async function init() {
  const app = document.getElementById('app');
  if (!app) return;

  const xiangqiUrl = await loadXiangqiUrl();
  const registry = buildRegistry(xiangqiUrl);
  let cleanup: (() => void) | null = null;

  function render() {
    if (cleanup) cleanup();
    cleanup = route(registry, location.pathname, app!);
  }

  window.addEventListener('popstate', render); // 真路径导航（navigate 用 pushState + 派发 popstate）
  render();
}

init();
