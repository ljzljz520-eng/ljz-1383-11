'use strict';

const { formatRange, bucketYears, compareRanges } = require('./date-range');
const { id, uniqueSlug } = require('./utils');
const { collectSnapshot, snapshotHash } = require('./release');

function experienceDetail(db, row) {
  return {
    ...row,
    dateDisplay: formatRange(row),
    skills: db.prepare(`
      SELECT s.id, s.slug, s.name, s.description
      FROM experience_skills es JOIN skills s ON s.id = es.skill_id
      WHERE es.experience_id = ? ORDER BY s.name
    `).all(row.id),
    contributions: db.prepare(`
      SELECT id, title, description, personal_contribution AS personalContribution, status, reviewed_at AS reviewedAt
      FROM contributions WHERE experience_id = ? ORDER BY created_at, id
    `).all(row.id),
    relatedWorks: db.prepare(`
      SELECT w.id, w.slug, w.title, w.summary, w.cover_icon AS coverIcon, w.lifecycle_status AS lifecycleStatus,
             we.relation_note AS relationNote, we.position
      FROM work_experiences we JOIN works w ON w.id = we.work_id
      WHERE we.experience_id = ? ORDER BY we.position, w.title
    `).all(row.id),
    primaryWork: db.prepare(`
      SELECT w.id AS workId, w.title, wp.role, wp.artifact_summary AS artifactSummary, wp.link_label AS linkLabel
      FROM work_profiles wp JOIN works w ON w.id = wp.work_id
      WHERE wp.experience_id = ?
    `).get(row.id) || null,
    mergedTarget: row.merged_into_id ? db.prepare(`SELECT id, slug, title FROM experiences WHERE id = ?`).get(row.merged_into_id) : null
  };
}

function listDraftExperiences(db) {
  const rows = db.prepare(`SELECT * FROM experiences WHERE COALESCE(merged_into_id, '') = ''`).all();
  rows.sort(compareRanges);
  const releaseYear = new Date().getUTCFullYear();
  return {
    years: bucketYears(rows, releaseYear),
    items: rows.map((e) => ({
      id: e.id,
      slug: e.slug,
      stage: e.stage,
      title: e.title,
      organization: e.organization,
      summary: e.summary,
      lifecycleStatus: e.lifecycle_status,
      moderationStatus: e.moderation_status,
      revision: e.revision,
      dateDisplay: formatRange(e, releaseYear),
      years: bucketYears([e], releaseYear),
      ongoing: Boolean(e.ongoing),
      start: e.start_value ? { value: e.start_value, precision: e.start_precision } : null,
      end: e.end_value ? { value: e.end_value, precision: e.end_precision } : null,
      skills: db.prepare(`SELECT s.id, s.slug, s.name FROM experience_skills es JOIN skills s ON s.id = es.skill_id WHERE es.experience_id = ? ORDER BY s.name`).all(e.id),
      contributionCounts: db.prepare(`
        SELECT
          SUM(CASE WHEN status='approved' AND personal_contribution=1 THEN 1 ELSE 0 END) AS approvedPersonal,
          SUM(CASE WHEN status!='approved' THEN 1 ELSE 0 END) AS pending
        FROM contributions WHERE experience_id = ?
      `).get(e.id),
      workCount: db.prepare('SELECT COUNT(*) AS c FROM work_experiences WHERE experience_id = ?').get(e.id).c
    }))
  };
}

function listSkills(db) {
  return {
    skills: db.prepare(`
      SELECT s.*, COUNT(es.experience_id) AS usage_count
      FROM skills s LEFT JOIN experience_skills es ON es.skill_id = s.id
      GROUP BY s.id ORDER BY s.name
    `).all().map((s) => ({ ...s, usageCount: s.usage_count }))
  };
}

function createSkill(db, body) {
  const name = String(body.name || '').trim();
  if (!name) {
    const err = new Error('能力名称不能为空');
    err.statusCode = 400;
    throw err;
  }
  const slug = uniqueSlug(db, 'skills', body.slug || name);
  const skillId = body.id || id('sk');
  db.prepare('INSERT INTO skills (id, slug, name, description) VALUES (?, ?, ?, ?)')
    .run(skillId, slug, name, String(body.description || ''));
  return db.prepare('SELECT * FROM skills WHERE id = ?').get(skillId);
}

