'use strict';
// 不精确时间（fuzzy date）核心逻辑
// 规则：输入可能只有年份、年月，或完整年月日。
// 禁止把"2024年"伪造成 2024-01-01 参与排序与区间比较。
// 做法：
//   - 保留原始精度 precision: 'year' | 'month' | 'day'
//   - 排序键使用"已知信息的中点"，而不是人为补 1 号：
//       year  -> 年中 6 月（+0.5 年）
//       month -> 月中（14~16 号，按月份天数）
//       day   -> 当天
//   - 区间比较使用"展开边界"：下界取该精度能确定的最早时刻，上界取最晚时刻。

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

// {precision, year, month?, day?} -> {lo, hi, mid}，单位：年（浮点）
function expand(part) {
  if (!part || part.year == null) return null;
  const y = part.year;
  const p = part.precision || 'year';
  if (p === 'year') {
    return { lo: y, hi: y + 1, mid: y + 0.5 };
  }
  if (p === 'month') {
    const m = part.month || 1; // 1..12
    const lo = y + (m - 1) / 12;
    const hi = y + m / 12;
    // 月中，按实际天数（闰年 2 月也正确）
    const days = m === 2 && isLeap(y) ? 29 : MONTH_DAYS[m - 1];
    const mid = lo + (hi - lo) * ((days / 2) / days);
    return { lo, hi, mid };
  }
  // day
  const m = part.month || 1;
  const d = part.day || 1;
  const days = m === 2 && isLeap(y) ? 29 : MONTH_DAYS[m - 1];
  const lo = y + (m - 1) / 12 + (d - 1) / (12 * days);
  const hi = lo + 1 / (12 * days);
  return { lo, hi, mid: (lo + hi) / 2 };
}

function validate(part, { allowOngoing = false } = {}) {
  if (!part || part.year == null) {
    if (allowOngoing) return null;
    throw new Error('缺少年份');
  }
  const p = part.precision || 'year';
  if (!['year', 'month', 'day'].includes(p)) throw new Error(`未知时间精度: ${p}`);
  const y = Number(part.year);
  if (!Number.isInteger(y) || y < 1900 || y > 2200) throw new Error('年份非法');
  const out = { precision: p, year: y };
  if (p === 'month' || p === 'day') {
    const m = Number(part.month);
    if (!Number.isInteger(m) || m < 1 || m > 12) throw new Error('月份非法');
    out.month = m;
  }
  if (p === 'day') {
    const d = Number(part.day);
    const days = out.month === 2 && isLeap(y) ? 29 : MONTH_DAYS[out.month - 1];
    if (!Number.isInteger(d) || d < 1 || d > days) throw new Error('日期非法');
    out.day = d;
  }
  return out;
}

// 中文显示：严格按精度输出，绝不补不存在的月/日
function label(part, ongoing) {
  if (!part) return ongoing ? '至今' : '';
  const y = String(part.year);
  if (part.precision === 'year') return `${y} 年`;
  if (part.precision === 'month') return `${y} 年 ${String(part.month).padStart(2, '0')} 月`;
  return `${y} 年 ${String(part.month).padStart(2, '0')} 月 ${String(part.day).padStart(2, '0')} 日`;
}

function rangeLabel(start, end, ongoing) {
  const s = label(start);
  if (ongoing) return `${s} 至今`;
  const e = label(end);
  if (!e) return s;
  //同年/同月时折叠显示，避免重复
  if (start && end) {
    if (start.precision === 'year' && end.precision === 'year' && start.year === end.year) {
      return `${start.year} 年`;
    }
    if (start.year === end.year && start.month && end.month && start.month === end.month &&
        start.precision !== 'day' && end.precision !== 'day') {
      return `${start.year} 年 ${String(start.month).padStart(2, '0')} 月`;
    }
  }
  return `${s} – ${e}`;
}

// 两个不精确区间的关系：overlap / before / after / equal-precision 等
// 区间 A=[s.lo, e.hi]，B 同理。仅当展开边界严格分离才判定先后，
// 否则判定为"可能重叠"（信息不足时不误判）。
function relate(aStart, aEnd, bStart, bEnd) {
  const sA = expand(aStart), eA = aEnd ? expand(aEnd) : null;
  const sB = expand(bStart), eB = bEnd ? expand(bEnd) : null;
  const aLo = sA.lo;
  const aHi = eA ? eA.hi : Infinity;
  const bLo = sB.lo;
  const bHi = eB ? eB.hi : Infinity;
  if (aHi <= bLo) return 'before';      // A 确定在 B 之前
  if (bHi <= aLo) return 'after';       // A 确定在 B 之后
  return 'overlap';                     // 含"信息不足无法排除重叠"
}

// 该（可能不精确的）区间覆盖了哪些日历年——用于"跨年项目出现在多个筛选年份"
// 年精度 [2023,2024) => 覆盖 2023；起止都为 year 且 end.year 也算（经历了那一年）
function coveredYears(start, end, ongoing) {
  const s = expand(start);
  if (!s) return [];
  const y0 = start.year;
  let y1;
  if (ongoing || !end) {
    y1 = new Date().getFullYear();
  } else {
    // 结束精度为 year 时，该年份本身也算经历过
    y1 = end.year;
  }
  const years = [];
  for (let y = y0; y <= y1; y++) years.push(y);
  return years;
}

module.exports = { expand, validate, label, rangeLabel, relate, coveredYears, isLeap };
