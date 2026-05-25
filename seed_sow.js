#!/usr/bin/env node
/**
 * Seed SOW standard data from standard_sow.csv.
 *
 * Usage:
 *   node seed_sow.js
 *   node seed_sow.js standard_sow.csv
 *   node seed_sow.js --dry-run
 *   node seed_sow.js --on-conflict=replace
 *   node seed_sow.js --on-conflict=append
 *   node seed_sow.js --on-conflict=skip
 *
 * Expected CSV columns, delimiter semicolon:
 *   operation_no;operation_text;part_name;model;part_number;wct_group;
 *   std_hours;loading;setting;measurement;unloading;total_std;source_plant
 *
 * Behavior:
 *   - components are upserted by (model, part_number)
 *   - wct_group is saved directly to sow_standard.machineid
 *   - wct_group is also matched to workcenter.groupname + source_plant
 *     to fill sow_standard.workcenter with workcenter.workcenternew when available
 *   - NNVA columns are saved to sow_nnva_standard using sow_nnva_base
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { Pool } = require("pg");

const DEFAULT_FILE = path.join(__dirname, "standard_sow.csv");
const ENV_PATH = path.join(__dirname, ".env");
const VALID_CONFLICT_MODES = new Set(["ask", "replace", "append", "skip", "abort"]);

const REQUIRED_COLUMNS = [
  "operation_no",
  "operation_text",
  "part_name",
  "model",
  "part_number",
  "wct_group",
  "std_hours",
  "loading",
  "setting",
  "measurement",
  "unloading",
  "total_std",
  "source_plant",
];

const NNVA_COLUMNS = [
  { csvColumn: "loading", baseName: "Loading" },
  { csvColumn: "setting", baseName: "Setting" },
  { csvColumn: "measurement", baseName: "Measurement" },
  { csvColumn: "unloading", baseName: "Unloading" },
];

const HEADER_ALIASES = {
  measure: "measurement",
};

function clean(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function nullableText(value) {
  const text = clean(value);
  return text || null;
}

function toNumber(value) {
  const text = clean(value).replace(",", ".");
  if (!text) return null;
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function toInteger(value) {
  const parsed = Number.parseInt(clean(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    values[key.trim()] = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
  }
  return values;
}

function loadDbConfig() {
  const env = parseEnvFile(ENV_PATH);
  return {
    host: env.DB_HOST || env.TGT_HOST || "localhost",
    port: Number.parseInt(env.DB_PORT || env.TGT_PORT || "5432", 10),
    database: env.DB_NAME || env.TGT_DATABASE || "ptssb",
    user: env.DB_USER || env.TGT_USER || "postgres",
    password: env.DB_PASSWORD || env.TGT_PASSWORD || "",
  };
}

function parseArgs(argv) {
  const args = {
    filePath: DEFAULT_FILE,
    dryRun: false,
    onConflict: "ask",
  };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg.startsWith("--on-conflict=")) {
      args.onConflict = clean(arg.split("=")[1]).toLowerCase();
      continue;
    }
    if (!arg.startsWith("--")) args.filePath = path.resolve(arg);
  }

  if (!VALID_CONFLICT_MODES.has(args.onConflict)) {
    throw new Error(`--on-conflict harus salah satu: ${Array.from(VALID_CONFLICT_MODES).join(", ")}`);
  }

  return args;
}

function parseCsvLine(line, delimiter = ";") {
  const values = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === delimiter && !quoted) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  values.push(current);
  return values;
}

function readStandardCsv(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`File tidak ditemukan: ${filePath}`);
  const content = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV kosong atau tidak punya data");

  const headers = parseCsvLine(lines[0]).map((header) => {
    const normalized = clean(header).toLowerCase();
    return HEADER_ALIASES[normalized] || normalized;
  });
  const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length) throw new Error(`CSV kurang kolom wajib: ${missing.join(", ")}`);

  const rows = lines.slice(1).map((line, index) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, columnIndex) => {
      row[header] = values[columnIndex] ?? "";
    });
    return normalizeCsvRow(row, index + 2);
  });

  return rows.filter((row) => row.operation_no && row.model && row.part_number);
}

function normalizeCsvRow(row, rowNumber) {
  const operationNo = toInteger(row.operation_no);
  return {
    rowNumber,
    operation_no: operationNo,
    operation_text: clean(row.operation_text),
    part_name: clean(row.part_name),
    model: clean(row.model),
    part_number: clean(row.part_number),
    wct_group: clean(row.wct_group).toUpperCase(),
    std_hours: toNumber(row.std_hours),
    loading: toNumber(row.loading),
    setting: toNumber(row.setting),
    measurement: toNumber(row.measurement),
    unloading: toNumber(row.unloading),
    total_std: toNumber(row.total_std),
    source_plant: toInteger(row.source_plant),
  };
}

function getTotalStdHours(row) {
  if (row.total_std !== null && row.total_std !== undefined) return row.total_std;
  return [
    row.std_hours,
    row.loading,
    row.setting,
    row.measurement,
    row.unloading,
  ].reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function componentKey(row) {
  return `${row.model}|||${row.part_number}`;
}

function operationKey(componentId, operationNo) {
  return `${componentId}|${operationNo}`;
}

function hr(label) {
  console.log(`\n${"=".repeat(64)}`);
  if (label) console.log(label);
  console.log("=".repeat(64));
}

function summarizeRows(rows) {
  const components = new Set(rows.map(componentKey));
  const nnvaCount = rows.reduce((sum, row) => {
    return sum + NNVA_COLUMNS.filter((item) => (row[item.csvColumn] || 0) > 0).length;
  }, 0);

  console.log(`CSV rows valid     : ${rows.length}`);
  console.log(`Unique components  : ${components.size}`);
  console.log(`NNVA assignments   : ${nnvaCount}`);
}

async function askConflictMode(conflictCount) {
  if (!process.stdin.isTTY) {
    throw new Error(`Ada ${conflictCount} konflik operation_no. Jalankan dengan --on-conflict=replace|append|skip.`);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const question = [
    "",
    `${conflictCount} row CSV punya operation_no yang sudah ada di sow_standard.`,
    "Pilih aksi: [r]eplace existing, [a]ppend operation_no berikutnya, [s]kip konflik, [q]abort",
    "Pilihan: ",
  ].join("\n");

  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();

  const normalized = clean(answer).toLowerCase();
  if (normalized === "r" || normalized === "replace") return "replace";
  if (normalized === "a" || normalized === "append") return "append";
  if (normalized === "s" || normalized === "skip") return "skip";
  return "abort";
}

async function fetchWorkcenterMap(client, rows) {
  const groups = [...new Set(rows.map((row) => row.wct_group).filter(Boolean))];
  if (!groups.length) return { lookup: new Map(), knownGroups: new Set(), missingGroups: [] };

  const result = await client.query(
    `SELECT idrow, plant, groupname, machineid, workcenternew, workcenter_description, position
     FROM public.workcenter
     WHERE UPPER(TRIM(groupname)) = ANY($1::text[])
     ORDER BY
       UPPER(TRIM(groupname)) ASC,
       CASE WHEN plant IS NULL THEN 1 ELSE 0 END ASC,
       plant ASC NULLS LAST,
       workcenternew ASC NULLS LAST,
       machineid ASC NULLS LAST,
       position ASC NULLS LAST,
       idrow ASC`,
    [groups]
  );

  const byGroup = new Map();
  for (const row of result.rows) {
    const key = clean(row.groupname).toUpperCase();
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(row);
  }

  const lookup = new Map();
  for (const row of rows) {
    const candidates = byGroup.get(row.wct_group) || [];
    const exactPlant = candidates.find((item) => Number(item.plant) === Number(row.source_plant));
    const plantNull = candidates.find((item) => item.plant === null || item.plant === undefined);
    const selected = exactPlant || plantNull || candidates[0] || null;
    lookup.set(`${row.wct_group}|${row.source_plant || ""}`, selected);
  }

  const knownGroups = new Set(byGroup.keys());
  const missingGroups = groups.filter((group) => !knownGroups.has(group));

  return { lookup, knownGroups, missingGroups };
}

function printMissingWorkcenterWarning(rows, missingGroups) {
  if (!missingGroups.length) return;

  hr("WARNING - WCT GROUP BELUM ADA DI WORKCENTER");
  console.log("Daftarkan dulu wct_group ini di public.workcenter.groupname sebelum seed production:");
  for (const group of missingGroups) {
    const examples = rows
      .filter((row) => row.wct_group === group)
      .slice(0, 3)
      .map((row) => `row ${row.rowNumber} ${row.model}/${row.part_number} op ${row.operation_no}`)
      .join("; ");
    console.log(`  ${group}${examples ? ` - contoh: ${examples}` : ""}`);
  }
}

async function fetchNnvaBaseMap(client) {
  const result = await client.query("SELECT id, name FROM public.sow_nnva_base ORDER BY id");
  const map = new Map();
  for (const row of result.rows) map.set(clean(row.name).toLowerCase(), row.id);

  const missing = NNVA_COLUMNS.filter((item) => !map.has(item.baseName.toLowerCase()));
  if (missing.length) {
    throw new Error(`sow_nnva_base belum punya: ${missing.map((item) => item.baseName).join(", ")}`);
  }

  return map;
}

async function upsertComponents(client, rows) {
  const unique = new Map();
  for (const row of rows) {
    const key = componentKey(row);
    if (!unique.has(key)) {
      unique.set(key, {
        model: row.model,
        part_number: row.part_number,
        part_name: row.part_name || row.part_number,
      });
    }
  }

  const existing = await client.query(
    `SELECT component_id, model, part_number
     FROM public.components
     WHERE (model, part_number) IN (
       SELECT * FROM UNNEST($1::text[], $2::text[])
     )`,
    [
      [...unique.values()].map((item) => item.model),
      [...unique.values()].map((item) => item.part_number),
    ]
  );
  const existingKeys = new Set(existing.rows.map((row) => `${row.model}|||${row.part_number}`));

  const componentMap = new Map();
  let created = 0;
  let updated = 0;

  for (const item of unique.values()) {
    const result = await client.query(
      `INSERT INTO public.components (part_name, model, part_number)
       VALUES ($1, $2, $3)
       ON CONFLICT (model, part_number)
       DO UPDATE SET part_name = EXCLUDED.part_name
       RETURNING component_id, model, part_number`,
      [item.part_name, item.model, item.part_number]
    );
    const saved = result.rows[0];
    componentMap.set(`${saved.model}|||${saved.part_number}`, saved.component_id);
    if (existingKeys.has(`${saved.model}|||${saved.part_number}`)) updated += 1;
    else created += 1;
  }

  return { componentMap, created, updated };
}

async function fetchExistingOperations(client, componentIds) {
  if (!componentIds.length) return { operationMap: new Map(), maxMap: new Map(), usedMap: new Map() };

  const result = await client.query(
    `SELECT id, component_id, operation_no, operation_text
     FROM public.sow_standard
     WHERE component_id = ANY($1::bigint[])
     ORDER BY component_id, operation_no, id`,
    [componentIds]
  );

  const operationMap = new Map();
  const maxMap = new Map();
  const usedMap = new Map();

  for (const row of result.rows) {
    const key = operationKey(row.component_id, row.operation_no);
    if (!operationMap.has(key)) operationMap.set(key, []);
    operationMap.get(key).push(row);

    const currentMax = maxMap.get(String(row.component_id)) || 0;
    maxMap.set(String(row.component_id), Math.max(currentMax, Number(row.operation_no) || 0));

    const usedKey = String(row.component_id);
    if (!usedMap.has(usedKey)) usedMap.set(usedKey, new Set());
    usedMap.get(usedKey).add(Number(row.operation_no));
  }

  return { operationMap, maxMap, usedMap };
}

function nextOperationNo(componentId, maxMap, usedMap) {
  const key = String(componentId);
  const used = usedMap.get(key) || new Set();
  let next = Math.ceil(((maxMap.get(key) || 0) + 1) / 10) * 10;
  if (next <= (maxMap.get(key) || 0)) next = (maxMap.get(key) || 0) + 10;
  while (used.has(next)) next += 10;

  used.add(next);
  usedMap.set(key, used);
  maxMap.set(key, next);
  return next;
}

function buildNnvaItems(row, nnvaBaseMap) {
  return NNVA_COLUMNS
    .map((item) => ({
      nnva_base_id: nnvaBaseMap.get(item.baseName.toLowerCase()),
      standard_hours: row[item.csvColumn],
    }))
    .filter((item) => item.standard_hours !== null && item.standard_hours !== undefined && item.standard_hours > 0);
}

async function replaceNnva(client, sowStandardId, items) {
  await client.query("DELETE FROM public.sow_nnva_standard WHERE sow_standard_id = $1", [sowStandardId]);
  for (const item of items) {
    await client.query(
      `INSERT INTO public.sow_nnva_standard (sow_standard_id, nnva_base_id, standard_hours)
       VALUES ($1, $2, $3)
       ON CONFLICT (sow_standard_id, nnva_base_id)
       DO UPDATE SET standard_hours = EXCLUDED.standard_hours, updated_at = CURRENT_TIMESTAMP`,
      [sowStandardId, item.nnva_base_id, item.standard_hours]
    );
  }
}

async function insertSowStandard(client, row, componentId, workcenter, operationNo) {
  const result = await client.query(
    `INSERT INTO public.sow_standard
       (component_id, operation_no, operation_text, machineid, workcenter, std_hours, source_plant)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      componentId,
      operationNo,
      row.operation_text || "-",
      row.wct_group || null,
      workcenter?.workcenternew || null,
      getTotalStdHours(row),
      row.source_plant,
    ]
  );
  return result.rows[0].id;
}

async function updateSowStandard(client, standardId, row, workcenter) {
  const result = await client.query(
    `UPDATE public.sow_standard
     SET operation_text = $2,
         machineid = $3,
         workcenter = $4,
         std_hours = $5,
         source_plant = $6
     WHERE id = $1
     RETURNING id`,
    [
      standardId,
      row.operation_text || "-",
      row.wct_group || null,
      workcenter?.workcenternew || null,
      getTotalStdHours(row),
      row.source_plant,
    ]
  );
  return result.rows[0]?.id || null;
}

function printConflictSamples(rows, componentMap, operationMap) {
  const samples = rows
    .filter((row) => operationMap.has(operationKey(componentMap.get(componentKey(row)), row.operation_no)))
    .slice(0, 10);

  if (!samples.length) return;
  console.log("\nConflict samples:");
  for (const row of samples) {
    console.log(`  row ${row.rowNumber}: ${row.model} / ${row.part_number} op ${row.operation_no} - ${row.operation_text}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = readStandardCsv(args.filePath);
  const dbConfig = loadDbConfig();

  console.log(`File        : ${args.filePath}`);
  console.log(`Dry run     : ${args.dryRun}`);
  console.log(`Conflict    : ${args.onConflict}`);
  console.log(`PostgreSQL  : ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
  summarizeRows(rows);

  const pool = new Pool(dbConfig);
  const client = await pool.connect();

  const stats = {
    componentsCreated: 0,
    componentsUpdated: 0,
    sowInserted: 0,
    sowUpdated: 0,
    sowSkipped: 0,
    sowAppended: 0,
    nnvaSaved: 0,
    missingWorkcenter: 0,
    ambiguousWorkcenter: 0,
  };

  try {
    await client.query("BEGIN");

    const nnvaBaseMap = await fetchNnvaBaseMap(client);
    const workcenterLookup = await fetchWorkcenterMap(client, rows);
    const workcenterMap = workcenterLookup.lookup;

    printMissingWorkcenterWarning(rows, workcenterLookup.missingGroups);
    if (workcenterLookup.missingGroups.length && !args.dryRun) {
      throw new Error(
        `Ada ${workcenterLookup.missingGroups.length} wct_group belum terdaftar di workcenter: ${workcenterLookup.missingGroups.join(", ")}`
      );
    }

    const componentResult = await upsertComponents(client, rows);
    stats.componentsCreated = componentResult.created;
    stats.componentsUpdated = componentResult.updated;

    const componentIds = [...new Set([...componentResult.componentMap.values()].map(String))];
    const { operationMap, maxMap, usedMap } = await fetchExistingOperations(client, componentIds);

    const conflictRows = rows.filter((row) => {
      const componentId = componentResult.componentMap.get(componentKey(row));
      return operationMap.has(operationKey(componentId, row.operation_no));
    });

    printConflictSamples(rows, componentResult.componentMap, operationMap);

    let conflictMode = args.onConflict;
    if (conflictRows.length && conflictMode === "ask" && !args.dryRun) {
      conflictMode = await askConflictMode(conflictRows.length);
    }
    if (conflictMode === "abort") {
      throw new Error("Dibatalkan karena ada konflik operation_no.");
    }

    for (const row of rows) {
      const componentId = componentResult.componentMap.get(componentKey(row));
      const existingKey = operationKey(componentId, row.operation_no);
      const existing = operationMap.get(existingKey) || [];
      const workcenter = workcenterMap.get(`${row.wct_group}|${row.source_plant || ""}`) || null;
      const nnvaItems = buildNnvaItems(row, nnvaBaseMap);

      if (!workcenter) stats.missingWorkcenter += 1;

      const matchingCandidates = workcenter
        ? await client.query(
          `SELECT COUNT(*)::int AS count
           FROM public.workcenter
           WHERE UPPER(TRIM(groupname)) = $1
             AND (plant = $2 OR plant IS NULL)`,
          [row.wct_group, row.source_plant]
        )
        : { rows: [{ count: 0 }] };
      if (Number(matchingCandidates.rows[0]?.count || 0) > 1) stats.ambiguousWorkcenter += 1;

      if (args.dryRun) {
        if (existing.length) stats.sowSkipped += 1;
        else stats.sowInserted += 1;
        stats.nnvaSaved += nnvaItems.length;
        continue;
      }

      if (existing.length && conflictMode === "skip") {
        stats.sowSkipped += 1;
        continue;
      }

      if (existing.length && conflictMode === "replace") {
        const targetId = existing[0].id;
        const updatedId = await updateSowStandard(client, targetId, row, workcenter);
        await replaceNnva(client, updatedId, nnvaItems);
        stats.sowUpdated += 1;
        stats.nnvaSaved += nnvaItems.length;
        continue;
      }

      const finalOperationNo = existing.length
        ? nextOperationNo(componentId, maxMap, usedMap)
        : row.operation_no;
      const insertedId = await insertSowStandard(client, row, componentId, workcenter, finalOperationNo);
      await replaceNnva(client, insertedId, nnvaItems);
      stats.sowInserted += 1;
      if (existing.length) stats.sowAppended += 1;
      stats.nnvaSaved += nnvaItems.length;

      if (!usedMap.has(String(componentId))) usedMap.set(String(componentId), new Set());
      usedMap.get(String(componentId)).add(finalOperationNo);
      maxMap.set(String(componentId), Math.max(maxMap.get(String(componentId)) || 0, finalOperationNo));
    }

    if (args.dryRun) await client.query("ROLLBACK");
    else await client.query("COMMIT");

    hr(args.dryRun ? "DRY RUN COMPLETE - no data changed" : "SEED COMPLETE");
    console.log(`components created : ${stats.componentsCreated}`);
    console.log(`components updated : ${stats.componentsUpdated}`);
    console.log(`sow inserted       : ${stats.sowInserted}`);
    console.log(`sow updated        : ${stats.sowUpdated}`);
    console.log(`sow appended       : ${stats.sowAppended}`);
    console.log(`sow skipped        : ${stats.sowSkipped}`);
    console.log(`nnva saved         : ${stats.nnvaSaved}`);
    console.log(`missing workcenter : ${stats.missingWorkcenter}`);
    console.log(`ambiguous groups   : ${stats.ambiguousWorkcenter} (first match used)`);

    if (conflictRows.length) {
      console.log(`\nConflict rows      : ${conflictRows.length}`);
      console.log(`Conflict action    : ${args.dryRun ? "preview only" : conflictMode}`);
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`\nERROR - rolled back: ${err.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
