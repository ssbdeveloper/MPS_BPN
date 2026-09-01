// Koneksi khusus tabel SAP staging (AWS RDS terpusat, multi-plant).
// Prioritas env: SAP_STAGING_DB_* (eksplisit) -> AWS_PG* -> DB_* (lokal).
// Pola sama dengan jobs/sap_staging/sap_staging_common.py::staging_db_config().
const { Pool } = require("pg");

const env = process.env;

function pick(...names) {
  for (const name of names) {
    if (env[name]) return env[name];
  }
  return null;
}

const isRemote = Boolean(pick("SAP_STAGING_DB_HOST", "AWS_PGhost"));

const config = {
  host: pick("SAP_STAGING_DB_HOST", "AWS_PGhost", "DB_HOST"),
  port: parseInt(pick("SAP_STAGING_DB_PORT", "AWS_PGport", "DB_PORT") || "5432", 10),
  database: pick("SAP_STAGING_DB_NAME", "AWS_PGDb", "DB_NAME"),
  user: pick("SAP_STAGING_DB_USER", "AWS_PGuser", "DB_USER"),
  password: pick("SAP_STAGING_DB_PASSWORD", "AWS_PGpass", "DB_PASSWORD"),
  max: parseInt(env.DB_POOL_MAX || "5", 10),
  // AWS RDS mewajibkan SSL (worker Python pakai psycopg2 sslmode=prefer);
  // node-postgres default non-SSL -> ditolak RDS. Hanya remote yang pakai SSL.
  ssl: isRemote ? { rejectUnauthorized: false } : undefined,
};

// eslint-disable-next-line no-console
if (env.NODE_ENV !== "production" || env.SAP_STAGING_DB_HOST || env.AWS_PGhost) {
  console.log("[dbStaging] target:", config.host, `${config.port}/${config.database}`);
}

const sapPool = new Pool(config);

// DNS ke AWS RDS kadang gagal transient (getaddrinfo EAI_AGAIN dari Docker embedded DNS,
// diamati di BPN 2x/24 jam) — retry otomatis supaya query sapPool tidak 500 sesaat.
const origQuery = sapPool.query.bind(sapPool);
const SAP_DNS_RETRIES = 3;
const SAP_DNS_RETRY_DELAY_MS = 300;
sapPool.query = async (text, params) => {
  let lastErr;
  for (let attempt = 0; attempt <= SAP_DNS_RETRIES; attempt++) {
    try {
      return await origQuery(text, params);
    } catch (err) {
      const dnsFail = err && (err.code === "EAI_AGAIN" || /getaddrinfo/i.test(err.message || ""));
      if (!dnsFail || attempt === SAP_DNS_RETRIES) throw err;
      lastErr = err;
      await new Promise((r) => setTimeout(r, SAP_DNS_RETRY_DELAY_MS * (attempt + 1)));
    }
  }
  throw lastErr;
};

module.exports = sapPool;
