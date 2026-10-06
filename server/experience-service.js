'use strict';

const { id, uniqueSlug, dateColumns, rangeFromBody } = require('./utils');

const STAGES = new Set(['education', 'internship', 'work']);
const LIFECYCLE = new Set(['active', 'paused', 'retired']);
const MODERATION = new Set(['draft', 'pending_review', 'approved', 'rejected']);
const CONTRIBUTION_STATUSES = new Set(['pending', 'approved', 'rejected']);

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function getExperienceOrThrow(db, experienceId, { includeMerged = false } = {}) {
  const row = db.prepare(`SELECT * FROM experiences WHERE id = ?`).get(experienceId);
  if (!row) {
    const err = new Error('经历不存在');
    err.statusCode = 404;
    throw err;
  }
  if (!includeMerged && row.merged_into_id) {
    const err = new Error('该经历已合并');
    err.statusCode = 409;
    err.targetId = row.merged_into_id;
    throw err;
  }
  return row;
}

function validatePayload(db, body, currentId = null) {
  if (!body || typeof body !== 'object') throw badRequest('请求体必须是对象');
  const stage = String(body.stage || '').trim();
  if (!STAGES.has(stage)) throw badRequest('阶段必须是 education、internship 或 work');
  const title = String(body.title || '').trim();
  if (!title) throw badRequest('标题不能为空');
  if (title.length > 160) throw badRequest('标题过长');
  const lifecycleStatus = body.lifecycleStatus || 'active';
  if (!LIFECYCLE.has(lifecycleStatus)) throw badRequest('生命周期状态无效');
  const moderationStatus = body.moderationStatus || 'approved';
  if (!MODERATION.has(moderationStatus)) throw badRequest('审核状态无效');
  const range = rangeFromBody(body);

  let slug = String(body.slug || '').trim();
  if (slug && !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) throw badRequest('链接标识只能使用小写字母、数字和连字符');
  const current = currentId ? getExperienceOrThrow(db, currentId, { includeMerged: true }) : null;
  if (!slug) slug = uniqueSlug(db, 'experiences', title, currentId);
  if (!current || slug !== current.slug) slug = uniqueSlug(db, 'experiences', slug, currentId);

  const skills = Array.isArray(body.skills) ? body.skills : [];
  for (const skillId of skills) {
    if (!db.prepare('SELECT id FROM skills WHERE id = ? AND active = 1').get(skillId)) throw badRequest(`能力不存在：${skillId}`);
  }
  const contributions = Array.isArray(body.contributions) ? body.contributions : [];
  for (const c of contributions) {
    if (!c || !String(c.title || '').trim()) throw badRequest('贡献标题不能为空');
    if (c.status && !CONTRIBUTION_STATUSES.has(c.status)) throw badRequest('贡献审核状态无效');
  }
  return {
    stage,
    title,
    slug,
    range,
    organization: String(body.organization || '').trim(),
    summary: String(body.summary || '').trim(),
    narrative: String(body.narrative || '').trim(),
    location: String(body.location || '').trim(),
    lifecycleStatus,
    moderationStatus,
    sortIndex: Number.isFinite(Number(body.sortIndex)) ? Number(body.sortIndex) : 0,
    skills: [...new Set(skills)],
    contributions,
    relatedWorks: Array.isArray(body.relatedWorks) ? body.relatedWorks : [],
    primaryWork: body.primaryWork === null ? null : (body.primaryWork || undefined)
  };
}

function replaceSkills(db, experienceId, skillIds) {
  db.prepare('DELETE FROM experience_skills WHERE experience_id = ?').run(experienceId);
  const stmt = db.prepare('INSERT OR IGNORE INTO experience_skills (experience_id, skill_id) VALUES (?, ?)');
  for (const skillId of skillIds) stmt.run(experienceId, skillId);
}

