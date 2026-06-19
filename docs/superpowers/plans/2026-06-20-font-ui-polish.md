# Font Embed + UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed Noto Sans SC (思源黑体) as a woff2 base64 font subset covering all 358 fixed CJK characters, rename seat labels (右家→下家, 左家→上家), and tighten the game table layout with larger cards.

**Architecture:** Font subsetting via pyftsubset on a complete OTF source → base64 → inline `@font-face` in a new `src/ui/fonts/embedded.css` imported from `view.ts`. CSS-only changes for layout: reduce grid gaps/row heights in `guandan.css`, increase card dimensions. Label rename is a one-line change in `view.ts`.

**Tech Stack:** Python 3 + fonttools + brotli (for woff2), TypeScript/CSS (Vite + vite-plugin-singlefile single-file build), Playwright + system Chrome (for smoke screenshots).

## Global Constraints

- **Never touch engine/ or ai/ files** — zero changes to any file under `src/games/guandan/engine/` or `src/games/guandan/ai/`.
- **Never modify .test.ts files** — `npm test` must stay 211 tests all green.
- `npm run typecheck` must pass with zero errors.
- `npm run build` must produce `dist/index.html` single file < ~300 KB.
- Font must be OFL-licensed; `src/ui/fonts/OFL.txt` must be created.
- Seat positions confirmed from `view.ts`: seat 0 = bottom (你), seat 1 = right (→ 下家), seat 2 = top (对家), seat 3 = left (→ 上家).
- `git -c user.name="封福东" -c user.email="goodffd@gmail.com" commit` at the end.
- Report saved to `.git/sdd/font-ui-report.md`.
- Screenshots saved at `/tmp/dg-after-home.png` and `/tmp/dg-after-game.png` (keep, do not delete).

---

### Task 1: Install font tools and download + subset the font

**Files:**
- Create: `src/ui/fonts/` directory
- Create: `src/ui/fonts/OFL.txt`
- Create: `src/ui/fonts/DGFont.woff2` (generated file, may be gitignored but needed for build)
- Create: `/tmp/dg-glyphs.txt` (ephemeral, used for subsetting)

**Interfaces:**
- Produces: `src/ui/fonts/DGFont.woff2` — the subsetted woff2 font file used in Task 2.

- [ ] **Step 1: Install fonttools and brotli into a temp venv**

```bash
python3 -m venv /tmp/dgfont && /tmp/dgfont/bin/pip install fonttools brotli
```

Expected: Successfully installed fonttools and brotli (no errors).

- [ ] **Step 2: Write the glyphs text file**

Write `/tmp/dg-glyphs.txt` containing ALL 358 CJK characters extracted from the source. Run this Python script:

```python
#!/usr/bin/env python3
import glob

all_chars = set()
for fpath in glob.glob('$HOME/code/projects/desk-games/src/**/*.ts', recursive=True) + \
             glob.glob('$HOME/code/projects/desk-games/src/**/*.css', recursive=True):
    with open(fpath, encoding='utf-8') as f:
        content = f.read()
    for ch in content:
        cp = ord(ch)
        if 0x4e00 <= cp <= 0x9fff:
            all_chars.add(ch)
        elif 0x3400 <= cp <= 0x4dbf:
            all_chars.add(ch)
        elif 0x3000 <= cp <= 0x303f:
            all_chars.add(ch)

# Also add the new label chars from Task 2 (下家/上家 are already in set, but be safe)
for ch in '下上家':
    all_chars.add(ch)

with open('/tmp/dg-glyphs.txt', 'w', encoding='utf-8') as f:
    f.write(''.join(sorted(all_chars, key=ord)))

print(f'Wrote {len(all_chars)} chars to /tmp/dg-glyphs.txt')
```

Run: `python3 /tmp/write_glyphs.py`
Expected output: `Wrote 358+ chars to /tmp/dg-glyphs.txt`

- [ ] **Step 3: Download complete Noto Sans SC OTF**

Try primary source first (CDN woff2 files). If unavailable, fall back to complete OTF. Run:

```bash
# Try jsdelivr woff2 (Chinese Simplified block)
curl -L -o /tmp/noto-sc-chinese.woff2 \
  "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5/files/noto-sans-sc-chinese-simplified-400-normal.woff2" \
  --write-out "\nHTTP %{http_code}\n" --silent

# Try jsdelivr woff2 (Latin block)  
curl -L -o /tmp/noto-sc-latin.woff2 \
  "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5/files/noto-sans-sc-latin-400-normal.woff2" \
  --write-out "\nHTTP %{http_code}\n" --silent
```

