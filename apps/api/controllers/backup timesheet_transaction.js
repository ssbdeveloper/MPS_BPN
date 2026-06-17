const { Parser } = require('json2csv');
const ExcelJS = require('exceljs');
const db = require("../db");
const plantssb = "5153";
// GET all
exports.getAll = async (req, res) => {
  try {
    const result = await db.query(`SELECT * from timesheet_transaction 
 ORDER BY tsnumber DESC LIMIT 1000;`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
// Get Search
exports.search = async (req, res) => {
  try {
    const { field, value, start, end } = req.query;
    const allowedFields = ["serialnumber", "full_name", "longdate_checkin"];
    if (!allowedFields.includes(field)) {
      return res.status(400).json({ error: "Invalid field" });
    }

    let query;
    let params;

    if (start && end) {
      query = `SELECT * FROM timesheet_transaction 
               WHERE ${field} BETWEEN $1 AND $2 
               ORDER BY tsnumber DESC`;
      params = [start, end];
    } else if (value) {
      query = `SELECT * FROM timesheet_transaction 
               WHERE ${field} = $1 
               ORDER BY tsnumber DESC`;
      params = [value];
    } else {
      return res.status(400).json({ error: "Missing value or range" });
    }

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET by ID
exports.getbysn= async (req, res) => { 
  try {
    const { snkaryawan } = req.params; 
    const result = await db.query(`SELECT * FROM timesheet_transaction WHERE "serialnumber" = $1
        ORDER BY "longdate_checkin" DESC`, [snkaryawan]); 
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getbyname= async (req, res) => { 
  try {
    const { nama } = req.params; 
    const result = await db.query('SELECT * FROM timesheet_transaction WHERE "full_name" = $1', [nama]); 
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
exports.getbyid= async (req, res) => { 
  try {
    const { id } = req.params; 
    const result = await db.query('SELECT * FROM timesheet_transaction WHERE "tsnumber" = $1', [id]); 
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// CREATE
exports.create = async (req, res) => {
  try {
    // ambil data dari sessionStorage frontend
    const { 
      production_order, 
      serialnumber, 
      full_name,
      operation_no,
      operation_text,
      workcentercode,
      workcenterdescription,
      id_unprod } = req.body;

  
    // longdate_checkin = format DATE PostgreSQL (pakai NOW())
    const longdate_checkin = new Date();

    // date_checkin = string dd/mm/yyyy
const date_checkin = longdate_checkin.toLocaleDateString('id-ID', {
  timeZone: 'Asia/Jakarta',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric'
});

const hour_checkin = longdate_checkin.toLocaleTimeString('id-ID', {
  timeZone: 'Asia/Jakarta',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});

    // simpan ke database
    const result = await db.query(
      `INSERT INTO timesheet_transaction 
        (production_order, 
        serialnumber,
        full_name,
        seq,
        operation_text,
        workcentercode,
        workcenterdescription, 
        date_checkin, 
        longdate_checkin,
        hour_checkin,
        plant,
        activitytype
        )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,$11,$12) RETURNING *`,
      [
        production_order,
        serialnumber,
        full_name,
        operation_no,
        operation_text,
        workcentercode,
        workcenterdescription,
        date_checkin,
        longdate_checkin,
        hour_checkin,
        plantssb,
        id_unprod
        
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error insert data");
  }
};

// UPDATE
exports.checkout = async (req, res) => {
  try {
    const { datakaryawan } = req.body;
    const serialnumber = datakaryawan.sn;

    const longdate_checkout = new Date();

    const date_checkout = longdate_checkout.toLocaleDateString('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });

    const hour_checkout = longdate_checkout.toLocaleTimeString('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });

    const result = await db.query(
      `UPDATE timesheet_transaction
         SET
           longdate_checkout = $1,
           date_checkout     = $2,
           hour_checkout     = $3,
           duration = ROUND(
             EXTRACT(EPOCH FROM ($1 - longdate_checkin)) / 3600.0,
             2
           )
       WHERE serialnumber = $4
         AND date_checkout IS NULL
       RETURNING *`,
      [longdate_checkout, date_checkout, hour_checkout, serialnumber]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Data tidak ditemukan" });
    }

    // ✅ hanya satu kali response
    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).send('Error update data');
  }
};

//==============================================//
exports.checkoutid = async (req, res) => {
  try {
    const { tsnumber } = req.body;
    if (!tsnumber) {
      return res.status(400).json({ error: 'tsnumber wajib diisi' });
    }

    const longdate_checkout = new Date();

    // format tanggal (dd/mm/yyyy)
    const date_checkout = longdate_checkout.toLocaleDateString('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });

    // format jam (HH:MM) — ubah jadi HH.MM jika memang itu format di tabel
    const hour_checkout = longdate_checkout.toLocaleTimeString('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).replace(':', '.'); // hanya kalau kolom hour_* pakai titik

    const result = await db.query(
      `UPDATE timesheet_transaction
         SET
           longdate_checkout = $1,
           date_checkout     = $2,
           hour_checkout     = $3,
           duration = ROUND(
             EXTRACT(EPOCH FROM ($1 - longdate_checkin)) / 3600.0,
             2
           )
       WHERE tsnumber = $4
         AND date_checkout IS NULL
       RETURNING *`,
      [longdate_checkout, date_checkout, hour_checkout, tsnumber]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Data tidak ditemukan atau sudah checkout' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error update data');
  }
};

exports.bulkValidation = async (req, res) => {
  try {
    const { tsnumbers } = req.body;

    if (!Array.isArray(tsnumbers) || tsnumbers.length === 0) {
      return res.status(400).json({ error: 'tsnumbers harus berupa array dan tidak boleh kosong' });
    }

    const validation_date = new Date();
    const state_flag = "2";

    // update semua tsnumber yang dikirim sekaligus
    const result = await db.query(
      `UPDATE timesheet_transaction
         SET validation_date = $1,
             state_flag      = $2
       WHERE tsnumber = ANY($3)
         AND date_checkout IS NOT NULL
         AND validation_date IS NULL
       RETURNING *`,
      [validation_date, state_flag, tsnumbers]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tidak ada data yang diupdate (mungkin semua sudah checkout)' });
    }

    res.json({
      updated_count: result.rows.length,
      updated_rows: result.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error update bulk validation' });
  }
};

exports.updateTimesheetadmin = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      serialnumber,
      full_name,
      production_order,
      ssbr_ident,
      operation_text,
      seq,
      workcentercode,
      longdate_checkin,
      longdate_checkout
    } = req.body;

    // Validasi
    if (!id) {
      return res.status(400).json({ error: 'ID parameter required' });
    }
    
    if (!serialnumber?.trim()) {
      return res.status(400).json({ error: 'Serial number is required' });
    }

    // Log untuk debug
    console.log('Update timesheet ID:', id);
    console.log('Request body:', req.body);

    const query = `
      UPDATE timesheet_transaction SET
        serialnumber      = $1,
        full_name         = $2,
        production_order  = $3,
        ssbr_ident        = $4,
        operation_text    = $5,
        seq               = $6,
        workcentercode    = $7,
        longdate_checkin  = $8::timestamptz,
        date_checkin      = CASE WHEN $8 IS NOT NULL THEN to_char($8::timestamptz AT TIME ZONE 'Asia/Singapore','DD/MM/YYYY') ELSE NULL END,
        hour_checkin      = CASE WHEN $8 IS NOT NULL THEN to_char($8::timestamptz AT TIME ZONE 'Asia/Singapore','HH24.MI') ELSE NULL END,
        longdate_checkout = $9::timestamptz,
        date_checkout     = CASE WHEN $9 IS NOT NULL THEN to_char($9::timestamptz AT TIME ZONE 'Asia/Singapore','DD/MM/YYYY') ELSE NULL END,
        hour_checkout     = CASE WHEN $9 IS NOT NULL THEN to_char($9::timestamptz AT TIME ZONE 'Asia/Singapore','HH24.MI') ELSE NULL END,
        duration = ROUND(
             EXTRACT(EPOCH FROM ($9::timestamptz - $8::timestamptz)) / 3600.0,
             2
           )
      WHERE tsnumber = $10
      RETURNING *;
    `;

    const values = [
      serialnumber?.trim() || null,
      full_name?.trim() || null,
      production_order?.trim() || null,
      ssbr_ident?.trim() || null,
      operation_text?.trim() || null,
      seq?.trim() || null,
      workcentercode?.trim() || null,
      longdate_checkin || null,
      longdate_checkout || null,
      id
    ];

    console.log('Query values:', values);

    const result = await db.query(query, values);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Timesheet not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update timesheet error:', err);
    res.status(500).json({ error: err.message });
  }
};
//===================================================================//

// DELETE
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    await db.query("DELETE FROM timesheet_transaction WHERE id = $1", [id]);
    res.json({ message: "Deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ============ EXPORT FUNCTIONS ============
const generateExport = async (req, res, format = 'csv') => {
  try {
    const validated = validateInput(schemas.export, req.query);
    const { field = 'longdate_checkout', start, end } = validated;

    const params = [];
    let where = '';
    
    if (start && end) {
      where = `WHERE DATE(${field}) BETWEEN $1 AND $2`;
      params.push(start, end);
    }

    const result = await db.query(
      `SELECT * FROM timesheet_transaction ${where} ORDER BY tsnumber DESC`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No data found' });
    }

    const filename = start && end
      ? `timesheet_${field}_${start}_to_${end}.${format}`
      : `timesheet_transaction.${format}`;

    if (format === 'csv') {
      const fields = Object.keys(result.rows[0]);
      const parser = new Parser({ fields, delimiter: ';' });
      const csv = parser.parse(result.rows);

      res.header('Content-Type', 'text/csv');
      res.attachment(filename);
      return res.send(csv);
    }

    if (format === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Timesheet');
      const fields = Object.keys(result.rows[0]);

      ws.addRow(fields);
      result.rows.forEach(row => {
        ws.addRow(fields.map(f => row[f]));
      });

      // Auto-size columns
      fields.forEach((f, i) => {
        const col = ws.getColumn(i + 1);
        let maxLen = f.length;
        col.eachCell({ includeEmpty: true }, c => {
          const v = c.value ? String(c.value) : '';
          if (v.length > maxLen) maxLen = v.length;
        });
        col.width = Math.min(Math.max(maxLen + 2, 10), 60);
      });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      await wb.xlsx.write(res);
      return res.end();
    }
  } catch (err) {
    console.error(`${format.toUpperCase()} export error:`, err);
    res.status(err.message.includes('Validation') ? 400 : 500).json({ error: err.message });
  }
};

exports.getcsv = (req, res) => generateExport(req, res, 'csv');
exports.getxlsx = (req, res) => generateExport(req, res, 'xlsx');

// Legacy compatibility - deprecated
exports.checkoutid = exports.checkout;
exports.updateTimesheetadmin = exports.update;