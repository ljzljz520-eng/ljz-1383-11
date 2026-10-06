'use strict';

const crypto = require('node:crypto');
const { validateRange } = require('./date-range');

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function slugify(input, fallback) {
  const slug = String(input || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback || id('s');
}

function uniqueSlug(db, table, base, currentId = null) {
  let candidate = slugify(base, 'entry');
  let n = 2;
  // SQLite 保留字很少；这些表均由服务端代码控制。
  const currentClause = currentId ? ' AND id != ?' : '';
  let stmt = db.prepare(`SELECT slug FROM ${table} WHERE slug = ?${currentClause}`);
  while (stmt.get(candidate, ...(currentId ? [currentId] : []))) {
    candidate = `${slugify(base, 'entry')}-${n}`;
    n += 1;
  }
  return candidate;
}

function dateColumns(range) {
  const s = range.start ? {
    start_value: range.start.value,
    start_precision: range.start.precision,
    start_year: range.start.year,
    start_month: range.start.month,
    start_day: range.start.day
  } : {
    start_value: null, start_precision: null, start_year: null, start_month: null, start_day: null
  };
  const e = range.end ? {
    end_value: range.end.value,
    end_precision: range.end.precision,
    end_year: range.end.year,
    end_month: range.end.month,
    end_day: range.end.day
  } : {
    end_value: null, end_precision: null, end_year: null, end_month: null, end_day: null
  };
  return { ...s, ...e, ongoing: range.end ? 0 : 1 };
}

function rangeFromBody(body) {
  const start = body.start || {};
  const end = body.end || {};
  return validateRange(start.value, start.precision, end.value, end.precision);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sendJson(res, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2_000_000) {
        const err = new Error('请求体过大');
        err.statusCode = 413;
        reject(err);
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        return resolve(JSON.parse(raw));
      } catch {
        const err = new Error('JSON 格式无效');
        err.statusCode = 400;
        return reject(err);
      }
    });
    req.on('error', reject);
  });
}

function parseToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return '';
}

function notFound(res) {
  sendJson(res, 404, { error: 'not_found', message: '资源不存在' });
}

module.exports = {
  id,
  slugify,
  uniqueSlug,
  dateColumns,
  rangeFromBody,
  stableStringify,
  sha256,
  sendJson,
  readJson,
  parseToken,
  notFound
};
