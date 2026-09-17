'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// RED first: numeric SAP order searches must take an indexed equality path, while
// part name / part number / workcenter searches retain the broad contains search.
const { classifySowOrderSearch } = require('./msProjectService');

test('10-digit SAP order uses exact normalized-order lookup', () => {
  assert.deepEqual(classifySowOrderSearch('1000132018'), {
    mode: 'exact_order',
    value: '1000132018',
  });
});

test('zero-padded SAP order uses exact normalized-order lookup', () => {
  assert.deepEqual(classifySowOrderSearch('0001000132018'), {
    mode: 'exact_order',
    value: '0001000132018',
  });
});

test('short numeric operation search remains broad', () => {
  assert.deepEqual(classifySowOrderSearch('120'), {
    mode: 'broad',
    value: '120',
  });
});

test('part name and part number searches remain broad', () => {
  assert.deepEqual(classifySowOrderSearch('SB10115AC'), {
    mode: 'broad',
    value: 'sb10115ac',
  });
  assert.deepEqual(classifySowOrderSearch('rock bucket'), {
    mode: 'broad',
    value: 'rock bucket',
  });
});

test('empty search does not add a predicate', () => {
  assert.deepEqual(classifySowOrderSearch('  '), {
    mode: 'none',
    value: '',
  });
});
