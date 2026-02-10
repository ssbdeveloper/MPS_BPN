const db = global.pool || require("../db");
// ============================================
// DEPENDENCIES
// ============================================
const { Parser } = require('json2csv');
const ExcelJS = require('exceljs');


// Configuration from environment variables
const PLANT_SSB = process.env.PLANT_SSB;  // ✅ Nama var sesuai .env
const TIMEZONE = process.env.TIMEZONE;  // ✅ Fallback default
console.log('⚙️ Timesheet Controller Config:');
console.log('   Plant:', PLANT_SSB);
console.log('   Timezone:', TIMEZONE);
// ============ HELPER FUNCTIONS ============

/**
 * Get current date/time in the configured timezone
 */
const getCurrentDateTime = () => {
  return new Date();
};

/**
 * Format date as dd/mm/yyyy
 */
const formatDate = (date) => {
  return date.toLocaleDateString('id-ID', {
    timeZone: TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
};

/**
 * Format time as HH:MM
 * Note: locale id-ID returns "." separator, so we always normalize to ":"
 */
const formatTime = (date) => {
  const time = date.toLocaleTimeString('id-ID', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  return time.replace('.', ':');
};

/**
 * Validation schema for export queries
 */
const schemas = {
  export: {
    field: { type: 'string', optional: true, default: 'longdate_checkout' },
    start: { type: 'string', optional: true },
    end: { type: 'string', optional: true }
  }
};

/**
 * Simple input validator
 */
const validateInput = (schema, data) => {
  const validated = {};
  for (const key in schema) {
    const rule = schema[key];
    if (data[key] !== undefined) {
      validated[key] = data[key];
    } else if (rule.default !== undefined) {
      validated[key] = rule.default;
    } else if (!rule.optional) {
      throw new Error(`Validation failed: ${key} is required`);
    }
  }
  return validated;
};

// ============ QUERY HANDLERS ============

/**
 * GET all timesheet records with pagination
 * Query params: page (default: 1), limit (default: 50, max: 1000)
 * Example: /api/timesheet?page=2&limit=100
 */
exports.getAll = async (req, res) => {
  try {
    // Parse pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    
    // Validation
    if (page < 1) {
      return res.status(400).json({ error: 'Page must be >= 1' });
    }
    if (limit < 1 || limit > 1000) {
      return res.status(400).json({ error: 'Limit must be between 1 and 1000' });
    }

    const offset = (page - 1) * limit;

    // Get total count for pagination metadata
    const countResult = await db.query(
      `SELECT COUNT(*) FROM timesheet_transaction`
    );
    const totalRecords = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalRecords / limit);

    // Get paginated data
    const result = await db.query(
      `SELECT * FROM timesheet_transaction 
       ORDER BY tsnumber DESC 
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalRecords: totalRecords,
        recordsPerPage: limit,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      }
    });
  } catch (err) {
    console.error('getAll error:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * Search timesheet records by field and value/range
 */
exports.search = async (req, res) => {
  try {
    const { field, value, start, end } = req.query;
    const allowedFields = ["serialnumber", "full_name", "longdate_checkin"];
    
    if (!allowedFields.includes(field)) {
      return res.status(400).json({ error: "Invalid field. Allowed: " + allowedFields.join(', ') });
    }

    let query;
    let params;

    if (start && end) {
      query = `SELECT * FROM timesheet_transaction
               WHERE DATE(${field}) BETWEEN $1 AND $2
               ORDER BY longdate_checkin ASC`;
      params = [start, end];
    } else if (value) {
      query = `SELECT * FROM timesheet_transaction
               WHERE DATE(${field}) = $1
               ORDER BY longdate_checkin ASC`;
      params = [value];
    } else {
      return res.status(400).json({ error: "Missing value or range (start/end)" });
    }

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('search error:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET timesheet records by serial number
 */
exports.getbysn = async (req, res) => {
  try {
    const { snkaryawan } = req.params;
    const result = await db.query(
      `SELECT * FROM timesheet_transaction 
       WHERE serialnumber = $1
       ORDER BY longdate_checkin DESC`,
      [snkaryawan]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('getbysn error:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET timesheet record by employee name
 */
exports.getbyname = async (req, res) => {
  try {
    const { nama } = req.params;
    const result = await db.query(
      `SELECT * FROM timesheet_transaction 
       WHERE full_name = $1`,
      [nama]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error('getbyname error:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET timesheet record by ID
 */
exports.getbyid = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT * FROM timesheet_transaction 
       WHERE tsnumber = $1`,
      [id]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error('getbyid error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============ CREATE/UPDATE OPERATIONS ============

/**
 * CREATE new timesheet entry (check-in)
 * Semua timestamp & format dihitung 100% di PostgreSQL pakai NOW() supaya konsisten
 */
exports.create = async (req, res) => {
  try {
    const {
      production_order,
      ssbr_ident,
      serialnumber,
      full_name,
      operation_no,
      operation_text,
      workcentercode,
      workcenterdescription,
      id_unprod
    } = req.body;

    // Validate required fields
    if (!serialnumber || !full_name) {
      return res.status(400).json({ error: 'serialnumber and full_name are required' });
    }

    const PLANT_SSB = process.env.PLANT_SSB;

    const result = await db.query(
      `INSERT INTO timesheet_transaction
        (production_order, ssbr_ident, serialnumber, full_name, seq, operation_text,
         workcentercode, workcenterdescription, longdate_checkin,
         date_checkin, hour_checkin, plant, activitytype)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(),
         to_char(NOW(), 'DD/MM/YYYY'),
         to_char(NOW(), 'HH24:MI'),
         $9, $10)
       RETURNING *`,
      [
        production_order,
        ssbr_ident,
        serialnumber,
        full_name,
        operation_no,
        operation_text,
        workcentercode,
        workcenterdescription,
        PLANT_SSB,
        id_unprod
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('create error:', err);
    res.status(500).json({ error: 'Error inserting data: ' + err.message });
  }
};
 
/**
 * UPDATE timesheet - checkout by serial number
 */
exports.checkout = async (req, res) => {
  console.log("API CHECKOUT KE-TRIGGER");
  console.log("req.body:", req.body);
  try {
    const { datakaryawan } = req.body;

    if (!datakaryawan?.sn) {
      return res.status(400).json({ error: 'datakaryawan.sn is required' });
    }

    const serialnumber = datakaryawan.sn;

    const result = await db.query(
      `UPDATE timesheet_transaction
       SET longdate_checkout = NOW(),
           date_checkout = to_char(NOW(), 'DD/MM/YYYY'),
           hour_checkout = to_char(NOW(), 'HH24:MI'),
           duration = ROUND(
             EXTRACT(EPOCH FROM (NOW() - longdate_checkin)) / 3600.0, 2
           )
       WHERE serialnumber = $1
         AND date_checkout IS NULL
       RETURNING *`,
      [serialnumber]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Data tidak ditemukan atau sudah checkout" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('checkout error:', err);
    res.status(500).json({ error: 'Error updating data: ' + err.message });
  }
};

/**
 * UPDATE timesheet - checkout by tsnumber (ID)
 */
exports.checkoutid = async (req, res) => {
  try {
    const { tsnumber } = req.body;

    if (!tsnumber) {
      return res.status(400).json({ error: 'tsnumber is required' });
    }

    const result = await db.query(
      `UPDATE timesheet_transaction
       SET longdate_checkout = NOW(),
           date_checkout = to_char(NOW(), 'DD/MM/YYYY'),
           hour_checkout = to_char(NOW(), 'HH24:MI'),
           duration = ROUND(
             EXTRACT(EPOCH FROM (NOW() - longdate_checkin)) / 3600.0, 2
           )
       WHERE tsnumber = $1
         AND date_checkout IS NULL
       RETURNING *`,
      [tsnumber]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Data tidak ditemukan atau sudah checkout' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('checkoutid error:', err);
    res.status(500).json({ error: 'Error updating data: ' + err.message });
  }
};

/**
 * BULK validation of timesheet records
 */
exports.bulkValidation = async (req, res) => {
  try {
    const { tsnumbers } = req.body;

    if (!Array.isArray(tsnumbers) || tsnumbers.length === 0) {
      return res.status(400).json({ 
        error: 'tsnumbers must be a non-empty array' 
      });
    }

    const validation_date = getCurrentDateTime();
    const state_flag = "2";

    const result = await db.query(
      `UPDATE timesheet_transaction
       SET validation_date = $1,
           state_flag = $2
       WHERE tsnumber = ANY($3)
         AND date_checkout IS NOT NULL
         AND validation_date IS NULL
       RETURNING *`,
      [validation_date, state_flag, tsnumbers]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        error: 'No records updated. Records may already be validated or not checked out.' 
      });
    }

    res.json({
      updated_count: result.rows.length,
      updated_rows: result.rows
    });
  } catch (err) {
    console.error('bulkValidation error:', err);
    res.status(500).json({ error: 'Error updating bulk validation: ' + err.message });
  }
};

/**
 * UPDATE timesheet record (admin function)
 */
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
      workcenterdescription,
      longdate_checkin,
      longdate_checkout
    } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'ID parameter is required' });
    }

    if (!serialnumber?.trim()) {
      return res.status(400).json({ error: 'Serial number is required' });
    }

    const query = `
      UPDATE timesheet_transaction SET
        serialnumber = $1,
        full_name = $2,
        production_order = $3,
        ssbr_ident = $4,
        operation_text = $5,
        seq = $6,
        workcentercode = $7,
        workcenterdescription = $8,
        longdate_checkin = $9::timestamptz,
        date_checkin = CASE
          WHEN $9 IS NOT NULL
          THEN to_char($9::timestamptz, 'DD/MM/YYYY')
          ELSE NULL
        END,
        hour_checkin = CASE
          WHEN $9 IS NOT NULL
          THEN to_char($9::timestamptz, 'HH24:MI')
          ELSE NULL
        END,
        longdate_checkout = $10::timestamptz,
        date_checkout = CASE
          WHEN $10 IS NOT NULL
          THEN to_char($10::timestamptz, 'DD/MM/YYYY')
          ELSE NULL
        END,
        hour_checkout = CASE
          WHEN $10 IS NOT NULL
          THEN to_char($10::timestamptz, 'HH24:MI')
          ELSE NULL
        END,
        duration = CASE
          WHEN $10 IS NOT NULL AND $9 IS NOT NULL
          THEN ROUND(EXTRACT(EPOCH FROM ($10::timestamptz - $9::timestamptz)) / 3600.0, 2)
          ELSE NULL
        END
      WHERE tsnumber = $11
      RETURNING *;
    `;

    const s = (v) => (v ?? "").toString().trim() || null;

    const values = [
      s(serialnumber),
      s(full_name),
      s(production_order),
      s(ssbr_ident),
      s(operation_text),
      s(seq),
      s(workcentercode),
      s(workcenterdescription),
      longdate_checkin || null,
      longdate_checkout || null,
      id
    ];


    const result = await db.query(query, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Timesheet record not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('updateTimesheetadmin error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============ DELETE OPERATION ============

/**
 * DELETE timesheet record by ID
 */
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `DELETE FROM timesheet_transaction WHERE tsnumber = $1 RETURNING tsnumber`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }
    
    res.json({ message: 'Deleted successfully', tsnumber: result.rows[0].tsnumber });
  } catch (err) {
    console.error('remove error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============ EXPORT FUNCTIONS ============

/**
 * Generate export in CSV or XLSX format
 */
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
      return res.status(404).json({ error: 'No data found for the specified criteria' });
    }

    const filename = start && end
      ? `timesheet_${field}_${start}_to_${end}.${format}`
      : `timesheet_transaction.${format}`;

    if (format === 'csv') {
      const fields = Object.keys(result.rows[0]);
      const parser = new Parser({ fields, delimiter: ';' });
      const csv = parser.parse(result.rows);

      res.header('Content-Type', 'text/csv; charset=utf-8');
      res.attachment(filename);
      return res.send(csv);
    }

    if (format === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Timesheet');
      const fields = Object.keys(result.rows[0]);

      // Add header row
      ws.addRow(fields);

      // Add data rows
      result.rows.forEach(row => {
        ws.addRow(fields.map(f => row[f]));
      });

      // Auto-size columns
      fields.forEach((field, index) => {
        const col = ws.getColumn(index + 1);
        let maxLength = field.length;
        
        col.eachCell({ includeEmpty: true }, cell => {
          const cellValue = cell.value ? String(cell.value) : '';
          if (cellValue.length > maxLength) {
            maxLength = cellValue.length;
          }
        });
        
        col.width = Math.min(Math.max(maxLength + 2, 10), 60);
      });

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      
      await wb.xlsx.write(res);
      return res.end();
    }
  } catch (err) {
    console.error(`${format.toUpperCase()} export error:`, err);
    const statusCode = err.message.includes('Validation') ? 400 : 500;
    res.status(statusCode).json({ error: err.message });
  }
};

/**
 * Export timesheet data as CSV
 */
exports.getcsv = (req, res) => generateExport(req, res, 'csv');

/**
 * Export timesheet data as XLSX
 */
exports.getxlsx = (req, res) => generateExport(req, res, 'xlsx');

/* UPDATE FLEXIBLE*/
exports.partialUpdate = async (req, res) => {
  const { tsnumber } = req.params;
  const payload = req.body;

  if (!payload || Object.keys(payload).length === 0) {
    return res.status(400).json({ message: "No data to update" });
  }

  const allowedFields = [
    "note",
    "hour_checkin",
    "hour_checkout",
    "date_checkin",
    "date_checkout",
    "state_flag",
    "std_foreman_hours",
    "planhours",
    "workcentercode",
    "workcenterdescription"
  ];

  const setClauses = [];
  const values = [];
  let idx = 1;

  for (const field of allowedFields) {
    if (payload[field] !== undefined) {
      setClauses.push(`${field} = $${idx++}`);
      values.push(payload[field]);
    }
  }

  if (setClauses.length === 0) {
    return res.status(400).json({ message: "No valid fields to update" });
  }

  values.push(tsnumber);

  try {
    const result = await db.query(
      `
      UPDATE timesheet_transaction
      SET ${setClauses.join(", ")}
      WHERE tsnumber = $${idx}
      RETURNING *
      `,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Timesheet not found" });
    }

    res.json({
      message: "Timesheet updated",
      data: result.rows[0]
    });
  } catch (err) {
    console.error("partialUpdate error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ============================================
// OPTIMIZED VALIDATION ENDPOINT
// Server-side: stats, grouped employee list, paginated records per group
// ============================================

/**
 * GET /timesheet/validation-stats
 * Returns stats + grouped employee summary (no individual records)
 * Query params: start, end, search (optional)
 */
exports.validationStats = async (req, res) => {
  try {
    let { start, end, search } = req.query;

    // Default: last 30 days
    if (!start || !end) {
      const now = new Date();
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      start = thirtyDaysAgo.toISOString().split('T')[0];
      end = now.toISOString().split('T')[0];
    }

    // Build WHERE clause
    let whereClauses = ['DATE(longdate_checkin) BETWEEN $1 AND $2'];
    let params = [start, end];
    let paramIdx = 3;

    if (search && search.trim()) {
      const searchLike = `%${search.trim().toLowerCase()}%`;
      whereClauses.push(`(
        LOWER(serialnumber) LIKE $${paramIdx}
        OR LOWER(full_name) LIKE $${paramIdx}
        OR LOWER(workcentercode) LIKE $${paramIdx}
        OR LOWER(workcenterdescription) LIKE $${paramIdx}
        OR LOWER(production_order) LIKE $${paramIdx}
      )`);
      params.push(searchLike);
      paramIdx++;
    }

    const whereSQL = whereClauses.join(' AND ');

    // 1) Global stats
    const statsQuery = `
      SELECT
        COUNT(*) AS total_records,
        COALESCE(SUM(duration), 0) AS total_hours,
        COUNT(DISTINCT serialnumber) AS total_employees,
        COUNT(*) FILTER (WHERE validation_date IS NULL) AS total_pending,
        COUNT(*) FILTER (WHERE validation_date IS NOT NULL) AS total_validated,
        COALESCE(SUM(duration) FILTER (WHERE validation_date IS NULL), 0) AS pending_hours,
        COALESCE(SUM(duration) FILTER (WHERE validation_date IS NOT NULL), 0) AS validated_hours
      FROM timesheet_transaction
      WHERE ${whereSQL}
    `;
    const statsResult = await db.query(statsQuery, params);
    const statsRow = statsResult.rows[0];

    // 2) Grouped employee summary (serialnumber, full_name, counts, hours)
    const groupsQuery = `
      SELECT
        serialnumber,
        MAX(full_name) AS full_name,
        COUNT(*) AS record_count,
        COALESCE(SUM(duration), 0) AS total_hours,
        COUNT(*) FILTER (WHERE validation_date IS NULL) AS pending_count,
        COUNT(*) FILTER (WHERE validation_date IS NOT NULL) AS validated_count,
        COALESCE(SUM(duration) FILTER (WHERE validation_date IS NULL), 0) AS pending_hours,
        COALESCE(SUM(duration) FILTER (WHERE validation_date IS NOT NULL), 0) AS validated_hours
      FROM timesheet_transaction
      WHERE ${whereSQL}
      GROUP BY serialnumber
      ORDER BY MAX(full_name) ASC
    `;
    const groupsResult = await db.query(groupsQuery, params);

    res.json({
      stats: {
        totalRecords: parseInt(statsRow.total_records),
        totalHours: parseFloat(statsRow.total_hours).toFixed(2),
        totalEmployees: parseInt(statsRow.total_employees),
        totalPending: parseInt(statsRow.total_pending),
        totalValidated: parseInt(statsRow.total_validated),
        pendingHours: parseFloat(statsRow.pending_hours).toFixed(2),
        validatedHours: parseFloat(statsRow.validated_hours).toFixed(2)
      },
      groups: groupsResult.rows
    });
  } catch (err) {
    console.error('validationStats error:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /timesheet/validation-group/:serialnumber
 * Returns records for one employee within date range
 * Query params: start, end
 */
exports.validationGroupRecords = async (req, res) => {
  try {
    const { serialnumber } = req.params;
    let { start, end } = req.query;

    if (!start || !end) {
      const now = new Date();
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      start = thirtyDaysAgo.toISOString().split('T')[0];
      end = now.toISOString().split('T')[0];
    }

    const query = `
      SELECT
        t.tsnumber, t.serialnumber, t.full_name, t.production_order,
        t.ssbr_ident, t.operation_text, t.seq, t.workcentercode,
        t.workcenterdescription, t.date_checkin, t.hour_checkin,
        t.date_checkout, t.hour_checkout, t.duration, t.note,
        t.planhours, t.std_foreman_hours, t.state_flag,
        t.validation_date, t.activitytype, t.part_name,
        s.planhours AS sow_planhours
      FROM timesheet_transaction t
      LEFT JOIN sow s ON s.codenumber = (t.production_order || t.seq::text)
      WHERE t.serialnumber = $1
        AND DATE(t.longdate_checkin) BETWEEN $2 AND $3
      ORDER BY t.longdate_checkin DESC
    `;
    const result = await db.query(query, [serialnumber, start, end]);

    // Merge sow_planhours into planhours if planhours is empty
    const records = result.rows.map(r => {
      if (r.sow_planhours != null && (r.planhours == null || r.planhours === '')) {
        r.planhours = r.sow_planhours;
      }
      delete r.sow_planhours;
      return r;
    });

    res.json(records);
  } catch (err) {
    console.error('validationGroupRecords error:', err);
    res.status(500).json({ error: err.message });
  }
};


