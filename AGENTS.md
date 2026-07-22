# AGENTS.md

本项目支持双轨完整接管：

- Claude Code 轨：按 `CLAUDE.md` 维护整个项目。
- Codex 轨：按本文维护整个项目。

同一时间只能启用一条轨道。不要把同一项开发拆成一部分 Claude Code、一部分 Codex。

## 接管规则

- 开始工作前先运行 `git status --short`。
- Codex 接管时，不调用 Claude Code 协作 worker，不新增 `.claude-collab` 任务。
- Claude Code 接管时，Codex 只做只读检查或最终审查，除非用户明确切换到 Codex 轨。
- 切换轨道前必须提交、暂存或明确保留当前改动；不要在脏工作区切换。
- 不提交密钥、私有路径、临时构建产物或本机环境信息。

## 双轨交接约束

- 任意轨道完成代码、配置、脚本、测试或文档修改后，必须运行 `git status --short`。
- 如果存在未提交改动，必须提醒用户 commit、stash，或明确确认保留未提交状态。
- 未提交改动不得静默交给另一轨继续处理。
- 切换轨道前必须满足其一：已 commit、已 stash，或用户明确确认保留未提交改动。

## 验证命令

```bash
npm test          # 快轨：日常底线，秒级
npm run typecheck
npm run build
```

**动了引擎 / AI / 洗牌，还必须补跑慢轨**——快轨绿不代表模糊测试绿：

```bash
npm run test:slow   # *.slow.test.ts：模糊测试 + AI 对打基准，约 7 分半
```

慢轨局数可用 `FUZZ_GAMES` / `FUZZ_MATCHES` / `BENCH_GAMES` 调小做本地冒烟，但**调小后绿灯不作数**，不能当提交依据。详见 `CLAUDE.md`《测试分快慢两轨》。

涉及**联机、房间、重连**时，跑掼蛋联机冒烟（真浏览器 + 真 WebSocket，多 context 走建房/加入/开打/重连）：

```bash
npm run build && npm run build:server   # 冒烟需要构建产物
npm run smoke:guandan
```

其它 UI 流程改动仍需浏览器实测或 Playwright 截图验证。

## 项目边界

- `CLAUDE.md`、`SPEC.md`、`README.md`、`DEPLOY.md` 是项目事实面，不要删除。
- 棋类规则改动必须先读 `SPEC.md`，再改实现。
- 不做无关重构；每个改动都应能追溯到当前用户请求。
