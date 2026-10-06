'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { initDatabase } = require('../server/db');
const { seedDatabase } = require('../server/seed');
const publicService = require('../server/public-service');
const experienceService = require('../server/experience-service');
const releaseService = require('../server/release');
const { validateRange, rangesOverlap, formatRange } = require('../server/date-range');

function seededDb() {
  const db = initDatabase(':memory:');
  seedDatabase(db);
  return db;
}

test('模糊日期按原始精度显示并保留可能重叠关系', () => {
  const a = validateRange('2021', 'year', '2021', 'year');
  const b = validateRange('2021-06', 'month', '2021-06', 'month');
  assert.equal(formatRange(a), '2021');
  assert.equal(formatRange(b), '2021-06');
  assert.equal(rangesOverlap(a, b), true);
  const c = validateRange('2022', 'year', null, null);
  assert.equal(c.end, null);
  assert.equal(formatRange(c), '2022 至今');
});

test('跨年经历可出现在多个年份筛选但只计数一次', () => {
  const db = seededDb();
  const y2020 = publicService.listExperiences(db, { year: 2020, pageSize: 50 });
  const y2021 = publicService.listExperiences(db, { year: 2021, pageSize: 50 });
  const y2022 = publicService.listExperiences(db, { year: 2022, pageSize: 50 });
  for (const result of [y2020, y2021, y2022]) {
    assert.ok(result.items.some((x) => x.slug === 'solar-brand-system'));
    assert.equal(result.items.length, new Set(result.items.map((x) => x.id)).size);
  }
});

test('公开快照只含批准的个人贡献和已批准经历', () => {
  const db = seededDb();
  const result = publicService.listExperiences(db, { pageSize: 50 });
  assert.equal(result.items.find((x) => x.slug === 'human-computer-interaction-master').contributions.some((c) => c.title.includes('未审核')), false);
  assert.equal(result.items.some((x) => x.slug === 'neo-finance-case'), false);
});

test('两设备并发保存同一经历时后提交者收到 409 乐观锁冲突', () => {
  const db = seededDb();
  const publicItem = publicService.listExperiences(db, { pageSize: 1 }).items[0];
  const adminRow = experienceService.getExperienceOrThrow(db, publicItem.draftId);
  const base = {
    stage: adminRow.stage,
    title: adminRow.title,
    slug: adminRow.slug,
    organization: adminRow.organization,
    summary: adminRow.summary,
    narrative: adminRow.narrative,
    start: adminRow.start_value ? { value: adminRow.start_value, precision: adminRow.start_precision } : null,
    end: adminRow.end_value ? { value: adminRow.end_value, precision: adminRow.end_precision } : null,
    skills: db.prepare('SELECT skill_id FROM experience_skills WHERE experience_id = ?').all(adminRow.id).map((r) => r.skill_id),
    contributions: [],
    relatedWorks: []
  };
  const first = { ...base, summary: '设备 A 的修改', primaryWork: null };
  experienceService.updateExperience(db, adminRow.id, first, adminRow.revision);
  assert.throws(() => experienceService.updateExperience(db, adminRow.id, { ...base, summary: '设备 B 的修改', primaryWork: null }, adminRow.revision), /另一台设备/);
  const refreshed = experienceService.getExperienceOrThrow(db, adminRow.id);
  const merged = { ...base, summary: '设备 B 基于 rev 2 合并后的修改', primaryWork: null };
  experienceService.updateExperience(db, adminRow.id, merged, refreshed.revision);
  assert.equal(experienceService.getExperienceOrThrow(db, adminRow.id).revision, refreshed.revision + 1);
});

test('时间精度从年改成月不伪造日期，发布后历史版本仍可追溯', () => {
  const db = seededDb();
  const before = publicService.getExperience(db, 'interaction-design-bachelor');
  assert.equal(before.item.date.start.precision, 'year');
  const current = experienceService.getExperienceOrThrow(db, 'exp_undergrad');
  experienceService.updateExperience(db, current.id, {
    stage: 'education',
    title: current.title,
    slug: current.slug,
    organization: current.organization,
    summary: current.summary,
    narrative: current.narrative,
    start: { value: '2018-09', precision: 'month' },
    end: { value: '2022-06', precision: 'month' },
    skills: [],
    contributions: [],
    relatedWorks: [],
    primaryWork: null
  }, current.revision);
  const published = releaseService.createRelease(db, { changeSummary: '时间精度改为月' });
  const old = publicService.getExperience(db, 'interaction-design-bachelor', before.release.version);
  const next = publicService.getExperience(db, 'interaction-design-bachelor', published.version);
  assert.equal(old.item.date.start.value, '2018');
  assert.equal(next.item.date.start.value, '2018-09');
  assert.match(next.item.date.display, /2018-09/);
});

test('正在运行的发布不会替换 current，完成后才切换', () => {
  const db = seededDb();
  const currentBefore = publicService.resolveRelease(db, 'latest').version;
  const current = experienceService.getExperienceOrThrow(db, 'exp_solar');
  experienceService.updateExperience(db, current.id, {
    stage: current.stage, title: current.title, slug: current.slug, organization: current.organization,
    summary: current.summary, narrative: current.narrative,
    start: { value: current.start_value, precision: current.start_precision },
    end: { value: current.end_value, precision: current.end_precision },
    lifecycleStatus: 'retired',
    skills: [], contributions: [], relatedWorks: [], primaryWork: null
  }, current.revision);
  const running = releaseService.createRelease(db, { status: 'running', changeSummary: '退役发布运行中' });
  assert.equal(publicService.resolveRelease(db, 'latest').version, currentBefore);
  releaseService.finalizeRunningRelease(db);
  assert.equal(publicService.resolveRelease(db, 'latest').version, running.version);
});

test('合并重复经历迁移作品引用和旧链接，不留下失效卡片', () => {
  const db = seededDb();
  // 构造一条有作品引用的重复实习经历。
  const source = experienceService.createExperience(db, {
    stage: 'internship',
    title: 'Neo Finance Intern Duplicate',
    slug: 'neo-finance-intern-duplicate',
    organization: 'Neo Studio',
    summary: '重复实习卡片',
    start: { value: '2021-08', precision: 'month' },
    end: { value: '2021-09', precision: 'month' },
    skills: [],
    contributions: [{ title: '重复贡献', description: '合并迁移', status: 'approved' }],
    relatedWorks: [{ workId: 'work_neofin', relationNote: '来源重复卡片' }],
    primaryWork: null
  });
  experienceService.mergeExperiences(db, source.id, 'exp_neofin_intern', '测试重复作品卡片合并');
  const links = db.prepare('SELECT * FROM work_experiences WHERE work_id = ? AND experience_id = ?').all('work_neofin', 'exp_neofin_intern');
  assert.equal(links.length, 1);
  const alias = db.prepare('SELECT * FROM experience_aliases WHERE slug = ?').get('neo-finance-intern-duplicate');
  assert.equal(alias.experience_id, 'exp_neofin_intern');
  const contribution = db.prepare('SELECT * FROM contributions WHERE title = ?').get('重复贡献');
  assert.equal(contribution.experience_id, 'exp_neofin_intern');
  releaseService.createRelease(db, { changeSummary: '合并后发布' });
  const viaOldLink = publicService.getExperience(db, 'neo-finance-intern-duplicate');
  assert.equal(viaOldLink.item.slug, 'neofinance-design-internship');
});
