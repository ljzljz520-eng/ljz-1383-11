'use strict';

const adminState = {
  token: localStorage.getItem('archive-admin-token') || '',
  overview: null,
  editingId: null,
  revision: null,
  loadedDetail: null
};

const stageOptions = [
  ['education', '求学'],
  ['internship', '实习'],
  ['work', '作品 / 项目']
];
const lifecycleOptions = [
  ['active', '活跃 / 进行中'],
  ['paused', '暂停'],
  ['retired', '退役']
];
const moderationOptions = [
  ['approved', '批准（可发布）'],
  ['pending_review', '待审核'],
  ['draft', '草稿'],
  ['rejected', '拒绝']
];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(adminState.token ? { Authorization: `Bearer ${adminState.token}` } : {}),
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.message || `请求失败 ${response.status}`);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

function showPanel(name) {
  document.querySelectorAll('.admin-sidebar button').forEach((b) => b.classList.toggle('active', b.dataset.panel === name));
  document.querySelectorAll('.admin-panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${name}`));
}

async function login() {
  const token = document.getElementById('admin-token').value.trim();
  try {
    const result = await api('/api/admin/session', { method: 'POST', body: { token }, headers: { Authorization: '' } });
    adminState.token = result.token;
    localStorage.setItem('archive-admin-token', result.token);
    await bootstrap();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function bootstrap() {
  if (!adminState.token) {
    document.getElementById('login-panel').hidden = false;
    document.getElementById('admin-content').hidden = true;
    return;
  }
  try {
    adminState.overview = await api('/api/admin/overview');
    document.getElementById('login-panel').hidden = true;
    document.getElementById('admin-content').hidden = false;
    renderExperiencesTable();
    renderWorksTable();
    renderSkillTable();
    renderDiff();
    renderReleases();
    showPanel('experiences');
  } catch (error) {
    if (error.status === 401) {
      localStorage.removeItem('archive-admin-token');
      adminState.token = '';
    }
    document.getElementById('login-panel').hidden = false;
    document.getElementById('admin-content').hidden = true;
    showToast(error.message, 'error');
  }
}

function resetExperienceForm() {
  adminState.editingId = null;
  adminState.revision = null;
  adminState.loadedDetail = null;
  renderExperienceForm(null);
}

function renderExperiencesTable() {
  const tbody = document.querySelector('#experience-table tbody');
  tbody.replaceChildren();
  const header = el('tr');
  ['时间', '阶段', '经历', '能力 / 贡献', '作品', '版本', '操作'].forEach((h) => header.append(el('th', null, h)));
  tbody.append(header);
  adminState.overview.drafts.items.forEach((item) => {
    const tr = el('tr');
    tr.append(
      el('td', null, item.dateDisplay),
      el('td', null, stageOptions.find(([v]) => v === item.stage)?.[1] || item.stage),
      el('td', null, `${item.title}\n${item.organization}`),
      el('td', null, `${item.skills.map((s) => s.name).join('、') || '—'}\n已批准个人贡献 ${item.contributionCounts.approvedPersonal || 0} / 待处理 ${item.contributionCounts.pending || 0}`),
      el('td', null, `${item.workCount} 个关联作品`),
      el('td', null, `rev ${item.revision}`),
      el('td')
    );
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-outline btn-small';
    editBtn.textContent = '编辑';
    editBtn.addEventListener('click', () => editExperience(item.id));
    tr.lastChild.append(editBtn);

    const mergeBtn = document.createElement('button');
    mergeBtn.className = 'btn btn-outline btn-small';
    mergeBtn.style.marginLeft = '.4rem';
    mergeBtn.textContent = '合并重复';
    mergeBtn.addEventListener('click', () => mergeExperience(item.id));
    tr.lastChild.append(mergeBtn);
    tbody.append(tr);
  });
}

function dateInputHtml(name, endpoint, { end = false } = {}) {
  const precision = endpoint?.precision || 'year';
  const value = endpoint?.value || '';
  return `
    <label>${end ? '结束时间' : '开始时间'}
      <select name="${name}Precision">
        <option value="year" ${precision === 'year' ? 'selected' : ''}>只到年</option>
        <option value="month" ${precision === 'month' ? 'selected' : ''}>到月</option>
        <option value="day" ${precision === 'day' ? 'selected' : ''}>到完整日期</option>
      </select>
    </label>
    <label>${end ? '结束值（可空表示进行中）' : '开始值'}
      <input name="${name}Value" value="${esc(value)}" placeholder="${precision === 'year' ? 'YYYY' : precision === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD'}">
    </label>
  `;
}

function renderExperienceForm(detail) {
  const form = document.getElementById('experience-form');
  form.replaceChildren();
  const d = detail || {};
  const start = d.start || (d.start_value ? { value: d.start_value, precision: d.start_precision } : { value: '', precision: 'year' });
  const end = d.end || (d.end_value ? { value: d.end_value, precision: d.end_precision } : { value: '', precision: '' });
  form.innerHTML = `
    <h2 class="wide">${detail ? '编辑经历' : '新建经历'}</h2>
    <label>阶段
      <select name="stage">${stageOptions.map(([v, label]) => `<option value="${v}" ${d.stage === v ? 'selected' : ''}>${label}</option>`).join('')}</select>
    </label>
    <label>标题<input name="title" required value="${esc(d.title)}"></label>
    <label>组织 / 学校<input name="organization" value="${esc(d.organization)}"></label>
    <label>地点<input name="location" value="${esc(d.location)}"></label>
    <label>Slug（旧 slug 自动保留）<input name="slug" value="${esc(d.slug)}" placeholder="自动生成"></label>
    <label>排序辅助值<input name="sortIndex" type="number" value="${d.sort_index ?? d.sortIndex ?? 0}"></label>
    <label>生命周期
      <select name="lifecycleStatus">${lifecycleOptions.map(([v, label]) => `<option value="${v}" ${(d.lifecycle_status || d.lifecycleStatus || 'active') === v ? 'selected' : ''}>${label}</option>`).join('')}</select>
    </label>
    <label>审核状态
      <select name="moderationStatus">${moderationOptions.map(([v, label]) => `<option value="${v}" ${(d.moderation_status || d.moderationStatus || 'approved') === v ? 'selected' : ''}>${label}</option>`).join('')}</select>
    </label>
    ${dateInputHtml('start', start)}
    ${dateInputHtml('end', end, { end: true })}
    <label class="wide">摘要<textarea name="summary" rows="2">${esc(d.summary)}</textarea></label>
    <label class="wide">详细叙述<textarea name="narrative" rows="4">${esc(d.narrative)}</textarea></label>
    <section class="wide nested-card">
      <h3>能力</h3>
      <div id="skill-checkboxes"></div>
    </section>
    <section class="wide nested-card">
      <h3>个人贡献（公开快照只发布已批准项）</h3>
      <div id="contribution-editor"></div>
      <button type="button" class="btn btn-outline btn-small" id="add-contribution">增加贡献</button>
    </section>
    <section class="wide nested-card">
      <h3>关联作品（可多段经历）</h3>
      <div id="work-relations-editor"></div>
    </section>
    <section class="wide nested-card">
      <h3>作品主档案（可选；旧作品详情链接据此跳转）</h3>
      <div id="primary-work-editor"></div>
    </section>
    <div class="wide filter-actions">
      <button type="submit" class="btn btn-primary">保存草稿</button>
      <button type="button" class="btn btn-outline" id="cancel-edit">${detail ? '取消编辑' : '清空'}</button>
    </div>
  `;

  const skillBox = form.querySelector('#skill-checkboxes');
  adminState.overview.skills.forEach((s) => {
    const label = document.createElement('label');
    label.style.display = 'inline-flex';
    label.style.marginRight = '1rem';
    const checked = detail?.skills?.some((x) => x.id === s.id || x.slug === s.slug);
    label.innerHTML = `<input type="checkbox" name="skills" value="${esc(s.id)}" ${checked ? 'checked' : ''}> ${esc(s.name)}`;
    skillBox.append(label);
  });

  const contribBox = form.querySelector('#contribution-editor');
  const drawContributions = (contributions) => {
    contribBox.replaceChildren();
    contributions.forEach((c, index) => contribBox.append(contributionRow(c, index, () => {
      const values = collectContributions();
      values.splice(index, 1);
      drawContributions(values);
    })));
  };
  drawContributions(detail.contributions || []);
  form.querySelector('#add-contribution').addEventListener('click', () => {
    const values = collectContributions();
    values.push({ title: '', description: '', status: 'pending', personalContribution: true });
    drawContributions(values);
  });

  const workBox = form.querySelector('#work-relations-editor');
  adminState.overview.works.forEach((w) => {
    const relation = detail.relatedWorks?.find((x) => x.id === w.id || x.slug === w.slug);
    const label = document.createElement('label');
    label.className = 'wide';
    label.innerHTML = `<input type="checkbox" name="relatedWork" value="${esc(w.id)}" ${relation ? 'checked' : ''}> ${esc(w.title)}`;
    const note = document.createElement('input');
    note.placeholder = '在这段经历中的关系说明';
    note.dataset.work = w.id;
    note.dataset.field = 'note';
    note.value = relation?.relationNote || '';
    workBox.append(label, note);
  });

  const primaryBox = form.querySelector('#primary-work-editor');
  const primarySelect = document.createElement('select');
  primarySelect.innerHTML = `<option value="">无主作品</option>` + adminState.overview.works.map((w) => `<option value="${esc(w.id)}" ${detail.primaryWork?.workId === w.id ? 'selected' : ''}>${esc(w.title)}</option>`).join('');
  primarySelect.dataset.primaryField = 'workId';
  primaryBox.append(primarySelect);
  ['role', 'artifactSummary', 'linkLabel'].forEach((field) => {
    const input = document.createElement('input');
    input.dataset.primaryField = field;
    input.placeholder = { role: '担任角色', artifactSummary: '交付物摘要', linkLabel: '链接文案' }[field];
    input.value = detail.primaryWork?.[field] || '';
    primaryBox.append(input);
  });

  form.querySelector('#cancel-edit').addEventListener('click', resetExperienceForm);
  form.querySelectorAll('select[name$="Precision"]').forEach((select) => {
    select.addEventListener('change', () => {
      const input = form.querySelector(`input[name="${select.name.replace('Precision', 'Value')}"]`);
      input.placeholder = select.value === 'year' ? 'YYYY' : select.value === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD';
    });
  });
  form.onsubmit = saveExperience;
}

function contributionRow(c, index, onRemove) {
  const row = el('div', 'nested-card');
  row.innerHTML = `
    <div class="editor" style="margin:0;">
      <label>标题<input data-field="title" value="${esc(c.title)}"></label>
      <label>状态
        <select data-field="status">
          <option value="pending" ${c.status === 'pending' ? 'selected' : ''}>待审核</option>
          <option value="approved" ${c.status === 'approved' ? 'selected' : ''}>批准</option>
          <option value="rejected" ${c.status === 'rejected' ? 'selected' : ''}>拒绝</option>
        </select>
      </label>
      <label class="wide">描述<textarea data-field="description" rows="2">${esc(c.description)}</textarea></label>
      <label><input type="checkbox" data-field="personal" ${c.personalContribution !== false ? 'checked' : ''}> 这是个人贡献</label>
    </div>
  `;
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn btn-outline btn-small';
  remove.textContent = '删除贡献';
  remove.addEventListener('click', onRemove);
  row.append(remove);
  row.dataset.index = index;
  return row;
}

function collectContributions() {
  return [...document.querySelectorAll('#contribution-editor .nested-card')].map((row) => ({
    title: row.querySelector('[data-field="title"]').value.trim(),
    description: row.querySelector('[data-field="description"]').value.trim(),
    status: row.querySelector('[data-field="status"]').value,
    personalContribution: row.querySelector('[data-field="personal"]').checked
  })).filter((c) => c.title);
}

function collectExperiencePayload() {
  const form = document.getElementById('experience-form');
  const fd = new FormData(form);
  const primaryWorkId = form.querySelector('[data-primary-field="workId"]').value;
  return {
    revision: adminState.revision,
    stage: fd.get('stage'),
    title: fd.get('title'),
    slug: fd.get('slug'),
    organization: fd.get('organization'),
    location: fd.get('location'),
    sortIndex: Number(fd.get('sortIndex') || 0),
    lifecycleStatus: fd.get('lifecycleStatus'),
    moderationStatus: fd.get('moderationStatus'),
    start: { value: fd.get('startValue'), precision: fd.get('startPrecision') },
    end: { value: fd.get('endValue'), precision: fd.get('endPrecision') },
    summary: fd.get('summary'),
    narrative: fd.get('narrative'),
    skills: [...form.querySelectorAll('input[name="skills"]:checked')].map((i) => i.value),
    contributions: collectContributions(),
    relatedWorks: [...form.querySelectorAll('input[name="relatedWork"]:checked')].map((checkbox) => ({
      workId: checkbox.value,
      relationNote: form.querySelector(`input[data-work="${checkbox.value}"][data-field="note"]`).value
    })),
    primaryWork: primaryWorkId ? {
      workId: primaryWorkId,
      role: form.querySelector('[data-primary-field="role"]').value,
      artifactSummary: form.querySelector('[data-primary-field="artifactSummary"]').value,
      linkLabel: form.querySelector('[data-primary-field="linkLabel"]').value
    } : null
  };
}

async function editExperience(id) {
  try {
    const detail = await api(`/api/admin/experiences/${encodeURIComponent(id)}`);
    adminState.editingId = id;
    adminState.revision = detail.revision;
    adminState.loadedDetail = detail;
    renderExperienceForm(detail);
    document.getElementById('conflict-banner').hidden = true;
    window.scrollTo({ top: document.getElementById('experience-form').offsetTop - 90, behavior: 'smooth' });
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function saveExperience(event) {
  event.preventDefault();
  const payload = collectExperiencePayload();
  const path = adminState.editingId ? `/api/admin/experiences/${encodeURIComponent(adminState.editingId)}` : '/api/admin/experiences';
  try {
    const result = await api(path, {
      method: adminState.editingId ? 'PUT' : 'POST',
      body: payload,
      headers: adminState.editingId ? { 'If-Match': String(adminState.revision) } : {}
    });
    showToast(adminState.editingId ? `已保存，新修订 rev ${result.revision}` : '经历已创建');
    adminState.overview = await api('/api/admin/overview');
    renderExperiencesTable();
    renderDiff();
    adminState.editingId = result.id;
    adminState.revision = result.revision;
    renderExperienceForm(result);
  } catch (error) {
    if (error.status === 409 && error.data.currentRevision) {
      const banner = document.getElementById('conflict-banner');
      banner.hidden = false;
      banner.className = 'status-banner';
      banner.textContent = `另一台设备已经把该经历改到 rev ${error.data.currentRevision}。请打开新版本核对后，再带着本地改动重新提交；系统不会静默覆盖。`;
      adminState.revision = error.data.currentRevision;
    }
    showToast(error.message, 'error');
  }
}

async function mergeExperience(sourceId) {
  const targetId = prompt('输入要保留的目标经历 ID（将把重复经历、贡献和作品链接迁移过去）：');
  if (!targetId || targetId === sourceId) return;
  const reason = prompt('合并原因（将记录到审计和旧链接别名）：', '合并重复经历') || '';
  try {
    await api('/api/admin/experiences/merge', { method: 'POST', body: { sourceId, targetId, reason } });
    showToast('已合并；旧 slug 已转为别名，作品引用已迁移');
    adminState.overview = await api('/api/admin/overview');
    renderExperiencesTable();
    renderDiff();
    resetExperienceForm();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function renderWorksTable() {
  const tbody = document.querySelector('#work-table tbody');
  tbody.replaceChildren();
  adminState.overview.works.forEach((w) => {
    const tr = el('tr');
    tr.append(el('td', null, w.cover_icon), el('td', null, w.title), el('td', null, w.relatedExperienceTitles || '—'), el('td', null, w.lifecycle_status));
    const td = el('td');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-outline btn-small';
    btn.textContent = '填入编辑';
    btn.addEventListener('click', () => fillWorkForm(w));
    td.append(btn);
    tr.append(td);
    tbody.append(tr);
  });
}

function fillWorkForm(w) {
  const form = document.getElementById('work-form');
  form.dataset.id = w.id;
  form.elements.title.value = w.title;
  form.elements.slug.value = w.slug;
  form.elements.summary.value = w.summary;
  form.elements.url.value = w.url;
  form.elements.coverIcon.value = w.cover_icon;
  form.elements.lifecycleStatus.value = w.lifecycle_status;
}

function setupWorkForm() {
  const form = document.getElementById('work-form');
  form.innerHTML = `
    <h2 class="wide">新建 / 更新作品</h2>
    <label>标题<input name="title" required></label>
    <label>Slug<input name="slug"></label>
    <label>旧详情 URL<input name="url" placeholder="work-detail.html"></label>
    <label>图标<input name="coverIcon" value="✦"></label>
    <label>状态<select name="lifecycleStatus">${lifecycleOptions.map(([v, label]) => `<option value="${v}">${label}</option>`).join('')}</select></label>
    <label class="wide">摘要<textarea name="summary"></textarea></label>
    <button class="btn btn-primary" type="submit">保存作品</button>
  `;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(form).entries());
    try {
      if (form.dataset.id) await api(`/api/admin/works/${form.dataset.id}`, { method: 'PUT', body });
      else await api('/api/admin/works', { method: 'POST', body });
      showToast('作品已保存');
      adminState.overview = await api('/api/admin/overview');
      renderWorksTable();
      renderExperiencesTable();
      renderDiff();
    } catch (error) { showToast(error.message, 'error'); }
  });
}

function renderSkillTable() {
  const tbody = document.querySelector('#skill-table tbody');
  tbody.replaceChildren();
  adminState.overview.skills.forEach((s) => {
    const tr = el('tr');
    tr.append(el('td', null, s.name), el('td', null, s.slug), el('td', null, s.description), el('td', null, `${s.usageCount} 段经历`));
    tbody.append(tr);
  });
}

async function setupSkillForm() {
  document.getElementById('skill-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await api('/api/admin/skills', { method: 'POST', body });
      showToast('能力已新增');
      adminState.overview = await api('/api/admin/overview');
      renderSkillTable();
      renderExperiencesTable();
      event.currentTarget.reset();
    } catch (error) { showToast(error.message, 'error'); }
  });
}

function diffSection(title, items, color) {
  if (!items.length) return null;
  const box = el('div', 'diff-item');
  box.style.borderColor = color;
  box.append(el('strong', null, `${title} (${items.length})`));
  const list = el('div');
  items.forEach((i) => list.append(el('div', null, `${i.title} / ${i.slug}`)));
  box.append(list);
  return box;
}

function renderDiff() {
  const diff = adminState.overview.diff;
  const box = document.getElementById('diff-box');
  box.replaceChildren();
  const title = el('h2', null, diff.hasChanges ? '草稿包含未发布变化' : '草稿与当前冻结发布一致');
  box.append(title);
  const summary = el('p', 'card-summary', `发布将包含 ${diff.counts.experiences} 段批准经历、${diff.counts.approvedContributions} 条批准个人贡献、${diff.counts.skills} 个能力、${diff.counts.works} 个作品、${diff.counts.workRelations} 条作品-经历关系。`);
  box.append(summary);
  if (diff.pendingContributions) box.append(el('p', 'overlap-note', `${diff.pendingContributions} 条非批准或非个人贡献不会进入公开快照。`));
  if (diff.unpublishedExperiences) box.append(el('p', 'overlap-note', `${diff.unpublishedExperiences} 段草稿/待审/已合并经历不会进入公开快照。`));
  if (diff.runningRelease) box.append(el('p', 'overlap-note', `已有正在运行的发布：${diff.runningRelease.version}；访客仍读取旧的 current。`));
  const list = el('div', 'diff-list');
  [diffSection('新增', diff.added, '#10b981'), diffSection('变化', diff.changed, '#f59e0b'), diffSection('移除', diff.removed, '#ef4444')].filter(Boolean).forEach((x) => list.append(x));
  box.append(list);
}

async function renderReleases() {
  const payload = await api('/api/admin/releases');
  const box = document.getElementById('release-list');
  box.replaceChildren();
  payload.releases.forEach((r) => {
    const card = el('div', 'diff-item');
    card.append(el('strong', null, `${r.version} · ${r.status}`), el('div', 'card-summary', `${r.published_at} UTC · ${r.change_summary || '无说明'}`), el('div', 'card-summary', `hash ${r.content_hash.slice(0, 12)}…`));
    box.append(card);
  });
}

async function publish(status) {
  try {
    const result = await api('/api/admin/releases', { method: 'POST', body: { status, changeSummary: status === 'running' ? '退役/发布流程运行中预生成' : '站主发布更新' } });
    showToast(status === 'running' ? `已生成运行版本 ${result.version}，尚未替换当前视图` : `已发布 ${result.version}`);
    await Promise.all([refreshPublish(), Promise.resolve()]);
  } catch (error) { showToast(error.message, 'error'); }
}

async function refreshPublish() {
  adminState.overview = await api('/api/admin/overview');
  renderDiff();
  await renderReleases();
  renderExperiencesTable();
}

function setupPublishButtons() {
  document.getElementById('publish-current').addEventListener('click', () => publish('current'));
  document.getElementById('publish-running').addEventListener('click', () => publish('running'));
  document.getElementById('finalize-running').addEventListener('click', async () => {
    try { await api('/api/admin/releases/finalize', { method: 'POST' }); showToast('正在运行的发布已切换为当前发布'); await refreshPublish(); }
    catch (error) { showToast(error.message, 'error'); }
  });
  document.getElementById('cancel-running').addEventListener('click', async () => {
    try { await api('/api/admin/releases/running', { method: 'DELETE' }); showToast('已取消运行版本'); await refreshPublish(); }
    catch (error) { showToast(error.message, 'error'); }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('login-btn').addEventListener('click', login);
  document.getElementById('admin-token').addEventListener('keydown', (event) => { if (event.key === 'Enter') login(); });
  document.querySelectorAll('.admin-sidebar button').forEach((button) => button.addEventListener('click', () => showPanel(button.dataset.panel)));
  document.getElementById('new-experience').addEventListener('click', resetExperienceForm);
  setupWorkForm();
  setupSkillForm();
  setupPublishButtons();
  await bootstrap();
});
