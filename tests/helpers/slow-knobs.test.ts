import { describe, it, expect, afterEach, vi } from 'vitest';
import { slowCount } from './slow-knobs';

const KEY = 'SLOW_KNOBS_SPEC_ONLY';

function setEnv(value: string | undefined): void {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process!.env!;
  if (value === undefined) delete env[KEY];
  else env[KEY] = value;
}

afterEach(() => {
  setEnv(undefined);
  vi.restoreAllMocks();
});

describe('slowCount — 慢轨局数旋钮', () => {
  it('没设环境变量时用基线值', () => {
    expect(slowCount(KEY, 500)).toBe(500);
  });

  it('空串与纯空白视同没设', () => {
    setEnv('');
    expect(slowCount(KEY, 500)).toBe(500);
    setEnv('   ');
    expect(slowCount(KEY, 500)).toBe(500);
  });

  it('设了合法正整数就用它', () => {
    setEnv('20');
    expect(slowCount(KEY, 500)).toBe(20);
  });

  it('调小时打警告——绿灯在这个规模下不作数，必须说出来', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setEnv('20');
    slowCount(KEY, 500);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('不可作为提交/发版依据');
  });

  it('调大或持平不打警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setEnv('500');
    expect(slowCount(KEY, 500)).toBe(500);
    setEnv('900');
    expect(slowCount(KEY, 500)).toBe(900);
    expect(warn).not.toHaveBeenCalled();
  });

  it('非正整数直接抛错，不静默退回基线', () => {
    for (const bad of ['0', '-1', '2.5', 'abc', 'NaN']) {
      setEnv(bad);
      expect(() => slowCount(KEY, 500)).toThrow(/不是正整数/);
    }
  });
});
