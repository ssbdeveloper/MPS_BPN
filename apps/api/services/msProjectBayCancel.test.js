// Kontrak jalur pembatalan reservasi bay (F3: B1 + B3).
//
// Kenapa test ini ada:
//   B1 — cancelBaySchedule sempat memakai `actorUserId` tanpa mendeklarasikannya. Setiap
//        panggilan melempar ReferenceError di dalam try, di-rollback, dan endpoint
//        DELETE /bay-schedules/:id selalu 500 tanpa ada test yang menyadarinya.
//   B3 — membatalkan baris jadwal yang check-in-nya masih terbuka memutus jalur operator
//        menyelesaikan pekerjaan. Penjaganya harus ada di server, di dalam transaksi yang
//        sama dengan UPDATE, di ketiga jalur yang bisa membatalkan baris.
//
// Tanpa DB: pool() membaca global.pool lebih dulu, jadi client palsu di bawah mencatat
// setiap query dan menjawab sesuai pola SQL-nya.
const test = require('node:test');
const assert = require('node:assert/strict');
const svc = require('./msProjectService');

const SCHEDULE_ID = '11111111-1111-4111-8111-111111111111';
const GROUP_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';

function scheduleRow(overrides = {}) {
  return {
    schedule_id: SCHEDULE_ID,
    schedule_group_id: GROUP_ID,
    project_id: null,
    task_id: 't1',
    order_no: '1000121250',
    booking_type: 'ORDER',
    area_code: 'AREA-13',
    bay_codes: ['B29E'],
    status: 'RESERVED',
    ...overrides,
  };
}

// `openCheckins` = baris yang dikembalikan query pemeriksa check-in terbuka.
function fakePool({ rows = [scheduleRow()], openCheckins = [] } = {}) {
  const log = [];
  const client = {
    async query(text, values) {
      const sql = String(text).replace(/\s+/g, ' ').trim();
      log.push({ sql, values });
      if (/longdate_checkout is null/i.test(sql)) return { rows: openCheckins };
      if (/^update ms_project_bay_schedule/i.test(sql)) return { rows };
      if (/^select \* from ms_project_bay_schedule/i.test(sql)) return { rows };
      return { rows: [] };
    },
    release() {},
  };
  return { log, pool: { connect: async () => client, query: client.query } };
}

function withPool(fake, fn) {
  const previous = global.pool;
  global.pool = fake.pool;
  return Promise.resolve().then(fn).finally(() => { global.pool = previous; });
}

const updates = (log) => log.filter((q) => /^update ms_project_bay_schedule/i.test(q.sql));
const statements = (log) => log.map((q) => q.sql.split(' ')[0].toLowerCase());

test('B1: cancelBaySchedule tidak lagi melempar ReferenceError dan meng-commit', async () => {
  const fake = fakePool();
  const result = await withPool(fake, () => svc.cancelBaySchedule(SCHEDULE_ID, { actor: 'tee', actor_user_id: 7 }));
  assert.equal(result.schedule_id, SCHEDULE_ID);
  assert.ok(statements(fake.log).includes('commit'), 'transaksi harus commit');
  assert.ok(!statements(fake.log).includes('rollback'));
});

test('B1: ID user sesi ikut tertulis ke updated_by_user_id', async () => {
  const fake = fakePool();
  await withPool(fake, () => svc.cancelBaySchedule(SCHEDULE_ID, { actor: 'tee', actor_user_id: 7 }));
  const [update] = updates(fake.log);
  assert.deepEqual(update.values, [SCHEDULE_ID, 'tee', 7]);
});

test('B1: actor_user_id bukan integer menjadi null, bukan teks bebas', async () => {
  const fake = fakePool();
  await withPool(fake, () => svc.cancelBaySchedule(SCHEDULE_ID, { actor: 'tee', actor_user_id: '7' }));
  assert.equal(updates(fake.log)[0].values[2], null);
});

// --- B3: penjaga check-in terbuka -------------------------------------------------------

const OPEN = [{ schedule_id: SCHEDULE_ID, tsnumber: 114905, operation_no: 230, checkin_at: '2026-09-23T11:54:27.000Z' }];

async function rejected(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('seharusnya ditolak');
}

test('B3: cancel per baris dengan check-in terbuka ditolak 409 OPEN_CHECKIN, tanpa UPDATE', async () => {
  const fake = fakePool({ openCheckins: OPEN });
  const error = await rejected(withPool(fake, () => svc.cancelBaySchedule(SCHEDULE_ID, { actor: 'tee' })));
  assert.equal(error.status, 409);
  assert.equal(error.code, 'OPEN_CHECKIN');
  assert.equal(error.details[0].tsnumber, 114905);
  assert.equal(updates(fake.log).length, 0, 'baris tidak boleh tersentuh');
  assert.ok(statements(fake.log).includes('rollback'));
});

