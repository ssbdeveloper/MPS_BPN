const db = global.pool || require("../db");

// GET all
exports.getAll = async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM sow");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET by ID
exports.getById = async (req, res) => {
  try {
    const { order } = req.params;
    const result = await db.query('SELECT * FROM sow WHERE "order_no" = $1 ORDER BY operation_no ASC', [order]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.get2data = async (req, res) => {
  try {
    const { search } = req.query;

    let query = 'SELECT * FROM sow WHERE 1=1';
    const params = [];

    if (search) {
      query += ` AND (order_no ILIKE $1 OR ssbr_id ILIKE $1)`;
      params.push(`%${search}%`);
    }

    query += ' ORDER BY operation_no ASC';

    const result = await db.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Data not found' });
    }

    const columns = Object.keys(result.rows[0]);

    // HEADER pakai titik koma
    const csvHeader = columns.join(";") + "\n";

    // DATA pakai titik koma
    const csvData = result.rows
      .map(row =>
        columns
          .map(col => {
            let value = row[col];
            if (value === null || value === undefined) value = "";
            value = String(value).replace(/"/g, '""');
            return `"${value}"`;
          })
          .join(";")
      )
      .join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="sow_${search || "all"}.csv"`
    );

    res.send(csvHeader + csvData);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// Endpoint baru khusus untuk JSON
exports.getDataJSON = async (req, res) => {
  try {
    const { search } = req.query;
    
    let query = 'SELECT * FROM sow WHERE 1=1';
    const params = [];

    if (search) {
      query += ` AND (order_no ILIKE $1 OR ssbr_id ILIKE $1)`;
      params.push(`%${search}%`);
    }

    query += ' ORDER BY operation_no ASC';

    const result = await db.query(query, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Data not found' });
    }

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getbymesinid = async (req, res) => {
  try {
    const { order } = req.params;
    const { workcenter } = req.query; // ambil dari body

    const result = await db.query(
      'SELECT * FROM sow WHERE "order_no" = $1 AND workcenter = $2 ORDER BY operation_no ASC',
      [order, workcenter]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// CREATE
exports.create = async (req, res) => {
  try {
    // Log request masuk
    console.log("=".repeat(50));
    console.log("[SOW CREATE] Request received:", new Date().toISOString());
    console.log("[SOW CREATE] Body:", JSON.stringify(req.body, null, 2));

    const {
      order_no,
      operation_no,
      ssbr_id,
      part_number,
      part_name,
      model,
      customer,
      location,
      wct_group,
      workcenter,
      operationtext,
      workcenterdescription,
      planhours,
      confirmation,
      status,
      finish_date,
      type,
      group_name,  // atau "group" kalau di DB namanya group
      category,
      remark
    } = req.body;

    // Log sebelum insert
    console.log("[SOW CREATE] Inserting to database...");

    const result = await db.query(
      `INSERT INTO sow (
        order_no,
        operation_no,
        ssbr_id,
        part_number,
        part_name,
        model,
        customer,
        location,
        wct_group,
        workcenter,
        operationtext,
        workcenterdescription,
        planhours,
        confirmation,
        status,
        finish_date,
        type,
        "group",
        category,
        remark
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      RETURNING *`,
      [
        order_no,
        operation_no,
        ssbr_id,
        part_number,
        part_name,
        model,
        customer,
        location,
        wct_group,
        workcenter,
        operationtext,
        workcenterdescription,
        planhours,
        confirmation,
        status,
        finish_date,
        type,
        group_name,  // nilai dari group_name masuk ke kolom "group"
        category,
        remark
      ]
    );

    // Log sukses
    console.log("[SOW CREATE] Success! ID:", result.rows[0].idsow);
    console.log("=".repeat(50));

    res.json(result.rows[0]);

  } catch (err) {
    // Log error
    console.error("[SOW CREATE] ERROR:", err.message);
    console.error("[SOW CREATE] Stack:", err.stack);
    console.error("=".repeat(50));
    
    res.status(500).json({ error: err.message });
  }
};

// UPDATE
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const result = await db.query(
      "UPDATE sow SET name = $1 WHERE id = $2 RETURNING *",
      [name, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
//========================//
exports.finish = async (req, res) => {
  try {
    const { selectedactivity } = req.body;
    const { production_order, operation_no } = selectedactivity;
    const status = "FINISH";
    const longdate_checkout = new Date();

    const result = await db.query(
      `UPDATE sow
         SET status = $1,
             finish_date = $2
       WHERE order_no = $3 AND operation_no = $4
       RETURNING *`,
      [status, longdate_checkout, production_order, operation_no]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// DELETE
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      "DELETE FROM sow WHERE idsow = $1",
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        message: "ID not found"
      });
    }

    res.status(200).json({
      message: "Deleted successfully",
      id: id
    });
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
};

//=API EXCEL=========

// CREATE
exports.createexcel = async (req, res) => {
  try {
    const {
      order_no,
      operation_no,
      ssbr_id,
      part_number,
      part_name,
      model,
      customer,
      location,
      wct_group,
      workcenter,
      operationtext,
      workcenterdescription,
      planhours,
      confirmation
    } = req.body;

    const result = await db.query(
      `INSERT INTO sow (
        order_no,
        operation_no,
        ssbr_id,
        part_number,
        part_name,
        model,
        customer,
        location,
        wct_group,
        workcenter,
        operationtext,
        workcenterdescription,
        planhours,
        confirmation
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14
      )
      RETURNING *`,
      [
        order_no,
        operation_no,
        ssbr_id,
        part_number,
        part_name,
        model,
        customer,
        location,
        wct_group,
        workcenter,
        operationtext,
        workcenterdescription,
        planhours,
        confirmation
      ]
    );

    // idsow & codenumber otomatis di-generate oleh PostgreSQL
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// UPDATE
exports.updateexcel = async (req, res) => {
  try {
    const { id } = req.params;

    // TAMBAHKAN LOGGING INI
    console.log('========== updateexcel CALLED ==========');
    console.log('ID:', id);
    console.log('FULL BODY:', JSON.stringify(req.body, null, 2));

    const {
      order_no,
      operation_no,
      ssbr_id,
      part_number,
      part_name,
      model,
      customer,
      location,
      wct_group,
      workcenter,
      operationtext,
      workcenterdescription,
      planhours,
      confirmation,
      status,
      finish_date,
      type,
      group_name,
      category,
      remark
    } = req.body;

    // LOG SETIAP VARIABEL
    console.log('type:', type);
    console.log('group_name:', group_name);
    console.log('category:', category);
    console.log('remark:', remark);

    const result = await db.query(
      `UPDATE sow SET
        order_no = $1,
        operation_no = $2,
        ssbr_id = $3,
        part_number = $4,
        part_name = $5,
        model = $6,
        customer = $7,
        location = $8,
        wct_group = $9,
        workcenter = $10,
        operationtext = $11,
        workcenterdescription = $12,
        planhours = $13,
        confirmation = $14,
        status = $15,
        finish_date = $16,
        type = $17,
        "group" = $18,
        category = $19,
        remark = $20
      WHERE idsow = $21
      RETURNING *`,
      [
        order_no,
        operation_no,
        ssbr_id,
        part_number,
        part_name,
        model,
        customer,
        location,
        wct_group,
        workcenter,
        operationtext,
        workcenterdescription,
        planhours,
        confirmation,
        status,
        finish_date,
        type,
        group_name,
        category,
        remark,
        id
      ]
    );

    // LOG HASIL QUERY
    console.log('QUERY RESULT:', JSON.stringify(result.rows[0], null, 2));
    console.log('========== updateexcel END ==========');

    res.json(result.rows[0]);
  } catch (err) {
    console.error('ERROR in updateexcel:', err);
    res.status(500).json({ error: err.message });
  }
};

//============UPSERT EXCEL=============
// UPSERT berdasarkan order_no dan operation_no
exports.upsert = async (req, res) => {
  try {
    console.log("=== UPSERT START ===");
    console.log("Body received:", JSON.stringify(req.body, null, 2));
    
    const { 
      ssbr_id,
      order_no,
      customer,
      location,
      part_name,
      model,
      part_number,
      created_by,
      type,
      group,
      category,
      operations
    } = req.body;

    // Validasi input
    if (!order_no || !operations || operations.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: "Missing required fields: ssbr_id, group, atau operations" 
      });
    }

    console.log("Validation passed");

    const results = [];

    // Loop setiap operation dan upsert
    for (let idx = 0; idx < operations.length; idx++) {
      const op = operations[idx];
      console.log(`Processing operation ${idx + 1}/${operations.length}:`, op.operation_no);
      
      // Check apakah data sudah ada berdasarkan ssbr_id + group + operation_no
      // PERBAIKAN: Pakai "group" dengan double quotes karena reserved keyword
      const checkQuery = `
        SELECT idsow FROM sow 
        WHERE order_no = $1  AND operation_no = $2
      `;
      
      console.log("Check query params:", [order_no, op.operation_no]);
      const existing = await db.query(checkQuery, [order_no, op.operation_no]);
      console.log("Existing rows found:", existing.rows.length);

      let result;
      
      if (existing.rows.length > 0) {
        console.log("UPDATE mode for operation:", op.operation_no);
        // UPDATE jika sudah ada
        // PERBAIKAN: Semua kolom reserved keyword pakai double quotes
        const updateQuery = `
          UPDATE sow SET 
            order_no = $1,
            part_number = $2,
            part_name = $3,
            model = $4,
            customer = $5,
            location = $6,
            wct_group = $7,
            workcenter = $8,
            operationtext = $9,
            planhours = $10,
            remark = $11,
            weight = $12,
            created_by = $13,
            "type" = $14,
            category = $15
          WHERE order_no = $16 AND operation_no = $17
          RETURNING *, 'updated' as action
        `;
        
        result = await db.query(updateQuery, [
          order_no,
          part_number,
          part_name,
          model,
          customer,
          location,
          op.wct_group,
          op.workcenter,
          op.operationtext,
          op.planhours,
          op.remark,
          op.weight,
          created_by,
          type,
          category,
          ssbr_id,
          group,
          op.operation_no
        ]);
        console.log("UPDATE success for:", op.operation_no);
      } else {
        console.log("INSERT mode for operation:", op.operation_no);
        // CREATE jika belum ada
        // PERBAIKAN: Kolom "group" dan "type" pakai double quotes
        const insertQuery = `
          INSERT INTO sow (
            ssbr_id, "group", operation_no, order_no, part_number, 
            part_name, model, customer, location, wct_group, 
            workcenter, operationtext, planhours, remark, weight,
            created_by, "type", category
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
          RETURNING *, 'created' as action
        `;
        
        result = await db.query(insertQuery, [
          ssbr_id,
          group,
          op.operation_no,
          order_no,
          part_number,
          part_name,
          model,
          customer,
          location,
          op.wct_group,
          op.workcenter,
          op.operationtext,
          op.planhours,
          op.remark,
          op.weight,
          created_by,
          type,
          category
        ]);
        console.log("INSERT success for:", op.operation_no);
      }

      results.push(result.rows[0]);
    }

    console.log("=== UPSERT SUCCESS ===");

    res.json({
      success: true,
      count: results.length,
      data: results
    });

  } catch (err) {
    console.error('❌ UPSERT ERROR:', err);
    console.error('Error message:', err.message);
    console.error('Error detail:', err.detail);
    
    res.status(500).json({ 
      success: false,
      error: err.message,
      detail: err.detail || null
    });
  }
};



// GET BY GROUP & SSBR ID
exports.getBySSBRAndGroup = async (req, res) => {
  try {
    const { ssbr_id, group } = req.params;
    
    console.log("=== GET DATA START ===");
    console.log("Search params:", { order_no, operation_no });

    // Query untuk ambil semua operations berdasarkan order dan operation_no
    const query = `
      SELECT 
        ssbr_id,
        order_no,
        customer,
        location,
        part_name,
        model,
        part_number,
        created_by,
        "type",
        "group",
        category,
        operation_no,
        operationtext,
        wct_group,
        workcenter,
        planhours,
        remark,
        weight
      FROM sow 
      WHERE order_no = $1 AND operation_no = $2
      ORDER BY operation_no ASC
    `;
    
    const result = await db.query(query, [ssbr_id, group]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Data tidak ditemukan"
      });
    }

    // Ambil data header dari row pertama (semua row punya header yang sama)
    const firstRow = result.rows[0];
    const header = {
      ssbr_id: firstRow.ssbr_id,
      order_no: firstRow.order_no,
      customer: firstRow.customer,
      location: firstRow.location,
      part_name: firstRow.part_name,
      model: firstRow.model,
      part_number: firstRow.part_number,
      created_by: firstRow.created_by,
      type: firstRow.type,
      group: firstRow.group,
      category: firstRow.category
    };

    // Ambil semua operations
    const operations = result.rows.map(row => ({
      operation_no: row.operation_no,
      operationtext: row.operationtext,
      wct_group: row.wct_group,
      workcenter: row.workcenter,
      planhours: row.planhours,
      remark: row.remark,
      weight: row.weight
    }));

    console.log("Data found:", result.rows.length, "operations");
    console.log("=== GET DATA SUCCESS ===");

    res.json({
      success: true,
      count: operations.length,
      header: header,
      operations: operations
    });

  } catch (err) {
    console.error('❌ GET DATA ERROR:', err);
    console.error('Error message:', err.message);
    
    res.status(500).json({ 
      success: false,
      error: err.message
    });
  }
};

exports.getcsv = async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM sow");
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "No data found" });
    }
    
    // Ambil nama kolom dari hasil query
    const columns = Object.keys(result.rows[0]);
    
    // Buat header CSV
    const csvHeader = columns.join(',') + '\n';
    
    // Convert data ke format CSV
    const csvData = result.rows.map(row => {
      return columns.map(col => {
        let value = row[col];
        // Handle null/undefined values
        if (value === null || value === undefined) {
          value = '';
        }
        // Escape double quotes dan wrap dengan quotes jika perlu
        if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
          value = '"' + value.replace(/"/g, '""') + '"';
        }
        return value;
      }).join(',');
    }).join('\n');
    
    // Set header response sebagai CSV
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="sow_data.csv"');
    
    // Kirim CSV data
    res.send(csvHeader + csvData);
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getcsvbyid = async (req, res) => {
  try {
    const { order_no } = req.params; // ambil dari URL

    const result = await db.query(
      "SELECT * FROM sow WHERE order_no = $1",
      [order_no]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "No data found" });
    }

    // Ambil nama kolom dari hasil query
    const columns = Object.keys(result.rows[0]);

    // Buat header CSV
    const csvHeader = columns.join(",") + "\n";

    // Convert data ke format CSV
    const csvData = result.rows
      .map((row) => {
        return columns
          .map((col) => {
            let value = row[col];
            if (value === null || value === undefined) {
              value = "";
            }
            if (
              typeof value === "string" &&
              (value.includes(",") || value.includes('"') || value.includes("\n"))
            ) {
              value = '"' + value.replace(/"/g, '""') + '"';
            }
            return value;
          })
          .join(",");
      })
      .join("\n");

    // Set header response sebagai CSV
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="sow_${order_no}.csv"`);

    // Kirim CSV data
    res.send(csvHeader + csvData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ============================================
// PARTS ENDPOINTS
// ============================================

// GET all parts
exports.getAllParts = async (req, res) => {
  try {
    console.log('📋 getAllParts called');
    
    const result = await db.query(`
      SELECT 
        p.*,
        COUNT(o.operation_id) as total_operations,
        COALESCE(SUM(o.planhours), 0) as total_hours
      FROM parts p
      LEFT JOIN operations o ON p.part_id = o.part_id
      GROUP BY p.part_id
      ORDER BY p.partnumber
    `);
    
    console.log(`✅ Found ${result.rows.length} parts`);
    
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (err) {
    console.error('❌ Error in getAllParts:', err);
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  }
};

// GET parts with search/filter
exports.searchParts = async (req, res) => {
  try {
    const { query } = req.query; // ?query=xxx
    
    if (!query) {
      return exports.getAllParts(req, res);
    }

    const result = await db.query(`
      SELECT 
        p.*,
        COUNT(o.operation_id) as total_operations,
        SUM(o.planhours) as total_hours
      FROM parts p
      LEFT JOIN operations o ON p.part_id = o.part_id
      WHERE 
        p.partnumber ILIKE $1 OR
        p.partname ILIKE $1 OR
        p.model ILIKE $1
      GROUP BY p.part_id
      ORDER BY p.partnumber
    `, [`%${query}%`]);
    
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET single part by ID
exports.getPartById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await db.query(`
      SELECT 
        p.*,
        COUNT(o.operation_id) as total_operations,
        SUM(o.planhours) as total_hours
      FROM parts p
      LEFT JOIN operations o ON p.part_id = o.part_id
      WHERE p.part_id = $1
      GROUP BY p.part_id
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Part not found" });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// CREATE new part
exports.createPart = async (req, res) => {
  try {
    const { partnumber, partname, model, drawing_path } = req.body;
    
    // Validation
    if (!partnumber || !partname || !model) {
      return res.status(400).json({ 
        error: "partnumber, partname, and model are required" 
      });
    }

    const result = await db.query(`
      INSERT INTO parts (partnumber, partname, model, drawing_path)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [partnumber, partname, model, drawing_path || null]);
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    // Handle duplicate partnumber
    if (err.code === '23505') {
      return res.status(409).json({ 
        error: "Part number already exists" 
      });
    }
    res.status(500).json({ error: err.message });
  }
};

// UPDATE part
exports.updatePart = async (req, res) => {
  try {
    const { id } = req.params;
    const { partnumber, partname, model, drawing_path } = req.body;
    
    // Validation
    if (!partnumber || !partname || !model) {
      return res.status(400).json({ 
        error: "partnumber, partname, and model are required" 
      });
    }

    const result = await db.query(`
      UPDATE parts
      SET partnumber = $1,
          partname = $2,
          model = $3,
          drawing_path = $4,
          updated_at = CURRENT_TIMESTAMP
      WHERE part_id = $5
      RETURNING *
    `, [partnumber, partname, model, drawing_path || null, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Part not found" });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    // Handle duplicate partnumber
    if (err.code === '23505') {
      return res.status(409).json({ 
        error: "Part number already exists" 
      });
    }
    res.status(500).json({ error: err.message });
  }
};

// DELETE part
exports.deletePart = async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await db.query(`
      DELETE FROM parts
      WHERE part_id = $1
      RETURNING *
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Part not found" });
    }
    
    res.json({ 
      message: "Part deleted successfully",
      deleted: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// OPERATIONS ENDPOINTS
// ============================================

// GET all operations by part_id
exports.getOperationsByPartId = async (req, res) => {
  try {
    const { part_id } = req.params;
    
    const result = await db.query(`
      SELECT *
      FROM operations
      WHERE part_id = $1
      ORDER BY opr_no
    `, [part_id]);
    
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET single operation by ID
exports.getOperationById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await db.query(`
      SELECT *
      FROM operations
      WHERE operation_id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Operation not found" });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// CREATE new operation
exports.createOperation = async (req, res) => {
  try {
    const { 
      part_id, 
      opr_no, 
      operationtext, 
      wct_group, 
      workcenter, 
      planhours, 
      drawing_path, 
      remark 
    } = req.body;
    
    // Validation
    if (!part_id || !opr_no || !operationtext) {
      return res.status(400).json({ 
        error: "part_id, opr_no, and operationtext are required" 
      });
    }

    const result = await db.query(`
      INSERT INTO operations 
      (part_id, opr_no, operationtext, wct_group, workcenter, planhours, drawing_path, remark)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      part_id, 
      opr_no, 
      operationtext, 
      wct_group || null, 
      workcenter || null, 
      planhours || null, 
      drawing_path || null, 
      remark || null
    ]);
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    // Handle duplicate opr_no for same part
    if (err.code === '23505') {
      return res.status(409).json({ 
        error: "Operation number already exists for this part" 
      });
    }
    // Handle foreign key violation
    if (err.code === '23503') {
      return res.status(404).json({ 
        error: "Part not found" 
      });
    }
    res.status(500).json({ error: err.message });
  }
};

// UPDATE operation
exports.updateOperation = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      opr_no, 
      operationtext, 
      wct_group, 
      workcenter, 
      planhours, 
      drawing_path, 
      remark 
    } = req.body;
    
    // Validation
    if (!opr_no || !operationtext) {
      return res.status(400).json({ 
        error: "opr_no and operationtext are required" 
      });
    }

    const result = await db.query(`
      UPDATE operations
      SET opr_no = $1,
          operationtext = $2,
          wct_group = $3,
          workcenter = $4,
          planhours = $5,
          drawing_path = $6,
          remark = $7,
          updated_at = CURRENT_TIMESTAMP
      WHERE operation_id = $8
      RETURNING *
    `, [
      opr_no, 
      operationtext, 
      wct_group || null, 
      workcenter || null, 
      planhours || null, 
      drawing_path || null, 
      remark || null,
      id
    ]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Operation not found" });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    // Handle duplicate opr_no for same part
    if (err.code === '23505') {
      return res.status(409).json({ 
        error: "Operation number already exists for this part" 
      });
    }
    res.status(500).json({ error: err.message });
  }
};

// DELETE operation
exports.deleteOperation = async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await db.query(`
      DELETE FROM operations
      WHERE operation_id = $1
      RETURNING *
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Operation not found" });
    }
    
    res.json({ 
      message: "Operation deleted successfully",
      deleted: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// BULK OPERATIONS
// ============================================

// CREATE part with operations (bulk insert)
exports.createPartWithOperations = async (req, res) => {
  const client = await db.query('SELECT 1'); // Get client from pool
  
  try {
    const { part, operations } = req.body;
    
    // Validation
    if (!part || !part.partnumber || !part.partname || !part.model) {
      return res.status(400).json({ 
        error: "Part information is required (partnumber, partname, model)" 
      });
    }

    // Begin transaction
    await db.query('BEGIN');

    // Insert part
    const partResult = await db.query(`
      INSERT INTO parts (partnumber, partname, model, drawing_path)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [part.partnumber, part.partname, part.model, part.drawing_path || null]);
    
    const newPart = partResult.rows[0];

    // Insert operations if provided
    let newOperations = [];
    if (operations && operations.length > 0) {
      for (const op of operations) {
        const opResult = await db.query(`
          INSERT INTO operations 
          (part_id, opr_no, operationtext, wct_group, workcenter, planhours, drawing_path, remark)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `, [
          newPart.part_id,
          op.opr_no,
          op.operationtext,
          op.wct_group || null,
          op.workcenter || null,
          op.planhours || null,
          op.drawing_path || null,
          op.remark || null
        ]);
        newOperations.push(opResult.rows[0]);
      }
    }

    // Commit transaction
    await db.query('COMMIT');

    res.status(201).json({
      part: newPart,
      operations: newOperations
    });
  } catch (err) {
    // Rollback on error
    await db.query('ROLLBACK');
    
    if (err.code === '23505') {
      return res.status(409).json({ 
        error: "Part number or operation number already exists" 
      });
    }
    res.status(500).json({ error: err.message });
  }
};

// UPDATE part with operations (bulk update)
exports.updatePartWithOperations = async (req, res) => {
  try {
    const { id } = req.params;
    const { part, operations } = req.body;
    
    // Validation
    if (!part || !part.partnumber || !part.partname || !part.model) {
      return res.status(400).json({ 
        error: "Part information is required (partnumber, partname, model)" 
      });
    }

    // Begin transaction
    await db.query('BEGIN');

    // Update part
    const partResult = await db.query(`
      UPDATE parts
      SET partnumber = $1,
          partname = $2,
          model = $3,
          drawing_path = $4,
          updated_at = CURRENT_TIMESTAMP
      WHERE part_id = $5
      RETURNING *
    `, [part.partnumber, part.partname, part.model, part.drawing_path || null, id]);
    
    if (partResult.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(404).json({ error: "Part not found" });
    }

    const updatedPart = partResult.rows[0];

    // Delete existing operations
    await db.query(`DELETE FROM operations WHERE part_id = $1`, [id]);

    // Insert new operations
    let newOperations = [];
    if (operations && operations.length > 0) {
      for (const op of operations) {
        const opResult = await db.query(`
          INSERT INTO operations 
          (part_id, opr_no, operationtext, wct_group, workcenter, planhours, drawing_path, remark)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `, [
          id,
          op.opr_no,
          op.operationtext,
          op.wct_group || null,
          op.workcenter || null,
          op.planhours || null,
          op.drawing_path || null,
          op.remark || null
        ]);
        newOperations.push(opResult.rows[0]);
      }
    }

    // Commit transaction
    await db.query('COMMIT');

    res.json({
      part: updatedPart,
      operations: newOperations
    });
  } catch (err) {
    // Rollback on error
    await db.query('ROLLBACK');
    
    if (err.code === '23505') {
      return res.status(409).json({ 
        error: "Part number or operation number already exists" 
      });
    }
    res.status(500).json({ error: err.message });
  }
};

// GET part with all operations (complete SOW)
exports.getCompleteSOW = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get part
    const partResult = await db.query(`
      SELECT * FROM parts WHERE part_id = $1
    `, [id]);
    
    if (partResult.rows.length === 0) {
      return res.status(404).json({ error: "Part not found" });
    }

    // Get operations
    const opsResult = await db.query(`
      SELECT * FROM operations 
      WHERE part_id = $1 
      ORDER BY opr_no
    `, [id]);

    res.json({
      part: partResult.rows[0],
      operations: opsResult.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// STATISTICS & REPORTS
// ============================================

// GET statistics
exports.getStatistics = async (req, res) => {
  try {
    const stats = await db.query(`
      SELECT 
        COUNT(DISTINCT p.part_id) as total_parts,
        COUNT(DISTINCT p.model) as total_models,
        COUNT(o.operation_id) as total_operations,
        SUM(o.planhours) as total_hours,
        AVG(o.planhours) as avg_hours_per_operation
      FROM parts p
      LEFT JOIN operations o ON p.part_id = o.part_id
    `);
    
    res.json(stats.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET drawing usage report (which drawings are used in multiple operations)
exports.getDrawingUsageReport = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        p.partnumber,
        p.partname,
        o.drawing_path,
        COUNT(*) as usage_count,
        STRING_AGG(o.opr_no::TEXT || ': ' || o.operationtext, ' | ' ORDER BY o.opr_no) as operations
      FROM operations o
      JOIN parts p ON o.part_id = p.part_id
      WHERE o.drawing_path IS NOT NULL
      GROUP BY p.partnumber, p.partname, o.drawing_path
      HAVING COUNT(*) > 1
      ORDER BY usage_count DESC, p.partnumber
    `);
    
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// LEGACY COMPATIBILITY (dari table sow lama)
// ============================================

// GET all from old sow table
exports.getAll = async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM sow");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};