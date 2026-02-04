const db = global.pool || require("../db");

// GET all
exports.getAll = async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM usernfc");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET by ID
exports.getdatausernfc = async (req, res) => { 
  try {
    const { nfcid } = req.params; 
    const result = await db.query('SELECT * FROM usernfc WHERE nfcid = $1', [nfcid]); 
    
    // PENTING: Kalau tidak ada data, HARUS return 404
    if (result.rows.length === 0 || !result.rows[0]) {
      return res.status(404).json({ message: 'Data tidak ditemukan' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
// Tam
exports.getBySnssb = async (req, res) => {
  try {
    const { snssb } = req.params;
    const result = await db.query('SELECT * FROM usernfc WHERE snssb = $1', [snssb]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Data tidak ditemukan' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getname= async (req, res) => { 
  try {
    const { nama } = req.params; 
    const result = await db.query('SELECT * FROM usernfc WHERE "full_name" = $1', [nama]); 
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// CREATE
// CREATE - insert nfcid, full_name, snssb
exports.create = async (req, res) => {
  try {
    const { nfcid, full_name, snssb } = req.body;
    const result = await db.query(
      "INSERT INTO usernfc (nfcid, full_name, snssb) VALUES ($1, $2, $3) RETURNING *",
      [nfcid, full_name, snssb]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// UPDATE - update nfcid dan full_name berdasarkan snssb
exports.update = async (req, res) => {
  try {
    const { snssb } = req.params; // snssb sebagai parameter
    const { nfcid, full_name } = req.body;
    const result = await db.query(
      "UPDATE usernfc SET nfcid = $1, full_name = $2 WHERE snssb = $3 RETURNING *",
      [nfcid, full_name, snssb]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updatemesin = async (req, res) => {
  // ambil sn dari sessionStorage
  try {
    const { 
      serialnumber, 
      machineid,
      machinename,
      workcenter } = req.body;

    const result = await db.query(
      `UPDATE usernfc
         SET 
         machineid = $1,
         machinename = $2,
         workcenter = $3
       WHERE snssb = $4
       RETURNING *`,
      [machineid, machinename, workcenter, serialnumber]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error update data');
  }
};

// DELETE
exports.remove = async (req, res) => {
  try {
    const { nfcid } = req.params;
    const result = await db.query("DELETE FROM usernfc WHERE nfcid = $1 RETURNING *", [nfcid]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Data tidak ditemukan" });
    }
    
    res.json({ message: "Deleted successfully", data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
