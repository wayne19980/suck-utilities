# 待办 / 想法

更新时间：2026-11-16

本仓库是 Wayne-Monorepo 的公开镜像，代码与本文以 monorepo 的 `apps/suck-tournament-*` 和
`apps/web-vitedocs/docs/Fun/StarCraft2/suck-backlog.md` 为准；公开仓通过同步提交更新。

## 已完成（2026-11-16 与 monorepo 同步）

### 直播大屏与开播绑定（overlay / broadcast）

- 大屏抽成 `src/lib/components/TournamentOverlay.svelte`；`/tournament/:id/overlay` 变薄壳，新增
  `/overlay?user=<选手ID>`（OBS 固定地址，换赛事不用改地址）。
- `axsuck.broadcasts`（迁移 `008`）：一人一行，开播/换赛事/结束都写这一行；写操作使用无状态
  HS256 stream key（secret 首次启动自动生成并存 `axsuck.app_secrets`（迁移 `010`），`STREAM_KEY_SECRET` 仅作覆盖 / 轮换；180 天），读公开。
- 赛事页「我要直播 / 选下一场 / 结束直播」写会话并展示固定直播链接。

### 比分填报升级（BO1 / BO3 / BO5 / BO7）

- 赛事新增 `best_of`（迁移 `009`，旧赛事按录像局数回填）。
- BO1 保持「选游戏胜者」流程；BO3 以上显示比分填报（+/-、快捷比分），并明确显示胜者 / 晋级者。
- 服务端校验 BO 比分：不能打平、不能超过 BO、必须有一方先到目标分。
- 录像导入只读：导入只写录像，不改变比分 / 晋级（见下节）。
- 新建赛事支持快捷模板，并可「从已有赛事套用设置」。

### 时区

- 赛事时间和首页卡片按观众本地时区显示（`src/lib/datetime.js` + `MatchTime.svelte`），赛事页有实时倒计时。
- 个人设置里可手动选择时区（保存在浏览器 localStorage，默认跟随系统）。

### 录像导入改为只读（事故修复）

- 背景：旧的批量导入会按录像重算比分并自动 `submitResult` + `advanceWinner`，甚至在胜者晋级赛事里
  把胜者设反（旧代码写死败者晋级），导致后续轮次全乱。
- 现在：批量导入只写 `match_replays` 并回传每场比分摘要，不改比分 / 胜者、不触发晋级。
- 新入口：比赛结果弹窗里的「从录像读取比分」调用 `GET /api/matches/:matchId/replay-score` 预填
  （BO1 显示建议胜者）；提交仍走 `submitResult`，BO 目标分校验和晋级规则不变。
- overlay 的 SSE 150ms 合并已补进 `src/lib/components/TournamentOverlay.svelte`。

### 其他

- 录像批量导入与结果 UI 按赛事 `loser_advances` 走胜者 / 败者晋级，不再写死 SUCK 经典规则。
- Liquipedia bracket id 固定长度：6 字母前缀 + 4 位数字（如 `suckst0007` / `AXsuck0007`）。
- SSE 合并刷新：`coalescedRefresh`，赛事页 300ms、overlay 150ms 合并一轮。

## 先看看再决定

- `c6102ea` 管理员修正已结束比赛：现有版本在「比赛进行中」已可通过比赛详情里的「修改比分 / 重新填报」修正；已结束赛事暂不支持，后续再补。
- `b75f84c` 实时刷新合并：已补 `coalescedRefresh`（见上）。
- `bacaf12` 开赛人数校验：fork 里是单人赛少于 2 人禁止开赛；影响很小，暂时不做。

## 不急着做

- 双败淘汰
- 瑞士轮 / 小组赛 + 淘汰赛 / 多阶段比赛
- 多路直播 / 分频道 overlay
- 地图 Ban/Pick（把 fork 的载具池改成 SC2 地图池）

## 参考 fork 提交

VermilionLP/potato-cup-tournament-platform（战雷版）：

- 双败：`266af52`（不要整包 cherry-pick，会删 SC2 录像功能）
- 瑞士：`c18eabc`
- 两阶段：`16e3cf8`、`cc30ddf`
- 多路直播：`6457064`
- 比分填报：`658ac2c`
- 时区：`a2c74c6`
- 管理员修正：`c6102ea`
- SSE 合并：`b75f84c`
- 开赛校验：`bacaf12`

## 注意

- Liquipedia bracket id 固定长度：6 字母前缀 + 4 位数字（如 `suckst0007` / `AXsuck0007`）。
- 旧 SUCK 系列继续用 `AXsuck` 前缀；SUCK ST 用 `suckst` 前缀。
- 迁移号在 monorepo 内全局递增：本仓库历史里的 `007.do.best-of.sql` 现已改为 `009.do.best-of.sql`
  （`007` 是 `match-completed-at`、`008` 是 `broadcasts`）；已应用过旧 `007` 的库重跑也安全
  （`ADD COLUMN IF NOT EXISTS`）。
- API 启动时由 `plugins/database.js` 运行 Postgrator 迁移；部署后确认 `axsuck.schemaversion` 到 009。