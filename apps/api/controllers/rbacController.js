// RBAC — role packages CRUD + user<->role assignment (Manage Users).
// ------------------------------------------------------------------
// Roles = paket akses bernama yang dibuat/diedit admin dari UI, bukan konstanta
// kode. Keputusan owner 2026-09-07 (docs/planning/rbac-role-paket.md):
//   1a user boleh pegang banyak role; 2a override per-user tetap teratas;
//   3b 5 role sistem jadi baris DB (bisa diedit & di-clone); 4a hapus diblokir
//   selama masih dipakai user.
// Semua endpoint admin-gated lewat middleware requireAdmin di routes/auth.js
// (sama seperti endpoint manage-users lain). RBAC_ENFORCE belum dinyalakan,
// tapi route write tetap didaftarkan di rbac/manifest.js (fail-closed).

const db = global.pool || require("../db");
const { FEATURE_ID_SET } = require("../rbac/features");
const { LEVELS } = require("../rbac/permissionMatrix");

const VALID_LEVELS = new Set([LEVELS.NO_ACCESS, LEVELS.READ_ONLY, LEVELS.FULL_ACCESS]);
const ROLE_KEY_RE = /^[a-z][a-z0-9_.]{0,31}$/;    // slug: huruf kecil + angka + _ dan . (dibuat otomatis dari nama)

function actorId(req) {
  return parseInt(req.headers["x-user-id"], 10) || null;
}

function validateLevel(level) {
  return VALID_LEVELS.has(String(level || ""));
}

function validatePermissionList(permissions) {
  if (!Array.isArray(permissions)) {
    return { ok: false, error: "permissions wajib berupa array [{ feature_id, level }]" };
  }
  for (const p of permissions) {
    if (!p || typeof p !== "object" || !FEATURE_ID_SET.has(p.feature_id)) {
      return { ok: false, error: `feature_id tidak dikenal: ${p?.feature_id}` };
    }
    if (!validateLevel(p.level)) {
      return { ok: false, error: `level tidak valid untuk ${p.feature_id}: ${p.level}` };
    }
  }
  return { ok: true };
}

async function fetchRoleWithPermissions(roleKey) {
  const role = await db.query(
    `SELECT role_key, name, description, default_level, is_system, is_active,
            created_by, created_at, updated_by, updated_at
       FROM rbac.roles WHERE role_key = $1 LIMIT 1`,
    [roleKey],
  );
  if (role.rowCount === 0) return null;
  const perms = await db.query(
    "SELECT feature_id, level FROM rbac.role_permissions WHERE role_key = $1",
    [roleKey],
  );
  const permissions = {};
  for (const row of perms.rows) permissions[row.feature_id] = row.level;
  return { ...role.rows[0], permissions };
}

// GET /auth/roles — semua role + isi paket + jumlah pemakai.
// Admin-only (requireAdmin di route). Dipakai tab Roles & picker paket di drawer user.
exports.listRoles = async (req, res) => {
  try {
    const roles = await db.query(
      `SELECT r.role_key, r.name, r.description, r.default_level, r.is_system,
              r.is_active, r.created_at, r.updated_at,
              (SELECT count(*) FROM rbac.user_roles ur WHERE ur.role_key = r.role_key) AS user_count
         FROM rbac.roles r
        ORDER BY r.is_system DESC, r.name ASC`,
    );
    const perms = await db.query(
      `SELECT rp.role_key, rp.feature_id, rp.level
         FROM rbac.role_permissions rp
        ORDER BY rp.role_key, rp.feature_id`,
    );
    const permMap = {};
    for (const row of perms.rows) {
      (permMap[row.role_key] = permMap[row.role_key] || {})[row.feature_id] = row.level;
    }
    const out = roles.rows.map((r) => ({ ...r, permissions: permMap[r.role_key] || {} }));
    return res.json({ success: true, roles: out });
  } catch (err) {
    console.error("rbac listRoles error:", err);
    return res.status(500).json({ success: false, error: "Gagal memuat roles" });
  }
};

