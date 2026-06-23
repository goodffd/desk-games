// Web Audio 实时合成音效：零资源文件、file:// 可用。
// 首次用户手势后 resume（合规自动播放策略）；静音状态由调用方持久化后注入。
type SoundName = 'move' | 'capture' | 'check' | 'win';

let ctx: AudioContext | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

export function initSound(initialMuted: boolean): void {
  muted = initialMuted;
}
export function setMuted(m: boolean): void {
  muted = m;
}
export function isMuted(): boolean {
  return muted;
}

// 在首次用户手势调用，满足浏览器自动播放策略（重复调用幂等）
export function resumeAudio(): void {
  const c = ac();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

// 静音 WAV 数据 URI（0.2s 全零样本，16bit/8kHz/单声道）。内联生成，不破坏"零资源"。
function silentWavUri(): string {
  const sr = 8000, samples = sr / 5; // 0.2s
  const dataLen = samples * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const dv = new DataView(buf);
  let o = 0;
  const str = (s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o++, s.charCodeAt(i)); };
  const u32 = (v: number) => { dv.setUint32(o, v, true); o += 4; };
  const u16 = (v: number) => { dv.setUint16(o, v, true); o += 2; };
  str('RIFF'); u32(36 + dataLen); str('WAVE');
  str('fmt '); u32(16); u16(1); u16(1); u32(sr); u32(sr * 2); u16(2); u16(16);
  str('data'); u32(dataLen); // 样本区已全零 = 静音
  let bin = '';
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return 'data:audio/wav;base64,' + btoa(bin);
}

let mediaUnlock: HTMLAudioElement | null = null;

// 首次任意用户手势（点击/触摸/按键）解锁音频：
// ① resume + 手势内启动一个静音节点（让 AudioContext 进入 running，iOS 必需）；
// ② 播放一个静音循环 HTMLAudio，把 iOS 音频会话提升为 playback → Web Audio 走媒体声道，绕过侧边静音拨片。
export function unlockOnFirstGesture(): void {
  const events = ['pointerdown', 'touchend', 'mousedown', 'keydown'];
  const handler = () => {
    const c = ac();
    if (c) {
      if (c.state === 'suspended') c.resume().catch(() => {});
      try {
        const buf = c.createBuffer(1, 1, 22050);
        const src = c.createBufferSource();
        src.buffer = buf;
        src.connect(c.destination);
        src.start(0);
      } catch { /* 忽略 */ }
    }
    try {
      if (!mediaUnlock) { mediaUnlock = new Audio(silentWavUri()); mediaUnlock.loop = true; }
      mediaUnlock.play().catch(() => {});
    } catch { /* 忽略 */ }
    events.forEach((e) => window.removeEventListener(e, handler));
  };
  events.forEach((e) => window.addEventListener(e, handler));
}

// 单个振荡器 + 增益包络（快起声、指数衰减）
function tone(c: AudioContext, freq: number, start: number, dur: number, type: OscillatorType, peak: number): void {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  osc.connect(g);
  g.connect(c.destination);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(peak, start + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.start(start);
  osc.stop(start + dur + 0.03);
}

export function play(name: SoundName): void {
  if (muted) return;
  const c = ac();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  const t = c.currentTime + 0.001;
  try {
    switch (name) {
      case 'move': // 落子：轻脆木击
        tone(c, 240, t, 0.08, 'triangle', 0.25);
        break;
      case 'capture': // 吃子：低频较重
        tone(c, 130, t, 0.16, 'square', 0.3);
        tone(c, 90, t + 0.02, 0.16, 'triangle', 0.2);
        break;
      case 'check': // 将军：警示双音
        tone(c, 700, t, 0.1, 'sine', 0.28);
        tone(c, 940, t + 0.12, 0.12, 'sine', 0.28);
        break;
      case 'win': // 终局：上行琶音和弦
        [523, 659, 784].forEach((f, i) => tone(c, f, t + i * 0.1, 0.4, 'sine', 0.22));
        break;
    }
  } catch {
    /* 合成失败静默 */
  }
}
