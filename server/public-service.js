'use strict';

const { formatRange, bucketYears } = require('./date-range');
const { notFound } = require('./utils');

const END_UPPER_SQL = `
  CASE
    WHEN end_year IS NULL THEN -1
    WHEN end_precision = 'year' THEN CAST(strftime('%s', printf('%04d-12-31', end_year)) / 86400 AS INTEGER)
    WHEN end_precision = 'month' THEN CAST(strftime('%s', date(printf('%04d-%02d-01', end_year, COALESCE(end_month, 1)), '+1 month', '-1 day')) / 86400 AS INTEGER)
    ELSE CAST(strftime('%s', printf('%04d-%02d-%02d', end_year, COALESCE(end_month, 1), COALESCE(end_day, 1))) / 86400 AS INTEGER)
  END
`;

const START_LOWER_SQL = `
  CASE
    WHEN start_precision = 'year' THEN CAST(strftime('%s', printf('%04d-01-01', start_year)) / 86400 AS INTEGER)
    WHEN start_precision = 'month' THEN CAST(strftime('%s', printf('%04d-%02d-01', start_year, COALESCE(start_month, 1))) / 86400 AS INTEGER)
    ELSE CAST(strftime('%s', printf('%04d-%02d-%02d', start_year, COALESCE(start_month, 1), COALESCE(start_day, 1))) / 86400 AS INTEGER)
  END
`;

const ORDER_SQL = `
  ongoing DESC,
  ${END_UPPER_SQL} DESC,
  ${START_LOWER_SQL} DESC,
  CASE stage WHEN 'education' THEN 1 WHEN 'internship' THEN 2 WHEN 'work' THEN 3 ELSE 9 END,
  sort_index,
  id
`;

function resolveRelease(db, version) {
  let row;
  if (version === 'latest' || !version) {
    row = db.prepare(`SELECT * FROM releases WHERE status = 'current' ORDER BY published_at DESC, rowid DESC LIMIT 1`).get();
  } else {
    row = db.prepare(`SELECT * FROM releases WHERE version = ? AND status IN ('current', 'archived')`).get(version);
  }
  if (!row) {
    const err = new Error('发布版本不存在');
    err.statusCode = 404;
    throw err;
  }
  return row;
}

function resolveReleaseExperience(db, release, identifier) {
  const byId = db.prepare(`SELECT * FROM release_experiences WHERE release_id = ? AND id = ?`).get(release.id, identifier);
  if (byId) return byId;
  const bySlug = db.prepare(`SELECT * FROM release_experiences WHERE release_id = ? AND slug = ?`).get(release.id, identifier);
  if (bySlug) return bySlug;
  const alias = db.prepare(`
    SELECT re.* FROM release_experience_aliases a
    JOIN release_experiences re ON re.id = a.experience_id
    WHERE a.release_id = ? AND a.slug = ?
  `).get(release.id, identifier);
  return alias;
}

function decorateExperience(db, release, row) {
  const skills = db.prepare(`
    SELECT rs.id, rs.slug, rs.name, rs.description
    FROM release_experience_skills res
    JOIN release_skills rs ON rs.id = res.skill_id
    WHERE res.release_id = ? AND res.experience_id = ?
    ORDER BY rs.name
  `).all(release.id, row.id);
  const contributions = db.prepare(`
    SELECT id, title, description, personal_contribution, status
    FROM release_contributions
    WHERE release_id = ? AND experience_id = ?
    ORDER BY title, id
  `).all(release.id, row.id);
  const works = db.prepare(`
    SELECT rw.id, rw.slug, rw.title, rw.summary, rw.url, rw.cover_icon, rw.lifecycle_status,
           rwe.relation_note, rwe.position,
           rp.role, rp.artifact_summary, rp.link_label
    FROM release_work_experiences rwe
    JOIN release_works rw ON rw.id = rwe.work_id
    LEFT JOIN release_work_profiles rp ON rp.release_id = rwe.release_id AND rp.work_id = rw.id
    WHERE rwe.release_id = ? AND rwe.experience_id = ?
    ORDER BY rwe.position, rw.title, rw.id
  `).all(release.id, row.id);
  const releaseYear = new Date(release.published_at + 'Z').getUTCFullYear();
  return {
    id: row.id,
    draftId: row.draft_id,
    slug: row.slug,
    stage: row.stage,
    title: row.title,
    organization: row.organization,
    summary: row.summary,
    narrative: row.narrative,
    location: row.location,
    lifecycleStatus: row.lifecycle_status,
    date: {
      start: row.start_value ? { value: row.start_value, precision: row.start_precision } : null,
      end: row.end_value ? { value: row.end_value, precision: row.end_precision } : null,
      ongoing: Boolean(row.ongoing),
      display: formatRange(row, releaseYear),
      precisionLabel: [row.start_precision, row.end_precision].filter(Boolean).join('/'),
      years: bucketYears([row], releaseYear)
    },
    sortIndex: row.sort_index,
    skills,
    contributions,
    works
  };
}

