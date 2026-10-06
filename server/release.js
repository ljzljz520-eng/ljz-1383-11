'use strict';

const { id, stableStringify, sha256 } = require('./utils');

const EXPERIENCE_COLUMNS = `
  id, slug, stage, title, organization, summary, narrative, location, lifecycle_status,
  start_value, start_precision, start_year, start_month, start_day,
  end_value, end_precision, end_year, end_month, end_day, ongoing, sort_index
`;

function collectSnapshot(db) {
  const experiences = db.prepare(`
    SELECT ${EXPERIENCE_COLUMNS}
    FROM experiences
    WHERE moderation_status = 'approved'
      AND COALESCE(merged_into_id, '') = ''
  `).all();

  const skillRows = db.prepare(`
    SELECT s.id, s.slug, s.name, s.description
    FROM skills s
    WHERE s.active = 1
      AND EXISTS (SELECT 1 FROM experience_skills es WHERE es.skill_id = s.id)
    ORDER BY s.name
  `).all();

  const experienceSkills = db.prepare(`
    SELECT es.experience_id, es.skill_id
    FROM experience_skills es
    JOIN experiences e ON e.id = es.experience_id
    JOIN skills s ON s.id = es.skill_id
    WHERE e.moderation_status = 'approved'
      AND COALESCE(e.merged_into_id, '') = ''
      AND s.active = 1
    ORDER BY es.experience_id, s.name
  `).all();

  const contributions = db.prepare(`
    SELECT c.id, c.experience_id, c.title, c.description, c.personal_contribution, c.status
    FROM contributions c
    JOIN experiences e ON e.id = c.experience_id
    WHERE c.status = 'approved'
      AND c.personal_contribution = 1
      AND e.moderation_status = 'approved'
      AND COALESCE(e.merged_into_id, '') = ''
    ORDER BY c.experience_id, c.title, c.id
  `).all();

  const works = db.prepare(`
    SELECT id, slug, title, summary, url, cover_icon, lifecycle_status
    FROM works
    WHERE EXISTS (
      SELECT 1 FROM work_experiences we
      JOIN experiences e ON e.id = we.experience_id
      WHERE we.work_id = works.id
        AND e.moderation_status = 'approved'
        AND COALESCE(e.merged_into_id, '') = ''
    )
    ORDER BY title, id
  `).all();

  const workProfiles = db.prepare(`
    SELECT wp.work_id, wp.experience_id, wp.role, wp.artifact_summary, wp.link_label
    FROM work_profiles wp
    JOIN works w ON w.id = wp.work_id
    WHERE wp.experience_id IS NOT NULL
    ORDER BY wp.work_id
  `).all();

  const workExperiences = db.prepare(`
    SELECT we.work_id, we.experience_id, we.relation_note, we.position
    FROM work_experiences we
    JOIN works w ON w.id = we.work_id
    JOIN experiences e ON e.id = we.experience_id
    WHERE e.moderation_status = 'approved'
      AND COALESCE(e.merged_into_id, '') = ''
    ORDER BY we.work_id, we.position, we.experience_id
  `).all();

  const aliases = db.prepare(`
    SELECT a.slug, a.experience_id, a.note
    FROM experience_aliases a
    JOIN experiences e ON e.id = a.experience_id
    WHERE e.moderation_status = 'approved'
      AND COALESCE(e.merged_into_id, '') = ''
    ORDER BY a.slug
  `).all();

  return { experiences, skills: skillRows, experienceSkills, contributions, works, workProfiles, workExperiences, aliases };
}

function snapshotHash(snapshot) {
  const canonical = {
    experiences: snapshot.experiences.map((e) => ({
      slug: e.slug, stage: e.stage, title: e.title, organization: e.organization,
      summary: e.summary, narrative: e.narrative, location: e.location,
      lifecycle_status: e.lifecycle_status, start: e.start_value, start_precision: e.start_precision,
      end: e.end_value, end_precision: e.end_precision, ongoing: e.ongoing, sort_index: e.sort_index
    })),
    skills: snapshot.skills,
    experienceSkills: snapshot.experienceSkills,
    contributions: snapshot.contributions.map((c) => ({
      experience: c.experience_id, title: c.title, description: c.description
    })),
    works: snapshot.works,
    workProfiles: snapshot.workProfiles,
    workExperiences: snapshot.workExperiences,
    aliases: snapshot.aliases
  };
  return sha256(stableStringify(canonical));
}

function nextVersion(db) {
  const date = new Date().toISOString().slice(0, 10);
  const count = db.prepare(`
    SELECT COUNT(*) AS count FROM releases WHERE substr(version, 1, 12) = ?
  `).get(`v${date}.`).count;
  return `v${date}.${String(count + 1).padStart(2, '0')}`;
}

