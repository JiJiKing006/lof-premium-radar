import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./DetailPanel.vue', import.meta.url), 'utf8');

describe('DetailPanel loading behavior', () => {
  it('does not block the quote strip on history loading', () => {
    expect(source).not.toContain('Promise.all');
    expect(source).toContain('fetchFundDetail(props.row.code, { section: props.section, force: false })');
    expect(source).toContain('fetchFundHistory(props.row.code, { limit: 40, force: false })');
    expect(source).toContain('historyLoading');
    expect(source).not.toContain('detail-quote-skeleton');
  });
});
