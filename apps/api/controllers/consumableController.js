const db = global.pool || require("../db");
const fs = require("fs");
const path = require("path");

const WAITING_LEADER_STATUS = "waiting leader";
const WAITING_WAREHOUSE_STATUS = "waiting warehouse";
const READY_STATUS = "ready";
const CLOSE_STATUS = "Close";
const REJECTED_STATUS = "rejected";
const MAX_STOCK_RESULTS = 100;

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function buildTicketNo(ticketId, now = new Date()) {
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  const datePart = `${pad(now.getDate())}${pad(now.getMonth() + 1)}${String(now.getFullYear()).slice(-2)}`;
  return `cis-${datePart}-${ticketId}`;
}

function buildPendingTicketNo() {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `cis-pending-${Date.now()}-${randomPart}`;
}

function normalizeRole(value) {
  return normalizeText(value).toLowerCase();
}

// Authorization role comes ONLY from the authenticated header the frontend sends
// (x-user-role, derived from the logged-in user). NEVER from req.body / req.query —
// a client-supplied field is forgeable and must not drive an auth or workflow-stage
// decision. This is the single source of the acting role for every gated endpoint.
function actorRole(req) {
  return normalizeRole(req.headers["x-user-role"]);
}

function nextStatusForRole(role) {
  if (role === "foreman") return WAITING_WAREHOUSE_STATUS;
  if (role === "warehouse") return READY_STATUS;
  return null;
}

function canManageItems(role) {
  return role === "foreman" || role === "warehouse";
}

