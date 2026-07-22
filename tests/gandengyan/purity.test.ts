import { describe, it, expect } from 'vitest';

/**
 * 引擎纯度闸门。
 *
 * 项目 CLAUDE.md 的硬约定：`engine/` 绝不 import DOM，规则判定只有这一个真相来源。
 * 干瞪眼还多一条：**引擎自己不摇骰子**——洗牌函数由调用方注入，
 * 否则同一个种子复现不出同一局，模糊测试的失败就没法复盘。
 *
 * 这条测试读源码而不是读行为，是刻意的：这些是架构约束，不是可以靠跑一遍看出来的东西。
 */
// 用 Vite 的 import.meta.glob 读源码，不引 node:fs —— 这个 tsconfig 不带 Node 类型。
const SOURCES = import.meta.glob('../../src/games/gandengyan/engine/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function engineSources(): { name: string; text: string }[] {
  return Object.entries(SOURCES).map(([path, text]) => ({ name: path.split('/').pop()!, text }));
}

/** 去掉注释再检查，免得文档里提一句 `Math.random` 就把闸门打红。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('干瞪眼引擎纯度', () => {
  it('引擎目录里确实有文件（防止这条测试因为路径写错而空跑成绿）', () => {
    expect(engineSources().length).toBeGreaterThanOrEqual(3);
  });

  it('不 import 任何东西，除了引擎目录内部的同伴', () => {
    for (const { name, text } of engineSources()) {
      const imports = [...stripComments(text).matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
      for (const spec of imports) {
        expect(spec.startsWith('./'), `${name} 引入了外部模块 ${spec}`).toBe(true);
      }
    }
  });

  it('不碰 DOM 与网络', () => {
    const banned = ['document', 'window', 'navigator', 'localStorage', 'fetch(', 'WebSocket', 'XMLHttpRequest'];
    for (const { name, text } of engineSources()) {
      const src = stripComments(text);
      for (const token of banned) {
        expect(src.includes(token), `${name} 出现了 ${token}`).toBe(false);
      }
    }
  });

  it('自己不摇骰子：随机源必须由调用方注入', () => {
    for (const { name, text } of engineSources()) {
      const src = stripComments(text);
      expect(src.includes('Math.random'), `${name} 直接用了 Math.random`).toBe(false);
      expect(src.includes('Date.now'), `${name} 直接用了 Date.now`).toBe(false);
    }
  });
});
