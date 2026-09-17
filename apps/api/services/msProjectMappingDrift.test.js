"use strict";

// B2 — mapping drift detector.
//
// Sync menulis Task.Text1/Text2 dari file .mpp ke kolom order_no/operation_no tanpa
// melihat sow_operation_task_map. Identitas task bisa bergeser sementara baris mapping
// tetap menunjuk task itu, dan sebelum ini tidak ada yang melaporkannya: summary sync
// hanya punya orphaned_mappings, yang HANYA memuat task yang DINONAKTIFKAN.
// Terukur di prod 2026-09-17: 22 baris drift menumpuk tanpa satu pun peringatan.

const test = require("node:test");
const assert = require("node:assert");

const { diffMappedTaskIdentity } = require("./msProjectService.js");

const snapshot = (rows) => new Map(rows.map((r) => [r.task_id, r]));

test("melaporkan task ber-mapping yang order_no-nya ditimpa sync", () => {
  // Kasus nyata: map bilang order 1000132018 op 20, tapi sync menulis ulang task
  // itu jadi milik order 1000132024 (UNIT 2). Mapping tertinggal menggantung.
  const before = snapshot([{
    task_id: "t1", order_key: "1000132018", operation_key: 20,
    order_no: "1000132018", operation_no: "20",
    task_name: "LASER CUTTING", outline_number: "2.2.1.1",
  }]);
  const after = [{
    task_id: "t1", order_no: "1000132024", operation_no: "20",
    task_name: "LASER CUTTING", outline_number: "2.2.1.1",
  }];

  const drift = diffMappedTaskIdentity(before, after);

  assert.equal(drift.length, 1);
  assert.equal(drift[0].order_no_before, "1000132018");
  assert.equal(drift[0].order_no_after, "1000132024");
  assert.equal(drift[0].order_key, "1000132018");
  assert.equal(drift[0].outline_number, "2.2.1.1");
});

test("melaporkan perubahan operation_no", () => {
  const before = snapshot([{
    task_id: "t1", order_key: "100", operation_key: 20,
    order_no: "100", operation_no: "20", task_name: "X", outline_number: "1.1",
  }]);
  const after = [{ task_id: "t1", order_no: "100", operation_no: "30", task_name: "X", outline_number: "1.1" }];

  const drift = diffMappedTaskIdentity(before, after);

  assert.equal(drift.length, 1);
  assert.equal(drift[0].operation_no_before, "20");
  assert.equal(drift[0].operation_no_after, "30");
});

test("leading zero BUKAN drift: '0020' dan '20' adalah operasi yang sama", () => {
  // Penting: tanpa normalisasi, setiap sync akan melaporkan ratusan drift palsu
  // hanya karena beda ejaan, dan laporan yang berisik akan diabaikan orang.
  const before = snapshot([{
    task_id: "t1", order_key: "100", operation_key: 20,
    order_no: "0000100", operation_no: "0020", task_name: "X", outline_number: "1.1",
  }]);
  const after = [{ task_id: "t1", order_no: "100", operation_no: "20", task_name: "X", outline_number: "1.1" }];

  assert.deepEqual(diffMappedTaskIdentity(before, after), []);
});

test("task tanpa perubahan identitas tidak dilaporkan", () => {
  const before = snapshot([{
    task_id: "t1", order_key: "100", operation_key: 20,
    order_no: "100", operation_no: "20", task_name: "X", outline_number: "1.1",
  }]);
  const after = [{ task_id: "t1", order_no: "100", operation_no: "20", task_name: "X", outline_number: "1.1" }];

  assert.deepEqual(diffMappedTaskIdentity(before, after), []);
});

test("task yang tidak punya mapping diabaikan", () => {
  // Task biasa berubah order_no adalah hal normal — hanya task ber-mapping yang menarik.
  const drift = diffMappedTaskIdentity(new Map(), [
    { task_id: "bebas", order_no: "999", operation_no: "10", task_name: "Y", outline_number: "3.1" },
  ]);

  assert.deepEqual(drift, []);
});

test("operation_no null <-> terisi terdeteksi sebagai drift", () => {
  const before = snapshot([{
    task_id: "t1", order_key: "100", operation_key: 50,
    order_no: "100", operation_no: "50", task_name: "READY TO SHIPMENT", outline_number: "2.2.6",
  }]);
  const after = [{ task_id: "t1", order_no: "100", operation_no: null, task_name: "READY TO SHIPMENT", outline_number: "2.2.6" }];

  const drift = diffMappedTaskIdentity(before, after);

  assert.equal(drift.length, 1);
  assert.equal(drift[0].operation_no_after, null);
});