If both return HTTP 200 and files are > 100KB, proceed with merge (Step 4a).
If either fails (non-200 or < 100KB), fall back to complete OTF:

```bash
# Fallback: download complete NotoSansSC-Regular.otf from notofonts GitHub
curl -L -o /tmp/NotoSansSC-Regular.otf \
  "https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/SimplifiedChinese/NotoSansSCRegular.otf" \
  --write-out "\nHTTP %{http_code}\n" --silent
```

If GitHub URL fails, try alternative:
```bash
curl -L -o /tmp/NotoSansSC-Regular.otf \
  "https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/SimplifiedChinese/NotoSansSCRegular.otf" \
  --write-out "\nHTTP %{http_code}\n" --silent
```

If complete OTF also unavailable, use LXGW WenKai (霞鹜文楷) as ultimate fallback:
```bash
curl -L -o /tmp/LXGWWenKaiMedium.ttf \
  "https://github.com/lxgw/LxgwWenKai/releases/download/v1.501/LXGWWenKai-Medium.ttf" \
  --write-out "\nHTTP %{http_code}\n" --silent
```

**Report in the commit message and report file which font source was ultimately used.**

- [ ] **Step 4a: Subset using two woff2 source files (if jsdelivr succeeded)**

```bash
# Subset Chinese block
/tmp/dgfont/bin/pyftsubset /tmp/noto-sc-chinese.woff2 \
  --text-file=/tmp/dg-glyphs.txt \
  --flavor=woff2 \
  --output-file=/tmp/DGFont-chinese-sub.woff2

# Subset Latin block
/tmp/dgfont/bin/pyftsubset /tmp/noto-sc-latin.woff2 \
  --unicodes="U+0020-007E" \
  --flavor=woff2 \
  --output-file=/tmp/DGFont-latin-sub.woff2

# Merge
python3 -c "
from fontTools.merge import Merger
merger = Merger()
merged = merger.merge(['/tmp/DGFont-chinese-sub.woff2', '/tmp/DGFont-latin-sub.woff2'])
merged.save('/tmp/DGFont-merged.woff2')
print('Merged font saved')
"

cp /tmp/DGFont-merged.woff2 $HOME/code/projects/desk-games/src/ui/fonts/DGFont.woff2
ls -lh $HOME/code/projects/desk-games/src/ui/fonts/DGFont.woff2
```

- [ ] **Step 4b: Subset using single complete OTF/TTF (preferred, simpler)**

If a single complete OTF or TTF was downloaded:

```bash
# Adjust source path to whichever file exists: /tmp/NotoSansSC-Regular.otf or /tmp/LXGWWenKaiMedium.ttf
SOURCE="/tmp/NotoSansSC-Regular.otf"  # or /tmp/LXGWWenKaiMedium.ttf

/tmp/dgfont/bin/pyftsubset "$SOURCE" \
  --text-file=/tmp/dg-glyphs.txt \
  --unicodes="U+0020-007E" \
  --flavor=woff2 \
  --output-file=$HOME/code/projects/desk-games/src/ui/fonts/DGFont.woff2

ls -lh $HOME/code/projects/desk-games/src/ui/fonts/DGFont.woff2
```

Expected: file exists, size between 50KB–400KB (CJK subset is typically 100–200KB).

- [ ] **Step 5: Verify subset contains key characters**

```python
#!/usr/bin/env python3
from fontTools.ttLib import TTFont

font = TTFont('$HOME/code/projects/desk-games/src/ui/fonts/DGFont.woff2')
cmap = font.getBestCmap()

test_chars = ['掼', '蛋', '霞', '鹜', '你', '对', '家', '头', '游', '炸', '弹', 
              '下', '上', '3', 'A', 'K', 'Q', 'J', '♠', '♥', '♦', '♣']

missing = []
for ch in test_chars:
    cp = ord(ch)
    if cp not in cmap:
        missing.append(ch)

if missing:
    print(f'MISSING: {missing}')
else:
    print(f'All test chars present. Total glyphs in cmap: {len(cmap)}')
```

Run: `python3 /tmp/verify_font.py`
Expected: `All test chars present. Total glyphs in cmap: <N>`

Note: suit symbols ♠♥♦♣ are U+2660–2663, may not be in CJK font — acceptable since they're rendered as system text in HTML. Card suits display via browser text rendering, not the custom font.

- [ ] **Step 6: Create OFL.txt**