function replaceContributions(db, experienceId, contributions) {
  const existing = new Set(db.prepare('SELECT id FROM contributions WHERE experience_id = ?').all(experienceId).map((r) => r.id));
  const seen = new Set();
  const insert = db.prepare(`
    INSERT INTO contributions (id, experience_id, title, description, personal_contribution, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const update = db.prepare(`
    UPDATE contributions SET title = ?, description = ?, personal_contribution = ?, status = ?,
      reviewed_at = CASE WHEN status != ? AND ? IN ('approved', 'rejected') THEN datetime('now') ELSE reviewed_at END,
      updated_at = datetime('now')
    WHERE id = ? AND experience_id = ?
  `);
  const keptIds = [];
  for (const c of contributions) {
    const personal = c.personalContribution === false ? 0 : 1;
    const status = c.status || 'pending';
    const title = String(c.title).trim();
    const description = String(c.description || '').trim();
    if (c.id && existing.has(c.id) && !seen.has(c.id)) {
      update.run(title, description, personal, status, status, status, c.id, experienceId);
      seen.add(c.id);
      keptIds.push(c.id);
    } else {
      const cid = id('con');
      insert.run(cid, experienceId, title, description, personal, status);
      seen.add(cid);
      keptIds.push(cid);
    }
  }
  if (keptIds.length) {
    db.prepare(`DELETE FROM contributions WHERE experience_id = ? AND id NOT IN (${keptIds.map(() => '?').join(',')})`)
      .run(experienceId, ...keptIds);
  } else {
    db.prepare('DELETE FROM contributions WHERE experience_id = ?').run(experienceId);
  }
}

function validateWorkRef(db, workId) {
  if (!workId || !db.prepare('SELECT id FROM works WHERE id = ?').get(workId)) throw badRequest(`作品不存在：${workId}`);
}

function replaceExperienceWorks(db, experienceId, relatedWorks) {
  db.prepare('DELETE FROM work_experiences WHERE experience_id = ?').run(experienceId);
  const insert = db.prepare('INSERT INTO work_experiences (work_id, experience_id, relation_note, position) VALUES (?, ?, ?, ?)');
  relatedWorks.forEach((ref, index) => {
    if (!ref || typeof ref !== 'object') return;
    validateWorkRef(db, ref.workId);
    insert.run(ref.workId, experienceId, String(ref.relationNote || ''), Number.isFinite(Number(ref.position)) ? Number(ref.position) : index + 1);
  });
}

function upsertPrimaryWorkProfile(db, experienceId, primaryWork) {
  if (primaryWork === undefined) return;
  db.prepare('DELETE FROM work_profiles WHERE experience_id = ?').run(experienceId);
  if (!primaryWork || !primaryWork.workId) return;
  validateWorkRef(db, primaryWork.workId);
  const existing = db.prepare('SELECT * FROM work_profiles WHERE work_id = ?').get(primaryWork.workId);
  if (existing && existing.experience_id !== experienceId) {
    // 同一作品只保留一个“主经历”；旧主经历仍通过 work_experiences 关联，不产生孤儿卡片。
    db.prepare('UPDATE work_profiles SET experience_id = NULL WHERE work_id = ?').run(primaryWork.workId);
  }
  db.prepare(`
    INSERT INTO work_profiles (work_id, experience_id, role, artifact_summary, link_label, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(work_id) DO UPDATE SET
      experience_id = excluded.experience_id,
      role = excluded.role,
      artifact_summary = excluded.artifact_summary,
      link_label = excluded.link_label,
      updated_at = datetime('now')
  `).run(
    primaryWork.workId,
    experienceId,
    String(primaryWork.role || ''),
    String(primaryWork.artifactSummary || ''),
    String(primaryWork.linkLabel || ''),
  );
}

function createExperience(db, body) {
  const data = validatePayload(db, body);
  const experienceId = id('exp');
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO experiences (
        id, slug, stage, title, organization, summary, narrative, location, lifecycle_status, moderation_status,
        start_value, start_precision, start_year, start_month, start_day,
        end_value, end_precision, end_year, end_month, end_day, ongoing, sort_index
      ) VALUES (
        @id, @slug, @stage, @title, @organization, @summary, @narrative, @location, @lifecycle_status, @moderation_status,
        @start_value, @start_precision, @start_year, @start_month, @start_day,
        @end_value, @end_precision, @end_year, @end_month, @end_day, @ongoing, @sort_index
      )
    `).run({
      id: experienceId,
      slug: data.slug,
      stage: data.stage,
      title: data.title,
      organization: data.organization,
      summary: data.summary,
      narrative: data.narrative,
      location: data.location,
      lifecycle_status: data.lifecycleStatus,
      moderation_status: data.moderationStatus,
      ...dateColumns(data.range),
      sort_index: data.sortIndex
    });
    replaceSkills(db, experienceId, data.skills);
    replaceContributions(db, experienceId, data.contributions);
    replaceExperienceWorks(db, experienceId, data.relatedWorks);
    upsertPrimaryWorkProfile(db, experienceId, data.primaryWork);
  });
  tx.immediate();
  return getExperienceOrThrow(db, experienceId);
}

