'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { initDatabase } = require('./db');
const { seedDatabase } = require('./seed');
const { handleApi } = require('./api');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = ROOT;
const PORT = Number(process.env.PORT || 3000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'owner-dev-token';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8'
};

const LEGACY_REDIRECTS = new Map([
  ['/portfolio.html', '/experiences.html?stage=work&from=portfolio'],
  ['/work-detail.html', '/experiences.html?detail=neofinance-app&from=work-detail'],
  ['/solar-detail.html', '/experiences.html?detail=solar-brand-system&from=solar-detail']
]);

function safeStaticPath(pathname) {
  const decoded = decodeURIComponent(pathname.split('?')[0]);
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, normalized);
  if (!filePath.startsWith(PUBLIC_DIR)) return null;
  return filePath;
}

const db = initDatabase(process.env.DATABASE_FILE || path.join(ROOT, 'data', 'archive.db'));
seedDatabase(db);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, db, { adminToken: ADMIN_TOKEN });
    }

    const legacy = LEGACY_REDIRECTS.get(url.pathname);
    if (legacy) {
      res.writeHead(302, { Location: legacy });
      return res.end();
    }

    let pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    if (pathname === '/admin') pathname = '/admin.html';
    if (pathname === '/archive' || pathname === '/chronology' || pathname === '/timeline') {
      res.writeHead(302, { Location: '/experiences.html' });
      return res.end();
    }

    const filePath = safeStaticPath(pathname);
    if (!filePath) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    fs.stat(filePath, (statError, stat) => {
      if (statError || !stat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Not found');
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.html' || ext === '.js' ? 'no-cache' : 'public, max-age=3600'
      });
      fs.createReadStream(filePath).pipe(res);
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'server_error', message: error.message }));
    }
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`经历档案已启动：http://localhost:${PORT}`);
    console.log(`管理页：http://localhost:${PORT}/admin.html （开发口令：${ADMIN_TOKEN}）`);
  });
}

module.exports = { server, db };
