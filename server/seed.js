'use strict';

const { id, dateColumns } = require('./utils');
const { validateRange } = require('./date-range');
const { createRelease } = require('./release');

function insertExperience(db, e) {
  const range = validateRange(e.start, e.startPrecision, e.end || null, e.endPrecision || null);
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
    id: e.id,
    slug: e.slug,
    stage: e.stage,
    title: e.title,
    organization: e.organization || '',
    summary: e.summary || '',
    narrative: e.narrative || '',
    location: e.location || '',
    lifecycle_status: e.lifecycleStatus || 'active',
    moderation_status: e.moderationStatus || 'approved',
    ...dateColumns(range),
    sort_index: e.sortIndex || 0
  });
}

function seedDatabase(db) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM experiences').get().c;
  if (count > 0) return false;

  const tx = db.transaction(() => {
    const skills = [
      { id: 'sk_research', slug: 'research', name: '用户研究', description: '访谈、可用性测试与需求建模' },
      { id: 'sk_ui', slug: 'ui-design', name: 'UI 设计', description: '界面视觉、设计系统与高保真原型' },
      { id: 'sk_frontend', slug: 'frontend', name: '前端实现', description: 'HTML、CSS、JavaScript 与可访问性' },
      { id: 'sk_data', slug: 'data-viz', name: '数据可视化', description: '指标口径、图表与信息层级' },
      { id: 'sk_brand', slug: 'branding', name: '品牌系统', description: '标识、色彩、排版和使用规范' },
      { id: 'sk_product', slug: 'product-strategy', name: '产品策略', description: '路线图、范围管理和验收标准' }
    ];
    const insertSkill = db.prepare(`INSERT INTO skills (id, slug, name, description) VALUES (?, ?, ?, ?)`);
    skills.forEach((s) => insertSkill.run(s.id, s.slug, s.name, s.description));

    insertExperience(db, {
      id: 'exp_undergrad',
      slug: 'interaction-design-bachelor',
      stage: 'education',
      title: '交互设计本科',
      organization: '江南设计学院',
      location: '无锡',
      summary: '建立从用户研究、信息架构到界面原型的完整设计方法。',
      narrative: '课程项目覆盖访谈、低保真原型、可用性测试和设计答辩；毕业设计关注低数字素养用户的移动银行体验。',
      start: '2018', startPrecision: 'year',
      end: '2022', endPrecision: 'year',
      sortIndex: 30
    });

    insertExperience(db, {
      id: 'exp_neofin_intern',
      slug: 'neofinance-design-internship',
      stage: 'internship',
      title: 'Neo-Finance 产品设计实习',
      organization: 'Neo Studio',
      location: '上海',
      summary: '为个人资产管理应用设计信息架构、核心仪表盘与设计令牌。',
      narrative: '在实习中与产品和前端协作，将账户、预算和储蓄目标聚合为可验证的任务流，并维护组件状态说明。',
      start: '2021-07', startPrecision: 'month',
      end: '2021-10', endPrecision: 'month',
      sortIndex: 20
    });

    insertExperience(db, {
      id: 'exp_neofin_work',
      slug: 'neofinance-app',
      stage: 'work',
      title: 'Neo-Finance 个人资产管理应用',
      organization: 'Neo Studio / 个人作品',
      location: '远程',
      summary: '跨设计实习与后续作品阶段的新拟态资产管理应用。',
      narrative: '项目从实习期间的方案验证延续到毕业后的独立改版，补充了无障碍对比、空状态和前端实现。',
      start: '2021-07', startPrecision: 'month',
      end: '2022-03', endPrecision: 'month',
      sortIndex: 10
    });

    insertExperience(db, {
      id: 'exp_solar',
      slug: 'solar-brand-system',
      stage: 'work',
      title: 'Solar 可再生能源品牌系统',
      organization: 'Solar Energy',
      location: '杭州',
      summary: '为可再生能源公司设计标识、图形语言与跨触点规范。',
      narrative: '项目跨年推进：先完成品牌定位和标识，再扩展到官网、活动物料和组件库。退役后仍保留冻结版本用于复盘。',
      start: '2020', startPrecision: 'year',
      end: '2022', endPrecision: 'year',
      lifecycleStatus: 'retired',
      sortIndex: 40
    });

    insertExperience(db, {
      id: 'exp_grad',
      slug: 'human-computer-interaction-master',
      stage: 'education',
      title: '人机交互硕士在读',
      organization: '湖畔大学',
      location: '杭州',
      summary: '研究个人数据呈现、时间建模与发布可追溯性。',
      narrative: '当前阶段关注模糊日期、版本化内容和协作冲突，并通过个人站项目把研究问题落到可验收的产品原型。',
      start: '2024-09', startPrecision: 'month',
      sortIndex: 5
    });

    const linkSkills = db.prepare(`INSERT INTO experience_skills (experience_id, skill_id) VALUES (?, ?)`);
    [
      ['exp_undergrad', 'sk_research'], ['exp_undergrad', 'sk_ui'],
      ['exp_neofin_intern', 'sk_research'], ['exp_neofin_intern', 'sk_ui'], ['exp_neofin_intern', 'sk_data'],
      ['exp_neofin_work', 'sk_ui'], ['exp_neofin_work', 'sk_frontend'], ['exp_neofin_work', 'sk_data'],
      ['exp_solar', 'sk_brand'], ['exp_solar', 'sk_ui'], ['exp_solar', 'sk_product'],
      ['exp_grad', 'sk_frontend'], ['exp_grad', 'sk_product'], ['exp_grad', 'sk_data']
    ].forEach(([experienceId, skillId]) => linkSkills.run(experienceId, skillId));

    const insertContribution = db.prepare(`
      INSERT INTO contributions (id, experience_id, title, description, personal_contribution, status, reviewed_at)
      VALUES (?, ?, ?, ?, 1, 'approved', datetime('now'))
    `);
    [
      ['con_bachelor_research', 'exp_undergrad', '毕业设计用户研究', '完成 8 名用户访谈、任务模型和三轮可用性测试。'],
      ['con_intern_ia', 'exp_neofin_intern', '账户信息架构', '梳理账户、预算和储蓄目标的层级，输出可测试任务流。'],
      ['con_intern_tokens', 'exp_neofin_intern', '设计令牌文档', '定义颜色、字号、间距和组件状态，并同步给前端。'],
      ['con_work_dashboard', 'exp_neofin_work', '仪表盘视觉与交互', '设计资产总览、趋势卡片和空状态；标记实习团队的原始数据模型为团队贡献。'],
      ['con_work_frontend', 'exp_neofin_work', '响应式前端实现', '实现卡片布局、键盘焦点和移动端适配。'],
      ['con_solar_logo', 'exp_solar', '标识与规范', '提出标识方向并完成色彩、安全边距和错误用法规范。'],
      ['con_solar_touchpoints', 'exp_solar', '官网与物料扩展', '把品牌系统扩展到官网首屏、演示文稿和展会易拉宝。'],
      ['con_grad_versioning', 'exp_grad', '版本化内容原型', '设计草稿/发布分离、乐观锁和历史版本追踪方案。']
    ].forEach(([cid, eid, title, description]) => insertContribution.run(cid, eid, title, description));

    // 未批准贡献：只存在于草稿，任何公开快照均不得出现。
    db.prepare(`
      INSERT INTO contributions (id, experience_id, title, description, personal_contribution, status)
      VALUES ('con_pending_secret', 'exp_grad', '未审核的研究结论', '内部草稿，不应出现在公开页面。', 1, 'pending')
    `).run();

    const insertWork = db.prepare(`
      INSERT INTO works (id, slug, title, summary, url, cover_icon, lifecycle_status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertWork.run('work_neofin', 'neo-finance-app', 'Neo-Finance App', '个人资产管理应用的设计与前端实现。', 'work-detail.html', '💳', 'active');
    insertWork.run('work_solar', 'solar-brand-system', 'Solar Brand System', '可再生能源公司全套品牌识别系统。', 'solar-detail.html', '☀️', 'retired');

    db.prepare(`
      INSERT INTO work_profiles (work_id, experience_id, role, artifact_summary, link_label)
      VALUES (?, ?, ?, ?, ?)
    `).run('work_neofin', 'exp_neofin_work', '设计与前端', '仪表盘、组件、空状态和响应式页面', '查看作品案例');
    db.prepare(`
      INSERT INTO work_profiles (work_id, experience_id, role, artifact_summary, link_label)
      VALUES (?, ?, ?, ?, ?)
    `).run('work_solar', 'exp_solar', '品牌设计负责人', '标识、官网首屏和跨触点规范', '查看品牌案例');

    const insertWE = db.prepare(`INSERT INTO work_experiences (work_id, experience_id, relation_note, position) VALUES (?, ?, ?, ?)`);
    insertWE.run('work_neofin', 'exp_neofin_intern', '实习阶段完成研究和初版视觉', 1);
    insertWE.run('work_neofin', 'exp_neofin_work', '作品阶段完成改版和前端实现', 2);
    insertWE.run('work_solar', 'exp_solar', '完整项目从定位到退役归档', 1);

    // 模拟一次重复经历合并：旧 slug 永久保留并指向保留经历。
    db.prepare(`
      INSERT INTO experiences (
        id, slug, stage, title, organization, summary, narrative, moderation_status,
        start_value, start_precision, start_year, start_month, start_day, ongoing, sort_index, merged_into_id
      ) VALUES (
        'exp_neofin_dup', 'neo-finance-case', 'work', 'Neo Finance Case', 'Neo Studio',
        '已合并到 Neo-Finance 个人资产管理应用。', '', 'approved',
        '2021-08', 'month', 2021, 8, 1, 0, 99, 'exp_neofin_work'
      )
    `).run();
    db.prepare(`INSERT INTO experience_aliases (slug, experience_id, note) VALUES (?, ?, ?)`)
      .run('neo-finance-case', 'exp_neofin_work', '合并重复作品卡片后的旧链接');
    db.prepare(`INSERT INTO experience_merges (id, source_experience_id, target_experience_id, reason, migrated_contributions, migrated_skills, migrated_work_links)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id('merge'), 'exp_neofin_dup', 'exp_neofin_work', '同一作品的重复经历卡片', 0, 0, 1);

    createRelease(db, { unchanged: true, version: 'v2026-10-06.01', changeSummary: '初始冻结发布：经历档案上线' });
  });
  tx();
  return true;
}

module.exports = { seedDatabase, insertExperience };
