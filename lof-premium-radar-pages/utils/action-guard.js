const DEFAULT_GUARD_MS = 2000;

function allowAction(context, key, waitMs = DEFAULT_GUARD_MS) {
  if (!context || !key) return true;
  const now = Date.now();
  const guard = context.__actionGuard || (context.__actionGuard = Object.create(null));
  const lastAt = Number(guard[key] || 0);
  if (now - lastAt < waitMs) return false;
  guard[key] = now;
  return true;
}

module.exports = { allowAction, DEFAULT_GUARD_MS };
