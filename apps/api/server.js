// server.js
const path = require('path');
const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const { envPath, loaded: envLoaded } = require('./config/loadEnv');
const { startKanbanRefreshJob } = require('./jobs/kanbanRefreshJob');
const ewsRealtimeHub = require('./services/ewsRealtimeHub');

// ========================================
// ENVIRONMENT SETUP
// ========================================
if (!envLoaded) {
  console.warn('⚠️  No .env file found, using environment variables');
} else {
  console.log('✅ .env loaded from:', envPath);
}

// Set timezone
process.env.TZ = process.env.TIMEZONE || 'Asia/Makassar';

console.log('================================');
console.log('Server Configuration');
console.log('================================');
console.log('Environment:', process.env.NODE_ENV || 'development');
console.log('Timezone:', process.env.TIMEZONE);
console.log('Plant ID:', process.env.PLANT_SSB);
console.log('Port:', process.env.PORT || 3001);
console.log('================================');

// ========================================
// DATABASE SETUP
// ========================================
const { Pool, types } = require('pg');

// Force pg to return timestamptz as raw string (no JS Date conversion)
// Ini mencegah pg driver convert timezone pakai Node.js local TZ yang bisa beda
// OID 1082 = date, 1114 = timestamp, 1184 = timestamptz
types.setTypeParser(1082, (str) => str); // date -> string
types.setTypeParser(1114, (str) => str); // timestamp → string
types.setTypeParser(1184, (str) => str); // timestamptz → string

console.log("===== DEBUG ENV DB =====");
console.log({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  ewsHost: process.env.EWS_DB_HOST || process.env.DB_HOST,
  ewsPort: process.env.EWS_DB_PORT || process.env.DB_PORT,
  user: process.env.DB_USER,
  db: process.env.DB_NAME,
  nodeEnv: process.env.NODE_ENV
});
console.log("========================");

function createPgPool({
  host,
  port,
  max,
  applicationName,
  queryTimeoutMs,
  statementTimeoutMs,
  idleInTransactionTimeoutMs,
}) {
  const usesPgbouncer = String(host || '').toLowerCase().includes('pgbouncer') || String(port || '') === '6432';
  const startupOptions = [`-c timezone=${process.env.TIMEZONE || 'Asia/Makassar'}`];

  if (!usesPgbouncer) {
    startupOptions.push(
      `-c statement_timeout=${statementTimeoutMs}`,
      `-c idle_in_transaction_session_timeout=${idleInTransactionTimeoutMs}`,
    );
  }

  return new Pool({
    host,
    port: parseInt(port, 10) || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    max,
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '5000', 10),
    query_timeout: queryTimeoutMs,
    ...(usesPgbouncer ? {} : {
      statement_timeout: statementTimeoutMs,
      idle_in_transaction_session_timeout: idleInTransactionTimeoutMs,
    }),
    application_name: applicationName,
    options: startupOptions.join(' ')
  });
}

const pool = createPgPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  applicationName: process.env.DB_APPLICATION_NAME || 'mps2-api',
  queryTimeoutMs: parseInt(process.env.DB_QUERY_TIMEOUT_MS || '45000', 10),
  statementTimeoutMs: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '45000', 10),
  idleInTransactionTimeoutMs: parseInt(process.env.DB_IDLE_IN_TX_TIMEOUT_MS || '30000', 10),
});

const ewsListenerPool = createPgPool({
  host: process.env.EWS_DB_HOST || process.env.DB_HOST,
  port: process.env.EWS_DB_PORT || process.env.DB_PORT,
  max: parseInt(process.env.EWS_LISTENER_DB_POOL_MAX || '1', 10),
  applicationName: process.env.EWS_LISTENER_DB_APPLICATION_NAME || 'mps2-api-ews-listener',
  queryTimeoutMs: parseInt(process.env.EWS_LISTENER_QUERY_TIMEOUT_MS || '0', 10),
  statementTimeoutMs: parseInt(process.env.EWS_LISTENER_STATEMENT_TIMEOUT_MS || '0', 10),
  idleInTransactionTimeoutMs: parseInt(process.env.DB_IDLE_IN_TX_TIMEOUT_MS || '30000', 10),
});

// Test connection


// Export pool untuk dipakai di controllers
global.pool = pool;

// ========================================
// EXPRESS SETUP
// ========================================
const app = express();
const server = http.createServer(app);

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS configuration
app.use(
  cors({
    origin: process.env.CORS_ORIGIN === '*' ? true : process.env.CORS_ORIGIN,

    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

    allowedHeaders: ['Content-Type', 'Authorization', 'x-user-role', 'x-user-id', 'x-user-name'],
    credentials: false,
  })
);


