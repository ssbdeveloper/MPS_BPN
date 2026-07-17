// Hard administrator-only gate for sensitive endpoints.
// ------------------------------------------------------------------
// Unlike the global rbacGuard (which is log-only for writes until RBAC_ENFORCE=1
// and lets all reads through), this middleware ALWAYS enforces: a request whose
// x-user-role is not administrator gets 403, no matter the mode. Use it on routes
// that must be admin-only regardless of the global RBAC rollout state.
//
// Identity is the same interim header the rest of the app uses: x-user-role
// (the frontend sends it from the logged-in user's role). 'admin' is accepted as
// an alias for 'administrator' (data inconsistency in the users table).

module.exports = function requireAdmin(req, res, next) {
  const role = String(req.headers["x-user-role"] || "").trim().toLowerCase();
  if (role === "administrator" || role === "admin") return next();
  return res.status(403).json({ error: "Forbidden: administrator only" });
};
