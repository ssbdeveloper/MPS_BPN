"use strict";

const { Pool } = require("pg");

const REQUIRED_DATA_FIELDS = ["AUFNR", "RUECK", "VORNR", "ZINDICATOR"];
const VALID_INDICATORS = new Set(["INST", "UPDT", "DEL"]);

let pool;

function getPool() {
  if (!pool) {
    const sslEnabled = String(process.env.DB_SSL || "false").toLowerCase() === "true";

    pool = new Pool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      max: Number(process.env.DB_POOL_MAX || 2),
      idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 10000),
      connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5000),
      application_name: process.env.DB_APPLICATION_NAME || "sap-ph3-order-lambda",
      ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
    });
  }

  return pool;
}

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  };
}

function parseBody(event) {
  if (!event || event.body == null || event.body === "") {
    throw new Error("INVALID_JSON_BODY");
  }

  if (typeof event.body === "object") {
    return event.body;
  }

  if (typeof event.body !== "string") {
    throw new Error("INVALID_JSON_BODY");
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new Error("INVALID_JSON_BODY");
  }
}

function valueOrNull(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized === "" ? null : normalized;
}

function requireDataField(data, fieldName) {
  if (!data || valueOrNull(data[fieldName]) == null) {
    return `DATA.${fieldName}`;
  }

  return null;
}

function mapPayload(data) {
  return {
    order_no: valueOrNull(data.AUFNR),
    confirmation_number: valueOrNull(data.RUECK),
    indicator_code: valueOrNull(data.ZINDICATOR),
    operation_short_text: valueOrNull(data.LTXA1),
    operation_no: valueOrNull(data.VORNR),
    sequence_category: valueOrNull(data.FLGAT),
    sequence_number: valueOrNull(data.PLNFL),
    branch_operation_no: valueOrNull(data.VORNR_B),
    return_operation_no: valueOrNull(data.VORNR_R),
    material_no: valueOrNull(data.MATNR),
    material_description: valueOrNull(data.MAKTX),
    operation_description: valueOrNull(data.ZTXT04_VORNR),
    work_center: valueOrNull(data.ARBPL),
    cost_center: valueOrNull(data.KOSTL),
    plant_code: valueOrNull(data.WERKS),
    unit_of_measure: valueOrNull(data.VGE01),
    standard_value: valueOrNull(data.VGW01),
    order_type: valueOrNull(data.AUART),
    order_description: valueOrNull(data.ZTXT04_AUFNR),
  };
}

const INSERT_COLUMNS = [
  "order_no",
  "confirmation_number",
  "indicator_code",
  "operation_short_text",
  "operation_no",
  "sequence_category",
  "sequence_number",
  "branch_operation_no",
  "return_operation_no",
  "material_no",
  "material_description",
  "operation_description",
  "work_center",
  "cost_center",
  "plant_code",
  "unit_of_measure",
  "standard_value",
  "order_type",
  "order_description",
];

function valuesForRow(row) {
  return INSERT_COLUMNS.map((column) => row[column]);
}

function successPayload(message, action, row) {
  return {
    success: true,
    message,
    action,
    data: {
      order_no: row.order_no,
      confirmation_number: row.confirmation_number,
      operation_no: row.operation_no,
    },
  };
}

async function insertOnly(client, row) {
  const placeholders = INSERT_COLUMNS.map((_, index) => `$${index + 1}`).join(", ");

  const result = await client.query(
    `
      INSERT INTO public.ph3_order (
        ${INSERT_COLUMNS.join(", ")},
        note,
        created_at,
        updated_at
      )
      VALUES (${placeholders}, NULL, NOW(), NOW())
      ON CONFLICT (order_no, confirmation_number, operation_no) DO NOTHING
      RETURNING order_no, confirmation_number, operation_no
    `,
    valuesForRow(row),
  );

  if (result.rowCount === 0) {
    return jsonResponse(409, {
      success: false,
      message: "Data already exists for this order_no, confirmation_number, and operation_no",
    });
  }

  return jsonResponse(201, successPayload("Data inserted successfully", "INST", row));
}

