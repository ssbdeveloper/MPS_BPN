'use strict';

// One-shot production cleanup for sow_operation_task_map order drift.
//
// Background:
//   VBA sync writes Task.Text1 back to ms_project_task.order_no. The mapping table
//   keeps its original order_key. Once those values differ, one task cannot belong
//   to both orders, so the mapping is unsafe and must be detached for conscious remap.
//
// Safety:
//   - dry-run by default; pass --apply to mutate
//   - fail closed unless exactly EXPECTED_ROWS are found
//   - JSON backup written before BEGIN/DELETE
//   - DELETE predicate repeats the same mismatch test
//   - transaction verifies zero order mismatches remain before COMMIT
//
// Operation-only differences are intentionally NOT deleted. Production has valid
// legacy mappings to tasks whose operation_no is blank (rework/cutting/inspection).
// Treating all 62 order-or-operation differences as corruption would delete 40
// valid assignments. This script removes only the 22 order mismatches.

const fs = require('node:fs');
const path = require('node:path');
const db = require('../../apps/api/db');

const EXPECTED_ROWS = 22;
const apply = process.argv.includes('--apply');
const backupDir = process.env.MAPPING_DRIFT_BACKUP_DIR
  || path.join(__dirname, 'backups');

const ORDER_MISMATCH = `
  ltrim(m.order_key, '0') is distinct from
  ltrim(coalesce(t.order_no, ''), '0')
`;

async function main() {
  const client = await db.pool.connect();
  try {
    const drift = await client.query(`
      select m.order_key, m.operation_key, m.project_id, m.task_id, m.sow_id,
             m.mapped_by, m.mapped_at,
             t.order_no as task_order_no, t.operation_no as task_operation_no,
             t.outline_number, t.task_name,
             p.project_name
      from sow_operation_task_map m
      join ms_project_task t on t.task_id = m.task_id
      left join ms_project p on p.project_id = t.project_id
      where ${ORDER_MISMATCH}
      order by p.project_name, m.order_key, m.operation_key
    `);

    if (drift.rowCount !== EXPECTED_ROWS) {
      throw new Error(
        `Refusing cleanup: expected ${EXPECTED_ROWS} order-drift rows, found ${drift.rowCount}. `
        + 'Re-audit production before changing EXPECTED_ROWS.'
      );
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `${stamp}-sow-operation-task-map-order-drift.json`);
    fs.writeFileSync(backupPath, `${JSON.stringify({
      created_at: new Date().toISOString(),
      expected_rows: EXPECTED_ROWS,
      rows: drift.rows,
    }, null, 2)}\n`, { flag: 'wx' });

    console.log(`Backup: ${backupPath}`);
    console.log(`Order-drift rows: ${drift.rowCount}`);

    if (!apply) {
      console.log('DRY RUN — no rows deleted. Re-run with --apply after reviewing backup.');
      return;
    }

    await client.query('begin');
    const removed = await client.query(`
      delete from sow_operation_task_map m
      using ms_project_task t
      where t.task_id = m.task_id
        and ${ORDER_MISMATCH}
      returning m.order_key, m.operation_key, m.project_id, m.task_id
    `);

    if (removed.rowCount !== EXPECTED_ROWS) {
      throw new Error(
        `Delete count changed inside transaction: expected ${EXPECTED_ROWS}, got ${removed.rowCount}`
      );
    }

    const remaining = await client.query(`
      select count(*)::int as count
      from sow_operation_task_map m
      join ms_project_task t on t.task_id = m.task_id
      where ${ORDER_MISMATCH}
    `);
    if (remaining.rows[0].count !== 0) {
      throw new Error(`${remaining.rows[0].count} order-drift rows remain; rolling back`);
    }

    await client.query('commit');
    console.log(`COMMITTED — detached ${removed.rowCount} unsafe mappings; 0 order drift remains.`);
  } catch (error) {
    try { await client.query('rollback'); } catch { /* transaction may not have started */ }
    throw error;
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exit(1);
  });
