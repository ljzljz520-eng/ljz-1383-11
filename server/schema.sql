PRAGMA foreign_keys = ON;

-- ============ 草稿域（站主实时编辑） ============

-- 经历身份（求学 / 实习 / 项目经历；作品通过 work_experiences 关联多段经历）
CREATE TABLE IF NOT EXISTS experiences (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT NOT NULL UNIQUE,                 -- 对外稳定标识，合并/改名后旧链接仍可追
  type            TEXT NOT NULL CHECK (type IN ('education','internship','project')),
  title           TEXT NOT NULL,
  organization    TEXT,
  summary         TEXT,
  -- 不精确时间：精度分开存，绝不补 day=1
  start_precision TEXT NOT NULL CHECK (start_precision IN ('year','month','day')),
  start_year      INTEGER NOT NULL,
  start_month     INTEGER,
  start_day       INTEGER,
  end_precision   TEXT CHECK (end_precision IN ('year','month','day')),
  end_year        INTEGER,
  end_month       INTEGER,
  end_day         INTEGER,
  ongoing         INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','pending','hidden')),
  sort_key        REAL NOT NULL,                        -- 已知信息中点，稳定排序用
  display_order   INTEGER NOT NULL DEFAULT 0,           -- 同键时的确定性次序
  -- 乐观锁：两设备并发改同一条，后提交者必须基于新版本
  version         INTEGER NOT NULL DEFAULT 1,
  merged_into     INTEGER REFERENCES experiences(id),   -- 被合并到哪条
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exp_sort ON experiences(sort_key, display_order);
CREATE INDEX IF NOT EXISTS idx_exp_merged ON experiences(merged_into);

CREATE TABLE IF NOT EXISTS skills (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE,
  slug  TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS experience_skills (
  experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  skill_id      INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (experience_id, skill_id)
);

-- 个人贡献：公开页只允许出现 approved 的贡献（粒度到条目，可逐条批准）
CREATE TABLE IF NOT EXISTS contributions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  experience_id  INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  content        TEXT NOT NULL,
  approved       INTEGER NOT NULL DEFAULT 0,
  display_order  INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contrib_exp ON contributions(experience_id);

-- 作品（一个作品关联多段经历；一段经历也可关联多个作品 => 多对多）
CREATE TABLE IF NOT EXISTS works (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  summary     TEXT,
  cover       TEXT,
  link        TEXT,
  retired     INTEGER NOT NULL DEFAULT 0,              -- 项目退役标记
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS work_experiences (
  work_id        INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  experience_id  INTEGER NOT NULL REFERENCES experiences(id) ON DELETE RESTRICT,
  role           TEXT,
  display_order  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (work_id, experience_id)
);

-- 合并经历时迁移引用 + 旧链接（不留下失效卡片）
CREATE TABLE IF NOT EXISTS experience_redirects (
  old_id         INTEGER PRIMARY KEY,                   -- 旧经历 id
  old_slug       TEXT NOT NULL UNIQUE,
  new_id         INTEGER NOT NULL REFERENCES experiences(id),
  created_at     INTEGER NOT NULL
);

-- ============ 发布域（冻结视图，与草稿隔离） ============
CREATE TABLE IF NOT EXISTS publications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  published_at INTEGER NOT NULL,
  note         TEXT,
  -- 冻结的完整快照：访客搜索/年表/详情全部读它，保证三者一致
  snapshot     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public_views (
  -- 单行表：current = 当前生效发布；历史 publications 永久可追
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  current_pub_id   INTEGER REFERENCES publications(id),
  activated_at     INTEGER
);

-- 快照内部的作品 slug -> 历史重定向，也随发布冻结
CREATE TABLE IF NOT EXISTS work_redirects (
  old_slug   TEXT PRIMARY KEY,
  new_slug   TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 管理会话
CREATE TABLE IF NOT EXISTS admin_sessions (
  token       TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  user_agent  TEXT,
  device      TEXT
);
