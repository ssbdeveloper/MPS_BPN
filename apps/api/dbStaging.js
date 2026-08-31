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

module.exports = sapPool;
