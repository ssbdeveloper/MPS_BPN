// RBAC — global write guard (interim x-role, DEFAULT-DENY).
// ------------------------------------------------------------------
// Mounted once before all routers. For every write (POST/PUT/PATCH/DELETE):
//   1. allow-listed (operator/login/self)      -> allow
//   2. matches manifest -> check effective permission (x-user-id + x-user-role)
//   3. unmapped write                          -> deny (fail-closed)
// Reads (GET/HEAD/OPTIONS) pass through (gated in a later phase).
//
// MODE: log-only by default. Set env RBAC_ENFORCE=1 to actually block. In log-only
// it logs "[RBAC] would-deny ..." and lets the request through, so we can watch one
// cycle for any legitimate write the manifest missed before flipping to enforce.

const { MANIFEST, ALLOWLIST } = require('./manifest');
const { isAllowed } = require('./effective');

const ENFORCE = String(process.env.RBAC_ENFORCE || '') === '1';

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Compile a { m, p } entry to a matcher; track specificity for ordering.
function compile(entry) {
  const parts = String(entry.p).split('/').filter(Boolean);
  const staticCount = parts.filter((s) => !s.startsWith(':')).length;
  const body = parts.map((s) => (s.startsWith(':') ? '[^/]+' : escapeRegex(s))).join('/');
  return { ...entry, re: new RegExp(`^/${body}/?$`), staticCount, segs: parts.length };
}

// Most-specific first: more static segments, then more segments, then longer path.
function bySpecificity(a, b) {
  return (b.staticCount - a.staticCount) || (b.segs - a.segs) || (b.p.length - a.p.length);
}

const MANIFEST_C = MANIFEST.map(compile).sort(bySpecificity);
const ALLOW_C = ALLOWLIST.map(compile).sort(bySpecificity);

function allowHit(method, path) {
  return ALLOW_C.some((e) => e.m === method && e.re.test(path));
}
function manifestHit(method, path) {
  return MANIFEST_C.find((e) => e.m === method && e.re.test(path)) || null;
}

function warn(msg) {
  console.warn(`[RBAC]${ENFORCE ? '' : ' would-deny'} ${msg}`);
}
function decide(res, next, info) {
  if (ENFORCE) return res.status(403).json({ error: 'Forbidden', ...info });
  return next(); // log-only: let it through
}

module.exports = async function rbacGuard(req, res, next) {
  const method = String(req.method || '').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

  const path = req.path;
  if (allowHit(method, path)) return next();

  const hit = manifestHit(method, path);
  if (!hit) {
    warn(`UNMAPPED ${method} ${path}`);
    return decide(res, next, { reason: 'unmapped_write' });
  }

  try {
    const userId = req.headers['x-user-id'];
    const role = req.headers['x-user-role'];
    if (await isAllowed(userId, role, hit.f, hit.a)) return next();
    warn(`${method} ${path} feature=${hit.f} action=${hit.a} role=${role || '-'} user=${userId || '-'}`);
    return decide(res, next, { reason: 'insufficient_permission', feature: hit.f });
  } catch (err) {
    console.error('[RBAC] check error:', err.message);
    // On error: fail-closed only when enforcing.
    return ENFORCE ? res.status(500).json({ error: 'RBAC check failed' }) : next();
  }
};

module.exports.ENFORCE = ENFORCE;
module.exports._test = { manifestHit, allowHit }; // for route-resolution tests
