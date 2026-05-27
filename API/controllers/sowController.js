const db = global.pool || require("../db");
const pgPool = db.pool || db; // normalize: raw Pool (global.pool) vs { query, pool } (db module)
const path = require('path');
const fs   = require('fs');
const { v4: uuidv4 } = require('uuid');

const SOW_HISTORY_COLUMNS = `
  customer,
  order_no,
  ssbr_id,
  operation_no,
  operation_text,
  workcenterdescription AS operation_name,
  planhours,
  wct_group,
  workcenter,
  status,
  part_number,
  part_name,
  model
`;

const EDITABLE_SOW_COLUMNS = [
  "order_no",
  "operation_no",
  "ssbr_id",
  "part_number",
  "part_name",
  "model",
  "customer",
  "location",
  "wct_group",
  "workcenter",
  "operation_text",
  "workcenterdescription",
  "planhours",
  "systemstatus",
  "confirmation",
  "status",
  "finish_date",
  "weight",
  "created_by",
  "type",
  "group",
  "category",
  "remark",
  "sync",
  "plan_start",
  "plan_finish",
  "actual_start",
  "actual_finish",
  "actual_progress",
  "actual_hours",
  "progress",
  "revision_no",
];

async function ensureSowRevisionHistoryTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS sow_revision_history (
      id BIGSERIAL PRIMARY KEY,
      order_no TEXT NOT NULL,
      revision_no INTEGER NOT NULL,
      action TEXT NOT NULL DEFAULT 'edit',
      before_data JSONB,
      after_data JSONB,
      changed_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (order_no, revision_no)
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_sow_revision_history_order_created
      ON sow_revision_history (order_no, created_at DESC)
  `);
  await db.query(`ALTER TABLE public.sow ADD COLUMN IF NOT EXISTS revision_no INTEGER NOT NULL DEFAULT 0`);
}

function normalizeSowOperation(row, fallbackOrderNo) {
  const item = {};
  EDITABLE_SOW_COLUMNS.forEach((column) => {
    item[column] = row?.[column] ?? null;
  });
  item.order_no = item.order_no || fallbackOrderNo;
  item.operation_no = item.operation_no === "" || item.operation_no == null ? null : Number(item.operation_no);
  item.planhours = item.planhours === "" || item.planhours == null ? null : Number(item.planhours);
  item.weight = item.weight === "" || item.weight == null ? null : Number(item.weight);
  item.actual_progress = item.actual_progress === "" || item.actual_progress == null ? null : Number(item.actual_progress);
  item.actual_hours = item.actual_hours === "" || item.actual_hours == null ? null : Number(item.actual_hours);
  item.progress = item.progress === "" || item.progress == null ? null : Number(item.progress);
  item.revision_no = item.revision_no === "" || item.revision_no == null ? 0 : Number(item.revision_no);
  return item;
}

const normalizeOrderNo = (value) => {
  const text = String(value ?? '').trim();
  return text ? text.replace(/-/g, '000') : '';
};

const OPERATION_CARD_REVISION_ORIGINAL = "Original";

async function ensureSowDocumentNoTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.sow_documentno (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      documentno TEXT NOT NULL UNIQUE,
      "default" BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`ALTER TABLE public.sow_documentno ADD COLUMN IF NOT EXISTS documentno TEXT`);
  await db.query(`ALTER TABLE public.sow_documentno ADD COLUMN IF NOT EXISTS "default" BOOLEAN NOT NULL DEFAULT false`);
  await db.query(`ALTER TABLE public.sow_documentno ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await db.query(`ALTER TABLE public.sow_documentno ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sow_documentno_default
      ON public.sow_documentno ("default")
      WHERE "default" = true
  `);
}

exports.getSowDocumentNos = async (req, res) => {
  try {
    await ensureSowDocumentNoTable();
    const result = await db.query(
      `SELECT id, documentno, "default"
       FROM public.sow_documentno
       ORDER BY "default" DESC, documentno ASC`
    );
    res.json({ data: result.rows });
  } catch (err) {
    console.error("getSowDocumentNos error:", err);
    res.status(500).json({ error: err.message });
  }
};

function safePathSegment(value, fallback = "unknown") {
  const text = String(value ?? "").trim();
  return (text || fallback).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
}

