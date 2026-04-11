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
    // FK violation: snssb user masih direferensikan di timesheet_transaction.serialnumber
    if (err.code === '23503') {
      return res.status(409).json({
        error: 'User tidak dapat dihapus karena SNSSB-nya masih tercatat dalam riwayat timesheet.'
      });
    }
    res.status(500).json({ error: err.message });
  }
};


exports.updatenfc = async (req, res) => {
  try {
    const { nfcid: originalNfcId } = req.params;
    const { nfcid: newNfcId, full_name, snssb, machineid, machinename, workcenter, roles } = req.body;

    console.log("[USERNFC UPDATE]", originalNfcId, "→", newNfcId, JSON.stringify(req.body));

    // Jika nfcid berubah, cek duplikat (aman dari FK — constraint bukan di nfcid)
    if (newNfcId && newNfcId !== originalNfcId) {
      const exists = await db.query('SELECT 1 FROM usernfc WHERE nfcid = $1', [newNfcId]);
      if (exists.rows.length > 0) {
        return res.status(409).json({ error: `NFC ID "${newNfcId}" sudah digunakan oleh user lain.` });
      }
    }

    const result = await db.query(
      `UPDATE usernfc
       SET nfcid = $1, full_name = $2, snssb = $3, machineid = $4, machinename = $5, workcenter = $6, roles = $7
       WHERE nfcid = $8
       RETURNING *`,
      [newNfcId || originalNfcId, full_name, snssb, machineid, machinename, workcenter, roles, originalNfcId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User tidak ditemukan" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("[USERNFC ERROR]", err.message);
    // FK constraint: usernfc.snssb direferensikan oleh timesheet_transaction.serialnumber
    // Triggered jika SNSSB diubah dan sudah ada riwayat timesheet
    if (err.code === '23503') {
      return res.status(409).json({
        error: 'SNSSB tidak dapat diubah karena sudah memiliki riwayat timesheet yang menggunakan SNSSB ini.'
      });
    }
    res.status(500).json({ error: err.message });
  }
};