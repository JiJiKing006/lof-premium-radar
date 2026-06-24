export function pathInsideBase(pathname: string, baseUrl = '/') {
  const normalizedPath = normalizePath(pathname);
  const normalizedBase = normalizeBase(baseUrl);

  if (normalizedBase === '/') return normalizedPath;
  if (normalizedPath === normalizedBase) return '/';
  if (normalizedPath.startsWith(`${normalizedBase}/`)) {
    return normalizePath(normalizedPath.slice(normalizedBase.length));
  }

  return normalizedPath;
}

export function isAdminRoute(pathname: string, baseUrl = '/') {
  return pathInsideBase(pathname, baseUrl) === '/admin';
}

function normalizePath(value: string) {
  const path = String(value || '/').split(/[?#]/)[0].replace(/\/+$/, '');
  return path || '/';
}

function normalizeBase(value: string) {
  const base = normalizePath(value || '/');
  return base.startsWith('/') ? base : `/${base}`;
}