function saveConsumableImage(imageData, cisNo) {
  if (!imageData) return null;

  const match = String(imageData).match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
  const extension = match?.[1]?.toLowerCase().replace("jpeg", "jpg") || "jpg";
  const base64 = match?.[2] || String(imageData).replace(/^data:image\/\w+;base64,/, "");
  const safeCis = normalizeText(cisNo).replace(/[^\w-]/g, "_") || "unknown";
  const uploadsRoot = path.join(__dirname, "../uploads");
  const dir = path.join(uploadsRoot, "consumable", safeCis);
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${Date.now()}.${extension}`;
  fs.writeFileSync(path.join(dir, filename), Buffer.from(base64, "base64"));
  return `/uploads/consumable/${safeCis}/${filename}`;
}

async function getTicketWithItems(ticketId, client = db) {
  const result = await client.query(
    `
      SELECT
        t.id,
        t.cis_no,
        t.sn_karyawan,
        t.nama_karyawan,
        t.workcenter,
        t.machineid,
        t.comment,
        t.status,
        t.person_image,
        t.image_person,
        t.closedate,
        t.created,
        t.picked_by_sn,
        t.picked_by_name,
        t.picked_by_workcenter,
        t.picked_by_machineid,
        t.picked_by_nfcid,
        t.picked_by_role,
        t.picked_at,
        COALESCE(
          json_agg(
            json_build_object(
              'id', i.id,
              'materialcode', i.materialcode,
              'materialdescription', i.materialdescription,
              'quanitty', i.quanitty,
              'uom', i.uom,
              'created', i.created,
              'cost_center', i.cost_center,
              'gl_account', i.gl_account,
              'code_mm', i.code_mm,
              'status', i.status,
              'rejected_by', i.rejected_by,
              'rejected_reason', i.rejected_reason,
              'rejected_at', i.rejected_at,
              'adjusted_by', i.adjusted_by,
              'adjusted_at', i.adjusted_at
            )
            ORDER BY i.id
          ) FILTER (WHERE i.id IS NOT NULL),
          '[]'::json
        ) AS items
      FROM consumable_ticket t
      LEFT JOIN consumable_item i ON i.cis_no = t.cis_no
      WHERE t.id = $1
      GROUP BY t.id
    `,
    [ticketId]
  );

  return result.rows[0] || null;
}

exports.getHistory = async (req, res) => {
  const sn = normalizeText(req.query.sn || req.params.sn);

  if (!sn) {
    return res.status(400).json({ error: "sn_karyawan wajib diisi" });
  }

  try {
    const result = await db.query(
      `
        SELECT
          t.id,
          t.cis_no,
          t.sn_karyawan,
          t.nama_karyawan,
          t.workcenter,
          t.machineid,
          t.comment,
          t.status,
          t.person_image,
          t.image_person,
          t.closedate,
          t.created,
          t.picked_by_sn,
          t.picked_by_name,
          t.picked_by_workcenter,
          t.picked_by_machineid,
          t.picked_by_nfcid,
          t.picked_by_role,
          t.picked_at,
          COALESCE(
            json_agg(
              json_build_object(
                'id', i.id,
                'materialcode', i.materialcode,
                'materialdescription', i.materialdescription,
                'quanitty', i.quanitty,
                'uom', i.uom,
                'created', i.created,
                'cost_center', i.cost_center,
                'gl_account', i.gl_account,
                'code_mm', i.code_mm,
                'status', i.status,
                'rejected_by', i.rejected_by,
                'rejected_reason', i.rejected_reason,
                'rejected_at', i.rejected_at,
                'adjusted_by', i.adjusted_by,
                'adjusted_at', i.adjusted_at
              )
              ORDER BY i.id
            ) FILTER (WHERE i.id IS NOT NULL),
            '[]'::json
          ) AS items
        FROM consumable_ticket t
        LEFT JOIN consumable_item i ON i.cis_no = t.cis_no
        WHERE t.sn_karyawan = $1
        GROUP BY t.id
        ORDER BY t.created DESC, t.id DESC
      `,
      [sn]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.searchStock = async (req, res) => {
  const search = normalizeText(req.query.search);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), MAX_STOCK_RESULTS);
  const values = [limit];
  let where = "";

  if (search) {
    values.unshift(`%${search.toLowerCase()}%`);
    where = `
      WHERE LOWER(COALESCE(material_code, '')) LIKE $1
         OR LOWER(COALESCE(code_mm, '')) LIKE $1
         OR LOWER(COALESCE(material_description, '')) LIKE $1
         OR LOWER(COALESCE(type, '')) LIKE $1
    `;
  }

  try {
    const result = await db.query(
      `
        SELECT
          id,
          material_code,
          code_mm,
          material_description,
          mrp_type,
          plant,
          quantity,
          type,
          uom
        FROM consumable_stock
        ${where}
        ORDER BY material_description ASC NULLS LAST, material_code ASC NULLS LAST
        LIMIT $${values.length}
      `,
      values
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getControlTickets = async (req, res) => {
  try {
    const result = await db.query(
      `
        SELECT
          t.id,
          t.cis_no,
          t.sn_karyawan,
          t.nama_karyawan,
          t.workcenter,
          t.machineid,
          t.comment,
          t.status,
          t.person_image,
          t.image_person,
          t.closedate,
          t.created,
          t.picked_by_sn,
          t.picked_by_name,
          t.picked_by_workcenter,
          t.picked_by_machineid,
          t.picked_by_nfcid,
          t.picked_by_role,
          t.picked_at,
          COALESCE(
            json_agg(
              json_build_object(
                'id', i.id,
                'materialcode', i.materialcode,
                'materialdescription', i.materialdescription,
                'quanitty', i.quanitty,
                'uom', i.uom,
                'created', i.created,
                'cost_center', i.cost_center,
                'gl_account', i.gl_account,
                'code_mm', i.code_mm,
                'status', i.status,
                'rejected_by', i.rejected_by,
                'rejected_reason', i.rejected_reason,
                'rejected_at', i.rejected_at,
                'adjusted_by', i.adjusted_by,
                'adjusted_at', i.adjusted_at
              )
              ORDER BY i.id
            ) FILTER (WHERE i.id IS NOT NULL),
            '[]'::json
          ) AS items
        FROM consumable_ticket t
        LEFT JOIN consumable_item i ON i.cis_no = t.cis_no
        GROUP BY t.id
        ORDER BY t.created DESC, t.id DESC
      `
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.approveTicket = async (req, res) => {
  const ticketId = Number(req.params.id);
  const role = actorRole(req);
  const nextStatus = nextStatusForRole(role);

  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({ error: "ID ticket tidak valid" });
  }

  if (!nextStatus) {
    return res.status(403).json({ error: "Role tidak diizinkan approve consumable" });
  }

  const expectedStatus = role === "foreman" ? WAITING_LEADER_STATUS : WAITING_WAREHOUSE_STATUS;

  try {
    const result = await db.query(
      `
        UPDATE consumable_ticket
        SET
          status = $1,
          closedate = CASE WHEN $1 = $4 THEN CURRENT_TIMESTAMP ELSE closedate END
        WHERE id = $2
          AND LOWER(COALESCE(status, '')) = $3
        RETURNING *
      `,
      [nextStatus, ticketId, expectedStatus, READY_STATUS]
    );

    if (result.rowCount === 0) {
      return res.status(409).json({
        error: `Ticket hanya bisa di-approve role ${role} saat status ${expectedStatus}`,
      });
    }

    res.json({
      message: "Consumable ticket berhasil di-approve",
      ticket: result.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.closeTicket = async (req, res) => {
  const ticketId = Number(req.params.id);
  const role = actorRole(req);
  const nfcid = normalizeText(req.body?.nfcid);
  const imageData = req.body?.image_data;

  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({ error: "ID ticket tidak valid" });
  }

  if (role !== "warehouse") {
    return res.status(403).json({ error: "Hanya warehouse yang boleh close ticket ready" });
  }

  if (!nfcid) {
    return res.status(400).json({ error: "Scan ID pengambil wajib diisi" });
  }

  if (!imageData) {
    return res.status(400).json({ error: "Foto pengambil wajib di-capture" });
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      "SELECT * FROM usernfc WHERE nfcid = $1 LIMIT 1",
      [nfcid]
    );

    if (userResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "User pengambil tidak ditemukan" });
    }

    const user = userResult.rows[0];
    const ticketResult = await client.query(
      `
        SELECT *
        FROM consumable_ticket
        WHERE id = $1
          AND LOWER(COALESCE(status, '')) = $2
        FOR UPDATE
      `,
      [ticketId, READY_STATUS]
    );

    if (ticketResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Ticket hanya bisa diambil saat status ready" });
    }

    const activeItems = await client.query(
      `
        SELECT COUNT(*)::integer AS count
        FROM consumable_item
        WHERE cis_no = $1
          AND LOWER(COALESCE(status, 'active')) <> $2
      `,
      [ticketResult.rows[0].cis_no, REJECTED_STATUS]
    );

    if (activeItems.rows[0].count <= 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Ticket tidak memiliki item aktif untuk diambil" });
    }

    const imagePath = saveConsumableImage(imageData, ticketResult.rows[0].cis_no);

    await client.query(
      `
        UPDATE consumable_ticket
        SET
          status = $1,
          closedate = CURRENT_TIMESTAMP,
          picked_at = CURRENT_TIMESTAMP,
          picked_by_sn = $2,
          picked_by_name = $3,
          picked_by_workcenter = $4,
          picked_by_machineid = $5,
          picked_by_nfcid = $6,
          picked_by_role = $7,
          image_person = COALESCE($8, image_person)
        WHERE id = $9
      `,
      [
        CLOSE_STATUS,
        normalizeText(user.snssb) || null,
        normalizeText(user.full_name) || null,
        normalizeText(user.workcenter) || null,
        normalizeText(user.machineid) || null,
        nfcid,
        normalizeText(user.roles) || null,
        imagePath,
        ticketId,
      ]
    );

    const updatedTicket = await getTicketWithItems(ticketId, client);
    await client.query("COMMIT");

    res.json({
      message: "Consumable ticket berhasil di-close",
      ticket: updatedTicket,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.adjustItemQuantity = async (req, res) => {
  const itemId = Number(req.params.itemId);
  const role = actorRole(req);
  const quantity = normalizeNumber(req.body?.quantity);
  const updatedBy = normalizeText(req.body?.username) || role;

  if (!Number.isInteger(itemId) || itemId <= 0) {
    return res.status(400).json({ error: "ID item tidak valid" });
  }

  if (!canManageItems(role)) {
    return res.status(403).json({ error: "Role tidak diizinkan adjust item" });
  }

  if (!quantity || quantity <= 0) {
    return res.status(400).json({ error: "Quantity harus lebih dari 0" });
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const itemResult = await client.query(
      `
        SELECT i.*, t.id AS ticket_id, t.status AS ticket_status
        FROM consumable_item i
        JOIN consumable_ticket t ON t.cis_no = i.cis_no
        WHERE i.id = $1
        FOR UPDATE
      `,
      [itemId]
    );

    if (itemResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Item tidak ditemukan" });
    }

    const item = itemResult.rows[0];
    const ticketStatus = normalizeRole(item.ticket_status);
    if ([CLOSE_STATUS.toLowerCase(), REJECTED_STATUS].includes(ticketStatus)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Ticket sudah final dan tidak bisa di-adjust" });
    }

    if (normalizeRole(item.status || "active") === REJECTED_STATUS) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Item rejected tidak bisa di-adjust" });
    }

    const stockResult = await client.query(
      `
        SELECT quantity
        FROM consumable_stock
        WHERE material_code = $1
          AND COALESCE(code_mm, '') = COALESCE($2, '')
        ORDER BY quantity DESC
        LIMIT 1
      `,
      [item.materialcode, item.code_mm || null]
    );

    const availableStock = normalizeNumber(stockResult.rows[0]?.quantity);
    if (quantity > availableStock) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: `Quantity melebihi stock tersedia (${availableStock})` });
    }

    await client.query(
      `
        UPDATE consumable_item
        SET
          quanitty = $1,
          adjusted_by = $2,
          adjusted_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `,
      [quantity, updatedBy, itemId]
    );

    const updatedTicket = await getTicketWithItems(item.ticket_id, client);
    await client.query("COMMIT");

    res.json({
      message: "Quantity item berhasil di-adjust",
      ticket: updatedTicket,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.rejectItem = async (req, res) => {
  const itemId = Number(req.params.itemId);
  const role = actorRole(req);
  const reason = normalizeText(req.body?.reason);
  const rejectedBy = normalizeText(req.body?.username) || role;

  if (!Number.isInteger(itemId) || itemId <= 0) {
    return res.status(400).json({ error: "ID item tidak valid" });
  }

  if (!canManageItems(role)) {
    return res.status(403).json({ error: "Role tidak diizinkan reject item" });
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const itemResult = await client.query(
      `
        SELECT i.*, t.id AS ticket_id, t.status AS ticket_status
        FROM consumable_item i
        JOIN consumable_ticket t ON t.cis_no = i.cis_no
        WHERE i.id = $1
        FOR UPDATE
      `,
      [itemId]
    );

    if (itemResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Item tidak ditemukan" });
    }

    const item = itemResult.rows[0];
    const ticketStatus = normalizeRole(item.ticket_status);
    if ([CLOSE_STATUS.toLowerCase(), REJECTED_STATUS].includes(ticketStatus)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Ticket sudah final dan tidak bisa di-reject" });
    }

    await client.query(
      `
        UPDATE consumable_item
        SET
          status = $1,
          rejected_by = $2,
          rejected_reason = $3,
          rejected_at = CURRENT_TIMESTAMP
        WHERE id = $4
      `,
      [REJECTED_STATUS, rejectedBy, reason || null, itemId]
    );

    const activeItems = await client.query(
      `
        SELECT COUNT(*)::integer AS count
        FROM consumable_item
        WHERE cis_no = $1
          AND LOWER(COALESCE(status, 'active')) <> $2
      `,
      [item.cis_no, REJECTED_STATUS]
    );

    if (activeItems.rows[0].count <= 0) {
      await client.query(
        `
          UPDATE consumable_ticket
          SET status = $1, closedate = CURRENT_TIMESTAMP
          WHERE id = $2
        `,
        [REJECTED_STATUS, item.ticket_id]
      );
    }

    const updatedTicket = await getTicketWithItems(item.ticket_id, client);
    await client.query("COMMIT");

    res.json({
      message: "Item berhasil di-reject",
      ticket: updatedTicket,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.createRequest = async (req, res) => {
  const client = await db.connect();

  try {
    const {
      sn_karyawan,
      nama_karyawan,
      workcenter,
      machineid,
      comment,
      person_image,
      items,
    } = req.body || {};

    const normalizedSn = normalizeText(sn_karyawan);
    const normalizedName = normalizeText(nama_karyawan);
    const normalizedItems = Array.isArray(items) ? items : [];

    if (!normalizedSn || !normalizedName) {
      return res.status(400).json({ error: "Data karyawan tidak lengkap" });
    }

    if (normalizedItems.length === 0) {
      return res.status(400).json({ error: "Minimal 1 item consumable wajib dipilih" });
    }

    await client.query("BEGIN");

    const requestedTotals = new Map();

    for (const item of normalizedItems) {
      const materialCode = normalizeText(item.materialcode || item.material_code);
      const codeMm = normalizeText(item.code_mm);
      const quantity = normalizeNumber(item.quanitty || item.quantity);
      const stockId = normalizeNumber(item.stock_id);
      const key = stockId > 0 ? `id:${stockId}` : `code:${materialCode}::${codeMm}`;
      requestedTotals.set(key, (requestedTotals.get(key) || 0) + quantity);
    }

    const pendingCisNo = buildPendingTicketNo();
    const ticketResult = await client.query(
      `
        INSERT INTO consumable_ticket
          (cis_no, sn_karyawan, nama_karyawan, workcenter, machineid, comment, status, person_image)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `,
      [
        pendingCisNo,
        normalizedSn,
        normalizedName,
        normalizeText(workcenter) || null,
        normalizeText(machineid) || null,
        normalizeText(comment) || null,
        WAITING_LEADER_STATUS,
        normalizeText(person_image) || null,
      ]
    );
    const ticketId = ticketResult.rows[0].id;
    const cisNo = buildTicketNo(ticketId);

    await client.query(
      "UPDATE consumable_ticket SET cis_no = $1 WHERE id = $2",
      [cisNo, ticketId]
    );

    for (const item of normalizedItems) {
      const materialCode = normalizeText(item.materialcode || item.material_code);
      const materialDescription = normalizeText(item.materialdescription || item.material_description);
      const quantity = normalizeNumber(item.quanitty || item.quantity);
      const uom = normalizeText(item.uom);
      const glAccount = normalizeText(item.gl_account);
      const codeMm = normalizeText(item.code_mm);
      const costCenter = normalizeText(item.cost_center || workcenter);
      const stockId = normalizeNumber(item.stock_id);
      const requestKey = stockId > 0 ? `id:${stockId}` : `code:${materialCode}::${codeMm}`;

      if (!materialCode || !materialDescription || !quantity || quantity <= 0 || !glAccount) {
        throw new Error("Item consumable tidak lengkap");
      }

      const stockResult = stockId > 0
        ? await client.query(
          `
            SELECT quantity
            FROM consumable_stock
            WHERE id = $1
            LIMIT 1
          `,
          [stockId]
        )
        : await client.query(
          `
            SELECT quantity
            FROM consumable_stock
            WHERE material_code = $1
              AND COALESCE(code_mm, '') = COALESCE($2, '')
            ORDER BY quantity DESC
            LIMIT 1
          `,
          [materialCode, codeMm || null]
      );

      const availableStock = normalizeNumber(stockResult.rows[0]?.quantity);
      if ((requestedTotals.get(requestKey) || 0) > availableStock) {
        throw new Error(`Request ${materialCode} melebihi stock tersedia (${availableStock})`);
      }

      await client.query(
        `
          INSERT INTO consumable_item
            (materialcode, materialdescription, quanitty, uom, cost_center, cis_no, gl_account, code_mm)
          VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          materialCode,
          materialDescription,
          quantity,
          uom || null,
          costCenter || null,
          cisNo,
          glAccount,
          codeMm || null,
        ]
      );
    }

    await client.query("COMMIT");

    res.status(201).json({
      message: "Consumable request berhasil dibuat",
      id: ticketId,
      cis_no: cisNo,
      status: WAITING_LEADER_STATUS,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};
