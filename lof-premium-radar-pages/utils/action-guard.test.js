import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = fs.readFileSync(path.resolve(import.meta.dirname, 'action-guard.js'), 'utf8');
const commonJsModule = { exports: {} };
vm.runInNewContext(source, { module: commonJsModule, exports: commonJsModule.exports, Date });
const { allowAction } = commonJsModule.exports;

describe('action guard', () => {
  afterEach(() => vi.restoreAllMocks());

  it('同一点击入口两秒内只执行一次，两秒后恢复', () => {
    const context = {};
    vi.spyOn(Date, 'now').mockReturnValueOnce(10_000).mockReturnValueOnce(11_999).mockReturnValueOnce(12_000);

    expect(allowAction(context, 'refresh')).toBe(true);
    expect(allowAction(context, 'refresh')).toBe(false);
    expect(allowAction(context, 'refresh')).toBe(true);
  });

  it('不同点击目标互不阻塞', () => {
    const context = {};
    vi.spyOn(Date, 'now').mockReturnValue(20_000);

    expect(allowAction(context, 'section:ALL')).toBe(true);
    expect(allowAction(context, 'section:WATCH')).toBe(true);
  });
});
