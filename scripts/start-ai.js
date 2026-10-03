/**
 * Starts the Python AI sidecar (uvicorn) as a child process.
 * Called by concurrently via `npm start` / `npm run dev`.
 * Using a JS wrapper avoids Windows path/quoting issues with forward slashes.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PYTHON = path.join(ROOT, 'ai', '.venv', 'Scripts', 'python.exe');
const VENV_SITE_PACKAGES = path.join(ROOT, 'ai', '.venv', 'Lib', 'site-packages');
const RELOAD = process.argv.includes('--reload');
const AI_URL = process.env.AI_SIDECAR_URL || 'http://localhost:8001';
const AI_PORT = (() => {
  try {
    return String(new URL(AI_URL).port || '8001');
  } catch (_) {
    return '8001';
  }
})();

// Gracefully handle missing Python virtual environment
if (!fs.existsSync(PYTHON)) {
  console.warn('\n[AI] WARNING: Python virtual environment executable not found at:');
  console.warn(`     ${PYTHON}`);
  console.warn('[AI] Running PUPSJ HUB in fallback mode (Express server chatbot keyword fallback will be active).');
  console.warn('[AI] Dev server will remain running. AI sidecar features will be disabled.\n');
  process.exit(0);
}

const env = {
  ...process.env,
  PYTHONPATH: `${ROOT};${VENV_SITE_PACKAGES}`,
  PATH: `${path.dirname(PYTHON)};${process.env.PATH}`,
};

const args = [
  '-m', 'uvicorn', 'ai.api:app',
  '--host', '0.0.0.0',
  '--port', AI_PORT,
];

if (RELOAD) {
  args.push('--reload');
}

const proc = spawn(PYTHON, args, {
  stdio: 'inherit',
  cwd: ROOT,
  env,
  windowsHide: true,
});

proc.on('error', (err) => {
  console.warn('\n[AI] ERROR: Failed to start Python sidecar:', err.message);
  console.warn('[AI] Running PUPSJ HUB in fallback mode (Express server chatbot keyword fallback will be active).');
  console.warn('[AI] Dev server will remain running. AI sidecar features will be disabled.\n');
  process.exit(0);
});

proc.on('exit', (code) => {
  if (code !== 0) {
    console.warn(`\n[AI] WARNING: Python sidecar process exited with non-zero code ${code}.`);
    console.warn('[AI] Running PUPSJ HUB in fallback mode (Express server chatbot keyword fallback will be active).');
    console.warn('[AI] Dev server will remain running.\n');
  }
  process.exit(0);
});
