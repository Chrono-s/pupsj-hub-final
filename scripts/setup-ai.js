const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const AI_DIR = path.join(ROOT, 'ai');
const VENV_DIR = path.join(AI_DIR, '.venv');
const VENV_PYTHON = path.join(VENV_DIR, 'Scripts', 'python.exe');
const REQ_FILE = path.join(AI_DIR, 'requirements.txt');

console.log('========================================================');
console.log('  PUPSJ HUB - Automated Python AI Environment Setup');
console.log('========================================================\n');

// 1. Check system Python
let pyCmd = 'python';
let check = spawnSync('python', ['--version'], { encoding: 'utf8' });
if (check.error || check.status !== 0) {
  check = spawnSync('py', ['--version'], { encoding: 'utf8' });
  if (!check.error && check.status === 0) {
    pyCmd = 'py';
  } else {
    console.error('❌ Python is not installed or not in PATH.');
    console.error('👉 Please download Python from https://www.python.org/downloads/');
    console.error('   (Remember to check "Add Python to PATH" during installation)\n');
    process.exit(1);
  }
}

console.log(`[1/3] Using Python: ${pyCmd} (${(check.stdout || check.stderr || '').trim()})`);

// 2. Create virtual environment
console.log('[2/3] Creating virtual environment in ai/.venv ...');
if (!fs.existsSync(AI_DIR)) fs.mkdirSync(AI_DIR, { recursive: true });

const venvRes = spawnSync(pyCmd, ['-m', 'venv', VENV_DIR], { stdio: 'inherit', cwd: ROOT });
if (venvRes.status !== 0 || !fs.existsSync(VENV_PYTHON)) {
  console.error('❌ Failed to create virtual environment.');
  process.exit(1);
}
console.log('✅ Virtual environment created successfully.');

// 3. Install requirements
if (fs.existsSync(REQ_FILE)) {
  console.log('\n[3/3] Installing dependencies from ai/requirements.txt ...');
  spawnSync(VENV_PYTHON, ['-m', 'pip', 'install', '--upgrade', 'pip'], { stdio: 'inherit', cwd: ROOT });
  const pipRes = spawnSync(VENV_PYTHON, ['-m', 'pip', 'install', '-r', REQ_FILE], { stdio: 'inherit', cwd: ROOT });
  if (pipRes.status === 0) {
    console.log('\n========================================================');
    console.log('  ✅ [SUCCESS] Python AI Environment is completely ready!');
    console.log('  You can now start the app with: npm run dev');
    console.log('========================================================\n');
  } else {
    console.warn('\n⚠️ Some Python packages had warnings, but fallback mode will still work.\n');
  }
} else {
  console.log('ai/requirements.txt not found, skipping package install.');
}
