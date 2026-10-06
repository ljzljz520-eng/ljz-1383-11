'use strict';
const db = require('./db');
const t = require('./time');

const now = () => Date.now();

function partOf(row, prefix) {
  const precision = row[prefix + '_precision'];
  if (!precision) return null;
  return {
    precision,
    year: row[prefix + '_year'],
    month: row[prefix + '_month'],
    day: row[prefix + '_day']
  };
}

// 实时读取草稿表（管理端用：含未批准、含退役、含被合并记录）
function readDrafts() {
  const experiences = db.prepare(`
    SELECT * FROM experiences WHERE merged_into IS NULL ORDER BY sort_key DESC, display_order, id
  `).all().map(row => ({
    id: row.id, slug: row.slug, type: row.type, title: row.title,
    organization: row.organization, summary: row.summary,
    start: partOf(row, 'start'), end: partOf(row, 'end'), ongoing: !!row.ongoing,
    status: row.status, sortKey: row.sort_key, displayOrder: row.display_order,
    version: row.version,
    rangeLabel: t.rangeLabel(partOf(row, 'start'), partOf(row, 'end'), !!row.ongoing),
    skills: db.prepare(`
      SELECT s.slug, s.name FROM skills s
      JOIN experience_skills es ON es.skill_id = s.id
      WHERE es.experience_id = ? ORDER BY s.name
    `).all(row.id),
    contributions: db.prepare(`
      SELECT id, content, approved, display_order
      FROM contributions WHERE experience_id = ? ORDER BY display_order, id
    `).all(row.id).map(c => ({ ...c, approved: !!c.approved })),
    works: db.prepare(`
      SELECT w.slug, w.title, we.role
      FROM work_experiences we JOIN works w ON w.id = we.work_id
      WHERE we.experience_id = ? ORDER BY we.display_order, w.id
    `).all(row.id)
  }));

  const works = db.prepare(`SELECT * FROM works ORDER BY retired, id`).all().map(w => ({
    id: w.id, slug: w.slug, title: w.title, summary: w.summary, cover: w.cover,
    link: w.link, retired: !!w.retired, version: w.version,
    experiences: db.prepare(`
      SELECT e.slug, e.title, e.type, we.role, e.sort_key
      FROM work_experiences we JOIN experiences e ON e.id = we.experience_id
      WHERE we.work_id = ? AND e.merged_into IS NULL
      ORDER BY we.display_order, e.id
    `).all(w.id).map(r => ({ slug: r.slug, title: r.title, type: r.type, role: r.role }))
  }));

  return {
    builtAt: now(),
    isDraft: true,
    experiences,
    works,
    redirects: {
      experience: Object.fromEntries(db.prepare(
        'SELECT old_slug, new_id FROM experience_redirects'
      ).all().map(r => [r.old_slug, r.new_id])),
      experienceById: Object.fromEntries(db.prepare(
        'SELECT old_id, new_id FROM experience_redirects'
      ).all().map(r => [String(r.old_id), r.new_id])),
      work: Object.fromEntries(db.prepare(
        'SELECT old_slug, new_slug FROM work_redirects'
      ).all().map(r => [r.old_slug, r.new_slug]))
    }
  };
}

// 生成冻结发布视图：只含 approved 经历 + approved 贡献；
// 被合并的经历不出卡片（旧链接靠 redirects 追到新卡）；
// 退役作品保留（历史真实），但带 retired 标记。
function buildSnapshot() {
  const drafts = readDrafts();
  const experiences = drafts.experiences
    .filter(e => e.status === 'approved')
    .map(e => ({
      id: e.id, slug: e.slug, type: e.type, title: e.title,
      organization: e.organization, summary: e.summary,
      start: e.start, end: e.end, ongoing: e.ongoing,
      rangeLabel: e.rangeLabel, sortKey: e.sortKey,
      years: t.coveredYears(e.start, e.end, e.ongoing),
      skills: e.skills,
      contributions: e.contributions.filter(c => c.approved),
      works: e.works.map(w => ({ slug: w.slug, title: w.title, role: w.role }))
    }));

  const expBySlug = new Map(experiences.map(e => [e.slug, e]));
  const works = drafts.works.map(w => {
    const linked = w.experiences
      .filter(e => expBySlug.has(e.slug))
      .map(e => ({ slug: e.slug, title: e.title, type: e.type, role: e.role }));
    const years = [...new Set(linked.flatMap(e => expBySlug.get(e.slug).years))].sort();
    return {
      slug: w.slug, title: w.title, summary: w.summary, cover: w.cover,
      link: w.link, retired: w.retired, experiences: linked, years
    };
  }).filter(w => w.experiences.length > 0); // 没有任何已发布关联经历的作品不公开

  return {
    builtAt: now(),
    isDraft: false,
    experiences,
    works,
    // 重定向信息随快照冻结：历史发布用自己当时的映射
    redirects: drafts.redirects
  };
}

// 原子发布：写入新版本 + 单行切换 current，访客请求要么全读旧版要么全读新版
function publish(note) {
  const snapshot = JSON.stringify(buildSnapshot());
  const ts = now();
  return db.transaction(() => {
    const info = db.prepare(
      'INSERT INTO publications (published_at, note, snapshot) VALUES (?,?,?)'
    ).run(ts, note || null, snapshot);
    db.prepare(`
      INSERT INTO public_views (id, current_pub_id, activated_at)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET current_pub_id = excluded.current_pub_id,
                                    activated_at = excluded.activated_at
    `).run(info.lastInsertRowid, ts);
    return { id: info.lastInsertRowid, publishedAt: ts };
  })();
}

function currentPubId() {
  const row = db.prepare('SELECT current_pub_id FROM public_views WHERE id=1').get();
  return row ? row.current_pub_id : null;
}

// 读取发布视图。pubId 缺省 = 当前版；指定 = 访客正在翻的那一版（冻结一致）。
// 历史 id 也能取到——"历史发布仍能追到实际采用的内容"。
function getPublished(pubId) {
  let id = pubId != null ? Number(pubId) : currentPubId();
  if (!id) return { id: null, snapshot: null };
  const row = db.prepare('SELECT id, published_at, note, snapshot FROM publications WHERE id=?').get(id);
  if (!row) return { id: null, snapshot: null };
  return { id: row.id, publishedAt: row.published_at, note: row.note, snapshot: JSON.parse(row.snapshot) };
}

function listPublications(limit = 100) {
  return db.prepare(
    'SELECT id, published_at, note FROM publications ORDER BY id DESC LIMIT ?'
  ).all(limit);
}

module.exports = { readDrafts, buildSnapshot, publish, getPublished, currentPubId, listPublications };