async function upsert(client, row) {
  const placeholders = INSERT_COLUMNS.map((_, index) => `$${index + 1}`).join(", ");

  await client.query(
    `
      INSERT INTO public.ph3_order (
        ${INSERT_COLUMNS.join(", ")},
        note,
        created_at,
        updated_at
      )
      VALUES (${placeholders}, NULL, NOW(), NOW())
      ON CONFLICT (order_no, confirmation_number, operation_no)
      DO UPDATE SET
        indicator_code = EXCLUDED.indicator_code,
        operation_short_text = EXCLUDED.operation_short_text,
        sequence_category = EXCLUDED.sequence_category,
        sequence_number = EXCLUDED.sequence_number,
        branch_operation_no = EXCLUDED.branch_operation_no,
        return_operation_no = EXCLUDED.return_operation_no,
        material_no = EXCLUDED.material_no,
        material_description = EXCLUDED.material_description,
        operation_description = EXCLUDED.operation_description,
        work_center = EXCLUDED.work_center,
        cost_center = EXCLUDED.cost_center,
        plant_code = EXCLUDED.plant_code,
        unit_of_measure = EXCLUDED.unit_of_measure,
        standard_value = EXCLUDED.standard_value,
        order_type = EXCLUDED.order_type,
        order_description = EXCLUDED.order_description,
        note = NULL,
        updated_at = NOW()
    `,
    valuesForRow(row),
  );

  return jsonResponse(200, successPayload("Data upserted successfully", "UPDT", row));
}

async function markDeleted(client, row) {
  const result = await client.query(
    `
      UPDATE public.ph3_order
      SET
        indicator_code = 'DEL',
        note = 'DELETE',
        updated_at = NOW()
      WHERE order_no = $1
        AND confirmation_number = $2
        AND operation_no = $3
      RETURNING order_no, confirmation_number, operation_no
    `,
    [row.order_no, row.confirmation_number, row.operation_no],
  );

  if (result.rowCount === 0) {
    return jsonResponse(404, {
      success: false,
      message: "Data not found for delete marking",
    });
  }

  return jsonResponse(200, successPayload("Data marked as deleted successfully", "DEL", row));
}

exports.handler = async (event, context) => {
  if (context) {
    context.callbackWaitsForEmptyEventLoop = false;
  }

  let body;
  try {
    body = parseBody(event);
  } catch {
    return jsonResponse(400, {
      success: false,
      message: "Invalid JSON body",
    });
  }

  const token = body && body.AUTH ? body.AUTH.TOKEN : null;
  if (!process.env.SAP_TOKEN || token !== process.env.SAP_TOKEN) {
    return jsonResponse(401, {
      success: false,
      message: "Unauthorized",
    });
  }

  const data = body.DATA || {};
  for (const fieldName of REQUIRED_DATA_FIELDS) {
    const missing = requireDataField(data, fieldName);
    if (missing) {
      return jsonResponse(400, {
        success: false,
        message: `Missing required field: ${missing}`,
      });
    }
  }

  const row = mapPayload(data);
  row.indicator_code = row.indicator_code.toUpperCase();

  if (!VALID_INDICATORS.has(row.indicator_code)) {
    return jsonResponse(400, {
      success: false,
      message: "Invalid indicator_code. Allowed values: INST, UPDT, DEL",
    });
  }

  console.log("SAP order payload received");
  console.log({
    order_no: row.order_no,
    confirmation_number: row.confirmation_number,
    operation_no: row.operation_no,
    indicator_code: row.indicator_code,
  });

  let client;
  try {
    client = await getPool().connect();

    if (row.indicator_code === "INST") {
      return await insertOnly(client, row);
    }

    if (row.indicator_code === "UPDT") {
      return await upsert(client, row);
    }

    return await markDeleted(client, row);
  } catch (error) {
    console.error("SAP PH3 order database error", {
      code: error.code,
      message: error.message,
    });

    return jsonResponse(500, {
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (client) {
      client.release();
    }
  }
};
