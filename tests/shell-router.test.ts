// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { parsePath } from '../src/shell/router';
import { route } from '../src/shell/router';
import type { GameModule, GameEntry } from '../src/shell/types';

// Fake GameModule for testing
function makeFakeModule(id: string): GameModule & { mountCalls: HTMLElement[]; unmountCalls: number[] } {
  const mountCalls: HTMLElement[] = [];
  const unmountCalls: number[] = [];
  return {
    id,
    name: `Game ${id}`,
    desc: `Description of ${id}`,
    mount(root: HTMLElement) {
      mountCalls.push(root);
      root.innerHTML = `<div class="game-${id}">playing ${id}</div>`;
      let callIndex = mountCalls.length - 1;
      return () => {
        unmountCalls.push(callIndex);
        root.innerHTML = '';
      };
    },
    mountCalls,
    unmountCalls,
  };
}

describe('parsePath', () => {
  it('"/" → home', () => {
    expect(parsePath('/')).toEqual({ view: 'home' });
  });

  it('empty string → home', () => {
    expect(parsePath('')).toEqual({ view: 'home' });
  });

  it('"/guandan" → game guandan', () => {
    expect(parsePath('/guandan')).toEqual({ view: 'game', id: 'guandan' });
  });

  it('"/guandan/" (尾斜杠) → game guandan', () => {
    expect(parsePath('/guandan/')).toEqual({ view: 'game', id: 'guandan' });
  });

  it('"/guandan/extra" → 取首段 game guandan', () => {
    expect(parsePath('/guandan/extra')).toEqual({ view: 'game', id: 'guandan' });
  });

  it('"/xiangqi" → game xiangqi', () => {
    expect(parsePath('/xiangqi')).toEqual({ view: 'game', id: 'xiangqi' });
  });
});

describe('route', () => {
  let root: HTMLElement;
  let fakeModule: ReturnType<typeof makeFakeModule>;
  let registry: GameEntry[];

  beforeEach(() => {
    root = document.createElement('div');
    fakeModule = makeFakeModule('testgame');
    registry = [
      { kind: 'internal', module: fakeModule },
      { kind: 'external', id: 'xiangqi', name: '象棋', desc: '中国象棋外链', url: '#' },
    ];
  });

  it('routing to a game calls mount', () => {
    const cleanup = route(registry, '/testgame', root);
    expect(fakeModule.mountCalls.length).toBe(1);
    expect(fakeModule.mountCalls[0]).toBe(root);
    cleanup();
  });

  it('cleanup unmounts the game', () => {
    const cleanup = route(registry, '/testgame', root);
    expect(root.innerHTML).not.toBe('');
    cleanup();
    expect(root.innerHTML).toBe('');
    expect(fakeModule.unmountCalls.length).toBe(1);
  });

  it('routing home renders internal card', () => {
    const cleanup = route(registry, '/', root);
    expect(root.innerHTML).toContain('testgame');
    cleanup();
  });

  it('routing home renders external card with anchor', () => {
    const cleanup = route(registry, '/', root);
    const anchor = root.querySelector('a[target="_blank"]');
    expect(anchor).not.toBeNull();
    expect((anchor as HTMLAnchorElement).rel).toContain('noopener');
    cleanup();
  });

  it('routing home returns noop cleanup without throwing', () => {
    const cleanup = route(registry, '/', root);
    expect(() => cleanup()).not.toThrow();
  });

  it('unknown game id routes home as fallback', () => {
    const cleanup = route(registry, '/nonexistent', root);
    // should fall back to home page, which renders the registered game cards
    expect(root.innerHTML).toContain('testgame');
    cleanup();
  });
});
