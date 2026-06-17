const crypto = require("crypto");
const db = global.pool || require("../db");

function sha256Password(password) {
  return `sha256$${crypto.createHash("sha256").update(String(password || "")).digest("hex")}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash) return false;
  const stored = String(storedHash);

  if (stored.startsWith("sha256$")) {
    return stored === sha256Password(password);
  }

  return stored === String(password || "");
}

function isAdministratorRequest(req) {
  const role = String(req.headers["x-user-role"] || req.body?.requesterRole || "").trim().toLowerCase();
  return role === "administrator";
}

function rejectNonAdministrator(req, res) {
  if (isAdministratorRequest(req)) return false;
  res.status(403).json({
    success: false,
    error: "Hanya administrator yang boleh manage users",
  });
  return true;
}

exports.login = async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: "Username dan password wajib diisi",
      });
    }

    const result = await db.query(
      `
        SELECT
          id,
          username,
          password_hash,
          name,
          COALESCE(NULLIF(roles, ''), role) AS roles
        FROM public.users
        WHERE LOWER(username) = LOWER($1)
        LIMIT 1
      `,
      [username]
    );

    const user = result.rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({
        success: false,
        error: "Username atau password tidak sesuai",
      });
    }

    return res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        roles: user.roles,
      },
    });
  } catch (err) {
    console.error("auth login error:", err);
    return res.status(500).json({
      success: false,
      error: "Gagal login",
    });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const oldPassword = String(req.body?.oldPassword || "");
    const newPassword = String(req.body?.newPassword || "");
    const retypeNewPassword = String(req.body?.retypeNewPassword || "");

    if (!username || !oldPassword || !newPassword || !retypeNewPassword) {
      return res.status(400).json({
        success: false,
        error: "Old password, new password, dan retype new password wajib diisi",
      });
    }

    if (newPassword !== retypeNewPassword) {
      return res.status(400).json({
        success: false,
        error: "New password dan retype new password tidak sama",
      });
    }

    if (newPassword.length < 5) {
      return res.status(400).json({
        success: false,
        error: "New password minimal 5 karakter",
      });
    }

    const current = await db.query(
      `
        SELECT id, username, password_hash, name, COALESCE(NULLIF(roles, ''), role) AS roles
        FROM public.users
        WHERE LOWER(username) = LOWER($1)
        LIMIT 1
      `,
      [username]
    );

    const user = current.rows[0];
    if (!user || !verifyPassword(oldPassword, user.password_hash)) {
      return res.status(401).json({
        success: false,
        error: "Old password tidak sesuai",
      });
    }

    await db.query(
      `
        UPDATE public.users
        SET password_hash = $1, updated_at = now()
        WHERE id = $2
      `,
      [sha256Password(newPassword), user.id]
    );

    return res.json({
      success: true,
      message: "Password berhasil diubah",
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        roles: user.roles,
      },
    });
  } catch (err) {
    console.error("auth changePassword error:", err);
    return res.status(500).json({
      success: false,
      error: "Gagal ubah password",
    });
  }
};

exports.listUsers = async (req, res) => {
  if (rejectNonAdministrator(req, res)) return;

  try {
    const result = await db.query(
      `
        SELECT
          id,
          username,
          name,
          COALESCE(NULLIF(roles, ''), role) AS roles,
          created_at,
          updated_at
        FROM public.users
        ORDER BY username ASC
      `
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("auth listUsers error:", err);
    return res.status(500).json({
      success: false,
      error: "Gagal memuat users",
    });
  }
};

exports.createUser = async (req, res) => {
  if (rejectNonAdministrator(req, res)) return;

  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    const roles = String(req.body?.roles || "").trim().toLowerCase();
    const name = String(req.body?.name || username).trim() || username;

    if (!username || !password || !roles) {
      return res.status(400).json({
        success: false,
        error: "Username, password, dan roles wajib diisi",
      });
    }

    if (password.length < 5) {
      return res.status(400).json({
        success: false,
        error: "Password minimal 5 karakter",
      });
    }

    const result = await db.query(
      `
        INSERT INTO public.users (username, password_hash, name, role, roles, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $4, now(), now())
        RETURNING id, username, name, roles, created_at, updated_at
      `,
      [username, sha256Password(password), name, roles]
    );

    return res.status(201).json({
      success: true,
      user: result.rows[0],
    });
  } catch (err) {
    console.error("auth createUser error:", err);
    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        error: "Username sudah terdaftar",
      });
    }
    return res.status(500).json({
      success: false,
      error: "Gagal membuat user",
    });
  }
};

exports.updateUser = async (req, res) => {
  if (rejectNonAdministrator(req, res)) return;

  try {
    const id = Number(req.params.id);
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    const roles = String(req.body?.roles || "").trim().toLowerCase();
    const name = String(req.body?.name || username).trim() || username;

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        error: "ID user tidak valid",
      });
    }

    if (!username || !roles) {
      return res.status(400).json({
        success: false,
        error: "Username dan roles wajib diisi",
      });
    }

    if (password && password.length < 5) {
      return res.status(400).json({
        success: false,
        error: "Password minimal 5 karakter",
      });
    }

    const params = password
      ? [username, name, roles, sha256Password(password), id]
      : [username, name, roles, id];
    const sql = password
      ? `
          UPDATE public.users
          SET username = $1, name = $2, role = $3, roles = $3, password_hash = $4, updated_at = now()
          WHERE id = $5
          RETURNING id, username, name, roles, created_at, updated_at
        `
      : `
          UPDATE public.users
          SET username = $1, name = $2, role = $3, roles = $3, updated_at = now()
          WHERE id = $4
          RETURNING id, username, name, roles, created_at, updated_at
        `;

    const result = await db.query(sql, params);
    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: "User tidak ditemukan",
      });
    }

    return res.json({
      success: true,
      user: result.rows[0],
    });
  } catch (err) {
    console.error("auth updateUser error:", err);
    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        error: "Username sudah terdaftar",
      });
    }
    return res.status(500).json({
      success: false,
      error: "Gagal update user",
    });
  }
};

exports.deleteUser = async (req, res) => {
  if (rejectNonAdministrator(req, res)) return;

  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        error: "ID user tidak valid",
      });
    }

    const result = await db.query(
      "DELETE FROM public.users WHERE id = $1 RETURNING id",
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: "User tidak ditemukan",
      });
    }

    return res.json({
      success: true,
      message: "User berhasil dihapus",
    });
  } catch (err) {
    console.error("auth deleteUser error:", err);
    return res.status(500).json({
      success: false,
      error: "Gagal hapus user",
    });
  }
};