function createRelease(db, options = {}) {
  const status = options.status === 'running' ? 'running' : 'current';
  const snapshot = collectSnapshot(db);
  const hash = snapshotHash(snapshot);
  if (options.unchanged !== true) {
    const last = db.prepare(`SELECT content_hash FROM releases WHERE status IN ('current', 'archived') ORDER BY published_at DESC, rowid DESC LIMIT 1`).get();
    if (last && last.content_hash === hash) {
      const err = new Error('草稿与当前冻结发布视图一致，无需发布');
      err.statusCode = 409;
      err.code = 'NO_CHANGES';
      throw err;
    }
  }

  const releaseId = id('rel');
  const version = options.version || nextVersion(db);
  const expIdMap = new Map(snapshot.experiences.map((e) => [e.id, id('rex')]));
  const skillIdMap = new Map(snapshot.skills.map((s) => [s.id, id('rsk')]));
  const workIdMap = new Map(snapshot.works.map((w) => [w.id, id('rwo')]));

  const tx = db.transaction(() => {
    if (status === 'current') {
      db.prepare(`UPDATE releases SET status = 'archived', superseded_at = datetime('now') WHERE status = 'current'`).run();
    }
    db.prepare(`
      INSERT INTO releases (id, version, status, content_hash, change_summary, published_by)
      VALUES (@id, @version, @status, @content_hash, @change_summary, @published_by)
    `).run({
      id: releaseId,
      version,
      status,
      content_hash: hash,
      change_summary: options.changeSummary || '',
      published_by: options.publishedBy || 'owner'
    });

    const insertExperience = db.prepare(`
      INSERT INTO release_experiences (
        id, release_id, draft_id, slug, stage, title, organization, summary, narrative, location, lifecycle_status,
        start_value, start_precision, start_year, start_month, start_day,
        end_value, end_precision, end_year, end_month, end_day, ongoing, sort_index
      ) VALUES (
        @id, @release_id, @draft_id, @slug, @stage, @title, @organization, @summary, @narrative, @location, @lifecycle_status,
        @start_value, @start_precision, @start_year, @start_month, @start_day,
        @end_value, @end_precision, @end_year, @end_month, @end_day, @ongoing, @sort_index
      )
    `);
    for (const e of snapshot.experiences) {
      insertExperience.run({ ...e, id: expIdMap.get(e.id), draft_id: e.id, release_id: releaseId });
    }

    const insertSkill = db.prepare(`
      INSERT INTO release_skills (id, release_id, draft_id, slug, name, description)
      VALUES (@id, @release_id, @draft_id, @slug, @name, @description)
    `);
    for (const s of snapshot.skills) {
      insertSkill.run({ ...s, id: skillIdMap.get(s.id), draft_id: s.id, release_id: releaseId });
    }

    const insertES = db.prepare(`
      INSERT INTO release_experience_skills (release_id, experience_id, skill_id)
      VALUES (?, ?, ?)
    `);
    for (const es of snapshot.experienceSkills) {
      insertES.run(releaseId, expIdMap.get(es.experience_id), skillIdMap.get(es.skill_id));
    }

    const insertContribution = db.prepare(`
      INSERT INTO release_contributions (id, release_id, experience_id, draft_id, title, description, personal_contribution, status)
      VALUES (@id, @release_id, @experience_id, @draft_id, @title, @description, 1, 'approved')
    `);
    for (const c of snapshot.contributions) {
      insertContribution.run({ ...c, id: id('rco'), draft_id: c.id, release_id: releaseId, experience_id: expIdMap.get(c.experience_id) });
    }

    const insertWork = db.prepare(`
      INSERT INTO release_works (id, release_id, draft_id, slug, title, summary, url, cover_icon, lifecycle_status)
      VALUES (@id, @release_id, @draft_id, @slug, @title, @summary, @url, @cover_icon, @lifecycle_status)
    `);
    for (const w of snapshot.works) {
      insertWork.run({ ...w, id: workIdMap.get(w.id), draft_id: w.id, release_id: releaseId });
    }

    const insertProfile = db.prepare(`
      INSERT INTO release_work_profiles (release_id, work_id, experience_id, role, artifact_summary, link_label)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const p of snapshot.workProfiles) {
      const workId = workIdMap.get(p.work_id);
      const experienceId = expIdMap.get(p.experience_id);
      if (workId && experienceId) insertProfile.run(releaseId, workId, experienceId, p.role, p.artifact_summary, p.link_label);
    }

    const insertWE = db.prepare(`
      INSERT INTO release_work_experiences (release_id, work_id, experience_id, relation_note, position)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const we of snapshot.workExperiences) {
      insertWE.run(releaseId, workIdMap.get(we.work_id), expIdMap.get(we.experience_id), we.relation_note, we.position);
    }

    const insertAlias = db.prepare(`
      INSERT INTO release_experience_aliases (release_id, slug, experience_id, note)
      VALUES (?, ?, ?, ?)
    `);
    for (const a of snapshot.aliases) {
      insertAlias.run(releaseId, a.slug, expIdMap.get(a.experience_id), a.note);
    }
  });

  tx();
  return { id: releaseId, version, status, contentHash: hash, counts: {
    experiences: snapshot.experiences.length,
    skills: snapshot.skills.length,
    contributions: snapshot.contributions.length,
    works: snapshot.works.length
  } };
}

function finalizeRunningRelease(db) {
  const running = db.prepare(`SELECT id FROM releases WHERE status = 'running' ORDER BY published_at DESC, rowid DESC LIMIT 1`).get();
  if (!running) {
    const err = new Error('没有正在运行的发布');
    err.statusCode = 404;
    throw err;
  }
  const tx = db.transaction(() => {
    db.prepare(`UPDATE releases SET status = 'archived', superseded_at = datetime('now') WHERE status = 'current'`).run();
    db.prepare(`UPDATE releases SET status = 'current', published_at = datetime('now') WHERE id = ?`).run(running.id);
  });
  tx();
  return db.prepare(`SELECT * FROM releases WHERE id = ?`).get(running.id);
}

function cancelRunningRelease(db) {
  const info = db.prepare(`DELETE FROM releases WHERE status = 'running'`).run();
  return { deleted: info.changes };
}

module.exports = { collectSnapshot, snapshotHash, createRelease, finalizeRunningRelease, cancelRunningRelease, EXPERIENCE_COLUMNS };
