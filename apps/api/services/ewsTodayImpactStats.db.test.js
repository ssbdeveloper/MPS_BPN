"use strict";

// Tes PostgreSQL NYATA untuk statistik dampak preview hari ini (spec §7.4).
// Menjalankan SQL produksi yang sama (queryTodayImpactStats / previewDeleteOverrideById)
// terhadap database lab terisolasi. Bukan mock agregat.
//
// Opt-in: set EWS_LAB_DB=mps2_test_ews_shift_override (host loopback). Tanpa env ini tes
// di-skip agar `npm test` di mesin tanpa lab tidak gagal palsu. Database dari .env aplikasi
// TIDAK pernah dipakai.
//
// Isolasi: setiap tes berjalan dalam satu transaksi yang SELALU di-ROLLBACK (termasuk DDL
// fixture public.timesheet_transaction), sehingga lab tidak berubah.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const LAB_DB = process.env.EWS_LAB_DB || "";
const LAB_HOST = process.env.EWS_LAB_HOST || "127.0.0.1";
const LAB_PORT = Number(process.env.EWS_LAB_PORT || 5432);
const LAB_USER = process.env.EWS_LAB_USER || "postgres";
const SKIP = !LAB_DB
  ? "EWS_LAB_DB tidak di-set (tes PostgreSQL lab bersifat opt-in)"
  : false;

const PLANT_TZ = "Asia/Jakarta"; // UTC+7, sengaja berbeda dari session TimeZone UTC
const BD = "2026-10-01";

// Kolom diturunkan dari database/schema/schema_prod.sql (subset yang dibaca query + NOT NULL).
const TIMESHEET_DDL = `
  CREATE TABLE IF NOT EXISTS public.timesheet_transaction (
    tsnumber integer NOT NULL,
    serialnumber text,
    longdate_checkin timestamp with time zone,
    longdate_checkout timestamp with time zone,
    state_flag smallint DEFAULT 1,
    duration numeric
  )`;

function assertLabTarget() {
  if (!["127.0.0.1", "localhost", "::1"].includes(LAB_HOST)) {
    throw new Error(`GUARD: EWS_LAB_HOST harus loopback, bukan ${LAB_HOST}`);
  }
  if (!/^mps2_test/.test(LAB_DB)) {
    throw new Error(`GUARD: EWS_LAB_DB harus ber-prefix mps2_test, bukan ${LAB_DB}`);
  }
}

// Waktu dinding plant (WIB) -> literal timestamptz eksplisit, tidak bergantung session TZ.
const wib = (date, hhmm) => `${date} ${hhmm}:00+07`;

let tsSeq = 1;
async function tx(client, serial, checkin, checkout, { stateFlag = 1, duration } = {}) {
  let dur = duration;
  if (dur === undefined) {
    dur = checkout ? (new Date(checkout.replace(" ", "T").replace("+07", "+07:00")) -
      new Date(checkin.replace(" ", "T").replace("+07", "+07:00"))) / 3600000 : null;
  }
  await client.query(
    `INSERT INTO public.timesheet_transaction
       (tsnumber, serialnumber, longdate_checkin, longdate_checkout, state_flag, duration)
     VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5, $6)`,
    [tsSeq++, serial, checkin, checkout, stateFlag, dur]
  );
}

async function roster(client, serial, shift, { status = "SCHEDULED", override = null, date = BD } = {}) {
  await client.query(
    `INSERT INTO ews.shift_roster (serialnumber, business_date, scheduled_shift, status, shift_override)
     VALUES ($1, $2::date, $3, $4, $5)`,
    [serial, date, shift, status, override]
  );
}

async function setKnownDefaults(client) {
  // Pin master default agar window terhitung deterministik; di-ROLLBACK di akhir tes.
  await client.query(`DELETE FROM public.shift_definition WHERE is_default = false AND effective_date IN ($1::date, $2::date)`, [BD, "2026-10-05"]);
  const r = await client.query(
    `SELECT roster_shift_code, start_time::text, end_time::text, crosses_midnight
       FROM public.shift_definition WHERE is_default = true AND is_active = true
      ORDER BY roster_shift_code`
  );
  const byCode = Object.fromEntries(r.rows.map((x) => [x.roster_shift_code, x]));
  assert.deepEqual(
    { s: byCode.DAY?.start_time, e: byCode.DAY?.end_time, x: byCode.DAY?.crosses_midnight },
    { s: "07:25:00", e: "16:30:00", x: false },
    "fixture lab: default DAY harus 07:25-16:30"
  );
  assert.deepEqual(
    { s: byCode.NIGHT?.start_time, e: byCode.NIGHT?.end_time, x: byCode.NIGHT?.crosses_midnight },
    { s: "16:30:00", e: "00:30:00", x: true },
    "fixture lab: default NIGHT harus 16:30-00:30 (+1)"
  );
}

