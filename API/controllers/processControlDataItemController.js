const db = global.pool || require("../db");

exports.getAll = async (req, res) => {
  
  const result = await pool.query
  ('SELECT * FROM processcontroldata_item ORDER BY id_processcontroldata_item DESC'
  );
  res.json(result.rows);
};


exports.byid = async (req, res) => {
  const { id } = req.params;
  const result = await pool.query
  ('SELECT * FROM processcontroldata_item WHERE id_processcontroldata = $1 ORDER BY id_processcontroldata_item ASC',
    [id]
  );
  res.json(result.rows);
};

exports.create = async (req, res) => {
  const { category_name, parameter_name, value, uom, ischoice, isnumber, status, note, id_parameter, id_processcontroldata } = req.body;
  const result = await pool.query(
    `INSERT INTO processcontroldata_item
    (category_name, parameter_name, value, uom, ischoice, isnumber, status, note, id_parameter, id_processcontroldata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [category_name, parameter_name, value, uom, ischoice, isnumber, status, note, id_parameter, id_processcontroldata]
  );
  res.json(result.rows[0]);
};

exports.update = async (req, res) => {
  const { id } = req.params;
  const { value, status, note } = req.body;
  const result = await pool.query(
    `UPDATE processcontroldata_item
     SET value=$1, status=$2, note=$3
     WHERE id_processcontroldata_item=$4 RETURNING *`,
    [value, status, note, id]
  );
  res.json(result.rows[0]);
};

exports.remove = async (req, res) => {
  await pool.query('DELETE FROM processcontroldata_item WHERE id_processcontroldata_item=$1', [req.params.id]);
  res.json({ message: 'Deleted' });
};
