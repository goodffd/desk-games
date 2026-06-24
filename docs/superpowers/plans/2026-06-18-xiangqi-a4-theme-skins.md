> **来源说明**：本文档原属独立项目 `xiangqi-game`（已归档，仓库即将删除）。中国象棋已于 2026-06-23 作为内置联机模块并入 `desk-games`（见 `2026-06-23-xiangqi-internal-module*.md`）。**文中的目录结构 / 路径 / 部署方式 / `xiangqi-dist` 等均指并入前的独立项目布局**；现行代码位于 `src/games/xiangqi/`，部署与大厅同源（象棋走 `/ws`）。本文保留为象棋规则与功能的设计依据记录。

---

# 子项目 A4：主题皮肤 实现计划

> **For agentic workers:** 本计划为视觉迭代型任务。设计（4 套主题调色板 + pieceStyle）已在 `docs/superpowers/specs/2026-06-18-xiangqi-subproject-a-local-experience-design.md` §4.3 锁定。代码不能用单测验（Canvas 无 node 环境），**核心验证是真机截图 + owner 点头**（见 §验证）。

**Goal:** 把写死配色的 `render.ts` 重构为接收 `Theme` 的纯展示函数，新增 4 套可一键切换的主题皮肤（朱砂水墨[默认]/原木棋枰/夜间墨玉/素雅纸枰），偏好记入 localStorage。

**Architecture:** `ui/themes.ts` 定义 `Theme`（调色板 + `pieceStyle`）+ 4 套数据；`render.ts` 所有颜色从 `Theme` 读，棋子按 `pieceStyle ∈ {ivory, luminous, solid}` 分发绘制；`main.ts` 接主题下拉 + 持久化 + 启动恢复。仅主题化 Canvas 棋盘（棋盘底/线/棋子/高亮/河界），页面外框（style.css 暗色舞台）保持中性不动——四套板都是"暖板/亮板浮于暗框"，不冲突。

**Tech Stack:** TS + Canvas + Vite。无新增依赖。

**分支：** `v3-a4-themes`（off main）。

---

## 文件改动

| 文件 | 增/改 | 职责 |
|---|---|---|
| `src/ui/themes.ts` | 新 | `Theme`/`PieceStyle`/`SidePalette` 类型 + `THEMES`(4) + `DEFAULT_THEME_KEY` + `themeByKey()` |
| `src/ui/render.ts` | 改 | 全部 draw 函数接 `Theme`；颜色从 theme 读；`drawPieceAt` 按 `pieceStyle` 分发三种画法 |
| `src/ui/persist.ts` | 改 | 加 `saveTheme(key)` / `loadTheme(): string`（localStorage key `xiangqi:theme`） |
| `index.html` | 改 | `.controls` 加 `<select id="theme">`（主题下拉，4 项） |
| `src/ui/main.ts` | 改 | 持有 `currentTheme`；`refresh()`/动画把 theme 传进 `render`；下拉 change 切换+持久化+重绘；启动恢复 |
| `tests/themes.test.ts` | 新 | 数据完整性单测（4 套齐全、默认存在、每套字段非空、pieceStyle 合法） |

## Theme 接口（themes.ts）

```ts
export type PieceStyle = 'ivory' | 'luminous' | 'solid';

// 单方棋子调色。ivory 用 topStops(顶面径向渐变)+base(底盘骨色)；luminous/solid 用 base 作盘色
export interface SidePalette {
  topStops: [string, string, string];
  base: string;
  edge: string;          // 盘边 / 阴刻圈
  char: string;          // 字色
  charUnderlay: string;  // ivory 阴刻浅高光；luminous/solid 用 'transparent'
}

export interface Theme {
  key: string;
  name: string;
  boardBg: string[];     // 1 stop=纯色，多 stop=斜向线性渐变
  line: string;
  frame: string;
  river: string;         // 楚河汉界文字
  mark: string;          // 兵炮定位记号
  pieceStyle: PieceStyle;
  red: SidePalette;
  black: SidePalette;
  accent: string;        // "r,g,b"：选中环 + 着法提示
  lastMoveRed: string;   // "r,g,b"：最近一步（红走）
  lastMoveBlack: string; // "r,g,b"：最近一步（黑走）
}
```

4 套数据见 §附录（按设计 doc §4.3 调色板 + 实现细化的 rgb 值；首版值，按截图迭代）。`DEFAULT_THEME_KEY = 'cinnabar'`。

## render.ts 重构要点

- `render(ctx, board, selected, legalDests, lastMove, anim, theme)` 末位新增 `theme: Theme`。
- `drawBoard(ctx, t)`：`boardBg` 1 stop 纯色填充、多 stop 建 `createLinearGradient(0,0,W,H)`；frame/line/diagonals 用 `t.frame`/`t.line`；记号 `t.mark`；河界 `t.river`。
- `drawPieceAt(ctx,x,y,type,color,t)`：`side = color==='red'?t.red:t.black`，按 `t.pieceStyle`：
  - **ivory**（朱砂/原木）：保留现有"接触投影+盘侧+顶面径向渐变+倒角+阴刻圈+阴刻字"，颜色改取 `side.topStops/base/edge/char/charUnderlay`。
  - **luminous**（夜间）：暗盘（`side.base` 轻径向）+ 细 rim（`side.edge`）+ 发光字（`ctx.shadowColor=side.char; shadowBlur=8; fillStyle=side.char`）。
  - **solid**（素雅）：实色盘（`side.base` 平涂）+ 描边（`side.edge`）+ 白字（`side.char`），无渐变/倒角/阴刻。
