'use strict';
// 经历档案公开页：
// - 筛选状态全部进 URL（stage/skill/year/kind/q），可分享、可恢复
// - 首次加载后把发布版本 v 固定，翻页/搜索都带同一个 v => 与年表、详情一致
// - 翻页期间有新版上线只提示，不偷偷换数据，访客点"查看新版"才整体切换
(function () {
  const $ = s => document.querySelector(s);
  const grid = $('#grid');
  const params = new URLSearchParams(location.search);

  const state = {
    stage: params.get('stage') || '',
    skill: params.get('skill') || '',
    year: params.get('year') || '',
    kind: params.get('kind') || 'experiences',
    q: params.get('q') || '',
    v: params.get('v') || null,         // 固定的发布版本
    after: null,
    loading: false,
    hasMore: false,
    loaded: []                          // 已加载项（用于返回时重建跨页位置）
  };

  // 返回位置恢复：同筛选+版本下，用 sessionStorage 重建之前已加载的全部卡片，
  // 再滚动到 #scroll=N —— 即使当时翻到了第 3 页也能精确恢复
  const cacheKey = () => ['ar', state.stage, state.skill, state.year, state.kind, state.q, state.v].join('|');
  function persistView() {
    try { sessionStorage.setItem(cacheKey(), JSON.stringify({ after: state.after, items: state.loaded })); } catch (_) {}
  }
  function restoreScroll() {
    const m = location.hash.match(/scroll=(\d+)/);
    if (!m) return false;
    let cache = null;
    try { cache = JSON.parse(sessionStorage.getItem(cacheKey()) || 'null'); } catch (_) {}
    if (!cache) return false;
    const renderer = state.kind === 'works' ? workCard : expCard;
    grid.innerHTML = cache.items.map(renderer).join('');
    state.loaded = cache.items;
    state.after = cache.after;
    requestAnimationFrame(() => window.scrollTo(0, Number(m[1])));
    history.replaceState(null, '', location.pathname + location.search);
    return true;
  }

  // 把可恢复状态写回地址栏（不刷新、不产生多余历史栈）
  function syncURL(replace = true) {
    const p = new URLSearchParams();
    if (state.stage) p.set('stage', state.stage);
    if (state.skill) p.set('skill', state.skill);
    if (state.year) p.set('year', state.year);
    if (state.kind !== 'experiences') p.set('kind', state.kind);
    if (state.q) p.set('q', state.q);
    if (state.v) p.set('v', state.v);
    const url = location.pathname + (p.toString() ? '?' + p.toString() : '');
    history[replace ? 'replaceState' : 'pushState'](null, '', url);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const STAGE_NAME = { education: '求学', internship: '实习', project: '项目/作品' };

  // 返回链接：携带完整筛选 URL 与滚动位置，详情页返回后精确恢复
  function returnTo() {
    return encodeURIComponent(location.pathname + location.search + '#scroll=' + Math.round(window.scrollY));
  }

  function expCard(e) {
    const tags = e.skills.map(s => `<span class="skill">${esc(s.name)}</span>`).join('');
    return `<a class="exp-card glass" href="experience-detail.html?slug=${encodeURIComponent(e.slug)}&v=${state.v || ''}&return=${returnTo()}">
      <span class="stage-tag">${STAGE_NAME[e.type] || e.type}</span>
      <h3>${esc(e.title)}${e.ongoing ? '<span class="ongoing-badge">进行中</span>' : ''}</h3>
      ${e.organization ? `<div class="meta">${esc(e.organization)}</div>` : ''}
      <div class="date">${esc(e.rangeLabel)}</div>
      <div class="meta">${esc((e.summary || '').slice(0, 80))}</div>
      <div class="skill-row">${tags}</div>
    </a>`;
  }

  function workCard(w) {
    const stages = [...new Set(w.experiences.map(e => STAGE_NAME[e.type]))].join(' / ');
    const years = w.years.join('、');
    return `<a class="exp-card glass" href="work-detail.html?slug=${encodeURIComponent(w.slug)}&v=${state.v || ''}&return=${returnTo()}">
      <span class="stage-tag">作品 · ${esc(stages)}</span>
      <h3>${esc(w.title)}${w.retired ? '<span class="retired-badge">已退役</span>' : ''}</h3>
      <div class="date">${esc(years)}</div>
      <div class="meta">${esc((w.summary || '').slice(0, 80))}</div>
      <div class="skill-row">${w.experiences.slice(0, 4).map(e =>
        `<span class="skill">${esc(e.title)}${e.role ? '·' + esc(e.role) : ''}</span>`).join('')}</div>
    </a>`;
  }

  function renderFacets(facets) {
    const stageBox = $('#stage-filters');
    stageBox.innerHTML = `<span class="chip ${!state.stage ? 'active' : ''}" data-stage="">全部阶段</span>` +
      facets.stages.map(s =>
        `<span class="chip ${state.stage === s.slug ? 'active' : ''}" data-stage="${s.slug}">${s.name}</span>`).join('');
    stageBox.querySelectorAll('.chip').forEach(chip => chip.onclick = () => {
      state.stage = chip.dataset.stage; resetAndLoad();
    });

    $('#skill-select').innerHTML = '<option value="">全部能力</option>' +
      facets.skills.map(s => `<option value="${esc(s.slug)}" ${state.skill === s.slug ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
    $('#year-select').innerHTML = '<option value="">全部年份</option>' +
      facets.years.map(y => `<option value="${y}" ${String(state.year) === String(y) ? 'selected' : ''}>${y} 年</option>`).join('');
  }

  async function loadPage(reset) {
    if (state.loading) return;
    state.loading = true;
    const p = new URLSearchParams();
    if (state.stage) p.set('stage', state.stage);
    if (state.skill) p.set('skill', state.skill);
    if (state.year) p.set('year', state.year);
    p.set('kind', state.kind);
    if (state.v) p.set('v', state.v);
    if (!reset && state.after) p.set('after', state.after);
    try {
      const res = await fetch('/api/public/archive?' + p.toString());
      const data = await res.json();
      if (!data.published) {
        grid.innerHTML = ''; $('#empty').style.display = 'block';
        $('#empty').textContent = '经历档案尚未发布。';
        $('#load-more').style.display = 'none';
        return;
      }
      if (reset) {
        state.v = String(data.pubId);   // 固定版本
        syncURL(true);
        renderFacets(data.facets);
        grid.innerHTML = '';
        state.loaded = [];
      }
      $('#pub-id').textContent = '#' + data.pubId;
      const html = data.items.map(state.kind === 'works' ? workCard : expCard).join('');
      grid.insertAdjacentHTML('beforeend', html);
      state.loaded = state.loaded.concat(data.items);
      state.after = data.nextCursor;
      state.hasMore = !!data.nextCursor;
      $('#load-more').style.display = state.hasMore ? 'inline-block' : 'none';
      $('#empty').style.display = data.total === 0 ? 'block' : 'none';
      persistView();
      // 翻页过程中上线了新版：提示但保留旧版数据
      const banner = $('#version-banner');
      if (data.stale) {
        banner.innerHTML = `<div class="version-banner">站点档案已更新到新版本 #${data.currentPubId}，你正在浏览发布版本 #${data.pubId}。
          <button id="switch-version">查看新版</button></div>`;
        $('#switch-version').onclick = () => {
          state.v = null; state.after = null;
          const u = new URL(location.href); u.searchParams.delete('v');
          history.replaceState(null, '', u);
          resetAndLoad();
        };
      } else {
        banner.innerHTML = '';
      }
    } catch (e) {
      window.showToast && showToast('加载失败，请重试', 'error');
    } finally {
      state.loading = false;
    }
  }

  function resetAndLoad() {
    state.after = null;
    syncURL(false);
    loadPage(true);
  }

  $('#skill-select').onchange = e => { state.skill = e.target.value; resetAndLoad(); };
  $('#year-select').onchange = e => { state.year = e.target.value; resetAndLoad(); };
  $('#kind-select').onchange = e => { state.kind = e.target.value; resetAndLoad(); };
  $('#load-more').onclick = () => loadPage(false);

  // ---------- 搜索：同一发布版本内检索，结果与年表/详情不割裂 ----------
  const searchInput = $('#search-input');
  searchInput.value = state.q;
  let searchTimer = null;
  searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  async function doSearch() {
    const q = searchInput.value.trim();
    state.q = q; syncURL(false);
    const panel = $('#search-panel'), list = $('#list-panel');
    if (!q) { panel.style.display = 'none'; list.style.display = ''; return; }
    list.style.display = 'none'; panel.style.display = 'block';
    const p = new URLSearchParams({ q });
    if (state.v) p.set('v', state.v);
    const data = await (await fetch('/api/public/search?' + p)).json();
    if (!data.published) { panel.innerHTML = '<div class="empty">尚未发布。</div>'; return; }
    if (!state.v) { state.v = String(data.pubId); syncURL(true); }
    const expHtml = data.experiences.map(e => `
      <a class="exp-card glass" href="experience-detail.html?slug=${encodeURIComponent(e.slug)}&v=${state.v}&return=${returnTo()}">
        <span class="stage-tag">${STAGE_NAME[e.type]}</span><h3>${esc(e.title)}</h3>
        <div class="date">${esc(e.rangeLabel)}</div><div class="meta">${esc((e.summary || '').slice(0, 70))}</div></a>`).join('');
    const workHtml = data.works.map(w => `
      <a class="exp-card glass" href="work-detail.html?slug=${encodeURIComponent(w.slug)}&v=${state.v}&return=${returnTo()}">
        <span class="stage-tag">作品</span><h3>${esc(w.title)}${w.retired ? '<span class="retired-badge">已退役</span>' : ''}</h3>
        <div class="date">${esc(w.years.join('、'))}</div><div class="meta">${esc((w.summary || '').slice(0, 70))}</div></a>`).join('');
    panel.innerHTML = `<div class="search-results">
      <h2>经历（${data.experiences.length}）</h2>
      ${expHtml ? `<div class="archive-grid">${expHtml}</div>` : '<div class="empty">无匹配经历</div>'}
      <h2>作品（${data.works.length}）</h2>
      ${workHtml ? `<div class="archive-grid">${workHtml}</div>` : '<div class="empty">无匹配作品</div>'}
      <div class="pub-note" style="text-align:center;margin-top:2rem;">结果来自发布版本 #${data.pubId}${data.stale ? '（已有新版）' : ''}</div>
    </div>`;
  }

  // 浏览器前进/后退恢复筛选
  window.addEventListener('popstate', () => location.reload());

  // 初始化：先正常取首页（固定版本/渲染筛选器），随后若带 #scroll= 则用缓存重建跨页位置
  (async () => {
    const wantRestore = /scroll=\d+/.test(location.hash);
    await loadPage(true);
    if (wantRestore) {
      const restored = restoreScroll();
      if (restored) $('#load-more').style.display = state.hasMore ? 'inline-block' : 'none';
    }
  })();
})();
