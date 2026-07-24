// 生成干瞪眼报牌语音 clip（豆包语音2.0 vivi，B档：快+开心）+ ffmpeg 后处理 → base64 内嵌 voice-clips.ts。
// 照搬掼蛋 scripts/gen-voice-clips.mjs，只把词表换成干瞪眼牌型（单张点数/对X/顺子/连对/炸弹/王炸/不要）。
// 各游戏各自一份 voice-clips（不互相 import，守游戏模块独立约定）。
// 需要 ffmpeg/ffprobe（brew install ffmpeg）。凭证在钥匙串 volc-tts-appid / volc-tts-token。
import { execSync, execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const appid = execSync("security find-generic-password -s volc-tts-appid -w", { encoding: "utf8" }).trim();
const token = execSync("security find-generic-password -s volc-tts-token -w", { encoding: "utf8" }).trim();
const ENDPOINT = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
// 脚本相对路径（脱敏：不写死本机绝对路径/用户名）
const DEST = fileURLToPath(new URL("../src/games/gandengyan/ui/voice-clips.ts", import.meta.url));

// 沿用掼蛋：vivi + B 档（快+开心），跟掼蛋一致体验
const CONFIG = {
  speaker: "zh_female_vv_uranus_bigtts",
  audio_params: { format: "mp3", sample_rate: 24000, speech_rate: 25, loudness_rate: 20 },
  additions: JSON.stringify({ enable_emotion: true, emotion: "happy", emotion_scale: 5 }),
};

// 干瞪眼报牌点数：3..10 自然点数、J/Q/A 用黑话「钩/圈/尖」、K 读 K、2 读「2」（owner 拍板：钩圈K尖，同掼蛋）
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "钩", "圈", "K", "尖"];
const single = [...RANKS];                       // 单张各点数（王当替身按替成的点数报，故无「大王/小王」单张）
const pair = single.map((r) => "对" + r);        // 对子
const combos = ["顺子", "连对", "炸弹", "王炸"];  // 干瞪眼连对是变长的，统一报「连对」；王炸=双王
const TEXTS = [...new Set([...single, ...pair, ...combos, "不要"])];

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

// --- ffmpeg 后处理（同掼蛋）：TTS 输出有随机停顿/拖音，按类型剪 ---
//  对X/单张 = GAP：高阈值狠剪"对"和点数之间的间隙、trim 首尾，不变速
//  顺子/连对/炸弹/王炸/不要 = TEMPO：剪缝 + atempo 按音节归一到统一语速；顺子读音短、单独放慢
const GAP_KEYS = new Set([...single, ...pair]);
const SYL = { "顺子": 2, "连对": 2, "炸弹": 2, "王炸": 2, "不要": 2 };
const PER_SYL = 0.22;                   // 统一语速：每音节秒数
const SPECIAL_DUR = { "顺子": 0.87 };   // 顺子音节短，单独放慢（同掼蛋）
const GAP_FILTER = "silenceremove=start_periods=1:start_silence=0.004:start_threshold=-30dB:detection=peak,silenceremove=stop_periods=-1:stop_silence=0.003:stop_threshold=-30dB:detection=peak";
const SR_FILTER = "silenceremove=start_periods=1:start_silence=0.02:start_threshold=-44dB:detection=peak,silenceremove=stop_periods=-1:stop_silence=0.02:stop_threshold=-44dB:detection=peak";
// 逐条微调（owner 试听后定）：单 K 读音太散 → 额外 atempo 收紧到 ~0.26s；「不要」TTS 出来偏轻、K 收紧后也偏闷 → 补音量到跟其它牌齐平
const COMPACT = { "K": 1.22 };            // 额外提速(atempo，不变调)收紧时长
const POST_GAIN = { "不要": 10, "K": 6 }; // 额外音量(dB)：不要 +10、紧凑K +6，向参考 mean(≈-22dB)看齐
const T = "/tmp/_genclip_gdy";
function ff(buf, filter) { writeFileSync(`${T}i.mp3`, buf); execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${T}i.mp3`, "-af", filter, `${T}o.mp3`]); return readFileSync(`${T}o.mp3`); }
function dur(buf) { writeFileSync(`${T}d.mp3`, buf); return parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", `${T}d.mp3`]).toString().trim()); }
function postProcess(key, raw) {
  let b;
  if (GAP_KEYS.has(key)) { b = ff(raw, GAP_FILTER); }               // 对X/单张：狠剪间隙不变速
  else {                                                            // 牌型/不要：剪缝 + 按音节归一语速
    b = ff(raw, SR_FILTER);
    const target = SPECIAL_DUR[key] ?? (SYL[key] ?? 2) * PER_SYL;
    let at = dur(b) / target; at = Math.max(0.5, Math.min(2, at));
    b = ff(b, `atempo=${at.toFixed(3)}`);
  }
  if (COMPACT[key]) b = ff(b, `atempo=${COMPACT[key]}`);            // 逐条收紧
  if (POST_GAIN[key]) b = ff(b, `volume=${POST_GAIN[key]}dB`);      // 逐条补音量
  return b;
}

const out = {};
for (const text of TEXTS) {
  const raw = await syn(text);
  const proc = postProcess(text, raw);
  out[text] = "data:audio/mpeg;base64," + proc.toString("base64");
  console.log(`✅ ${text}  ${raw.length}B → ${proc.length}B`);
}
const body = `// 干瞪眼报牌语音 clip（豆包语音2.0 ${CONFIG.speaker} + ffmpeg 后处理）。脚本生成勿手改：scripts/gen-gandengyan-voice.mjs\n// 后处理：对X/单张走 GAP(高阈值狠剪间隙)；顺子/连对/炸弹/王炸/不要走 TEMPO(剪缝+按音节归一速度，顺子单独放慢)。\n// key = 报牌文本（见 table.ts comboSpeech）。base64 内嵌，单文件离线可用。各游戏各自一份，不 import 掼蛋。\nexport const VOICE_CLIPS: Record<string, string> = ${JSON.stringify(out)};\n`;
writeFileSync(DEST, body);
const totalKB = Math.round(Object.values(out).reduce((s, v) => s + v.length, 0) / 1024);
console.log(`\n写入 ${Object.keys(out).length} 条 → voice-clips.ts（约 ${totalKB}KB base64）`);
