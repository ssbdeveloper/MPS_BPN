const { spawn, spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const windows = process.platform === 'win32';
const webDirectory = path.join(__dirname, 'apps', 'web');
const apiDirectory = path.join(__dirname, 'apps', 'api');
const children = new Map();
let shuttingDown = false;
let restarting = false;

function message(text) {
  process.stdout.write(`[dev] ${text}\n`);
}

function start(name, command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    detached: !windows,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.set(name, child);
  for (const [stream, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    stream.on('data', (chunk) => output.write(`[${name}] ${chunk}`));
  }
  child.on('error', (error) => {
    message(`${name} failed to start: ${error.message}`);
    process.exitCode = 1;
    shutdown();
  });
  child.on('exit', (code, signal) => {
    if (children.get(name) !== child) return;
    // Keep the process group registered until cleanup, including surviving descendants.
    message(`${name} exited (${signal || code}).`);
    if (name === 'build') {
      children.delete(name);
      message(code === 0 ? 'Web build completed.' : 'Web build failed. Fix the error and press b to retry.');
    } else if (!shuttingDown && !restarting) {
      message(`Press ${name === 'api' ? 'r' : 'w'} to restart ${name}.`);
    }
  });
  message(`${name} started (PID ${child.pid || 'pending'}).`);
  return child;
}

function npm(name, script) {
  return windows
    ? start(name, process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm.cmd run ${script}`], webDirectory)
    : start(name, 'npm', ['run', script], webDirectory);
}

function api() {
  return start('api', process.execPath, ['server.js'], apiDirectory);
}

function stop(name) {
  const child = children.get(name);
  if (!child) return;
  if (child.pid) {
    if (windows) {
      const result = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true, encoding: 'utf8', timeout: 10000,
      });
      if (result.error || (result.status !== 0 && child.exitCode === null && child.signalCode === null)) {
        throw new Error(`Could not stop ${name}: ${result.error?.message || result.stderr || result.stdout}`);
      }
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  }
  children.delete(name);
  message(`${name} stopped.`);
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const name of [...children.keys()]) {
    try {
      stop(name);
    } catch (error) {
      process.stderr.write(`[dev] ${error.message}\n`);
      process.exitCode = 1;
    }
  }
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  message('Launcher stopped.');
  process.exit(process.exitCode || 0);
}

function control(command) {
  if (shuttingDown) return;
  try {
    switch (command.trim().toLowerCase()) {
      case '\u0003':
      case 'q': shutdown(); break;
      case 'r':
      case 'w': {
        const name = command.trim().toLowerCase() === 'r' ? 'api' : 'web';
        restarting = true;
        stop(name);
        if (name === 'api') api(); else npm('web', 'dev');
        restarting = false;
        break;
      }
      case 'b':
        if (children.has('build')) message('A build is already running.');
        else npm('build', 'build');
        break;
      case 'h': message('r: restart API | w: restart web | b: build web | q / Ctrl+C: stop all'); break;
      case '': break;
      default: message('Unknown command. Press h for help.');
    }
  } catch (error) {
    process.stderr.write(`[dev] ${error.message}\n`);
    process.exitCode = 1;
    shutdown();
  }
}

const mode = process.argv[2];
if (process.argv.length > 3 || (mode && !['build', 'help'].includes(mode))) {
  message('Usage: dev.bat [build|help]');
  process.exit(1);
}
if (mode === 'help') {
  message('dev.bat: start web and API | dev.bat build: build web only');
  message('r: restart API | w: restart web | b: build web | q / Ctrl+C: stop all');
  process.exit(0);
}
for (const file of [path.join(webDirectory, 'package.json'), ...(mode === 'build' ? [] : [path.join(apiDirectory, 'server.js')])]) {
  if (!existsSync(file)) {
    message(`Missing file: ${file}`);
    process.exit(1);
  }
}
const npmCheck = windows
  ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'npm.cmd --version'], { windowsHide: true })
  : spawnSync('npm', ['--version']);
if (npmCheck.error || npmCheck.status !== 0) {
  message('npm is missing. Install Node.js with npm and reopen the terminal.');
  process.exit(1);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
if (process.stdin.isTTY) {
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.on('keypress', (text, key) => control(key.ctrl && key.name === 'c' ? '\u0003' : text || ''));
  process.stdin.resume();
} else {
  const input = readline.createInterface({ input: process.stdin });
  input.on('line', control);
  if (mode !== 'build') input.on('close', shutdown);
}

if (mode === 'build') {
  const child = npm('build', 'build');
  child.on('exit', (code) => {
    process.exitCode = code || 0;
    shutdown();
  });
} else {
  message('r: restart API | w: restart web | b: build web | q / Ctrl+C: stop all');
  api();
  npm('web', 'dev');
}
