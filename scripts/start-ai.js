/**
 * Starts the Python AI sidecar (uvicorn) as a child process.
 * Called by concurrently via `npm start` / `npm run dev`.
 * Using a JS wrapper avoids Windows path/quoting issues with forward slashes.
 */
const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PYTHON = path.join(ROOT, 'ai', '.venv', 'Scripts', 'python.exe');
const VENV_SITE_PACKAGES = path.join(ROOT, 'ai', '.venv', 'Lib', 'site-packages');
const RELOAD = process.argv.includes('--reload');

const env = {
  ...process.env,
  PYTHONPATH: `${ROOT};${VENV_SITE_PACKAGES}`,
  PATH: `${path.dirname(PYTHON)};${process.env.PATH}`,
};

const args = [
  '-m', 'uvicorn', 'ai.api:app',
  '--host', '0.0.0.0',
  '--port', '8000',
];

const proc = spawn(PYTHON, args, {
  stdio: 'inherit',
  cwd: ROOT,
  env,
  windowsHide: true,
});

proc.on('error', (err) => {
  console.error('[AI] Failed to start Python sidecar:', err.message);
  process.exit(1);
});
proc.on('exit', (code) => process.exit(code ?? 0));