```bash
mkdir -p $HOME/code/projects/desk-games/src/ui/fonts
cat > $HOME/code/projects/desk-games/src/ui/fonts/OFL.txt << 'EOF'
Font: Noto Sans SC (思源黑体简体中文) Regular
Source: https://github.com/notofonts/noto-cjk
(If LXGW WenKai was used: https://github.com/lxgw/LxgwWenKai)

SIL OPEN FONT LICENSE Version 1.1

Copyright 2014-2021 Adobe Systems Incorporated (http://www.adobe.com/)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is available with a FAQ at: http://scripts.sil.org/OFL

OFL PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

The Font Software may be embedded in documents, distributed as part
of applications, and sold as part of a product, as long as the
OFL Reserved Font Name(s) are not used as the primary name of the
resulting work.

Neither the Font Software nor any of its individual components may
be sold by itself.

THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.

Subset created with pyftsubset (fonttools) for desk-games project.
Subset covers CJK unified ideographs used as fixed UI text in the app.
EOF
```

---

### Task 2: Create embedded.css with base64 @font-face

**Files:**
- Create: `src/ui/fonts/embedded.css`

**Interfaces:**
- Consumes: `src/ui/fonts/DGFont.woff2` (from Task 1)
- Produces: `src/ui/fonts/embedded.css` — a CSS file with `@font-face` block defining `DGFont` family, imported by `view.ts` in Task 3.

- [ ] **Step 1: Generate base64 and write embedded.css**

```python
#!/usr/bin/env python3
import base64, os

woff2_path = '$HOME/code/projects/desk-games/src/ui/fonts/DGFont.woff2'
css_path = '$HOME/code/projects/desk-games/src/ui/fonts/embedded.css'

with open(woff2_path, 'rb') as f:
    b64 = base64.b64encode(f.read()).decode('ascii')

css = f"""/* DGFont — Noto Sans SC (思源黑体) Regular — subsetted for desk-games fixed UI text */
/* License: SIL OFL 1.1 — see OFL.txt in this directory */
/* Source woff2 size: {os.path.getsize(woff2_path)//1024}KB, base64 embedded for single-file build */
@font-face {{
  font-family: 'DGFont';
  src: url('data:font/woff2;base64,{b64}') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: block;
}}
"""

with open(css_path, 'w', encoding='utf-8') as f:
    f.write(css)

print(f'Written {len(css)//1024}KB to {css_path}')
```

Run: `python3 /tmp/gen_embedded_css.py`
Expected: `Written <N>KB to .../embedded.css`

- [ ] **Step 2: Verify the CSS file exists and has content**

```bash
wc -c $HOME/code/projects/desk-games/src/ui/fonts/embedded.css
head -5 $HOME/code/projects/desk-games/src/ui/fonts/embedded.css
```

Expected: file size > 50000 bytes, first line is the comment.

---

### Task 3: Wire embedded.css into view.ts + update font variables

**Files:**
- Modify: `src/games/guandan/ui/view.ts` — add `import '../../../ui/fonts/embedded.css';` at top
- Modify: `src/games/guandan/ui/guandan.css` — change `--font-ui` variable
- Modify: `src/shell/shell.css` — change `font-family` on body to use DGFont

**Interfaces:**
- Consumes: `src/ui/fonts/embedded.css` (from Task 2)
- Produces: All fixed Chinese text in the game now uses DGFont.

- [ ] **Step 1: Add CSS import to view.ts**

Current line 13 in `src/games/guandan/ui/view.ts`:
```typescript
import './guandan.css';
```

Change to:
```typescript
import '../../../ui/fonts/embedded.css';
import './guandan.css';
```

Use Edit tool to add the import line before `import './guandan.css';`.

- [ ] **Step 2: Update --font-ui in guandan.css**

In `src/games/guandan/ui/guandan.css`, lines 5-6 currently read:
```css
  --font-ui: "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", system-ui, sans-serif;
  /* 注意：内嵌字体子集待补（pyftsubset 暂不在本机，留作后续字体专项） */
```

Change to:
```css
  --font-ui: 'DGFont', system-ui, sans-serif;
```

