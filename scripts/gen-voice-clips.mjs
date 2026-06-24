// 生成掼蛋报牌语音 clip（豆包2.0 vivi，B档：快+开心）+ ffmpeg 后处理 → base64 内嵌 voice-clips.ts
// 需要 ffmpeg/ffprobe（brew install ffmpeg）。凭证在钥匙串 volc-tts-appid / volc-tts-token。
import { execSync, execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const appid = execSync("security find-generic-password -s volc-tts-appid -w", { encoding: "utf8" }).trim();
const token = execSync("security find-generic-password -s volc-tts-token -w", { encoding: "utf8" }).trim();
const ENDPOINT = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
// 脚本相对路径（脱敏：不写死本机绝对路径/用户名）
const DEST = fileURLToPath(new URL("../src/games/guandan/ui/voice-clips.ts", import.meta.url));

// owner 选定：vivi + B 档（快+开心）
const CONFIG = {
  speaker: "zh_female_vv_uranus_bigtts",
  audio_params: { format: "mp3", sample_rate: 24000, speech_rate: 25, loudness_rate: 20 },
  additions: JSON.stringify({ enable_emotion: true, emotion: "happy", emotion_scale: 5 }),
};

const RANKS = ["2","3","4","5","6","7","8","9","10","钩","圈","K","尖"];
const JOKERS = ["大王","小王"];
const single = [...RANKS, ...JOKERS];
const pair = single.map((r) => "对" + r);
const triple = RANKS.map((r) => "3条" + r);
const combos = ["三带二","顺子","同花顺","钢板","炸弹","天王炸"];
const lianpai = ["三连对"]; // 掼蛋连对固定 3 对(六张)，无四/五连对
const TEXTS = [...new Set([...single, ...pair, ...triple, ...combos, ...lianpai, "不要"])];

async function syn(text) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(ENDPOINT, { method: "POST", headers: {
      "X-Api-App-Id": appid, "X-Api-Access-Key": token, "X-Api-Resource-Id": "seed-tts-2.0",
      "X-Api-Connect-Id": "gen", "Content-Type": "application/json",
    }, body: JSON.stringify({ user: { uid: "gen" }, req_params: { ...CONFIG, text } }) });
    const t = Buffer.from(await r.arrayBuffer()).toString("utf8");
    let a = Buffer.alloc(0), code = null, msg = null;
    for (const ln of t.split("\n")) { if (!ln.trim()) continue;
      try { const j = JSON.parse(ln); code = j.code ?? code; if (j.message) msg = j.message; if (j.data) a = Buffer.concat([a, Buffer.from(j.data, "base64")]); } catch {} }
    if (a.length > 200) return a;
    console.error(`  retry "${text}" code=${code} ${msg || ""}`);
  }
  throw new Error("synth failed: " + text);
}

// --- ffmpeg 后处理：TTS 输出有随机停顿/拖音，按类型剪 ---
//  对X/单张 = GAP：高阈值狠剪"对"和点数之间的间隙、trim 首尾，不变速（owner 要"缩短对-X时间"）
//  3条X/牌型/三连对/不要 = TEMPO：剪缝 + atempo 按音节归一到统一语速；顺子读音短、单独放慢
const GAP_KEYS = new Set([...single, ...pair]);
const SYL = { "顺子": 2, "同花顺": 3, "三带二": 3, "钢板": 2, "炸弹": 2, "天王炸": 3, "三连对": 3, "不要": 2 };
const PER_SYL = 0.22;                  // 统一语速：每音节秒数（3条10 基准）
const SPECIAL_DUR = { "顺子": 0.87 };  // 顺子音节短，单独放慢
const GAP_FILTER = "silenceremove=start_periods=1:start_silence=0.004:start_threshold=-30dB:detection=peak,silenceremove=stop_periods=-1:stop_silence=0.003:stop_threshold=-30dB:detection=peak";
const SR_FILTER = "silenceremove=start_periods=1:start_silence=0.02:start_threshold=-44dB:detection=peak,silenceremove=stop_periods=-1:stop_silence=0.02:stop_threshold=-44dB:detection=peak";
const T = "/tmp/_genclip";
function ff(buf, filter) { writeFileSync(`${T}i.mp3`, buf); execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${T}i.mp3`, "-af", filter, `${T}o.mp3`]); return readFileSync(`${T}o.mp3`); }
function dur(buf) { writeFileSync(`${T}d.mp3`, buf); return parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", `${T}d.mp3`]).toString().trim()); }
function sylCount(k) { return k.startsWith("3条") ? 3 : SYL[k]; }
function postProcess(key, raw) {
  if (GAP_KEYS.has(key)) return ff(raw, GAP_FILTER);
  let b = ff(raw, SR_FILTER);
  const target = SPECIAL_DUR[key] ?? sylCount(key) * PER_SYL;
  let at = dur(b) / target; at = Math.max(0.5, Math.min(2, at));
  return ff(b, `atempo=${at.toFixed(3)}`);
}

const out = {};
for (const text of TEXTS) {
  const raw = await syn(text);
  const proc = postProcess(text, raw);
  out[text] = "data:audio/mpeg;base64," + proc.toString("base64");
  console.log(`✅ ${text}  ${raw.length}B → ${proc.length}B`);
}
const body = `// 掼蛋报牌语音 clip（豆包语音2.0 ${CONFIG.speaker} + ffmpeg 后处理）。脚本生成勿手改：scripts/gen-voice-clips.mjs\n// 后处理：对X/单张走 GAP(高阈值狠剪间隙)；3条X/牌型/三连对/不要走 TEMPO(剪缝+按音节归一速度，顺子单独放慢)。\n// key = 报牌文本（见 render.ts comboSpeech）。base64 内嵌，单文件离线可用。\nexport const VOICE_CLIPS: Record<string, string> = ${JSON.stringify(out)};\n`;
writeFileSync(DEST, body);
const totalKB = Math.round(Object.values(out).reduce((s, v) => s + v.length, 0) / 1024);
console.log(`\n写入 ${Object.keys(out).length} 条 → voice-clips.ts（约 ${totalKB}KB base64）`);
