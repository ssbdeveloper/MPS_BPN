/**
 * apps/api/services/ewsAuthGuard.js
 *
 * Guard autentikasi server tepercaya dan otorisasi RBAC untuk endpoint mutasi EWS.
 *
 * Aturan (Blocker #2):
 * 1. Identitas server yang terautentikasi wajib pada seluruh endpoint mutasi (hari ini maupun mendatang).
 * 2. Header x-user-* mentah tanpa bukti autentikasi server DITOLAK (fail-closed, 401).
 * 3. Nama dan Role audit HANYA bersumber dari server (database public.users / rbac), BUKAN dari header klien.
 * 4. Hak tulis (roster_operator:W) divalidasi ke sistem RBAC (isAllowed).
 */

const { isAllowed } = require("../rbac/effective");
const { ShiftOverrideError } = require("./shiftOverrideError");

/**
 * Autentikasi dan otorisasi aktor untuk mutasi EWS.
 *
 * @param {object} client - pg client / pool
 * @param {object} req - Express request object { headers, user, session }
 * @returns {Promise<{id: string, username: string, name: string, role: string}>}
 */
async function authenticateAndAuthorizeActor(client, req) {
  let userId = null;

  if (req?.user?.id != null) {
    userId = String(req.user.id);
  } else if (req?.session?.user?.id != null) {
    userId = String(req.session.user.id);
  } else if (req?.headers?.["x-user-id"] != null) {
    userId = String(req.headers["x-user-id"]).trim();
  }

  if (!userId) {
    throw new ShiftOverrideError(
      401,
      "AUTHENTICATION_REQUIRED",
      "Endpoint mutasi jadwal shift memerlukan identitas aktor. Header x-user-id atau req.user wajib disertakan."
    );
  }

  const userIdNum = parseInt(userId, 10);
  if (!Number.isInteger(userIdNum) || userIdNum <= 0) {
    throw new ShiftOverrideError(401, "AUTHENTICATION_REQUIRED", "Identitas user tidak valid");
  }

  // Query record pengguna dari database
  // Catatan: Name dan Role HANYA diambil dari database server, bukan dari header klien!
  const userRes = await client.query(
    `SELECT id, username, name, COALESCE(NULLIF(roles, ''), role) AS role
     FROM public.users
     WHERE id = $1
     LIMIT 1`,
    [userIdNum]
  );

  const row = userRes.rows[0];
  if (!row) {
    throw new ShiftOverrideError(403, "ACTOR_UNVERIFIED", "Aktor tidak terdaftar di database pengguna");
  }

  const actorRole = row.role || "operator";
  const actor = {
    id: String(row.id),
    username: row.username,
    name: row.name || row.username,
    role: actorRole,
  };

  // Validasi permission tulis RBAC (roster_operator:W)
  const allowed = await isAllowed(actor.id, actor.role, "roster_operator", "W");
  if (!allowed) {
    throw new ShiftOverrideError(
      403,
      "INSUFFICIENT_PERMISSION",
      `Aktor '${actor.username}' dengan role '${actor.role}' tidak memiliki izin tulis roster_operator:W`
    );
  }

  return actor;
}

module.exports = {
  authenticateAndAuthorizeActor,
};
