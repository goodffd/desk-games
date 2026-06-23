import './shell/shell.css';
import { buildRegistry } from './shell/registry';
import { route } from './shell/router';

function init() {
  const app = document.getElementById('app');
  if (!app) return;

  const registry = buildRegistry();
  let cleanup: (() => void) | null = null;

  function render() {
    if (cleanup) cleanup();
    cleanup = route(registry, location.pathname, app!);
  }

  window.addEventListener('popstate', render); // 真路径导航（navigate 用 pushState + 派发 popstate）
  render();
}

init();
