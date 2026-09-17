"use strict";

// Regresi: GET /sow/operations/:idsow/subtasks pernah 500 dengan
// "invalid input syntax for type integer: \"sap-auto\"" (22P02).
//
// Penyebab: JOIN resolver nama memakai `cu.id = s.created_by::int` dengan penjaga
// regex di JOIN yang sama. Postgres TIDAK menjamin penjaga dievaluasi lebih dulu,
// jadi baris autoseed SAP (created_by = 'sap-auto') ikut dicast ke integer dan
// seluruh endpoint gagal — sub-task tidak pernah tampil di halaman progress update.
//
// Perbaikan: bandingkan sebagai TEXT (`cu.id::text = s.created_by`). Tidak ada cast
// dari kolom teks ke integer, jadi nilai non-numerik cukup tidak match (NULL join)
// dan CASE ... ~ '^\d+$' tetap mengembalikan string aslinya.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const controller = fs.readFileSync(path.join(__dirname, "sowController.js"), "utf8");

const getSubtasksSql = (() => {
  const start = controller.indexOf("exports.getSubtasks");
  assert.notEqual(start, -1, "exports.getSubtasks tidak ditemukan");
  const end = controller.indexOf("exports.createSubtask", start);
  return controller.slice(start, end === -1 ? undefined : end);
})();

test("resolver nama sub-task tidak pernah mengecast created_by/updated_by ke integer", () => {
  assert.doesNotMatch(getSubtasksSql, /created_by::int\b/);
  assert.doesNotMatch(getSubtasksSql, /updated_by::int\b/);
});

test("resolver nama sub-task membandingkan users.id sebagai teks", () => {
  assert.match(getSubtasksSql, /LEFT JOIN public\.users cu ON cu\.id::text = s\.created_by/);
  assert.match(getSubtasksSql, /LEFT JOIN public\.users uu ON uu\.id::text = s\.updated_by/);
});

test("baris lama dengan id numerik tetap ditampilkan sebagai nama", () => {
  assert.match(getSubtasksSql, /CASE WHEN s\.created_by ~ '\^\\\\d\+\$' THEN cu\.name ELSE s\.created_by END AS created_by/);
  assert.match(getSubtasksSql, /CASE WHEN s\.updated_by ~ '\^\\\\d\+\$' THEN uu\.name ELSE s\.updated_by END AS updated_by/);
});
