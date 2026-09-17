#!/usr/bin/env node
// macOS LaunchAgent entry point. Credentials stay out of process arguments.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const configFile = path.join(os.homedir(), '.config/rift/local-runner.json');
let config;
try {
  const stat = fs.statSync(configFile);
  if ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()) throw new Error();
  config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  if (!config.token || !config.convexUrl) throw new Error();
} catch {
  console.error('RIFT local runner: owner-only connection configuration is required.');
  process.exit(1);
}
const child = spawn(process.execPath, [
  path.resolve(__dirname, '../packages/local/dist/index.js'),
  '--convex-url', config.convexUrl, '--keep-alive',
  '--name', config.name || os.hostname(),
], { env: { ...process.env, RIFT_LOCAL_TOKEN: config.token }, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', () => { console.error('RIFT local runner could not start.'); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
