'use strict';

const { URL } = require('node:url');
const { sendJson, readJson, parseToken, notFound } = require('./utils');
const publicService = require('./public-service');
const adminService = require('./admin-service');
const experienceService = require('./experience-service');
const releaseService = require('./release');

function requireAuth(req, config) {
  const token = parseToken(req);
  if (!config.adminToken || token !== config.adminToken) {
    const err = new Error('需要站主授权');
    err.statusCode = 401;
    return err;
  }
  return null;
}

async function handleApi(req, res, db, config) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  const method = req.method;
  const send = (status, payload, headers) => sendJson(res, status, payload, headers);

  try {
    if (method === 'GET' && path === '/api/health') {
      return send(200, { ok: true, time: new Date().toISOString() });
    }

    if (method === 'GET' && path === '/api/public/experiences') {
      const result = publicService.listExperiences(db, {
        version: url.searchParams.get('release') || url.searchParams.get('version') || 'latest',
        stage: url.searchParams.get('stage') || '',
        skill: url.searchParams.get('skill') || '',
        year: url.searchParams.get('year') || '',
        lifecycle: url.searchParams.get('lifecycle') || '',
        q: url.searchParams.get('q') || '',
        page: url.searchParams.get('page') || 1,
        pageSize: url.searchParams.get('pageSize') || 12
      });
      res.setHeader('Cache-Control', 'no-store');
      return send(200, result);
    }

    if (method === 'GET' && /^\/api\/public\/experiences\/[^/]+$/.test(path)) {
      const identifier = decodeURIComponent(path.split('/').pop());
      const result = publicService.getExperience(db, identifier, url.searchParams.get('release') || 'latest');
      return send(200, result);
    }

    if (method === 'GET' && path === '/api/public/releases') {
      return send(200, publicService.listReleases(db));
    }

    if (method === 'POST' && path === '/api/admin/session') {
      const body = await readJson(req);
      if (body.token !== config.adminToken) return send(401, { error: 'unauthorized', message: '管理口令不正确' });
      return send(200, { token: config.adminToken, role: 'owner' });
    }

    if (path.startsWith('/api/admin')) {
      const authError = requireAuth(req, config);
      if (authError) return send(401, { error: 'unauthorized', message: authError.message });
    }

    if (method === 'GET' && path === '/api/admin/overview') {
      return send(200, {
        drafts: adminService.listDraftExperiences(db),
        skills: adminService.listSkills(db).skills,
        works: adminService.listWorks(db).works,
        diff: adminService.draftDiff(db)
      });
    }

    if (method === 'GET' && path === '/api/admin/experiences') {
      return send(200, adminService.listDraftExperiences(db));
    }

    if (method === 'POST' && path === '/api/admin/experiences') {
      const body = await readJson(req);
      const row = experienceService.createExperience(db, body);
      return send(201, adminService.experienceDetail(db, row));
    }

    if (method === 'GET' && /^\/api\/admin\/experiences\/[^/]+$/.test(path)) {
      const identifier = decodeURIComponent(path.split('/').pop());
      const row = db.prepare('SELECT * FROM experiences WHERE id = ? OR slug = ?').get(identifier, identifier);
      if (!row) return notFound(res);
      return send(200, adminService.experienceDetail(db, row));
    }

    if (method === 'PUT' && /^\/api\/admin\/experiences\/[^/]+$/.test(path)) {
      const identifier = decodeURIComponent(path.split('/').pop());
      const row = db.prepare('SELECT id FROM experiences WHERE id = ? OR slug = ?').get(identifier, identifier);
      if (!row) return notFound(res);
      const body = await readJson(req);
      const updated = experienceService.updateExperience(db, row.id, body, req.headers['if-match'] || body.revision);
      return send(200, {
        ...adminService.experienceDetail(db, updated),
        etag: String(updated.revision)
      }, { ETag: String(updated.revision) });
    }

    if (method === 'POST' && path === '/api/admin/experiences/merge') {
      const body = await readJson(req);
      const source = db.prepare('SELECT id FROM experiences WHERE id = ? OR slug = ?').get(body.sourceId, body.sourceId);
      const target = db.prepare('SELECT id FROM experiences WHERE id = ? OR slug = ?').get(body.targetId, body.targetId);
      if (!source || !target) return notFound(res);
      const merged = experienceService.mergeExperiences(db, source.id, target.id, String(body.reason || ''));
      return send(200, adminService.experienceDetail(db, merged));
    }

    if (method === 'GET' && path === '/api/admin/skills') return send(200, adminService.listSkills(db));
    if (method === 'POST' && path === '/api/admin/skills') return send(201, adminService.createSkill(db, await readJson(req)));

    if (method === 'GET' && path === '/api/admin/works') return send(200, adminService.listWorks(db));
    if (method === 'POST' && path === '/api/admin/works') return send(201, adminService.createWork(db, await readJson(req)));
    if (method === 'PUT' && /^\/api\/admin\/works\/[^/]+$/.test(path)) {
      const workId = decodeURIComponent(path.split('/').pop());
      return send(200, adminService.updateWork(db, workId, await readJson(req)));
    }

    if (method === 'GET' && path === '/api/admin/diff') return send(200, adminService.draftDiff(db));

    if (method === 'POST' && path === '/api/admin/releases') {
      const body = await readJson(req);
      const result = releaseService.createRelease(db, {
        status: body.status === 'running' ? 'running' : 'current',
        changeSummary: body.changeSummary || ''
      });
      return send(201, result);
    }

    if (method === 'POST' && path === '/api/admin/releases/finalize') {
      return send(200, releaseService.finalizeRunningRelease(db));
    }

    if (method === 'DELETE' && path === '/api/admin/releases/running') {
      return send(200, releaseService.cancelRunningRelease(db));
    }

    if (method === 'GET' && path === '/api/admin/releases') {
      return send(200, {
        releases: db.prepare(`SELECT * FROM releases ORDER BY published_at DESC, rowid DESC`).all(),
        diff: adminService.draftDiff(db)
      });
    }

    return send(404, { error: 'not_found', message: 'API 路径不存在' });
  } catch (error) {
    const status = error.statusCode || 500;
    if (status >= 500) console.error(error);
    return send(status, {
      error: error.code || 'error',
      message: error.message || '服务器错误',
      ...(error.current ? { currentRevision: error.current } : {}),
      ...(error.targetId ? { targetId: error.targetId } : {})
    });
  }
}

module.exports = { handleApi };
