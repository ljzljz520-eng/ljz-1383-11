'use strict';
const crypto = require('crypto');
const db = require('./db');

// 管理员口令通过环境变量注入，默认仅用于本地演示
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(pw) {
  const stored = hashPassword(ADMIN_PASSWORD); // 演示：不落库明文，直接比对
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(pw, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(check, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function newSession({ userAgent = '', device = '' }) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO admin_sessions (token, created_at, user_agent, device) VALUES (?,?,?,?)')
    .run(token, Date.now(), userAgent, device);
  return token;
}
function validToken(token) {
  if (!token) return false;
  const row = db.prepare('SELECT created_at FROM admin_sessions WHERE token=?').get(token);
  if (!row) return false;
  if (Date.now() - row.created_at > 1000 * 60 * 60 * 12) return false;
  return true;
}
function destroySession(token) {
  db.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
}
function listSessions() {
  return db.prepare('SELECT token, created_at, user_agent, device FROM admin_sessions ORDER BY created_at DESC').all();
}

module.exports = { verifyPassword, newSession, validToken, destroySession, listSessions };
