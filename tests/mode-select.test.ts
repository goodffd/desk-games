// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderModeSelect } from '../src/games/guandan/ui/mode-select';

describe('renderModeSelect', () => {
  it('并排渲染两模式：单机对战 / 4 人联机', () => {
    const root = document.createElement('div');
    renderModeSelect(root, { onSingle: () => {}, onOnline: () => {} });
    const modes = root.querySelectorAll('.gd-mode');
    expect(modes.length).toBe(2);
    expect(root.textContent).toContain('单机对战');
    expect(root.textContent).toContain('4 人联机');
  });

  it('点单机→onSingle，点联机→onOnline（互不触发）', () => {
    const root = document.createElement('div');
    let single = 0;
    let online = 0;
    renderModeSelect(root, { onSingle: () => single++, onOnline: () => online++ });
    const btns = root.querySelectorAll<HTMLButtonElement>('.gd-mode');
    btns[0]!.click();
    expect(single).toBe(1);
    expect(online).toBe(0);
    btns[1]!.click();
    expect(single).toBe(1);
    expect(online).toBe(1);
  });

  it('cleanup 清空 root', () => {
    const root = document.createElement('div');
    const cleanup = renderModeSelect(root, { onSingle: () => {}, onOnline: () => {} });
    expect(root.innerHTML).not.toBe('');
    cleanup();
    expect(root.innerHTML).toBe('');
  });
});
