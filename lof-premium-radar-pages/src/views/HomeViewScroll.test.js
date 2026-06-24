import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./HomeView.vue', import.meta.url), 'utf8');

describe('HomeView detail navigation scroll reset', () => {
  it('resets the mobile shell scroll position when opening detail mode', () => {
    expect(source).toContain('const shellRef = ref<HTMLElement | null>(null)');
    expect(source).toContain('ref="shellRef"');
    expect(source).toContain('resetShellScroll()');
    expect(source).toMatch(/if\s*\(selectedFund\.value\)\s*{[^}]*resetShellScroll\(\)/s);
  });

  it('renders the ICP filing record in the page footer', () => {
    expect(source).toContain('赣ICP备2026012689号-1');
    expect(source).toContain('https://beian.miit.gov.cn/');
    expect(source).toContain('icp-record');
  });

  it('links the author mark to the personal homepage', () => {
    expect(source).toContain('https://jijiking.top/');
    expect(source).toContain('author-link');
    expect(source).toContain('打开作者 jijiking 的主页');
  });

  it('shows the domestic fund update notice once per device', () => {
    expect(source).toContain('DOMESTIC_FUND_UPDATE_NOTICE_KEY');
    expect(source).toContain('lof-domestic-fund-update-notice-20260624');
    expect(source).toContain('showUpdateNotice.value = shouldShowDomesticFundUpdateNotice()');
    expect(source).toContain("window.localStorage.setItem(DOMESTIC_FUND_UPDATE_NOTICE_KEY, 'closed')");
    expect(source).toContain('国内基金条目已更新');
  });

  it('renders the full filtered fund list without incremental pagination', () => {
    expect(source).toContain(':rows="visibleFunds.map((fund) => fund.raw || fund)"');
    expect(source).not.toContain('INITIAL_VISIBLE_ROWS');
    expect(source).not.toContain('VISIBLE_ROWS_STEP');
    expect(source).not.toContain('displayedFunds');
    expect(source).not.toContain('maybeLoadMoreRows()');
    expect(source).not.toContain(':total-rows="visibleFunds.length"');
  });
});
