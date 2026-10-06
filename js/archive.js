'use strict';

const state = {
  params: new URLSearchParams(location.search),
  data: null,
  detail: null,
  viewingHistorical: false,
  scrollY: window.scrollY,
  pollTimer: null
};

const stageLabels = { education: '求学', internship: '实习', work: '作品 / 项目' };
const lifecycleLabels = { active: '活跃 / 进行中', paused: '暂停', retired: '已退役' };
const precisionLabels = { year: '年精度', month: '月精度', day: '日精度' };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setParams(nextParams, { replace = false } = {}) {
  const clean = new URLSearchParams();
  for (const [key, value] of nextParams.entries()) {
    if (value && key !== 'from') clean.set(key, value);
  }
  const query = clean.toString();
  const url = `${location.pathname}?${query}${location.hash}`;
  history[replace ? 'replaceState' : 'pushState'](null, '', url);
  state.params = new URLSearchParams(location.search);
}

function syncForm() {
  const form = document.getElementById('filter-form');
  ['q', 'stage', 'skill', 'year', 'lifecycle'].forEach((key) => {
    const field = form.elements[key];
    if (field) field.value = state.params.get(key) || '';
  });
}

function fillFacets(data) {
  const skillSelect = document.getElementById('skill');
  const yearSelect = document.getElementById('year');
  const currentSkill = state.params.get('skill') || '';
  const currentYear = state.params.get('year') || '';
  skillSelect.replaceChildren(new Option('全部能力', ''));
  yearSelect.replaceChildren(new Option('全部年份', ''));
  data.filters.skills.forEach((s) => {
    const option = new Option(`${s.name} (${s.count})`, s.slug);
    option.dataset.id = s.id;
    skillSelect.append(option);
  });
  data.filters.years.forEach((year) => yearSelect.append(new Option(String(year), String(year))));
  skillSelect.value = currentSkill;
  yearSelect.value = currentYear;

  const releaseSelect = document.getElementById('release-select');
  const selected = state.params.get('release') || 'latest';
  if (releaseSelect.options.length === 1 && releaseSelect.dataset.loaded !== data.release.id) {
    // 历史版本由单独接口补足，保持当前快照优先。
    fetch('/api/public/releases').then((r) => r.json()).then((payload) => {
      releaseSelect.replaceChildren(new Option('当前发布', 'latest'));
      payload.releases.forEach((r) => {
        if (r.status === 'current') releaseSelect.options[0].textContent = `当前发布 ${r.version}`;
        else releaseSelect.append(new Option(`${r.version}（历史）`, r.version));
      });
      releaseSelect.value = state.params.get('release') || 'latest';
    }).catch(() => {});
    releaseSelect.dataset.loaded = data.release.id;
  }
  releaseSelect.value = selected === 'latest' ? 'latest' : selected;
}

function renderReleaseStrip(data) {
  const strip = document.getElementById('release-strip');
  strip.replaceChildren();
  strip.append('正在浏览冻结视图 ', el('strong', null, data.release.version), ` · 发布于 ${data.release.publishedAt.replace('T', ' ').slice(0, 16)} UTC`);
  if (data.release.status === 'archived') strip.append(' · 历史发布内容不可被草稿修改');
}

function overlapNote(item) {
  const precisions = new Set();
  if (item.date.start) precisions.add(item.date.start.precision);
  if (item.date.end) precisions.add(item.date.end.precision);
  if (item.date.years.length > 1) {
    return `跨年项目：可在 ${item.date.years[0]}–${item.date.years[item.date.years.length - 1]} 的年份筛选中出现，但当前结果只计数一次。`;
  }
  if (precisions.has('year') || precisions.has('month')) {
    return '日期按原始精度排序；未使用虚构的“某月一日”。';
  }
  return '';
}

function renderCard(item) {
  const card = el('article', 'work-card experience-card glass');
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.dataset.id = item.slug;

  const main = el('div');
  main.append(el('h2', null, item.title));
  const meta = el('div', 'card-meta');
  meta.append(el('span', 'pill', stageLabels[item.stage] || item.stage));
  if (item.organization) meta.append(el('span', 'pill', item.organization));
  item.skills.slice(0, 3).forEach((skill) => meta.append(el('span', 'pill skill', skill.name)));
  if (item.lifecycleStatus !== 'active') meta.append(el('span', `pill ${item.lifecycleStatus}`, lifecycleLabels[item.lifecycleStatus]));
  const precision = [item.date.start?.precision, item.date.end?.precision].filter(Boolean).map((p) => precisionLabels[p]).join(' → ');
  if (precision) meta.append(el('span', 'pill precision', precision));
  main.append(meta, el('p', 'card-summary', item.summary || '暂无摘要'));
  if (item.works.length) main.append(el('p', 'overlap-note', `关联作品：${item.works.map((w) => w.title).join('、')}`));

  const dateBox = el('div', 'card-date', item.date.display);
  dateBox.append(el('small', null, item.location || '稳定排序：进行中 → 最晚结束 → 最晚开始 → ID'));
  card.append(main, dateBox);

  const open = () => openDetail(item.slug);
  card.addEventListener('click', open);
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  });
  return card;
}