function listExperiences(db, params = {}) {
  const release = resolveRelease(db, params.version);
  const where = ['1=1'];
  const values = [];

  if (params.stage) {
    where.push('e.stage = ?');
    values.push(params.stage);
  }
  if (params.year) {
    const year = Number(params.year);
    if (!Number.isInteger(year)) {
      const err = new Error('年份必须是整数');
      err.statusCode = 400;
      throw err;
    }
    // 年区间相交；跨年经历可进入多个年份筛选，但列表中只有一张卡片。
    where.push('e.start_year <= ? AND COALESCE(e.end_year, ?) >= ?');
    const releaseYear = new Date(release.published_at + 'Z').getUTCFullYear();
    values.push(year, releaseYear, year);
  }
  if (params.q) {
    where.push('(e.title LIKE ? OR e.organization LIKE ? OR e.summary LIKE ? OR e.narrative LIKE ? OR EXISTS (SELECT 1 FROM release_contributions rc WHERE rc.release_id = e.release_id AND rc.experience_id = e.id AND (rc.title LIKE ? OR rc.description LIKE ?)))');
    const term = `%${String(params.q).slice(0, 100)}%`;
    values.push(term, term, term, term, term, term);
  }
  if (params.skill) {
    where.push(`EXISTS (
      SELECT 1 FROM release_experience_skills res
      JOIN release_skills rs ON rs.id = res.skill_id
      WHERE res.release_id = e.release_id AND res.experience_id = e.id
        AND (rs.slug = ? OR rs.id = ?)
    )`);
    values.push(params.skill, params.skill);
  }
  if (params.lifecycle) {
    where.push('e.lifecycle_status = ?');
    values.push(params.lifecycle);
  }

  const whereSql = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS count FROM release_experiences e WHERE e.release_id = ? AND ${whereSql}`)
    .get(release.id, ...values).count;
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(params.pageSize) || 12));
  const rows = db.prepare(`
    SELECT e.* FROM release_experiences e
    WHERE e.release_id = ? AND ${whereSql}
    ORDER BY ${ORDER_SQL}
    LIMIT ? OFFSET ?
  `).all(release.id, ...values, pageSize, (page - 1) * pageSize);
  const items = rows.map((row) => decorateExperience(db, release, row));

  const skillFacets = db.prepare(`
    SELECT rs.id, rs.slug, rs.name, COUNT(DISTINCT res.experience_id) AS count
    FROM release_skills rs
    LEFT JOIN release_experience_skills res ON res.skill_id = rs.id AND res.release_id = rs.release_id
    WHERE rs.release_id = ?
    GROUP BY rs.id
    ORDER BY rs.name
  `).all(release.id);
  const allRows = db.prepare(`SELECT * FROM release_experiences WHERE release_id = ?`).all(release.id);
  const releaseYear = new Date(release.published_at + 'Z').getUTCFullYear();
  return {
    release: {
      id: release.id,
      version: release.version,
      status: release.status,
      publishedAt: release.published_at,
      changeSummary: release.change_summary
    },
    pagination: {
      page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize))
    },
    filters: {
      stages: [
        { value: 'education', label: '求学' },
        { value: 'internship', label: '实习' },
        { value: 'work', label: '作品/项目' }
      ],
      skills: skillFacets,
      years: bucketYears(allRows, releaseYear)
    },
    items
  };
}

function getExperience(db, identifier, version) {
  const release = resolveRelease(db, version);
  const row = resolveReleaseExperience(db, release, identifier);
  if (!row) {
    const err = new Error('经历不存在');
    err.statusCode = 404;
    throw err;
  }
  return {
    release: { id: release.id, version: release.version, status: release.status, publishedAt: release.published_at, changeSummary: release.change_summary },
    item: decorateExperience(db, release, row)
  };
}

function listReleases(db) {
  return {
    releases: db.prepare(`
      SELECT id, version, status, change_summary, published_at, superseded_at, content_hash
      FROM releases WHERE status IN ('current', 'archived')
      ORDER BY published_at DESC, rowid DESC
    `).all().map((r) => ({
      id: r.id,
      version: r.version,
      status: r.status,
      changeSummary: r.change_summary,
      publishedAt: r.published_at,
      supersededAt: r.superseded_at,
      contentHash: r.content_hash
    }))
  };
}

module.exports = { listExperiences, getExperience, listReleases, resolveRelease, ORDER_SQL, END_UPPER_SQL, START_LOWER_SQL };
