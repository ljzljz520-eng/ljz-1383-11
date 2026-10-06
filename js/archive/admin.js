'use strict';
(function () {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let token = localStorage.getItem('archive_token') || '';
  const STAGE_NAME = { education: '求学', internship: '实习', project: '项目' };
  let drafts = null;
  let editingContribs = [];
  let selectedMerge = new Set();

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 401) { showLogin(); throw new Error('未登录'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || '请求失败'), { status: res.status, data });
    return data;
  }

  function showLogin() {
    $('#login-view').style.display = 'block';
    $('#admin-view').style.display = 'none';
  }
  function showAdmin() {
    $('#login-view').style.display = 'none';
    $('#admin-view').style.display = 'block';
    refresh();
  }

  $('#login-btn').onclick = async () => {
    try {
      const data = await api('POST', '/api/admin/login', {
        password: $('#login-pw').value, device: $('#login-device').value || '未知设备'
      });
      token = data.token;
      localStorage.setItem('archive_token', token);
      showAdmin();
    } catch (e) { showToast(e.message, 'error'); }
  };
  $('#logout-link').onclick = async e => {
    e.preventDefault();
    try { await api('POST', '/api/admin/logout'); } catch (_) {}
    localStorage.removeItem('archive_token'); token = ''; showLogin();
  };

  // ---------- tabs ----------
  $$('.tabs-admin .btn').forEach(btn => btn.onclick = () => {
    $$('.tabs-admin .btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    ['experiences', 'works', 'publish', 'sessions'].forEach(t =>
      $('#tab-' + t).style.display = t === btn.dataset.tab ? 'block' : 'none');
    if (btn.dataset.tab === 'publish') loadPubs();
    if (btn.dataset.tab === 'sessions') loadSessions();
  });

  // ---------- 草稿加载与渲染 ----------
  async function refresh() {
    drafts = await api('GET', '/api/admin/drafts');
    renderExperiences();
    renderWorks();
    $('#work-exps').innerHTML = drafts.experiences.map(e =>
      `<option value="${e.slug}">${esc(e.title)}（${STAGE_NAME[e.type]}）</option>`).join('');
  }

  function renderExperiences() {
    $('#exp-count').textContent = `共 ${drafts.experiences.length} 条（不含已合并）`;
    $('#exp-tbody').innerHTML = drafts.experiences.map(e => `
      <tr>
        <td><input type="checkbox" data-merge="${e.id}" ${selectedMerge.has(e.id) ? 'checked' : ''}></td>
        <td><strong>${esc(e.title)}</strong>${e.organization ? `<br><small class="pub-note">${esc(e.organization)}</small>` : ''}</td>
        <td>${STAGE_NAME[e.type]}</td>
        <td>${esc(e.rangeLabel)}<br><small class="pub-note">精度 ${e.start.precision}${e.end ? '–' + e.end.precision : ''}</small></td>
        <td><span class="pill ${e.status}">${{ approved: '已批准', pending: '待审', hidden: '隐藏' }[e.status]}</span></td>
        <td>${e.contributions.filter(c => c.approved).length}/${e.contributions.length} 已批准</td>
        <td>${e.works.length}</td>
        <td>v${e.version}</td>
        <td>
          <button class="btn btn-sm btn-primary" data-edit="${e.id}">编辑</button>
          <button class="btn btn-sm btn-danger" data-del="${e.id}">删除</button>
        </td>
      </tr>`).join('');
    $$('#exp-tbody [data-edit]').forEach(b => b.onclick = () => openExp(Number(b.dataset.edit)));
    $$('#exp-tbody [data-del]').forEach(b => b.onclick = () => removeExp(Number(b.dataset.del)));
    $$('#exp-tbody [data-merge]').forEach(cb => cb.onchange = () => {
      const id = Number(cb.dataset.merge);
      cb.checked ? selectedMerge.add(id) : selectedMerge.delete(id);
    });
  }

  function renderWorks() {
    $('#work-tbody').innerHTML = drafts.works.map(w => `
      <tr>
        <td><strong>${esc(w.title)}</strong>${w.retired ? ' <span class="pill hidden">已退役</span>' : ''}</td>
        <td><code>${esc(w.slug)}</code></td>
        <td>${w.experiences.map(e => esc(e.title)).join('、') || '<span class="pub-note">无</span>'}</td>
        <td>${w.retired ? '是' : '否'}</td>
        <td>v${w.version}</td>
        <td>
          <button class="btn btn-sm btn-primary" data-wedit="${w.id}">编辑</button>
          <button class="btn btn-sm btn-danger" data-wdel="${w.id}">删除</button>
        </td>
      </tr>`).join('');
    $$('#work-tbody [data-wedit]').forEach(b => b.onclick = () => openWork(Number(b.dataset.wedit)));
    $$('#work-tbody [data-wdel]').forEach(b => b.onclick = () => removeWork(Number(b.dataset.wdel)));
  }

  // ---------- 经历编辑 ----------
  function syncPrecisionUI(prefix) {
    const p = $('#' + prefix + '-precision').value;
    const month = $('#' + prefix + '-month'), day = $('#' + prefix + '-day');
    month.style.display = (p === 'month' || p === 'day') ? 'block' : 'none';
    day.style.display = p === 'day' ? 'block' : 'none';
  }
  $('#start-precision').onchange = () => {
    syncPrecisionUI('start');
    const hint = { year: '只有年份：排序按年中处理，绝不伪造成 1 月 1 日',
                   month: '精确到月：排序按月中处理，不补 1 号',
                   day: '完整日期，精确排序' }[$('#start-precision').value];
    $('#start-hint').textContent = hint;
  };
  $('#end-precision').onchange = () => {
    const ongoing = $('#end-precision').value === 'ongoing';
    ['end-year', 'end-month', 'end-day'].forEach(id => $('#' + id).style.display =
      ongoing ? 'none' : ($('#end-precision').value === 'year' && id !== 'end-year') ? 'none' :
      ($('#end-precision').value === 'month' && id === 'end-day') ? 'none' : 'block');
    if (ongoing) return;
    syncPrecisionUI('end');
  };

  function readPart(prefix) {
    const precision = prefix === 'end' && $('#end-precision').value === 'ongoing' ? null : $('#' + prefix + '-precision').value;
    if (!precision) return null;
    const part = { precision, year: Number($('#' + prefix + '-year').value) || null };
    if (precision === 'month' || precision === 'day') part.month = Number($('#' + prefix + '-month').value) || null;
    if (precision === 'day') part.day = Number($('#' + prefix + '-day').value) || null;
    return part;
  }
  function fillPart(prefix, part, ongoingEnd) {
    if (prefix === 'end') {
      $('#end-precision').value = ongoingEnd || !part ? 'ongoing' : part.precision;
      $('#end-precision').dispatchEvent(new Event('change'));
      if (part) { $('#end-year').value = part.year; $('#end-month').value = part.month || ''; $('#end-day').value = part.day || ''; }
      else { $('#end-year').value = ''; $('#end-month').value = ''; $('#end-day').value = ''; }
      return;
    }
    $('#start-precision').value = part.precision;
    $('#start-precision').dispatchEvent(new Event('change'));
    $('#start-year').value = part.year;
    $('#start-month').value = part.month || '';
    $('#start-day').value = part.day || '';
  }

  function renderContribs() {
    $('#contrib-rows').innerHTML = editingContribs.map((c, i) => `
      <div class="contrib-row">
        <input type="checkbox" ${c.approved ? 'checked' : ''} data-cappr="${i}" title="批准后公开">
        <textarea data-ccontent="${i}">${esc(c.content)}</textarea>
        <button type="button" class="btn btn-sm btn-danger" data-cdel="${i}">×</button>
      </div>`).join('');
    $$('#contrib-rows [data-cappr]').forEach(cb => cb.onchange = () => editingContribs[Number(cb.dataset.cappr)].approved = cb.checked);
    $$('#contrib-rows [data-ccontent]').forEach(t => t.oninput = () => editingContribs[Number(t.dataset.ccontent)].content = t.value);
    $$('#contrib-rows [data-cdel]').forEach(b => b.onclick = () => { editingContribs.splice(Number(b.dataset.cdel), 1); renderContribs(); });
  }
  $('#add-contrib').onclick = () => { editingContribs.push({ content: '', approved: false }); renderContribs(); };

  function openExp(id) {
    const e = id ? drafts.experiences.find(x => x.id === id) : null;
    $('#conflict-box').innerHTML = '';
    $('#exp-id').value = e ? e.id : '';
    $('#exp-version').value = e ? e.version : '';
    $('#exp-modal-title').textContent = e ? `编辑：${e.title}` : '新建经历';
    $('#exp-type').value = e ? e.type : 'education';
    $('#exp-status').value = e ? e.status : 'approved';
    $('#exp-title').value = e ? e.title : '';
    $('#exp-org').value = e ? (e.organization || '') : '';
    $('#exp-summary').value = e ? (e.summary || '') : '';
    fillPart('start', e ? e.start : { precision: 'year', year: new Date().getFullYear() });
    fillPart('end', e ? e.end : null, e ? e.ongoing : true);
    $('#exp-skills').value = e ? e.skills.map(s => s.name).join(', ') : '';
    editingContribs = e ? e.contributions.map(c => ({ ...c })) : [];
    renderContribs();
    $('#exp-modal').classList.add('open');
  }
  $('#new-exp-btn').onclick = () => openExp(null);
  $('#exp-cancel').onclick = () => $('#exp-modal').classList.remove('open');

  $('#exp-save').onclick = async () => {
    const body = {
      type: $('#exp-type').value,
      status: $('#exp-status').value,
      title: $('#exp-title').value.trim(),
      organization: $('#exp-org').value.trim(),
      summary: $('#exp-summary').value.trim(),
      start: readPart('start'),
      end: readPart('end'),
      ongoing: $('#end-precision').value === 'ongoing',
      skills: $('#exp-skills').value.split(',').map(s => s.trim()).filter(Boolean),
      contributions: editingContribs.filter(c => c.content.trim())
    };
    if (!body.title) return showToast('请填写标题', 'error');
    if (!body.start || !body.start.year) return showToast('请填写开始年份', 'error');
    const id = $('#exp-id').value;
    try {
      if (id) {
        body.version = Number($('#exp-version').value);
        await api('PUT', '/api/admin/experiences/' + id, body);
      } else {
        await api('POST', '/api/admin/experiences', body);
      }
      showToast('已保存到草稿（公开页需发布后更新）');
      $('#exp-modal').classList.remove('open');
      refresh();
    } catch (e) {
      if (e.status === 409 && e.data.server) {
        // 两设备并发：展示服务端最新版本，允许"覆盖"或放弃
        const s = e.data.server;
        $('#conflict-box').innerHTML = `<div class="conflict-box">
          <strong>⚠ 并发冲突：</strong>另一台设备已把该经历改到 v${s.version}（${esc(s.rangeLabel)}）。<br>
          你当前编辑基于旧版本 v${$('#exp-version').value}。点"用服务端版本覆盖编辑框"可看到对方改动。
          <div style="margin-top:.6rem;"><button type="button" class="btn btn-sm" id="take-server">用服务端版本覆盖编辑框</button></div>
        </div>`;
        $('#take-server').onclick = () => {
          $('#exp-version').value = s.version;
          $('#exp-type').value = s.type; $('#exp-status').value = s.status;
          $('#exp-title').value = s.title; $('#exp-org').value = s.organization || '';
          $('#exp-summary').value = s.summary || '';
          fillPart('start', s.start); fillPart('end', s.end, s.ongoing);
          $('#exp-skills').value = s.skills.map(x => x.name).join(', ');
          editingContribs = s.contributions.map(c => ({ ...c }));
          renderContribs();
          showToast('已载入服务端 v' + s.version + '，确认后可再次保存');
        };
      } else showToast(e.message, 'error');
    }
  };

  async function removeExp(id) {
    if (!confirm('确定删除该经历？有关联作品时会改为"隐藏"以避免失效卡片。')) return;
    const r = await api('DELETE', '/api/admin/experiences/' + id);
    showToast(r.result === 'hidden' ? '已隐藏（仍被作品引用）' : '已删除');
    refresh();
  }

  // ---------- 合并 ----------
  $('#merge-btn').onclick = async () => {
    if (selectedMerge.size < 2) return showToast('请勾选至少两条经历', 'error');
    const ids = [...selectedMerge];
    const list = ids.map(id => {
      const e = drafts.experiences.find(x => x.id === id);
      return `${id}: ${e.title}`;
    });
    const keepId = Number(prompt('以下经历将合并，输入要保留的 ID（其余的作品引用、贡献、旧链接都会迁移到它）：\n\n' +
      list.join('\n')));
    if (!ids.includes(keepId)) return showToast('保留 ID 必须在选中项中', 'error');
    const r = await api('POST', '/api/admin/experiences/merge', {
      keepId, dupIds: ids.filter(x => x !== keepId)
    });
    showToast(`已合并 ${r.merged.length} 条，旧链接已迁移`);
    selectedMerge.clear();
    refresh();
  };

  // ---------- 作品 ----------
  function openWork(id) {
    const w = id ? drafts.works.find(x => x.id === id) : null;
    $('#work-id').value = w ? w.id : '';
    $('#work-version').value = w ? w.version : '';
    $('#work-modal-title').textContent = w ? `编辑作品：${w.title}` : '新建作品';
    $('#work-title').value = w ? w.title : '';
    $('#work-slug').value = w ? w.slug : '';
    $('#work-summary').value = w ? (w.summary || '') : '';
    $('#work-link').value = w ? (w.link || '') : '';
    $('#work-retired').checked = w ? w.retired : false;
    const linked = new Set(w ? w.experiences.map(e => e.slug) : []);
    $$('#work-exps option').forEach(o => o.selected = linked.has(o.value));
    $('#work-modal').classList.add('open');
  }
  $('#new-work-btn').onclick = () => openWork(null);
  $('#work-cancel').onclick = () => $('#work-modal').classList.remove('open');
  $('#work-save').onclick = async () => {
    const id = $('#work-id').value;
    const body = {
      title: $('#work-title').value.trim(),
      slug: $('#work-slug').value.trim() || undefined,
      summary: $('#work-summary').value.trim(),
      link: $('#work-link').value.trim(),
      retired: $('#work-retired').checked,
      experiences: $$('#work-exps option:checked').map(o => ({ slug: o.value }))
    };
    if (!body.title) return showToast('请填写作品标题', 'error');
    if (!body.experiences.length) return showToast('作品至少关联一段经历', 'error');
    try {
      if (id) { body.version = Number($('#work-version').value); await api('PUT', '/api/admin/works/' + id, body); }
      else await api('POST', '/api/admin/works', body);
      showToast('作品已保存'); $('#work-modal').classList.remove('open'); refresh();
    } catch (e) { showToast(e.status === 409 ? '并发冲突：作品已被其他设备修改，请刷新' : e.message, 'error'); }
  };
  async function removeWork(id) {
    if (!confirm('删除作品不可恢复，确定？')) return;
    await api('DELETE', '/api/admin/works/' + id);
    showToast('已删除'); refresh();
  }

  // ---------- 发布 ----------
  $('#publish-btn').onclick = async () => {
    const r = await api('POST', '/api/admin/publish', { note: $('#pub-note-input').value.trim() });
    $('#pub-note-input').value = '';
    showToast('发布版本 #' + r.id + ' 已上线');
    loadPubs();
  };
  async function loadPubs() {
    const { publications, current } = await api('GET', '/api/admin/publications');
    $('#pub-tbody').innerHTML = publications.map(p => `
      <tr>
        <td><strong>#${p.id}</strong> ${p.id === current ? '<span class="pill approved">当前生效</span>' : ''}</td>
        <td>${new Date(p.published_at).toLocaleString('zh-CN')}</td>
        <td>${esc(p.note || '—')}</td>
        <td><a href="archive.html?v=${p.id}" target="_blank">查看此版本 ↗</a></td>
      </tr>`).join('') || '<tr><td colspan="4" class="pub-note">还没有发布</td></tr>';
  }
  async function loadSessions() {
    const { sessions } = await api('GET', '/api/admin/sessions');
    $('#session-tbody').innerHTML = sessions.map(s => `
      <tr><td>${esc(s.device || '未知')}</td><td><small>${esc((s.user_agent || '').slice(0, 60))}</small></td>
      <td>${new Date(s.created_at).toLocaleString('zh-CN')}</td></tr>`).join('');
  }

  // 自动探测 token 是否有效
  (async () => {
    if (!token) return showLogin();
    try { await api('GET', '/api/admin/drafts'); showAdmin(); }
    catch { showLogin(); }
  })();
})();
