import { describe, it, expect } from 'vitest';
import { deriveWsUrl } from '../../../src/games/xiangqi/ui/online';

describe('deriveWsUrl', () => {
  it('https→wss、http→ws、file→空', () => {
    expect(deriveWsUrl({ protocol: 'https:', host: 'x:8443' } as Location)).toBe('wss://x:8443/ws');
    expect(deriveWsUrl({ protocol: 'http:', host: 'x:8080' } as Location)).toBe('ws://x:8080/ws');
    expect(deriveWsUrl({ protocol: 'file:', host: '' } as Location)).toBe('');
  });
});