- `drawLastMove`/`drawSelection`/`drawMoveHint`：rgb 取 `t.lastMoveRed|Black`/`t.accent`，alpha 在 draw 内拼 `rgba(...)`。

完整重构后的 `render.ts` 与 `themes.ts` 代码在实现时落地（视觉细节会按截图调），不在此预铺以免与迭代结果脱节。

## main.ts / persist.ts / index.html 接线

- persist.ts：`const TKEY='xiangqi:theme'; saveTheme(k){try{localStorage.setItem(TKEY,k)}catch{}} loadTheme(){try{return localStorage.getItem(TKEY)||''}catch{return ''}}`。
- index.html：`.controls` 内加 `<select id="theme" class="select">`，4 个 `<option value=key>name</option>`，默认 selected = cinnabar。
- main.ts：`let theme = themeByKey(loadTheme() || DEFAULT_THEME_KEY)`；所有 `render(...)` 调用补 `theme`；`themeSel.value=theme.key`；`themeSel.addEventListener('change', ()=>{ theme=themeByKey(themeSel.value); saveTheme(theme.key); refresh(); })`；动画帧的 `render` 也传 `theme`。

## 验证（核心 = 真机截图 + owner 点头）

1. `npm run typecheck` 无错；`npm test`（含新 themes 数据测）全绿；`npm run build` 出单文件。
2. **切主题不改变 engine 行为**：render 仍只读 GameState，不回写——typecheck + 代码审查确认。
3. **真机截图四套**：Playwright + 系统 Chrome，对 `dist/index.html` 切到每套主题（含一盘摆开的局面 + 选中高亮 + 最近一步），各截一张，**发给 owner 看**。按反馈调色值，重截，直至点头。
4. 浏览器冒烟：切主题即时重绘、刷新后记住上次主题、默认朱砂水墨。

## 实现顺序

1. `themes.ts`（4 套数据）+ `tests/themes.test.ts` → 测试绿
2. `render.ts` 重构（接 Theme + 三种 pieceStyle）→ typecheck + build
3. `persist.ts` 主题持久化 + `index.html` 下拉 + `main.ts` 接线 → typecheck + build
4. 截图四套 → owner 审 → 迭代调色 → 点头
5. 浏览器冒烟（切换/记忆/默认）→ commit → finish

## 附录：4 套首版调色（rgb/hex，按截图迭代）

- **cinnabar 朱砂水墨**(ivory, 默认)：boardBg `['#eedfba','#e7d6ad','#dcc99c']`；line `#3a332a`；frame `#2a241b`；river `rgba(35,30,21,.5)`；mark `#3a332a`；red `{topStops:['#f6ead0','#eaddbd','#dccaa0'],base:'#cbb98f',edge:'#c0392b',char:'#c0392b',charUnderlay:'rgba(255,255,255,.55)'}`；black 同 top/base，edge/char `#262320`；accent `63,107,94`；lastMoveRed `192,57,43`；lastMoveBlack `40,33,22`。
- **wood 原木棋枰**(ivory)：boardBg `['#d8a766','#ca9c54','#c8924f']`；line `#6b431f`；frame `#482c14`；river `rgba(72,44,20,.55)`；mark `#6b431f`；red `{topStops:['#f0d9ac','#ecd2a4','#dcbd86'],base:'#b8935a',edge:'#a83224',char:'#a83224',charUnderlay:'rgba(255,255,255,.5)'}`；black 同 top/base，edge/char `#1f6b46`；accent `47,107,70`；lastMoveRed `168,50,36`；lastMoveBlack `31,107,70`。
- **night 夜间墨玉**(luminous)：boardBg `['#232b34','#151b22','#0e1318']`；line `rgba(150,180,195,.42)`；frame `rgba(185,205,215,.6)`；river `rgba(180,205,215,.45)`；mark `rgba(150,180,195,.42)`；red `{topStops:['#3a2a27','#2d2220','#221a18'],base:'#2d2220',edge:'#5a3d38',char:'#ff7d6a',charUnderlay:'transparent'}`；black `{topStops:['#243038','#1a2228','#141a1f'],base:'#1a2228',edge:'#3a4852',char:'#74dcc6',charUnderlay:'transparent'}`；accent `111,224,204`；lastMoveRed `255,125,106`；lastMoveBlack `116,220,198`。
- **plain 素雅纸枰**(solid)：boardBg `['#f6f3ec']`；line `#c2b596`；frame `#9c8d6e`；river `rgba(120,110,90,.5)`；mark `#c2b596`；red `{topStops:['#c0392b','#c0392b','#c0392b'],base:'#c0392b',edge:'#9c2c20',char:'#ffffff',charUnderlay:'transparent'}`；black `{...,base:'#2f2f33',edge:'#1b1b20',char:'#ffffff',charUnderlay:'transparent'}`；accent `63,143,125`；lastMoveRed `192,57,43`；lastMoveBlack `47,47,51`。