// Static files (hanya untuk development, bukan untuk Docker)
if (process.env.NODE_ENV !== 'production') {
  app.use(express.static(path.join(__dirname, '../UI'), {
    extensions: ['html']
  }));
  console.log('📁 Serving static files from:', path.join(__dirname, '../UI'));
}

// Uploaded files — served in all environments
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ========================================
// HEALTH CHECK
// ========================================
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    environment: process.env.NODE_ENV || 'development',
    timezone: process.env.TIMEZONE,
    timestamp: new Date().toLocaleString('id-ID', { timeZone: process.env.TIMEZONE }),
    port: process.env.PORT || 3001,
    plant: process.env.PLANT_SSB
  });
});

// ========================================
// ROUTES
// ========================================
// Network share (hanya jika accessible)
if (process.env.DRAWINGS_PATH) {
  app.use('/drawings', express.static(process.env.DRAWINGS_PATH));
  console.log('📐 Drawings path:', process.env.DRAWINGS_PATH);
}

// RBAC write guard (interim x-role, DEFAULT-DENY). Runs before all routers.
// Log-only until env RBAC_ENFORCE=1. See docs/security/RBAC_BACKEND_ENFORCEMENT_PLAN.md.
const rbacGuard = require('./rbac/rbacGuard');
app.use(rbacGuard);
console.log(`🔒 RBAC guard: ${rbacGuard.ENFORCE ? 'ENFORCING' : 'log-only (set RBAC_ENFORCE=1 to enforce)'}`);

// API Routes
app.use('/sow', require('./routes/sow'));
app.use('/sow-schedule', require('./routes/sowSchedule'));
app.use('/usernfc', require('./routes/usernfc'));
app.use('/workcenter', require('./routes/workcenter'));
app.use('/timesheet', require('./routes/timesheet_transaction'));
app.use('/production-operations', require('./routes/production_operations'));
app.use('/process-control', require('./routes/processControlRoutes'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/receiving-shipment', require('./routes/receivingShipment'));
app.use('/component-tracking', require('./routes/componentTracking'));
app.use('/kanban', require('./routes/kanban'));
app.use('/machine-hours-sqlserver', require('./routes/machineHoursSqlServer'));
app.use('/machine-hours-validation', require('./routes/machineHoursValidation'));
app.use('/consumable', require('./routes/consumable'));
app.use('/tools', require('./routes/tools'));
app.use('/auth', require('./routes/auth'));
app.use('/ms-project', require('./routes/msProject'));
app.use('/ews', require('./routes/ews'));

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});
require('./websocket/machineHoursSqlServerSocket')(wss);
if (process.env.ENABLE_MPS_DASHBOARD_WS === '1') {
  require('./websocket/mpsDashboardSocket')(wss);
}

// ========================================
// ERROR HANDLERS
// ========================================
// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not Found', 
    path: req.originalUrl,
    timestamp: new Date().toISOString()
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err);
  res.status(err.status || 500).json({ 
    error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message,
    timestamp: new Date().toISOString()
  });
});

// ========================================
// START SERVER
// ========================================
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
let kanbanRefreshJob = null;
async function startServer() {
  let connected = false;

  while (!connected) {
    try {
      const client = await pool.connect();
      console.log('✅ Database connected successfully');
      client.release();
      connected = true;
    } catch (err) {
      console.error('❌ Database not ready, retrying in 3s...', {
        code: err.code,
        message: err.message,
      });
      await new Promise(res => setTimeout(res, 3000));
    }
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log('================================');
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📅 Local time: ${new Date().toLocaleString('id-ID', { timeZone: process.env.TIMEZONE })}`);
    console.log(`🌐 Access: http://${HOST}:${PORT}`);
    console.log('================================');
    kanbanRefreshJob = startKanbanRefreshJob({ pool });
    ewsRealtimeHub.start({ pool, listenPool: ewsListenerPool });
  });
}

startServer();

// Graceful shutdown
// process.on('SIGTERM', () => {
//   console.log('⚠️  SIGTERM received, closing server gracefully...');
//   server.close(() => {
//     console.log('✅ Server closed');
//     pool.end(() => {
//       console.log('✅ Database pool closed');
//       process.exit(0);
//     });
//   });
// });

// process.on('SIGINT', () => {
//   console.log('\n⚠️  SIGINT received, closing server gracefully...');
//   server.close(() => {
//     console.log('✅ Server closed');
//     pool.end(() => {
//       console.log('✅ Database pool closed');
//       process.exit(0);
//     });
//   });
// });
