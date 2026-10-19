const db = global.pool || require("../db");

exports.getAll = async (req, res) => {
  const { sn, workcenter } = req.query;
  let result;
  if (sn) {
    result = await pool.query(
      'SELECT * FROM processcontroldata WHERE snssb = $1 ORDER BY id_processcontroldata DESC',
      [sn]
    );
  } else if (workcenter) {
    result = await pool.query(
      'SELECT * FROM processcontroldata WHERE workcenter = $1 ORDER BY id_processcontroldata DESC',
      [workcenter]
    );
  } else {
    result = await pool.query(
      'SELECT * FROM processcontroldata ORDER BY id_processcontroldata DESC'
    );
  }
  res.json(result.rows);
};


// GET /process-control/by-sn/:sn
exports.getBySN = async (req, res) => {
  const { sn } = req.params;
  const result = await pool.query(
    'SELECT * FROM processcontroldata WHERE snssb = $1 ORDER BY id_processcontroldata DESC',
    [sn]
  );
  res.json(result.rows);
};

// GET /process-control/by-wct/:workcenter
exports.getByWCT = async (req, res) => {
  const { workcenter } = req.params;
  const result = await pool.query(
    'SELECT * FROM processcontroldata WHERE workcenter = $1 ORDER BY id_processcontroldata DESC',
    [workcenter]
  );
  res.json(result.rows);
};


exports.create = async (req, res) => {
  const { snssb, full_name, production_order, ssbr_id, operation_text, operation_no,
          machineid, workcenter, validation_status, validation_date, validation_by, tsnumber } = req.body;
  const result = await pool.query(
    `INSERT INTO processcontroldata
    (snssb, full_name, production_order, ssbr_id, operation_text, operation_no, machineid,
     workcenter, validation_status, validation_date, validation_by, tsnumber)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [snssb, full_name, production_order, ssbr_id, operation_text, operation_no,
     machineid, workcenter, validation_status, validation_date, validation_by, tsnumber]
  );
  res.json(result.rows[0]);
};

exports.validate = async (req, res) => {
  const { id } = req.params;
  const { validation_by, validation_status } = req.body;
  const result = await pool.query(
    `UPDATE processcontroldata
     SET validation_status = $1,
         validation_by = $2,
         validation_date = NOW()
     WHERE id_processcontroldata = $3
     RETURNING *`,
    [validation_status, validation_by, id]
  );
  res.json(result.rows[0]);
};

exports.update = async (req, res) => {
  const { id } = req.params;
  const { validation_by, validation_status } = req.body;
  const result = await pool.query(
    `UPDATE processcontroldata
     SET validation_status = $1,
         validation_by = $2,
         validation_date = NOW()
     WHERE id_processcontroldata = $3
     RETURNING *`,
    [validation_status, validation_by, id]
  );
  res.json(result.rows[0]);
};

exports.remove = async (req, res) => {
  await pool.query('DELETE FROM processcontroldata WHERE id_processcontroldata=$1', [req.params.id]);
  res.json({ message: 'Deleted' });
};
