const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

function fixture(t, args = [], env = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mps dev test '));
  fs.mkdirSync(path.join(directory, 'apps', 'api'), { recursive: true });
  fs.mkdirSync(path.join(directory, 'apps', 'web'), { recursive: true });
  for (const file of ['dev.cjs', 'dev.bat']) fs.copyFileSync(path.join(__dirname, file), path.join(directory, file));
  const worker = `
    const fs = require('node:fs');
    const path = require('node:path');
    const { spawn } = require('node:child_process');
    fs.appendFileSync(path.join(__dirname, '../../pids'), process.pid + '\\n');
    if (process.argv[2] === 'build') {
      fs.writeFileSync(path.join(__dirname, '../../built'), 'done');
      process.exit(process.env.FIXTURE_BUILD_FAIL ? 7 : 0);
    }
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    fs.appendFileSync(path.join(__dirname, '../../pids'), child.pid + '\\n');
    fs.appendFileSync(path.join(__dirname, '../../' + path.basename(__dirname) + '-pids'), process.pid + '\\n' + child.pid + '\\n');
    console.log('fixture ready ' + process.pid);
    setInterval(() => {}, 1000);
  `;
  fs.writeFileSync(path.join(directory, 'apps', 'api', 'server.js'), worker);
  fs.writeFileSync(path.join(directory, 'apps', 'web', 'worker.cjs'), worker);
  fs.writeFileSync(path.join(directory, 'apps', 'web', 'package.json'), JSON.stringify({
    scripts: { dev: 'node worker.cjs', build: 'node worker.cjs build' },
  }));
  const fixtureEnv = { ...process.env, ...env };
  delete fixtureEnv.NODE_TEST_CONTEXT;
  const child = process.platform === 'win32'
    ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'dev.bat', ...args], { cwd: directory, env: fixtureEnv, windowsHide: true })
    : spawn(process.execPath, [path.join(directory, 'dev.cjs'), ...args], { env: fixtureEnv });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const completion = once(child, 'close');
  t.after(async () => {
    if (child.exitCode === null) child.stdin.write('q\n');
    await completion;
    // Failed assertions must still clean up only fixture-owned descendants.
    const pidsFile = path.join(directory, 'pids');
    if (fs.existsSync(pidsFile)) {
      for (const pid of fs.readFileSync(pidsFile, 'utf8').trim().split('\n').map(Number)) {
        try { process.kill(pid); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { directory, child, completion, output: () => output };
}

async function waitFor(check, output) {
  const deadline = Date.now() + 20000;
  while (!check()) {
    if (Date.now() > deadline) assert.fail(`Timed out:\n${output()}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

test('batch launcher starts both services, restarts separately, builds, and Ctrl+C cleans descendants', { timeout: 60000 }, async (t) => {
  const run = fixture(t);
  const servicePids = (name) => {
    const file = path.join(run.directory, `${name}-pids`);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map(Number) : [];
  };
  await waitFor(() => servicePids('api').length === 2 && servicePids('web').length === 2, run.output);
  await waitFor(() => run.output().includes('fixture ready ' + servicePids('web')[0]), run.output);
  const initialApi = fs.readFileSync(path.join(run.directory, 'api-pids'), 'utf8').trim().split('\n').map(Number);
  const initialWeb = fs.readFileSync(path.join(run.directory, 'web-pids'), 'utf8').trim().split('\n').map(Number);
  run.child.stdin.write('r\n');
  await waitFor(() => servicePids('api').length === 4, run.output);
  await waitFor(() => initialApi.every((pid) => !alive(pid)), run.output);
  assert(initialWeb.every(alive), 'API restart must preserve web processes');
  run.child.stdin.write('w\n');
  await waitFor(() => servicePids('web').length === 4, run.output);
  run.child.stdin.write('b\n');
  await waitFor(() => run.output().includes('Web build completed.'), run.output);
  assert.equal(fs.readFileSync(path.join(run.directory, 'built'), 'utf8'), 'done');
  run.child.stdin.write('\u0003\n');
  assert.equal((await run.completion)[0], 0, run.output());
  const pids = fs.readFileSync(path.join(run.directory, 'pids'), 'utf8').trim().split('\n').map(Number);
  await waitFor(() => pids.every((pid) => !alive(pid)), run.output);
});

test('build-only succeeds without starting API or web', { timeout: 30000 }, async (t) => {
  const run = fixture(t, ['build']);
  run.child.stdin.end();
  assert.equal((await run.completion)[0], 0, run.output());
  assert(run.output().includes('Web build completed.'));
  assert(!run.output().includes('[dev] api started'));
  assert(!run.output().includes('[dev] web started'));
});

test('build-only propagates failure exit code', { timeout: 30000 }, async (t) => {
  const run = fixture(t, ['build'], { FIXTURE_BUILD_FAIL: '1' });
  assert.equal((await run.completion)[0], 7, run.output());
  assert(run.output().includes('Web build failed.'));
});
