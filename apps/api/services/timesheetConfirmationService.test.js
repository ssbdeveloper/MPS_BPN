"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CLASSIFICATION_SQL,
  ConfirmationCheckoutError,
  assertRuntimeContext,
  createTimesheetConfirmationService,
  isProductiveRow,
} = require("./timesheetConfirmationService");

const sourceRow = {
  tsnumber: 10,
  serialnumber: "EMP-1",
  activitytype: null,
  order_no: "100001",
  operation_no: 10,
  operation_text: "WELDING",
  longdate_checkin: "2026-09-21T00:00:00.000Z",
  longdate_checkout: "2026-09-21T11:00:00.000Z",
};

const makeHarness = ({ plan, lockedRows = [sourceRow] }) => {
  const calls = [];
  let cloneId = 20;
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) return { rows: [] };
      if (normalized.includes("FROM public.plant_config")) {
        return { rows: [{ plant_code: "5100", timezone: "Asia/Jakarta" }] };
      }
      if (normalized.includes("FOR UPDATE")) return { rows: lockedRows };
      if (normalized.includes("FROM public.sap_staging_exclusion")) return { rows: [] };
      if (normalized.includes("FROM public.sap_staging_source")) return { rows: [] };
      if (normalized === "SELECT clock_timestamp() AS checkout_at") {
        return { rows: [{ checkout_at: sourceRow.longdate_checkout }] };
      }
      if (normalized.includes("WHERE tsnumber = ANY($1::int[])")
          && normalized.startsWith("UPDATE")) {
        return { rows: lockedRows.map((row) => ({ ...row })) };
      }
      if (sql === CLASSIFICATION_SQL) return { rows: [plan] };
      if (normalized.startsWith("UPDATE public.timesheet_transaction")) {
        return {
          rows: [{
            ...sourceRow,
            longdate_checkout: params[1],
            confirmationnumber: params[2],
          }],
        };
      }
      if (normalized.startsWith("INSERT INTO public.timesheet_transaction")) {
        return {
          rows: [{
            ...sourceRow,
            tsnumber: cloneId++,
            longdate_checkin: params[1],
            longdate_checkout: params[2],
            confirmationnumber: params[3],
          }],
        };
      }
      if (normalized.startsWith("WITH ordered AS")) {
        return {
          rows: [{
            segment_count: params[0].length,
            start_mismatch: false,
            end_mismatch: false,
            duration_mismatch: false,
            gap_count: 0,
            invalid_count: 0,
            bad_confirmation: 0,
            bad_clock: 0,
          }],
        };
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
    release() {
      calls.push({ sql: "RELEASE", params: [] });
    },
  };
  return {
    calls,
    pool: { connect: async () => client },
  };
};

test("runtime context fails closed when timezone differs", () => {
  assert.throws(
    () => assertRuntimeContext("Asia/Makassar", "5100", {
      plant_code: "5100",
      timezone: "Asia/Jakarta",
    }),
    (error) => error instanceof ConfirmationCheckoutError
      && error.code === "TIMEZONE_MISMATCH",
  );
});

test("productive detection preserves legacy unproductive rows", () => {
  assert.equal(isProductiveRow({ activitytype: "1510" }), false);
  assert.equal(isProductiveRow({ operation_text: "1510BRIEFING" }), false);
  assert.equal(isProductiveRow({ order_no: "100", operation_no: 10 }), true);
});

test("classifier SQL supports OV-RG-OV and all fail-closed guards", () => {
  assert.match(CLASSIFICATION_SQL, /SELECT 1, 'OV'/);
  assert.match(CLASSIFICATION_SQL, /SELECT\s+2,\s+'RG'/);
  assert.match(CLASSIFICATION_SQL, /SELECT 3, 'OV'/);
  assert.match(CLASSIFICATION_SQL, /PH3_AMBIGUOUS/);
  assert.match(CLASSIFICATION_SQL, /ROSTER_AMBIGUOUS/);
  assert.match(CLASSIFICATION_SQL, /OPERATOR_OVERLAP/);
});