function updateExperience(db, experienceId, body, expectedRevision) {
  const current = getExperienceOrThrow(db, experienceId);
  const revision = Number(expectedRevision ?? body.revision);
  if (!Number.isFinite(revision) || revision !== current.revision) {
    const err = new Error('经历已在另一台设备上修改，请刷新后合并你的改动');
    err.statusCode = 409;
    err.current = current.revision;
    throw err;
  }
  const data = validatePayload(db, body, experienceId);
  const tx = db.transaction(() => {
    if (data.slug !== current.slug) {
      db.prepare('INSERT OR IGNORE INTO experience_aliases (slug, experience_id, note) VALUES (?, ?, ?)')
        .run(current.slug, experienceId, '修改链接标识后保留的旧地址');
    }
    db.prepare(`
      UPDATE experiences SET
        slug = @slug, stage = @stage, title = @title, organization = @organization,
        summary = @summary, narrative = @narrative, location = @location,
        lifecycle_status = @lifecycle_status, moderation_status = @moderation_status,
        start_value = @start_value, start_precision = @start_precision,
        start_year = @start_year, start_month = @start_month, start_day = @start_day,
        end_value = @end_value, end_precision = @end_precision,
        end_year = @end_year, end_month = @end_month, end_day = @end_day,
        ongoing = @ongoing, sort_index = @sort_index,
        revision = revision + 1, updated_at = datetime('now')
      WHERE id = @id
    `).run({
      id: experienceId,
      slug: data.slug,
      stage: data.stage,
      title: data.title,
      organization: data.organization,
      summary: data.summary,
      narrative: data.narrative,
      location: data.location,
      lifecycle_status: data.lifecycleStatus,
      moderation_status: data.moderationStatus,
      ...dateColumns(data.range),
      sort_index: data.sortIndex
    });
    replaceSkills(db, experienceId, data.skills);
    replaceContributions(db, experienceId, data.contributions);
    replaceExperienceWorks(db, experienceId, data.relatedWorks);
    upsertPrimaryWorkProfile(db, experienceId, data.primaryWork);
  });
  tx.immediate();
  return getExperienceOrThrow(db, experienceId);
}

