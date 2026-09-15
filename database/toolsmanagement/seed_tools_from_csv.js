const fs = require("fs");
const path = require("path");
const { Client } = require("../../apps/api/node_modules/pg");

const ROOT = __dirname;
const PROJECT_ROOT = path.resolve(__dirname, "../..");

function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, ".env");
  const env = {};
  if (!fs.existsSync(envPath)) return env;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return env;
}

function parseCsv(text, delimiter = ";") {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field || row.length) {
    row.push(field);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
  }

  if (rows.length === 0) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((values, index) => {
    const item = { __rowNumber: index + 2 };
    headers.forEach((header, columnIndex) => {
      item[header] = (values[columnIndex] || "").trim();
    });
    return item;
  });
}

function readCsv(filename) {
  return parseCsv(fs.readFileSync(path.join(ROOT, filename), "utf8"));
}

function numberOrDefault(value, fallback) {
  const normalized = String(value || "").replace(",", ".").trim();
  const number = Number(normalized);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function pad(number) {
  return String(number).padStart(6, "0");
}

function buildRows() {
  const rows = [];
  const assetCounts = new Map();

  function push(row) {
    const base = String(row.asset_tag || "").trim();
    const count = assetCounts.get(base) || 0;
    assetCounts.set(base, count + 1);
    rows.push({
      ...row,
      asset_tag: count === 0 ? base : `${base}-ROW${row.source_row_number}`,
    });
  }

  for (const row of readCsv("alat ukur.csv")) {
    const code = row.Code || "";
    push({
      asset_tag: code || `MEASURE-${pad(row.__rowNumber)}`,
      tool_code: code || null,
      source_file: "alat ukur.csv",
      source_row_number: row.__rowNumber,
      source_id: row.ID || null,
      category_code: "MEASURE_TOOL",
      tool_name: row.DESCRIPTION,
      tool_type: null,
      classification: null,
      measurement_range: row.RANGE || null,
      size_label: null,
      specification: null,
      notes: null,
      is_serialized: true,
      quantity_total: 1,
      quantity_available: row.Condition === "Good" ? 1 : 0,
      unit: "pcs",
      condition_code: normalizeKey(row.Condition) || "UNKNOWN",
      availability_status: row.Condition === "Good" ? "available" : row.Condition === "On Calibration" ? "calibration" : "broken",
    });
  }

  for (const row of readCsv("hand tool.csv")) {
    const quantity = numberOrDefault(row.Qty, 0);
    push({
      asset_tag: `HAND-${pad(row.__rowNumber)}`,
      tool_code: null,
      source_file: "hand tool.csv",
      source_row_number: row.__rowNumber,
      source_id: null,
      category_code: "HAND_TOOL",
      tool_name: row.Description,
      tool_type: null,
      classification: null,
      measurement_range: null,
      size_label: row.Ukuran || null,
      specification: null,
      notes: null,
      is_serialized: false,
      quantity_total: quantity,
      quantity_available: quantity,
      unit: "pcs",
      condition_code: "GOOD",
      availability_status: quantity > 0 ? "available" : "retired",
    });
  }

  for (const row of readCsv("power tools.csv")) {
    const code = row.code || "";
    push({
      asset_tag: code || `POWER-${pad(row.__rowNumber)}`,
      tool_code: code || null,
      source_file: "power tools.csv",
      source_row_number: row.__rowNumber,
      source_id: null,
      category_code: "POWERTOOL",
      tool_name: row.Description,
      tool_type: row.Type || null,
      classification: null,
      measurement_range: null,
      size_label: null,
      specification: null,
      notes: row.Note || null,
      is_serialized: true,
      quantity_total: 1,
      quantity_available: row.Condition === "Good" ? 1 : 0,
      unit: "pcs",
      condition_code: normalizeKey(row.Condition) || "UNKNOWN",
      availability_status: row.Condition === "Good" ? "available" : "broken",
    });
  }

  for (const row of readCsv("tap drill.csv")) {
    const category = normalizeKey(row.CATEGORY);
    const quantity = numberOrDefault(row.Terpakai, 0);
    const unit = row["Satuan (Terpakai)"] || "pcs";
    push({
      asset_tag: `${category}-${pad(row.__rowNumber)}`,
      tool_code: null,
      source_file: "tap drill.csv",
      source_row_number: row.__rowNumber,
      source_id: null,
      category_code: category,
      tool_name: row.Description,
      tool_type: null,
      classification: row.Classification || null,
      measurement_range: null,
      size_label: null,
      specification: null,
      notes: row.Notes || null,
      is_serialized: false,
      quantity_total: quantity,
      quantity_available: quantity,
      unit,
      condition_code: "GOOD",
      availability_status: quantity > 0 ? "available" : "retired",
    });
  }

  return rows;
}

async function main() {
  const env = loadEnv();
  const client = new Client({
    host: env.DB_HOST || process.env.DB_HOST || "localhost",
    port: Number(env.DB_PORT || process.env.DB_PORT || 5432),
    database: env.DB_NAME || process.env.DB_NAME,
    user: env.DB_USER || process.env.DB_USER,
    password: env.DB_PASSWORD || process.env.DB_PASSWORD,
  });

  const rows = buildRows();
  await client.connect();
  await client.query("BEGIN");

  try {
    const insertSql = `
      INSERT INTO tools_management.tools (
        asset_tag,
        tool_code,
        source_file,
        source_row_number,
        source_id,
        category_id,
        tool_name,
        tool_type,
        classification,
        measurement_range,
        size_label,
        specification,
        notes,
        is_serialized,
        quantity_total,
        quantity_available,
        unit,
        condition_id,
        availability_status,
        updated_at
      )
      SELECT
        $1,
        $2,
        $3,
        $4,
        $5,
        c.category_id,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16,
        tc.condition_id,
        $17,
        now()
      FROM tools_management.tool_categories c
      LEFT JOIN tools_management.tool_conditions tc
        ON tc.condition_code = $18
      WHERE c.category_code = $19
      ON CONFLICT (asset_tag) DO UPDATE SET
        tool_code = EXCLUDED.tool_code,
        source_file = EXCLUDED.source_file,
        source_row_number = EXCLUDED.source_row_number,
        source_id = EXCLUDED.source_id,
        category_id = EXCLUDED.category_id,
        tool_name = EXCLUDED.tool_name,
        tool_type = EXCLUDED.tool_type,
        classification = EXCLUDED.classification,
        measurement_range = EXCLUDED.measurement_range,
        size_label = EXCLUDED.size_label,
        specification = EXCLUDED.specification,
        notes = EXCLUDED.notes,
        is_serialized = EXCLUDED.is_serialized,
        quantity_total = EXCLUDED.quantity_total,
        quantity_available = EXCLUDED.quantity_available,
        unit = EXCLUDED.unit,
        condition_id = EXCLUDED.condition_id,
        availability_status = EXCLUDED.availability_status,
        updated_at = now()
    `;

    for (const row of rows) {
      await client.query(insertSql, [
        row.asset_tag,
        row.tool_code,
        row.source_file,
        row.source_row_number,
        row.source_id,
        row.tool_name,
        row.tool_type,
        row.classification,
        row.measurement_range,
        row.size_label,
        row.specification,
        row.notes,
        row.is_serialized,
        row.quantity_total,
        row.quantity_available,
        row.unit,
        row.availability_status,
        row.condition_code,
        row.category_code,
      ]);
    }

    await client.query("COMMIT");
    const summary = await client.query(`
      SELECT c.category_code, COUNT(*)::int AS count
      FROM tools_management.tools t
      JOIN tools_management.tool_categories c ON c.category_id = t.category_id
      GROUP BY c.category_code
      ORDER BY c.category_code
    `);
    console.log(JSON.stringify({ seeded: rows.length, summary: summary.rows }, null, 2));
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
