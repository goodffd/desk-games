// 生成掼蛋报牌语音 clip（豆包2.0 vivi，B档：快+开心）→ base64 内嵌 src/games/guandan/ui/voice-clips.ts
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const appid = execSync("security find-generic-password -s volc-tts-appid -w", { encoding: "utf8" }).trim();
const token = execSync("security find-generic-password -s volc-tts-token -w", { encoding: "utf8" }).trim();
const ENDPOINT = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
const DEST = "$HOME/code/projects/desk-games/src/games/guandan/ui/voice-clips.ts";

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
const lianpai = ["三连对","四连对","五连对","六连对","七连对","八连对"];
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

const out = {};
for (const text of TEXTS) {
  const a = await syn(text);
  out[text] = "data:audio/mpeg;base64," + a.toString("base64");
  console.log(`✅ ${text}  ${a.length}B`);
}
const body = `// 掼蛋报牌语音 clip（豆包语音2.0 ${CONFIG.speaker}）。脚本生成勿手改：scripts/gen-voice-clips.mjs\n// key = 报牌文本（见 render.ts comboSpeech）。base64 内嵌，单文件离线可用。\nexport const VOICE_CLIPS: Record<string, string> = ${JSON.stringify(out)};\n`;
writeFileSync(DEST, body);
const totalKB = Math.round(Object.values(out).reduce((s, v) => s + v.length, 0) / 1024);
console.log(`\n写入 ${Object.keys(out).length} 条 → voice-clips.ts（约 ${totalKB}KB base64）`);
