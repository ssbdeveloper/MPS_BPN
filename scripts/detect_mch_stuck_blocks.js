#!/usr/bin/env node
/**
 * detect_mch_stuck_blocks.js — laporan baris "nyangkut" di mch_productiondata.
 *
 * HANYA MEMBACA. Tidak ada INSERT/UPDATE/DELETE di file ini, dan memang tidak boleh ada:
 * mch_productiondata adalah cermin SSB_OEE (etl_machine_conf.py upsert ON CONFLICT
 * (proddataid)), jadi koreksi apa pun di sini akan ditimpa sync berikutnya.
 *
 * MASALAH YANG DICARI
 * -------------------
 * Stream status OEE normalnya "tiling": enddatetime baris N == startdatetime baris N+1
 * pada mesin yang sama (Juli 2026: 24.402 dari 25.054 baris). Saat HMI restart/putus,
 * baris yang sedang terbuka TIDAK ditutup oleh transisi status; belakangan ada proses lain
 * yang menutupnya dengan stempel waktu "sekarang". Hasilnya satu blok panjang yang berjalan
 * PARALEL dengan stream nyata yang sudah lanjut di bawahnya -> jamnya terhitung dua kali.
 *
 * Contoh kanonik (proddataid 518505, mesin 48 / M5051BL3, 17-Jul-2026):
 *   14:45:53 Setting ───────────────────────────────► 19:43:24.450  (4,96 jam, duration=0)
 *   15:32:27   stream nyata lanjut: Productive 47 mnt, 62 mnt, ...
 *
 * KRITERIA DETEKSI (utama): end > start baris berikutnya pada mesin yang sama.
 * Dua penanda pendukung yang menjelaskan SEBABNYA (bukan syarat):
 *   - duration = 0            -> counter di sumber tak pernah jalan (baris tak ditutup wajar)
 *   - milidetik end <> .000   -> ditutup program (stempel now()), bukan transisi status
 * Juli 2026: 516 baris ber-milidetik <> .000, 100% di antaranya duration = 0.
 *
 * PEMAKAIAN
 *   node scripts/detect_mch_stuck_blocks.js                 # 7 hari terakhir
 *   node scripts/detect_mch_stuck_blocks.js --days 30
 *   node scripts/detect_mch_stuck_blocks.js --from 2026-07-01 --to 2026-07-31
 *   node scripts/detect_mch_stuck_blocks.js --min-minutes 30 --limit 50
 *   node scripts/detect_mch_stuck_blocks.js --json          # untuk pipeline/cron
 *   node scripts/detect_mch_stuck_blocks.js --strict        # exit 1 bila ada temuan M1/M2
 *
 * Kredensial dibaca dari .env root (DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD).
 */
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(PROJECT_ROOT, ".env");

// Ambang default: blok < 1 menit hampir selalu artefak pembulatan detik di sumber,
// bukan HMI nyangkut. Naikkan dengan --min-minutes kalau laporan terlalu ramai.
const DEFAULT_MIN_MINUTES = 1;
const DEFAULT_DAYS = 7;
const DEFAULT_LIMIT = 25;

