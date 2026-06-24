import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchEastmoneyQuotes: vi.fn(),
  fetchSinaQuotes: vi.fn(),
  fetchHaoetfQuotes: vi.fn(),
  fetchAkshareQuotes: vi.fn(),
  fetchPalmmicroLofReferenceRows: vi.fn(),
}));

vi.mock('../sources/eastmoneySource.js', () => ({
  fetchEastmoneyQuotes: mocks.fetchEastmoneyQuotes,
}));

vi.mock('../sources/sinaSource.js', () => ({
  fetchSinaQuotes: mocks.fetchSinaQuotes,
}));

vi.mock('../sources/haoetfSource.js', () => ({
  fetchHaoetfQuotes: mocks.fetchHaoetfQuotes,
}));

vi.mock('../sources/akshareSource.js', () => ({
  fetchAkshareQuotes: mocks.fetchAkshareQuotes,
}));

vi.mock('../sources/palmmicroSource.js', () => ({
  fetchPalmmicroLofReferenceRows: mocks.fetchPalmmicroLofReferenceRows,
}));

const { getQuotes } = await import('./quoteService.js');

describe('quoteService degraded availability', () => {
  it('returns an error snapshot instead of throwing when every QDII quote source is unavailable', async () => {
    mocks.fetchEastmoneyQuotes.mockRejectedValue(new Error('eastmoney down'));
    mocks.fetchSinaQuotes.mockRejectedValue(new Error('sina down'));
    mocks.fetchHaoetfQuotes.mockRejectedValue(new Error('haoetf down'));
    mocks.fetchAkshareQuotes.mockRejectedValue(new Error('akshare down'));

    const snapshot = await getQuotes({ category: 'QDII', force: true });

    expect(snapshot).toMatchObject({
      source: 'unavailable',
      sourceStatus: 'error',
      rows: [],
    });
    expect(snapshot.errors.join('；')).toContain('eastmoney');
    expect(snapshot.errors.join('；')).toContain('sina');
  });

  it('keeps the LOF code universe as missing quote rows when quote sources are unavailable', async () => {
    mocks.fetchPalmmicroLofReferenceRows.mockResolvedValue([
      { code: '501300', name: '美元债LOF', category: 'LOF', market: '债券' },
    ]);
    mocks.fetchEastmoneyQuotes.mockRejectedValue(new Error('eastmoney down'));
    mocks.fetchSinaQuotes.mockRejectedValue(new Error('sina down'));
    mocks.fetchAkshareQuotes.mockRejectedValue(new Error('akshare down'));

    const snapshot = await getQuotes({ category: 'LOF', force: true });

    expect(snapshot).toMatchObject({
      source: 'unavailable',
      sourceStatus: 'error',
    });
    expect(snapshot.rows.length).toBeGreaterThan(1);
    expect(snapshot.rows).toContainEqual(
      expect.objectContaining({
        code: '501300',
        name: '美元债LOF',
        source: 'quote-missing',
        sourceStatus: 'missing',
        dataStatus: 'missing_quote',
      })
    );
    expect(snapshot.rows.every((row) => row.source === 'quote-missing')).toBe(true);
    expect(snapshot.rows.every((row) => row.sourceStatus === 'missing')).toBe(true);
    expect(snapshot.rows.every((row) => row.dataStatus === 'missing_quote')).toBe(true);
    expect(snapshot.rows.every((row) => row.marketPrice == null && row.lastNav == null && row.premiumRate == null)).toBe(true);
  });
});
