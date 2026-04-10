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
    const { 
      nfcid, 
      full_name, 
      snssb,
      machineid,
      machinename,
      workcenter,
      roles
    } = req.body;

    const result = await db.query(
      `INSERT INTO usernfc 
        (nfcid, full_name, snssb, machineid, machinename, workcenter, roles)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [nfcid, full_name, snssb, machineid, machinename, workcenter, roles]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("CREATE USER ERROR:", err.message);
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

// UPDATE mode (single/multiple) berdasarkan snssb
exports.updateMode = async (req, res) => {
  const { snssb } = req.params;
  const { mode } = req.body;
  if (!['single', 'multiple'].includes(mode)) {
    return res.status(400).json({ message: 'Invalid mode value' });
  }
  try {
    const result = await db.query(
      'UPDATE usernfc SET mode = $1 WHERE snssb = $2 RETURNING *',
      [mode, snssb]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'User not found' });
    res.json(result.rows[0]);
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


exports.updatenfc = async (req, res) => {
  try {
    const { nfcid } = req.params;
    const { full_name, snssb, machineid, machinename, workcenter, roles } = req.body;
    
    console.log("[USERNFC UPDATE]", nfcid, JSON.stringify(req.body));
    
    const result = await db.query(
      `UPDATE usernfc 
       SET full_name = $1, snssb = $2, machineid = $3, machinename = $4, workcenter = $5, roles = $6
       WHERE nfcid = $7 
       RETURNING *`,
      [full_name, snssb, machineid, machinename, workcenter, roles, nfcid]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User tidak ditemukan" });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[USERNFC ERROR]", err.message);
    res.status(500).json({ error: err.message });
  }
};