const db = global.pool || require("../db");

exports.getAll = async (req, res) => {
  const result = await pool.query('SELECT * FROM process_category ORDER BY id_process');
  res.json(result.rows);
};

exports.create = async (req, res) => {
  const { process_name, description } = req.body;
  const result = await pool.query(
    'INSERT INTO process_category (process_name, description) VALUES ($1, $2) RETURNING *',
    [process_name, description]
  );
  res.json(result.rows[0]);
};

exports.update = async (req, res) => {
  const { id } = req.params;
  const { process_name, description } = req.body;
  const result = await pool.query(
    'UPDATE process_category SET process_name=$1, description=$2 WHERE id_process=$3 RETURNING *',
    [process_name, description, id]
  );
  res.json(result.rows[0]);
};

exports.remove = async (req, res) => {
  await pool.query('DELETE FROM process_category WHERE id_process=$1', [req.params.id]);
  res.json({ message: 'Deleted' });
};
