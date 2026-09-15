"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeNfcRole } = require("./usernfcController");

test("normalizes current NFC roles", () => {
  assert.equal(normalizeNfcRole("SSB"), "SSB");
  assert.equal(normalizeNfcRole("outsource"), "OUTSOURCE");
  assert.equal(normalizeNfcRole("FOREMAN"), "FOREMAN");
  assert.equal(normalizeNfcRole("SUBCONT"), "SUBCONT");
});

test("maps legacy NFC roles during rollout", () => {
  assert.equal(normalizeNfcRole("USER"), "SSB");
  assert.equal(normalizeNfcRole("ADMINISTRATOR"), "OUTSOURCE");
});

test("rejects unknown roles but permits an empty role", () => {
  assert.equal(normalizeNfcRole("SUPERUSER"), null);
  assert.equal(normalizeNfcRole("unknown"), null);
  assert.equal(normalizeNfcRole(""), "");
});
