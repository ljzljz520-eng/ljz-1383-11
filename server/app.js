'use strict';
const path = require('path');
const express = require('express');
const db = require('./db');
const auth = require('./auth');
const admin = require('./admin');
const snap = require('./snapshot');
const q = require('./query');

const ROOT = path.join(__dirname, '..');
const app = express();
app.use(express.json({ limit: '1mb' }));

// 仅暴露前端资源白名单，避免 data/（数据库）、server/ 源码被直接下载
['/css', '/js', '/images'].forEach(dir => {
  app.use(dir, express.static(path.join(ROOT, dir.slice(1))));
});
const PAGES = ['index', 'hobbies', 'hobby-detail', 'portfolio', 'contact',
  'solar-detail', 'work-detail', 'archive', 'experience-detail', 'admin'];
PAGES.forEach(p => app.get('/' + p + '.html', (req, res) => res.sendFile(path.join(ROOT, p + '.html'))));

// ---------- 公开 API：全部读冻结发布视图，v 固定版本 ----------
app.get('/api/public/archive', (req, res) => {
  const result = q.listView({
    stage: req.query.stage || undefined,
    skill: req.query.skill || undefined,
    year: req.query.year || undefined,
    kind: req.query.kind === 'works' ? 'works' : 'experiences',
    after: req.query.after || undefined,
    pageSize: Math.min(Number(req.query.pageSize) || 6, 50),
    v: req.query.v
  });
  res.json(result);
});

app.get('/api/public/experience/:slug', (req, res) => {
  const pub = q.getPublished(req.query.v);
  if (!pub.snapshot) return res.status(404).json({ error: '尚未发布' });
  const { experience, redirectedFrom } = q.resolveExperience(pub.snapshot, req.params.slug);
  if (!experience) return res.status(404).json({ error: '经历不存在' });
  res.json({ pubId: pub.id, stale: q.currentPubId() !== pub.id, currentPubId: q.currentPubId(),
             experience, redirectedFrom });
});

app.get('/api/public/work/:slug', (req, res) => {
  const pub = q.getPublished(req.query.v);
  if (!pub.snapshot) return res.status(404).json({ error: '尚未发布' });
  const { work, redirectedFrom } = q.resolveWork(pub.snapshot, req.params.slug);
  if (!work) return res.status(404).json({ error: '作品不存在' });
  res.json({ pubId: pub.id, stale: q.currentPubId() !== pub.id, currentPubId: q.currentPubId(),
             work, redirectedFrom });
});

app.get('/api/public/search', (req, res) => {
  const pub = q.getPublished(req.query.v);
  if (!pub.snapshot) return res.json({ published: false });
  const result = q.search(pub.snapshot, req.query.q);
  res.json({ ...result, pubId: pub.id, stale: q.currentPubId() !== pub.id });
});

// ---------- 认证 ----------
app.post('/api/admin/login', (req, res) => {
  const { password, device } = req.body || {};
  if (!auth.verifyPassword(password || '')) return res.status(401).json({ error: '口令错误' });
  const token = auth.newSession({ userAgent: req.get('user-agent') || '', device: device || '' });
  res.json({ token });
});
app.post('/api/admin/logout', (req, res) => {
  const token = (req.get('authorization') || '').replace(/^Bearer /, '');
  auth.destroySession(token);
  res.json({ ok: true });
});

function requireAuth(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer /, '');
  if (!auth.validToken(token)) return res.status(401).json({ error: '未登录或会话过期' });
  next();
}

// ---------- 管理 API：实时读草稿表 ----------
app.get('/api/admin/drafts', requireAuth, (req, res) => {
  res.json(snap.readDrafts());
});

app.post('/api/admin/experiences', requireAuth, (req, res) => {
  try {
    const id = admin.createExperience(req.body);
    res.json({ id });
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
app.put('/api/admin/experiences/:id', requireAuth, (req, res) => {
  try {
    const version = admin.updateExperience(Number(req.params.id), req.body);
    res.json({ ok: true, version });
  } catch (e) { res.status(e.status || 400).json({ error: e.message, server: e.server }); }
});
app.delete('/api/admin/experiences/:id', requireAuth, (req, res) => {
  const result = admin.removeExperience(Number(req.params.id));
  res.json({ result });
});
app.post('/api/admin/experiences/merge', requireAuth, (req, res) => {
  try {
    const { keepId, dupIds } = req.body || {};
    if (!keepId || !Array.isArray(dupIds)) return res.status(400).json({ error: '参数缺失' });
    res.json(admin.mergeExperiences(Number(keepId), dupIds));
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
app.post('/api/admin/contributions/:id/approve', requireAuth, (req, res) => {
  const ok = admin.approveContribution(Number(req.params.id), !!req.body.approved);
  res.json({ ok });
});

app.get('/api/admin/works', requireAuth, (req, res) => {
  res.json({ works: snap.readDrafts().works });
});
app.post('/api/admin/works', requireAuth, (req, res) => {
  try { res.json({ id: admin.createWork(req.body) }); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
app.put('/api/admin/works/:id', requireAuth, (req, res) => {
  try { res.json({ ok: true, version: admin.updateWork(Number(req.params.id), req.body) }); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
app.delete('/api/admin/works/:id', requireAuth, (req, res) => {
  res.json({ ok: admin.deleteWork(Number(req.params.id)) });
});

// 发布 / 版本
app.post('/api/admin/publish', requireAuth, (req, res) => {
  res.json(admin.publish(req.body && req.body.note));
});
app.get('/api/admin/publications', requireAuth, (req, res) => {
  res.json({ publications: snap.listPublications(), current: snap.currentPubId() });
});
// 发布前预览（不落库）
app.get('/api/admin/preview', requireAuth, (req, res) => {
  res.json(snap.buildSnapshot());
});
app.get('/api/admin/sessions', requireAuth, (req, res) => res.json({ sessions: auth.listSessions() }));

// 历史发布快照（仅结构，便于追内容；公开读）
app.get('/api/public/version/:id', (req, res) => {
  const pub = q.getPublished(req.params.id);
  if (!pub.snapshot) return res.status(404).json({ error: '版本不存在' });
  res.json({ id: pub.id, publishedAt: pub.publishedAt, note: pub.note });
});

// 页面路由（静态扩展可能不命中，显式兜底）
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'admin.html')));
app.get('/archive', (req, res) => res.sendFile(path.join(__dirname, '..', 'archive.html')));

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`经历档案服务运行于 http://localhost:${port}`));
}
module.exports = app;