test("checkout writes three exact segments and commits once", async () => {
  const plan = {
    tsnumber: 10,
    confirmation_base: "700001",
    block_reason: null,
    segments: [
      { suffix: "OV", start: sourceRow.longdate_checkin, end: "2026-09-21T01:00:00.000Z" },
      { suffix: "RG", start: "2026-09-21T01:00:00.000Z", end: "2026-09-21T10:00:00.000Z" },
      { suffix: "OV", start: "2026-09-21T10:00:00.000Z", end: sourceRow.longdate_checkout },
    ],
  };
  const harness = makeHarness({ plan });
  const service = createTimesheetConfirmationService({
    pool: harness.pool,
    timezone: "Asia/Jakarta",
    plant: "5100",
  });

  const rows = await service.checkoutById(10);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].confirmationnumber, "700001OV");
  const writes = harness.calls.filter(({ sql }) =>
    String(sql).replace(/\s+/g, " ").trim()
      .match(/^(UPDATE|INSERT INTO) public\.timesheet_transaction/));
  assert.deepEqual(
    writes.slice(-3).map(({ params }) => params[params.length === 4 ? 2 : 3]),
    ["700001OV", "700001RG", "700001OV"],
  );
  assert.equal(harness.calls.filter(({ sql }) => sql === "COMMIT").length, 1);
  assert.equal(harness.calls.filter(({ sql }) => sql === "ROLLBACK").length, 0);
});

test("blocked classification rolls the checkout back before segment writes", async () => {
  const harness = makeHarness({
    plan: {
      tsnumber: 10,
      confirmation_base: null,
      block_reason: "ROSTER_MISSING",
      segments: [],
    },
  });
  const service = createTimesheetConfirmationService({
    pool: harness.pool,
    timezone: "Asia/Jakarta",
    plant: "5100",
  });

  await assert.rejects(
    service.checkoutById(10),
    (error) => error instanceof ConfirmationCheckoutError
      && error.code === "ROSTER_MISSING",
  );

  assert.equal(harness.calls.filter(({ sql }) => sql === "COMMIT").length, 0);
  assert.equal(harness.calls.filter(({ sql }) => sql === "ROLLBACK").length, 1);
  assert.equal(harness.calls.some(({ sql }) =>
    String(sql).replace(/\s+/g, " ").trim()
      .startsWith("INSERT INTO public.timesheet_transaction")), false);
});

test("retry after checkout returns no rows and creates no new segment", async () => {
  const harness = makeHarness({ plan: null, lockedRows: [] });
  const service = createTimesheetConfirmationService({
    pool: harness.pool,
    timezone: "Asia/Jakarta",
    plant: "5100",
  });

  assert.deepEqual(await service.checkoutById(10), []);
  assert.equal(harness.calls.filter(({ sql }) => sql === "ROLLBACK").length, 1);
  assert.equal(harness.calls.some(({ sql }) => String(sql).includes("INSERT INTO")), false);
});

test("nonproductive checkout stays without a confirmation number", async () => {
  const nonproductive = {
    ...sourceRow,
    activitytype: "1510",
    order_no: null,
    operation_no: null,
  };
  const harness = makeHarness({ plan: null, lockedRows: [nonproductive] });
  const service = createTimesheetConfirmationService({
    pool: harness.pool,
    timezone: "Asia/Jakarta",
    plant: "5100",
  });

  const rows = await service.checkoutBySerial("EMP-1");

  assert.equal(rows.length, 1);
  assert.equal(rows[0].confirmationnumber, undefined);
  assert.equal(harness.calls.some(({ sql }) => sql === CLASSIFICATION_SQL), false);
  assert.equal(harness.calls.filter(({ sql }) => sql === "COMMIT").length, 1);
});
