// One-off admin utility: set a user's password to a fresh argon2id hash directly in the DB.
// The new password is read from a HIDDEN prompt — never echoed, never logged, never passed
// as an argv (so it can't leak via shell history or process listing). Nothing about the
// password is printed; only the resulting format ($argon2id$) and the affected id.
//
// Use for a locked-out / broken account that can't be fixed through the ManageUsers UI.
// For normal resets, prefer the UI (PUT /auth/users/:id) — it already writes argon2id.
//
// Run (prod via the Tailscale tunnel on 127.0.0.1:5434):
//   cd apps/api
//   DB_HOST=127.0.0.1 DB_PORT=5434 DB_USER=tag node scripts/reset-password.js [username]
//   (username defaults to 'admin'; DB_PASSWORD/DB_NAME come from the root .env)
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const argon2 = require("@node-rs/argon2");
const { Client } = require("pg");

// Load root .env with setdefault semantics (explicit env wins) — same as database/migrate.js.
const ROOT = path.join(__dirname, "..", "..", "..");
try {
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
} catch { /* .env optional if DB_* already in env */ }

const username = String(process.argv[2] || "admin").trim();

// Prompt without echoing keystrokes. The query text is written once; the readline echo is
// then suppressed so the typed password never appears on screen or in any capture.
function promptHidden(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(query);
    rl._writeToOutput = () => {};
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

(async () => {
  const pw = await promptHidden(`New password for '${username}': `);
  if (!pw || pw.length < 5) {
    console.error("Aborted: password must be at least 5 characters.");
    process.exit(1);
  }
  const confirm = await promptHidden("Confirm password: ");
  if (pw !== confirm) {
    console.error("Aborted: passwords do not match.");
    process.exit(1);
  }

  const hash = await argon2.hash(pw, { algorithm: argon2.Algorithm.Argon2id });

  const client = new Client({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME || "ptssb",
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    application_name: "reset-password-script",
  });
  await client.connect();
  try {
    const r = await client.query(
      "UPDATE public.users SET password_hash = $1, updated_at = now() WHERE lower(username) = lower($2) RETURNING id",
      [hash, username],
    );
    if (r.rowCount === 1) {
      console.log(`OK: user '${username}' (id ${r.rows[0].id}) password set to argon2id.`);
    } else if (r.rowCount === 0) {
      console.error(`No user named '${username}' — nothing changed.`);
      process.exitCode = 1;
    } else {
      console.error(`Refused: ${r.rowCount} rows match '${username}' (expected exactly 1).`);
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
})().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
