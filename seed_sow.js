#!/usr/bin/env node
/**
 * seed_sow.js — Seed SOW Standard data from Excel
 *
 * Usage:
 *   node seed_sow.js                             # pakai file default
 *   node seed_sow.js "path/to/file.xlsx"         # pakai file lain
 *   node seed_sow.js --dry-run                   # preview tanpa insert
 *
 * Format Excel yang diharapkan (sheet pertama):
 *   Row 1  : baris header kedua (diabaikan)
 *   Row 2+ : data
 *
 *   Kolom:
 *     A  → Operation Number
 *     B  → Operation Text
 *     C  → Part Name
 *     D  → Model
 *     E  → Part Number
 *     F  → Balikpapan  Work Center   (source_plant = 5051)
 *     G  → Balikpapan  Std Hours
 *     H  → Sebamban    Work Center   (source_plant = 5153)
 *     I  → Sebamban    Std Hours
 *     J  → Kuala Kencana Work Center (source_plant = 5071)
 *     K  → Kuala Kencana Std Hours
 *
 * Tables affected:
 *   public.components   — upsert on (model, part_number)
 *   public.sow_standard — insert new rows, skip duplicates on
 *                         (component_id, operation_no, source_plant, machineid)
 */

const XLSX = require('xlsx');
const { Pool } = require('pg');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────
const DB = {
  host: 'localhost', port: 5432,
  database: 'ptssb', user: 'postgres', password: '@dminta9',
};

const DEFAULT_FILE = path.join(__dirname, 'sample scope of work.xlsx');

