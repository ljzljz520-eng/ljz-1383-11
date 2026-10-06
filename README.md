# 个人站 · 经历档案系统

把原「项目年表」改造为「经历档案」：访客按 **阶段（求学/实习/项目）与能力** 筛选，站主在管理页编辑
**求学、实习与作品**；后端用 Express + better-sqlite3（关系数据库）保存经历身份、个人贡献及发布版本。

## 运行

```bash
npm install
npm run seed     # 可选：写入演示数据并生成初始发布（data/ 会被 gitignore）
npm start        # 默认 http://localhost:3000 ；PORT=3100 npm start
```

- 公开档案：`/archive.html`（旧的 `/portfolio.html` 保留并放置迁移提示，不留死链）
- 管理页：`/admin`，默认口令 `admin123`（用环境变量 `ADMIN_PASSWORD` 覆盖）
- 测试：先 `PORT=3100 npm start`，再 `npm run test:time`（19 项）和 `npm run test:acceptance`（50 项）

## 关键设计

### 1. 不精确时间——绝不捏造"某月 1 日"
- 每个端点分开存 `precision ∈ {year, month, day}` + `year/month/day`（见 `experiences` 表）。
- **显示**严格按精度：`2024 年` / `2024 年 03 月` / `2024 年 03 月 09 日`，同年/同月区间自动折叠。
- **排序**不用伪造的 1 号，而用"已知信息中点"：年精度→年中（2024.5）、月精度→月中、日精度→当天。
- **重叠关系**用展开边界 `[lo, hi]`：只有边界严格分离才判定先后；信息不足时判为"可能重叠"，不误排。
- 实现见 `server/time.js`。

### 2. 跨年项目：多区间出现、不重复计数
- 快照为每条经历/作品预计算 `years`（起止闭区间；进行中算到当前年）。
- 按年筛选时跨年项可出现在多个年份；列表按 `id` 去重，计数（total）也只算一次。

### 3. 草稿（实时）与发布（冻结）两套视图
- 管理端 `/api/admin/*` 实时读草稿表（含未批准贡献、待审经历、退役作品）。
- 发布把 `buildSnapshot()` 的完整 JSON 存入 `publications.snapshot`，并原子切换 `public_views`
  单行指针。访客的列表、搜索、详情**全部**读同一冻结快照。
- 每个公开请求带版本号 `v`；翻页用游标 `after=<sortKey>_<id>`。翻页期间有新版上线时：
  仍返回旧版数据 + `stale:true` + `currentPubId`，访客点"查看新版"才整体切换，三端不会割裂。
- 历史版本永久可按 `?v=N` 访问（含旧 slug→新 slug 的当时映射），"历史发布仍追到实际采用的内容"。

### 4. 一个作品 ↔ 多段经历；合并不留下失效卡片
- `works M—N experiences`（`work_experiences`），作品本身不持日期，时间轴来自关联经历的年份并集。
- 合并 `mergeExperiences(keep, dups)` 在一个事务内：迁移作品关联（`INSERT OR IGNORE` 去重）、
  合并技能、迁移贡献（保留审批状态）、级联修正旧重定向，最后把旧 id/slug 写入
  `experience_redirects`。旧链接经快照内冻结映射解析到新卡并显示迁移说明。
- 作品改 slug 时写 `work_redirects`（同样随发布冻结）。
- 被作品引用的经历不允许物理删除，自动改为隐藏，杜绝悬空卡片。

### 5. 公开页只有批准内容
- 经历级 `status(approved/pending/hidden)` + 贡献级 `approved` 双重闸门；冻结时两层都过滤。
- 管理端"在线设备"页可看到多设备会话。

### 6. 并发：乐观锁
- `experiences.version` / `works.version`；更新必须带当前版本，冲突返回 **409 + 服务端最新内容**，
- 另一设备可在弹窗里载入对方版本再保存，不会静默覆盖。

### 7. 筛选链接与返回位置可恢复
- stage/skill/year/kind/q/v 全部在 URL 中；返回链接携带完整筛选串与 `#scroll=N`。
- 列表把已加载卡片缓存到 sessionStorage，从详情返回时重建（即使翻到第 3 页也能回到原位置）。

## 数据模型（server/schema.sql）

| 表 | 作用 |
|---|---|
| experiences | 经历身份、不精确时间、状态、排序键、乐观锁版本、merged_into |
| skills / experience_skills | 能力标签多对多 |
| contributions | 个人贡献，逐条批准 |
| works / work_experiences | 作品与多段经历多对多 |
| experience_redirects / work_redirects | 合并/改名后的旧链接迁移 |
| publications / public_views | 冻结快照与"当前生效版本"指针 |
| admin_sessions | 管理端会话（多设备） |

## 文件结构

```
server/time.js     不精确时间：校验/展开/显示/重叠/覆盖年份
server/schema.sql  关系模型
server/db.js       SQLite 连接（WAL + 外键）
server/snapshot.js 读草稿 / 建冻结快照 / 原子发布
server/query.js    筛选、跨年归属、稳定游标分页、搜索、旧链接解析
server/admin.js    CRUD、乐观锁、合并事务、审批、发布
server/auth.js     口令登录与会话
server/app.js      HTTP API + 静态白名单（不暴露 data/ 与 server/）
archive.html / experience-detail.html / work-detail.html  公开页
admin.html        站主管理页
js/archive/*.js   公开端/管理端逻辑
test/             时间模块 19 项 + 端到端 50 项验收
```

## 验收场景（均自动化）

1. 两设备并发改同一经历 → 409 + 服务端版本，刷新后可提交；
2. 时间精度从年改成月 → 月份落库、显示更新、排序键按月中重算；
3. 项目退役时发布正在运行 → 退役作品保留在快照，历史版本可追溯；
4. 访客翻页过程中新版上线 → 旧页旧数据 + stale 提示，手动切换后搜索/年表/详情一致更新；
5. 公开页仅出现 approved 贡献；筛选链接、返回位置可恢复；历史发布可追到实际内容。
```