// POST /auth/roles — buat role paket baru.
// Body: { role_key, name, description?, default_level?, permissions?: [{feature_id, level}] }
exports.createRole = async (req, res) => {
  const roleKey = String(req.body?.role_key || "").trim();
  const name = String(req.body?.name || "").trim();
  const description = String(req.body?.description || "").trim().slice(0, 255);
  const defaultLevel = String(req.body?.default_level || LEVELS.NO_ACCESS);
  const permissions = req.body?.permissions;

  if (!ROLE_KEY_RE.test(roleKey)) {
    return res.status(400).json({
      success: false,
      error: "role_key hanya huruf kecil, angka, titik, underscore; diawali huruf; maks 32 karakter",
    });
  }
  if (!name || name.length > 80) {
    return res.status(400).json({ success: false, error: "name wajib diisi (maks 80 karakter)" });
  }
  if (!validateLevel(defaultLevel)) {
    return res.status(400).json({ success: false, error: `default_level tidak valid: ${defaultLevel}` });
  }
  if (permissions !== undefined) {
    const check = validatePermissionList(permissions);
    if (!check.ok) return res.status(400).json({ success: false, error: check.error });
  }

  const setBy = actorId(req);
  const pool = db.pool || db;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ins = await client.query(
      `INSERT INTO rbac.roles (role_key, name, description, default_level, is_system, created_by, updated_by)
       VALUES ($1,$2,$3,$4, false, $5, $5) RETURNING role_key`,
      [roleKey, name, description, defaultLevel, setBy],
    );
    if (permissions) {
      for (const p of permissions) {
        await client.query(
          `INSERT INTO rbac.role_permissions (role_key, feature_id, level, updated_by)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (role_key, feature_id) DO UPDATE SET level = EXCLUDED.level, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [ins.rows[0].role_key, p.feature_id, p.level, setBy],
        );
      }
    }
    await client.query("COMMIT");
    const role = await fetchRoleWithPermissions(roleKey);
    return res.status(201).json({ success: true, role });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err.code === "23505") {
      return res.status(409).json({ success: false, error: `role_key '${roleKey}' sudah dipakai` });
    }
    console.error("rbac createRole error:", err);
    return res.status(500).json({ success: false, error: "Gagal membuat role" });
  } finally {
    client.release();
  }
};

// PUT /auth/roles/:role_key — edit meta role &/atau replace isi paket (full-set).
// Body (semua opsional): { name?, description?, default_level?, permissions? }
exports.updateRole = async (req, res) => {
  const roleKey = String(req.params.role_key || "").trim();
  if (!roleKey) return res.status(400).json({ success: false, error: "role_key tidak valid" });

  const name = req.body?.name === undefined ? undefined : String(req.body.name).trim();
  const description = req.body?.description === undefined ? undefined : String(req.body.description).trim().slice(0, 255);
  const defaultLevel = req.body?.default_level === undefined ? undefined : String(req.body.default_level);
  const permissions = req.body?.permissions;

  if (name !== undefined && (!name || name.length > 80)) {
    return res.status(400).json({ success: false, error: "name wajib diisi (maks 80 karakter)" });
  }
  if (defaultLevel !== undefined && !validateLevel(defaultLevel)) {
    return res.status(400).json({ success: false, error: `default_level tidak valid: ${defaultLevel}` });
  }
  if (permissions !== undefined) {
    if (!Array.isArray(permissions)) {
      return res.status(400).json({ success: false, error: "permissions wajib berupa array [{ feature_id, level }]" });
    }
    const check = validatePermissionList(permissions);
    if (!check.ok) return res.status(400).json({ success: false, error: check.error });
  }

  const setBy = actorId(req);
  const pool = db.pool || db;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sets = [];
    const params = [];
    if (name !== undefined) { params.push(name); sets.push(`name = $${params.length}`); }
    if (description !== undefined) { params.push(description); sets.push(`description = $${params.length}`); }
    if (defaultLevel !== undefined) { params.push(defaultLevel); sets.push(`default_level = $${params.length}`); }
    if (sets.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, error: "Tidak ada field yang diubah" });
    }
    params.push(setBy, roleKey);
    const upd = await client.query(
      `UPDATE rbac.roles SET ${sets.join(", ")}, updated_by = $${params.length - 1}, updated_at = now()
        WHERE role_key = $${params.length} RETURNING role_key`,
      params,
    );
    if (upd.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: `Role '${roleKey}' tidak ditemukan` });
    }
    if (permissions !== undefined) {
      await client.query("DELETE FROM rbac.role_permissions WHERE role_key = $1", [roleKey]);
      for (const p of permissions) {
        await client.query(
          `INSERT INTO rbac.role_permissions (role_key, feature_id, level, updated_by)
           VALUES ($1,$2,$3,$4)`,
          [roleKey, p.feature_id, p.level, setBy],
        );
      }
    }
    await client.query("COMMIT");
    const role = await fetchRoleWithPermissions(roleKey);
    return res.json({ success: true, role });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("rbac updateRole error:", err);
    return res.status(500).json({ success: false, error: "Gagal update role" });
  } finally {
    client.release();
  }
};

// DELETE /auth/roles/:role_key — hapus role. 4a: DIBLOKIR selama masih dipakai user.
exports.deleteRole = async (req, res) => {
  const roleKey = String(req.params.role_key || "").trim();
  if (!roleKey) return res.status(400).json({ success: false, error: "role_key tidak valid" });
  try {
    const usage = await db.query(
      "SELECT count(*) AS n FROM rbac.user_roles WHERE role_key = $1",
      [roleKey],
    );
    const userCount = parseInt(usage.rows[0].n, 10);
    if (userCount > 0) {
      return res.status(409).json({
        success: false,
        error: `Role masih dipakai ${userCount} user — lepas dulu dari user tersebut sebelum menghapus`,
        userCount,
      });
    }
    const del = await db.query(
      "DELETE FROM rbac.roles WHERE role_key = $1 RETURNING role_key",
      [roleKey],
    );
    if (del.rowCount === 0) {
      return res.status(404).json({ success: false, error: `Role '${roleKey}' tidak ditemukan` });
    }
    return res.json({ success: true, message: `Role '${roleKey}' berhasil dihapus` });
  } catch (err) {
    console.error("rbac deleteRole error:", err);
    return res.status(500).json({ success: false, error: "Gagal hapus role" });
  }
};

// PUT /auth/users/:id/roles — GANTI role paket user secara persis (full-set).
// Body: { role_keys: string[] } — bisa kosong (user tanpa paket; akses jatuh ke
// fallback matrix kode kolom legacy). Tidak ada role yang dipaksa-pertahankan:
// admin memilih semua paket yang user pegang (termasuk role sistem bila mau).
exports.updateUserRoles = async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (!Number.isInteger(userId)) {
    return res.status(400).json({ success: false, error: "id user tidak valid" });
  }
  const roleKeys = req.body?.role_keys;
  if (!Array.isArray(roleKeys) || roleKeys.some((k) => typeof k !== "string")) {
    return res.status(400).json({ success: false, error: "role_keys wajib berupa array of string" });
  }
  const wanted = [...new Set(roleKeys.map((k) => k.trim()).filter(Boolean))];

  const setBy = actorId(req);
  const pool = db.pool || db;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const user = await client.query(
      "SELECT id FROM public.users WHERE id = $1 LIMIT 1",
      [userId],
    );
    if (user.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "User tidak ditemukan" });
    }

    if (wanted.length > 0) {
      const existing = await client.query(
        "SELECT role_key FROM rbac.roles WHERE role_key = ANY($1)",
        [wanted],
      );
      const known = new Set(existing.rows.map((r) => r.role_key));
      const unknown = wanted.filter((k) => !known.has(k));
      if (unknown.length > 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ success: false, error: `role tidak dikenal: ${unknown.join(", ")}` });
      }
    }

    await client.query("DELETE FROM rbac.user_roles WHERE user_id = $1", [userId]);
    for (const k of wanted) {
      await client.query(
        `INSERT INTO rbac.user_roles (user_id, role_key, assigned_by)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [userId, k, setBy],
      );
    }
    await client.query("COMMIT");
    return res.json({ success: true, role_keys: wanted });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("rbac updateUserRoles error:", err);
    return res.status(500).json({ success: false, error: "Gagal simpan role user" });
  } finally {
    client.release();
  }
};