const PLANTS = [
  { wc_col: 'balikpapan_wc',    hrs_col: 'balikpapan_hrs',    source_plant: 5051, label: 'BPN' },
  { wc_col: 'sebamban_wc',      hrs_col: 'sebamban_hrs',      source_plant: 5153, label: 'SBN' },
  { wc_col: 'kuala_kencana_wc', hrs_col: 'kuala_kencana_hrs', source_plant: 5071, label: 'KK'  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}
function clean(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}
function hr(label) {
  console.log(`\n${'═'.repeat(54)}`);
  if (label) console.log(`  ${label}`);
  console.log('═'.repeat(54));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const filePath = args.find(a => !a.startsWith('--')) ?? DEFAULT_FILE;

  console.log(`File    : ${filePath}`);
  console.log(`Dry run : ${dryRun}`);

  // ── 1. Read Excel ───────────────────────────────────────────────────────────
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(ws, { defval: null });

  // Row 0 = sub-header ("Operation Number", "Work Center", …) — skip
  const dataRows = rawRows.slice(1).map(r => ({
    operation_no:      r['__EMPTY'],
    operation_text:    r['__EMPTY_1'],
    part_name:         r['__EMPTY_2'],
    model:             clean(r['__EMPTY_3']),
    part_number:       clean(r['__EMPTY_4']),
    balikpapan_wc:     r['BALIKPAPAN'],
    balikpapan_hrs:    r['__EMPTY_5'],
    sebamban_wc:       r['SEBAMBAN'],
    sebamban_hrs:      r['__EMPTY_6'],
    kuala_kencana_wc:  r['KUALA KENCANA'],
    kuala_kencana_hrs: r['__EMPTY_7'],
  })).filter(r =>
    r.operation_no !== null &&
    r.part_number  !== null &&
    r.model        !== null
  );

  console.log(`Excel rows (valid): ${dataRows.length}`);

  if (dryRun) {
    const compSet = new Set();
    let sowCount = 0;
    let nullPlantCount = 0;
    for (const r of dataRows) {
      compSet.add(`${r.model}|||${r.part_number}`);
      const hasAny = PLANTS.some(p => clean(r[p.wc_col]));
      if (!hasAny) { nullPlantCount++; sowCount++; }
      else { for (const p of PLANTS) { if (clean(r[p.wc_col])) sowCount++; } }
    }
    hr('DRY RUN PREVIEW');
    console.log(`  Unique components       : ${compSet.size}`);
    console.log(`  sow_standard rows total : ${sowCount}`);
    PLANTS.forEach(p => {
      const cnt = dataRows.filter(r => clean(r[p.wc_col])).length;
      console.log(`    plant ${p.source_plant} (${p.label}) : ${cnt}`);
    });
    console.log(`    no plant (NULL)       : ${nullPlantCount}`);
    return;
  }

  // ── 2. Connect ──────────────────────────────────────────────────────────────
  const pool = new Pool(DB);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ── 3. Upsert components ─────────────────────────────────────────────────
    const componentMap = new Map(); // `${model}|||${part_number}` → component_id
    const uniqueComponents = new Map();
    for (const r of dataRows) {
      const key = `${r.model}|||${r.part_number}`;
      if (!uniqueComponents.has(key)) {
        uniqueComponents.set(key, { part_name: clean(r.part_name) ?? '', model: r.model, part_number: r.part_number });
      }
    }

    let compNew = 0;
    for (const [key, c] of uniqueComponents) {
      const res = await client.query(`
        INSERT INTO public.components (part_name, model, part_number)
        VALUES ($1, $2, $3)
        ON CONFLICT (model, part_number) DO UPDATE SET part_name = EXCLUDED.part_name
        RETURNING component_id
      `, [c.part_name, c.model, c.part_number]);
      componentMap.set(key, res.rows[0].component_id);
      compNew++;
    }

    // ── 4. Insert sow_standard ───────────────────────────────────────────────
    // Build set of existing rows to skip duplicates
    const existRes = await client.query(`
      SELECT component_id, operation_no, source_plant, machineid FROM public.sow_standard
    `);
    const existSet = new Set(
      existRes.rows.map(r => `${r.component_id}|${r.operation_no}|${r.source_plant}|${r.machineid}`)
    );

    let sowInserted = 0;
    let sowSkipped  = 0;
    let sowNullPlant = 0;

    for (const r of dataRows) {
      const compKey    = `${r.model}|||${r.part_number}`;
      const component_id = componentMap.get(compKey);
      if (!component_id) continue;

      // Cek apakah ada minimal 1 plant yang punya workcenter
      const hasAnyPlant = PLANTS.some(p => clean(r[p.wc_col]));

      if (!hasAnyPlant) {
        // Semua plant kosong → insert 1 baris dengan NULL
        const dupKey = `${component_id}|${r.operation_no}|null|null`;
        if (existSet.has(dupKey)) {
          sowSkipped++;
          continue;
        }
        await client.query(`
          INSERT INTO public.sow_standard
            (component_id, operation_no, operation_text, machineid, workcenter, std_hours, source_plant)
          VALUES ($1, $2, $3, NULL, NULL, NULL, NULL)
        `, [component_id, parseInt(r.operation_no), clean(r.operation_text) ?? '']);
        existSet.add(dupKey);
        sowInserted++;
        sowNullPlant++;
        continue;
      }

      // Ada plant yang punya data → insert per plant seperti biasa
      for (const p of PLANTS) {
        const machineid = clean(r[p.wc_col]);
        if (!machineid) continue;

        const dupKey = `${component_id}|${r.operation_no}|${p.source_plant}|${machineid}`;
        if (existSet.has(dupKey)) {
          sowSkipped++;
          continue;
        }

        await client.query(`
          INSERT INTO public.sow_standard
            (component_id, operation_no, operation_text, machineid, workcenter, std_hours, source_plant)
          VALUES ($1, $2, $3, $4, NULL, $5, $6)
        `, [
          component_id,
          parseInt(r.operation_no),
          clean(r.operation_text) ?? '',
          machineid,
          toNum(r[p.hrs_col]),
          p.source_plant,
        ]);

        existSet.add(dupKey);
        sowInserted++;
      }
    }

    await client.query('COMMIT');

    // ── 5. Report ─────────────────────────────────────────────────────────────
    hr('SEED COMPLETE');
    console.log(`  components upserted    : ${compNew}`);
    console.log(`  sow_standard inserted  : ${sowInserted}`);
    console.log(`    └─ no plant (NULL)   : ${sowNullPlant}`);
    console.log(`  sow_standard skipped   : ${sowSkipped} (duplicates)`);

    const byPlant = await client.query(`
      SELECT source_plant, COUNT(*) AS cnt
      FROM public.sow_standard GROUP BY source_plant ORDER BY source_plant
    `);
    const label = { 5051: 'BPN', 5153: 'SBN', 5071: 'KK' };
    console.log('\n  Total sow_standard per plant:');
    byPlant.rows.forEach(r =>
      console.log(`    plant ${r.source_plant} (${label[r.source_plant] || '?'}) : ${r.cnt}`)
    );

    // ── 6. Gap report ─────────────────────────────────────────────────────────
    const gapRes = await client.query(`
      SELECT s.source_plant, s.machineid, COUNT(*) AS ops
      FROM public.sow_standard s
      LEFT JOIN public.workcenter w ON UPPER(TRIM(w.machineid)) = UPPER(TRIM(s.machineid))
      WHERE w.machineid IS NULL AND s.machineid IS NOT NULL
      GROUP BY s.source_plant, s.machineid
      ORDER BY s.source_plant, s.machineid
    `);

    hr('MACHINEIDS NOT IN workcenter');
    if (gapRes.rows.length === 0) {
      console.log('  ✓ Semua machineid sudah ada di workcenter');
    } else {
      let lastPlant = null;
      for (const row of gapRes.rows) {
        if (row.source_plant !== lastPlant) {
          console.log(`\n  [plant ${row.source_plant} / ${label[row.source_plant] || '?'}]`);
          lastPlant = row.source_plant;
        }
        console.log(`    ${String(row.machineid).padEnd(12)} — ${row.ops} operasi`);
      }
      console.log(`\n  Total missing: ${gapRes.rows.length} machineid`);
    }

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ ERROR — rolled back:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
