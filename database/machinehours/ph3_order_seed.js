const path = require("path");
const dotenv = require(path.join(__dirname, "../../API/node_modules/dotenv"));
const ExcelJS = require(path.join(__dirname, "../../API/node_modules/exceljs"));
const { Pool } = require(path.join(__dirname, "../../API/node_modules/pg"));

const ROOT_DIR = path.resolve(__dirname, "../..");
const DEFAULT_FILE = path.join(__dirname, "template_ph3.xlsx");

dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const COLUMNS = [
  "confirmation_number",
  "indicator_code",
  "operation_short_text",
  "order_no",
  "operation_no",
  "sequence_category",
  "sequence_number",
  "branch_operation_no",
  "return_operation_no",
  "material_no",
  "material_description",
  "operation_description",
  "work_center",
  "cost_center",
  "plant_code",
  "unit_of_measure",
  "standard_value",
  "order_type",
  "order_description",
  "status_etl",
];

const HEADERS = ["action", ...COLUMNS];
const REQUIRED = new Set(["action", "confirmation_number", "order_no"]);
const ACTIONS = new Set(["upsert", "delete", "skip", ""]);

function makePool() {
  return new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
}

function normalizeCell(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value.text) return String(value.text).trim();
  if (typeof value === "object" && value.result != null) return String(value.result).trim();
  return String(value).trim();
}

function rowToObject(row, headerMap) {
  const item = {};
  for (const header of HEADERS) {
    item[header] = normalizeCell(row.getCell(headerMap.get(header)).value);
  }
  item.action = item.action.toLowerCase();
  return item;
}

function getArg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function createWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MPS2 ph3_order seed";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("ph3_order");
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.addRow(HEADERS);

  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF023E8A" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = {
      top: { style: "thin" },
      bottom: { style: "thin" },
      left: { style: "thin" },
      right: { style: "thin" },
    };
  });

  sheet.columns = HEADERS.map((header) => ({
    key: header,
    width: header === "action" ? 12 : Math.min(Math.max(header.length + 4, 16), 34),
  }));

  for (let rowNumber = 2; rowNumber <= 1000; rowNumber += 1) {
    sheet.getCell(`A${rowNumber}`).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: ['"upsert,delete,skip"'],
      showErrorMessage: true,
      errorTitle: "Invalid action",
      error: "Isi action dengan upsert, delete, atau skip.",
    };
  }

  const instructions = workbook.addWorksheet("README");
  instructions.columns = [{ width: 28 }, { width: 100 }];
  instructions.addRows([
    ["Command", "node database/machinehours/ph3_order_seed.js template"],
    ["Command", "node database/machinehours/ph3_order_seed.js dry-run"],
    ["Command", "node database/machinehours/ph3_order_seed.js apply"],
    ["Command", "node database/machinehours/ph3_order_seed.js export"],
    ["action=upsert", "Create jika confirmation_number belum ada, update jika sudah ada."],
    ["action=delete", "Delete berdasarkan confirmation_number. Kolom lain boleh kosong."],
    ["action=skip", "Baris diabaikan."],
    ["Required", "action, confirmation_number, order_no untuk upsert. Delete butuh action dan confirmation_number."],
    ["Key", "confirmation_number adalah unique key di ph3_order."],
  ]);
  instructions.getRow(1).font = { bold: true };

  return workbook;
}

async function writeWorkbook(filePath, rows) {
  const workbook = createWorkbook();
  const sheet = workbook.getWorksheet("ph3_order");

  rows.forEach((row) => {
    sheet.addRow(HEADERS.map((header) => row[header] ?? ""));
  });

  await workbook.xlsx.writeFile(filePath);
}

async function commandTemplate(filePath) {
  await writeWorkbook(filePath, [
    {
      action: "skip",
      confirmation_number: "6916801",
      indicator_code: "UPDT",
      operation_short_text: "Example operation",
      order_no: "320008857",
      operation_no: "1601",
      sequence_category: "",
      sequence_number: "",
      branch_operation_no: "",
      return_operation_no: "",
      material_no: "",
      material_description: "",
      operation_description: "",
      work_center: "M5051WLS",
      cost_center: "",
      plant_code: process.env.PLANT_SSB || "",
      unit_of_measure: "HR",
      standard_value: "0.000",
      order_type: "",
      order_description: "",
      status_etl: "MANUAL",
    },
    {
      action: "skip",
      confirmation_number: "ISI_CONFIRMATION_NUMBER_YANG_MAU_DIHAPUS",
    },
    {
      action: "skip",
      confirmation_number: "ISI_CONFIRMATION_NUMBER_SAMPLE",
      order_no: "ISI_ORDER_NO_SAMPLE",
    },
  ]);
  console.log(`Template created: ${filePath}`);
}