function mergeExperiences(db, sourceId, targetId, reason = '') {
  if (sourceId === targetId) throw badRequest('不能合并同一条经历');
  const source = getExperienceOrThrow(db, sourceId, { includeMerged: true });
  const target = getExperienceOrThrow(db, targetId);
  if (source.merged_into_id) throw badRequest('来源经历已经合并');
  if (source.stage !== target.stage) throw badRequest('只能合并相同阶段的重复经历');

  const tx = db.transaction(() => {
    const migratedContributions = db.prepare('SELECT COUNT(*) AS c FROM contributions WHERE experience_id = ?').get(sourceId).c;
    db.prepare('UPDATE OR IGNORE contributions SET experience_id = ? WHERE experience_id = ?').run(targetId, sourceId);
    db.prepare('DELETE FROM contributions WHERE experience_id = ?').run(sourceId);

    const migratedSkills = db.prepare('SELECT COUNT(*) AS c FROM experience_skills WHERE experience_id = ?').get(sourceId).c;
    db.prepare('INSERT OR IGNORE INTO experience_skills (experience_id, skill_id) SELECT ?, skill_id FROM experience_skills WHERE experience_id = ?')
      .run(targetId, sourceId);
    db.prepare('DELETE FROM experience_skills WHERE experience_id = ?').run(sourceId);

    const sourceWorkLinks = db.prepare('SELECT * FROM work_experiences WHERE experience_id = ?').all(sourceId);
    let migratedWorkLinks = 0;
    for (const link of sourceWorkLinks) {
      const targetHas = db.prepare('SELECT 1 FROM work_experiences WHERE work_id = ? AND experience_id = ?').get(link.work_id, targetId);
      if (targetHas) {
        db.prepare('DELETE FROM work_experiences WHERE work_id = ? AND experience_id = ?').run(link.work_id, sourceId);
      } else {
        db.prepare('UPDATE work_experiences SET experience_id = ?, position = MIN(position, ?) WHERE work_id = ? AND experience_id = ?')
          .run(targetId, link.position, link.work_id, sourceId);
      }
      migratedWorkLinks += 1;
    }

    const sourceProfile = db.prepare('SELECT * FROM work_profiles WHERE experience_id = ?').get(sourceId);
    if (sourceProfile) {
      const targetProfile = db.prepare('SELECT * FROM work_profiles WHERE experience_id = ?').get(targetId);
      if (targetProfile && targetProfile.work_id === sourceProfile.work_id) {
        db.prepare(`
          UPDATE work_profiles
          SET role = CASE WHEN role = '' THEN ? ELSE role END,
              artifact_summary = CASE WHEN artifact_summary = '' THEN ? ELSE artifact_summary END,
              link_label = CASE WHEN link_label = '' THEN ? ELSE link_label END,
              updated_at = datetime('now')
          WHERE experience_id = ?
        `).run(sourceProfile.role, sourceProfile.artifact_summary, sourceProfile.link_label, targetId);
        db.prepare('UPDATE work_profiles SET experience_id = NULL WHERE work_id = ? AND experience_id = ?').run(sourceProfile.work_id, sourceId);
      } else if (!targetProfile) {
        db.prepare('UPDATE work_profiles SET experience_id = ? WHERE work_id = ? AND experience_id = ?').run(targetId, sourceProfile.work_id, sourceId);
      } else {
        // 目标已有另一部主作品：保留作品与多经历引用，但解除来源的唯一主档案。
        db.prepare('UPDATE work_profiles SET experience_id = NULL WHERE experience_id = ?').run(sourceId);
      }
    }

    db.prepare('INSERT OR IGNORE INTO experience_aliases (slug, experience_id, note) VALUES (?, ?, ?)')
      .run(source.slug, targetId, reason || '合并重复经历');
    db.prepare(`
      INSERT OR IGNORE INTO experience_aliases (slug, experience_id, note)
      SELECT slug, ?, note FROM experience_aliases WHERE experience_id = ?
    `).run(targetId, sourceId);
    db.prepare('DELETE FROM experience_aliases WHERE experience_id = ?').run(sourceId);

    db.prepare(`
      UPDATE experiences
      SET merged_into_id = ?, slug = ?, moderation_status = 'draft', updated_at = datetime('now')
      WHERE id = ?
    `).run(targetId, `__merged_${sourceId}`, sourceId);
    db.prepare(`
      UPDATE experiences SET revision = revision + 1, updated_at = datetime('now') WHERE id = ?
    `).run(targetId);
    db.prepare(`
      INSERT INTO experience_merges (id, source_experience_id, target_experience_id, reason, migrated_contributions, migrated_skills, migrated_work_links)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id('merge'), sourceId, targetId, reason, migratedContributions, migratedSkills, migratedWorkLinks);
  });
  tx.immediate();
  return getExperienceOrThrow(db, targetId, { includeMerged: true });
}

module.exports = {
  createExperience,
  updateExperience,
  mergeExperiences,
  getExperienceOrThrow,
  validatePayload
};
