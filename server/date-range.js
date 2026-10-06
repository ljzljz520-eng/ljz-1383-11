'use strict';

// 所有比较都基于时间精度生成“下界/上界”，绝不把 yyyy 或 yyyy-mm 伪造成具体日期。
const PRECISIONS = new Set(['year', 'month', 'day']);
const STAGE_ORDER = { education: 1, internship: 2, work: 3 };

function pad2(value) {
  return String(value).padStart(2, '0');
}

function parsePrecise(input, precision) {
  if (input == null || input === '') return null;
  const text = String(input);
  let year;
  let month = 1;
  let day = 1;
  let ok = true;

  if (precision === 'year') {
    year = Number(text);
    if (!/^\d{4}$/.test(text) || year < 1900 || year > 2999) ok = false;
  } else if (precision === 'month') {
    const m = text.match(/^(\d{4})-(\d{2})$/);
    if (!m) {
      ok = false;
    } else {
      year = Number(m[1]);
      month = Number(m[2]);
      if (month < 1 || month > 12) ok = false;
    }
  } else if (precision === 'day') {
    const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) {
      ok = false;
    } else {
      year = Number(m[1]);
      month = Number(m[2]);
      day = Number(m[3]);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) ok = false;
    }
  } else {
    ok = false;
  }
  return ok ? { year, month, day } : null;
}

function normalizeEndpoint(input, precision, fieldName) {
  if (precision == null || precision === '') {
    if (input) {
      const err = new Error(`${fieldName} 有值但未提供时间精度`);
      err.statusCode = 400;
      throw err;
    }
    return null;
  }
  if (!PRECISIONS.has(precision)) {
    const err = new Error(`${fieldName} 的时间精度必须是 year、month 或 day`);
    err.statusCode = 400;
    throw err;
  }
  if (!input) {
    const err = new Error(`缺少${fieldName}`);
    err.statusCode = 400;
    throw err;
  }
  const parsed = parsePrecise(input, precision);
  if (!parsed) {
    const err = new Error(`${fieldName} 与时间精度不匹配`);
    err.statusCode = 400;
    throw err;
  }
  return { value: input, precision, ...parsed };
}