function parseEnvFile(filePath) {
  const parsed = {};
  if (!fs.existsSync(filePath)) return parsed;
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const commentIndex = value.search(/\s+#/);
    if (commentIndex !== -1) value = value.slice(0, commentIndex).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function parseArgs(argv) {
  const args = {
    days: DEFAULT_DAYS,
    from: null,
    to: null,
    minMinutes: DEFAULT_MIN_MINUTES,
    limit: DEFAULT_LIMIT,
    json: false,
    strict: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    let arg = argv[i];
    let inline = null;
    if (arg.startsWith("--") && arg.includes("=")) {
      const eq = arg.indexOf("=");
      inline = arg.slice(eq + 1);
      arg = arg.slice(0, eq);
    }
    const value = () => (inline !== null ? inline : argv[++i]);
    if (arg === "--days") args.days = Number(value());
    else if (arg === "--from") args.from = value();
    else if (arg === "--to") args.to = value();
    else if (arg === "--min-minutes") args.minMinutes = Number(value());
    else if (arg === "--limit") args.limit = Number(value());
    else if (arg === "--json") args.json = true;
    else if (arg === "--strict") args.strict = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Opsi tidak dikenal: ${arg}`);
  }
  if ((args.from && !args.to) || (!args.from && args.to)) {
    throw new Error("--from dan --to harus dipakai berpasangan");
  }
  if (!Number.isFinite(args.days) || args.days <= 0) throw new Error("--days harus angka > 0");
  return args;
}

function usage() {
  console.log(`
detect_mch_stuck_blocks.js — cari blok "nyangkut" (overlap) di mch_productiondata. READ-ONLY.

  --days N            Jendela N hari terakhir (default ${DEFAULT_DAYS})
  --from / --to       Rentang tanggal YYYY-MM-DD (inklusif), menggantikan --days
  --min-minutes N     Abaikan blok lebih pendek dari ini (default ${DEFAULT_MIN_MINUTES})
  --limit N           Jumlah blok terbesar yang dirinci (default ${DEFAULT_LIMIT})
  --json              Keluarkan JSON, bukan tabel
  --strict            Exit 1 bila ada blok M1/M2 (untuk cron/CI)
`);
}

// LEAD dihitung atas SELURUH baris mesin (tanpa filter status) — kalau difilter dulu,
// "baris berikutnya" jadi lebih jauh dan overlap-nya terbaca lebih kecil dari yang nyata.
const SQL_BLOCKS = `
WITH seq AS (
  SELECT
    p.proddataid,
    p.machineno,
    p.statusid,
    p.startdatetime,
    p.enddatetime,
    p.duration,
    p.jobid,
    p.operatorid,
    lead(p.startdatetime) OVER (PARTITION BY p.machineno ORDER BY p.startdatetime, p.proddataid) AS next_start
  FROM public.mch_productiondata p
  WHERE p.startdatetime >= $1::timestamp
    AND p.startdatetime < $2::timestamp
    AND p.enddatetime IS NOT NULL
),
stuck AS (
  SELECT
    s.*,
    EXTRACT(EPOCH FROM (s.enddatetime - s.next_start)) / 3600.0 AS overlap_hours,
    EXTRACT(EPOCH FROM (s.enddatetime - s.startdatetime)) / 3600.0 AS block_hours,
    (date_part('milliseconds', s.enddatetime)::int % 1000 <> 0) AS closed_by_program
  FROM seq s
  WHERE s.next_start IS NOT NULL
    AND s.enddatetime > s.next_start
    AND EXTRACT(EPOCH FROM (s.enddatetime - s.startdatetime)) >= $3::numeric * 60
)
SELECT
  k.proddataid,
  k.machineno,
  m.machineid,
  m.machinename,
  k.statusid,
  t.description        AS status_description,
  t.activitytype,
  to_char(k.startdatetime, 'YYYY-MM-DD HH24:MI:SS')     AS mulai,
  to_char(k.enddatetime,   'YYYY-MM-DD HH24:MI:SS.MS')  AS selesai,
  to_char(k.next_start,    'YYYY-MM-DD HH24:MI:SS')     AS baris_berikutnya,
  round(k.block_hours::numeric, 2)   AS jam_blok,
  round(k.overlap_hours::numeric, 2) AS jam_overlap,
  k.duration,
  k.closed_by_program,
  k.jobid,
  COALESCE(sap.bundles, 0)        AS sap_bundles,
  COALESCE(sap.posted_bundles, 0) AS sap_posted,
  round(COALESCE(sap.staged_seconds, 0) / 3600.0, 2) AS jam_di_staging,
  round(COALESCE(sap.posted_seconds, 0) / 3600.0, 2) AS jam_posted,
  sap.statuses                    AS sap_status
FROM stuck k
LEFT JOIN public.mch_machines   m ON m.machineno = k.machineno
LEFT JOIN public.mch_statustypes t ON t.statusid = k.statusid
-- LATERAL beragregat, BUKAN LEFT JOIN biasa: satu baris sumber bisa masuk ke BEBERAPA
-- bundel harian (blok 6 hari jelas begitu), dan join polos akan menggandakan bloknya
-- di laporan lalu membuat hitungan "sudah POSTED" ikut menggelembung.
LEFT JOIN LATERAL (
  SELECT count(*)::int AS bundles,
         count(*) FILTER (WHERE st.status = 'POSTED')::int AS posted_bundles,
         -- seconds = kontribusi PERSIS baris sumber ini ke tiap bundel (provenance
         -- 2026-07-14), jadi ini jam yang benar-benar dikirim — bukan taksiran.
         COALESCE(sum(src.seconds), 0)::bigint AS staged_seconds,
         COALESCE(sum(src.seconds) FILTER (WHERE st.status = 'POSTED'), 0)::bigint AS posted_seconds,
         string_agg(DISTINCT st.status, '/') AS statuses
  FROM public.sap_staging_source src
  LEFT JOIN public.sap_timesheet_staging st ON st.id = src.staging_id
  WHERE src.source_system = 'MCH_HOURS' AND src.source_row_id = k.proddataid::text
) sap ON TRUE
ORDER BY k.overlap_hours DESC, k.proddataid
`;

const SQL_SUMMARY = `
WITH seq AS (
  SELECT
    p.proddataid, p.machineno, p.statusid, p.startdatetime, p.enddatetime,
    lead(p.startdatetime) OVER (PARTITION BY p.machineno ORDER BY p.startdatetime, p.proddataid) AS next_start
  FROM public.mch_productiondata p
  WHERE p.startdatetime >= $1::timestamp
    AND p.startdatetime < $2::timestamp
    AND p.enddatetime IS NOT NULL
),
klas AS (
  SELECT
    s.*,
    t.activitytype,
    (s.next_start IS NOT NULL AND s.enddatetime > s.next_start
     AND EXTRACT(EPOCH FROM (s.enddatetime - s.startdatetime)) >= $3::numeric * 60) AS is_stuck,
    EXTRACT(EPOCH FROM (s.enddatetime - s.next_start)) / 3600.0 AS overlap_hours
  FROM seq s LEFT JOIN public.mch_statustypes t ON t.statusid = s.statusid
)
SELECT
  count(*)::int                                                              AS baris_total,
  count(*) FILTER (WHERE enddatetime = next_start)::int                      AS tiling_sempurna,
  count(*) FILTER (WHERE is_stuck)::int                                      AS blok_nyangkut,
  round(COALESCE(sum(overlap_hours) FILTER (WHERE is_stuck), 0)::numeric, 2) AS jam_overlap,
  count(*) FILTER (WHERE is_stuck AND activitytype IN ('M1','M2'))::int      AS blok_m1m2,
  round(COALESCE(sum(overlap_hours) FILTER (WHERE is_stuck AND activitytype IN ('M1','M2')), 0)::numeric, 2) AS jam_overlap_m1m2
FROM klas
`;

// Aritmetika tanggal lewat Date.UTC, BUKAN toISOString() atas Date lokal: mesin ini
// WITA (+8), jadi round-trip lokal->ISO menggeser hasilnya satu hari ke belakang.
// startdatetime di mch_productiondata adalah timestamp TANPA zona (jam dinding pabrik),
// jadi batas jendela pun harus jam dinding polos — tanpa konversi zona sama sekali.
function addDaysISO(dateStr, n) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function resolveWindow(args) {
  if (args.from && args.to) {
    // --to inklusif -> batas atas eksklusif = hari berikutnya.
    return { from: `${args.from} 00:00:00`, to: `${addDaysISO(args.to, 1)} 00:00:00` };
  }
  const todayLocal = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, kalender lokal
  return {
    from: `${addDaysISO(todayLocal, -args.days)} 00:00:00`,
    to: `${addDaysISO(todayLocal, 1)} 00:00:00`,
  };
}

function printTable(rows, limit) {
  const shown = rows.slice(0, limit);
  console.log(
    ["proddataid", "mesin", "status", "act", "mulai", "selesai", "jam_blok", "jam_ovl", "SAP"]
      .map((h, i) => h.padEnd([12, 14, 20, 6, 20, 24, 9, 8, 10][i]))
      .join(""),
  );
  console.log("-".repeat(121));
  for (const r of shown) {
    const bundles = Number(r.sap_bundles) || 0;
    const sap = bundles === 0 ? "-" : `${r.sap_status || "STAGED"}${bundles > 1 ? `x${bundles}` : ""}`;
    console.log(
      [
        String(r.proddataid).padEnd(12),
        String(r.machineid || r.machineno).padEnd(14),
        String(r.status_description || r.statusid).slice(0, 19).padEnd(20),
        String(r.activitytype || "-").padEnd(6),
        String(r.mulai).padEnd(20),
        String(r.selesai).padEnd(24),
        String(r.jam_blok).padStart(7).padEnd(9),
        String(r.jam_overlap).padStart(6).padEnd(8),
        sap.padEnd(10),
      ].join(""),
    );
  }
  if (rows.length > shown.length) {
    console.log(`... ${rows.length - shown.length} blok lain disembunyikan (--limit untuk menambah)`);
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    usage();
    process.exit(2);
  }
  if (args.help) {
    usage();
    return;
  }

  const env = { ...parseEnvFile(ENV_PATH), ...process.env };
  const pool = new Pool({
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
  });

  const win = resolveWindow(args);
  let exitCode = 0;
  try {
    const params = [win.from, win.to, args.minMinutes];
    const [summary, blocks] = await Promise.all([
      pool.query(SQL_SUMMARY, params),
      pool.query(SQL_BLOCKS, params),
    ]);
    const s = summary.rows[0] || {};
    const rows = blocks.rows;
    const round2 = (n) => Math.round(n * 100) / 100;
    const stagedRows = rows.filter((r) => Number(r.sap_bundles) > 0);
    const postedRows = rows.filter((r) => Number(r.sap_posted) > 0);
    const staged = stagedRows.length;
    const posted = postedRows.length;
    // Jam yang BENAR-BENAR dikirim dari blok nyangkut (bukan taksiran): dijumlahkan dari
    // sap_staging_source.seconds, kontribusi persis tiap baris sumber ke bundelnya.
    // Perhatikan ini TIDAK sama dengan angka M1/M2 — status unproductive (Coffee Break,
    // Labour Necessity, dst.) juga di-stage sejak aturan kelayakan 2026-07-15; hanya
    // statusid 0/3/4 (Off/Downtime/No Job) yang dikecualikan.
    const stagedHours = round2(rows.reduce((sum, r) => sum + Number(r.jam_di_staging), 0));
    const postedHours = round2(rows.reduce((sum, r) => sum + Number(r.jam_posted), 0));

    if (args.json) {
      console.log(JSON.stringify(
        { window: win, min_minutes: args.minMinutes, summary: s, staged, posted, staged_hours: stagedHours, posted_hours: postedHours, blocks: rows },
        null, 2,
      ));
    } else {
      console.log(`\nJendela   : ${win.from} .. ${win.to} (blok >= ${args.minMinutes} menit)`);
      console.log(`Baris     : ${s.baris_total} (tiling sempurna ${s.tiling_sempurna})`);
      console.log(`Nyangkut  : ${s.blok_nyangkut} blok, ${s.jam_overlap} jam terhitung dua kali`);
      console.log(`  M1/M2   : ${s.blok_m1m2} blok, ${s.jam_overlap_m1m2} jam (dibukukan ke order)`);
      console.log(`  Ke SAP  : ${staged} blok ter-stage (${stagedHours} jam), ${posted} sudah POSTED (${postedHours} jam terkirim)`);
      if (rows.length) {
        console.log("");
        printTable(rows, args.limit);
        console.log(
          "\nCatatan: 'jam_blok' = panjang blok, 'jam_ovl' = bagian yang tumpang tindih dengan\n" +
            "baris berikutnya (itulah yang dihitung dua kali). Blok yang sudah POSTED hanya bisa\n" +
            "dikoreksi lewat STORNO — jangan diam-diam diubah di staging.",
        );
      } else {
        console.log("\nTidak ada blok nyangkut pada jendela ini.");
      }
    }

    // Ambang gagal = blok nyangkut yang SUDAH bocor ke staging/SAP. Blok yang hanya
    // merusak laporan internal tidak membangunkan siapa pun tengah malam.
    if (args.strict && staged > 0) exitCode = 1;
  } catch (err) {
    console.error("Gagal menjalankan deteksi:", err.message);
    exitCode = 2;
  } finally {
    await pool.end();
  }
  process.exit(exitCode);
}

main();
