#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");
const { Pool } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(PROJECT_ROOT, ".env");
const DEFAULT_PREFIX = "M5051";
const DEFAULT_LOCAL_TUNNEL_PORT = 15433;
const LOG_TABLE = "mch_machine_ping_log";

function parseEnvFile(filePath) {
  const parsed = {};
  if (!fs.existsSync(filePath)) return parsed;

  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalIndex = line.indexOf("=");
    if (equalIndex === -1) continue;

    const key = line.slice(0, equalIndex).trim();
    let value = line.slice(equalIndex + 1).trim();
    const commentIndex = value.search(/\s+#/);
    if (commentIndex !== -1) value = value.slice(0, commentIndex).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }
  return parsed;
}

function parseArgs(argv) {
  const args = {
    prefix: DEFAULT_PREFIX,
    pingCount: 4,
    timeoutMs: 1000,
    concurrency: 8,
    loop: false,
    intervalMs: 10000,
    retentionDays: null,
    useTunnel: false,
    localTunnelPort: DEFAULT_LOCAL_TUNNEL_PORT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    let arg = argv[index];
    let inlineValue = null;
    if (arg.startsWith("--") && arg.includes("=")) {
      const equalIndex = arg.indexOf("=");
      inlineValue = arg.slice(equalIndex + 1);
      arg = arg.slice(0, equalIndex);
    }
    const next = () => argv[++index];
    const value = () => inlineValue ?? next();

    if (arg === "--prefix") args.prefix = value();
    else if (arg === "--ping-count") args.pingCount = Number(value());
    else if (arg === "--timeout-ms") args.timeoutMs = Number(value());
    else if (arg === "--concurrency") args.concurrency = Number(value());
    else if (arg === "--loop") args.loop = true;
    else if (arg === "--interval-ms") args.intervalMs = Number(value());
    else if (arg === "--retention-days") args.retentionDays = Number(value());
    else if (arg === "--db-host") args.dbHost = value();
    else if (arg === "--db-port") args.dbPort = Number(value());
    else if (arg === "--use-tunnel") args.useTunnel = true;
    else if (arg === "--local-tunnel-port") args.localTunnelPort = Number(value());
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function printHelp() {
  console.log(`
Ping machine IPs from public.mch_machines.

Usage:
  node scripts/ping_m5051_machines.js [options]

Options:
  --prefix M5051             Machine ID prefix filter (default: M5051)
  --ping-count 4             Ping attempts per unique IP (default: 4)
  --timeout-ms 1000          Ping timeout per IP (default: 1000)
  --concurrency 8            Parallel ping workers (default: 8)
  --loop                     Run continuously
  --interval-ms 10000        Delay between loop runs (default: 10000)
  --retention-days 7         Delete log rows older than N days
  --use-tunnel               Open local DB tunnel via SOCKS5 127.0.0.1:1055
  --local-tunnel-port 15433  Local PostgreSQL tunnel port (default: 15433)
  --db-host 127.0.0.1        Override DB host
  --db-port 15433            Override DB port

Examples:
  node scripts/ping_m5051_machines.js
  node scripts/ping_m5051_machines.js --use-tunnel
  node scripts/ping_m5051_machines.js --loop --interval-ms=10000 --retention-days=7
  node scripts/ping_m5051_machines.js --db-host 127.0.0.1 --db-port 15433
`);
}

function waitForPort(host, port, timeoutMs = 5000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({ host, port });
      socket.setTimeout(500);
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", retry);
      socket.once("timeout", retry);

      function retry() {
        socket.destroy();
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timeout waiting for ${host}:${port}`));
          return;
        }
        setTimeout(tryConnect, 250);
      }
    };

    tryConnect();
  });
}

function isPortOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function startTunnel(env, args) {
  if (await isPortOpen("127.0.0.1", args.localTunnelPort)) {
    return null;
  }

  const scriptPath = path.join(PROJECT_ROOT, "scripts", "pg_socks_tunnel.py");
  const child = spawn(
    "python",
    [
      scriptPath,
      "--target-host",
      env.DB_HOST,
      "--target-port",
      env.DB_PORT,
      "--local-port",
      String(args.localTunnelPort),
    ],
    {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  child.stdout.on("data", (data) => process.stderr.write(data));
  child.stderr.on("data", (data) => process.stderr.write(data));
  await waitForPort("127.0.0.1", args.localTunnelPort);
  return child;
}

function pingIp(ipaddress, timeoutMs) {
  const isWindows = process.platform === "win32";
  const command = isWindows ? "ping" : "ping";
  const pingArgs = isWindows
    ? ["-n", "1", "-w", String(timeoutMs), ipaddress]
    : ["-c", "1", "-W", String(Math.max(1, Math.ceil(timeoutMs / 1000))), ipaddress];

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, pingArgs, { windowsHide: true });
    let output = "";
    let settled = false;

    const hardTimeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({
        ipaddress,
        ok: false,
        latencyMs: null,
        message: "timeout",
        elapsedMs: Date.now() - startedAt,
      });
    }, timeoutMs + 1000);

    child.stdout.on("data", (data) => {
      output += data.toString();
    });
    child.stderr.on("data", (data) => {
      output += data.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      resolve({
        ipaddress,
        ok: false,
        latencyMs: null,
        message: error.message,
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      const latencyMatch = output.match(/(?:time[=<]|Average = )(\d+)\s*ms/i);
      resolve({
        ipaddress,
        ok: code === 0,
        latencyMs: latencyMatch ? Number(latencyMatch[1]) : null,
        message: code === 0 ? "reachable" : "unreachable",
        elapsedMs: Date.now() - startedAt,
      });
    });
  });
}

async function pingIpRepeated(ipaddress, count, timeoutMs) {
  const attempts = [];
  for (let index = 0; index < count; index += 1) {
    attempts.push(await pingIp(ipaddress, timeoutMs));
  }

  const successfulLatencies = attempts
    .filter((attempt) => attempt.ok && attempt.latencyMs !== null)
    .map((attempt) => attempt.latencyMs);
  const successCount = attempts.filter((attempt) => attempt.ok).length;
  const failedCount = attempts.length - successCount;
  const sumLatency = successfulLatencies.reduce((sum, latency) => sum + latency, 0);

  return {
    ipaddress,
    attempts,
    pingCount: attempts.length,
    successCount,
    failedCount,
    minLatencyMs: successfulLatencies.length ? Math.min(...successfulLatencies) : null,
    avgLatencyMs: successfulLatencies.length
      ? Number((sumLatency / successfulLatencies.length).toFixed(2))
      : null,
    maxLatencyMs: successfulLatencies.length ? Math.max(...successfulLatencies) : null,
    packetLossPercent: Number(((failedCount / attempts.length) * 100).toFixed(2)),
    status: successCount > 0 ? "OK" : "DOWN",
  };
}

async function mapConcurrent(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

async function ensureLogTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.${LOG_TABLE} (
      id bigserial PRIMARY KEY,
      checked_at timestamptz NOT NULL DEFAULT now(),
      machineid varchar(100),
      machinename varchar(255),
      ipaddress varchar(100) NOT NULL,
      machineids jsonb NOT NULL DEFAULT '[]'::jsonb,
      machine_count integer NOT NULL DEFAULT 1,
      ping_count integer NOT NULL,
      success_count integer NOT NULL,
      failed_count integer NOT NULL,
      min_latency_ms numeric(10, 2),
      avg_latency_ms numeric(10, 2),
      max_latency_ms numeric(10, 2),
      packet_loss_percent numeric(5, 2) NOT NULL,
      status varchar(20) NOT NULL,
      raw_results jsonb NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_${LOG_TABLE}_checked_at
      ON public.${LOG_TABLE} (checked_at DESC);

    CREATE INDEX IF NOT EXISTS idx_${LOG_TABLE}_machineid
      ON public.${LOG_TABLE} (machineid);

    CREATE INDEX IF NOT EXISTS idx_${LOG_TABLE}_ipaddress
      ON public.${LOG_TABLE} (ipaddress);
  `);

  await pool.query(`
    ALTER TABLE public.${LOG_TABLE}
      ADD COLUMN IF NOT EXISTS machineids jsonb NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS machine_count integer NOT NULL DEFAULT 1;
  `);
}

async function insertPingLogs(pool, ipRows, resultByIp) {
  if (!ipRows.length) return;

  const values = [];
  const placeholders = ipRows.map((row, index) => {
    const offset = index * 14;
    const result = resultByIp.get(row.ipaddress.trim());
    values.push(
      row.machineid,
      row.machinename,
      row.ipaddress,
      JSON.stringify(row.machineids),
      row.machine_count,
      result.pingCount,
      result.successCount,
      result.failedCount,
      result.minLatencyMs,
      result.avgLatencyMs,
      result.maxLatencyMs,
      result.packetLossPercent,
      result.status,
      JSON.stringify(result.attempts),
    );
    return `(
      $${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4},
      $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8},
      $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12},
      $${offset + 13}, $${offset + 14}::jsonb
    )`;
  });

  await pool.query(
    `
      INSERT INTO public.${LOG_TABLE} (
        machineid,
        machinename,
        ipaddress,
        machineids,
        machine_count,
        ping_count,
        success_count,
        failed_count,
        min_latency_ms,
        avg_latency_ms,
        max_latency_ms,
        packet_loss_percent,
        status,
        raw_results
      )
      VALUES ${placeholders.join(",")}
    `,
    values,
  );
}

async function pruneOldLogs(pool, retentionDays) {
  if (!retentionDays || retentionDays <= 0) return;

  await pool.query(
    `
      DELETE FROM public.${LOG_TABLE}
      WHERE checked_at < now() - ($1::text || ' days')::interval
    `,
    [String(retentionDays)],
  );
}

async function runOnce(pool, args) {
  await ensureLogTable(pool);
  await pruneOldLogs(pool, args.retentionDays);

  const { rows } = await pool.query(
    `
      SELECT
        BTRIM(ipaddress) AS ipaddress,
        MIN(machineid) AS machineid,
        MIN(machinename) AS machinename,
        jsonb_agg(machineid ORDER BY machineid) AS machineids,
        COUNT(*)::integer AS machine_count
      FROM public.mch_machines
      WHERE machineid LIKE $1
        AND NULLIF(BTRIM(ipaddress), '') IS NOT NULL
      GROUP BY BTRIM(ipaddress)
      ORDER BY BTRIM(ipaddress)
    `,
    [`${args.prefix}%`],
  );

  const uniqueIps = rows.map((row) => row.ipaddress.trim());
  const pingResults = await mapConcurrent(
    uniqueIps,
    args.concurrency,
    (ipaddress) => pingIpRepeated(ipaddress, args.pingCount, args.timeoutMs),
  );
  const resultByIp = new Map(pingResults.map((result) => [result.ipaddress, result]));
  await insertPingLogs(pool, rows, resultByIp);

  const outputRows = rows.map((row) => {
    const result = resultByIp.get(row.ipaddress.trim());
    return {
      machines: `${row.machine_count} machines`,
      machineids: row.machineids.join(", "),
      ipaddress: row.ipaddress,
      status: result.status,
      success: `${result.successCount}/${result.pingCount}`,
      packet_loss: `${result.packetLossPercent}%`,
      avg_latency_ms: result.avgLatencyMs ?? "",
    };
  });

  console.table(outputRows);

  const okCount = outputRows.filter((row) => row.status === "OK").length;
  console.log(
    `Summary: ${uniqueIps.length} unique IPs, ` +
      `${okCount} OK, ${uniqueIps.length - okCount} DOWN, logged to public.${LOG_TABLE}`,
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const env = { ...parseEnvFile(ENV_PATH), ...process.env };
  const tunnel = args.useTunnel ? await startTunnel(env, args) : null;
  const pool = new Pool({
    host: args.dbHost || (args.useTunnel ? "127.0.0.1" : env.DB_HOST),
    port: args.dbPort || (args.useTunnel ? args.localTunnelPort : Number(env.DB_PORT)),
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
  });

  try {
    if (args.loop) {
      console.log(
        `Loop mode: every ${args.intervalMs}ms, retention=` +
          `${args.retentionDays ? `${args.retentionDays} days` : "disabled"}`,
      );
      while (true) {
        await runOnce(pool, args);
        await sleep(args.intervalMs);
      }
    } else {
      await runOnce(pool, args);
    }
  } finally {
    await pool.end().catch(() => {});
    if (tunnel) tunnel.kill();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
