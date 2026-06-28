const { Pool, types } = require("pg");
require("./config/loadEnv");

types.setTypeParser(1082, (str) => str);
types.setTypeParser(1114, (str) => str);
types.setTypeParser(1184, (str) => str);

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  max: parseInt(process.env.DB_POOL_MAX || "10", 10),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || "30000", 10),
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || "5000", 10),
  query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT_MS || "45000", 10),
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || "45000", 10),
  idle_in_transaction_session_timeout: parseInt(process.env.DB_IDLE_IN_TX_TIMEOUT_MS || "30000", 10),
  application_name: process.env.DB_APPLICATION_NAME || "mps2-api",
  options: [
    `-c timezone=${process.env.TIMEZONE || "Asia/Makassar"}`,
    `-c statement_timeout=${parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || "45000", 10)}`,
    `-c idle_in_transaction_session_timeout=${parseInt(process.env.DB_IDLE_IN_TX_TIMEOUT_MS || "30000", 10)}`,
  ].join(" "),
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
