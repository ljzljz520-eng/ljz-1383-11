'use strict';
// 演示数据：覆盖精度混合、跨年、一段经历多作品、待审/已批准贡献
const db = require('./db');
const t = require('./time');
const admin = require('./admin');
const snap = require('./snapshot');

function empty() {
  return db.prepare('SELECT COUNT(*) n FROM experiences').get().n === 0;
}

function seed() {
  if (!empty()) { console.log('数据库已有数据，跳过 seed'); return; }

  // 经历（草稿）
  const uni = admin.createExperience({
    type: 'education', title: '滨海大学 · 设计学本科', organization: '滨海大学',
    summary: '主修视觉传达与交互设计，辅修计算机基础课程。',
    start: { precision: 'year', year: 2019 },
    end: { precision: 'year', year: 2023 }, ongoing: false,
    skills: ['视觉设计', '设计史', '用户研究'],
    contributions: [
      { content: '毕业设计「无障碍信息图表」获校级优秀毕业设计', approved: true },
      { content: '校学生会宣传部技术负责人（待核实，暂不公开）', approved: false }
    ],
    status: 'approved'
  });

  const intern1 = admin.createExperience({
    type: 'internship', title: '云杉科技 · 前端实习', organization: '云杉科技有限公司',
    summary: '参与数据看板与组件库建设。',
    start: { precision: 'month', year: 2022, month: 7 },
    end: { precision: 'month', year: 2022, month: 9 }, ongoing: false,
    skills: ['前端', 'TypeScript', '可视化'],
    contributions: [
      { content: '基于 ECharts 封装 12 个业务图表组件，被 3 个产品线复用', approved: true },
      { content: '推动看板首屏渲染时间下降 38%', approved: true }
    ],
    status: 'approved'
  });

  const intern2 = admin.createExperience({
    type: 'internship', title: '灵犀交互 · 交互设计实习', organization: '灵犀交互工作室',
    summary: '移动端产品的交互方案与可用性测试。',
    start: { precision: 'month', year: 2023, month: 3 },
    end: { precision: 'month', year: 2023, month: 8 }, ongoing: false,
    skills: ['交互设计', '用户研究', '原型'],
    contributions: [
      { content: '主导 2 轮共 16 人的可用性测试并输出改版方案', approved: true }
    ],
    status: 'approved'
  });

  const neo = admin.createExperience({
    type: 'project', title: 'Neo-Finance 资产管理应用', organization: '个人项目',
    summary: '新拟态风格的个人资产管理应用，从设计到前端实现的完整实践。',
    start: { precision: 'month', year: 2023, month: 10 },
    end: { precision: 'day', year: 2024, month: 2, day: 18 }, ongoing: false,
    skills: ['UI 设计', '前端', '产品'],
    contributions: [
      { content: '完成完整设计系统（42 个组件）与高保真原型', approved: true },
      { content: '使用 Vue 3 + IndexedDB 实现离线记账', approved: true },
      { content: '某投资建议模块（合规审查中，不公开）', approved: false }
    ],
    status: 'approved'
  });

  // 跨年且仍在进行的项目：只精确到年
  const solar = admin.createExperience({
    type: 'project', title: 'Solar 品牌识别系统', organization: 'Solar Renewable',
    summary: '为可再生能源公司打造的全套品牌识别系统，跨年持续迭代。',
    start: { precision: 'year', year: 2024 },
    end: null, ongoing: true,
    skills: ['品牌视觉', '视觉设计', '动效'],
    contributions: [
      { content: '设计 Logo、VI 规范与 20+ 触点物料', approved: true },
      { content: '官网落地页动效实现', approved: true }
    ],
    status: 'approved'
  });

  // 用于演示合并的重复经历
  const dup = admin.createExperience({
    type: 'project', title: 'Neo Finance（旧标题/重复录入）', organization: null,
    summary: '早期重复录入的同一段经历。',
    start: { precision: 'year', year: 2023 },
    end: { precision: 'year', year: 2024 }, ongoing: false,
    skills: ['UI 设计'],
    contributions: [{ content: '重复条目里的贡献，合并后应迁移', approved: true }],
    status: 'approved'
  });

  // 作品：一个作品关联多段经历（跨年出现在多个筛选年份）
  admin.createWork({
    title: 'Neo-Finance App',
    slug: 'neo-finance-app',
    summary: '基于新拟态风格的个人资产管理应用，整合实习期间的可视化能力与后续独立开发。',
    link: 'work-detail.html',
    retired: false,
    experiences: [
      { slug: db.prepare('SELECT slug FROM experiences WHERE id=?').get(intern1).slug, role: '图表组件' },
      { slug: db.prepare('SELECT slug FROM experiences WHERE id=?').get(neo).slug, role: '设计与主程' },
      { slug: db.prepare('SELECT slug FROM experiences WHERE id=?').get(dup).slug, role: '早期原型' }
    ]
  });

  admin.createWork({
    title: 'Solar 品牌系统',
    slug: 'solar-brand-system',
    summary: '可再生能源公司品牌识别系统，含 Logo、VI 与动效。',
    link: 'solar-detail.html',
    retired: true, // 退役项目：历史发布仍可追
    experiences: [
      { slug: db.prepare('SELECT slug FROM experiences WHERE id=?').get(solar).slug, role: '主设计师' }
    ]
  });

  // 合并重复经历：dup -> neo，验证引用迁移与旧链接
  admin.mergeExperiences(neo, [dup]);

  // 初始发布
  const pub = snap.publish('初始发布：五段经历、两个作品');
  console.log('seed 完成，初始发布版本 #' + pub.id);
}

seed();
