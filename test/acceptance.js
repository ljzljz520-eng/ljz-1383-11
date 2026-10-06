'use strict';
// 经历档案验收脚本：覆盖需求中全部验收点
const BASE = process.env.BASE || 'http://localhost:3100';
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); }
}
async function j(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

  const page2b_contains = p => p.items.some(e => e.title === '翻页期间插入的项目');
(async () => {
  console.log('\n=== 1. 不精确时间：不捏造日期、显示与排序 ===');
  {
    const { data } = await j('GET', '/api/public/archive?kind=experiences&pageSize=50');
    const neo = data.items.find(e => e.title.startsWith('Neo-Finance'));
    const solar = data.items.find(e => e.title.startsWith('Solar'));
    const intern = data.items.find(e => e.title.includes('云杉'));
    ok('年仅精度 start 不出现 month/day', solar.start.precision === 'year' && solar.start.month == null);
    ok('年仅精度显示为「2024 年 至今」', solar.rangeLabel === '2024 年 至今', solar.rangeLabel);
    ok('月精度不补 day', intern.start.precision === 'month' && intern.start.day == null);
    ok('月精度显示为「2022 年 07 月」', intern.rangeLabel.startsWith('2022 年 07 月'), intern.rangeLabel);
    ok('年精度排序键是年中 2024.5 而非 2024-01-01', solar.sortKey === 2024.5, solar.sortKey);
    const keys = data.items.map(i => i.sortKey);
    ok('列表稳定降序', keys.every((k, i) => i === 0 || keys[i - 1] >= k));
  }

  console.log('\n=== 2. 跨年项目进入多个年份筛选，且不重复计数 ===');
  {
    const a = (await j('GET', '/api/public/archive?year=2024&kind=works&pageSize=50')).data;
    const b = (await j('GET', '/api/public/archive?year=2025&kind=works&pageSize=50')).data;
    const all = (await j('GET', '/api/public/archive?kind=works&pageSize=50')).data;
    ok('进行中(2024起)作品出现在 2024 筛选', a.items.some(w => w.slug === 'solar-brand-system'));
    ok('同一作品出现在 2025 筛选', b.items.some(w => w.slug === 'solar-brand-system'));
    const ids = all.items.map(w => w.slug);
    ok('全部列表中每个作品只出现一次', new Set(ids).size === ids.length);
    const neo = all.items.find(w => w.slug === 'neo-finance-app');
    ok('跨 2022 实习+2023 项目的作品归入多个年份',
      neo.years.includes(2022) && neo.years.includes(2023) && neo.years.includes(2024), neo.years);
  }

  console.log('\n=== 3. 阶段/能力筛选 + facets ===');
  {
    const edu = (await j('GET', '/api/public/archive?stage=education')).data;
    ok('求学筛选只返回 education', edu.items.every(e => e.type === 'education'));
    const fe = (await j('GET', '/api/public/archive?skill=' + encodeURIComponent('前端') + '&pageSize=50')).data;
    ok('能力筛选命中多条经历', fe.items.length >= 2, fe.items.map(x => x.title));
    ok('筛选维度来自已发布数据', edu.facets.skills.length > 0 && edu.facets.years.length > 0);
  }

  console.log('\n=== 4. 合并经历：引用迁移、旧链接不失效 ===');
  let adminToken;
  {
    const login = await j('POST', '/api/admin/login', { password: process.env.ADMIN_PASSWORD || 'admin123', device: 'test' });
    adminToken = login.data.token;
    ok('管理员登录', !!adminToken);
    const drafts = (await j('GET', '/api/admin/drafts', null, adminToken)).data;
    const neo = drafts.experiences.find(e => e.title.startsWith('Neo-Finance 资产'));
    ok('被合并经历的贡献已迁移到保留经历', neo.contributions.some(c => c.content.includes('重复条目')));
    ok('被合并经历不出现在正常草稿列表', !drafts.experiences.some(e => e.title.includes('旧标题')));
    const work = drafts.works.find(w => w.slug === 'neo-finance-app');
    ok('合并后作品关联仍有效（无悬空引用）',
      work.experiences.some(e => e.slug === neo.slug) && work.experiences.length === 2,
      work.experiences.map(e => e.slug));
    const oldSlug = Object.keys(drafts.redirects.experience)[0];
    const redir = await j('GET', '/api/public/experience/' + encodeURIComponent(oldSlug));
    ok('旧经历链接解析到新卡', redir.status === 200 && redir.data.redirectedFrom === oldSlug
      && redir.data.experience.id === drafts.redirects.experience[oldSlug]);
  }

  console.log('\n=== 5. 公开页只出现已批准贡献 ===');
  {
    const data = (await j('GET', '/api/public/archive?pageSize=50')).data;
    const uni = data.items.find(e => e.title.includes('滨海大学'));
    const neo = data.items.find(e => e.title.startsWith('Neo-Finance'));
    ok('待核实贡献不出现在公开快照', !uni.contributions.some(c => c.content.includes('待核实')));
    ok('合规审查中的贡献不公开', !neo.contributions.some(c => c.content.includes('合规审查')));
    const drafts = (await j('GET', '/api/admin/drafts', null, adminToken)).data;
    const dUni = drafts.experiences.find(e => e.title.includes('滨海大学'));
    ok('管理端草稿仍能看到全部贡献（含未批准）', dUni.contributions.length === 2);
  }

  console.log('\n=== 6. 实时草稿 vs 冻结发布 ===');
  {
    const before = (await j('GET', '/api/public/archive?pageSize=50')).data;
    await j('POST', '/api/admin/experiences', {
      type: 'project', title: '临时秘密项目 Z', start: { precision: 'year', year: 2026 },
      ongoing: true, skills: ['保密'],
      contributions: [{ content: '不应公开的贡献', approved: true }]
    }, adminToken);
    const mid = (await j('GET', '/api/public/archive?pageSize=50')).data;
    ok('保存草稿后公开视图无变化（冻结）', !mid.items.some(e => e.title === '临时秘密项目 Z'));
    const published = await j('POST', '/api/admin/publish', { note: '发布秘密项目' }, adminToken);
    const after = (await j('GET', '/api/public/archive?pageSize=50')).data;
    ok('发布后公开视图出现新内容', after.items.some(e => e.title === '临时秘密项目 Z'));
    ok('发布版本号递增', after.pubId === published.data.id && published.data.id > before.pubId);
    const old = (await j('GET', '/api/public/archive?v=' + before.pubId + '&pageSize=50')).data;
    ok('历史发布版本仍读到当时实际内容', !old.items.some(e => e.title === '临时秘密项目 Z'));
  }

  console.log('\n=== 7. 翻页期间上线新版：stale 提示但数据不割裂 ===');
  {
    const v1 = (await j('GET', '/api/public/archive?pageSize=2')).data;
    const page2 = await j('GET', '/api/public/archive?pageSize=2&after=' + encodeURIComponent(v1.nextCursor) + '&v=' + v1.pubId);
    ok('第二页游标取数正常', page2.status === 200 && page2.data.items.length > 0);
    await j('POST', '/api/admin/experiences', {
      type: 'project', title: '翻页期间插入的项目', start: { precision: 'year', year: 2026 }, ongoing: true
    }, adminToken);
    await j('POST', '/api/admin/publish', { note: '翻页期间发布' }, adminToken);
    const page2b = (await j('GET', '/api/public/archive?pageSize=2&after=' + encodeURIComponent(v1.nextCursor) + '&v=' + v1.pubId)).data;
    ok('旧版翻页仍返回旧数据且标记 stale',
      page2b.stale === true && !page2b.items.some(e => e.title === "翻页期间插入的项目"));
    ok('stale 响应带 currentPubId 供切换', page2b.currentPubId > v1.pubId);
    const anyExp = v1.items[0] || page2.data.items[0];
    const detail = await j('GET', '/api/public/experience/' + anyExp.slug + '?v=' + v1.pubId);
    ok('详情页同版本可访问', detail.status === 200 && detail.data.pubId === v1.pubId);
    const search = await j('GET', '/api/public/search?q=' + encodeURIComponent('翻页期间插入') + '&v=' + v1.pubId);
    ok('旧版本搜索搜不到新发布内容', search.data.experiences.length === 0);
    const searchNew = await j('GET', '/api/public/search?q=' + encodeURIComponent('翻页期间插入'));
    ok('切到最新版搜索可命中', searchNew.data.experiences.length === 1);
  }

  console.log('\n=== 8. 两设备并发改同一经历（乐观锁） ===');
  {
    const drafts = (await j('GET', '/api/admin/drafts', null, adminToken)).data;
    const target = drafts.experiences.find(e => e.title.includes('云杉'));
    const devA = (await j('POST', '/api/admin/login', { password: 'admin123', device: 'A' })).data.token;
    const devB = (await j('POST', '/api/admin/login', { password: 'admin123', device: 'B' })).data.token;
    const patch = v => ({
      type: target.type, title: target.title, organization: target.organization,
      summary: target.summary, start: target.start, end: target.end, ongoing: target.ongoing,
      status: target.status, version: v, skills: target.skills.map(s => s.name),
      contributions: target.contributions
    });
    const r1 = await j('PUT', '/api/admin/experiences/' + target.id, { ...patch(target.version), summary: '设备A修改' }, devA);
    ok('设备A 基于当前版本提交成功', r1.status === 200, r1.data);
    const r2 = await j('PUT', '/api/admin/experiences/' + target.id, { ...patch(target.version), summary: '设备B修改' }, devB);
    ok('设备B 用旧版本提交得到 409', r2.status === 409, r2.status);
    ok('409 返回服务端最新版本', r2.data.server && r2.data.server.version === target.version + 1
      && r2.data.server.summary === '设备A修改');
    const r3 = await j('PUT', '/api/admin/experiences/' + target.id,
      { ...patch(target.version + 1), summary: '设备B在A基础上修改' }, devB);
    ok('设备B 刷新版本后提交成功', r3.status === 200 && r3.data.version === target.version + 2);
  }

  console.log('\n=== 9. 时间精度从年改成月 ===');
  {
    const drafts = (await j('GET', '/api/admin/drafts', null, adminToken)).data;
    const solar = drafts.experiences.find(e => e.title.startsWith('Solar'));
    ok('改前 Solar 是 year 精度', solar.start.precision === 'year');
    const r = await j('PUT', '/api/admin/experiences/' + solar.id, {
      type: solar.type, title: solar.title, organization: solar.organization, summary: solar.summary,
      start: { precision: 'month', year: 2024, month: 3 },
      end: solar.end, ongoing: solar.ongoing, status: solar.status, version: solar.version,
      skills: solar.skills.map(s => s.name), contributions: solar.contributions
    }, adminToken);
    ok('精度 year->month 保存成功', r.status === 200);
    const solar2 = (await j('GET', '/api/admin/drafts', null, adminToken)).data.experiences.find(e => e.id === solar.id);
    ok('月份已存且显示更新', solar2.start.precision === 'month' && solar2.start.month === 3
      && solar2.rangeLabel.startsWith('2024 年 03 月'), solar2.rangeLabel);
    const expectedMid = 2024 + (3 - 1) / 12 + 0.5 / 12;
    ok('排序键按月中重算', Math.abs(solar2.sortKey - expectedMid) < 1e-9, solar2.sortKey);
  }

  console.log('\n=== 10. 项目退役 + 历史可追 ===');
  {
    const drafts = (await j('GET', '/api/admin/drafts', null, adminToken)).data;
    const solarWork = drafts.works.find(w => w.slug === 'solar-brand-system');
    ok('退役作品带标记（草稿）', solarWork.retired === true);
    const pub = (await j('GET', '/api/public/archive?kind=works&pageSize=50')).data;
    const w = pub.items.find(x => x.slug === 'solar-brand-system');
    ok('退役作品仍在公开快照中可追溯', !!w && w.retired === true);
    const detail = await j('GET', '/api/public/work/solar-brand-system');
    ok('退役作品详情可访问且关联经历完整', detail.status === 200 && detail.data.work.experiences.length === 1);
  }

  console.log('\n=== 11. 作品 slug 改名 -> 旧链接重定向 ===');
  {
    const drafts = (await j('GET', '/api/admin/drafts', null, adminToken)).data;
    const w = drafts.works.find(x => x.slug === 'neo-finance-app');
    const r = await j('PUT', '/api/admin/works/' + w.id, {
      title: w.title, slug: 'neo-finance-app-v2', summary: w.summary, link: w.link,
      retired: w.retired, experiences: w.experiences.map(e => ({ slug: e.slug })), version: w.version
    }, adminToken);
    ok('作品改名成功', r.status === 200);
    const oldPub = await j('GET', '/api/public/work/neo-finance-app');
    ok('发布前公开快照旧 slug 仍可用（冻结）', oldPub.status === 200);
    await j('POST', '/api/admin/publish', { note: '作品改名' }, adminToken);
    const newPub = await j('GET', '/api/public/work/neo-finance-app-v2');
    ok('发布后新 slug 可用', newPub.status === 200);
    const viaOld = await j('GET', '/api/public/work/neo-finance-app');
    ok('旧 slug 自动重定向且不留失效卡',
      viaOld.status === 200 && viaOld.data.redirectedFrom === 'neo-finance-app'
      && viaOld.data.work.slug === 'neo-finance-app-v2');
  }

  console.log('\n=== 12. 非法输入防护 ===');
  {
    const bad = await j('POST', '/api/admin/experiences', {
      type: 'project', title: '坏数据',
      start: { precision: 'month', year: 2024 }, ongoing: true
    }, adminToken);
    ok('月精度缺月份被拒', bad.status === 400, bad.data.error);
    const bad2 = await j('POST', '/api/admin/experiences', {
      type: 'project', title: '坏数据2',
      start: { precision: 'day', year: 2024, month: 2, day: 30 }, ongoing: true
    }, adminToken);
    ok('2 月 30 日被拒', bad2.status === 400, bad2.data.error);
  }

  console.log('\n=== 13. 未授权访问管理 API ===');
  {
    const r = await j('GET', '/api/admin/drafts');
    ok('无 token 访问草稿被拒', r.status === 401);
    const r2 = await j('POST', '/api/admin/login', { password: 'wrong' });
    ok('错误口令登录被拒', r2.status === 401);
  }

  console.log('\n========== 结果：' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
