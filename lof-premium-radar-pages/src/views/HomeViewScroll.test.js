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
});
