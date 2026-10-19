const db = global.pool || require("../db");

exports.getAll = async (req, res) => {
  const { process } = req.query; // ?process=...
  let result;
  if (process) {
    result = await pool.query(
      'SELECT * FROM process_parameter WHERE id_process = $1 ORDER BY parameter_no ASC',
      [process]
    );
  } else {
    result = await pool.query('SELECT * FROM process_parameter ORDER BY parameter_no ASC');
  }
  res.json(result.rows);
};



exports.create = async (req, res) => {
  const { parameter_name, description, parameter_no, uom, ischoice, isnumber, id_process } = req.body;
  const result = await pool.query(
    `INSERT INTO process_parameter 
    (parameter_name, description, parameter_no, uom, ischoice, isnumber, id_process)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [parameter_name, description, parameter_no, uom, ischoice, isnumber, id_process]
  );
  res.json(result.rows[0]);
};

exports.update = async (req, res) => {
  const { id } = req.params;
  const { parameter_name, description, parameter_no, uom, ischoice, isnumber, id_process } = req.body;
  const result = await pool.query(
    `UPDATE process_parameter
     SET parameter_name=$1, description=$2, parameter_no=$3, uom=$4,
         ischoice=$5, isnumber=$6, id_process=$7
     WHERE id_parameter=$8 RETURNING *`,
    [parameter_name, description, parameter_no, uom, ischoice, isnumber, id_process, id]
  );
  res.json(result.rows[0]);
};

exports.remove = async (req, res) => {
  await pool.query('DELETE FROM process_parameter WHERE id_parameter=$1', [req.params.id]);
  res.json({ message: 'Deleted' });
};
