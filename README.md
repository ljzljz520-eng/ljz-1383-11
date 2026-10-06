# 个人经历档案

个人站的“作品年表”已升级为**经历档案**：访客可以按阶段、能力、年份与项目状态筛选，并通过站内搜索读取冻结发布视图；站主可在管理页维护求学、实习、作品、个人贡献与作品—经历关系。

## 快速启动

```bash
npm install
npm start
# http://localhost:3000
# 管理页：/admin.html
# 开发管理口令：owner-dev-token，可用 ADMIN_TOKEN 覆盖
```

运行验收：

```bash
npm test
```

默认使用 SQLite 文件 `data/archive.db`（已在 `.gitignore` 忽略）。测试使用内存数据库，不影响开发数据。

## 页面与 API

- `experiences.html`：公开经历档案、筛选、搜索、分页、详情覆盖层、历史版本切换。
- `admin.html`：经历、作品、能力、贡献编辑；重复经历合并；草稿差异和发布控制。
- `GET /api/public/experiences`：从冻结发布表读取，支持 `stage`、`skill`、`year`、`lifecycle`、`q`、`page`、`pageSize`、`release`。
- `GET /api/public/experiences/:idOrSlug`：读取某个发布版本中的经历，发布别名可解析旧链接。
- `GET /api/public/releases`：列出当前和历史发布。
- `/api/admin/*`：需要 `Authorization: Bearer <ADMIN_TOKEN>`。

旧地址由服务器 302 和 HTML meta refresh 双重承接：

- `/portfolio.html` → `/experiences.html?stage=work`
- `/work-detail.html` → `/experiences.html?detail=neofinance-app`
- `/solar-detail.html` → `/experiences.html?detail=solar-brand-system`

## 关系数据库模型

核心表：

- `experiences`：经历身份、阶段、标题、组织、审核状态、生命周期、原始日期精度、乐观锁版本。
- `skills` / `experience_skills`：能力词典和多对多能力。
- `contributions`：贡献内容、是否个人贡献、审核状态。
- `works` / `work_experiences`：作品与多段经历的多对多关系。
- `work_profiles`：作品的唯一“主经历”和展示摘要。
- `experience_aliases`：经历 slug 改名或合并后的旧链接。
- `experience_merges`：重复经历合并审计。
- `releases`：发布版本及 `current` / `running` / `archived` 状态；数据库部分唯一索引保证同一时刻只有一个 current 和一个 running。
- `release_experiences`、`release_skills`、`release_contributions`、`release_works`、`release_work_experiences`、`release_work_profiles`、`release_experience_aliases`：发布时复制生成的冻结快照。

公开查询只读取 `release_*` 表；`release_contributions` 有约束保证只包含 `status = approved` 且 `personal_contribution = 1` 的内容。草稿、待审、拒绝、非个人贡献不会出现在公开页面。

## 不精确时间规则

输入值保留为：

- 年：`YYYY`，精度 `year`
- 月：`YYYY-MM`，精度 `month`
- 日：`YYYY-MM-DD`，精度 `day`

数据库另存拆分列，但**不会把年/月补成 1 日用于展示**。比较时生成包含式不确定区间：

- 年精度：下界为当年 1 月 1 日，上界为当年 12 月 31 日。
- 月精度：下界为当月 1 日，上界为当月最后一天。
- 日精度：上下界均为当天。

显示规则示例：

- `2021/year` 显示 `2021`
- `2021-07/month` 显示 `2021-07`
- `2021-07/month` 到 `2021-10/month` 显示 `2021-07 至 2021-10`
- 只有开始时间表示 `YYYY 至今`，不伪造结束日期。

稳定排序为：正在进行优先 → 结束不确定区间的上界倒序 → 开始下界倒序 → 阶段 → `sort_index` → ID。SQL 与应用层使用同一规则，保证分页稳定。

跨年经历按年份区间相交筛选，例如 2020–2022 的项目会出现在 2020、2021、2022 三个筛选项，但列表和 `total` 中只有一张卡片、只计一次。

## 草稿与发布

- 管理页实时读写草稿表。
- 公开页实时读取的是发布快照，不直接读草稿。
- 发布前计算草稿差异和内容 hash；与当前发布一致时拒绝无意义发布。
- `running` 是正在运行但尚未切换的冻结视图，访客仍读取旧的 `current`。
- 完成运行发布后，旧 current 转 archived，running 转 current；历史版本通过 `?release=版本号` 可追溯实际采用的内容。
- 访客翻页期间发布新版不会混版：已打开列表固定在首次读取的 release，轮询发现新版后只提示是否切换。

## 并发与合并

经历使用 `revision` 乐观锁和 `If-Match`：两设备同时编辑同一条经历时，先提交成功并递增 revision；后提交收到 409 和当前 revision，需刷新核对后再合并提交，避免静默覆盖。

合并重复经历在一个数据库事务内完成：

1. 迁移贡献，避免重复主键。
2. 合并能力标签。
3. 迁移作品—经历关系；重复关系去重。
4. 处理作品主档案，防止孤儿 profile。
5. 来源 slug 与来源已有 alias 全部迁到目标经历。
6. 来源经历标记 `merged_into_id`，并写 `experience_merges` 审计。

发布快照会复制别名，因此历史发布中的旧链接仍能定位到当时实际采用的目标卡片。

## 已覆盖的验收场景

`test/archive.test.js` 覆盖：

1. 年 / 月精度显示、不确定区间重叠。
2. 跨年经历在多个年份筛选出现但不重复计数。
3. 公开快照排除待审贡献、非个人贡献和已合并经历。
4. 两设备并发修改同一条经历的乐观锁冲突。
5. 时间精度从年改成月，且历史版本仍保留原内容。
6. 项目退役发布处于 running 时访客仍读旧 current，finalize 后才切换。
7. 合并重复经历迁移贡献、作品引用和旧链接，并在新发布中可访问。