function renderPager(data) {
  const pager = document.getElementById('pager');
  pager.replaceChildren();
  const { page, totalPages, total } = data.pagination;
  document.getElementById('result-count').textContent = `${total} 段经历 / 第 ${page} / ${totalPages} 页（跨年仅计一次）`;
  if (totalPages <= 1) return;
  const makeParams = (nextPage) => {
    const params = new URLSearchParams(state.params);
    params.set('page', String(nextPage));
    return params;
  };
  const add = (label, pageNum, current = false, disabled = false) => {
    if (disabled) pager.append(el('span', null, label));
    else {
      const link = el('a', current ? 'current' : null, label);
      link.href = `?${makeParams(pageNum)}`;
      link.addEventListener('click', (event) => {
        event.preventDefault();
        state.scrollY = window.scrollY;
        setParams(makeParams(pageNum));
        load();
      });
      pager.append(link);
    }
  };
  add('‹', page - 1, false, page === 1);
  for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i += 1) add(String(i), i, i === page);
  add('›', page + 1, false, page === totalPages);
}

function pinLoadedRelease(data) {
  if (!data) return;
  const params = new URLSearchParams(state.params);
  const current = params.get('release') || 'latest';
  const next = state.viewingHistorical ? data.release.version : 'latest';
  if (current !== next) {
    if (next === 'latest') params.delete('release');
    else params.set('release', next);
    const query = params.toString();
    history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
    state.params = new URLSearchParams(location.search);
  }
}

