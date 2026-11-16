# Suck Utilities

S.U.C.K（StarCraft Ultra Chicken King）水友赛的一整套工具：赛事前端与 API。

- `apps/web` — SvelteKit SPA（Svelte 5、Tailwind CSS v4、shadcn-svelte）
- `apps/api` — Fastify 5 + PostgreSQL（schema `axsuck`），SSE 实时推送、Swagger、可选 Python 录像解析

## 环境要求

- Node.js 20+（推荐 22）
- pnpm（仓库通过 `packageManager` 固定版本）
- PostgreSQL 14+
- 只有录像解析功能需要 Python 3 + `sc2reader` / `spawningtool`

## 快速开始

```bash
pnpm install

# 配置 API（数据库、端口、Web Push）
cp apps/api/.env.example apps/api/.env
# 编辑 DATABASE_URL 等

# 建表 / 升级
pnpm migrate

# 同时启动 API (:3100) 和前端 (:5175)
pnpm dev
```

前端开发服务器把 `/api` 代理到 `http://127.0.0.1:3100`，Swagger 文档在 `http://localhost:3100/docs`。

## 常用命令

| 命令 | 作用 |
|------|------|
| `pnpm dev` / `pnpm dev:suck` | API + Web 并行开发 |
| `pnpm dev:api` / `pnpm dev:web` | 单独启动 |
| `pnpm migrate` | 运行 PostgreSQL 迁移 |
| `pnpm build:web` | 构建静态前端到 `apps/web/build` |
| `pnpm test` | Web + API 的单元测试（无需数据库） |

## 部署

1. `pnpm build:web` 生成 `apps/web/build`；
2. API 默认会从 `../web/build` 提供静态文件，也可以用 `STATIC_DIR` 指定目录；
3. 生产环境用 PM2 / systemd 之类的进程管理器运行 `node apps/api/app.js`。

录像解析需要服务器装好 `python3`、`sc2reader`、`spawningtool`，否则相关接口会返回友好错误，其余功能不受影响。

## 配置

- `apps/api/.env.example` — 端口、`DATABASE_URL`、QQ 群白名单、Web Push（VAPID）密钥
- 仓库里没有任何真实凭证；`apps/api/.env` 已被 gitignore

## 与 monorepo 的关系

本仓库是 Wayne-Monorepo 的公开镜像：`apps/api` / `apps/web` 分别对应 monorepo 的
`apps/suck-tournament-api` / `apps/suck-tournament-web`（含 OBS overlay / 直播绑定、best-of、时区换算等）。
改动以 monorepo 为准，此处通过同步提交更新；`BACKLOG.md` 也以 monorepo 文档为准。

## 历史

早期的 SQLite 版本和完整的提交记录见 [HISTORY.md](./HISTORY.md)。公开仓库的历史已在 2026-10 重写，移除了真实录像、玩家 Battle.net 链接和凭证。
