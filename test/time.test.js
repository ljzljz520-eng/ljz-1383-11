'use strict';
const assert = require('assert');
const t = require('../server/time');

let n = 0;
function check(name, fn) { fn(); n++; console.log('  PASS ' + name); }

// 显示：严格按精度，不补日期
check('year 显示', () => assert.equal(t.label({ precision: 'year', year: 2024 }), '2024 年'));
check('month 显示不出现日', () => assert.equal(t.label({ precision: 'month', year: 2024, month: 3 }), '2024 年 03 月'));
check('day 完整显示', () => assert.equal(t.label({ precision: 'day', year: 2024, month: 3, day: 9 }), '2024 年 03 月 09 日'));
check('同年区间折叠', () => assert.equal(
  t.rangeLabel({ precision: 'year', year: 2023 }, { precision: 'year', year: 2023 }, false), '2023 年'));
check('进行中', () => assert.equal(
  t.rangeLabel({ precision: 'month', year: 2024, month: 3 }, null, true), '2024 年 03 月 至今'));

// 排序中点：不伪造成 1 号
check('year 中点是年中', () => assert.equal(t.expand({ precision: 'year', year: 2024 }).mid, 2024.5));
check('month 中点是月中而非 1 号', () => {
  const e = t.expand({ precision: 'month', year: 2024, month: 1 });
  assert.ok(e.mid > 2024 && e.mid < 2024 + 1 / 12, e.mid);
});
check('2023年 与 2024-06 排序：2024-06 更近', () => {
  const a = t.expand({ precision: 'year', year: 2023 }).mid;
  const b = t.expand({ precision: 'month', year: 2024, month: 6 }).mid;
  assert.ok(b > a);
});

// 重叠关系：信息不足不误判
check('两个年精度相邻年不重叠', () => assert.equal(
  t.relate({ precision: 'year', year: 2023 }, { precision: 'year', year: 2023 },
           { precision: 'year', year: 2024 }, { precision: 'year', year: 2024 }),
  'before'));
check('同年两条年精度经历视为可能重叠', () => assert.equal(
  t.relate({ precision: 'year', year: 2024 }, { precision: 'year', year: 2024 },
           { precision: 'year', year: 2024 }, { precision: 'year', year: 2024 }),
  'overlap'));
check('月精度与年精度同年 -> 可能重叠（不误判）', () => assert.equal(
  t.relate({ precision: 'month', year: 2024, month: 3 }, { precision: 'month', year: 2024, month: 4 },
           { precision: 'year', year: 2024 }, { precision: 'year', year: 2024 }),
  'overlap'));
check('确定先后：2023-03 在 2024 年之前', () => assert.equal(
  t.relate({ precision: 'month', year: 2023, month: 3 }, { precision: 'month', year: 2023, month: 5 },
           { precision: 'year', year: 2024 }, { precision: 'year', year: 2024 }),
  'before'));
check('进行中经历与任何未来区间重叠', () => assert.equal(
  t.relate({ precision: 'year', year: 2024 }, null,
           { precision: 'year', year: 2026 }, null),
  'overlap'));

// 覆盖年份
check('2023-2024 年精度覆盖 [2023,2024]', () => assert.deepEqual(
  t.coveredYears({ precision: 'year', year: 2023 }, { precision: 'year', year: 2024 }, false), [2023, 2024]));
check('进行中覆盖到当前年', () => {
  const ys = t.coveredYears({ precision: 'year', year: 2024 }, null, true);
  assert.equal(ys[0], 2024); assert.equal(ys[ys.length - 1], new Date().getFullYear());
});

// 校验
check('月精度缺月报错', () => assert.throws(() => t.validate({ precision: 'month', year: 2024 })));
check('闰年 2 月 29 合法', () => assert.doesNotThrow(() => t.validate({ precision: 'day', year: 2024, month: 2, day: 29 })));
check('平年 2 月 29 非法', () => assert.throws(() => t.validate({ precision: 'day', year: 2023, month: 2, day: 29 })));
check('日精度缺日报错', () => assert.throws(() => t.validate({ precision: 'day', year: 2024, month: 3 })));

console.log('\n时间模块：' + n + ' 项全部通过');