async function load({ preserveScroll = false } = {}) {
  syncForm();
  const params = new URLSearchParams(state.params);
  params.set('pageSize', params.get('pageSize') || '12');
  document.getElementById('experience-list').replaceChildren(el('div', 'empty-state', '正在读取已发布快照…'));
  const response = await fetch(`/api/public/experiences?${params}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    document.getElementById('experience-list').replaceChildren(el('div', 'empty-state', body.message || '加载失败'));
    return;
  }
  // 整次渲染沿用同一个 release id；翻页期间发布新版不会让前后页混版。
  const data = await response.json();
  state.data = data;
  state.viewingHistorical = Boolean(state.params.get('release') && state.params.get('release') !== 'latest');
  fillFacets(data);
  renderReleaseStrip(data);
  pinLoadedRelease(data);
  const list = document.getElementById('experience-list');
  list.replaceChildren();
  if (!data.items.length) list.append(el('div', 'empty-state', '当前筛选下没有已发布经历。'));
  data.items.forEach((item) => list.append(renderCard(item)));
  renderPager(data);
  if (preserveScroll) window.scrollTo(0, state.scrollY);
}

async function openDetail(id) {
  const returnParams = new URLSearchParams(state.params);
  state.scrollY = window.scrollY;
  const params = new URLSearchParams(returnParams);
  if (state.data?.release.version) params.set('release', state.data.release.version);
  params.set('detail', id);
  history.pushState({ detail: id }, '', `?${params}`);
  state.params = new URLSearchParams(location.search);
  await renderDetail(id, state.data.release.version);
}

async function renderDetail(id, release) {
  const params = new URLSearchParams();
  if (release) params.set('release', release);
  const response = await fetch(`/api/public/experiences/${encodeURIComponent(id)}?${params}`);
  if (!response.ok) {
    window.showToast?.(await response.status === 404 ? '该卡片在当前冻结版本中不存在' : '详情加载失败', 'error');
    return;
  }
  const payload = await response.json();
  const item = payload.item;
  state.detail = item;
  const box = document.getElementById('detail-content');
  box.replaceChildren();

  const header = el('div', 'detail-header');
  const titleBox = el('div');
  titleBox.append(el('p', 'eyebrow', stageLabels[item.stage]));
  titleBox.append(el('h1', null, item.title));
  titleBox.append(el('p', null, item.organization));
  const dateBox = el('div');
  dateBox.append(el('div', 'detail-date', item.date.display));
  dateBox.append(el('small', null, `发布版本 ${payload.release.version}`));
  header.append(titleBox, dateBox);
  box.append(header);
  box.append(el('p', null, item.summary));
  if (item.narrative) box.append(el('p', 'detail-section', item.narrative));

  const note = overlapNote(item);
  if (note) box.append(el('p', 'overlap-note', note));

  const skillSection = el('section', 'detail-section');
  skillSection.append(el('h3', null, '能力标签'));
  const skillPills = el('div', 'card-meta');
  item.skills.forEach((s) => skillPills.append(el('span', 'pill skill', s.name)));
  skillSection.append(skillPills);
  box.append(skillSection);

  const contributionSection = el('section', 'detail-section');
  contributionSection.append(el('h3', null, '已批准的个人贡献'));
  const list = el('div', 'contribution-list');
  // release_contributions 的数据库约束已保证只含 approved + personal，界面也不渲染其他来源。
  item.contributions.forEach((c) => {
    const node = el('div', 'contribution-item');
    node.append(el('strong', null, c.title), el('p', 'card-summary', c.description));
    list.append(node);
  });
  if (!item.contributions.length) list.append(el('p', 'card-summary', '暂无可公开展示的个人贡献。'));
  contributionSection.append(list);
  box.append(contributionSection);

  if (item.works.length) {
    const workSection = el('section', 'detail-section');
    workSection.append(el('h3', null, '关联作品（一个作品可对应多段经历）'));
    const grid = el('div', 'related-work-grid');
    item.works.forEach((w) => {
      const card = el('div', 'related-work');
      card.append(el('div', 'icon', w.cover_icon || '✦'), el('strong', null, w.title));
      if (w.role) card.append(el('p', null, w.role));
      if (w.relation_note) card.append(el('p', 'card-summary', w.relation_note));
      if (w.lifecycle_status === 'retired' || w.lifecycleStatus === 'retired') card.append(el('span', 'pill retired', '已退役但保留版本'));
      grid.append(card);
    });
    workSection.append(grid);
    box.append(workSection);
  }

  document.getElementById('detail-view').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeDetail({ restoreUrl = true } = {}) {
  document.getElementById('detail-view').hidden = true;
  document.body.style.overflow = '';
  state.detail = null;
  if (restoreUrl) {
    const selectedRelease = state.params.get('release');
    const params = new URLSearchParams(state.params);
    params.delete('detail');
    if (selectedRelease && selectedRelease !== 'latest') params.set('release', selectedRelease);
    else params.delete('release');
    history.replaceState(null, '', `?${params.toString()}`);
    state.params = new URLSearchParams(location.search);
  }
  window.scrollTo(0, state.scrollY);
}

async function init() {
  state.viewingHistorical = Boolean(state.params.get('release') && state.params.get('release') !== 'latest');
  syncForm();
  await load();
  const initialDetail = state.params.get('detail');
  if (initialDetail) await renderDetail(initialDetail, state.params.get('release') || state.data.release.version);

  document.getElementById('filter-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    ['q', 'stage', 'skill', 'year', 'lifecycle'].forEach((key) => {
      const value = String(form.get(key) || '').trim();
      if (value) params.set(key, value);
    });
    setParams(params);
    state.scrollY = 0;
    load();
  });

  document.getElementById('release-select').addEventListener('change', (event) => {
    const params = new URLSearchParams(state.params);
    if (event.target.value === 'latest') {
      params.delete('release');
      state.viewingHistorical = false;
    } else {
      params.set('release', event.target.value);
      state.viewingHistorical = true;
    }
    params.delete('page');
    setParams(params);
    load();
  });

  document.getElementById('detail-close').addEventListener('click', () => closeDetail());
  window.addEventListener('popstate', (event) => {
    state.params = new URLSearchParams(location.search);
    if (state.params.get('detail')) {
      renderDetail(state.params.get('detail'), state.params.get('release'));
    } else {
      closeDetail({ restoreUrl: false });
      load({ preserveScroll: true });
    }
  });

  document.getElementById('new-release-btn').addEventListener('click', () => {
    const params = new URLSearchParams(state.params);
    params.delete('release');
    params.delete('page');
    setParams(params, { replace: true });
    state.viewingHistorical = false;
    document.getElementById('new-release-btn').hidden = true;
    load();
  });

  state.pollTimer = setInterval(async () => {
    if (document.hidden || state.detail || state.viewingHistorical) return;
    const response = await fetch('/api/public/experiences?page=1&pageSize=1').catch(() => null);
    if (!response?.ok) return;
    const next = await response.json();
    if (state.data && next.release.id !== state.data.release.id) {
      const btn = document.getElementById('new-release-btn');
      btn.hidden = false;
      btn.textContent = `新版本 ${next.release.version} 已上线，点击切换`;
      clearInterval(state.pollTimer);
    }
  }, 15000);
}

document.addEventListener('DOMContentLoaded', init);
