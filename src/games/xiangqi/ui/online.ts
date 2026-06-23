export type LobbyRoom = { code: string; host: string; status: 'waiting' | 'playing'; players: [string, string] | null; spectators: number };
export type OnlineMsg =
  | { t: 'hello'; nick: string } | { t: 'rename'; nick: string }
  | { t: 'hello-ok' } | { t: 'rename-ok' } | { t: 'nick-taken' }
  | { t: 'lobby' } | { t: 'lobby'; rooms: LobbyRoom[] }
  | { t: 'create'; isPrivate: boolean } | { t: 'created'; code: string; isPrivate: boolean }
  | { t: 'join'; code: string } | { t: 'paired'; color: 'red' | 'black'; you: string; opponent: string; code: string }
  | { t: 'spectate'; code: string } | { t: 'spectating'; host: string; players: [string, string] }
  | { t: 'rejoin'; code: string; nick: string } | { t: 'rejoined'; color: 'red' | 'black'; you: string; opponent: string }
  | { t: 'need-sync' } | { t: 'sync'; pgn: string }
  | { t: 'error'; msg: string } | { t: 'peer-left' } | { t: 'peer-disconnected' } | { t: 'peer-reconnected' } | { t: 'room-closed' }
  | { t: 'move'; iccs: string } | { t: 'resign' }
  | { t: 'draw-offer' } | { t: 'draw-accept' } | { t: 'draw-decline' }
  | { t: 'undo-request' } | { t: 'undo-accept' } | { t: 'undo-decline' };

export type OnlineState = 'idle' | 'connecting' | 'open' | 'closed';

// 同源 WS 地址：http→ws、https→wss；file:// 无 host → 空（联机不可用）
export function deriveWsUrl(loc: Pick<Location, 'protocol' | 'host'>): string {
  if (loc.protocol !== 'http:' && loc.protocol !== 'https:') return '';
  return (loc.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + loc.host + '/ws';
}

export class OnlineSession {
  private ws: WebSocket | null = null;
  onMessage: (m: OnlineMsg) => void = () => {};
  onState: (s: OnlineState) => void = () => {};

  available(): boolean { return deriveWsUrl(location) !== ''; }

  connect(onReady: () => void): void {
    const url = deriveWsUrl(location);
    if (!url) { this.onState('closed'); return; }
    this.onState('connecting');
    const ws = new WebSocket(url);
    this.ws = ws;
    let closedOnce = false;
    const fireClosed = () => { if (closedOnce) return; closedOnce = true; this.onState('closed'); }; // onerror+onclose 去重，避免双重重连
    ws.onopen = () => { this.onState('open'); onReady(); };
    ws.onmessage = (e) => { try { this.onMessage(JSON.parse(e.data) as OnlineMsg); } catch { /* 忽略坏包 */ } };
    ws.onclose = fireClosed;
    ws.onerror = fireClosed;
  }
  hello(nick: string): void { this.send({ t: 'hello', nick }); }
  rename(nick: string): void { this.send({ t: 'rename', nick }); }
  subscribeLobby(): void { this.send({ t: 'lobby' }); }
  createRoom(isPrivate: boolean): void { this.send({ t: 'create', isPrivate }); }
  joinRoom(code: string): void { this.send({ t: 'join', code }); }
  spectate(code: string): void { this.send({ t: 'spectate', code }); }
  rejoin(code: string, nick: string): void { this.send({ t: 'rejoin', code, nick }); }
  send(m: OnlineMsg): void { if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
  close(): void { this.ws?.close(); this.ws = null; }
}