function listWorks(db) {
  return {
    works: db.prepare(`
      SELECT w.*,
        (SELECT GROUP_CONCAT(e.title, ' / ')
         FROM work_experiences we JOIN experiences e ON e.id = we.experience_id
         WHERE we.work_id = w.id) AS relatedExperienceTitles
      FROM works w ORDER BY w.title
    `).all()
  };
}

function createWork(db, body) {
  const title = String(body.title || '').trim();
  if (!title) {
    const err = new Error('作品标题不能为空');
    err.statusCode = 400;
    throw err;
  }
  const workId = id('work');
  const slug = uniqueSlug(db, 'works', body.slug || title);
  db.prepare(`INSERT INTO works (id, slug, title, summary, url, cover_icon, lifecycle_status)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(workId, slug, title, String(body.summary || ''), String(body.url || ''), String(body.coverIcon || '✦'), body.lifecycleStatus || 'active');
  return db.prepare('SELECT * FROM works WHERE id = ?').get(workId);
}

function updateWork(db, workId, body) {
  const work = db.prepare('SELECT * FROM works WHERE id = ?').get(workId);
  if (!work) {
    const err = new Error('作品不存在');
    err.statusCode = 404;
    throw err;
  }
  const title = String(body.title || work.title).trim();
  const slug = body.slug ? uniqueSlug(db, 'works', body.slug, workId) : work.slug;
  db.prepare(`UPDATE works SET title=?, slug=?, summary=?, url=?, cover_icon=?, lifecycle_status=?, updated_at=datetime('now') WHERE id=?`)
    .run(title, slug, String(body.summary ?? work.summary), String(body.url ?? work.url), String(body.coverIcon ?? work.cover_icon), body.lifecycleStatus || work.lifecycle_status, workId);
  return db.prepare('SELECT * FROM works WHERE id = ?').get(workId);
}

function draftDiff(db) {
  const snapshot = collectSnapshot(db);
  const hash = snapshotHash(snapshot);
  const current = db.prepare(`SELECT * FROM releases WHERE status = 'current' ORDER BY published_at DESC LIMIT 1`).get();
  const draftIds = new Set(snapshot.experiences.map((e) => e.id));
  const currentRows = current ? db.prepare('SELECT * FROM release_experiences WHERE release_id = ?').all(current.id) : [];
  const currentById = new Map(currentRows.map((e) => [e.draft_id, e]));
  const added = [];
  const changed = [];
  const removedIds = new Set(currentRows.map((e) => e.draft_id));

  for (const e of snapshot.experiences) {
    const old = currentById.get(e.id);
    if (!old) added.push({ id: e.id, title: e.title, slug: e.slug });
    else {
      removedIds.delete(e.id);
      const fields = ['slug','stage','title','organization','summary','narrative','location','lifecycle_status','start_value','start_precision','end_value','end_precision','ongoing','sort_index'];
      if (fields.some((f) => String(old[f] ?? '') !== String(e[f] ?? ''))) changed.push({ id: e.id, title: e.title, slug: e.slug });
    }
  }
  const removed = currentRows.filter((e) => removedIds.has(e.draft_id)).map((e) => ({ id: e.draft_id, title: e.title, slug: e.slug }));
  const counts = {
    experiences: snapshot.experiences.length,
    approvedContributions: snapshot.contributions.length,
    skills: snapshot.skills.length,
    works: snapshot.works.length,
    workRelations: snapshot.workExperiences.length,
    aliases: snapshot.aliases.length
  };
  return {
    hasChanges: !current || current.content_hash !== hash,
    sameAs: current && current.content_hash === hash ? current.version : null,
    added, changed, removed, counts,
    pendingContributions: db.prepare(`SELECT COUNT(*) AS c FROM contributions WHERE status != 'approved' OR personal_contribution = 0`).get().c,
    unpublishedExperiences: db.prepare(`SELECT COUNT(*) AS c FROM experiences WHERE moderation_status != 'approved' OR COALESCE(merged_into_id, '') != ''`).get().c,
    runningRelease: db.prepare(`SELECT id, version, published_at FROM releases WHERE status='running'`).get() || null
  };
}

module.exports = {
  experienceDetail,
  listDraftExperiences,
  listSkills,
  createSkill,
  listWorks,
  createWork,
  updateWork,
  draftDiff
};
