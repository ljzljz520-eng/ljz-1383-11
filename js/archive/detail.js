'use strict';
// 详情页：与列表同一个发布版本 v；返回时恢复筛选链接与滚动位置；
// 经合并的旧链接自动解析到新卡并提示（不出现失效卡片）。
(function () {
  const $ = s => document.querySelector(s);
  const root = $('#root');
  const params = new URLSearchParams(location.search);
  const slug = params.get('slug');
  const v = params.get('v') || '';
  const ret = params.get('return');
  const isWork = location.pathname.includes('work-detail');
  const STAGE_NAME = { education: '求学', internship: '实习', project: '项目/作品' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  // 返回地址保留筛选参数与滚动锚点
  const backHref = ret ? decodeURIComponent(ret) :
    ('archive.html' + (v ? '?v=' + encodeURIComponent(v) : ''));

  function backLink() {
    return `<a class="back-link" href="${esc(backHref)}">← 返回经历档案${ret.includes('scroll=') ? '（恢复原位置）' : ''}</a>`;
  }

  function versionBanner(pubId, stale, currentPubId) {
    if (!stale) return '';
    return `<div class="version-banner">此内容为历史发布版本 #${pubId}，最新版本为 #${currentPubId}。
      <button onclick="location.href=location.pathname+'?slug=${encodeURIComponent(slug)}'">查看最新版</button></div>`;
  }

  async function loadExperience() {
    const res = await fetch(`/api/public/experience/${encodeURIComponent(slug)}?v=${v}`);
    if (!res.ok) { root.innerHTML = backLink() + '<div class="empty">该经历不存在或尚未发布。</div>'; return; }
    const data = await res.json();
    const e = data.experience;
    root.innerHTML = `
      ${versionBanner(data.pubId, data.stale, data.currentPubId)}
      ${backLink()}
      <div class="detail-card glass">
        <span class="stage-tag" style="display:inline-block;font-size:.75rem;padding:.2rem .8rem;border-radius:999px;background:rgba(99,102,241,.18);color:#a5b4fc;">${STAGE_NAME[e.type]}</span>
        <h1>${esc(e.title)} ${e.ongoing ? '<span class="ongoing-badge">进行中</span>' : ''}</h1>
        ${e.organization ? `<div class="org">${esc(e.organization)}</div>` : ''}
        <div class="date">${esc(e.rangeLabel)} · 覆盖年份 ${e.years.join('、')}</div>
        <p class="summary">${esc(e.summary || '')}</p>
        <h3>个人贡献</h3>
        <ul class="contrib-list">${e.contributions.map(c => `<li>${esc(c.content)}</li>`).join('') || '<li>暂无已批准的贡献记录</li>'}</ul>
        <h3>相关能力</h3>
        <div class="skill-row" style="margin-bottom:2rem;">${e.skills.map(s =>
          `<a class="chip" href="archive.html?skill=${esc(s.slug)}&v=${data.pubId}">${esc(s.name)}</a>`).join('')}</div>
        ${e.works.length ? `<h3>关联作品</h3><div class="linked-works">${e.works.map(w =>
          `<a class="linked-work" href="work-detail.html?slug=${encodeURIComponent(w.slug)}&v=${data.pubId}&return=${encodeURIComponent(backHref)}">
            <strong>${esc(w.title)}</strong>${w.role ? `<br><small>角色：${esc(w.role)}</small>` : ''}</a>`).join('')}</div>` : ''}
        ${data.redirectedFrom ? `<div class="redirect-note">该经历由旧链接「${esc(data.redirectedFrom)}」合并迁移而来，链接持续有效。</div>` : ''}
        <div class="pub-note" style="margin-top:2rem;">内容发布版本 #${data.pubId}</div>
      </div>`;
  }

  async function loadWork() {
    const res = await fetch(`/api/public/work/${encodeURIComponent(slug)}?v=${v}`);
    if (!res.ok) { root.innerHTML = backLink() + '<div class="empty">该作品不存在或尚未发布。</div>'; return; }
    const data = await res.json();
    const w = data.work;
    root.innerHTML = `
      ${versionBanner(data.pubId, data.stale, data.currentPubId)}
      ${backLink()}
      <div class="detail-card glass">
        <h1>${esc(w.title)} ${w.retired ? '<span class="retired-badge">已退役</span>' : ''}</h1>
        <div class="date">${esc(w.years.join('、'))}</div>
        <p class="summary">${esc(w.summary || '')}</p>
        ${w.link ? `<p><a href="${esc(w.link)}" target="_blank" rel="noopener" class="btn btn-primary btn-sm">访问作品</a></p>` : ''}
        <h3>关联的多段经历</h3>
        <div class="linked-works">${w.experiences.map(e =>
          `<a class="linked-work" href="experience-detail.html?slug=${encodeURIComponent(e.slug)}&v=${data.pubId}&return=${encodeURIComponent(backHref)}">
            <small>${STAGE_NAME[e.type]}</small><br><strong>${esc(e.title)}</strong>${e.role ? `<br><small>角色：${esc(e.role)}</small>` : ''}</a>`).join('')}</div>
        ${data.redirectedFrom ? `<div class="redirect-note">作品由旧标识「${esc(data.redirectedFrom)}」迁移而来。</div>` : ''}
        <div class="pub-note" style="margin-top:2rem;">内容发布版本 #${data.pubId}（退役项目的历史发布仍可追溯）</div>
      </div>`;
  }

  (isWork ? loadWork() : loadExperience()).then(() => {
    const m = ret && ret.match(/scroll=(\d+)/);
    if (m) window.scrollTo(0, Number(m[1]));
  });
})();
