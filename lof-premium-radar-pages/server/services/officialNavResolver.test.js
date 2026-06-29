import { describe, expect, it } from 'vitest';
import { selectLatestOfficialNav } from './officialNavResolver.js';

describe('officialNavResolver', () => {
  it('prefers the newest official NAV date before source priority', () => {
    const selected = selectLatestOfficialNav([
      { lastNav: 1.01, navDate: '2026-06-25', navSource: 'eastmoney' },
      { lastNav: 1.02, navDate: '2026-06-26', navSource: 'jisilu' },
    ], { now: new Date('2026-06-29T01:30:00Z') });

    expect(selected).toMatchObject({
      lastNav: 1.02,
      navDate: '2026-06-26',
      navSource: 'jisilu',
    });
  });

  it('uses source priority only when official NAV dates are equal', () => {
    const selected = selectLatestOfficialNav([
      { lastNav: 1.01, navDate: '2026-06-26', navSource: 'jisilu' },
      { lastNav: 1.011, navDate: '2026-06-26', navSource: 'eastmoney' },
    ], { now: new Date('2026-06-29T01:30:00Z') });

    expect(selected).toMatchObject({
      lastNav: 1.011,
      navDate: '2026-06-26',
      navSource: 'eastmoney',
    });
  });

  it('rejects future and invalid official NAV dates without losing a valid fallback', () => {
    const selected = selectLatestOfficialNav([
      { lastNav: 9.99, navDate: '2026-06-30', navSource: 'eastmoney' },
      { lastNav: 8.88, navDate: '2026-02-30', navSource: 'tiantian' },
      { lastNav: 1.01, navDate: '2026-06-26', navSource: 'jisilu' },
    ], { now: new Date('2026-06-29T01:30:00Z') });

    expect(selected).toMatchObject({ lastNav: 1.01, navDate: '2026-06-26' });
  });

  it('rejects a same-day NAV before the market has closed', () => {
    const selected = selectLatestOfficialNav([
      { lastNav: 1.2, navDate: '2026-06-29', navSource: 'jisilu' },
      { lastNav: 1.1, navDate: '2026-06-26', navSource: 'eastmoney' },
    ], { now: new Date('2026-06-29T01:30:00Z') });

    expect(selected).toMatchObject({ lastNav: 1.1, navDate: '2026-06-26' });
  });

  it('keeps first-source compatibility when every usable NAV lacks a date', () => {
    const selected = selectLatestOfficialNav([
      { lastNav: 1.01, source: 'eastmoney' },
      { lastNav: 1.02, navSource: 'tiantian' },
    ], { now: new Date('2026-06-29T01:30:00Z') });

    expect(selected).toMatchObject({ lastNav: 1.01, navDate: '', navSource: 'eastmoney' });
  });

  it('never accepts Palmmicro EST as an official NAV candidate', () => {
    const selected = selectLatestOfficialNav([
      { lastNav: 1.2, navDate: '2026-06-28', navSource: 'lof' },
      { lastNav: 1.1, navDate: '2026-06-26', navSource: 'eastmoney' },
    ], { now: new Date('2026-06-29T08:30:00Z') });

    expect(selected).toMatchObject({ lastNav: 1.1, navDate: '2026-06-26', navSource: 'eastmoney' });
  });
});
