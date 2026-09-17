#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const pointer = path.join(root, '.rift-ui-release.json');
function validateRelease(directory) {
  if (!/^\.next-(?:ui-release-[a-zA-Z0-9-]+|readiness-0910|run-recovery-release)$/.test(directory))
    throw new Error('Invalid preview release directory');
  for (const file of ['BUILD_ID', 'required-server-files.json', 'server/pages/500.html']) {
    if (!fs.existsSync(path.join(root, directory, file)))
      throw new Error(`Incomplete preview release: ${directory}/${file}. Run pnpm build:ui-release-preview.`);
  }
  return directory;
}
function publishRelease(directory) {
  validateRelease(directory);
  const temporary = `${pointer}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ directory }) + '\n');
  fs.renameSync(temporary, pointer);
}
function previewPort(value = process.env.RIFT_UI_PREVIEW_PORT || '3022') {
  if (!['3020', '3022'].includes(value)) throw new Error('Preview port must be 3020 or 3022');
  return value;
}
function buildTypeScriptConfig(base, directory, buildDirectories) {
  return { ...base,
    include: [...(base.include || []), `${directory}/types/**/*.ts`, `${directory}/dev/types/**/*.ts`],
    exclude: [...(base.exclude || []).filter(entry => entry !== '.next-*/**'),
      ...buildDirectories.filter(entry => entry !== directory)],
  };
}
async function main() {
  const mode = process.argv[2];
  if (mode === 'build') {
    require('./package-local-cli.cjs').buildLocalCli();
    // Never rebuild the output tree an existing server is reading.
    const directory = `.next-ui-release-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const tsconfigName = `.rift-build-tsconfig-${randomUUID()}.json`;
    const tsconfigPath = path.join(root, tsconfigName);
    const base = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf8'));
    fs.writeFileSync(tsconfigPath, JSON.stringify(buildTypeScriptConfig(base, directory,
      fs.readdirSync(root).filter(entry => entry === '.next' || entry.startsWith('.next-')))));
    let result;
    try { result = spawnSync(process.execPath, [require.resolve('next/dist/bin/next'), 'build'], {
      cwd: root, stdio: 'inherit', env: { ...process.env, RIFT_NEXT_DIST_DIR: directory, RIFT_TSCONFIG_PATH: tsconfigName,
        NEXT_PUBLIC_RIFT_PERF_PROBE: '1', NEXT_TELEMETRY_DISABLED: '1' },
    });
    } finally { fs.rmSync(tsconfigPath, { force: true }); }
    if (result.error) throw result.error;
    if (result.status !== 0) { process.exitCode = result.status ?? 1; return; }
    publishRelease(directory);
  } else if (mode === 'start') {
    const directory = validateRelease(fs.existsSync(pointer)
      ? JSON.parse(fs.readFileSync(pointer, 'utf8')).directory : '.next-run-recovery-release');
    await require('./browser-runtime.cjs').ensureBrowserRuntime();
    const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', previewPort()], {
      cwd: root, stdio: 'inherit', env: { ...process.env, RIFT_NEXT_DIST_DIR: directory,
        RIFT_LOCAL_TERMINAL: '1', RIFT_LOCAL_WORKSPACE_ROOT: root, NEXT_TELEMETRY_DISABLED: '1' },
    });
    const warmup = new AbortController();
    void require('./warm-build-route.cjs').warmBuildRoute(previewPort(), { signal: warmup.signal })
      .then(ready => { if (!warmup.signal.aborted) console.log(`[preview] Build route warmup: ${ready ? 'ready' : 'unavailable'}`); })
      .catch(() => console.warn('[preview] Build route warmup unavailable'));
    child.once('exit', () => warmup.abort());
    child.once('error', () => warmup.abort());
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
    child.on('error', error => { console.error(error.message); process.exitCode = 1; });
    child.on('exit', code => { process.exitCode = code ?? 1; });
  } else throw new Error('Use build or start');
}
module.exports = { validateRelease, publishRelease, previewPort, buildTypeScriptConfig };
if (require.main === module) { main().catch(error => { console.error(error.message); process.exitCode = 1; }); }
