const db = global.pool || require("../db");

exports.getAll = async (req, res) => {
  const { parameter } = req.query; // ?parameter=...
  let result;
  if (parameter) {
    result = await pool.query(
      'SELECT * FROM process_parameter_choicebase WHERE id_parameter = $1 ORDER BY id_choice',
      [parameter]
    );
  } else {
    result = await pool.query('SELECT * FROM process_parameter_choicebase ORDER BY id_choice');
  }
  res.json(result.rows);
};

exports.create = async (req, res) => {
  const { choice_name, description, id_parameter } = req.body;
  const result = await pool.query(
    'INSERT INTO process_parameter_choicebase (choice_name, description, id_parameter) VALUES ($1,$2,$3) RETURNING *',
    [choice_name, description, id_parameter]
  );
  res.json(result.rows[0]);
};

exports.update = async (req, res) => {
  const { id } = req.params;
  const { choice_name, description, id_parameter } = req.body;
  const result = await pool.query(
    'UPDATE process_parameter_choicebase SET choice_name=$1, description=$2, id_parameter=$3 WHERE id_choice=$4 RETURNING *',
    [choice_name, description, id_parameter, id]
  );
  res.json(result.rows[0]);
};

exports.remove = async (req, res) => {
  await pool.query('DELETE FROM process_parameter_choicebase WHERE id_choice=$1', [req.params.id]);
  res.json({ message: 'Deleted' });
};
