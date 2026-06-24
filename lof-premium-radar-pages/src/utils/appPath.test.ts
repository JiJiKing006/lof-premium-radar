import { describe, expect, it } from 'vitest';
import { isAdminRoute, pathInsideBase } from './appPath';

describe('app path helpers', () => {
  it('detects admin route at the local root path', () => {
    expect(isAdminRoute('/admin', '/')).toBe(true);
    expect(isAdminRoute('/admin/', '/')).toBe(true);
    expect(isAdminRoute('/', '/')).toBe(false);
  });

  it('detects admin route when the app is deployed under /lof', () => {
    expect(isAdminRoute('/lof/admin', '/lof/')).toBe(true);
    expect(isAdminRoute('/lof/admin/', '/lof/')).toBe(true);
    expect(isAdminRoute('/lof', '/lof/')).toBe(false);
  });

  it('keeps paths outside the app base unchanged', () => {
    expect(pathInsideBase('/person-website/admin', '/lof/')).toBe('/person-website/admin');
  });
});
