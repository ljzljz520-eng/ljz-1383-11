'use strict';
const db = require('./db');
const t = require('./time');
const snap = require('./snapshot');

const now = () => Date.now();

function slugify(text, fallback) {
  const base = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return (base || fallback || 'item') + '-' + Math.random().toString(36).slice(2, 7);
}

function parseRange(body) {
  const start = t.validate(body.start ? {
    precision: body.start.precision,
    year: body.start.year, month: body.start.month, day: body.start.day
  } : null);
  const ongoing = !!body.ongoing;
  let end = null;
  if (!ongoing) {
    end = t.validate(body.end ? {
      precision: body.end.precision,
      year: body.end.year, month: body.end.month, day: body.end.day
    } : null, { allowOngoing: true });
  }
  // 区间合法性：只有当展开边界严格 end.hi <= start.lo 才冲突
  if (end) {
    const s = t.expand(start), e = t.expand(end);
    if (e.hi <= s.lo) throw Object.assign(new Error('结束时间早于开始时间'), { status: 400 });
  }
  return { start, end, ongoing };
}

function setSkills(expId, skills = []) {
  db.prepare('DELETE FROM experience_skills WHERE experience_id=?').run(expId);
  const ins = db.prepare('INSERT OR IGNORE INTO skills (name, slug) VALUES (?,?)');
  const find = db.prepare('SELECT id FROM skills WHERE slug=?');
  const link = db.prepare('INSERT OR IGNORE INTO experience_skills (experience_id, skill_id) VALUES (?,?)');
  for (const raw of skills) {
    const name = String(raw).trim();
    if (!name) continue;
    const slug = slugify(name, 'skill').replace(/-\w{5}$/, '-' +
      Buffer.from(name).toString('hex').slice(0, 8));
    // 同名复用
    let s = db.prepare('SELECT id, slug FROM skills WHERE name=?').get(name);
    if (!s) {
      let candidate = name.toLowerCase().replace(/[^a-z0-9一-龥]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'skill';
      let suffix = '';
      while (db.prepare('SELECT 1 FROM skills WHERE slug=?').get(candidate + suffix)) suffix = '-' + Math.random().toString(36).slice(2, 6);
      const finalSlug = candidate + suffix;
      ins.run(name, finalSlug);
      s = find.get(finalSlug);
    }
    link.run(expId, s.id);
  }
}

function setContributions(expId, contributions = []) {
  const existing = new Map(db.prepare('SELECT * FROM contributions WHERE experience_id=?').all(expId).map(c => [c.id, c]));
  const kept = new Set();
  contributions.forEach((c, i) => {
    const content = String(c.content || '').trim();
    if (!content) return;
    if (c.id && existing.has(c.id)) {
      db.prepare('UPDATE contributions SET content=?, display_order=?, approved=? WHERE id=?')
        .run(content, i, c.approved ? 1 : 0, c.id);
      kept.add(c.id);
    } else {
      const r = db.prepare('INSERT INTO contributions (experience_id, content, approved, display_order, created_at) VALUES (?,?,?,?,?)')
        .run(expId, content, c.approved ? 1 : 0, i, now());
      kept.add(r.lastInsertRowid);
    }
  });
  const del = db.prepare('DELETE FROM contributions WHERE id=?');
  for (const [id] of existing) if (!kept.has(id)) del.run(id);
}

function createExperience(body) {
  const { start, end, ongoing } = parseRange(body);
  const sortKey = t.expand(start).mid;
  return db.transaction(() => {
    const slug = slugify(body.title, 'exp');
    const r = db.prepare(`
      INSERT INTO experiences (slug, type, title, organization, summary,
        start_precision, start_year, start_month, start_day,
        end_precision, end_year, end_month, end_day, ongoing, status,
        sort_key, display_order, created_at, updated_at)
      VALUES (?,?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?, ?,?,?)
    `).run(slug, body.type, body.title, body.organization || null, body.summary || null,
      start.precision, start.year, start.month ?? null, start.day ?? null,
      end ? end.precision : null, end ? end.year : null, end ? end.month ?? null : null, end ? end.day ?? null : null,
      ongoing ? 1 : 0, body.status || 'approved',
      sortKey, body.display_order ?? 0, now(), now());
    setSkills(r.lastInsertRowid, body.skills);
    setContributions(r.lastInsertRowid, body.contributions);
    return r.lastInsertRowid;
  })();
}

// 更新：version 必须与库中一致（乐观锁）。两设备并发改同一经历时，
// 后提交的设备拿到 409 + 当前服务端数据，由用户决定是否覆盖。
function updateExperience(id, body) {
  return db.transaction(() => {
    const row = db.prepare('SELECT * FROM experiences WHERE id=? AND merged_into IS NULL').get(id);
    if (!row) throw Object.assign(new Error('经历不存在或已合并'), { status: 404 });
    if (body.version == null || Number(body.version) !== row.version) {
      const server = snap.readDrafts().experiences.find(e => e.id === id);
      throw Object.assign(new Error('该经历已被其他设备修改，请刷新后重试'), { status: 409, server });
    }
    const { start, end, ongoing } = parseRange(body);
    const sortKey = t.expand(start).mid;
    db.prepare(`
      UPDATE experiences SET slug=?, type=?, title=?, organization=?, summary=?,
        start_precision=?, start_year=?, start_month=?, start_day=?,
        end_precision=?, end_year=?, end_month=?, end_day=?, ongoing=?, status=?,
        sort_key=?, version=version+1, updated_at=?
      WHERE id=?
    `).run(body.slug || row.slug, body.type, body.title, body.organization || null, body.summary || null,
      start.precision, start.year, start.month ?? null, start.day ?? null,
      end ? end.precision : null, end ? end.year : null, end ? end.month ?? null : null, end ? end.day ?? null : null,
      ongoing ? 1 : 0, body.status || row.status, sortKey, now(), id);
    if (body.skills) setSkills(id, body.skills);
    if (body.contributions) setContributions(id, body.contributions);
    return db.prepare('SELECT * FROM experiences WHERE id=?').get(id).version;
  })();
}

function removeExperience(id) {
  const tx = db.transaction(() => {
    const e = db.prepare('SELECT id FROM experiences WHERE id=?').get(id);
    if (!e) return false;
    const linkedWorks = db.prepare('SELECT COUNT(*) n FROM work_experiences WHERE experience_id=?').get(id).n;
    if (linkedWorks > 0) {
      // 有作品引用时不物理删除，改隐藏，避免失效卡片
      db.prepare(`UPDATE experiences SET status='hidden', version=version+1, updated_at=? WHERE id=?`).run(now(), id);
      return 'hidden';
    }
    db.prepare('DELETE FROM experiences WHERE id=?').run(id);
    return 'deleted';
  });
  return tx();
}

// 合并重复经历：keepId 保留，dupIds 迁移所有引用到 keep，
// 旧 id 和旧 slug 写入 experience_redirects —— 旧链接 301/解析到新卡，不留失效卡片。
function mergeExperiences(keepId, dupIds) {
  return db.transaction(() => {
    const keep = db.prepare('SELECT * FROM experiences WHERE id=? AND merged_into IS NULL').get(keepId);
    if (!keep) throw Object.assign(new Error('保留目标不存在'), { status: 404 });
    const merged = [];
    for (const rawId of dupIds) {
      const id = Number(rawId);
      if (id === keepId) continue;
      const dup = db.prepare('SELECT * FROM experiences WHERE id=? AND merged_into IS NULL').get(id);
      if (!dup) continue;
      // 1) 作品关联迁移（已存在的关联保留，不重复）
      const links = db.prepare('SELECT work_id, role, display_order FROM work_experiences WHERE experience_id=?').all(id);
      for (const l of links) {
        db.prepare(`INSERT OR IGNORE INTO work_experiences (work_id, experience_id, role, display_order)
                    VALUES (?,?,?,?)`).run(l.work_id, keepId, l.role, l.display_order);
        db.prepare('DELETE FROM work_experiences WHERE work_id=? AND experience_id=?').run(l.work_id, id);
      }
      // 2) 技能合并
      const skills = db.prepare('SELECT skill_id FROM experience_skills WHERE experience_id=?').all(id);
      for (const s of skills) {
        db.prepare('INSERT OR IGNORE INTO experience_skills (experience_id, skill_id) VALUES (?,?)').run(keepId, s.skill_id);
      }
      db.prepare('DELETE FROM experience_skills WHERE experience_id=?').run(id);
      // 3) 贡献迁移（保留审批状态）
      db.prepare('UPDATE contributions SET experience_id=? WHERE experience_id=?').run(keepId, id);
      // 4) 已经指向别处的旧重定向，改为最终指向 keep
      db.prepare('UPDATE experience_redirects SET new_id=? WHERE new_id=?').run(keepId, id);
      // 5) 登记本卡旧链接（旧 id + 旧 slug）
      db.prepare(`INSERT INTO experience_redirects (old_id, old_slug, new_id, created_at)
                  VALUES (?,?,?,?) ON CONFLICT(old_id) DO UPDATE SET new_id=excluded.new_id`)
        .run(id, dup.slug, keepId, now());
      // 6) 标记合并
      db.prepare('UPDATE experiences SET merged_into=?, version=version+1, updated_at=? WHERE id=?')
        .run(keepId, now(), id);
      merged.push({ id, slug: dup.slug });
    }
    db.prepare('UPDATE experiences SET version=version+1, updated_at=? WHERE id=?').run(now(), keepId);
    return { keepId, merged };
  })();
}

// ---------- 作品 ----------
function setWorkExperiences(workId, links = []) {
  db.prepare('DELETE FROM work_experiences WHERE work_id=?').run(workId);
  const ins = db.prepare('INSERT INTO work_experiences (work_id, experience_id, role, display_order) VALUES (?,?,?,?)');
  links.forEach((l, i) => {
    const e = db.prepare('SELECT id FROM experiences WHERE slug=? AND merged_into IS NULL').get(l.slug || l.experienceSlug);
    if (e) ins.run(workId, e.id, l.role || null, i);
  });
}

function createWork(body) {
  return db.transaction(() => {
    // 显式 slug（种子/导入）优先，否则自动生成
    const slug = body.slug ? String(body.slug).trim() : slugify(body.title, 'work');
    if (db.prepare('SELECT 1 FROM works WHERE slug=?').get(slug)) {
      throw Object.assign(new Error('作品标识 slug 已存在: ' + slug), { status: 409 });
    }
    const r = db.prepare(`INSERT INTO works (slug,title,summary,cover,link,retired,created_at,updated_at)
                          VALUES (?,?,?,?,?,?,?,?)`)
      .run(slug, body.title, body.summary || null, body.cover || null, body.link || null,
           body.retired ? 1 : 0, now(), now());
    setWorkExperiences(r.lastInsertRowid, body.experiences);
    return r.lastInsertRowid;
  })();
}

function updateWork(id, body) {
  return db.transaction(() => {
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(id);
    if (!w) throw Object.assign(new Error('作品不存在'), { status: 404 });
    if (body.version != null && Number(body.version) !== w.version) {
      throw Object.assign(new Error('该作品已被其他设备修改，请刷新后重试'), { status: 409 });
    }
    const newSlug = body.slug && body.slug !== w.slug;
    db.prepare(`UPDATE works SET slug=?,title=?,summary=?,cover=?,link=?,retired=?,version=version+1,updated_at=? WHERE id=?`)
      .run(body.slug || w.slug, body.title, body.summary ?? null, body.cover ?? null,
           body.link ?? null, body.retired ? 1 : 0, now(), id);
    if (newSlug) {
      db.prepare(`INSERT INTO work_redirects (old_slug,new_slug,created_at) VALUES (?,?,?)
                  ON CONFLICT(old_slug) DO UPDATE SET new_slug=excluded.new_slug`)
        .run(w.slug, body.slug, now());
    }
    if (Array.isArray(body.experiences)) setWorkExperiences(id, body.experiences);
    return db.prepare('SELECT * FROM works WHERE id=?').get(id).version;
  })();
}

function deleteWork(id) {
  const w = db.prepare('SELECT slug FROM works WHERE id=?').get(id);
  if (!w) return false;
  db.prepare('DELETE FROM works WHERE id=?').run(id);
  return true;
}

// 单条贡献审批切换（公开页只显示 approved）
function approveContribution(id, approved) {
  const r = db.prepare('UPDATE contributions SET approved=? WHERE id=?').run(approved ? 1 : 0, id);
  return r.changes > 0;
}

function publish(note) {
  return snap.publish(note);
}

module.exports = {
  createExperience, updateExperience, removeExperience, mergeExperiences,
  createWork, updateWork, deleteWork, approveContribution, publish, slugify
};