test('B3: cancel per baris mengunci baris jadwal sebelum memeriksa check-in', async () => {
  const fake = fakePool();
  await withPool(fake, () => svc.cancelBaySchedule(SCHEDULE_ID, { actor: 'tee' }));
  const lockAt = fake.log.findIndex((q) => /for update/i.test(q.sql));
  const checkAt = fake.log.findIndex((q) => /longdate_checkout is null/i.test(q.sql));
  const updateAt = fake.log.findIndex((q) => /^update/i.test(q.sql));
  assert.ok(lockAt > -1 && lockAt < checkAt && checkAt < updateAt, 'urutan: lock -> periksa -> update');
});

test('B3: cancel per baris untuk baris yang tidak ada tetap 404', async () => {
  const fake = fakePool({ rows: [] });
  const error = await rejected(withPool(fake, () => svc.cancelBaySchedule(SCHEDULE_ID, { actor: 'tee' })));
  assert.equal(error.status, 404);
});

test('B3: cancel grup dengan satu baris check-in terbuka menolak SELURUH grup', async () => {
  const rows = [scheduleRow(), scheduleRow({ schedule_id: OTHER_ID, task_id: 't2' })];
  const fake = fakePool({ rows, openCheckins: OPEN });
  const error = await rejected(withPool(fake, () => svc.cancelBayScheduleGroup(GROUP_ID, { actor: 'tee' })));
  assert.equal(error.code, 'OPEN_CHECKIN');
  assert.equal(updates(fake.log).length, 0, 'tidak boleh ada pembatalan sebagian');
});

test('B3: cancel grup hanya memeriksa baris yang masih aktif', async () => {
  const rows = [scheduleRow(), scheduleRow({ schedule_id: OTHER_ID, task_id: 't2', status: 'CANCELLED' })];
  const fake = fakePool({ rows });
  await withPool(fake, () => svc.cancelBayScheduleGroup(GROUP_ID, { actor: 'tee' }));
  const check = fake.log.find((q) => /longdate_checkout is null/i.test(q.sql));
  assert.deepEqual(check.values[0], [SCHEDULE_ID]);
});

test('B3: cancel grup tanpa check-in terbuka tetap commit', async () => {
  const fake = fakePool();
  const result = await withPool(fake, () => svc.cancelBayScheduleGroup(GROUP_ID, { actor: 'tee' }));
  assert.equal(result.count, 1);
  assert.ok(statements(fake.log).includes('commit'));
});

// PUT grup yang MEMBUANG task juga membatalkan baris (soft-cancel). Tanpa penjaga di sini,
// "edit reservasi, hapus centang op 230" menjadi pintu belakang yang melewati B3.
const TASK_KEEP = '44444444-4444-4444-8444-444444444444';
const TASK_DROP = '55555555-5555-4555-8555-555555555555';

test('B3: PUT grup yang membuang task ber-check-in terbuka ditolak, tanpa pembatalan', async () => {
  const rows = [
    scheduleRow({ schedule_id: OTHER_ID, task_id: TASK_KEEP }),
    scheduleRow({ schedule_id: SCHEDULE_ID, task_id: TASK_DROP }),
  ];
  const fake = fakePool({ rows, openCheckins: OPEN });
  const error = await rejected(withPool(fake, () => svc.updateBayScheduleGroup(GROUP_ID, {
    actor: 'tee', tasks: [{ task_id: TASK_KEEP }],
  })));
  assert.equal(error.code, 'OPEN_CHECKIN');
  const check = fake.log.find((q) => /longdate_checkout is null/i.test(q.sql));
  assert.deepEqual(check.values[0], [SCHEDULE_ID], 'hanya baris yang DIBUANG yang diperiksa');
  assert.equal(fake.log.filter((q) => /set status = 'CANCELLED'/i.test(q.sql)).length, 0);
});

// --- B2: jumlah referensi timesheet per baris di daftar ---------------------------------

test('B2: listBaySchedules mengembalikan timesheet_ref_count & open_checkin_count sebagai angka', async () => {
  const log = [];
  global.pool = {
    query: async (text, values) => {
      log.push(String(text));
      return { rows: [{ schedule_id: SCHEDULE_ID, timesheet_ref_count: '3', open_checkin_count: '1' }] };
    },
  };
  try {
    const result = await svc.listBaySchedules({ order_no: '1000121250' });
    assert.match(log[0], /timesheet_ref_count/);
    assert.match(log[0], /open_checkin_count/);
    // COUNT(*) di pg datang sebagai string (int8). Kontrak ke UI = angka.
    assert.strictEqual(result.rows[0].timesheet_ref_count, 3);
    assert.strictEqual(result.rows[0].open_checkin_count, 1);
  } finally {
    delete global.pool;
  }
});