async function commandExport(filePath) {
  const pool = makePool();
  try {
    const result = await pool.query(`
      SELECT ${COLUMNS.join(", ")}
      FROM public.ph3_order
      ORDER BY confirmation_number ASC
    `);
    const rows = result.rows.map((row) => ({ action: "upsert", ...row }));
    await writeWorkbook(filePath, rows);
    console.log(`Exported ${rows.length} rows to: ${filePath}`);
  } finally {
    await pool.end();
  }
}

async function readInputRows(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet("ph3_order") || workbook.worksheets[0];
  if (!sheet) throw new Error("Workbook tidak punya worksheet.");

  const headerMap = new Map();
  sheet.getRow(1).eachCell((cell, colNumber) => {
    headerMap.set(normalizeCell(cell.value), colNumber);
  });

  const missingHeaders = HEADERS.filter((header) => !headerMap.has(header));
  if (missingHeaders.length > 0) {
    throw new Error(`Header hilang: ${missingHeaders.join(", ")}`);
  }

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const item = rowToObject(row, headerMap);
    if (HEADERS.every((header) => item[header] === "")) return;
    rows.push({ rowNumber, item });
  });
  return rows;
}

function validateRows(rows) {
  const errors = [];
  const normalized = [];

  rows.forEach(({ rowNumber, item }) => {
    if (!ACTIONS.has(item.action)) {
      errors.push(`Row ${rowNumber}: action harus upsert/delete/skip.`);
      return;
    }

    if (item.action === "" || item.action === "skip") return;

    if (!item.confirmation_number) {
      errors.push(`Row ${rowNumber}: confirmation_number wajib diisi.`);
      return;
    }

    if (item.action === "upsert" && !item.order_no) {
      errors.push(`Row ${rowNumber}: order_no wajib diisi untuk upsert.`);
      return;
    }

    normalized.push({ rowNumber, item });
  });

  return { errors, rows: normalized };
}

async function applyRows(rows, dryRun) {
  const pool = makePool();
  const client = await pool.connect();
  const summary = { upsert: 0, delete: 0, skip: 0 };

  try {
    await client.query("BEGIN");

    for (const { item } of rows) {
      if (item.action === "delete") {
        summary.delete += 1;
        await client.query("DELETE FROM public.ph3_order WHERE confirmation_number = $1", [item.confirmation_number]);
        continue;
      }

      if (item.action === "upsert") {
        summary.upsert += 1;
        const values = COLUMNS.map((column) => item[column] || "");
        const placeholders = COLUMNS.map((_, index) => `$${index + 1}`).join(", ");
        const updates = COLUMNS
          .filter((column) => column !== "confirmation_number")
          .map((column) => `${column} = EXCLUDED.${column}`)
          .join(", ");

        await client.query(
          `
          INSERT INTO public.ph3_order (${COLUMNS.join(", ")})
          VALUES (${placeholders})
          ON CONFLICT (confirmation_number)
          DO UPDATE SET ${updates}
          `,
          values
        );
      }
    }

    if (dryRun) {
      await client.query("ROLLBACK");
    } else {
      await client.query("COMMIT");
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }

  return summary;
}

async function main() {
  const command = (process.argv[2] || "help").toLowerCase();
  const filePath = path.resolve(getArg("file", DEFAULT_FILE));

  if (command === "template") {
    await commandTemplate(filePath);
    return;
  }

  if (command === "export") {
    await commandExport(filePath);
    return;
  }

  if (command === "dry-run" || command === "apply") {
    const inputRows = await readInputRows(filePath);
    const validation = validateRows(inputRows);
    if (validation.errors.length > 0) {
      console.error("Validation failed:");
      validation.errors.forEach((error) => console.error(`- ${error}`));
      process.exitCode = 1;
      return;
    }

    const summary = await applyRows(validation.rows, command === "dry-run");
    console.log(`${command === "dry-run" ? "Dry-run OK" : "Apply OK"}:`, summary);
    return;
  }

  console.log(`
Usage:
  node database/machinehours/ph3_order_seed.js template [--file=path.xlsx]
  node database/machinehours/ph3_order_seed.js export [--file=path.xlsx]
  node database/machinehours/ph3_order_seed.js dry-run [--file=path.xlsx]
  node database/machinehours/ph3_order_seed.js apply [--file=path.xlsx]
`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
