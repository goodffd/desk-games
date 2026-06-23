import { describe, it, expect } from 'vitest';
import { deriveWsUrl } from '../../../src/games/xiangqi/ui/online';

describe('WS 地址派生', () => {
  it('http 页面 → ws://同主机/ws', () => {
    expect(deriveWsUrl({ protocol: 'http:', host: 'srv:8080' } as Location)).toBe('ws://srv:8080/ws');
  });
  it('https 页面 → wss://同主机/ws', () => {
    expect(deriveWsUrl({ protocol: 'https:', host: 'x.com' } as Location)).toBe('wss://x.com/ws');
  });
  it('file:// → 空（联机不可用）', () => {
    expect(deriveWsUrl({ protocol: 'file:', host: '' } as Location)).toBe('');
  });
});