// 统一使用“日”作为比较轴：年精度下界为 1 月 1 日、上界为 12 月 31 日；
// 月精度上界为该月最后一天。数据库只保存原始精度，不保存这些推导日。
function daysUtc(year, month, day) {
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function lowerKey(endpoint) {
  if (!endpoint) return null;
  if (endpoint.precision === 'year') return daysUtc(endpoint.year, 1, 1);
  if (endpoint.precision === 'month') return daysUtc(endpoint.year, endpoint.month, 1);
  return daysUtc(endpoint.year, endpoint.month, endpoint.day);
}

function upperKey(endpoint) {
  if (!endpoint) return null;
  if (endpoint.precision === 'year') return daysUtc(endpoint.year, 12, 31);
  if (endpoint.precision === 'month') return daysUtc(endpoint.year, endpoint.month + 1, 0);
  return daysUtc(endpoint.year, endpoint.month, endpoint.day);
}

function monthKey(year, monthOneBased) {
  return year * 12 + monthOneBased - 1;
}

function monthKeyToText(key) {
  const year = Math.floor(key / 12);
  const month = key % 12 + 1;
  return `${year}-${pad2(month)}`;
}

function validateRange(startInput, startPrecision, endInput, endPrecision) {
  const start = normalizeEndpoint(startInput, startPrecision, '开始时间');
  const end = endInput === null || endInput === '' || endPrecision === null || endPrecision === ''
    ? null
    : normalizeEndpoint(endInput, endPrecision, '结束时间');
  if (start && end && lowerKey(start) > upperKey(end)) {
    const err = new Error('开始时间不能晚于结束时间');
    err.statusCode = 400;
    throw err;
  }
  return { start, end };
}

function formatEndpoint(endpoint) {
  if (!endpoint) return '';
  const v = endpoint.value;
  if (endpoint.precision === 'year') return String(endpoint.year);
  if (endpoint.precision === 'month') return `${endpoint.year}-${pad2(endpoint.month)}`;
  return `${endpoint.year}-${pad2(endpoint.month)}-${pad2(endpoint.day)}`;
}

function formatRange(input, nowYear = new Date().getUTCFullYear()) {
  const row = input.start_value !== undefined || input.end_value !== undefined || input.start_year !== undefined
    ? input
    : {
      start_value: input.start?.value,
      start_precision: input.start?.precision,
      start_year: input.start?.year,
      start_month: input.start?.month,
      start_day: input.start?.day,
      end_value: input.end?.value,
      end_precision: input.end?.precision,
      end_year: input.end?.year,
      end_month: input.end?.month,
      end_day: input.end?.day
    };
  const s = row.start_value ? {
    value: row.start_value,
    precision: row.start_precision,
    year: row.start_year,
    month: row.start_month,
    day: row.start_day
  } : null;
  const e = row.end_value ? {
    value: row.end_value,
    precision: row.end_precision,
    year: row.end_year,
    month: row.end_month,
    day: row.end_day
  } : null;
  if (!s) return '时间待定';
  const startText = formatEndpoint(s);
  if (!e) return `${startText} 至今`;
  const endText = formatEndpoint(e);
  // 年精度的同年区间显示为 “2026 年”，不重复两个相同年份。
  if (startText === endText) return startText;
  return `${startText} 至 ${endText}`;
}

// 两个不精确区间是否可能重叠；区间均按包含边界处理。
function rangesOverlap(a, b) {
  if (!a.start || !b.start) return false;
  const aEnd = a.end ? upperKey(a.end) : Infinity;
  const bEnd = b.end ? upperKey(b.end) : Infinity;
  return lowerKey(a.start) <= bEnd && lowerKey(b.start) <= aEnd;
}

function rangeCoversYear(row, year) {
  const startYear = row.start_year;
  const endYear = row.end_year || (row.ongoing ? year : null);
  return startYear != null && endYear != null && startYear <= year && year <= endYear;
}

function bucketYears(rows, releaseYear = new Date().getUTCFullYear()) {
  const years = new Set();
  for (const row of rows) {
    if (row.start_year == null) continue;
    const endYear = row.end_year == null ? releaseYear : row.end_year;
    for (let y = row.start_year; y <= endYear; y += 1) years.add(y);
  }
  return Array.from(years).sort((a, b) => b - a);
}

// 时间线按“正在进行 > 最晚结束 > 最晚开始 > 阶段 > 稳定 tie-break”。
// SQL 中需复刻这里的排序表达式，以保证分页顺序稳定。
function compareRanges(a, b) {
  const aOngoing = a.ongoing ? 1 : 0;
  const bOngoing = b.ongoing ? 1 : 0;
  if (aOngoing !== bOngoing) return bOngoing - aOngoing;

  const aEnd = a.end_year == null ? -Infinity : upperKey({
    year: a.end_year,
    month: a.end_month || 1,
    day: a.end_day || 1,
    precision: a.end_precision
  });
  const bEnd = b.end_year == null ? -Infinity : upperKey({
    year: b.end_year,
    month: b.end_month || 1,
    day: b.end_day || 1,
    precision: b.end_precision
  });
  if (aEnd !== bEnd) return bEnd - aEnd;

  const aStart = a.start_year == null ? -Infinity : lowerKey({
    year: a.start_year,
    month: a.start_month || 1,
    day: a.start_day || 1,
    precision: a.start_precision
  });
  const bStart = b.start_year == null ? -Infinity : lowerKey({
    year: b.start_year,
    month: b.start_month || 1,
    day: b.start_day || 1,
    precision: b.start_precision
  });
  if (aStart !== bStart) return bStart - aStart;

  const stageDiff = (STAGE_ORDER[a.stage] || 99) - (STAGE_ORDER[b.stage] || 99);
  if (stageDiff !== 0) return stageDiff;
  if (a.sort_index !== b.sort_index) return (a.sort_index || 0) - (b.sort_index || 0);
  return String(a.id || '').localeCompare(String(b.id || ''));
}

module.exports = {
  PRECISIONS,
  STAGE_ORDER,
  pad2,
  parsePrecise,
  normalizeEndpoint,
  lowerKey,
  upperKey,
  monthKey,
  monthKeyToText,
  validateRange,
  formatEndpoint,
  formatRange,
  rangesOverlap,
  rangeCoversYear,
  bucketYears,
  compareRanges
};
