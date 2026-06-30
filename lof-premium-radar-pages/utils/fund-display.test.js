import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function loadCommonJs(filename) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.resolve(filename), 'utf8');
  const factory = new vm.Script(`(function (module, exports) { ${source}\n})`).runInThisContext();
  factory(module, module.exports);
  return module.exports;
}

const { purchaseText, purchaseState, settlementCycleDisplay } = loadCommonJs('utils/fund-display.js');

describe('fund display helpers', () => {
  it.each([
    [{ purchaseLimit: { state: 'paused', label: '暂停申购' } }, '暂停'],
    [{ purchaseLimit: { state: 'open', label: '开放申购' } }, '不限'],
    [{ purchaseLimit: { state: 'limited', dailyLimit: 10_000 } }, '限 10000 元'],
    [{ purchaseLimit: { state: 'limited', dailyLimit: 20_000 } }, '限 2 万'],
    [{ purchaseLimit: { state: 'limited', label: '限大额 1.5万元' } }, '限 1.5 万'],
    [{ purchaseLimit: { state: 'unknown', label: '未知' } }, '暂无数据'],
  ])('keeps purchase text output unchanged', (fund, expected) => {
    expect(purchaseText(fund)).toBe(expected);
  });

  it('keeps purchase and settlement states unchanged', () => {
    expect(purchaseState({ purchaseLimit: { state: 'limited' } })).toBe('limited');
    expect(purchaseState({ subscriptionState: 'unknown' })).toBe('unavailable');
    expect(settlementCycleDisplay('T+2', false)).toBe('T+2');
    expect(settlementCycleDisplay('T+3', true)).toBe('延3天');
    expect(settlementCycleDisplay('', false)).toBe('暂无数据');
  });
});
