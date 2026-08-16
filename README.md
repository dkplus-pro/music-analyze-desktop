# Music Analyze

本地音乐资料库与 AI 电影感分析后台。导入音频后，系统会临时保留文件以提取元数据、以内容哈希去重并完成分析；任务无论成功或失败都会自动清理音频副本，只保留结构化分析结果。

管理后台包括检索、结构化筛选、单文件或文件夹导入、导入会话 SSE 进度、异步批量分析、双列分析详情，以及人工主情绪覆盖。

## 启动音乐分析后台

```bash
pnpm install
cp .env.example .env
```

在 `.env` 中填入 `BAILIAN_API_KEY`。本地特征提取默认使用 `python3` 和已安装的 `librosa`；若 Python 路径不同，设置 `MUSIC_ANALYZER_PYTHON`。一条命令同时启动 API 与管理后台：

```bash
pnpm run dev:music
```

打开 <http://127.0.0.1:5173> 即为音乐分析管理后台；<http://127.0.0.1:8080> 是仓库保留的 Modern.js 示例页，不是本项目后台。API 位于 <http://127.0.0.1:3001>。

后台通过 Vite 代理访问 API；不需要配置浏览器跨域。优先使用 `.env` 的 `BAILIAN_API_KEY`；若该变量未设置但本机 `bl auth status` 已登录，服务会改用 `bl omni` 上传临时音频并完成分析。两者都不可用时，分析任务会明确显示失败；配置完成后请重新导入该音乐。

要导出飞书多维表格，在本地 `.env` 设置 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET`。点击管理后台的“导出飞书”会创建音乐分析库并导出所有音乐业务字段；之后点击会增量同步。凭证不可提交到 Git，音频文件和临时本机路径不会导出。

支持的导入格式：MP3、WAV、FLAC、M4A、AAC、OGG。结构化运行数据会写入 `apps/node-service/data/`（或 `.env` 指定的位置）并已被 Git 忽略；音频工作文件默认位于系统临时目录，任务结束即删除。

## 接口概览

- `POST /api/import`：浏览器 multipart 音频上传；也保留 JSON `sourcePath` 导入，便于本地自动化。
- `POST /api/import-sessions`、`POST /api/import-sessions/:id/manifest`、`POST /api/import-sessions/:id/files/:clientId`：受管批量导入；`GET /api/import-jobs/:id/events` 提供 SSE 进度。
- `GET /api/music`：返回音轨、最新分析、有效主情绪和分析状态；支持 `search`、`primaryEmotion`、`status`、`narrative`、`cinematicStyle`、`minCinematicScore`、`minDialogueFriendly` 与 `trajectory`。
- `POST /api/music/:id/analyze`、`POST /api/music/batch-analyze` 与 `POST /api/analysis-jobs/:id/retry`：提交单首、批量或重试分析。上传会自动提交分析；由于源音频会在任务结束后删除，失败任务需重新导入后再分析。
- `GET /api/music/:id/audio` 与 `GET /api/music/:id/waveform` 在音频清理后返回 `410 Gone`；音乐详情保留结构化分析结果，不提供服务端试听。
- `GET /api/feishu/status` 和 `POST /api/feishu/export`：查看飞书连接状态并一键导出。仅填写 `FEISHU_APP_ID`、`FEISHU_APP_SECRET` 时，首次导出会创建包含完整音乐字段的新库并保存非敏感的库/表 ID；同时填写 `FEISHU_APP_TOKEN`、`FEISHU_TABLE_ID` 可连接既有库。未配置时后台会清楚显示为未连接且不会发起外部请求。

## GitHub Pages

- Demo URL template: [https://OWNER.github.io/REPOSITORY/](https://OWNER.github.io/REPOSITORY/)
- After creating your GitHub repository, replace `OWNER` and `REPOSITORY` with your real GitHub org/user and repo name.
- Enable **Settings → Pages → Build and deployment → Source: GitHub Actions**. The workflow in `.github/workflows/pages.yml` builds `apps/demo` and deploys `apps/demo/dist`.

## What's included

```text
apps/
  demo/                  Modern.js React hello-world app
packages/
  tsconfig/              Shared TypeScript presets
  eslint-config/         Shared ESLint flat config
  prettier-config/       Shared Prettier config
  commitlint-config/     Shared Commitlint config
scripts/
  ci.sh                  Full CI pipeline helper
  verify.sh              Fast local verification helper
  deploy-github-pages.sh Build and validate Pages artifact
.github/workflows/
  ci.yml                 Lint, typecheck, test, build
  pages.yml              GitHub Pages deployment
tests/
  jest/                  Repository and script unit tests
  playwright/            Demo app browser smoke test
```

## Requirements

- Node.js `>=20.19.5` (Node 22 LTS recommended; `.nvmrc` uses `lts/jod`)
- pnpm via Corepack (`packageManager` pins pnpm)

```bash
corepack enable
node --version
pnpm --version
```

## Install

```bash
pnpm install
```

## Start the demo app

```bash
pnpm dev
```

The Modern.js demo runs at <http://localhost:8080/> by default.

To run only the demo workspace:

```bash
pnpm --filter @monorepo-template/demo run dev
```

## Development commands

```bash
pnpm lint          # Turbo workspace lint + root ESLint
pnpm typecheck     # TypeScript checks across workspaces
pnpm test          # Jest + workspace tests + Playwright smoke test
pnpm build         # Build all buildable workspaces
pnpm format        # Check Prettier formatting
pnpm format:write  # Fix Prettier formatting
pnpm verify        # Fast local verification helper
pnpm ci            # CI helper: install + lint + typecheck + test + build
```

## Git hooks and commits

Husky is installed through the root `prepare` script.

- `pre-commit`: runs `lint-staged`
- `commit-msg`: runs Commitlint using the shared conventional commit config

Use conventional commit messages such as:

```bash
git commit -m "feat: add shared ui package"
```

## Tests

- Jest unit tests live in `tests/jest`.
- Playwright E2E tests live in `tests/playwright` and start the Modern.js demo automatically.
- The app also has a lightweight Node test under `apps/demo/tests`.

For a first Playwright run locally, install the Chromium browser:

```bash
pnpm exec playwright install chromium
pnpm run test:e2e
```

## GitHub Pages deployment

Local artifact build:

```bash
GITHUB_PAGES_BASE_PATH=/REPOSITORY pnpm run build:pages
```

This builds `apps/demo/dist` and verifies that `index.html` is at the artifact root. In GitHub Actions, `pages.yml` sets `GITHUB_PAGES_BASE_PATH` from the repository name and uploads `apps/demo/dist` with the official Pages artifact action.

## Adding more workspaces

- Add applications under `apps/*`.
- Add shared packages under `packages/*`.
- Add package-level scripts named `build`, `lint`, `typecheck`, and `test` so Turborepo can schedule them.
