import { Game } from '../engine/game';
import { gameToPgn, pgnToGame } from '../engine/pgn';

const KEY = 'xiangqi:lastgame';

// 本地日期（北京时区即用户本地），用于 PGN Date tag；导出与自动存档统一用此
export function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

// 自动续局：把当前对局写入 localStorage（失败静默，如隐私模式）
export function saveGame(game: Game): void {
  try {
    localStorage.setItem(KEY, gameToPgn(game, { date: today() }));
  } catch { /* 忽略：localStorage 不可用 */ }
}

// 读取上次对局；无存档或损坏返回 null
export function loadGame(): Game | null {
  try {
    const text = localStorage.getItem(KEY);
    if (!text) return null;
    return pgnToGame(text);
  } catch {
    return null;
  }
}

export function clearSaved(): void {
  try { localStorage.removeItem(KEY); } catch { /* 忽略 */ }
}

const TKEY = 'xiangqi:theme';

// 记住主题选择（失败静默）
export function saveTheme(key: string): void {
  try { localStorage.setItem(TKEY, key); } catch { /* 忽略 */ }
}

// 读上次主题；无则返回空串（调用方回退默认）
export function loadTheme(): string {
  try { return localStorage.getItem(TKEY) || ''; } catch { return ''; }
}

const MKEY = 'xiangqi:muted';

export function saveMuted(m: boolean): void {
  try { localStorage.setItem(MKEY, m ? '1' : '0'); } catch { /* 忽略 */ }
}

export function loadMuted(): boolean {
  try { return localStorage.getItem(MKEY) === '1'; } catch { return false; }
}

const BKEY = 'xiangqi:bookhint';
export function saveBookHint(on: boolean): void { try { localStorage.setItem(BKEY, on ? '1' : '0'); } catch { /* 忽略 */ } }
export function loadBookHint(): boolean { try { return localStorage.getItem(BKEY) === '1'; } catch { return false; } }

const NKEY = 'xiangqi:nick';

// 默认友好名：棋友 + 3 位数字（避免空名；用户进联机时可改）
export function defaultNick(): string {
  return '棋友' + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
}
export function saveNick(n: string): void {
  try { localStorage.setItem(NKEY, n); } catch { /* 忽略 */ }
}
export function loadNick(): string {
  try { return localStorage.getItem(NKEY) || ''; } catch { return ''; }
}
