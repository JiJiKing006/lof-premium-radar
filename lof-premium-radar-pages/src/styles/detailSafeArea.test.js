import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./app.css', import.meta.url), 'utf8');

describe('detail mobile safe area', () => {
  it('keeps the sticky detail nav below the top safe area with a reliable back hit target', () => {
    expect(css).toMatch(/\.detail-mode\s+\.detail-nav\s*{[^}]*top:\s*env\(safe-area-inset-top\)/s);
    expect(css).toMatch(/\.detail-mode\s+\.detail-nav\s+button\s*{[^}]*min-width:\s*88px/s);
    expect(css).toMatch(/\.detail-mode\s+\.detail-scroll\s*{[^}]*scroll-padding-top:\s*calc\(env\(safe-area-inset-top\) \+ 56px\)/s);
  });
});