describe("Statistik dampak preview hari ini — PostgreSQL nyata", { skip: SKIP }, () => {
  let client;
  const svc = require("./ewsShiftOverrideService");

  before(async () => {
    assertLabTarget();
    process.env.TIMEZONE = PLANT_TZ;
    client = new Client({ host: LAB_HOST, port: LAB_PORT, user: LAB_USER, database: LAB_DB });
    await client.connect();
    const guardSql = fs.readFileSync(
      path.join(__dirname, "../../../database/tests/timesheet/_guard_not_production.sql"), "utf8"
    );
    await client.query(guardSql);
  });

  after(async () => {
    if (client) await client.end().catch(() => {});
  });

  async function inRolledBackTx(fn) {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL TimeZone = 'UTC'");
      await client.query(TIMESHEET_DDL);
      await client.query("DELETE FROM public.timesheet_transaction");
      await client.query("DELETE FROM ews.shift_roster WHERE business_date BETWEEN '2026-09-29' AND '2026-10-06'");
      await setKnownDefaults(client);
      await fn();
    } finally {
      await client.query("ROLLBACK");
    }
  }

  // now = 2026-10-01 16:00 WIB (09:00Z) — saat shift DAY sedang berjalan.
  const NOW = wib(BD, "16:00");

  async function seedMain() {
    // --- DAY (window 07:25-16:30 WIB) ---
    await roster(client, "A", "DAY");          // transaksi di dalam window
    await tx(client, "A", wib(BD, "08:00"), wib(BD, "12:00"));
    await roster(client, "B", "DAY");          // transaksi hanya di luar window (+batas tepat)
    await tx(client, "B", wib(BD, "05:00"), wib(BD, "07:25")); // berakhir TEPAT di ws -> tidak beririsan
    await tx(client, "B", wib(BD, "16:30"), wib(BD, "20:00")); // mulai TEPAT di we -> tidak beririsan
    await tx(client, "B", wib("2026-09-30", "08:00"), wib("2026-09-30", "16:00")); // hari sebelumnya
    await roster(client, "C", "DAY");          // mulai sebelum window tapi beririsan
    await tx(client, "C", wib(BD, "06:00"), wib(BD, "08:00"));
    await roster(client, "D", "DAY");          // beberapa transaksi milik operator sama
    await tx(client, "D", wib(BD, "07:30"), wib(BD, "09:00"));
    await tx(client, "D", wib(BD, "09:00"), wib(BD, "11:00"));
    await tx(client, " D ", wib(BD, "11:00"), wib(BD, "12:00")); // serialnumber ber-spasi, di-trim
    await roster(client, "E", "DAY");          // transaksi terbuka (checkout NULL) di dalam window
    await tx(client, "E", wib(BD, "15:00"), null, { duration: null });
    await roster(client, "F", "DAY");          // hanya transaksi tidak valid
    await tx(client, "F", wib(BD, "08:00"), wib(BD, "10:00"), { stateFlag: 5 }); // state_flag 5
    await tx(client, "F", wib(BD, "10:00"), wib(BD, "10:00"), { duration: 0 }); // durasi 0 tertutup
    await tx(client, "F", wib("2026-09-30", "10:00"), null, { duration: null }); // terbuka basi: cap 12 jam
    await roster(client, "G", "DAY", { status: "LEAVE" }); // non-SCHEDULED, punya transaksi
    await tx(client, "G", wib(BD, "08:00"), wib(BD, "12:00"));
    await roster(client, "G2", "DAY", { status: "OFF" });  // non-SCHEDULED, tanpa transaksi
    await roster(client, "Z", "DAY", { date: "2026-10-02" }); // tanggal lain, tidak dihitung
    await tx(client, "U", wib(BD, "08:00"), wib(BD, "12:00")); // bukan anggota roster

    // --- NIGHT (window 16:30 WIB 10-01 s.d. 00:30 WIB 10-02) ---
    await roster(client, "H", "NIGHT");        // transaksi melewati tengah malam
    await tx(client, "H", wib(BD, "23:00"), wib("2026-10-02", "01:00"));
    await roster(client, "I", "NIGHT");        // hanya setelah window berakhir (masih < 48 jam)
    await tx(client, "I", wib("2026-10-02", "00:30"), wib("2026-10-02", "03:00"));
    await roster(client, "J", "NIGHT");        // sepenuhnya setelah tengah malam, di dalam window
    await tx(client, "J", wib("2026-10-02", "00:00"), wib("2026-10-02", "00:20"));
    await roster(client, "K", "DAY", { override: "NIGHT" }); // eff_shift = NIGHT, tanpa transaksi
    await tx(client, "A", wib(BD, "18:00"), wib(BD, "19:00")); // A (DAY) bertransaksi di window NIGHT
  }

  it("DAY: operator unik SCHEDULED, irisan window [ws, we), transaksi valid", async () => {
    await inRolledBackTx(async () => {
      await seedMain();
      const s = await svc.queryTodayImpactStats(client, BD, "DAY", { timezone: PLANT_TZ, nowTs: NOW });
      assert.equal(s.stats_status, "available", s.stats_error);
      assert.equal(new Date(s.window_start).toISOString(), "2026-10-01T00:25:00.000Z");
      assert.equal(new Date(s.window_end).toISOString(), "2026-10-01T09:30:00.000Z");
      // SCHEDULED DAY: A B C D E F (G=LEAVE, G2=OFF, K eff NIGHT, Z tanggal lain)
      assert.equal(s.scheduled_operators, 6);
      // Beririsan: A (dalam), C (mulai sebelum), D (3 transaksi -> 1), E (terbuka)
      // Tidak: B (hanya luar/batas), F (tidak valid / terbuka basi), G (non-SCHEDULED), U (bukan roster)
      assert.equal(s.operators_with_records, 4);
    });
  });

  it("NIGHT: window melewati tengah malam di timezone plant; batas akhir eksklusif", async () => {
    await inRolledBackTx(async () => {
      await seedMain();
      const s = await svc.queryTodayImpactStats(client, BD, "NIGHT", {
        timezone: PLANT_TZ, nowTs: wib("2026-10-02", "06:00"),
      });
      assert.equal(s.stats_status, "available", s.stats_error);
      assert.equal(new Date(s.window_start).toISOString(), "2026-10-01T09:30:00.000Z");
      assert.equal(new Date(s.window_end).toISOString(), "2026-10-01T17:30:00.000Z");
      // SCHEDULED NIGHT: H I J K(shift_override)
      assert.equal(s.scheduled_operators, 4);
      // H (lintas tengah malam) dan J (setelah tengah malam) beririsan; I mulai TEPAT di we;
      // K tanpa transaksi; A bertransaksi di window ini tetapi bukan roster NIGHT.
      assert.equal(s.operators_with_records, 2);
    });
  });

  it("override aktif pada business_date menggeser window efektif", async () => {
    await inRolledBackTx(async () => {
      await seedMain();
      await client.query(
        `INSERT INTO public.shift_definition
           (shift_code, shift_name, roster_shift_code, effective_date, is_default,
            start_time, end_time, crosses_midnight, default_capacity_hours, standard_hours, is_active)
         SELECT shift_code, shift_name, 'DAY', $1::date, false, '10:00', '14:00', false, 4, 4, true
           FROM public.shift_definition WHERE is_default = true AND roster_shift_code = 'DAY'`,
        [BD]
      );
      const s = await svc.queryTodayImpactStats(client, BD, "DAY", { timezone: PLANT_TZ, nowTs: NOW });
      assert.equal(s.stats_status, "available", s.stats_error);
      assert.equal(new Date(s.window_start).toISOString(), "2026-10-01T03:00:00.000Z");
      assert.equal(new Date(s.window_end).toISOString(), "2026-10-01T07:00:00.000Z");
      assert.equal(s.scheduled_operators, 6);
      // Window 10:00-14:00: A (08-12) dan D (09-11, 11-12) beririsan; C (06-08) dan E (15:00) tidak.
      assert.equal(s.operators_with_records, 2);
    });
  });

  it("nol yang sah: tidak ada roster pada business_date -> 0/0 dengan status available", async () => {
    await inRolledBackTx(async () => {
      await seedMain();
      const s = await svc.queryTodayImpactStats(client, "2026-10-05", "DAY", { timezone: PLANT_TZ, nowTs: NOW });
      assert.equal(s.stats_status, "available", s.stats_error);
      assert.equal(s.scheduled_operators, 0);
      assert.equal(s.operators_with_records, 0);
    });
  });

  it("nol yang sah: operator SCHEDULED tanpa transaksi beririsan -> records 0 (bukan null)", async () => {
    await inRolledBackTx(async () => {
      await roster(client, "B", "DAY");
      await tx(client, "B", wib(BD, "05:00"), wib(BD, "07:25"));
      const s = await svc.queryTodayImpactStats(client, BD, "DAY", { timezone: PLANT_TZ, nowTs: NOW });
      assert.equal(s.stats_status, "available", s.stats_error);
      assert.equal(s.scheduled_operators, 1);
      assert.equal(s.operators_with_records, 0);
    });
  });

  it("kegagalan query -> unavailable + null, transaksi pemanggil tetap dapat dipakai", async () => {
    await inRolledBackTx(async () => {
      await seedMain();
      await client.query("ALTER TABLE public.timesheet_transaction RENAME TO timesheet_transaction_hidden");
      const s = await svc.queryTodayImpactStats(client, BD, "DAY", { timezone: PLANT_TZ, nowTs: NOW });
      assert.equal(s.stats_status, "unavailable");
      assert.equal(s.scheduled_operators, null);
      assert.equal(s.operators_with_records, null);
      assert.match(s.stats_error, /timesheet_transaction/);
      // SAVEPOINT memastikan transaksi luar (mis. BEGIN READ ONLY preview apply) tidak ter-abort.
      const ok = await client.query("SELECT 1 AS one");
      assert.equal(ok.rows[0].one, 1);
    });
  });

  it("wiring: previewDeleteOverrideById memakai statistik window yang sama (tanggal plant aktual)", async () => {
    await inRolledBackTx(async () => {
      const plantToday = await svc.getPlantToday(client);
      await client.query(`DELETE FROM public.shift_definition WHERE is_default = false AND effective_date = $1::date`, [plantToday]);
      const ins = await client.query(
        `INSERT INTO public.shift_definition
           (shift_code, shift_name, roster_shift_code, effective_date, is_default,
            start_time, end_time, crosses_midnight, default_capacity_hours, standard_hours, is_active)
         SELECT shift_code, shift_name, 'DAY', $1::date, false, '09:00', '13:00', false, 4, 4, true
           FROM public.shift_definition WHERE is_default = true AND roster_shift_code = 'DAY'
         RETURNING id`,
        [plantToday]
      );
      await client.query("DELETE FROM ews.shift_roster WHERE business_date = $1::date", [plantToday]);
      await roster(client, "P1", "DAY", { date: plantToday });
      await roster(client, "P2", "DAY", { date: plantToday });
      await roster(client, "P3", "DAY", { date: plantToday, status: "SICK" });
      await tx(client, "P1", wib(plantToday, "10:00"), wib(plantToday, "11:00"));
      await tx(client, "P1", wib(plantToday, "11:00"), wib(plantToday, "12:00"));
      await tx(client, "P2", wib(plantToday, "13:00"), wib(plantToday, "15:00")); // mulai tepat di we
      await tx(client, "P3", wib(plantToday, "10:00"), wib(plantToday, "11:00"));

      const preview = await svc.previewDeleteOverrideById(client, Number(ins.rows[0].id));
      assert.equal(preview.affects_today, true);
      assert.equal(preview.today.stats_status, "available", preview.today.stats_error);
      assert.equal(preview.today.scheduled_operators, 2);
      assert.equal(preview.today.operators_with_records, 1);
    });
  });
  it("wiring: previewDateRange (APPLY) memakai window efektif SAAT preview, tanpa melihat window usulan", async () => {
    await inRolledBackTx(async () => {
      const plantToday = await svc.getPlantToday(client);
      await client.query(`DELETE FROM public.shift_definition WHERE is_default = false AND effective_date BETWEEN ($1::date - 1) AND ($1::date + 1)`, [plantToday]);
      await client.query("DELETE FROM public.sow_machine_capacity");
      await client.query("DELETE FROM public.sow_schedule");
      await client.query("DELETE FROM public.sow_schedule_batch");
      await client.query("DELETE FROM public.sow_overtime_request");
      await client.query("DELETE FROM ews.shift_roster WHERE business_date = $1::date", [plantToday]);
      await roster(client, "Q1", "DAY", { date: plantToday });
      await roster(client, "Q2", "DAY", { date: plantToday });
      await roster(client, "Q3", "DAY", { date: plantToday, status: "PERMIT" });
      // Default DAY 07:25-16:30. Q1 beririsan dengan window default; Q2 hanya beririsan dengan
      // window BARU yang diajukan (05:00-13:00) -> tidak dihitung, karena statistik memakai window
      // efektif saat preview (sebelum perubahan).
      await tx(client, "Q1", wib(plantToday, "07:00"), wib(plantToday, "07:30"));
      await tx(client, "Q2", wib(plantToday, "05:00"), wib(plantToday, "06:00"));
      await tx(client, "Q3", wib(plantToday, "08:00"), wib(plantToday, "09:00"));

      const preview = await svc.previewDateRange(client, {
        from: plantToday, to: plantToday,
        shifts: [{ shift_code: "DAY", start_time: "05:00", end_time: "13:00", crosses_midnight: false, standard_hours: 7 }],
      });
      const item = preview.items.find((it) => it.date === plantToday && it.shift_code === "DAY");
      assert.ok(item && item.today, "item hari ini harus ada");
      assert.equal(item.today.stats_status, "available", item.today.stats_error);
      assert.equal(item.today.scheduled_operators, 2);
      assert.equal(item.today.operators_with_records, 1);
    });
  });
});
