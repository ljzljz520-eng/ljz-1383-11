'use strict';
const { getPublished, currentPubId } = require('./snapshot');

// 解析经历 slug，走"快照内冻结的重定向"，保证历史发布追到当时的映射
function resolveExperience(snapshot, key) {
  let e = snapshot.experiences.find(x => x.slug === key);
  if (e) return { experience: e, redirectedFrom: null };
  const map = snapshot.redirects.experience || {};
  const targetSlug = map[key];
  if (targetSlug != null) {
    e = snapshot.experiences.find(x => x.id === targetSlug);
    if (e) return { experience: e, redirectedFrom: key };
  }
  return { experience: null, redirectedFrom: null };
}

function resolveWork(snapshot, slug) {
  let w = snapshot.works.find(x => x.slug === slug);
  if (w) return { work: w, redirectedFrom: null };
  const newSlug = (snapshot.redirects.work || {})[slug];
  if (newSlug) {
    w = snapshot.works.find(x => x.slug === newSlug);
    if (w) return { work: w, redirectedFrom: slug };
  }
  return { work: null, redirectedFrom: null };
}

// 过滤：stage(类型) / skill / year。跨年经历与作品按 coveredYears 归入多个年份，
// 同一 id 只在结果里出现一次（不重复计数）。
function filterItems(snapshot, { stage, skill, year, kind = 'experiences' }) {
  const items = kind === 'works' ? snapshot.works : snapshot.experiences;
  return items.filter(item => {
    if (kind === 'works') {
      if (stage && !item.experiences.some(e => e.type === stage)) return false;
      if (skill && !item.experiences.some(e =>
        (e.slug && snapshot.experiences.find(x => x.slug === e.slug)?.skills || [])
          .some(s => s.slug === skill))) return false;
      if (year && !item.years.includes(Number(year))) return false;
    } else {
      if (stage && item.type !== stage) return false;
      if (skill && !item.skills.some(s => s.slug === skill)) return false;
      if (year && !item.years.includes(Number(year))) return false;
    }
    return true;
  });
}

// 稳定排序键：时间中点 desc；同点按 displayOrder/id（id 在快照中已带）
// 不精确时间不补"1 号"，中点排序让"2023 年"稳定地落在 2023 全年中间。
function sortItems(items) {
  return [...items].sort((a, b) =>
    (b.sortKey - a.sortKey) || (a.id - b.id));
}

// 游标分页：游标是 (sortKey,id) + pubId。
// 访客带着 v=<发布id> 翻页；期间若有新版上线，接口返回 stale:true，
// 但本页仍返回旧版内容——等访客点"查看新版"才整体切换，列表/详情/搜索不会割裂。
function paginate(snapshot, items, { after, pageSize = 6 }) {
  const sorted = sortItems(items);
  let startIdx = 0;
  if (after) {
    const [key, idRaw] = String(after).split('_');
    const cursorKey = Number(key);
    const cursorId = Number(idRaw);
    // 找游标之后的位置；游标必须存在于当前排序里
    const ci = sorted.findIndex(x => x.sortKey === cursorKey && x.id === cursorId);
    if (ci >= 0) startIdx = ci + 1;
  }
  const slice = sorted.slice(startIdx, startIdx + pageSize);
  const last = slice[slice.length - 1];
  return {
    items: slice,
    nextCursor: last ? `${last.sortKey}_${last.id}` : null,
    total: sorted.length,
    remaining: Math.max(0, sorted.length - startIdx - slice.length)
  };
}

// 可用筛选维度（从冻结快照生成，保证筛选链接都能打开）
function facets(snapshot) {
  const skillMap = new Map();
  for (const e of snapshot.experiences) {
    for (const s of e.skills) if (!skillMap.has(s.slug)) skillMap.set(s.slug, s);
  }
  const years = new Set();
  snapshot.experiences.forEach(e => e.years.forEach(y => years.add(y)));
  snapshot.works.forEach(w => w.years.forEach(y => years.add(y)));
  return {
    stages: [
      { slug: 'education', name: '求学' },
      { slug: 'internship', name: '实习' },
      { slug: 'project', name: '项目/作品' }
    ],
    skills: [...skillMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh')),
    years: [...years].sort((a, b) => b - a)
  };
}

// 站点搜索：同一发布快照内搜经历与作品，保证结果和年表/详情版本一致
function search(snapshot, q) {
  const term = String(q || '').trim().toLowerCase();
  if (!term) return { query: q, experiences: [], works: [] };
  const hit = text => (text || '').toLowerCase().includes(term);
  const experiences = snapshot.experiences.filter(e =>
    hit(e.title) || hit(e.organization) || hit(e.summary) ||
    hit(e.rangeLabel) || e.skills.some(s => hit(s.name)) ||
    e.contributions.some(c => hit(c.content))
  );
  const works = snapshot.works.filter(w =>
    hit(w.title) || hit(w.summary) ||
    w.experiences.some(e => hit(e.title) || hit(e.role))
  );
  return { query: term, experiences, works };
}

function listView(params) {
  const requestedId = params.v != null ? Number(params.v) : null;
  const pub = getPublished(requestedId);
  if (!pub.snapshot) return { published: false, pubId: null };
  const currentId = currentPubId();
  const items = filterItems(pub.snapshot, params);
  const page = paginate(pub.snapshot, items, params);
  return {
    published: true,
    pubId: pub.id,
    publishedAt: pub.publishedAt,
    stale: currentId !== pub.id,          // 翻页期间有新版上线
    currentPubId: currentId,
    ...page,
    facets: facets(pub.snapshot)
  };
}

module.exports = {
  resolveExperience, resolveWork, filterItems, sortItems, paginate,
  facets, search, listView, getPublished, currentPubId
};