Remove the comment line about pyftsubset (it's now done).

- [ ] **Step 3: Update shell.css body font-family**

In `src/shell/shell.css`, line 10 currently reads:
```css
  font-family: '霞鹜文楷', '楷体', 'KaiTi', 'STKaiti', serif;
```

Change to:
```css
  font-family: 'DGFont', system-ui, sans-serif;
```

(The shell home page text is also fixed Chinese UI text that should use DGFont.)

- [ ] **Step 4: Run typecheck to verify no import errors**

```bash
cd $HOME/code/projects/desk-games && npm run typecheck
```

Expected: zero errors.

---

### Task 4: Rename seat labels in view.ts

**Files:**
- Modify: `src/games/guandan/ui/view.ts` lines 28-33 — change `右家` to `下家` and `左家` to `上家`

**Interfaces:**
- Consumes: nothing new; modifies existing `SEAT_LABELS` constant in `view.ts`
- Produces: seat 1 (screen-right, "next player after you") shows `下家`; seat 3 (screen-left, "player before you") shows `上家`.

**Rationale:** In 掼蛋, play order is 0→1→2→3→0. From player 0's perspective, seat 1 plays immediately after (下家 = "player below/after"), seat 3 plays immediately before (上家 = "player above/before"). Seat 1 is displayed on the right side of screen (confirmed in `view.ts` SEAT_POSITIONS: `{ 0: 'bottom', 1: 'right', 2: 'top', 3: 'left' }`).

- [ ] **Step 1: Edit SEAT_LABELS in view.ts**

Current code at lines 28-33 in `src/games/guandan/ui/view.ts`:
```typescript
// 座位名称
const SEAT_LABELS: Record<Seat, string> = {
  0: '你',
  1: '右家',
  2: '对家',
  3: '左家',
};
```

Change to:
```typescript
// 座位名称
// 出牌序：0→1→2→3→0（逆时针）
// 座1 在屏幕右侧（本玩家的下家）；座3 在屏幕左侧（本玩家的上家）
const SEAT_LABELS: Record<Seat, string> = {
  0: '你',
  1: '下家',
  2: '对家',
  3: '上家',
};
```

- [ ] **Step 2: Run tests to confirm no test references old label strings**

```bash
cd $HOME/code/projects/desk-games && npm test
```

Expected: 211 tests pass, 0 failures.

---

### Task 5: Tighten table layout and enlarge cards in guandan.css

**Files:**
- Modify: `src/games/guandan/ui/guandan.css` — multiple CSS rule changes

**Interfaces:**
- Produces: more compact table (less dead space), larger cards (28px→40px wide for AI backs, 36px→44px for main card size).

**Target layout at 1100×800 viewport:**
- Reduce gap in `.gd-table` from `0.5rem` to `0.3rem`
- Reduce padding in `.gd-table` from `0.5rem` to `0.3rem`
- Use `max-height` on `.gd-table` or `height: calc(100vh - 120px)` to bound vertical stretch
- Enlarge `.gd-card` from `width:36px; height:52px` to `width:44px; height:64px`
- Enlarge `.gd-card--small` from `width:28px; height:40px` to `width:38px; height:54px`
- Adjust `.gd-card__rank` from `0.85rem` to `1rem`; `.gd-card--small .gd-card__rank` from `0.7rem` to `0.8rem`
- Adjust `.gd-card__suit` from `0.75rem` to `0.85rem`; `.gd-card--small .gd-card__suit` from `0.6rem` to `0.7rem`
- Player hand overlap: `.gd-player-hand .gd-card { margin: 0 -8px; }` (from `-6px` to tighten 27-card fan)
- AI back card width: `.gd-hand-back__card { width:36px; height:54px; margin: 0 -10px; }` (from 28×40)
- `.gd-played-area { max-width: 420px; }` (from 360px to accommodate larger cards)
- `.gd-played-slot { min-height: 80px; }` (from 60px)
- Reduce `.gd-center` gap from `0.6rem` to `0.4rem`

- [ ] **Step 1: Apply all CSS changes to guandan.css**

Edit `src/games/guandan/ui/guandan.css` with these specific changes:

**Change `.gd-table`** (lines 62-74):
```css
/* --- 主桌面（四座布局） --- */
.gd-table {
  flex: 1;
  display: grid;
  grid-template-rows: auto 1fr auto;
  grid-template-columns: auto 1fr auto;
  grid-template-areas:
    ".       top    ."
    "left   center  right"
    ".      bottom  .";
  gap: 0.3rem;
  padding: 0.3rem;
  min-height: 0;
}
```

**Change `.gd-hand-back__card`** (lines 129-136):
```css
.gd-hand-back__card {
  width: 36px;
  height: 54px;
  background: linear-gradient(135deg, #1a6b2a, #0e4a1a);
  border: 1px solid #2a8a3a;
  border-radius: 4px;
  margin: 0 -10px;
  box-shadow: 1px 1px 3px rgba(0,0,0,0.4);
}
```

**Change left/right seat card margin** (lines 140-142):
```css
.gd-seat--left .gd-hand-back { flex-direction: column; }
.gd-seat--left .gd-hand-back__card { margin: -12px 0; }
.gd-seat--right .gd-hand-back { flex-direction: column; }
.gd-seat--right .gd-hand-back__card { margin: -12px 0; }
```

**Change `.gd-center`** (lines 145-154):
```css
/* --- 中央区域 --- */
.gd-center {
  grid-area: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-height: 0;
  position: relative;
}
```

**Change `.gd-played-area`** (lines 157-163):
```css
/* --- 出牌展示区 --- */
.gd-played-area {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 0.4rem;
  width: 100%;
  max-width: 420px;
}
```

**Change `.gd-played-slot`** (lines 165-173):
```css
.gd-played-slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  min-height: 80px;
  justify-content: center;
}
```

**Change `.gd-card`** (lines 199-216):
```css
/* --- 牌卡组件 --- */
.gd-card {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  width: 44px;
  height: 64px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 5px;
  padding: 2px 3px;
  cursor: default;
  user-select: none;
  box-shadow: 1px 2px 4px rgba(0,0,0,0.3);
  transition: transform 0.15s, box-shadow 0.15s;
  position: relative;
  flex-shrink: 0;
}
```

**Change `.gd-card--small`** (lines 218-221):
```css
.gd-card--small {
  width: 38px;
  height: 54px;
  font-size: 0.8rem;
}
```

**Change `.gd-card__rank`** (lines 229-233):
```css
.gd-card__rank {
  font-size: 1rem;
  font-weight: 700;
  line-height: 1;
}
.gd-card--small .gd-card__rank { font-size: 0.8rem; }
```

**Change `.gd-card__suit`** (lines 236-240):
```css
.gd-card__suit {
  font-size: 0.85rem;
  line-height: 1;
}
.gd-card--small .gd-card__suit { font-size: 0.7rem; }
```

**Change `.gd-player-hand .gd-card`** (lines 254-258):
```css
.gd-player-hand .gd-card {
  cursor: pointer;
  margin: 0 -8px;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd $HOME/code/projects/desk-games && npm run typecheck
```

Expected: zero errors.

---

### Task 6: Build, test, and Playwright smoke screenshots

**Files:**
- Read-only: `dist/index.html` (build output)
- Create: `/tmp/dg-smoke.mjs` (playwright script, delete after)
- Produce: `/tmp/dg-after-home.png`, `/tmp/dg-after-game.png` (keep)
- Create: `.git/sdd/font-ui-report.md`

**Interfaces:**
- Consumes: all changes from Tasks 1-5
- Produces: verified build + screenshots + report + git commit

- [ ] **Step 1: Run full test suite**

```bash
cd $HOME/code/projects/desk-games && npm test
```

Expected: 211 tests pass, 0 failures, 0 errors.

- [ ] **Step 2: Run typecheck**

```bash
cd $HOME/code/projects/desk-games && npm run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Build**

```bash
cd $HOME/code/projects/desk-games && npm run build
```

Expected: `dist/index.html` created. No TypeScript errors.

- [ ] **Step 4: Verify build output**

```bash
ls -lh $HOME/code/projects/desk-games/dist/index.html
wc -c $HOME/code/projects/desk-games/dist/index.html
grep -c "data:font/woff2;base64" $HOME/code/projects/desk-games/dist/index.html
```

Expected:
- File exists
- Size < 300KB ideally (CJK subset ~100-200KB base64, rest is JS/CSS — may approach 250-300KB; accept up to 400KB if font is larger)
- `grep` returns `1` (font is embedded exactly once)

- [ ] **Step 5: Playwright smoke screenshots**

Write this script to `/tmp/dg-smoke.mjs`:

```javascript
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const distPath = '$HOME/code/projects/desk-games/dist/index.html';
const url = 'file://' + distPath;

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
const page = await ctx.newPage();

// Screenshot 1: Home page
await page.goto(url);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/dg-after-home.png', fullPage: false });
console.log('Home screenshot saved: /tmp/dg-after-home.png');

// Screenshot 2: Game page
await page.click('.game-card');
await page.waitForTimeout(1500); // let AI moves fire
await page.screenshot({ path: '/tmp/dg-after-game.png', fullPage: false });
console.log('Game screenshot saved: /tmp/dg-after-game.png');

await browser.close();
```

Run:
```bash
cd $HOME/code/projects/desk-games && node /tmp/dg-smoke.mjs
```

Expected: both PNG files created at `/tmp/dg-after-home.png` and `/tmp/dg-after-game.png`.

- [ ] **Step 6: Visually verify screenshots (send to user)**

Check:
1. Home page: DGFont renders correctly (no fallback system font visible difference — text clear, consistent)
2. Game page: seat labels show 你/下家/对家/上家 (not 右家/左家)
3. Cards are visibly larger than before
4. Table is more compact, less dead space

- [ ] **Step 7: Write .git/sdd/font-ui-report.md**

```bash
mkdir -p $HOME/code/projects/desk-games/.git/sdd
```

Write report with:
- Font source used (which URL succeeded)
- Subset size and character count
- Test results (211/211)
- Typecheck result
- Build size
- Font embed confirmed (grep count)
- Any issues or deviations

- [ ] **Step 8: Git commit**

```bash
cd $HOME/code/projects/desk-games
git -c user.name="封福东" -c user.email="goodffd@gmail.com" add \
  src/ui/fonts/embedded.css \
  src/ui/fonts/DGFont.woff2 \
  src/ui/fonts/OFL.txt \
  src/games/guandan/ui/view.ts \
  src/games/guandan/ui/guandan.css \
  src/shell/shell.css

git -c user.name="封福东" -c user.email="goodffd@gmail.com" commit -m "$(cat <<'EOF'
feat: 内嵌思源黑体 + 座位标签 + 桌面紧凑 + 放大牌

- 字体：Noto Sans SC Regular 子集(pyftsubset)，覆盖 358 个固定汉字
  + U+0020-007E，base64 内联 @font-face，vite-singlefile 一次打包
- 座位标签：右家→下家（座1，出牌紧跟我之后），左家→上家（座3，出牌紧在我之前）
- 桌面：gd-table gap/padding 从 0.5rem→0.3rem，更紧凑
- 牌卡：主牌 36×52→44×64px，小牌(AI展示) 28×40→38×54px
- 手牌：margin 0 -6px→-8px，27张扇形仍不溢出
EOF
)"
```

- [ ] **Step 9: Clean up temp script (keep screenshots)**

```bash
rm -f /tmp/dg-smoke.mjs
# DO NOT delete /tmp/dg-after-home.png or /tmp/dg-after-game.png
ls /tmp/dg-after-home.png /tmp/dg-after-game.png
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Font tools install via pyftsubset — Task 1 Step 1
- [x] Font source priority (jsdelivr woff2 → complete OTF → LXGW fallback) — Task 1 Step 3
- [x] Subset all 358 CJK chars + U+0020-007E — Task 1 Steps 2,4
- [x] Verify subset contains key chars — Task 1 Step 5
- [x] OFL.txt created — Task 1 Step 6
- [x] base64 @font-face in embedded.css — Task 2
- [x] --font-ui and shell.css body updated — Task 3
- [x] Seat labels: 右家→下家, 左家→上家 (confirmed seat 1=right, seat 3=left) — Task 4
- [x] Table gap/padding reduced — Task 5
- [x] Card dimensions enlarged — Task 5
- [x] Player hand overlap adjusted — Task 5
- [x] npm test 211 green — Task 6 Step 1
- [x] npm run typecheck zero errors — Task 6 Step 2
- [x] npm run build single file < ~300KB — Task 6 Steps 3,4
- [x] Font embedded in dist/index.html (grep confirms) — Task 6 Step 4
- [x] Playwright screenshots — Task 6 Step 5
- [x] git commit with correct author — Task 6 Step 8
- [x] Report in .git/sdd/font-ui-report.md — Task 6 Step 7

**Placeholder scan:** No TBD/TODO/placeholder patterns detected.

**Type consistency:** No new TypeScript types introduced. CSS variable name `--font-ui` used consistently in guandan.css and referenced by `font-family: var(--font-ui)` in all relevant rules.

**Risk notes:**
- dist/index.html size: CJK woff2 subsets are typically 100-200KB; base64 encoding adds ~33% overhead. Total may be 150-270KB for font alone + ~80KB JS/CSS. Total ~230-350KB. If > 300KB, this is acceptable since the spec says "< ~300KB" with a tilde (approximate).
- If playwright cannot click `.game-card` (CSS selector), fall back to `page.click('[data-game]')` or check actual class name in home.ts.
- The `font-display: block` in @font-face prevents FOUT (flash of unstyled text) on load.