async function ensureSowOperationCardTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.sow_operationcard (
      id BIGSERIAL PRIMARY KEY,
      sow_standard_id INTEGER,
      card_key TEXT,
      order_no TEXT,
      operation_no INTEGER,
      revision_no TEXT NOT NULL DEFAULT 'Original',
      image_path TEXT,
      images JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`ALTER TABLE public.sow_operationcard ADD COLUMN IF NOT EXISTS sow_standard_id INTEGER`);
  await db.query(`ALTER TABLE public.sow_operationcard ADD COLUMN IF NOT EXISTS card_key TEXT`);
  await db.query(`ALTER TABLE public.sow_operationcard ADD COLUMN IF NOT EXISTS order_no TEXT`);
  await db.query(`ALTER TABLE public.sow_operationcard ADD COLUMN IF NOT EXISTS operation_no INTEGER`);
  await db.query(`ALTER TABLE public.sow_operationcard ADD COLUMN IF NOT EXISTS revision_no TEXT NOT NULL DEFAULT 'Original'`);
  await db.query(`ALTER TABLE public.sow_operationcard ADD COLUMN IF NOT EXISTS image_path TEXT`);
  await db.query(`ALTER TABLE public.sow_operationcard ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await db.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sow_operationcard'
          AND column_name = 'images'
          AND data_type <> 'jsonb'
      ) THEN
        ALTER TABLE public.sow_operationcard
          ALTER COLUMN images TYPE JSONB
          USING CASE
            WHEN images IS NULL OR btrim(images::text) = '' THEN '[]'::jsonb
            WHEN left(btrim(images::text), 1) IN ('[', '{') THEN images::jsonb
            ELSE jsonb_build_array(jsonb_build_object('src', images::text))
          END;
      END IF;
    END $$;
  `);
  await db.query(`ALTER TABLE public.sow_operationcard ALTER COLUMN images SET DEFAULT '[]'::jsonb`);
  await db.query(`ALTER TABLE public.sow_operationcard ALTER COLUMN images SET NOT NULL`);
  await db.query(`ALTER TABLE public.sow_operationcard ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await db.query(`ALTER TABLE public.sow_operationcard ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await db.query(`
    DO $$
    DECLARE
      constraint_row RECORD;
    BEGIN
      FOR constraint_row IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'sow_operationcard'
          AND c.contype = 'u'
          AND (
            SELECT array_agg(a.attname::text ORDER BY u.ord)
            FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = u.attnum
          ) = ARRAY['sow_standard_id']
      LOOP
        EXECUTE format('ALTER TABLE public.sow_operationcard DROP CONSTRAINT %I', constraint_row.conname);
      END LOOP;
    END $$;
  `);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sow_operationcard_standard_revision
      ON public.sow_operationcard (sow_standard_id, revision_no)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_sow_operationcard_order_operation_revision
      ON public.sow_operationcard (order_no, operation_no, revision_no)
  `);
}

function saveOperationCardDataUrl(dataUrl, { orderNo, operationNo, revisionNo, prefix = "image" }) {
  if (!dataUrl) return null;
  const match = String(dataUrl).match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/i);
  if (!match) return null;

  const ext = match[1].toLowerCase().replace("jpeg", "jpg");
  const uploadsRoot = path.join(__dirname, "../uploads");
  const safeOrder = safePathSegment(orderNo, "no-order");
  const safeOp = safePathSegment(operationNo, "no-op");
  const safeRevision = safePathSegment(revisionNo || OPERATION_CARD_REVISION_ORIGINAL, "Original");
  const dir = path.join(uploadsRoot, "operation-card", safeOrder, safeOp, safeRevision);
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${safePathSegment(prefix, "image")}-${uuidv4()}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), Buffer.from(match[2], "base64"));
  return `/uploads/operation-card/${safeOrder}/${safeOp}/${safeRevision}/${filename}`;
}

function normalizeStoredImagePath(src) {
  if (!src) return src;
  const text = String(src);
  if (text.startsWith("/uploads/")) return text;
  try {
    const parsed = new URL(text);
    if (parsed.pathname.startsWith("/uploads/")) return parsed.pathname;
  } catch (_) {}
  return text;
}

function normalizeOperationNumber(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRevisionNo(value) {
  const text = String(value ?? "").trim();
  return text || OPERATION_CARD_REVISION_ORIGINAL;
}

async function persistOperationCardImages(images, context) {
  return Promise.all(images.map(async (img, index) => {
    const next = { ...img };
    if (typeof next.src === "string" && next.src.startsWith("data:image/")) {
      next.src = saveOperationCardDataUrl(next.src, {
        ...context,
        prefix: next.id || `placed-${index + 1}`,
      });
    } else {
      next.src = normalizeStoredImagePath(next.src);
    }
    next.image_path = next.src || null;
    return next;
  }));
}

// GET grouped orders from view — paginated (for OrderListPage)
exports.getGrouped = async (req, res) => {
  try {
    const { search } = req.query;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const params = [];
    let where = '';
    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      where = ` WHERE (order_no    ILIKE $1
                    OR ssbr_id     ILIKE $1
                    OR part_number ILIKE $1
                    OR part_name   ILIKE $1)`;
    }

    // Total count (cheap — view already grouped)
    const countResult = await db.query(
      `SELECT COUNT(*) FROM vw_sow_orders${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    // Paginated data
    params.push(limit, offset);
    const dataResult = await db.query(
      `SELECT * FROM vw_sow_orders${where} ORDER BY order_no ASC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      data:       dataResult.rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSowHistoryRows = async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    const params = [];
    let where = "";
    if (search) {
      params.push(`%${search}%`);
      where = `WHERE order_no ILIKE $1 OR ssbr_id ILIKE $1`;
    }

    const count = await db.query(`SELECT COUNT(*)::int AS total FROM sow ${where}`, params);
    params.push(limit, offset);
    const result = await db.query(
      `SELECT ${SOW_HISTORY_COLUMNS}
       FROM sow
       ${where}
       ORDER BY order_no ASC, operation_no ASC NULLS LAST
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    res.json({
      data: result.rows,
      pagination: {
        page,
        limit,
        total: count.rows[0]?.total || 0,
        totalPages: Math.max(1, Math.ceil((count.rows[0]?.total || 0) / limit)),
      },
    });
  } catch (err) {
    console.error("getSowHistoryRows error:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.getSowOrderOptions = async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const params = [];
    let where = "";
    if (search) {
      params.push(`%${search}%`);
      where = `WHERE order_no ILIKE $1 OR ssbr_id ILIKE $1`;
    }

    const result = await db.query(
      `SELECT order_no,
              MAX(ssbr_id) AS ssbr_id,
              MAX(customer) AS customer,
              MAX(part_name) AS part_name,
              COUNT(*)::int AS operation_count
       FROM sow
       ${where}
       GROUP BY order_no
       ORDER BY MAX(idsow) DESC
       LIMIT 100`,
      params,
    );
    res.json(result.rows);
  } catch (err) {
    console.error("getSowOrderOptions error:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.getSowOrderForRevision = async (req, res) => {
  try {
    await ensureSowRevisionHistoryTable();
    const { orderNo } = req.params;
    const rev = await db.query(
      `SELECT COALESCE(MAX(revision_no), 0)::int AS current_revision
       FROM sow_revision_history
       WHERE order_no = $1`,
      [orderNo],
    );
    const currentRevision = rev.rows[0]?.current_revision || 0;
    const requestedRevision = Number.parseInt(req.query.revision_no, 10);
    let rows = null;
    let selectedRevision = currentRevision;

    if (Number.isFinite(requestedRevision) && requestedRevision > 0) {
      const history = await db.query(
        `SELECT after_data
         FROM sow_revision_history
         WHERE order_no = $1 AND revision_no = $2
         LIMIT 1`,
        [orderNo, requestedRevision],
      );
      if (!history.rows.length) {
        return res.status(404).json({ error: "Revision tidak ditemukan" });
      }
      rows = Array.isArray(history.rows[0]?.after_data) ? history.rows[0].after_data : [];
      selectedRevision = requestedRevision;
    } else {
      const result = await db.query(
        `SELECT *
         FROM sow
         WHERE order_no = $1
         ORDER BY operation_no ASC NULLS LAST, idsow ASC`,
        [orderNo],
      );
      rows = result.rows;
    }

    const revisions = await db.query(
      `SELECT revision_no, changed_by, created_at
       FROM sow_revision_history
       WHERE order_no = $1
       ORDER BY revision_no DESC`,
      [orderNo],
    );

    res.json({
      order_no: orderNo,
      current_revision: currentRevision,
      selected_revision: selectedRevision,
      revisions: revisions.rows,
      rows,
    });
  } catch (err) {
    console.error("getSowOrderForRevision error:", err);
    res.status(500).json({ error: err.message });
  }
};

// GET /sow/customers — distinct customers for dropdown
exports.getCustomers = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT DISTINCT customer FROM sow WHERE customer IS NOT NULL AND customer != '' ORDER BY customer`
    );
    res.json({ data: result.rows.map(r => r.customer) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /sow/components — all components for model/part dropdowns
exports.getComponents = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT component_id, model, part_number, part_name FROM components ORDER BY model, part_number`
    );
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /sow/operationcard/:standardId — load saved operation card images
exports.getOperationCard = async (req, res) => {
  try {
    await ensureSowOperationCardTable();
    const { standardId } = req.params;
    const revisionNo = normalizeRevisionNo(req.query.revision_no);
    const result = await db.query(
      `SELECT *
       FROM sow_operationcard
       WHERE sow_standard_id = $1 AND revision_no = $2
       ORDER BY updated_at DESC
       LIMIT 1`,
      [standardId, revisionNo]
    );
    res.json({ data: result.rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /sow/operationcard/:standardId — save operation card images
exports.saveOperationCard = async (req, res) => {
  try {
    await ensureSowOperationCardTable();
    const { standardId } = req.params;
    const { images, card_key, order_no, operation_no, revision_no, box_image_data, image_path } = req.body || {};
    if (!Array.isArray(images)) return res.status(400).json({ error: "images array required" });

    const revisionNo = normalizeRevisionNo(revision_no);
    const operationNo = normalizeOperationNumber(operation_no);
    const normalizedImages = await persistOperationCardImages(images, {
      orderNo: order_no || standardId,
      operationNo,
      revisionNo,
    });
    const savedBoxPath = saveOperationCardDataUrl(box_image_data, {
      orderNo: order_no || standardId,
      operationNo,
      revisionNo,
      prefix: "main-box",
    }) || normalizeStoredImagePath(image_path);

    const existing = await db.query(
      `SELECT image_path
       FROM sow_operationcard
       WHERE sow_standard_id = $1 AND revision_no = $2
       LIMIT 1`,
      [standardId, revisionNo]
    );

    const result = existing.rows.length
      ? await db.query(
        `UPDATE sow_operationcard
         SET card_key = $3,
             order_no = $4,
             operation_no = $5,
             revision_no = $6,
             image_path = COALESCE($7, image_path),
             images = $8::jsonb,
             updated_at = CURRENT_TIMESTAMP
         WHERE sow_standard_id = $1 AND revision_no = $2
         RETURNING *`,
        [
          standardId,
          revisionNo,
          card_key || null,
          order_no || null,
          operationNo,
          revisionNo,
          savedBoxPath || null,
          JSON.stringify(normalizedImages),
        ]
      )
      : await db.query(
        `INSERT INTO sow_operationcard (
           sow_standard_id,
           card_key,
           order_no,
           operation_no,
           revision_no,
           image_path,
           images
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         RETURNING *`,
        [
          standardId,
          card_key || null,
          order_no || null,
          operationNo,
          revisionNo,
          savedBoxPath || null,
          JSON.stringify(normalizedImages),
        ]
      );
    res.json({ data: result.rows[0] });
  } catch (err) {
    console.error("saveOperationCard error:", err);
    res.status(500).json({ error: err.message });
  }
};

// PUT /sow/history-order/:orderNo/info — update shared detail info across all rows
exports.saveSowOrderInfo = async (req, res) => {
  const { orderNo } = req.params;
  const { customer, ssbr_id, part_number, part_name, model } = req.body || {};

  if (!orderNo) return res.status(400).json({ error: "orderNo wajib diisi" });

  try {
    const result = await db.query(
      `UPDATE sow
       SET customer    = COALESCE($2, customer),
           ssbr_id     = COALESCE($3, ssbr_id),
           part_number = COALESCE($4, part_number),
           part_name   = COALESCE($5, part_name),
           model       = COALESCE($6, model)
       WHERE order_no = $1
       RETURNING *`,
      [orderNo, customer, ssbr_id, part_number, part_name, model]
    );
    res.json({ updated: result.rowCount, rows: result.rows });
  } catch (err) {
    console.error("saveSowOrderInfo error:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.saveSowOrderRevision = async (req, res) => {
  const { orderNo } = req.params;
  const operations = Array.isArray(req.body?.operations) ? req.body.operations : [];
  const changedBy = req.body?.changed_by || req.user?.username || "web";

  if (!orderNo) return res.status(400).json({ error: "orderNo wajib diisi" });
  if (operations.length === 0) return res.status(400).json({ error: "operations tidak boleh kosong" });

  try {
    await ensureSowRevisionHistoryTable();
    await db.query("BEGIN");

    const before = await db.query(
      `SELECT *
       FROM sow
       WHERE order_no = $1
       ORDER BY operation_no ASC NULLS LAST, idsow ASC`,
      [orderNo],
    );
    const revision = await db.query(
      `SELECT COALESCE(MAX(revision_no), 0)::int + 1 AS next_revision
       FROM sow_revision_history
       WHERE order_no = $1`,
      [orderNo],
    );
    const revisionNo = revision.rows[0]?.next_revision || 1;

    await db.query(`DELETE FROM sow WHERE order_no = $1`, [orderNo]);

    const inserted = [];
    for (const operation of operations) {
      const row = normalizeSowOperation(operation, orderNo);
      row.revision_no = revisionNo;
      const values = EDITABLE_SOW_COLUMNS.map((column) => row[column]);
      const placeholders = EDITABLE_SOW_COLUMNS.map((_, index) => `$${index + 1}`).join(", ");
      const result = await db.query(
        `INSERT INTO sow (${EDITABLE_SOW_COLUMNS.map((column) => `"${column}"`).join(", ")})
         VALUES (${placeholders})
         RETURNING *`,
        values,
      );
      inserted.push(result.rows[0]);
    }

    const history = await db.query(
      `INSERT INTO sow_revision_history
       (order_no, revision_no, action, before_data, after_data, changed_by)
       VALUES ($1, $2, 'edit', $3::jsonb, $4::jsonb, $5)
       RETURNING *`,
      [orderNo, revisionNo, JSON.stringify(before.rows), JSON.stringify(inserted), changedBy],
    );

    await db.query("COMMIT");
    res.json({ revision: history.rows[0], rows: inserted });
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    console.error("saveSowOrderRevision error:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.getSowRevisionHistory = async (req, res) => {
  try {
    await ensureSowRevisionHistoryTable();
    const { orderNo } = req.params;
    const result = await db.query(
      `SELECT id, order_no, revision_no, action, changed_by, created_at,
              jsonb_array_length(COALESCE(before_data, '[]'::jsonb)) AS before_count,
              jsonb_array_length(COALESCE(after_data, '[]'::jsonb)) AS after_count
       FROM sow_revision_history
       WHERE order_no = $1
       ORDER BY revision_no DESC`,
      [orderNo],
    );
    res.json(result.rows);
  } catch (err) {
    console.error("getSowRevisionHistory error:", err);
    res.status(500).json({ error: err.message });
  }
};

// GET single sow row by idsow
exports.getRowById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query('SELECT * FROM sow WHERE idsow = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET progress update history for one operation
exports.getProgressHistory = async (req, res) => {
  try {
    const { idsow } = req.params;
    const result = await db.query(
      `SELECT id, operation_id, order_no, progress, issue_description,
              image_path, created_at, created_by
         FROM progress_update_history
        WHERE operation_id = $1
        ORDER BY created_at DESC`,
      [idsow]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST new progress update
// Client sends image as base64 in image_data field.
// Server decodes → writes JPEG file → stores relative path in image_path column.
// After insert: updates sow.progress for the operation row.
exports.addProgressUpdate = async (req, res) => {

  try {
    const { operation_id, order_no, progress, issue_description, image_data, created_by } = req.body;

    const prog = parseInt(progress, 10);
    if (isNaN(prog) || prog < 1 || prog > 100) {
      return res.status(400).json({ error: 'Progress harus antara 1–100' });
    }

    // Prevent regression
    const lastResult = await db.query(
      `SELECT progress FROM progress_update_history
        WHERE operation_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [operation_id]
    );
    if (lastResult.rows.length > 0 && prog < lastResult.rows[0].progress) {
      return res.status(400).json({
        error: `Progress tidak boleh kurang dari progress terakhir (${lastResult.rows[0].progress}%)`,
      });
    }

    // ── Save image to filesystem ────────────────────────────────────────────
    let image_path = null;
    if (image_data) {
      // Get operation_no for folder structure
      const opRow = await db.query(
        'SELECT operation_no FROM sow WHERE idsow = $1', [operation_id]
      );
      const opNo    = opRow.rows[0]?.operation_no || '00';
      const safeOrd = (order_no || 'unknown').replace(/[^\w\-]/g, '_');
      const safeOp  = String(opNo).replace(/[^\w\-]/g, '_');

      const uploadsRoot = path.join(__dirname, '../uploads');
      const dir         = path.join(uploadsRoot, 'progress', safeOrd, safeOp);
      fs.mkdirSync(dir, { recursive: true });

      const filename = `${Date.now()}.jpg`;
      const base64   = image_data.replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(path.join(dir, filename), Buffer.from(base64, 'base64'));

      image_path = `/uploads/progress/${safeOrd}/${safeOp}/${filename}`;
    }

    // ── Insert history record ───────────────────────────────────────────────
    const result = await db.query(
      `INSERT INTO progress_update_history
         (operation_id, order_no, progress, issue_description, image_path, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [operation_id, order_no || null, prog, issue_description || null, image_path, created_by || null]
    );

    // ── Update sow.progress for this operation ──────────────────────────────
    await db.query(
      'UPDATE sow SET progress = $1 WHERE idsow = $2',
      [prog, operation_id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET all
exports.getAll = async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM sow");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET by ID
exports.getById = async (req, res) => {
  try {
    const { order } = req.params;
    const result = await db.query('SELECT * FROM sow WHERE "order_no" = $1 ORDER BY operation_no ASC', [order]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
exports.getByIdent = async (req, res) => {
  try {
    const { ssbr_id, group } = req.params;

    // Validasi input
    if (!ssbr_id || !group) {
      return res.status(400).json({
        error: "ssbr_id dan group wajib diisi"
      });
    }

    const query = `
      SELECT * 
      FROM sow 
      WHERE "ssbr_id" = $1 
        AND "group" = $2 
      ORDER BY operation_no ASC
    `;

    const result = await db.query(query, [ssbr_id, group]);

    return res.json(result.rows);

  } catch (err) {
    console.error('getByIdent error:', err);

    return res.status(500).json({
      error: 'Internal server error'
    });
  }
};


exports.get2data = async (req, res) => {
  try {
    const { search } = req.query;

    let query = `
      SELECT
        s.*,
        latest.remaining_seconds_before
      FROM sow s
      LEFT JOIN LATERAL (
        SELECT v.remaining_seconds_before
        FROM public.vw_timesheet_std_performance v
        WHERE v.order_no = s.order_no
          AND v.operation_no = s.operation_no
        ORDER BY v.longdate_checkin DESC NULLS LAST, v.tsnumber DESC
        LIMIT 1
      ) latest ON TRUE
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      query += ` AND (s.order_no ILIKE $1 OR s.ssbr_id ILIKE $1)`;
      params.push(`%${search}%`);
    }

    query += ' ORDER BY s.operation_no ASC';

    const result = await db.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Data not found' });
    }

    const columns = Object.keys(result.rows[0]);

    // HEADER pakai titik koma
    const csvHeader = columns.join(";") + "\n";

    // DATA pakai titik koma
    const csvData = result.rows
      .map(row =>
        columns
          .map(col => {
            let value = row[col];
            if (value === null || value === undefined) value = "";
            value = String(value).replace(/"/g, '""');
            return `"${value}"`;
          })
          .join(";")
      )
      .join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="sow_${search || "all"}.csv"`
    );

    res.send(csvHeader + csvData);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// Endpoint baru khusus untuk JSON
exports.getDataJSON = async (req, res) => {
  try {
    const { search } = req.query;
    
    let query = `
      SELECT
        s.*,
        latest.remaining_seconds_before
      FROM sow s
      LEFT JOIN LATERAL (
        SELECT v.remaining_seconds_before
        FROM public.vw_timesheet_std_performance v
        WHERE v.order_no = s.order_no
          AND v.operation_no = s.operation_no
        ORDER BY v.longdate_checkin DESC NULLS LAST, v.tsnumber DESC
        LIMIT 1
      ) latest ON TRUE
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      query += ` AND (s.order_no ILIKE $1 OR s.ssbr_id ILIKE $1)`;
      params.push(`%${search}%`);
    }

    query += ' ORDER BY s.operation_no ASC';

    const result = await db.query(query, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Data not found' });
    }

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getbymesinid = async (req, res) => {
  try {
    const { order } = req.params;
    const { workcenter } = req.query; // ambil dari body

    const result = await db.query(
      'SELECT * FROM sow WHERE "order_no" = $1 AND workcenter = $2 ORDER BY operation_no ASC',
      [order, workcenter]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// CREATE
exports.create = async (req, res) => {
  try {
    // Log request masuk
    console.log("=".repeat(50));
    console.log("[SOW CREATE] Request received:", new Date().toISOString());
    console.log("[SOW CREATE] Body:", JSON.stringify(req.body, null, 2));

    const {
      order_no,
      operation_no,
      ssbr_id,
      part_number,
      part_name,
      model,
      customer,
      location,
      wct_group,
      workcenter,
      operation_text,
      workcenterdescription,
      planhours,
      confirmation,
      status,
      finish_date,
      type,
      group_name,  // atau "group" kalau di DB namanya group
      category,
      remark
    } = req.body;

    // Log sebelum insert
    console.log("[SOW CREATE] Inserting to database...");

    const result = await db.query(
      `INSERT INTO sow (
        order_no,
        operation_no,
        ssbr_id,
        part_number,
        part_name,
        model,
        customer,
        location,
        wct_group,
        workcenter,
        operation_text,
        workcenterdescription,
        planhours,
        confirmation,
        status,
        finish_date,
        type,
        "group",
        category,
        remark
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      RETURNING *`,
      [
        order_no,
        operation_no,
        ssbr_id,
        part_number,
        part_name,
        model,
        customer,
        location,
        wct_group,
        workcenter,
        operation_text,
        workcenterdescription,
        planhours,
        confirmation,
        status,
        finish_date,
        type,
        group_name,  // nilai dari group_name masuk ke kolom "group"
        category,
        remark
      ]
    );

    // Log sukses
    console.log("[SOW CREATE] Success! ID:", result.rows[0].idsow);
    console.log("=".repeat(50));

    res.json(result.rows[0]);

  } catch (err) {
    // Log error
    console.error("[SOW CREATE] ERROR:", err.message);
    console.error("[SOW CREATE] Stack:", err.stack);
    console.error("=".repeat(50));
    
    res.status(500).json({ error: err.message });
  }
};

// UPDATE
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const result = await db.query(
      "UPDATE sow SET name = $1 WHERE id = $2 RETURNING *",
      [name, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
//========================//
exports.finish = async (req, res) => {
  let client = null;
  try {
    const { selectedactivity } = req.body;
    const {
      order_no,
      ssbr_id,
      operation_no,
      operation_text,
      machine_id,
    } = selectedactivity || {};
    const status = "FINISH";
    const longdate_checkout = new Date();
    const operationNo = Number.parseInt(operation_no, 10);

    if (!order_no || !Number.isFinite(operationNo)) {
      return res.status(400).json({ error: "order_no and operation_no are required" });
    }

    if (!machine_id) {
      return res.status(400).json({ error: "machine_id is required for buffer transaction" });
    }

    client = typeof db.connect === "function" ? await db.connect() : null;
    const query = client ? client.query.bind(client) : db.query.bind(db);
    if (client) await query("BEGIN");

    const result = await query(
      `UPDATE sow
         SET status = $1,
             finish_date = $2
       WHERE order_no = $3 AND operation_no = $4
       RETURNING *`,
      [status, longdate_checkout, order_no, operationNo]
    );

    if (result.rowCount === 0) {
      const error = new Error("SOW activity not found");
      error.status = 404;
      throw error;
    }

    const bufferResult = await query(
      `INSERT INTO public.buffer_transaction (
         type,
         machine_id,
         order_no,
         ssbr_id,
         operation_no,
         operation_text
       )
       VALUES ('out', $1, $2, NULLIF($3, ''), $4, NULLIF($5, ''))
       RETURNING *`,
      [
        machine_id,
        order_no,
        ssbr_id || "",
        operationNo,
        operation_text || "",
      ]
    );

    if (client) await query("COMMIT");
    res.json({ ...result.rows[0], buffer_transaction: bufferResult.rows[0] });
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error(err);
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    if (client) client.release();
  }
};

// DELETE
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      "DELETE FROM sow WHERE idsow = $1",
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        message: "ID not found"
      });
    }

    res.status(200).json({
      message: "Deleted successfully",
      id: id
    });
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
};

//=API EXCEL=========

// CREATE
exports.createexcel = async (req, res) => {
  try {
    const {
      order_no,
      operation_no,
      ssbr_id,
      part_number,
      part_name,
      model,
      customer,
      location,
      wct_group,
      workcenter,
      operation_text,
      workcenterdescription,
      planhours,
      confirmation
    } = req.body;

    const result = await db.query(
      `INSERT INTO sow (
        order_no,
        operation_no,
        ssbr_id,
        part_number,
        part_name,
        model,
        customer,
        location,
        wct_group,
        workcenter,
        operation_text,
        workcenterdescription,
        planhours,
        confirmation
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14
      )
      RETURNING *`,
      [
        order_no,
        operation_no,
        ssbr_id,
        part_number,
        part_name,
        model,
        customer,
        location,
        wct_group,
        workcenter,
        operation_text,
        workcenterdescription,
        planhours,
        confirmation
      ]
    );

    // idsow & codenumber otomatis di-generate oleh PostgreSQL
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// UPDATE
exports.updateexcel = async (req, res) => {
  try {
    const { id } = req.params;

    // TAMBAHKAN LOGGING INI
    console.log('========== updateexcel CALLED ==========');
    console.log('ID:', id);
    console.log('FULL BODY:', JSON.stringify(req.body, null, 2));

    const {
      order_no,
      operation_no,
      ssbr_id,
      part_number,
      part_name,
      model,
      customer,
      location,
      wct_group,
      workcenter,
      operation_text,
      workcenterdescription,
      planhours,
      confirmation,
      status,
      finish_date,
      type,
      group_name,
      category,
      remark
    } = req.body;

    // LOG SETIAP VARIABEL
    console.log('type:', type);
    console.log('group_name:', group_name);
    console.log('category:', category);
    console.log('remark:', remark);

    const result = await db.query(
      `UPDATE sow SET
        order_no = $1,
        operation_no = $2,
        ssbr_id = $3,
        part_number = $4,
        part_name = $5,
        model = $6,
        customer = $7,
        location = $8,
        wct_group = $9,
        workcenter = $10,
        operation_text = $11,
        workcenterdescription = $12,
        planhours = $13,
        confirmation = $14,
        status = $15,
        finish_date = $16,
        type = $17,
        "group" = $18,
        category = $19,
        remark = $20
      WHERE idsow = $21
      RETURNING *`,
      [
        order_no,
        operation_no,
        ssbr_id,
        part_number,
        part_name,
        model,
        customer,
        location,
        wct_group,
        workcenter,
        operation_text,
        workcenterdescription,
        planhours,
        confirmation,
        status,
        finish_date,
        type,
        group_name,
        category,
        remark,
        id
      ]
    );

    // LOG HASIL QUERY
    console.log('QUERY RESULT:', JSON.stringify(result.rows[0], null, 2));
    console.log('========== updateexcel END ==========');

    res.json(result.rows[0]);
  } catch (err) {
    console.error('ERROR in updateexcel:', err);
    res.status(500).json({ error: err.message });
  }
};

//============UPSERT EXCEL=============
// UPSERT berdasarkan order_no dan operation_no
exports.upsert = async (req, res) => {
  try {
    console.log("=== UPSERT START ===");
    console.log("Body received:", JSON.stringify(req.body, null, 2));
    
    const { 
      ssbr_id,
      order_no,
      customer,
      location,
      part_name,
      model,
      part_number,
      created_by,
      type,
      group,
      category,
      operations
    } = req.body;

    // Validasi input
    if (!order_no || !operations || operations.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: "Missing required fields: ssbr_id, group, atau operations" 
      });
    }

    console.log("Validation passed");

    const results = [];

    // Loop setiap operation dan upsert
    for (let idx = 0; idx < operations.length; idx++) {
      const op = operations[idx];
      console.log(`Processing operation ${idx + 1}/${operations.length}:`, op.operation_no);
      
      const checkQuery = `
        SELECT idsow FROM sow 
        WHERE order_no = $1  AND operation_no = $2
      `;
      
      console.log("Check query params:", [order_no, op.operation_no]);
      const existing = await db.query(checkQuery, [order_no, op.operation_no]);
      console.log("Existing rows found:", existing.rows.length);

      let result;
      
      if (existing.rows.length > 0) {
        console.log("UPDATE mode for operation:", op.operation_no);
        // UPDATE jika sudah ada
        const updateQuery = `
  UPDATE sow SET 
    order_no = $1,
    part_number = $2,
    part_name = $3,
    model = $4,
    customer = $5,
    location = $6,
    wct_group = $7,
    workcenter = $8,
    operation_text = $9,
    planhours = $10,
    remark = $11,
    weight = $12,
    created_by = $13,
    "type" = $14,
    category = $15,
    ssbr_id = $16,
    "group" = $17
  WHERE order_no = $1 AND operation_no = $18
  RETURNING *, 'updated' as action
`;

        
        result = await db.query(updateQuery, [
          order_no,
          part_number,
          part_name,
          model,
          customer,
          location,
          op.wct_group,
          op.workcenter,
          op.operation_text,
          op.planhours,
          op.remark,
          op.weight,
          created_by,
          type,
          category,
          ssbr_id,
          group,
          op.operation_no
        ]);
        console.log("UPDATE success for:", op.operation_no);
      } else {
        console.log("INSERT mode for operation:", op.operation_no);
        // CREATE jika belum ada
        const insertQuery = `
          INSERT INTO sow (
            ssbr_id, "group", operation_no, order_no, part_number,
            part_name, model, customer, location, wct_group,
            workcenter, operation_text, planhours, remark, weight,
            created_by, "type", category
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
          RETURNING *, 'created' as action
        `;
        
        result = await db.query(insertQuery, [
          ssbr_id,
          group,
          op.operation_no,
          order_no,
          part_number,
          part_name,
          model,
          customer,
          location,
          op.wct_group,
          op.workcenter,
          op.operation_text,
          op.planhours,
          op.remark,
          op.weight,
          created_by,
          type,
          category
        ]);
        console.log("INSERT success for:", op.operation_no);
      }

      results.push(result.rows[0]);
    }

    console.log("=== UPSERT SUCCESS ===");

    res.json({
      success: true,
      count: results.length,
      data: results
    });

  } catch (err) {
    console.error('❌ UPSERT ERROR:', err);
    console.error('Error message:', err.message);
    console.error('Error detail:', err.detail);
    
    res.status(500).json({ 
      success: false,
      error: err.message,
      detail: err.detail || null
    });
  }
};

exports.createFromBuilder = async (req, res) => {
  const {
    order_no,
    production_order,
    ssbr_id,
    part_number,
    part_name,
    model,
    customer,
    location,
    created_by,
    type,
    group,
    category,
    remark,
    operations,
  } = req.body;

  const normalizedOrderNo = normalizeOrderNo(order_no || production_order);

  if (!normalizedOrderNo) {
    return res.status(400).json({
      success: false,
      error: 'Production order wajib diisi untuk membuat SOW',
    });
  }

  if (!Array.isArray(operations) || operations.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Minimal 1 operasi wajib dipilih atau ditambahkan',
    });
  }

  let client = null;

  try {
    client = typeof db.connect === 'function' ? await db.connect() : null;
    const query = client ? client.query.bind(client) : db.query.bind(db);

    if (client) await query('BEGIN');

    const results = [];

    for (const op of operations) {
      const operationNo = Number.parseInt(op.operation_no, 10);
      if (!Number.isFinite(operationNo)) {
        throw new Error('Operation number tidak valid');
      }

      const planhours =
        op.planhours !== undefined && op.planhours !== ''
          ? Number.parseFloat(op.planhours)
          : op.std_hours !== undefined && op.std_hours !== ''
            ? Number.parseFloat(op.std_hours)
            : null;

      const result = await query(
        `
          INSERT INTO sow (
            order_no,
            operation_no,
            ssbr_id,
            part_number,
            part_name,
            model,
            customer,
            location,
            wct_group,
            workcenter,
            operation_text,
            workcenterdescription,
            planhours,
            status,
            created_by,
            "type",
            "group",
            category,
            remark
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18, $19
          )
          ON CONFLICT (order_no, operation_no)
          DO UPDATE SET
            ssbr_id = EXCLUDED.ssbr_id,
            part_number = EXCLUDED.part_number,
            part_name = EXCLUDED.part_name,
            model = EXCLUDED.model,
            customer = EXCLUDED.customer,
            location = EXCLUDED.location,
            wct_group = EXCLUDED.wct_group,
            workcenter = EXCLUDED.workcenter,
            operation_text = EXCLUDED.operation_text,
            workcenterdescription = EXCLUDED.workcenterdescription,
            planhours = EXCLUDED.planhours,
            status = COALESCE(sow.status, EXCLUDED.status),
            created_by = COALESCE(EXCLUDED.created_by, sow.created_by),
            "type" = EXCLUDED."type",
            "group" = EXCLUDED."group",
            category = EXCLUDED.category,
            remark = EXCLUDED.remark,
            sync = 'new'
          RETURNING *
        `,
        [
          normalizedOrderNo,
          operationNo,
          ssbr_id || null,
          part_number || null,
          part_name || null,
          model || null,
          customer || null,
          location || null,
          op.wct_group || null,
          op.workcenter || op.machineid || null,
          op.operation_text || null,
          op.workcenterdescription || null,
          Number.isFinite(planhours) ? planhours : null,
          'OPEN',
          created_by || null,
          type || null,
          group || null,
          category || null,
          op.remark || remark || null,
        ]
      );

      results.push(result.rows[0]);
    }

    if (client) await query('COMMIT');

    res.json({
      success: true,
      order_no: normalizedOrderNo,
      count: results.length,
      data: results,
    });
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    res.status(500).json({
      success: false,
      error: err.message,
      detail: err.detail || null,
    });
  } finally {
    if (client) client.release();
  }
};



// GET BY GROUP & SSBR ID
exports.getBySSBRAndGroup = async (req, res) => {
  try {
    const { ssbr_id, group } = req.params;
    
    console.log("=== GET DATA START ===");
    console.log("Search params:", { order_no, operation_no });

    // Query untuk ambil semua operations berdasarkan order dan operation_no
    const query = `
      SELECT 
        ssbr_id,
        order_no,
        customer,
        location,
        part_name,
        model,
        part_number,
        created_by,
        "type",
        "group",
        category,
        operation_no,
        operation_text,
        wct_group,
        workcenter,
        planhours,
        remark,
        weight
      FROM sow
      WHERE order_no = $1 AND operation_no = $2
      ORDER BY operation_no ASC
    `;
    
    const result = await db.query(query, [ssbr_id, group]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Data tidak ditemukan"
      });
    }

    // Ambil data header dari row pertama (semua row punya header yang sama)
    const firstRow = result.rows[0];
    const header = {
      ssbr_id: firstRow.ssbr_id,
      order_no: firstRow.order_no,
      customer: firstRow.customer,
      location: firstRow.location,
      part_name: firstRow.part_name,
      model: firstRow.model,
      part_number: firstRow.part_number,
      created_by: firstRow.created_by,
      type: firstRow.type,
      group: firstRow.group,
      category: firstRow.category
    };

    // Ambil semua operations
    const operations = result.rows.map(row => ({
      operation_no: row.operation_no,
      operation_text: row.operation_text,
      wct_group: row.wct_group,
      workcenter: row.workcenter,
      planhours: row.planhours,
      remark: row.remark,
      weight: row.weight
    }));

    console.log("Data found:", result.rows.length, "operations");
    console.log("=== GET DATA SUCCESS ===");

    res.json({
      success: true,
      count: operations.length,
      header: header,
      operations: operations
    });

  } catch (err) {
    console.error('❌ GET DATA ERROR:', err);
    console.error('Error message:', err.message);
    
    res.status(500).json({ 
      success: false,
      error: err.message
    });
  }
};

exports.getcsv = async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM sow");
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "No data found" });
    }
    
    // Ambil nama kolom dari hasil query
    const columns = Object.keys(result.rows[0]);
    
    // Buat header CSV
    const csvHeader = columns.join(',') + '\n';
    
    // Convert data ke format CSV
    const csvData = result.rows.map(row => {
      return columns.map(col => {
        let value = row[col];
        // Handle null/undefined values
        if (value === null || value === undefined) {
          value = '';
        }
        // Escape double quotes dan wrap dengan quotes jika perlu
        if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
          value = '"' + value.replace(/"/g, '""') + '"';
        }
        return value;
      }).join(',');
    }).join('\n');
    
    // Set header response sebagai CSV
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="sow_data.csv"');
    
    // Kirim CSV data
    res.send(csvHeader + csvData);
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getcsvbyid = async (req, res) => {
  try {
    const { order_no } = req.params; // ambil dari URL

    const result = await db.query(
      "SELECT * FROM sow WHERE order_no = $1",
      [order_no]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "No data found" });
    }

    // Ambil nama kolom dari hasil query
    const columns = Object.keys(result.rows[0]);

    // Buat header CSV
    const csvHeader = columns.join(",") + "\n";

    // Convert data ke format CSV
    const csvData = result.rows
      .map((row) => {
        return columns
          .map((col) => {
            let value = row[col];
            if (value === null || value === undefined) {
              value = "";
            }
            if (
              typeof value === "string" &&
              (value.includes(",") || value.includes('"') || value.includes("\n"))
            ) {
              value = '"' + value.replace(/"/g, '""') + '"';
            }
            return value;
          })
          .join(",");
      })
      .join("\n");

    // Set header response sebagai CSV
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="sow_${order_no}.csv"`);

    // Kirim CSV data
    res.send(csvHeader + csvData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ============================================
// PARTS ENDPOINTS
// ============================================

// GET all parts
exports.getAllParts = async (req, res) => {
  try {
    console.log('📋 getAllParts called');
    
    const result = await db.query(`
      SELECT 
        p.*,
        COUNT(o.operation_id) as total_operations,
        COALESCE(SUM(o.planhours), 0) as total_hours
      FROM parts p
      LEFT JOIN operations o ON p.part_id = o.part_id
      GROUP BY p.part_id
      ORDER BY p.partnumber
    `);
    
    console.log(`✅ Found ${result.rows.length} parts`);
    
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (err) {
    console.error('❌ Error in getAllParts:', err);
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  }
};

// GET parts with search/filter
exports.searchParts = async (req, res) => {
  try {
    const { query } = req.query; // ?query=xxx
    
    if (!query) {
      return exports.getAllParts(req, res);
    }

    const result = await db.query(`
      SELECT 
        p.*,
        COUNT(o.operation_id) as total_operations,
        SUM(o.planhours) as total_hours
      FROM parts p
      LEFT JOIN operations o ON p.part_id = o.part_id
      WHERE 
        p.partnumber ILIKE $1 OR
        p.partname ILIKE $1 OR
        p.model ILIKE $1
      GROUP BY p.part_id
      ORDER BY p.partnumber
    `, [`%${query}%`]);
    
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET single part by ID
exports.getPartById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await db.query(`
      SELECT 
        p.*,
        COUNT(o.operation_id) as total_operations,
        SUM(o.planhours) as total_hours
      FROM parts p
      LEFT JOIN operations o ON p.part_id = o.part_id
      WHERE p.part_id = $1
      GROUP BY p.part_id
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Part not found" });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// CREATE new part
exports.createPart = async (req, res) => {
  try {
    const { partnumber, partname, model, drawing_path } = req.body;
    
    // Validation
    if (!partnumber || !partname || !model) {
      return res.status(400).json({ 
        error: "partnumber, partname, and model are required" 
      });
    }

    const result = await db.query(`
      INSERT INTO parts (partnumber, partname, model, drawing_path)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [partnumber, partname, model, drawing_path || null]);
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    // Handle duplicate partnumber
    if (err.code === '23505') {
      return res.status(409).json({ 
        error: "Part number already exists" 
      });
    }
    res.status(500).json({ error: err.message });
  }
};

// UPDATE part
exports.updatePart = async (req, res) => {
  try {
    const { id } = req.params;
    const { partnumber, partname, model, drawing_path } = req.body;
    
    // Validation
    if (!partnumber || !partname || !model) {
      return res.status(400).json({ 
        error: "partnumber, partname, and model are required" 
      });
    }

    const result = await db.query(`
      UPDATE parts
      SET partnumber = $1,
          partname = $2,
          model = $3,
          drawing_path = $4,
          updated_at = CURRENT_TIMESTAMP
      WHERE part_id = $5
      RETURNING *
    `, [partnumber, partname, model, drawing_path || null, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Part not found" });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    // Handle duplicate partnumber
    if (err.code === '23505') {
      return res.status(409).json({ 
        error: "Part number already exists" 
      });
    }
    res.status(500).json({ error: err.message });
  }
};

// DELETE part
exports.deletePart = async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await db.query(`
      DELETE FROM parts
      WHERE part_id = $1
      RETURNING *
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Part not found" });
    }
    
    res.json({ 
      message: "Part deleted successfully",
      deleted: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// OPERATIONS ENDPOINTS
// ============================================

// GET all operations by part_id
exports.getOperationsByPartId = async (req, res) => {
  try {
    const { part_id } = req.params;
    
    const result = await db.query(`
      SELECT *
      FROM operations
      WHERE part_id = $1
      ORDER BY operation_no
    `, [part_id]);
    
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET single operation by ID
exports.getOperationById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await db.query(`
      SELECT *
      FROM operations
      WHERE operation_id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Operation not found" });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// CREATE new operation
exports.createOperation = async (req, res) => {
  try {
    const {
      part_id,
      operation_no,
      operation_text,
      wct_group,
      workcenter,
      planhours,
      drawing_path,
      remark
    } = req.body;

    // Validation
    if (!part_id || !operation_no || !operation_text) {
      return res.status(400).json({
        error: "part_id, operation_no, and operation_text are required"
      });
    }

    const result = await db.query(`
      INSERT INTO operations
      (part_id, operation_no, operation_text, wct_group, workcenter, planhours, drawing_path, remark)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      part_id,
      operation_no,
      operation_text,
      wct_group || null, 
      workcenter || null, 
      planhours || null, 
      drawing_path || null, 
      remark || null
    ]);
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    // Handle duplicate operation_no for same part
    if (err.code === '23505') {
      return res.status(409).json({
        error: "Operation number already exists for this part"
      });
    }
    // Handle foreign key violation
    if (err.code === '23503') {
      return res.status(404).json({ 
        error: "Part not found" 
      });
    }
    res.status(500).json({ error: err.message });
  }
};

// UPDATE operation
exports.updateOperation = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      operation_no,
      operation_text,
      wct_group,
      workcenter,
      planhours,
      drawing_path,
      remark
    } = req.body;

    // Validation
    if (!operation_no || !operation_text) {
      return res.status(400).json({
        error: "operation_no and operation_text are required"
      });
    }

    const result = await db.query(`
      UPDATE operations
      SET operation_no = $1,
          operation_text = $2,
          wct_group = $3,
          workcenter = $4,
          planhours = $5,
          drawing_path = $6,
          remark = $7,
          updated_at = CURRENT_TIMESTAMP
      WHERE operation_id = $8
      RETURNING *
    `, [
      operation_no,
      operation_text,
      wct_group || null,
      workcenter || null,
      planhours || null,
      drawing_path || null,
      remark || null,
      id
    ]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Operation not found" });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    // Handle duplicate operation_no for same part
    if (err.code === '23505') {
      return res.status(409).json({
        error: "Operation number already exists for this part"
      });
    }
    res.status(500).json({ error: err.message });
  }
};

// DELETE operation
exports.deleteOperation = async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await db.query(`
      DELETE FROM operations
      WHERE operation_id = $1
      RETURNING *
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Operation not found" });
    }
    
    res.json({ 
      message: "Operation deleted successfully",
      deleted: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// BULK OPERATIONS
// ============================================

// CREATE part with operations (bulk insert)
exports.createPartWithOperations = async (req, res) => {
  const client = await db.query('SELECT 1'); // Get client from pool
  
  try {
    const { part, operations } = req.body;
    
    // Validation
    if (!part || !part.partnumber || !part.partname || !part.model) {
      return res.status(400).json({ 
        error: "Part information is required (partnumber, partname, model)" 
      });
    }

    // Begin transaction
    await db.query('BEGIN');

    // Insert part
    const partResult = await db.query(`
      INSERT INTO parts (partnumber, partname, model, drawing_path)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [part.partnumber, part.partname, part.model, part.drawing_path || null]);
    
    const newPart = partResult.rows[0];

    // Insert operations if provided
    let newOperations = [];
    if (operations && operations.length > 0) {
      for (const op of operations) {
        const opResult = await db.query(`
          INSERT INTO operations
          (part_id, operation_no, operation_text, wct_group, workcenter, planhours, drawing_path, remark)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `, [
          newPart.part_id,
          op.operation_no,
          op.operation_text,
          op.wct_group || null,
          op.workcenter || null,
          op.planhours || null,
          op.drawing_path || null,
          op.remark || null
        ]);
        newOperations.push(opResult.rows[0]);
      }
    }

    // Commit transaction
    await db.query('COMMIT');

    res.status(201).json({
      part: newPart,
      operations: newOperations
    });
  } catch (err) {
    // Rollback on error
    await db.query('ROLLBACK');
    
    if (err.code === '23505') {
      return res.status(409).json({ 
        error: "Part number or operation number already exists" 
      });
    }
    res.status(500).json({ error: err.message });
  }
};

// UPDATE part with operations (bulk update)
exports.updatePartWithOperations = async (req, res) => {
  try {
    const { id } = req.params;
    const { part, operations } = req.body;
    
    // Validation
    if (!part || !part.partnumber || !part.partname || !part.model) {
      return res.status(400).json({ 
        error: "Part information is required (partnumber, partname, model)" 
      });
    }

    // Begin transaction
    await db.query('BEGIN');

    // Update part
    const partResult = await db.query(`
      UPDATE parts
      SET partnumber = $1,
          partname = $2,
          model = $3,
          drawing_path = $4,
          updated_at = CURRENT_TIMESTAMP
      WHERE part_id = $5
      RETURNING *
    `, [part.partnumber, part.partname, part.model, part.drawing_path || null, id]);
    
    if (partResult.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(404).json({ error: "Part not found" });
    }

    const updatedPart = partResult.rows[0];

    // Delete existing operations
    await db.query(`DELETE FROM operations WHERE part_id = $1`, [id]);

    // Insert new operations
    let newOperations = [];
    if (operations && operations.length > 0) {
      for (const op of operations) {
        const opResult = await db.query(`
          INSERT INTO operations
          (part_id, operation_no, operation_text, wct_group, workcenter, planhours, drawing_path, remark)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `, [
          id,
          op.operation_no,
          op.operation_text,
          op.wct_group || null,
          op.workcenter || null,
          op.planhours || null,
          op.drawing_path || null,
          op.remark || null
        ]);
        newOperations.push(opResult.rows[0]);
      }
    }

    // Commit transaction
    await db.query('COMMIT');

    res.json({
      part: updatedPart,
      operations: newOperations
    });
  } catch (err) {
    // Rollback on error
    await db.query('ROLLBACK');
    
    if (err.code === '23505') {
      return res.status(409).json({ 
        error: "Part number or operation number already exists" 
      });
    }
    res.status(500).json({ error: err.message });
  }
};

// GET part with all operations (complete SOW)
exports.getCompleteSOW = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get part
    const partResult = await db.query(`
      SELECT * FROM parts WHERE part_id = $1
    `, [id]);
    
    if (partResult.rows.length === 0) {
      return res.status(404).json({ error: "Part not found" });
    }

    // Get operations
    const opsResult = await db.query(`
      SELECT * FROM operations
      WHERE part_id = $1
      ORDER BY operation_no
    `, [id]);

    res.json({
      part: partResult.rows[0],
      operations: opsResult.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// STATISTICS & REPORTS
// ============================================

// GET statistics
exports.getStatistics = async (req, res) => {
  try {
    const stats = await db.query(`
      SELECT 
        COUNT(DISTINCT p.part_id) as total_parts,
        COUNT(DISTINCT p.model) as total_models,
        COUNT(o.operation_id) as total_operations,
        SUM(o.planhours) as total_hours,
        AVG(o.planhours) as avg_hours_per_operation
      FROM parts p
      LEFT JOIN operations o ON p.part_id = o.part_id
    `);
    
    res.json(stats.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET drawing usage report (which drawings are used in multiple operations)
exports.getDrawingUsageReport = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        p.partnumber,
        p.partname,
        o.drawing_path,
        COUNT(*) as usage_count,
        STRING_AGG(o.operation_no::TEXT || ': ' || o.operation_text, ' | ' ORDER BY o.operation_no) as operations
      FROM operations o
      JOIN parts p ON o.part_id = p.part_id
      WHERE o.drawing_path IS NOT NULL
      GROUP BY p.partnumber, p.partname, o.drawing_path
      HAVING COUNT(*) > 1
      ORDER BY usage_count DESC, p.partnumber
    `);
    
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET planhours by codenumber (order_no + operation_no)
exports.getPlanhours = async (req, res) => {
  try {
    const { order_no, operation_no } = req.query;
    if (!order_no || !operation_no) {
      return res.status(400).json({ error: "order_no and operation_no are required" });
    }
    const codenumber = order_no + operation_no;
    const result = await db.query(
      'SELECT planhours FROM sow WHERE codenumber = $1 LIMIT 1',
      [codenumber]
    );
    if (result.rows.length === 0) {
      return res.json({ planhours: null });
    }
    res.json({ planhours: result.rows[0].planhours });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST bulk planhours lookup by array of codenumbers
exports.getPlanhoursMulti = async (req, res) => {
  try {
    const { codenumbers } = req.body;
    if (!Array.isArray(codenumbers) || codenumbers.length === 0) {
      return res.json({});
    }
    // Deduplicate
    const unique = [...new Set(codenumbers)];
    const result = await db.query(
      'SELECT codenumber, planhours FROM sow WHERE codenumber = ANY($1::text[])',
      [unique]
    );
    const map = {};
    for (const row of result.rows) {
      map[row.codenumber] = row.planhours;
    }
    res.json(map);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// SOW STANDARD (sow_standard + components join)
// ============================================

// GET sow_standard list with pagination and search
exports.getSowStandard = async (req, res) => {
  try {
    const { search } = req.query;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const params = [];
    let where = '';
    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      where = ` WHERE (c.part_name   ILIKE $1
                    OR c.part_number ILIKE $1
                    OR c.model       ILIKE $1)`;
    }

    const countResult = await db.query(
      `SELECT COUNT(*)
       FROM sow_standard ss
       JOIN components c ON ss.component_id = c.component_id
       ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    params.push(limit, offset);
    const dataResult = await db.query(
      `SELECT
         ss.id,
         ss.component_id,
         ss.operation_no,
         ss.operation_text,
         ss.machineid,
         ss.workcenter,
         ss.std_hours,
         ss.remark,
         ss.source_plant,
         c.part_name,
         c.part_number,
         c.model
       FROM sow_standard ss
       JOIN components c ON ss.component_id = c.component_id
       ${where}
       ORDER BY c.part_name ASC, ss.operation_no ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      data:       dataResult.rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// SOW STANDARD — GROUPED (by component)
// ============================================

// GET sow_standard grouped by component, with search + pagination on component level
exports.getSowStandardGrouped = async (req, res) => {
  try {
    const { search } = req.query;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const params = [];
    let where = '';
    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      where = ` WHERE (c.part_name   ILIKE $1
                    OR c.part_number ILIKE $1
                    OR c.model       ILIKE $1)`;
    }

    // Count distinct components
    const countResult = await db.query(
      `SELECT COUNT(DISTINCT c.component_id)
       FROM sow_standard ss
       JOIN components c ON ss.component_id = c.component_id
       ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    // Paginated component list
    params.push(limit, offset);
    const componentResult = await db.query(
      `SELECT
         c.component_id,
         c.part_name,
         c.part_number,
         c.model,
         COUNT(ss.id)::int AS operation_count,
         COUNT(DISTINCT t.template_id)::int AS template_count,
         COALESCE(MAX(ss.source_plant), 0) AS source_plant
       FROM sow_standard ss
       JOIN components c ON ss.component_id = c.component_id
       LEFT JOIN sow_templates t
         ON t.component_id = c.component_id
        AND COALESCE(t.is_active, true) = true
       ${where}
       GROUP BY c.component_id, c.part_name, c.part_number, c.model
       ORDER BY c.part_name ASC, c.part_number ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      data:       componentResult.rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET operations for a single component (by component_id)
exports.getSowStandardByComponent = async (req, res) => {
  try {
    const { component_id } = req.params;
    const result = await db.query(
      `SELECT
         ss.id,
         ss.operation_no,
         ss.operation_text,
         ss.machineid,
         ss.workcenter,
         ss.std_hours,
         ss.remark,
         ss.source_plant,
         COALESCE(
           json_agg(
             json_build_object(
               'id', a.id,
               'filename', a.filename,
               'original_name', a.original_name,
               'file_path', a.file_path,
               'file_size', a.file_size,
               'uploaded_at', a.uploaded_at
             ) ORDER BY a.uploaded_at
           ) FILTER (WHERE a.id IS NOT NULL),
           '[]'
         ) AS attachments
       FROM sow_standard ss
       LEFT JOIN sow_standard_attachments a ON a.standard_id = ss.id
       WHERE ss.component_id = $1
       GROUP BY ss.id
       ORDER BY ss.operation_no ASC`,
      [component_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET operation packages for a single component.
// template_name is intentionally not unique; template_key is unique per component.
exports.getSowTemplatesByComponent = async (req, res) => {
  try {
    const { component_id } = req.params;
    const result = await db.query(
      `SELECT
         t.template_id,
         t.component_id,
         t.template_key,
         t.template_name,
         COALESCE(t.sort_order, 0) AS sort_order,
         COALESCE(
           json_agg(
             json_build_object(
               'id', ss.id,
               'operation_no', ss.operation_no,
               'operation_text', ss.operation_text,
               'machineid', ss.machineid,
               'workcenter', ss.workcenter,
               'std_hours', ss.std_hours,
               'remark', ss.remark,
               'source_plant', ss.source_plant,
               'line_order', COALESCE(tl.line_order, ss.operation_no)
             )
             ORDER BY COALESCE(tl.line_order, ss.operation_no), ss.operation_no, ss.id
           ) FILTER (WHERE ss.id IS NOT NULL),
           '[]'
         ) AS operations,
         COUNT(ss.id)::int AS operation_count,
         COALESCE(SUM(COALESCE(ss.std_hours, 0)), 0)::numeric AS total_std_hours
       FROM public.sow_templates t
       LEFT JOIN public.sow_template_lines tl ON tl.template_id = t.template_id
       LEFT JOIN public.sow_standard ss ON ss.id = tl.standard_id
       WHERE t.component_id = $1
         AND COALESCE(t.is_active, true) = true
       GROUP BY t.template_id
       ORDER BY COALESCE(t.sort_order, 0), t.template_name, t.template_key`,
      [component_id]
    );
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /sow/templates — create template with operation lines
exports.createTemplate = async (req, res) => {
  const client = await pgPool.connect();
  try {
    const { component_id, template_name, template_key, sort_order, operation_ids } = req.body;
    if (!component_id || !template_name || !template_key) {
      return res.status(400).json({ error: 'component_id, template_name, template_key wajib diisi' });
    }
    if (!Array.isArray(operation_ids) || operation_ids.length === 0) {
      return res.status(400).json({ error: 'Pilih minimal 1 operation' });
    }

    await client.query('BEGIN');

    const tmpl = await client.query(
      `INSERT INTO public.sow_templates (component_id, template_name, template_key, sort_order, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [component_id, template_name, template_key, sort_order || 0, req.body.created_by || null]
    );
    const template_id = tmpl.rows[0].template_id;

    for (let i = 0; i < operation_ids.length; i++) {
      await client.query(
        `INSERT INTO public.sow_template_lines (template_id, standard_id, line_order)
         VALUES ($1,$2,$3)`,
        [template_id, operation_ids[i], (i + 1) * 10]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(tmpl.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Template key sudah digunakan untuk component ini' });
    }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// PUT /sow/templates/:templateId — update template + replace lines
exports.updateTemplate = async (req, res) => {
  const client = await pgPool.connect();
  try {
    const { templateId } = req.params;
    const { template_name, template_key, sort_order, operation_ids } = req.body;

    await client.query('BEGIN');

    await client.query(
      `UPDATE public.sow_templates
       SET template_name = $1, template_key = $2, sort_order = $3, updated_at = now()
       WHERE template_id = $4`,
      [template_name, template_key, sort_order || 0, templateId]
    );

    await client.query('DELETE FROM public.sow_template_lines WHERE template_id = $1', [templateId]);

    if (Array.isArray(operation_ids) && operation_ids.length > 0) {
      for (let i = 0; i < operation_ids.length; i++) {
        await client.query(
          `INSERT INTO public.sow_template_lines (template_id, standard_id, line_order)
           VALUES ($1,$2,$3)`,
          [templateId, operation_ids[i], (i + 1) * 10]
        );
      }
    }

    await client.query('COMMIT');

    const result = await client.query(
      `SELECT t.*, COALESCE(json_agg(tl.standard_id ORDER BY tl.line_order) FILTER (WHERE tl.standard_id IS NOT NULL), '[]') AS operation_ids
       FROM public.sow_templates t
       LEFT JOIN public.sow_template_lines tl ON tl.template_id = t.template_id
       WHERE t.template_id = $1
       GROUP BY t.template_id`,
      [templateId]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Template key sudah digunakan untuk component ini' });
    }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// DELETE /sow/templates/:templateId — soft delete
exports.deleteTemplate = async (req, res) => {
  try {
    const { templateId } = req.params;
    await db.query(
      `UPDATE public.sow_templates SET is_active = false, updated_at = now() WHERE template_id = $1`,
      [templateId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET single operation with attachments
exports.getSowStandardById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT
         ss.*,
         c.part_name, c.part_number, c.model,
         COALESCE(
           json_agg(
             json_build_object(
               'id', a.id,
               'filename', a.filename,
               'original_name', a.original_name,
               'file_path', a.file_path,
               'file_size', a.file_size,
               'uploaded_at', a.uploaded_at
             ) ORDER BY a.uploaded_at
           ) FILTER (WHERE a.id IS NOT NULL),
           '[]'
         ) AS attachments
       FROM sow_standard ss
       JOIN components c ON ss.component_id = c.component_id
       LEFT JOIN sow_standard_attachments a ON a.standard_id = ss.id
       WHERE ss.id = $1
       GROUP BY ss.id, c.part_name, c.part_number, c.model`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST create new operation under a component
exports.createSowStandardOperation = async (req, res) => {
  try {
    const { component_id, operation_no, operation_text, machineid, workcenter, std_hours, source_plant, remark } = req.body;
    if (!component_id || !operation_no || !operation_text) {
      return res.status(400).json({ error: 'component_id, operation_no, dan operation_text wajib diisi' });
    }
    const result = await db.query(
      `INSERT INTO sow_standard (component_id, operation_no, operation_text, machineid, workcenter, std_hours, source_plant, remark)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [component_id, operation_no, operation_text, machineid || null, workcenter || null, std_hours || null, source_plant || null, remark || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT update operation
exports.updateSowStandardOperation = async (req, res) => {
  try {
    const { id } = req.params;
    const { operation_no, operation_text, machineid, workcenter, std_hours, source_plant, remark } = req.body;
    const result = await db.query(
      `UPDATE sow_standard
       SET operation_no=$1, operation_text=$2, machineid=$3, workcenter=$4, std_hours=$5, source_plant=$6, remark=$7
       WHERE id=$8
       RETURNING *`,
      [operation_no, operation_text, machineid || null, workcenter || null, std_hours || null, source_plant || null, remark || null, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE operation
exports.deleteSowStandardOperation = async (req, res) => {
  try {
    const { id } = req.params;
    // Attachments will cascade delete via FK. Also clean up files.
    const attachments = await db.query(
      'SELECT file_path FROM sow_standard_attachments WHERE standard_id = $1', [id]
    );
    for (const row of attachments.rows) {
      const fullPath = path.join(__dirname, '..', row.file_path);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
    const result = await db.query('DELETE FROM sow_standard WHERE id=$1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// SOW STANDARD — ATTACHMENTS (PDF)
// Files: /uploads/sow-pdf/{part_number}/{operation_no}/{uuid}.pdf
// ============================================

// POST upload PDFs for an operation (handled via multer in route)
exports.uploadAttachments = async (req, res) => {
  try {
    const { id } = req.params; // standard_id
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Tidak ada file yang di-upload' });
    }

    const inserted = [];
    for (const file of req.files) {
      const result = await db.query(
        `INSERT INTO sow_standard_attachments (standard_id, filename, original_name, file_path, file_size)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [id, file.filename, file.originalname, `/uploads/sow-pdf/${file.filename}`, file.size]
      );
      inserted.push(result.rows[0]);
    }
    res.status(201).json(inserted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET attachments list for an operation
exports.getAttachments = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT * FROM sow_standard_attachments WHERE standard_id=$1 ORDER BY uploaded_at ASC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE a single attachment
exports.deleteAttachment = async (req, res) => {
  try {
    const { attachmentId } = req.params;
    const result = await db.query(
      'DELETE FROM sow_standard_attachments WHERE id=$1 RETURNING *',
      [attachmentId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const row = result.rows[0];
    const fullPath = path.join(__dirname, '..', row.file_path);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// NNVA (Non-Value-Added Activity) Module
// ============================================

// GET /sow/nnva/base — list all NNVA base activities
exports.getNnvaBase = async (req, res) => {
  try {
    const result = await db.query(
      "SELECT * FROM sow_nnva_base ORDER BY id"
    );
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /sow/nnva/base — create new NNVA base
exports.createNnvaBase = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "name is required" });
    }
    const result = await db.query(
      "INSERT INTO sow_nnva_base (name) VALUES ($1) RETURNING *",
      [String(name).trim()]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Name already exists" });
    res.status(500).json({ error: err.message });
  }
};

// PUT /sow/nnva/base/:id — update NNVA base name
exports.updateNnvaBase = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "name is required" });
    }
    const result = await db.query(
      "UPDATE sow_nnva_base SET name = $1 WHERE id = $2 RETURNING *",
      [String(name).trim(), id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json({ data: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Name already exists" });
    res.status(500).json({ error: err.message });
  }
};

// DELETE /sow/nnva/base/:id — delete NNVA base
exports.deleteNnvaBase = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      "DELETE FROM sow_nnva_base WHERE id = $1 RETURNING id",
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json({ deleted: true });
  } catch (err) {
    if (err.code === "23503") return res.status(409).json({ error: "NNVA is in use by operations" });
    res.status(500).json({ error: err.message });
  }
};

// GET /sow/nnva/standard/:standardId — get NNVA assigned to a standard operation
exports.getNnvaByStandard = async (req, res) => {
  try {
    const { standardId } = req.params;
    const result = await db.query(
      `SELECT ns.id, ns.sow_standard_id, ns.nnva_base_id, ns.standard_hours,
              nb.name AS nnva_name
       FROM sow_nnva_standard ns
       JOIN sow_nnva_base nb ON nb.id = ns.nnva_base_id
       WHERE ns.sow_standard_id = $1
       ORDER BY nb.id`,
      [standardId]
    );
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT /sow/nnva/standard/:standardId — bulk save NNVA for a standard operation
// Body: { items: [{ nnva_base_id, standard_hours }, ...] }
exports.saveNnvaToStandard = async (req, res) => {
  const client = await db.connect();
  try {
    const { standardId } = req.params;
    const { items } = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: "items array is required" });
    }

    await client.query("BEGIN");

    // Delete existing assignments
    await client.query(
      "DELETE FROM sow_nnva_standard WHERE sow_standard_id = $1",
      [standardId]
    );

    // Insert new assignments
    const inserted = [];
    for (const item of items) {
      const hours = parseFloat(item.standard_hours) || 0;
      const result = await client.query(
        `INSERT INTO sow_nnva_standard (sow_standard_id, nnva_base_id, standard_hours)
         VALUES ($1, $2, $3) RETURNING *`,
        [standardId, item.nnva_base_id, hours]
      );
      inserted.push(result.rows[0]);
    }

    await client.query("COMMIT");

    // Return enriched data
    const result = await db.query(
      `SELECT ns.id, ns.sow_standard_id, ns.nnva_base_id, ns.standard_hours,
              nb.name AS nnva_name
       FROM sow_nnva_standard ns
       JOIN sow_nnva_base nb ON nb.id = ns.nnva_base_id
       WHERE ns.sow_standard_id = $1
       ORDER BY nb.id`,
      [standardId]
    );
    res.json({ data: result.rows });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// ============================================
// LEGACY COMPATIBILITY (dari table sow lama)
// ============================================

// GET all from old sow table
exports.getAll = async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM sow");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
