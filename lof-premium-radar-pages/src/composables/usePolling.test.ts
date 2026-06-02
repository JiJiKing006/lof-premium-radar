import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePolling } from './usePolling';

describe('usePolling', () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-02T01:00:00.000Z'));
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
      },
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        visibilityState: 'visible',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
  });

  it('prefetches before the countdown deadline and applies data at the deadline', async () => {
    const task = vi.fn(async () => ({ rows: ['next-snapshot'] }));
    const onData = vi.fn();
    const polling = usePolling(task, {
      immediate: false,
      interval: 30_000,
      maxInterval: 30_000,
      prefetchLeadMs: 5_000,
      onData,
    });

    polling.start();

    expect(polling.nextRefreshAt.value).toBe(new Date('2026-06-02T01:00:30.000Z').getTime());

    await vi.advanceTimersByTimeAsync(24_999);
    expect(task).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(1);
    expect(onData).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4_999);
    expect(onData).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(onData).toHaveBeenCalledWith({ rows: ['next-snapshot'] });
    expect(polling.lastSuccessAt.value).toBe('2026-06-02T01:00:30.000Z');
    expect(polling.nextRefreshAt.value).toBe(new Date('2026-06-02T01:01:00.000Z').getTime());
  });

  it('adapts the prefetch lead to the previous request duration', async () => {
    const task = vi.fn(
      () =>
        new Promise<{ rows: string[] }>((resolve) => {
          window.setTimeout(() => resolve({ rows: ['slow-snapshot'] }), 12_000);
        }),
    );
    const onData = vi.fn();
    const polling = usePolling(task, {
      immediate: true,
      interval: 30_000,
      maxInterval: 30_000,
      prefetchLeadMs: 5_000,
      onData,
    });

    polling.start();
    expect(task).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(12_000);
    expect(onData).toHaveBeenCalledTimes(1);
    expect(polling.nextRefreshAt.value).toBe(new Date('2026-06-02T01:00:42.000Z').getTime());

    await vi.advanceTimersByTimeAsync(16_999);
    expect(task).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);
    expect(onData).toHaveBeenCalledTimes(1);
  });
});
