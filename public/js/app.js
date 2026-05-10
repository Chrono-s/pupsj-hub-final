/* ============================================
   PUPSJ HUB - Single Page Application
   ============================================ */

(function () {
  'use strict';

  // ── STATE ──
  const state = {
    user: null,
    currentPage: 'announcements',
    announcements: [],
    events: [],
    lostFound: [],
    schedules: [],
    scheduleFilterDept: 'All',
    scheduleFilterYear: '',
    scheduleFilterSection: '',
    chatMessages: [],
    chatLastMessageAt: null,  // timestamp of last sent message — used for 1-hour expiry
    chatInputDisabled: false, // Explicitly declare and initialize this state variable
    adminStats: null,
    adminUsers: [],
    calendarMonth: new Date().getMonth(),
    calendarYear: new Date().getFullYear(),
    filters: { department: 'All', lfType: 'all' },
    selectedEvent: null,
    eventFeedback: [],
    docCategories: [],
    docTemplates: [],
    docSelectedCategory: null,
    docSearch: '',
    facultyLocations: [],
    facultyLocationsUpdatedAt: null,
    facultyList: [],
    locatorShowAll: false,
    pendingAnnouncements: [],
    pendingEvents: [],
    profile: null,
    adminUsersTab: 'users',
    adminAllowedRegs: [],
    adminUsersSearch: '',
    adminUsersDept: 'All',
    adminSelectedAllowedIds: new Set(),
    lostFoundReviews: [],
    sectionSchedules: [],
    lfMatches: null,
    lfMatchingId: null,
  };

  // Polling handle for Professor Locator
  let locatorPollTimer = null;

  // Per-page scroll position + data-freshness cache
  const pageScrollCache = {};
  const pageLoadedAt    = {};
  const PAGE_CACHE_TTL  = 5 * 60 * 1000; // 5 minutes

  const departments = ['All', 'General', 'Campus', 'BSIT', 'DIT', 'BSENTREP', 'BSPSYCH', 'BSEDUC', 'BSNM', 'BSFM'];
  const lfCategories = ['Personal Items', 'School Supplies', 'Electronics', 'Clothing', 'Documents', 'Others'];
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const yearLevels = ['1st', '2nd', '3rd', '4th'];
  const sectionOptions = ['1-1', '1-2', '1-3', '2-1', '2-2', '2-3', '3-1', '3-2', '3-3', '4-1', '4-2', '4-3'];
  const studentTypes = ['regular', 'irregular'];

  // Pending files for image uploads
  let pendingFiles = [];

  async function fileToFingerprint(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read image'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Failed to process image'));
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const size = 32;
          canvas.width = size;
          canvas.height = size;
          ctx.drawImage(img, 0, 0, size, size);
          const { data } = ctx.getImageData(0, 0, size, size);

          const grayscale = [];
          let sumR = 0;
          let sumG = 0;
          let sumB = 0;
          let sumS = 0;
          let sumV = 0;
          let edges = 0;

          const toHex = (bits) => {
            let hex = '';
            for (let i = 0; i < bits.length; i += 4) {
              const chunk = bits.slice(i, i + 4).join('');
              hex += parseInt(chunk, 2).toString(16);
            }
            return hex;
          };

          for (let y = 0; y < size; y += 1) {
            grayscale[y] = [];
            for (let x = 0; x < size; x += 1) {
              const index = (y * size + x) * 4;
              const r = data[index];
              const g = data[index + 1];
              const b = data[index + 2];

              sumR += r;
              sumG += g;
              sumB += b;

              const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
              grayscale[y][x] = gray;

              const max = Math.max(r, g, b) / 255;
              const min = Math.min(r, g, b) / 255;
              const delta = max - min;
              const sat = max === 0 ? 0 : delta / max;
              sumS += sat;
              sumV += max;
            }
          }

          let graySum = 0;
          for (let y = 0; y < 8; y += 1) {
            for (let x = 0; x < 8; x += 1) graySum += grayscale[y * 4][x * 4];
          }
          const avgGray = graySum / 64;
          const ahashBits = [];
          for (let y = 0; y < 8; y += 1) {
            for (let x = 0; x < 8; x += 1) {
              ahashBits.push(grayscale[y * 4][x * 4] >= avgGray ? 1 : 0);
            }
          }

          const dhashBits = [];
          for (let y = 0; y < 8; y += 1) {
            for (let x = 0; x < 8; x += 1) {
              const left = grayscale[y * 4][x * 4];
              const right = grayscale[y * 4][Math.min((x + 1) * 4, size - 1)];
              dhashBits.push(left > right ? 1 : 0);
            }
          }

          for (let y = 0; y < size - 1; y += 1) {
            for (let x = 0; x < size - 1; x += 1) {
              const diff = Math.abs(grayscale[y][x] - grayscale[y][x + 1]) + Math.abs(grayscale[y][x] - grayscale[y + 1][x]);
              if (diff > 40) edges += 1;
            }
          }

          resolve(JSON.stringify({
            version: 1,
            ahash: toHex(ahashBits),
            dhash: toHex(dhashBits),
            rgbMean: [
              Math.round(sumR / (size * size)),
              Math.round(sumG / (size * size)),
              Math.round(sumB / (size * size)),
            ],
            satMean: Number((sumS / (size * size)).toFixed(4)),
            valMean: Number((sumV / (size * size)).toFixed(4)),
            edgeDensity: Number((edges / ((size - 1) * (size - 1))).toFixed(4)),
          }));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function fingerprintFiles(files) {
    return Promise.all((files || []).map(fileToFingerprint));
  }

  // ── API HELPERS ──
  function getToken() { return sessionStorage.getItem('pupsj_token') || ''; }

  async function api(url, options = {}) {
    try {
      const res = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          ...(getToken() ? { 'Authorization': `Bearer ${getToken()}` } : {}),
          ...options.headers,
        },
        ...options,
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch (_) {
        throw new Error(res.ok ? 'Invalid server response' : `Server error ${res.status}`);
      }
      if (!res.ok) throw new Error(data.error || 'Request failed');
      return data;
    } catch (err) {
      if (err.message === 'Authentication required' || err.message === 'Invalid or expired token') {
        state.user = null;
        render();
      }
      throw err;
    }
  }

  async function apiFormData(url, formData) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: getToken() ? { 'Authorization': `Bearer ${getToken()}` } : {},
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      return data;
    } catch (err) {
      if (err.message === 'Authentication required' || err.message === 'Invalid or expired token') {
        state.user = null;
        render();
      }
      throw err;
    }
  }

  // ── TOAST ──
  function showToast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>${message}`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3500);
  }

  // ── TIME FORMATTING ──
  function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const d = Math.floor(hrs / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(dateStr).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatTime(t) {
    if (!t) return '';
    const [h, m] = t.split(':');
    const hr = parseInt(h);
    return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
  }

  function getInitials(name) {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }

  // Returns a time-based greeting
  function getGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }

  // Returns a consistent color for an avatar based on the author's name
  function getAvatarColor(name) {
    const COLORS = ['#800000','#2980b9','#27ae60','#8e44ad','#d35400','#16a085','#c0392b','#1a5276','#6d4c41','#00796b'];
    let hash = 0;
    for (let i = 0; i < (name||'').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return COLORS[Math.abs(hash) % COLORS.length];
  }

  // ── THEME ──
  function getStoredTheme() { return localStorage.getItem('pupsj_theme') || 'system'; }
  function applyTheme(mode) {
    const resolved = mode === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : mode;
    document.documentElement.setAttribute('data-theme', resolved);
  }
  function setTheme(mode) {
    localStorage.setItem('pupsj_theme', mode);
    applyTheme(mode);
  }
  // React to system changes when in "system" mode
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (getStoredTheme() === 'system') applyTheme('system');
    });
  }
  applyTheme(getStoredTheme());

  // Renders an avatar — profile picture if available, initials fallback
  function renderAvatar(name, profileImage, cssClass = 'user-avatar') {
    if (profileImage) {
      return `<div class="${cssClass}"><img src="${profileImage}" alt="${escHtml(name)}"></div>`;
    }
    return `<div class="${cssClass}">${getInitials(name || 'U')}</div>`;
  }

  // ── IMAGE UPLOAD WIDGET ──
  function renderImageUploadWidget(inputId) {
    return `
      <div class="image-upload-zone" id="${inputId}Zone">
        <input type="file" id="${inputId}" multiple accept="image/*" style="display:none;">
        <div class="image-upload-placeholder" id="${inputId}Placeholder">
          <i class="fas fa-camera"></i>
          <span>Add Photos</span>
          <small>Up to 5 images, max 5MB each</small>
        </div>
        <div class="image-preview-grid" id="${inputId}Preview"></div>
      </div>`;
  }

  function bindImageUpload(inputId) {
    const zone = document.getElementById(`${inputId}Zone`);
    const input = document.getElementById(inputId);
    const placeholder = document.getElementById(`${inputId}Placeholder`);
    const preview = document.getElementById(`${inputId}Preview`);
    if (!zone || !input) return;

    pendingFiles = [];

    const updatePreview = () => {
      preview.innerHTML = pendingFiles.map((f, i) => `
        <div class="image-preview-item">
          <img src="${URL.createObjectURL(f)}" alt="preview">
          <button class="image-preview-remove" data-idx="${i}"><i class="fas fa-times"></i></button>
        </div>`).join('');
      placeholder.style.display = pendingFiles.length >= 5 ? 'none' : '';
      // Bind remove buttons
      preview.querySelectorAll('.image-preview-remove').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          pendingFiles.splice(parseInt(btn.dataset.idx), 1);
          updatePreview();
        };
      });
    };

    zone.onclick = (e) => {
      if (e.target.closest('.image-preview-remove')) return;
      if (pendingFiles.length < 5) input.click();
    };

    input.onchange = () => {
      const files = Array.from(input.files);
      const remaining = 5 - pendingFiles.length;
      pendingFiles.push(...files.slice(0, remaining));
      input.value = '';
      updatePreview();
    };

    // Drag and drop
    zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('drag-over'); };
    zone.ondragleave = () => zone.classList.remove('drag-over');
    zone.ondrop = (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      const remaining = 5 - pendingFiles.length;
      pendingFiles.push(...files.slice(0, remaining));
      updatePreview();
    };
  }

  // ── RENDER ENGINE ──
  function render() {
    const app = document.getElementById('app');
    if (!state.user) {
      app.innerHTML = renderAuth();
      bindAuthEvents();
    } else {
      app.innerHTML = renderLayout();
      bindLayoutEvents();
      navigateTo(state.currentPage);
    }
  }

  // State for extra auth screens
  if (!('verifyMessage' in state)) state.verifyMessage = '';
  if (!('resetToken'    in state)) state.resetToken    = '';

  // ════════════════════════════════
  //  AUTH SCREENS
  // ════════════════════════════════
  let authMode = 'login'; // login | register | forgot-password | reset-password | verifying | verify-success | verify-error | registered

  // Shared right-panel (brand panel) markup
  function renderBrandPanel() {
    return `
      <div class="auth-brand-panel">
        <div class="auth-brand-deco auth-brand-deco-1"></div>
        <div class="auth-brand-deco auth-brand-deco-2"></div>
        <div class="auth-brand-deco auth-brand-deco-3"></div>
        <div class="auth-brand-deco auth-brand-deco-4"></div>
        <div class="auth-brand-content">
          <div class="auth-brand-logo-wrap">
            <img src="/icons/pup_logo.png" alt="PUP Logo">
          </div>
          <h1 class="auth-brand-title">Welcome to<br><span>PUPSJ HUB</span></h1>
          <p class="auth-brand-sub">Login to access your campus portal and stay connected with PUP San Juan.</p>
          <div class="auth-brand-features">
            <div class="auth-brand-feature"><i class="fas fa-bullhorn"></i> Announcements</div>
            <div class="auth-brand-feature"><i class="fas fa-calendar-alt"></i> Events</div>
            <div class="auth-brand-feature"><i class="fas fa-robot"></i> PUPBot AI</div>
            <div class="auth-brand-feature"><i class="fas fa-file-alt"></i> Documents</div>
          </div>
        </div>
      </div>`;
  }

  function renderAuth() {
    // ── Special full-screen auth states ──
    if (authMode === 'verifying') {
      return `<div class="auth-screen auth-status-screen">
        <div class="auth-status-card">
          <div class="auth-status-icon spin"><i class="fas fa-circle-notch"></i></div>
          <h2>Verifying your email…</h2>
          <p>Please wait a moment.</p>
        </div>
      </div>`;
    }
    if (authMode === 'verify-success') {
      return `<div class="auth-screen auth-status-screen">
        <div class="auth-status-card success">
          <div class="auth-status-icon"><i class="fas fa-check-circle"></i></div>
          <h2>Email Verified!</h2>
          <p>${escHtml(state.verifyMessage || 'Your email has been verified successfully.')}</p>
          <button class="auth-submit-btn" onclick="window._authGoLogin()">Go to Login</button>
        </div>
      </div>`;
    }
    if (authMode === 'verify-error') {
      return `<div class="auth-screen auth-status-screen">
        <div class="auth-status-card error">
          <div class="auth-status-icon"><i class="fas fa-exclamation-circle"></i></div>
          <h2>Verification Failed</h2>
          <p>${escHtml(state.verifyMessage || 'Invalid or expired verification link.')}</p>
          <button class="auth-submit-btn" onclick="window._authGoLogin()">Back to Login</button>
        </div>
      </div>`;
    }
    if (authMode === 'registered') {
      return `<div class="auth-screen auth-status-screen">
        <div class="auth-status-card success">
          <div class="auth-status-icon"><i class="fas fa-envelope-open-text"></i></div>
          <h2>Check Your Email!</h2>
          <p>We sent a verification link to <strong>${escHtml(state.registeredEmail || 'your email')}</strong>. Click the link to activate your account before logging in.</p>
          <p class="auth-status-note">Didn't receive it? Check your spam folder or <a id="resendVerificationLink" href="#">resend the email</a>.</p>
          <button class="auth-submit-btn" onclick="window._authGoLogin()">Back to Login</button>
        </div>
      </div>`;
    }

    // ── Standard split-panel screens ──
    let formContent = '';
    let showRoleTabs = false;

    if (authMode === 'login') {
      formContent = `<div class="auth-card">${renderLogin()}</div>`;
    } else if (authMode === 'register') {
      showRoleTabs = true;
      formContent = `<div class="auth-card">${renderRegister()}</div>`;
    } else if (authMode === 'forgot-password') {
      formContent = `<div class="auth-card">${renderForgotPassword()}</div>`;
    } else if (authMode === 'reset-password') {
      formContent = `<div class="auth-card">${renderResetPassword()}</div>`;
    }

    const isWide = (authMode === 'register');
    return `
    <div class="auth-screen${isWide ? ' auth-screen--wide' : ''}">
      <!-- LEFT: White form panel -->
      <div class="auth-form-panel">
        <div class="auth-form-inner">
          ${showRoleTabs ? `
          <div class="register-role-outer">
            <div class="auth-role-switch register-role-switch">
              <button type="button" class="auth-role-tab active" data-role="student">
                <i class="fas fa-user-graduate"></i><span>Student</span>
              </button>
              <button type="button" class="auth-role-tab" data-role="faculty">
                <i class="fas fa-chalkboard-teacher"></i><span>Faculty</span>
              </button>
            </div>
          </div>` : ''}
          ${formContent}
        </div>
      </div>
      <!-- RIGHT: Maroon brand panel -->
      ${renderBrandPanel()}
    </div>`;
  }

  // Global helpers for onclick
  window._authGoLogin = () => { authMode = 'login'; render(); };

  /**
   * switchAuthMode — smoothly transitions between 'login' and 'register'
   * without destroying the outer DOM, so the CSS width transition can run.
   *
   * Flow:
   *  1. Fade content OUT (opacity 0, slide down)
   *  2. Toggle .auth-screen--wide  →  CSS transition widens/narrows the panel
   *  3. After content-out duration, swap innerHTML + rebind
   *  4. Fade content back IN
   */
  function switchAuthMode(newMode) {
    // If the outer split-panel isn't in the DOM yet, do a full render instead
    const screen = document.querySelector('.auth-screen');
    const inner  = document.querySelector('.auth-form-inner');
    if (!screen || !inner) { authMode = newMode; render(); return; }

    authMode = newMode;

    // ── Step 1: fade content out (0.2s) ──
    inner.classList.remove('auth-content-in');
    inner.classList.add('auth-content-out');

    // ── Step 2: trigger panel width CSS transition immediately ──
    // requestAnimationFrame ensures the browser commits the fade-out
    // before we start the width transition, avoiding jank
    requestAnimationFrame(() => {
      if (newMode === 'register') {
        screen.classList.add('auth-screen--wide');
      } else {
        screen.classList.remove('auth-screen--wide');
      }
    });

    // ── Step 3: after fade-out completes, swap content ──
    setTimeout(() => {
      // Role-tab row: add for register, remove for login
      const existingTabs = inner.querySelector('.register-role-outer');
      if (newMode === 'register' && !existingTabs) {
        const tabsEl = document.createElement('div');
        tabsEl.className = 'register-role-outer';
        tabsEl.innerHTML = `
          <div class="auth-role-switch register-role-switch">
            <button type="button" class="auth-role-tab active" data-role="student">
              <i class="fas fa-user-graduate"></i><span>Student</span>
            </button>
            <button type="button" class="auth-role-tab" data-role="faculty">
              <i class="fas fa-chalkboard-teacher"></i><span>Faculty</span>
            </button>
          </div>`;
        const card = inner.querySelector('.auth-card');
        inner.insertBefore(tabsEl, card);
      } else if (newMode !== 'register' && existingTabs) {
        existingTabs.remove();
      }

      // Swap card content
      const card = inner.querySelector('.auth-card');
      if (card) {
        card.innerHTML = newMode === 'login' ? renderLogin() : renderRegister();
      }

      // Re-bind all auth events
      bindAuthEvents();

      // ── Step 4: fade content back in — one frame after DOM update ──
      inner.classList.remove('auth-content-out');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          inner.classList.add('auth-content-in');
        });
      });
    }, 220); // slightly longer than the 0.2s CSS fade-out
  }

  function renderLogin() {
    return `
      <h2>Login</h2>
      <p class="subtitle">Enter your account details</p>
      <div class="auth-error" id="authError"></div>
      <div class="form-group">
        <label>Email</label>
        <input type="email" class="form-input" id="loginEmail" placeholder="you@pupsj.edu.ph" autocomplete="email">
      </div>
      <div class="form-group">
        <label>Password</label>
        <div class="auth-pw-row">
          <input type="password" class="form-input" id="loginPassword" placeholder="Enter your password" autocomplete="current-password">
        </div>
        <div class="auth-forgot-link"><a id="forgotPasswordLink">Forgot Password?</a></div>
      </div>
      <button class="btn btn-primary" id="loginBtn"><i class="fas fa-sign-in-alt"></i> Login</button>
      <p class="auth-switch">Don't have an account? <a id="switchToRegister">Sign up</a></p>`;
  }

  function renderForgotPassword() {
    return `
      <h2>Forgot Password</h2>
      <p class="subtitle">Enter your email to receive a reset link</p>
      <div class="auth-error" id="authError"></div>
      <div class="auth-success" id="authSuccess"></div>
      <div class="form-group">
        <label>Email</label>
        <input type="email" class="form-input" id="fpEmail" placeholder="you@pupsj.edu.ph" autocomplete="email">
      </div>
      <button class="btn btn-primary" id="fpBtn"><i class="fas fa-paper-plane"></i> Send Reset Link</button>
      <p class="auth-switch">Remember your password? <a id="switchToLogin">Sign In</a></p>`;
  }

  function renderResetPassword() {
    return `
      <h2>Reset Password</h2>
      <p class="subtitle">Enter your new password below</p>
      <div class="auth-error" id="authError"></div>
      <div class="form-group">
        <label>New Password</label>
        <input type="password" class="form-input" id="rpPassword" placeholder="Min. 6 characters" autocomplete="new-password">
      </div>
      <div class="form-group">
        <label>Confirm Password</label>
        <input type="password" class="form-input" id="rpConfirm" placeholder="Repeat new password" autocomplete="new-password">
      </div>
      <button class="btn btn-primary" id="rpBtn"><i class="fas fa-lock"></i> Set New Password</button>`;
  }

  // Returns ONLY the fields relevant to the chosen role — no hidden clutter.
  function renderRegisterFields(role) {
    const nameRow = `
      <div class="form-row">
        <div class="form-group">
          <label>First Name <span class="req">*</span></label>
          <input type="text" class="form-input" id="regFirst" placeholder="Juan" required>
        </div>
        <div class="form-group form-group--small">
          <label>Middle Initial</label>
          <input type="text" class="form-input" id="regMiddleInitial" placeholder="M" maxlength="10">
        </div>
        <div class="form-group">
          <label>Last Name <span class="req">*</span></label>
          <input type="text" class="form-input" id="regLast" placeholder="Dela Cruz" required>
        </div>
      </div>`;

    if (role === 'faculty') {
      return `
        ${nameRow}
        <div class="form-group">
          <label>Faculty Number</label>
          <input type="text" class="form-input" id="regStudentNum" placeholder="2024-00001-SJ-0" oninput="this.value=this.value.toUpperCase()" autocomplete="off" spellcheck="false">
        </div>
        <div class="form-group">
          <label>Email</label>
          <input type="email" class="form-input" id="regEmail" placeholder="you@pupsj.edu.ph">
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" class="form-input" id="regPassword" placeholder="Min. 6 characters">
        </div>`;
    }

    // Student fields
    return `
      <div class="auth-note register-note"><i class="fas fa-info-circle"></i> Section, Year Level, and Student Type are required.</div>
      ${nameRow}
      <div class="form-group">
        <label>Student Number</label>
        <input type="text" class="form-input" id="regStudentNum" placeholder="2024-00001-SJ-0" oninput="this.value=this.value.toUpperCase()" autocomplete="off" spellcheck="false">
      </div>
      <div class="form-row register-academic-row">
        <div class="form-group">
          <label>Year Level</label>
          <select class="form-input form-select" id="regYearLevel">
            <option value="">Select</option>
            ${yearLevels.map(level => `<option value="${level}">${level}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Section</label>
          <select class="form-input form-select" id="regSection" disabled>
            <option value="">Select</option>
          </select>
        </div>
        <div class="form-group">
          <label>Student Type</label>
          <select class="form-input form-select" id="regStudentType">
            <option value="">Select</option>
            ${studentTypes.map(type => `<option value="${type}">${type.charAt(0).toUpperCase() + type.slice(1)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Email</label>
        <input type="email" class="form-input" id="regEmail" placeholder="you@pupsj.edu.ph">
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" class="form-input" id="regPassword" placeholder="Min. 6 characters">
      </div>`;
  }

  function renderRegister() {
    return `
      <h2>Create Account</h2>
      <p class="subtitle">Join the PUPSJ HUB community</p>
      <div class="auth-error" id="authError"></div>
      <input type="hidden" id="regRole" value="student">
      <div id="regFieldsContainer">
        ${renderRegisterFields('student')}
      </div>
      <button class="btn btn-primary" id="registerBtn"><i class="fas fa-user-plus"></i> Create Account</button>
      <p class="auth-switch">Already have an account? <a id="switchToLogin">Sign In</a></p>`;
  }

  function bindAuthEvents() {
    const switchToReg = document.getElementById('switchToRegister');
    const switchToLog = document.getElementById('switchToLogin');
    // Use switchAuthMode for login↔register to get the sliding width animation.
    // Fall back to render() for any other mode (forgot-password → login, etc.)
    if (switchToReg) switchToReg.onclick = () => switchAuthMode('register');
    if (switchToLog) {
      switchToLog.onclick = () => {
        if (authMode === 'register') {
          switchAuthMode('login');
        } else {
          authMode = 'login'; render();
        }
      };
    }

    // Forgot Password link on login form
    const forgotLink = document.getElementById('forgotPasswordLink');
    if (forgotLink) forgotLink.onclick = (e) => { e.preventDefault(); authMode = 'forgot-password'; render(); };

    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) loginBtn.onclick = handleLogin;

    const registerBtn = document.getElementById('registerBtn');
    if (registerBtn) registerBtn.onclick = handleRegister;

    // Forgot password form submit
    const fpBtn = document.getElementById('fpBtn');
    if (fpBtn) fpBtn.onclick = handleForgotPassword;

    // Reset password form submit
    const rpBtn = document.getElementById('rpBtn');
    if (rpBtn) rpBtn.onclick = handleResetPassword;

    // Resend verification
    const resendLink = document.getElementById('resendVerificationLink');
    if (resendLink) resendLink.onclick = async (e) => {
      e.preventDefault();
      resendLink.textContent = 'Sending…';
      try {
        await api('/api/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email: state.registeredEmail || '' }) });
        showToast('Verification email sent! Check your inbox.', 'success');
        resendLink.textContent = 'sent!';
      } catch (err) {
        showToast(err.message || 'Failed to resend', 'error');
        resendLink.textContent = 'resend the email';
      }
    };

    // Role tab switching — re-renders ONLY the relevant fields for the chosen role
    const regRoleEl = document.getElementById('regRole');
    const regRoleTabs = Array.from(document.querySelectorAll('.register-role-switch .auth-role-tab'));
    if (regRoleEl) {
      const bindRegisterFields = () => {
        const yl = document.getElementById('regYearLevel');
        if (yl) {
          yl.onchange = (e) => updateSectionOptions(e.target.value);
          updateSectionOptions(yl.value);
        }
        const regPw2 = document.getElementById('regPassword');
        if (regPw2) regPw2.onkeydown = (e) => { if (e.key === 'Enter') handleRegister(); };
      };

      const switchRole = (role) => {
        regRoleEl.value = role;
        regRoleTabs.forEach(tab => tab.classList.toggle('active', tab.dataset.role === role));
        const container = document.getElementById('regFieldsContainer');
        if (container) {
          container.innerHTML = renderRegisterFields(role);
          bindRegisterFields();
        }
      };

      regRoleTabs.forEach(tab => { tab.onclick = () => switchRole(tab.dataset.role); });
      // Init field bindings for the default (student) role
      bindRegisterFields();
    }

    // Enter key on login password
    const loginPw = document.getElementById('loginPassword');
    if (loginPw) loginPw.onkeydown = (e) => { if (e.key === 'Enter') handleLogin(); };

    // Enter key on forgot password
    const fpEmail = document.getElementById('fpEmail');
    if (fpEmail) fpEmail.onkeydown = (e) => { if (e.key === 'Enter') handleForgotPassword(); };
  }

  async function handleForgotPassword() {
    const email = document.getElementById('fpEmail')?.value.trim();
    const errEl = document.getElementById('authError');
    const sucEl = document.getElementById('authSuccess');
    if (!email) { errEl.textContent = 'Please enter your email'; errEl.classList.add('show'); return; }
    const btn = document.getElementById('fpBtn');
    try {
      errEl.classList.remove('show');
      if (btn) btn.disabled = true;
      await api('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
      sucEl.textContent = 'If that email is registered, a reset link has been sent. Please check your inbox.';
      sucEl.classList.add('show');
      errEl.classList.remove('show');
      if (btn) btn.disabled = false;
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.add('show');
      if (btn) btn.disabled = false;
    }
  }

  async function handleResetPassword() {
    const password = document.getElementById('rpPassword')?.value;
    const confirm  = document.getElementById('rpConfirm')?.value;
    const errEl    = document.getElementById('authError');
    if (!password || !confirm) { errEl.textContent = 'Please fill in both fields'; errEl.classList.add('show'); return; }
    if (password !== confirm) { errEl.textContent = 'Passwords do not match'; errEl.classList.add('show'); return; }
    if (password.length < 6) { errEl.textContent = 'Password must be at least 6 characters'; errEl.classList.add('show'); return; }
    const btn = document.getElementById('rpBtn');
    try {
      errEl.classList.remove('show');
      if (btn) btn.disabled = true;
      await api('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: state.resetToken, password }) });
      showToast('Password reset! You can now log in.', 'success');
      state.resetToken = '';
      authMode = 'login';
      render();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.add('show');
      if (btn) btn.disabled = false;
    }
  }

  function updateSectionOptions(selectedYear) {
    const sectionEl = document.getElementById('regSection');
    if (!sectionEl) return;
    const yearPrefix = selectedYear ? selectedYear.charAt(0) : '';
    const filtered = sectionOptions.filter(s => yearPrefix ? s.startsWith(`${yearPrefix}-`) : false);
    sectionEl.innerHTML = `<option value="">Select section</option>${filtered.map(s => `<option value="${s}">${s}</option>`).join('')}`;
    sectionEl.disabled = !yearPrefix;
    if (yearPrefix && !filtered.includes(sectionEl.value)) {
      sectionEl.value = '';
    }
  }

  async function handleLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errEl = document.getElementById('authError');
    if (!email || !password) { errEl.textContent = 'Please fill in all fields'; errEl.classList.add('show'); return; }
    try {
      errEl.classList.remove('show');
      document.getElementById('loginBtn').disabled = true;
      const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      sessionStorage.setItem('pupsj_token', data.token);
      state.user = data.user;
      showToast(`${getGreeting()}, ${state.user.first_name}! Welcome back to PUPSJ HUB.`, 'success');
      render();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.add('show');
      document.getElementById('loginBtn').disabled = false;
    }
  }

  async function handleRegister() {
    const fields = {
      first_name: document.getElementById('regFirst')?.value.trim(),
      middle_initial: document.getElementById('regMiddleInitial')?.value.trim(),
      last_name: document.getElementById('regLast')?.value.trim(),
      student_number: document.getElementById('regStudentNum')?.value.trim(),
      year_level: document.getElementById('regYearLevel')?.value,
      section: document.getElementById('regSection')?.value,
      student_type: document.getElementById('regStudentType')?.value,
      email: document.getElementById('regEmail')?.value.trim(),
      password: document.getElementById('regPassword')?.value,
      role: document.getElementById('regRole')?.value,
      registration_role: document.getElementById('regRole')?.value,
    };
    const errEl = document.getElementById('authError');
    const requiredFields = ['first_name', 'last_name', 'student_number', 'email', 'password', 'role'];
    if (fields.role === 'student') {
      requiredFields.push('year_level', 'section', 'student_type');
    }
    if (requiredFields.some(key => !fields[key])) { errEl.textContent = 'Please fill in all fields'; errEl.classList.add('show'); return; }
    if (fields.password.length < 6) { errEl.textContent = 'Password must be at least 6 characters'; errEl.classList.add('show'); return; }
    try {
      errEl.classList.remove('show');
      const regData = await api('/api/auth/register', { method: 'POST', body: JSON.stringify(fields) });
      // Show the "check your email" screen
      state.registeredEmail = fields.email;
      authMode = 'registered';
      render();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.add('show');
    }
  }

  // ════════════════════════════════
  //  MAIN LAYOUT
  // ════════════════════════════════
  function renderLayout() {
    const u = state.user;
    const isAdmin = u.role === 'admin';
    const isFaculty = u.role === 'faculty' || isAdmin;

    return `
    <div class="app-layout">
      <!-- SIDEBAR (Desktop) -->
      <nav class="sidebar">
        <div class="sidebar-header">
          <div class="sidebar-brand">
            <div class="sidebar-brand-icon"><img src="/icons/pup_logo.png" alt="PUP Logo"></div>
            <div><h2>PUPSJ HUB</h2><small>San Juan Campus</small></div>
          </div>
        </div>
        <div class="sidebar-nav">
          <div class="nav-section-label">Main</div>
          <div class="nav-item active" data-page="announcements"><i class="fas fa-bullhorn"></i> Announcements</div>
          <div class="nav-item" data-page="events"><i class="fas fa-calendar-alt"></i> Event Calendar</div>
          <div class="nav-item" data-page="lostfound"><i class="fas fa-search-location"></i> Lost & Found</div>
          ${isFaculty ? `<div class="nav-item" data-page="teaching"><i class="fas fa-clock"></i> Teaching Schedule</div>` : `<div class="nav-item" data-page="section-schedules"><i class="fas fa-clock"></i> Class Schedules</div>`}
          <div class="nav-item" data-page="chatbot"><i class="fas fa-robot"></i> PUPBot</div>
          <div class="nav-item" data-page="documents"><i class="fas fa-folder-open"></i> Document Templates</div>
          <div class="nav-item" data-page="profile"><i class="fas fa-user-circle"></i> My Profile</div>
          ${isAdmin ? `
          <div class="nav-section-label">Administration</div>
          <div class="nav-item" data-page="admin-dashboard"><i class="fas fa-chart-pie"></i> Dashboard</div>
          <div class="nav-item" data-page="admin-users"><i class="fas fa-users-cog"></i> Manage Users</div>
          ` : ''}
        </div>
        <div class="sidebar-footer">
          <div class="sidebar-user">
            <div class="sidebar-avatar">${u.profile_image ? `<img src="${u.profile_image}" alt="avatar">` : getInitials(u.role === 'admin' ? u.first_name : u.first_name + ' ' + u.last_name)}</div>
            <div class="sidebar-user-info">
              <div class="sidebar-user-name">${u.role === 'admin' ? u.first_name : u.first_name + ' ' + u.last_name}</div>
              <div class="sidebar-user-role">${u.role}${u.department ? ' · ' + u.department : ''}</div>
            </div>
            <i class="fas fa-sign-out-alt sidebar-logout" id="logoutBtn" title="Logout"></i>
          </div>
        </div>
      </nav>

      <!-- Drawer scrim (mobile) -->
      <div class="sidebar-scrim" id="sidebarScrim"></div>

      <!-- MAIN -->
      <div class="main-content">
        <!-- Mobile Header -->
        <div class="top-header">
          <button class="hamburger-btn" id="hamburgerBtn" aria-label="Open menu"><i class="fas fa-bars"></i></button>
          <div class="top-header-brand">
            <div class="brand-icon"><img src="/icons/pup_logo.png" alt="PUP Logo"></div>
            PUPSJ HUB
          </div>
          <div class="top-header-actions">
            <button class="btn-icon" id="mobileLogout" title="Logout"><i class="fas fa-sign-out-alt"></i></button>
          </div>
        </div>

        <!-- Page Area -->
        <div class="page-area" id="pageArea"></div>

        <!-- Fixed Chat Input Bar (initially hidden) -->
        <div class="fixed-chat-input-wrapper" id="fixedChatInputWrapper" style="display:none;">
          <div class="chat-input-bar">
            <input type="text" id="chatInput" placeholder="Ask me anything about PUPSJ..." autocomplete="off">
            <button class="chat-send-btn" id="chatSend"><i class="fas fa-paper-plane"></i></button>
          </div>
        </div>

      </div>
    </div>`;
  }

  function bindLayoutEvents() {
    // Sidebar nav
    document.querySelectorAll('.nav-item[data-page]').forEach(el => {
      el.onclick = () => { navigateTo(el.dataset.page); closeSidebar(); };
    });
    // Hamburger menu (mobile)
    const hamburger = document.getElementById('hamburgerBtn');
    const scrim = document.getElementById('sidebarScrim');
    if (hamburger) hamburger.onclick = () => document.body.classList.add('sidebar-open');
    if (scrim) scrim.onclick = closeSidebar;
    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    const mobileLogout = document.getElementById('mobileLogout');
    const doLogout = async () => {
      await api('/api/auth/logout', { method: 'POST' });
      sessionStorage.removeItem('pupsj_token');
      state.user = null;
      state.currentPage = 'announcements';
      state.chatMessages = [];
      state.announcements = [];
      state.events = [];
      state.lostFound = [];
      state.adminStats = null;
      state.adminUsers = [];
      state.adminSelectedAllowedIds = new Set();
      Object.keys(pageLoadedAt).forEach(k => delete pageLoadedAt[k]);
      Object.keys(pageScrollCache).forEach(k => delete pageScrollCache[k]);
      showToast('Logged out', 'info');
      render();
    };
    if (logoutBtn) logoutBtn.onclick = doLogout;
    if (mobileLogout) mobileLogout.onclick = doLogout;
  }

  function closeSidebar() { document.body.classList.remove('sidebar-open'); }

  function navigateTo(page) {
    // Guard admin-only pages — redirect non-admins to announcements
    if ((page === 'admin-dashboard' || page === 'admin-users') && state.user?.role !== 'admin') {
      page = 'announcements';
    }

    // Save scroll position of current page before leaving
    const pageArea = document.getElementById('pageArea');
    if (!pageArea) return;

    // Save scroll position of current page before leaving
    if (state.currentPage && state.currentPage !== page) {
      pageScrollCache[state.currentPage] = pageArea.scrollTop;
    }

    // --- NEW LOGIC: Manage pageArea scrolling for chatbot ---
    if (page === 'chatbot') {
      pageArea.classList.add('no-scroll');
    } else {
      pageArea.classList.remove('no-scroll');
    }
    // --- END NEW LOGIC ---

    // --- NEW LOGIC: Manage fixed chat input bar visibility ---
    const fixedChatInputWrapper = document.getElementById('fixedChatInputWrapper');
    if (fixedChatInputWrapper) {
      if (page === 'chatbot') {
        fixedChatInputWrapper.style.display = 'flex';
      } else {
        fixedChatInputWrapper.style.display = 'none';
      }
    }
    // --- END NEW LOGIC ---

    // Stop Professor Locator polling when leaving announcements
    if (state.currentPage === 'announcements' && page !== 'announcements') {
      stopLocatorPolling();
    }
    state.currentPage = page;
    state.selectedEvent = null;
    // Update nav active states
    document.querySelectorAll('.nav-item[data-page]').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
    });

    if (!pageArea) return;

    switch (page) {
      case 'announcements': loadAnnouncements(true); break;
      case 'events': loadEvents(true); break;
      case 'lostfound': loadLostFound(true); break;
      case 'schedules': loadSchedules(true); break;
      case 'teaching': loadSchedules(true); break;
      case 'section-schedules': loadSectionSchedules(); break;
      case 'chatbot':
        renderChatbot();
        // Re-bind every navigation so the chatMessages reference is always fresh
        {
          const chatInput = document.getElementById('chatInput');
          const chatSend  = document.getElementById('chatSend');
          // sendChatMessage resolves chatMessages live via getElementById each call
          const send = () => {
            const msgs = document.getElementById('chatMessages');
            if (chatInput && msgs) sendChatMessage(chatInput, msgs);
          };
          if (chatInput) chatInput.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) send(); };
          if (chatSend)  chatSend.onclick = send;
        }
        break;
      case 'documents': loadDocuments(true); break;
      case 'profile': loadProfile(); break;
      case 'admin-dashboard': loadAdminDashboard(); break;
      case 'admin-users': loadAdminUsers(); break;
      default: loadAnnouncements();
    }
  }

  // ════════════════════════════════
  //  ANNOUNCEMENTS (Facebook-style)
  // ════════════════════════════════
  async function loadAnnouncements(fromNav = false) {
    const pageArea = document.getElementById('pageArea');

    // Restore from cache if navigating back and data is still fresh
    if (fromNav && state.announcements.length > 0 &&
        pageLoadedAt.announcements && Date.now() - pageLoadedAt.announcements < PAGE_CACHE_TTL) {
      renderAnnouncementsPage();
      requestAnimationFrame(() => { pageArea.scrollTop = pageScrollCache.announcements || 0; });
      startLocatorPolling();
      return;
    }

    pageArea.innerHTML = `<div class="page-header"><h1 class="page-title">Announcements</h1><p class="page-subtitle">Stay updated with campus news</p></div><div class="page-content"><div class="loader"><div class="spinner"></div></div></div>`;

    try {
      const deptParam = state.filters.department !== 'All' ? `?department=${state.filters.department}` : '';
      const [annData, schedData] = await Promise.all([
        api(`/api/announcements${deptParam}`),
        // Students need their own class schedules so the locator knows which faculty are "theirs"
        state.user.role === 'student' ? api('/api/schedules').catch(() => []) : Promise.resolve([]),
      ]);
      state.announcements = annData.announcements || [];
      if (state.user.role === 'student') state.schedules = schedData;
      pageLoadedAt.announcements = Date.now();
      renderAnnouncementsPage();
      // Kick off real-time locator
      startLocatorPolling();
    } catch (err) {
      pageArea.querySelector('.page-content').innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Failed to load</h3><p>${err.message}</p></div>`;
    }
  }

  function renderAnnouncementsPage() {
    const pageArea = document.getElementById('pageArea');
    const isFacultyOrAdmin = state.user.role === 'faculty' || state.user.role === 'admin';

    // Recent Posts sidebar: up to 5 most-recent active announcements
    const recentPosts = state.announcements.filter(a => a.status === 'active').slice(0, 5);

    // ── Media grid builder (Facebook-style) ──
    function buildMediaGrid(images) {
      const imgs = images.filter(img => img.id);
      if (imgs.length === 0) return '';
      const n = imgs.length;
      const cls = n === 1 ? 'ann-media-single'
                : n === 2 ? 'ann-media-double'
                : n === 3 ? 'ann-media-triple'
                : 'ann-media-quad';
      const visible = imgs.slice(0, 4);
      const extra   = n > 4 ? n - 4 : 0;
      const cells   = visible.map((img, i) => {
        const isLast = extra > 0 && i === 3;
        return `<div class="ann-media-cell${isLast ? ' ann-media-more' : ''}" onclick="window._openImageViewer('${img.image_url}')">
          <img src="${img.image_url}" alt="photo">
          ${isLast ? `<div class="ann-media-overlay">+${extra}</div>` : ''}
        </div>`;
      }).join('');
      return `<div class="ann-media-grid ${cls}">${cells}</div>`;
    }

    // ── Main feed — Facebook-style, full-width inline images ──
    const feedHtml = state.announcements.length === 0
      ? '<div class="empty-state"><i class="fas fa-newspaper"></i><h3>No announcements yet</h3><p>Check back later for updates</p></div>'
      : state.announcements.map(a => {
          const hasImg = a.images && a.images.length > 0 && a.images[0].id;
          const _aColor = getAvatarColor(a.author_name || 'U');
          return `
          <article class="card ann-post" id="ann-post-${a.id}" data-ann-id="${a.id}">
            <!-- Header -->
            <div class="ann-post-header">
              <div class="ann-post-avatar" style="${a.author_image ? '' : `background:${_aColor};`}">${a.author_image ? `<img src="${a.author_image}" alt="">` : getInitials(a.author_name||'U')}</div>
              <div class="ann-post-author-meta">
                <span class="ann-post-author">${escHtml(a.author_name || 'Unknown')}</span>
                <span class="ann-post-time">${a.author_role ? escHtml(a.author_role) + ' · ' : ''}${timeAgo(a.created_at)}</span>
              </div>
              <span class="ann-dept-badge">${escHtml(a.department)}</span>
              ${a.status === 'pending' ? '<span class="ann-status-pill ann-pending" title="Awaiting admin approval">Pending</span>' : ''}
              ${a.status === 'rejected' ? `<span class="ann-status-pill ann-rejected" title="${escHtml(a.rejection_reason || '')}">Rejected</span>` : ''}
            </div>

            <!-- Text body -->
            <div class="ann-post-body">
              ${a.is_pinned ? '<div class="ann-pin-badge"><i class="fas fa-thumbtack"></i> Pinned</div>' : ''}
              <h3 class="ann-post-title">${escHtml(a.title)}</h3>
              <p class="ann-post-text">${escHtml(a.content)}</p>
            </div>

            <!-- Full-width media (viewport-height-constrained) -->
            ${hasImg ? buildMediaGrid(a.images) : ''}

            <!-- Footer action bar -->
            <div class="ann-post-footer">
              <div class="ann-post-footer-left">
                <span class="ann-footer-time"><i class="fas fa-clock"></i> ${timeAgo(a.created_at)}</span>
                ${hasImg ? `<span class="ann-footer-imgcount"><i class="fas fa-image"></i> ${a.images.length}</span>` : ''}
              </div>
              ${(isFacultyOrAdmin || a.author_id === state.user.id) ? `
              <div class="ann-post-footer-right">
                <button class="ann-action-del" onclick="window._deleteAnnouncement('${a.id}')">
                  <i class="fas fa-trash-alt"></i> Delete
                </button>
              </div>` : ''}
            </div>
          </article>`;
        }).join('');

    // ── Right sidebar — Recent Posts (scrolls to post in feed on click) ──
    const sidebarHtml = `
      <aside class="ann-sidebar">
        <div class="ann-recent-widget">
          <div class="ann-recent-hdr">
            <i class="fas fa-history" style="color:var(--maroon);font-size:13px;"></i>
            <span>Recent Posts</span>
          </div>
          ${recentPosts.length === 0
            ? '<p class="ann-recent-empty">No posts yet</p>'
            : recentPosts.map(a => {
              const _rc = getAvatarColor(a.author_name || 'U');
              return `
              <div class="ann-recent-item" onclick="document.getElementById('ann-post-${a.id}')?.scrollIntoView({behavior:'smooth',block:'start'})">
                <div class="ann-recent-item-info">
                  <div class="ann-recent-avatar" style="${a.author_image ? '' : `background:${_rc};`}">${a.author_image ? `<img src="${a.author_image}" alt="">` : getInitials(a.author_name||'U')}</div>
                  <div class="ann-recent-item-text">
                    <p class="ann-recent-title">${escHtml(a.title)}</p>
                    <span class="ann-recent-meta">${escHtml(a.author_name || 'Unknown')} · ${timeAgo(a.created_at)}</span>
                  </div>
                </div>
                ${a.images && a.images.length > 0 && a.images[0].id
                  ? `<img class="ann-recent-thumb" src="${a.images[0].image_url}" alt="">`
                  : ''}
              </div>`;}).join('')}
        </div>
      </aside>`;

    const _firstName = state.user ? state.user.first_name : '';
    let html = `
      <div class="page-header">
        <div class="welcome-banner">
          <span class="welcome-greeting">${getGreeting()},</span>
          <span class="welcome-name">${escHtml(_firstName)}!</span>
          <span class="welcome-tagline">Here's what's happening at PUP San Juan.</span>
        </div>
        <h1 class="page-title">Announcements</h1>
        <p class="page-subtitle">Stay updated with campus news</p>
      </div>
      <div class="page-content">
        ${renderLocatorWidget()}
        <div class="filter-bar">
          ${departments.map(d => `<button class="filter-chip ${state.filters.department === d ? 'active' : ''}" data-dept="${d}">${d}</button>`).join('')}
        </div>
        <div class="ann-layout">
          <div class="ann-feed">${feedHtml}</div>
          ${sidebarHtml}
        </div>
      </div>`;

    if (isFacultyOrAdmin) {
      html += `<button class="fab" id="fabPost" title="New Announcement"><i class="fas fa-plus"></i></button>`;
    }

    pageArea.innerHTML = html;

    // Filter chips
    document.querySelectorAll('.filter-chip[data-dept]').forEach(el => {
      el.onclick = () => { state.filters.department = el.dataset.dept; loadAnnouncements(); };
    });
    // FAB
    const fab = document.getElementById('fabPost');
    if (fab) fab.onclick = () => openModal('announcement');
    // Professor Locator toggle
    bindLocatorEvents();

  }

  window._deleteAnnouncement = async (id) => {
    if (!confirm('Delete this announcement?')) return;
    try {
      await api(`/api/announcements/${id}`, { method: 'DELETE' });
      showToast('Announcement deleted', 'success');
      loadAnnouncements();
    } catch (err) { showToast(err.message, 'error'); }
  };

  // Image viewer
  window._openImageViewer = (src) => {
    const viewer = document.createElement('div');
    viewer.className = 'image-viewer-overlay';
    viewer.innerHTML = `<img src="${src}" alt="Full image"><button class="image-viewer-close"><i class="fas fa-times"></i></button>`;
    viewer.onclick = (e) => { if (e.target === viewer || e.target.closest('.image-viewer-close')) viewer.remove(); };
    document.body.appendChild(viewer);
  };

  // ════════════════════════════════
  //  EVENTS / CALENDAR + FEEDBACK
  // ════════════════════════════════
  async function loadEvents(fromNav = false) {
    const pageArea = document.getElementById('pageArea');

    if (fromNav && state.events.length > 0 &&
        pageLoadedAt.events && Date.now() - pageLoadedAt.events < PAGE_CACHE_TTL) {
      renderEventsPage();
      requestAnimationFrame(() => { pageArea.scrollTop = pageScrollCache.events || 0; });
      return;
    }

    pageArea.innerHTML = `<div class="page-header"><h1 class="page-title">Event Calendar</h1><p class="page-subtitle">Upcoming campus activities</p></div><div class="page-content"><div class="loader"><div class="spinner"></div></div></div>`;

    try {
      const data = await api(`/api/events?month=${state.calendarMonth + 1}&year=${state.calendarYear}`);
      state.events = data;
      pageLoadedAt.events = Date.now();
      renderEventsPage();
    } catch (err) {
      pageArea.querySelector('.page-content').innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Failed to load</h3></div>`;
    }
  }

  function renderEventsPage() {
    const pageArea = document.getElementById('pageArea');
    const isFacultyOrAdmin = state.user.role !== 'student';
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    // Build calendar
    const firstDay = new Date(state.calendarYear, state.calendarMonth, 1);
    const lastDay = new Date(state.calendarYear, state.calendarMonth + 1, 0);
    let startDay = firstDay.getDay() || 7; // Mon=1
    const today = new Date();
    const eventDates = new Set(state.events.map(e => new Date(e.event_date).getDate()));

    // Group events by day-of-month for inline chips
    const eventsByDay = {};
    state.events.forEach(e => {
      const day = new Date(e.event_date).getDate();
      if (!eventsByDay[day]) eventsByDay[day] = [];
      eventsByDay[day].push(e);
    });

    let calendarCells = '';
    const dayHeaders = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    calendarCells += dayHeaders.map(d => `<div class="calendar-day-header">${d}</div>`).join('');

    // Previous month padding
    const prevLast = new Date(state.calendarYear, state.calendarMonth, 0).getDate();
    for (let i = startDay - 1; i > 0; i--) {
      calendarCells += `<div class="calendar-day other-month"><span class="cal-day-num">${prevLast - i + 1}</span></div>`;
    }
    // Current month — with inline event chips
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const isToday = d === today.getDate() && state.calendarMonth === today.getMonth() && state.calendarYear === today.getFullYear();
      const dayEvents = eventsByDay[d] || [];
      const hasEvent = dayEvents.length > 0;
      const chipsHtml = dayEvents.slice(0, 2).map(e =>
        `<div class="cal-event-chip" onclick="event.stopPropagation();window._openEventDetail('${e.id}')" title="${escHtml(e.title)}">${escHtml(e.title)}</div>`
      ).join('');
      const moreHtml = dayEvents.length > 2 ? `<div class="cal-event-more">+${dayEvents.length - 2} more</div>` : '';
      calendarCells += `<div class="calendar-day${isToday ? ' today' : ''}${hasEvent ? ' has-event' : ''}">
        <span class="cal-day-num">${d}</span>
        ${hasEvent ? `<div class="cal-day-events">${chipsHtml}${moreHtml}</div>` : ''}
      </div>`;
    }
    // Next month padding
    const totalCells = startDay - 1 + lastDay.getDate();
    const remaining = 7 - (totalCells % 7);
    if (remaining < 7) {
      for (let i = 1; i <= remaining; i++) {
        calendarCells += `<div class="calendar-day other-month"><span class="cal-day-num">${i}</span></div>`;
      }
    }

    let html = `
      <div class="page-header"><h1 class="page-title">Event Calendar</h1><p class="page-subtitle">Campus activities & events</p></div>
      <div class="page-content">
        <div class="card" style="padding:20px;margin-bottom:20px;">
          <div class="calendar-nav">
            <button class="calendar-nav-btn" id="calPrev"><i class="fas fa-chevron-left"></i></button>
            <span class="calendar-month">${months[state.calendarMonth]} ${state.calendarYear}</span>
            <button class="calendar-nav-btn" id="calNext"><i class="fas fa-chevron-right"></i></button>
          </div>
          <div class="calendar-grid">${calendarCells}</div>
        </div>
        ${state.events.length === 0 ? '<div class="empty-state"><i class="fas fa-calendar-times"></i><h3>No events this month</h3><p>Check back later for upcoming events.</p></div>' : ''}
      </div>`;

    if (isFacultyOrAdmin) {
      html += `<button class="fab" id="fabEvent" title="Add Event"><i class="fas fa-plus"></i></button>`;
    }

    pageArea.innerHTML = html;

    document.getElementById('calPrev').onclick = () => {
      state.calendarMonth--;
      if (state.calendarMonth < 0) { state.calendarMonth = 11; state.calendarYear--; }
      loadEvents();
    };
    document.getElementById('calNext').onclick = () => {
      state.calendarMonth++;
      if (state.calendarMonth > 11) { state.calendarMonth = 0; state.calendarYear++; }
      loadEvents();
    };
    const fab = document.getElementById('fabEvent');
    if (fab) fab.onclick = () => openModal('event');
    window._deleteEvent = async (id) => {
      if (!confirm('Delete this event?')) return;
      try {
        await api(`/api/events/${id}`, { method: 'DELETE' });
        showToast('Event deleted', 'success');
        if (state.selectedEvent?.id === id) state.selectedEvent = null;
        loadEvents();
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  }

  // ── EVENT DETAIL + FEEDBACK ──
  window._openEventDetail = async (eventId) => {
    const event = state.events.find(e => e.id === eventId);
    if (!event) return;
    state.selectedEvent = event;

    const pageArea = document.getElementById('pageArea');
    pageArea.innerHTML = `<div class="page-content"><div class="loader"><div class="spinner"></div></div></div>`;

    try {
      const [feedback, summary] = await Promise.all([
        api(`/api/feedback/event/${eventId}`),
        api(`/api/feedback/event/${eventId}/summary`)
      ]);
      state.eventFeedback = feedback;
      renderEventDetail(event, feedback, summary);
    } catch (err) {
      state.eventFeedback = [];
      renderEventDetail(event, [], { total: 0, average_rating: 0 });
    }
  };

  function renderEventDetail(event, feedback, summary) {
    const pageArea = document.getElementById('pageArea');
    const d = new Date(event.event_date);
    const dateStr = d.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const hasImages = event.images && event.images.length > 0 && event.images[0].id;
    const avgRating = parseFloat(summary.average_rating) || 0;
    const totalFeedback = parseInt(summary.total) || 0;

    let html = `
      <div class="page-header" style="display:flex;align-items:center;gap:12px;">
        <button class="btn-icon" id="backToEvents" title="Back"><i class="fas fa-arrow-left"></i></button>
        <div>
          <h1 class="page-title">${escHtml(event.title)}</h1>
          <p class="page-subtitle">Event Details & Feedback</p>
        </div>
        ${(state.user.role === 'admin' || state.user.id === event.author_id) ? `<button class="btn btn-danger btn-sm" id="deleteEventBtn" style="margin-left:auto;width:auto;"><i class="fas fa-trash-alt"></i> Delete</button>` : ''}
      </div>
      <div class="page-content">
        <div class="card event-detail-card">
          ${hasImages ? `
          <div class="event-detail-images">
            ${event.images.map(img => `<img src="${img.image_url}" alt="event" onclick="window._openImageViewer('${img.image_url}')">`).join('')}
          </div>` : ''}
          <div class="event-detail-body">
            <div class="event-detail-date"><i class="fas fa-calendar-alt"></i> ${dateStr}</div>
            ${event.start_time ? `<div class="event-detail-time"><i class="fas fa-clock"></i> ${formatTime(event.start_time)}${event.end_time ? ' - ' + formatTime(event.end_time) : ''}</div>` : ''}
            ${event.location ? `<div class="event-detail-location"><i class="fas fa-map-marker-alt"></i> ${escHtml(event.location)}</div>` : ''}
            <div class="event-detail-author"><i class="fas fa-user"></i> Posted by ${escHtml(event.author_name || 'Unknown')}</div>
            ${event.status === 'pending' ? '<div><span class="status-pill status-pending">Pending Approval</span></div>' : ''}
            ${event.status === 'rejected' ? `<div><span class="status-pill status-rejected" title="${escHtml(event.rejection_reason || 'Rejected by admin')}">Rejected</span></div>` : ''}
            ${event.description ? `<p class="event-detail-desc">${escHtml(event.description)}</p>` : ''}
          </div>
        </div>

        <!-- Feedback Summary -->
        <div class="feedback-summary-section">
          <div class="feedback-summary-header">
            <h3><i class="fas fa-star"></i> Feedback & Reviews</h3>
            <div class="feedback-summary-stats">
              ${totalFeedback > 0 ? `
              <div class="feedback-avg-rating">
                <span class="feedback-avg-number">${avgRating}</span>
                <div class="feedback-avg-stars">
                  ${renderStars(avgRating)}
                  <span class="feedback-count">${totalFeedback} review${totalFeedback !== 1 ? 's' : ''}</span>
                </div>
              </div>` : '<span class="feedback-count">No reviews yet</span>'}
              ${state.user && (state.user.role === 'admin' || state.user.id === event.author_id) && totalFeedback >= 3 ? `
              <button class="btn btn-secondary btn-sm" onclick="window._showFeedbackInsights('${event.id}')" style="margin-left:12px;">
                <i class="fas fa-brain"></i> AI Insights
              </button>` : ''}
            </div>
          </div>
        </div>

        <!-- Write Feedback -->
        <div class="card feedback-form-card">
          <h4><i class="fas fa-pen"></i> Write a Review</h4>
          <div class="feedback-form">
            <div class="star-picker" id="starPicker">
              <span>Your Rating:</span>
              <div class="star-rating" id="feedbackStars">
                ${[1,2,3,4,5].map(i => `<i class="fas fa-star" data-val="${i}"></i>`).join('')}
              </div>
            </div>
            <input type="hidden" id="feedbackRating" value="0">
            <textarea class="form-input" id="feedbackComment" rows="3" placeholder="Share your experience about this event..." style="resize:vertical;"></textarea>
            <div class="form-group">
              <label style="font-size:13px;margin-bottom:6px;">Upload Event Photos</label>
              ${renderImageUploadWidget('feedbackImages')}
            </div>
            <button class="btn btn-primary btn-sm" id="submitFeedback" style="width:auto;"><i class="fas fa-paper-plane"></i> Submit Feedback</button>
          </div>
        </div>

        <!-- Feedback List -->
        <div class="feedback-list">
          ${feedback.length === 0 ? '<div class="empty-state" style="padding:24px;"><i class="fas fa-comments" style="font-size:36px;"></i><h3>No feedback yet</h3><p>Be the first to share your thoughts!</p></div>' :
          feedback.map(fb => `
            <div class="card feedback-card">
              <div class="feedback-card-header">
                ${renderAvatar(fb.user_name || 'U', fb.user_profile_image, 'feedback-avatar')}
                <div class="feedback-card-meta">
                  <span class="feedback-card-name">${escHtml(fb.user_name || 'User')}</span>
                  <div class="feedback-card-time">${timeAgo(fb.created_at)}</div>
                </div>
                <div class="feedback-card-rating">${renderStars(fb.rating)}</div>
                ${(fb.user_id === state.user.id || state.user.role === 'admin') ? '<button class="btn-icon" onclick="window._deleteFeedback(\'' + fb.id + '\',\'' + event.id + '\')" title="Delete feedback" style="margin-left:auto;color:var(--danger);"><i class="fas fa-trash"></i></button>' : ''}
              </div>
              ${fb.comment ? `<p class="feedback-card-text">${escHtml(fb.comment)}</p>` : ''}
              ${fb.images && fb.images.length > 0 && fb.images[0].id ? `
              <div class="feedback-card-images">
                ${fb.images.map(img => `<img src="${img.image_url}" alt="feedback" onclick="window._openImageViewer('${img.image_url}')">`).join('')}
              </div>` : ''}
            </div>`).join('')}
        </div>
      </div>`;

    pageArea.innerHTML = html;

    // Back button
    document.getElementById('backToEvents').onclick = () => {
      state.selectedEvent = null;
      renderEventsPage();
    };
    const deleteEventBtn = document.getElementById('deleteEventBtn');
    if (deleteEventBtn) deleteEventBtn.onclick = () => window._deleteEvent(event.id);

    // Star picker
    const stars = document.querySelectorAll('#feedbackStars i');
    const ratingInput = document.getElementById('feedbackRating');
    stars.forEach(star => {
      star.onclick = () => {
        const val = parseInt(star.dataset.val);
        ratingInput.value = val;
        stars.forEach((s, i) => s.classList.toggle('active', i < val));
      };
      star.onmouseenter = () => {
        const val = parseInt(star.dataset.val);
        stars.forEach((s, i) => s.classList.toggle('hover', i < val));
      };
      star.onmouseleave = () => {
        stars.forEach(s => s.classList.remove('hover'));
      };
    });

    // Image upload for feedback
    bindImageUpload('feedbackImages');

    // Submit feedback
    document.getElementById('submitFeedback').onclick = async () => {
      const rating = parseInt(ratingInput.value);
      const comment = document.getElementById('feedbackComment').value.trim();
      if (!rating) { showToast('Please select a rating', 'error'); return; }

      const formData = new FormData();
      formData.append('event_id', event.id);
      formData.append('rating', rating);
      formData.append('comment', comment);
      pendingFiles.forEach(f => formData.append('images', f));

      document.getElementById('submitFeedback').disabled = true;
      try {
        await apiFormData('/api/feedback', formData);
        showToast('Feedback submitted!', 'success');
        pendingFiles = [];
        window._openEventDetail(event.id);
      } catch (err) {
        showToast(err.message, 'error');
        document.getElementById('submitFeedback').disabled = false;
      }
    };
  }

  window._deleteFeedback = async (feedbackId, eventId) => {
    if (!confirm('Delete this feedback?')) return;
    try {
      await api('/api/feedback/' + feedbackId, { method: 'DELETE' });
      showToast('Feedback deleted', 'success');
      window._openEventDetail(eventId);
    } catch (err) { showToast(err.message, 'error'); }
  };

  window._showFeedbackInsights = async (eventId) => {
    let modal = document.getElementById('insightsModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'insightsModal';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(2px);';
      modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
      document.body.appendChild(modal);
    }
    const cardStyle = 'background:var(--bg-card);border-radius:16px;width:100%;max-width:640px;max-height:85vh;overflow-y:auto;padding:28px;box-shadow:0 24px 64px rgba(0,0,0,0.6);';
    modal.innerHTML = `
      <div style="${cardStyle}">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <h2 style="margin:0;font-size:1.2rem;display:flex;align-items:center;gap:10px;"><i class="fas fa-brain" style="color:var(--primary);"></i> AI Feedback Insights</h2>
          <button onclick="document.getElementById('insightsModal').remove()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:var(--text-secondary);line-height:1;">&times;</button>
        </div>
        <div style="text-align:center;padding:40px 0;"><div class="spinner"></div><p style="margin-top:12px;color:var(--text-secondary);">Analyzing feedback...</p></div>
      </div>`;

    try {
      const data = await api(`/api/feedback/event/${eventId}/insights`);
      const sentColor = s => s === 'positive' ? 'var(--success)' : s === 'negative' ? 'var(--danger)' : 'var(--warning)';
      const ratingBar = (label, count, total) => {
        const pct = total ? Math.round((count / total) * 100) : 0;
        return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span style="width:20px;text-align:right;font-size:.85rem;">${label}</span>
          <i class="fas fa-star" style="color:#f59e0b;font-size:.75rem;"></i>
          <div style="flex:1;height:8px;background:var(--bg-soft);border-radius:4px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:var(--primary);border-radius:4px;"></div>
          </div>
          <span style="font-size:.8rem;color:var(--text-secondary);width:28px;">${count}</span>
        </div>`;
      };

      const dist   = data.rating_distribution || {};
      const total  = Object.values(dist).reduce((a, b) => a + b, 0);
      const sent   = data.sentiment_breakdown || {};
      const suggestions    = data.suggestions || [];
      const complaintThemes = data.complaint_themes || [];
      const analysisQuality = data.analysis_quality || {};
      const sampleLevelColor = analysisQuality.sample_level === 'strong'
        ? 'var(--success)'
        : analysisQuality.sample_level === 'moderate'
          ? 'var(--warning)'
          : 'var(--danger)';

      const sentIcons = { positive:'fa-smile', neutral:'fa-meh', negative:'fa-frown' };
      const catIcons  = { timeliness:'fa-clock', food_refreshments:'fa-utensils', venue_comfort:'fa-building', av_equipment:'fa-microphone', organization:'fa-tasks', content_relevance:'fa-book', duration:'fa-hourglass-half', registration:'fa-clipboard-list', communication:'fa-bullhorn', safety:'fa-shield-alt' };

      const sectionCard = (content) => `<div style="background:var(--bg-primary);border-radius:12px;padding:16px;margin-bottom:16px;">${content}</div>`;
      const sectionLabel = (text) => `<h4 style="margin:0 0 12px;font-size:.78rem;font-weight:700;letter-spacing:.06em;color:var(--text-secondary);">${text}</h4>`;

      modal.querySelector('div').innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <h2 style="margin:0;font-size:1.2rem;display:flex;align-items:center;gap:10px;"><i class="fas fa-brain" style="color:var(--primary);"></i> AI Feedback Insights</h2>
          <button onclick="document.getElementById('insightsModal').remove()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:var(--text-secondary);line-height:1;">&times;</button>
        </div>

        <!-- Ratings + Sentiment -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
          ${sectionCard(`${sectionLabel('RATING BREAKDOWN')}${[5,4,3,2,1].map(n => ratingBar(n, dist[n]||0, total)).join('')}`)}
          ${sectionCard(`${sectionLabel('SENTIMENT')}${['positive','neutral','negative'].map(s=>`
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
              <i class="fas ${sentIcons[s]}" style="color:${sentColor(s)};width:18px;font-size:1.1rem;"></i>
              <span style="text-transform:capitalize;flex:1;font-size:.95rem;">${s}</span>
              <strong style="font-size:1.1rem;">${sent[s]||0}</strong>
            </div>`).join('')}`)}
        </div>

        ${analysisQuality.summary ? sectionCard(`
          ${sectionLabel('ANALYSIS QUALITY')}
          <div style="display:flex;gap:12px;align-items:flex-start;">
            <i class="fas fa-shield-alt" style="color:${sampleLevelColor};margin-top:2px;flex-shrink:0;"></i>
            <div>
              <p style="margin:0 0 8px;font-size:.9rem;line-height:1.55;">${escHtml(analysisQuality.summary)}</p>
              <p style="margin:0;font-size:.75rem;color:var(--text-secondary);">
                Usable comments: ${data.usable_responses || total}/${data.total_responses || total}
                ${data.raw_usable_responses && data.raw_usable_responses !== data.usable_responses ? ` • Raw usable before merge: ${escHtml(String(data.raw_usable_responses))}` : ''}
                ${data.duplicate_comments_collapsed ? ` • Duplicate comments merged: ${escHtml(String(data.duplicate_comments_collapsed))}` : ''}
                ${analysisQuality.negative_evidence_level ? ` • Negative evidence: ${escHtml(String(analysisQuality.negative_evidence_level).replace(/_/g, ' '))}` : ''}
              </p>
            </div>
          </div>
        `) : ''}

        <!-- Suggestions -->
        ${suggestions.length ? sectionCard(`
          ${sectionLabel('ACTIONABLE SUGGESTIONS')}
          ${suggestions.map((s,i) => `
            <div style="display:flex;gap:12px;align-items:flex-start;${i<suggestions.length-1?'margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--bg-soft);':''}">
              <i class="fas ${catIcons[s.category]||'fa-lightbulb'}" style="color:var(--primary);margin-top:2px;flex-shrink:0;width:16px;"></i>
              <div>
                <p style="margin:0;font-size:.875rem;line-height:1.55;">${escHtml(s.recommendation)}</p>
                ${s.support_hits ? `<p style="margin:6px 0 0;font-size:.72rem;color:var(--text-secondary);">Support signals: ${escHtml(String(s.support_hits))}</p>` : ''}
              </div>
            </div>`).join('')}`) : ''}

        <p style="margin:0;font-size:.72rem;color:var(--text-secondary);text-align:right;">${data.usable_responses || total} usable responses analyzed</p>
      `;
    } catch (err) {
      modal.querySelector('div').innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <h2 style="margin:0;font-size:1.2rem;"><i class="fas fa-brain"></i> AI Feedback Insights</h2>
          <button onclick="document.getElementById('insightsModal').remove()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;">&times;</button>
        </div>
        <div style="text-align:center;padding:24px;color:var(--danger);"><i class="fas fa-exclamation-circle" style="font-size:2rem;"></i><p style="margin-top:8px;">${escHtml(err.message)}</p></div>`;
    }
  };

  function renderStars(rating) {
    const r = Math.round(parseFloat(rating));
    return [1,2,3,4,5].map(i => `<i class="fas fa-star${i <= r ? ' active' : ''}"></i>`).join('');
  }

  // ════════════════════════════════
  //  LOST & FOUND
  // ════════════════════════════════
  async function loadLostFound(fromNav = false) {
    const pageArea = document.getElementById('pageArea');

    if (fromNav && state.lostFound.length > 0 &&
        pageLoadedAt.lostfound && Date.now() - pageLoadedAt.lostfound < PAGE_CACHE_TTL) {
      renderLostFoundPage();
      requestAnimationFrame(() => { pageArea.scrollTop = pageScrollCache.lostfound || 0; });
      return;
    }

    pageArea.innerHTML = `<div class="page-header"><h1 class="page-title">Lost & Found</h1><p class="page-subtitle">Report or find missing items</p></div><div class="page-content"><div class="loader"><div class="spinner"></div></div></div>`;

    try {
      // Students are server-enforced to lost-only; client also locks to 'lost'
      let lfQuery = '';
      if (state.user.role === 'student') {
        lfQuery = '?type=lost';
      } else if (state.filters.lfType === 'resolved') {
        lfQuery = '?status=resolved';
      } else if (state.filters.lfType !== 'all') {
        lfQuery = `?type=${state.filters.lfType}`;
      }
      const data = await api(`/api/lost-found${lfQuery}`);
      state.lostFound = data;
      if (state.user.role === 'admin') {
        state.lostFoundReviews = await api('/api/lost-found/review/pending').catch(() => []);
      } else {
        state.lostFoundReviews = [];
      }
      pageLoadedAt.lostfound = Date.now();
      renderLostFoundPage();
    } catch (err) {
      pageArea.querySelector('.page-content').innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Failed to load</h3></div>`;
    }
  }

  function renderLostFoundPage() {
    const pageArea = document.getElementById('pageArea');
    const isStudent = state.user.role === 'student';
    const isAdmin = state.user.role === 'admin';
    const canPost = true;

    let html = `
      <div class="page-header">
        <h1 class="page-title">Lost & Found</h1>
        <p class="page-subtitle">${isAdmin ? 'Manage lost & found reports' : 'Browse lost-item reports and submit your own report'}</p>
      </div>
      <div class="page-content">
        ${isAdmin && state.lostFoundReviews.length > 0 ? `
          <div class="card lf-review-queue">
            <div class="lf-review-head">
              <h3>Pending AI Match Reviews</h3>
              <p>The AI suggested these pairs. Approve only after visually verifying the item and claim details.</p>
            </div>
            <div class="lf-review-list">
              ${state.lostFoundReviews.map(review => `
                <div class="lf-review-card">
                  <div class="lf-review-columns">
                    <div class="lf-review-side">
                      <div class="lf-review-label">Found Item</div>
                      <h4>${escHtml(review.item_name)}</h4>
                      <p>${escHtml(review.description || '')}</p>
                      <div class="lf-card-meta">
                        ${review.category ? `<span><i class="fas fa-tag"></i> ${escHtml(review.category)}</span>` : ''}
                        ${review.location_found ? `<span><i class="fas fa-map-marker-alt"></i> ${escHtml(review.location_found)}</span>` : ''}
                        ${review.reporter_name ? `<span><i class="fas fa-user"></i> ${escHtml(review.reporter_name)}</span>` : ''}
                      </div>
                      ${review.images && review.images.length > 0 ? `
                        <div class="lf-card-images">
                          ${review.images.map(img => `<img src="${img.image_url}" alt="found item" onclick="window._openImageViewer('${img.image_url}')">`).join('')}
                        </div>` : ''}
                    </div>
                    <div class="lf-review-side">
                      <div class="lf-review-label">Matched Lost Report</div>
                      <h4>${escHtml(review.partner?.item_name || 'Unknown')}</h4>
                      <p>${escHtml(review.partner?.description || '')}</p>
                      <div class="lf-card-meta">
                        ${review.partner?.category ? `<span><i class="fas fa-tag"></i> ${escHtml(review.partner.category)}</span>` : ''}
                        ${review.partner?.location_found ? `<span><i class="fas fa-map-marker-alt"></i> ${escHtml(review.partner.location_found)}</span>` : ''}
                        ${review.partner?.reporter_name ? `<span><i class="fas fa-user"></i> ${escHtml(review.partner.reporter_name)}</span>` : ''}
                        ${review.match_score ? `<span><i class="fas fa-chart-line"></i> ${Math.round(Number(review.match_score) * 100)}%</span>` : ''}
                      </div>
                    </div>
                  </div>
                  <div class="lf-review-actions">
                    <button class="btn btn-success btn-sm" onclick="window._decideLostFoundReview('${review.id}','approve')"><i class="fas fa-check"></i> Approve Match</button>
                    <button class="btn btn-danger btn-sm" onclick="window._decideLostFoundReview('${review.id}','reject')"><i class="fas fa-times"></i> Reject Match</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
        <div class="lf-tabs">
          ${!isAdmin ? `
            <button class="lf-tab active" data-type="lost">Lost Items</button>
          ` : `
            <button class="lf-tab ${state.filters.lfType === 'all' ? 'active' : ''}" data-type="all">All</button>
            <button class="lf-tab ${state.filters.lfType === 'lost' ? 'active' : ''}" data-type="lost">Lost</button>
            <button class="lf-tab ${state.filters.lfType === 'found' ? 'active' : ''}" data-type="found">Found</button>
            <button class="lf-tab ${state.filters.lfType === 'resolved' ? 'active' : ''}" data-type="resolved">Resolved</button>
          `}
        </div>
        ${state.lostFound.length === 0 ? `
          <div class="empty-state">
            <i class="fas fa-box-open"></i>
            <h3>${state.filters.lfType === 'resolved' ? 'No resolved cases yet' : 'No items reported'}</h3>
            <p>${canPost ? 'Report a lost or found item using the + button.' : 'Check back later.'}</p>
          </div>` :
        state.lostFound.map(item => {
          const isResolved = item.status === 'resolved';
          const canManage = item.reporter_id === state.user.id || state.user.role === 'admin';
          const canResolve = state.user.role === 'admin' && !isResolved;
          const showPendingHintAdmin = isAdmin && item.match_review_status === 'pending';
          const showPendingHintUser = !isAdmin && item.reporter_id === state.user.id && item.match_review_status === 'pending';
          const showApprovedHint = item.match_review_status === 'approved' || item.status === 'matched';
          return `
          <div class="card lf-card${isResolved ? ' lf-card--resolved' : ''}">
            <div class="lf-card-header">
              <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start;">
                <span class="lf-type-badge ${item.type}">${item.type}</span>
                ${isResolved ? '<span class="lf-resolved-badge"><i class="fas fa-check-circle"></i> Resolved</span>' : ''}
              </div>
              <div style="flex:1">
                <h4 style="${isResolved ? 'text-decoration:line-through;opacity:0.6;' : ''}">${escHtml(item.item_name)}</h4>
                <p>${escHtml(item.description)}</p>
                <div class="lf-card-meta">
                  ${item.category ? `<span><i class="fas fa-tag"></i> ${escHtml(item.category)}</span>` : ''}
                  ${item.location_found ? `<span><i class="fas fa-map-marker-alt"></i> ${escHtml(item.location_found)}</span>` : ''}
                  <span><i class="fas fa-clock"></i> ${timeAgo(item.created_at)}</span>
                  ${item.reporter_name ? `<span><i class="fas fa-user"></i> ${escHtml(item.reporter_name)}</span>` : ''}
                </div>
                ${item.contact_info ? `<div style="margin-top:6px;font-size:12px;color:var(--text-secondary);"><i class="fas fa-address-card"></i> ${escHtml(item.contact_info)}</div>` : ''}
              </div>
            </div>
            ${item.images && item.images.length > 0 && item.images[0].id ? `
            <div class="lf-card-images">
              ${item.images.map(img => `<img src="${img.image_url}" alt="item" onclick="window._openImageViewer('${img.image_url}')">`).join('')}
            </div>` : ''}
            ${showPendingHintAdmin ? `<div class="lf-match-hint"><i class="fas fa-magic"></i> AI suggested a pending match review.</div>` : ''}
            ${showPendingHintUser ? `<div class="lf-match-hint"><i class="fas fa-search"></i> Possible match found. Please check with the office.</div>` : ''}
            ${(!showPendingHintAdmin && !showPendingHintUser) && showApprovedHint ? `<div class="lf-match-hint"><i class="fas fa-check-circle"></i> Match confirmed by admin.</div>` : ''}
            ${canManage ? `
              <div class="lf-card-actions">
                ${canResolve ? `<button class="btn btn-success btn-sm" onclick="window._resolveLostFound('${item.id}')"><i class="fas fa-check-circle"></i> Mark Resolved</button>` : ''}
                ${!isResolved ? `<button class="btn btn-secondary btn-sm" onclick="window._editLostFound('${item.id}')"><i class="fas fa-edit"></i> Edit</button>` : ''}
                <button class="btn btn-danger btn-sm" onclick="window._deleteLostFound('${item.id}')"><i class="fas fa-trash-alt"></i> Delete</button>
              </div>` : ''}
            <div class="lf-card-footer">
              <button class="btn btn-secondary btn-sm lf-ai-match-btn" onclick="window._findLFMatches('${item.id}')"><i class="fas fa-magic"></i> Find AI Matches</button>
            </div>
            ${state.lfMatchingId === item.id && state.lfMatches ? `
            <div class="lf-match-panel">
              <div class="lf-match-panel-title"><i class="fas fa-robot"></i> AI Match Results</div>
              ${state.lfMatches.length === 0
                ? '<div class="lf-match-empty">No strong matches found yet.</div>'
                : state.lfMatches.map(m => `
                <div class="lf-match-card">
                  <div class="lf-match-card-header">
                    <span class="lf-type-badge ${m.type}">${m.type}</span>
                    <span class="match-score-badge score-${m.match_score >= 70 ? 'high' : m.match_score >= 40 ? 'mid' : 'low'}">${m.match_score}% match</span>
                  </div>
                  <div class="lf-match-card-body">
                    <strong>${escHtml(m.item_name)}</strong>
                    <p>${escHtml(m.description)}</p>
                    ${m.location_found ? `<div class="lf-match-loc"><i class="fas fa-map-marker-alt"></i> ${escHtml(m.location_found)}</div>` : ''}
                    ${m.image_analysis_used && m.image_match_score != null ? `<div class="lf-match-loc"><i class="fas fa-image"></i> Image analysis match: ${Math.round(Number(m.image_match_score) * 100)}%</div>` : ''}
                    ${m.common_keywords && m.common_keywords.length > 0 ? `<div class="lf-match-keywords">${m.common_keywords.map(k => `<span class="kw-chip">${escHtml(k)}</span>`).join('')}</div>` : ''}
                    ${m.contact_info ? `<div class="lf-match-contact"><i class="fas fa-phone"></i> ${escHtml(m.contact_info)}</div>` : ''}
                  </div>
                </div>`).join('')}
            </div>` : ''}
          </div>`;
        }).join('')}
      </div>
      ${canPost ? '<button class="fab" id="fabLF" title="Report Item"><i class="fas fa-plus"></i></button>' : ''}`;

    pageArea.innerHTML = html;

    document.querySelectorAll('.lf-tab').forEach(el => {
      el.onclick = () => {
        state.filters.lfType = el.dataset.type;
        loadLostFound();
      };
    });
    if (canPost) {
      document.getElementById('fabLF').onclick = () => openModal('lostfound');
    }
  }

  window._findLFMatches = async (id) => {
    if (state.lfMatchingId === id) {
      state.lfMatchingId = null;
      state.lfMatches = null;
      renderLostFoundPage();
      return;
    }
    state.lfMatchingId = id;
    state.lfMatches = null;
    renderLostFoundPage();
    try {
      const data = await api(`/api/lost-found/${id}/matches`);
      state.lfMatches = data.matches || [];
      renderLostFoundPage();
    } catch (err) {
      showToast('Failed to find matches', 'error');
      state.lfMatchingId = null;
    }
  };

  window._resolveLostFound = (id) => {
    const item = state.lostFound.find(i => i.id === id);
    openModal('resolve-confirm', { id, item_name: item ? item.item_name : '' });
  };

  window._editLostFound = (id) => {
    const item = state.lostFound.find(i => i.id === id);
    if (!item) return;
    openModal('lostfound-edit', item);
  };

  window._deleteLostFound = async (id) => {
    if (!confirm('Delete this item?')) return;
    try {
      await api(`/api/lost-found/${id}`, { method: 'DELETE' });
      showToast('Item deleted', 'success');
      loadLostFound();
    } catch (err) { showToast(err.message || 'Delete failed', 'error'); }
  };

  window._decideLostFoundReview = async (id, decision) => {
    const actionLabel = decision === 'approve' ? 'approve' : 'reject';
    if (!confirm(`Are you sure you want to ${actionLabel} this AI match suggestion?`)) return;
    try {
      const res = await api(`/api/lost-found/review/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ decision }),
      });
      showToast(res.message || 'Review updated', 'success');
      loadLostFound();
    } catch (err) {
      showToast(err.message || 'Failed to update match review', 'error');
    }
  };

  // ════════════════════════════════
  //  SECTION SCHEDULES DIRECTORY
  // ════════════════════════════════
  async function loadSectionSchedules() {
    const pageArea = document.getElementById('pageArea');
    pageArea.innerHTML = `<div class="page-header"><h1 class="page-title">Class Schedules</h1><p class="page-subtitle">Browse posted schedules by section</p></div><div class="page-content"><div class="loader"><div class="spinner"></div></div></div>`;
    try {
      const data = await api('/api/section-schedules');
      const isStudent = state.user.role === 'student';

      if (isStudent) {
        // Backend returns { schedules, incomplete_profile, student_info }
        state.sectionSchedules = data.schedules || [];
        state.scheduleStudentInfo = data.student_info || {};
        state.scheduleIncompleteProfile = data.incomplete_profile || false;
      } else {
        // Faculty/admin: backend returns a plain array
        state.sectionSchedules = Array.isArray(data) ? data : (data.schedules || []);
        state.scheduleStudentInfo = null;
        state.scheduleIncompleteProfile = false;
      }
      renderSectionSchedulesPage();
    } catch (err) {
      pageArea.querySelector('.page-content').innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Failed to load</h3><p>${escHtml(err.message)}</p></div>`;
    }
  }

  function renderSectionSchedulesPage() {
    const pageArea = document.getElementById('pageArea');
    const isStudent = state.user.role === 'student';
    const canPost   = state.user.role === 'faculty' || state.user.role === 'admin';

    // ── STUDENT VIEW ──────────────────────────────────────────────
    if (isStudent) {
      const info = state.scheduleStudentInfo || {};
      const dept    = info.dept    || state.user.department || '';
      const year    = info.year    || state.user.year_level || '';
      const section = info.section || state.user.section    || '';

      // Incomplete profile — guide them to update
      if (state.scheduleIncompleteProfile || !dept || !year || !section) {
        pageArea.innerHTML = `
          <div class="page-header">
            <h1 class="page-title">Class Schedules</h1>
            <p class="page-subtitle">Your posted class schedule</p>
          </div>
          <div class="page-content">
            <div class="empty-state">
              <i class="fas fa-user-edit" style="color:var(--gold);"></i>
              <h3>Profile Incomplete</h3>
              <p>Your department, year level, and section must be set before schedules can be shown.</p>
              <button class="btn btn-primary" style="margin-top:16px;" onclick="navigateTo('profile')">
                <i class="fas fa-user-edit"></i> Update My Profile
              </button>
            </div>
          </div>`;
        return;
      }

      const items = state.sectionSchedules;

      // Build schedule cards for the student
      const scheduleCards = items.length === 0
        ? `<div class="empty-state">
             <i class="fas fa-calendar-alt"></i>
             <h3>No schedule posted yet</h3>
             <p>Your faculty or admin hasn't posted a schedule for <strong>${escHtml(dept)} · ${escHtml(year)} Year · Section ${escHtml(section)}</strong> yet. Check back later.</p>
           </div>`
        : items.map(s => `
            <div class="sched-student-card">
              <div class="sched-student-card-icon"><i class="fas fa-calendar-alt"></i></div>
              <div class="sched-student-card-body">
                <div class="sched-student-card-title">${escHtml(s.title || 'Class Schedule')}</div>
                <div class="sched-student-card-meta">
                  <span><i class="fas fa-building"></i> ${escHtml(s.department)}</span>
                  <span><i class="fas fa-layer-group"></i> ${escHtml(s.year_level)} Year</span>
                  <span><i class="fas fa-users"></i> Section ${escHtml(s.section)}</span>
                </div>
                <div class="sched-student-card-by">Posted by ${escHtml(s.posted_by_name || 'Faculty')}</div>
              </div>
              <div class="sched-student-card-actions">
                ${s.embed_url
                  ? `<a href="${escHtml(s.embed_url)}" target="_blank" class="btn btn-primary btn-sm sched-open-btn">
                       <i class="fas fa-external-link-alt"></i> Open Schedule
                     </a>`
                  : `<span class="sched-no-link-label"><i class="fas fa-clock"></i> Link coming soon</span>`}
              </div>
            </div>`).join('');

      pageArea.innerHTML = `
        <div class="page-header">
          <h1 class="page-title">Class Schedules</h1>
          <p class="page-subtitle">Your posted class schedule</p>
        </div>
        <div class="page-content">
          <div class="sched-student-identity-bar">
            <span class="sched-identity-badge"><i class="fas fa-building"></i> ${escHtml(dept)}</span>
            <span class="sched-identity-badge"><i class="fas fa-layer-group"></i> ${escHtml(year)} Year</span>
            <span class="sched-identity-badge"><i class="fas fa-users"></i> Section ${escHtml(section)}</span>
          </div>
          ${scheduleCards}
        </div>`;
      return;
    }

    // ── FACULTY / ADMIN VIEW ──────────────────────────────────────
    let items = state.sectionSchedules;

    // Active filters
    const fDept = state.scheduleFilterDept || 'All';
    const fYear = state.scheduleFilterYear || '';
    const fSec  = state.scheduleFilterSection || '';

    // Apply filters
    if (fDept !== 'All') items = items.filter(s => s.department === fDept);
    if (fYear) items = items.filter(s => s.year_level === fYear);
    if (fSec)  items = items.filter(s => s.section === fSec);

    // Collect unique depts/years/sections for filter dropdowns
    const allDepts = [...new Set(state.sectionSchedules.map(s => s.department))].sort();
    const allYears = [...new Set(state.sectionSchedules.map(s => s.year_level))].sort();
    const allSecs  = [...new Set(state.sectionSchedules.map(s => s.section))].sort();

    // Group: dept → year_level → section → []
    const grouped = {};
    items.forEach(s => {
      if (!grouped[s.department]) grouped[s.department] = {};
      if (!grouped[s.department][s.year_level]) grouped[s.department][s.year_level] = {};
      if (!grouped[s.department][s.year_level][s.section]) grouped[s.department][s.year_level][s.section] = [];
      grouped[s.department][s.year_level][s.section].push(s);
    });

    // Dept color palette
    const DEPT_COLORS = ['#800000','#1565c0','#2e7d32','#6a1b9a','#e65100','#00695c','#ad1457','#4527a0'];
    const deptColorMap = {};
    allDepts.forEach((d, i) => { deptColorMap[d] = DEPT_COLORS[i % DEPT_COLORS.length]; });

    const deptHtml = Object.entries(grouped).map(([dept, years]) => {
      const deptColor = deptColorMap[dept] || '#800000';
      const deptTotal = Object.values(years).reduce((acc, secs) => acc + Object.values(secs).flat().length, 0);
      const yearsHtml = Object.keys(years).sort().map(yr => {
        const sections = years[yr];
        const yearTotal = Object.values(sections).flat().length;
        const secHtml = Object.keys(sections).sort().map(sec => {
          const list = sections[sec];
          const rowHtml = list.map(s => `
            <div class="sched-row ${s.is_active ? '' : 'sched-row-inactive'}">
              <div class="sched-row-icon-wrap"><i class="fas fa-calendar-alt sched-row-icon"></i></div>
              <div class="sched-row-body">
                <span class="sched-row-title">${escHtml(s.title || 'CLASS SCHEDULE [' + s.section + ']')}</span>
                <span class="sched-row-by">by ${escHtml(s.posted_by_name || 'Unknown')}</span>
              </div>
              <div class="sched-row-actions">
                ${s.embed_url
                  ? `<a href="${escHtml(s.embed_url)}" target="_blank" class="sched-row-link-btn" title="Open schedule"><i class="fas fa-external-link-alt"></i></a>`
                  : `<span class="sched-no-link" title="No link provided"><i class="fas fa-unlink"></i></span>`}
                <button class="sched-row-btn sched-row-toggle" onclick="window._toggleSectionSchedule('${s.id}')" title="${s.is_active ? 'Deactivate' : 'Activate'}">
                  <i class="fas fa-${s.is_active ? 'eye' : 'eye-slash'}"></i>
                </button>
                <button class="sched-row-btn sched-row-del" onclick="window._deleteSectionSchedule('${s.id}')" title="Delete">
                  <i class="fas fa-trash"></i>
                </button>
              </div>
            </div>`).join('');
          return `
            <div class="sched-section-group">
              <div class="sched-section-header">
                <span class="sched-section-label"><i class="fas fa-users"></i> Section ${escHtml(sec)}</span>
                <span class="sched-section-count">${list.length}</span>
              </div>
              ${rowHtml}
            </div>`;
        }).join('');
        return `
          <div class="sched-year-group">
            <div class="sched-year-header">${escHtml(yr)} Year &mdash; <span>${yearTotal} schedule${yearTotal !== 1 ? 's' : ''}</span></div>
            ${secHtml}
          </div>`;
      }).join('');
      return `
        <div class="sched-dept-group">
          <div class="sched-dept-header" style="background:${deptColor};">
            <span class="sched-dept-name"><i class="fas fa-graduation-cap"></i> ${escHtml(dept)}</span>
            <span class="sched-dept-count">${deptTotal}</span>
          </div>
          <div class="sched-dept-body">${yearsHtml}</div>
        </div>`;
    }).join('');

    const emptyState = `<div class="empty-state"><i class="fas fa-calendar-alt"></i><h3>No schedules found</h3><p>Post a schedule using the button above to get started.</p></div>`;

    pageArea.innerHTML = `
      <div class="page-header"><h1 class="page-title">Class Schedules</h1><p class="page-subtitle">Manage posted schedules by section</p></div>
      <div class="page-content">
        <button class="sched-post-btn" id="schedPostBtn"><i class="fas fa-plus"></i> Post Schedule</button>
        <div class="sched-filter-bar">
          <select class="sched-filter-select" id="schedFDept">
            <option value="All">All Departments</option>
            ${allDepts.map(d => `<option value="${d}" ${fDept===d?'selected':''}>${escHtml(d)}</option>`).join('')}
          </select>
          <select class="sched-filter-select" id="schedFYear">
            <option value="">All Years</option>
            ${allYears.map(y => `<option value="${y}" ${fYear===y?'selected':''}>${escHtml(y)} Year</option>`).join('')}
          </select>
          <select class="sched-filter-select" id="schedFSec">
            <option value="">All Sections</option>
            ${allSecs.map(s => `<option value="${s}" ${fSec===s?'selected':''}>${escHtml(s)}</option>`).join('')}
          </select>
        </div>
        ${items.length === 0 ? emptyState : deptHtml}
      </div>`;

    // Post button
    document.getElementById('schedPostBtn').onclick = () => openModal('section-schedule');

    // Filter handlers
    const dF = document.getElementById('schedFDept');
    const yF = document.getElementById('schedFYear');
    const sF = document.getElementById('schedFSec');
    if (dF) dF.onchange = () => { state.scheduleFilterDept = dF.value; renderSectionSchedulesPage(); };
    if (yF) yF.onchange = () => { state.scheduleFilterYear = yF.value; renderSectionSchedulesPage(); };
    if (sF) sF.onchange = () => { state.scheduleFilterSection = sF.value; renderSectionSchedulesPage(); };
  }

  window._toggleSectionSchedule = async (id) => {
    try {
      await api(`/api/section-schedules/${id}/toggle`, { method: 'PATCH' });
      showToast('Schedule updated', 'success');
      loadSectionSchedules();
    } catch (err) { showToast(err.message, 'error'); }
  };

  window._deleteSectionSchedule = async (id) => {
    if (!confirm('Delete this schedule?')) return;
    try {
      await api(`/api/section-schedules/${id}`, { method: 'DELETE' });
      showToast('Schedule deleted', 'success');
      loadSectionSchedules();
    } catch (err) { showToast(err.message, 'error'); }
  };

  // ════════════════════════════════
  //  SCHEDULE — Embedded link model
  //  Every user pastes their own Google/Canva/Microsoft link; the page renders it
  //  as a sandboxed iframe. No CSV upload, no row-by-row entry.
  //  Label:
  //    - Student:  "Class Schedule"
  //    - Faculty:  "Teaching Schedule"
  //    - Admin:    "Class Schedules"
  // ════════════════════════════════
  function isFacultySched() {
    return state.user.role === 'faculty' || state.user.role === 'admin';
  }
  function schedulePageTitle() {
    if (state.user.role === 'admin') return 'Class Schedules';
    if (state.user.role === 'faculty') return 'Teaching Schedule';
    return 'Class Schedule';
  }

  // Validates an embed URL against the same allowlist the server enforces
  // (Google Docs/Sheets/Calendar/Drive, Canva, Microsoft OneDrive/Office/Sway).
  const SCHEDULE_EMBED_ALLOWLIST = [
    /^(docs|sheets|calendar)\.google\.com$/i,
    /^drive\.google\.com$/i,
    /^(www\.)?canva\.com$/i,
    /^onedrive\.live\.com$/i,
    /^(view|embed|sway)\.office\.com$/i,
    /^1drv\.ms$/i,
    /^(www\.)?office\.com$/i,
    /^(www\.)?sway\.cloud\.microsoft$/i,
  ];
  function isAllowedScheduleUrl(raw) {
    if (!raw) return true;
    try {
      const u = new URL(raw);
      if (u.protocol !== 'https:') return false;
      return SCHEDULE_EMBED_ALLOWLIST.some((rx) => rx.test(u.hostname));
    } catch (_) { return false; }
  }

  // ════════════════════════════════
  //  CLASS SCHEDULES
  //  Students  → view-only iframe of their matching section schedule
  //  Faculty   → post / edit / delete embed links per section
  //  Admin     → full overview + post / edit / delete any embed
  // ════════════════════════════════

  // Convert a Google Sheets/Docs share URL into a proper embed URL.
  // Other URLs are returned as-is so faculty can paste any embed-ready link.
  function _toEmbedUrl(raw) {
    const url = raw.trim();
    // Google Sheets  – /edit  →  /pubhtml
    const gsMatch = url.match(/docs\.google\.com\/spreadsheets\/d\/([^/]+)/);
    if (gsMatch) {
      return `https://docs.google.com/spreadsheets/d/${gsMatch[1]}/pubhtml?widget=true&headers=false`;
    }
    // Google Docs – /edit → /pub
    const gdMatch = url.match(/docs\.google\.com\/document\/d\/([^/]+)/);
    if (gdMatch) {
      return `https://docs.google.com/document/d/${gdMatch[1]}/pub?embedded=true`;
    }
    // Google Slides – /edit → /embed
    const gpMatch = url.match(/docs\.google\.com\/presentation\/d\/([^/]+)/);
    if (gpMatch) {
      return `https://docs.google.com/presentation/d/${gpMatch[1]}/embed?start=false&loop=false`;
    }
    return url;
  }

  async function loadSchedules() {
    const pageArea = document.getElementById('pageArea');
    pageArea.innerHTML = `<div class="page-header"><h1 class="page-title">${schedulePageTitle()}</h1></div><div class="page-content"><div class="loader"><div class="spinner"></div></div></div>`;
    try {
      if (state.user.role === 'student') {
        const data = await api('/api/schedules/embeds');
        await renderStudentSchedule(data);
      } else {
        await _loadScheduleManagement();
      }
    } catch (err) {
      document.querySelector('.page-content').innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Failed to load</h3><p>${escHtml(err.message)}</p></div>`;
    }
  }

  // ── STUDENT: view-only embedded schedule ──────────────────
  async function renderStudentSchedule(embeds) {
    const pageArea = document.getElementById('pageArea');
    const u = state.user;

    // Skeleton while we fetch sheet data
    pageArea.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Class Schedule</h1>
        <p class="page-subtitle">${escHtml(u.department || '')} · ${escHtml(u.year_level || '')} Year · Section ${escHtml(u.section || '')}</p>
      </div>
      <div class="page-content" id="schedContent">
        ${embeds.length === 0
          ? `<div class="empty-state">
               <i class="fas fa-calendar-times"></i>
               <h3>No schedule posted yet</h3>
               <p>Your instructor hasn't posted a class schedule for your section yet.<br>Check back later or contact your faculty.</p>
             </div>`
          : `<div class="loader"><div class="spinner"></div></div>`
        }
      </div>`;

    if (embeds.length === 0) return;

    // Fetch all sheets in parallel
    const results = await Promise.all(embeds.map(async em => {
      try {
        const data = await api(`/api/schedules/fetch-sheet?url=${encodeURIComponent(em.embed_url)}`);
        return { em, rows: data.rows, error: null };
      } catch (err) {
        return { em, rows: null, error: err.message };
      }
    }));

    const content = document.getElementById('schedContent');
    content.innerHTML = results.map(({ em, rows, error }) => {
      const headerHtml = `
        <div class="sched-embed-header">
          <div>
            ${em.title ? `<h3 class="sched-embed-card-title">${escHtml(em.title)}</h3>` : ''}
            <p class="sched-embed-card-by"><i class="fas fa-user-tie"></i> Posted by ${escHtml(em.posted_by_name || 'Faculty')}</p>
          </div>
          <a href="${escHtml(em.embed_url)}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm sched-open-btn">
            <i class="fas fa-external-link-alt"></i> Open in Google Sheets
          </a>
        </div>`;

      if (error || !rows || rows.length === 0) {
        // Fallback to iframe when sheet can't be fetched
        return `
          <div class="card schedule-embed-card">
            ${headerHtml}
            <div class="card schedule-embed-frame">
              <iframe src="${escHtml(_toEmbedUrl(em.embed_url))}" allowfullscreen loading="lazy"
                title="${escHtml(em.title || 'Class Schedule')}"></iframe>
            </div>
          </div>`;
      }

      // Build table from the sheet rows
      const headers = Object.keys(rows[0]);
      const tableRows = rows.map(row =>
        `<tr>${headers.map(h => `<td>${escHtml(String(row[h] ?? ''))}</td>`).join('')}</tr>`
      ).join('');

      return `
        <div class="card schedule-embed-card">
          ${headerHtml}
          <div class="sched-sheet-table-wrap">
            <table class="sched-sheet-table">
              <thead>
                <tr>${headers.map(h => `<th>${escHtml(h)}</th>`).join('')}</tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>
        </div>`;
    }).join('');
  }

  // ── FACULTY / ADMIN: manage embed links ──────────────────
  async function _loadScheduleManagement() {
    const params = new URLSearchParams();
    if (state.scheduleFilterDept && state.scheduleFilterDept !== 'All') params.set('department', state.scheduleFilterDept);
    if (state.scheduleFilterYear)    params.set('year_level', state.scheduleFilterYear);
    if (state.scheduleFilterSection) params.set('section',    state.scheduleFilterSection);
    const data = await api(`/api/schedules/embeds?${params}`);
    renderScheduleManagement(data);
  }

  function renderScheduleManagement(embeds) {
    const pageArea = document.getElementById('pageArea');
    const isAdmin = state.user.role === 'admin';
    const yearLevelOpts = ['1st','2nd','3rd','4th'];
    const sectionOpts   = ['1-1','1-2','1-3','2-1','2-2','2-3','3-1','3-2','3-3','4-1','4-2','4-3'];

    // Group by dept → year → section (for admin overview)
    const grouped = {};
    embeds.forEach(em => {
      const dept = em.department || '—';
      const yr   = em.year_level || '—';
      const sec  = em.section    || '—';
      if (!grouped[dept]) grouped[dept] = {};
      if (!grouped[dept][yr]) grouped[dept][yr] = {};
      if (!grouped[dept][yr][sec]) grouped[dept][yr][sec] = [];
      grouped[dept][yr][sec].push(em);
    });

    pageArea.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">${schedulePageTitle()}</h1>
        <p class="page-subtitle">${isAdmin ? 'Overview of all posted section schedules.' : 'Post embedded schedule links for your sections.'}</p>
      </div>
      <div class="page-content">

        <!-- Toolbar -->
        <div class="schedule-mgmt-toolbar">
          <button class="btn btn-primary" id="schedAddBtn"><i class="fas fa-plus"></i> Post Schedule</button>
          ${isAdmin ? `
          <div class="schedule-filters">
            <select class="form-input form-select" id="sfDept" style="width:140px;">
              ${departments.map(d => `<option value="${d}"${state.scheduleFilterDept === d ? ' selected' : ''}>${d}</option>`).join('')}
            </select>
            <select class="form-input form-select" id="sfYear" style="width:110px;">
              <option value="">All Years</option>
              ${yearLevelOpts.map(y => `<option value="${y}"${state.scheduleFilterYear === y ? ' selected' : ''}>${y}</option>`).join('')}
            </select>
            <select class="form-input form-select" id="sfSection" style="width:110px;">
              <option value="">All Sections</option>
              ${sectionOpts.map(s => `<option value="${s}"${state.scheduleFilterSection === s ? ' selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>` : ''}
        </div>

        <!-- Embed list -->
        <div class="schedule-overview-wrap">
          ${embeds.length === 0
            ? `<div class="empty-state"><i class="fas fa-calendar-times"></i><h3>No schedules posted yet</h3><p>Click "Post Schedule" to add an embedded schedule for a section.</p></div>`
            : isAdmin
              // ── Admin: collapsible dept → year → section ──
              ? Object.entries(grouped).map(([dept, years]) => `
                  <details class="sched-dept-group" open>
                    <summary class="sched-dept-summary">
                      <span class="sched-dept-name">${escHtml(dept)}</span>
                      <span class="sched-count-badge">${Object.values(years).flatMap(y => Object.values(y)).flat().length}</span>
                    </summary>
                    ${Object.entries(years).map(([yr, sections]) => `
                      <details class="sched-year-group" open>
                        <summary class="sched-year-summary">${escHtml(yr)} Year</summary>
                        ${Object.entries(sections).map(([sec, items]) => `
                          <details class="sched-section-group" open>
                            <summary class="sched-section-summary">Section ${escHtml(sec)} <span class="sched-count-badge">${items.length}</span></summary>
                            <div style="padding:10px 12px;display:flex;flex-direction:column;gap:8px;">
                              ${items.map(em => `
                                <div class="sched-embed-row">
                                  <div class="sched-embed-info">
                                    <i class="fas fa-link"></i>
                                    <span class="sched-embed-title">${escHtml(em.title || 'Untitled Schedule')}</span>
                                    <a href="${escHtml(em.embed_url)}" target="_blank" rel="noopener" class="sched-embed-link" title="Open link"><i class="fas fa-external-link-alt"></i></a>
                                  </div>
                                  <span class="sched-embed-by">by ${escHtml(em.posted_by_name || 'Faculty')}</span>
                                  <div class="sched-actions">
                                    <button class="btn btn-xs btn-secondary sched-edit-btn" data-id="${em.id}"><i class="fas fa-edit"></i></button>
                                    <button class="btn btn-xs btn-danger sched-del-btn" data-id="${em.id}"><i class="fas fa-trash"></i></button>
                                  </div>
                                </div>`).join('')}
                            </div>
                          </details>`).join('')}
                      </details>`).join('')}
                  </details>`).join('')
              // ── Faculty: flat card list ──
              : `<div style="display:flex;flex-direction:column;gap:10px;">
                  ${embeds.map(em => `
                    <div class="card sched-embed-card-mgmt">
                      <div class="sched-embed-row">
                        <div class="sched-embed-info">
                          <i class="fas fa-link"></i>
                          <span class="sched-embed-title">${escHtml(em.title || 'Untitled Schedule')}</span>
                          <a href="${escHtml(em.embed_url)}" target="_blank" rel="noopener" class="sched-embed-link" title="Open link"><i class="fas fa-external-link-alt"></i></a>
                        </div>
                        <div class="sched-embed-meta">
                          <span><i class="fas fa-building"></i> ${escHtml(em.department)}</span>
                          <span><i class="fas fa-layer-group"></i> ${escHtml(em.year_level)} Year</span>
                          <span><i class="fas fa-users"></i> Section ${escHtml(em.section)}</span>
                        </div>
                        <div class="sched-actions">
                          <button class="btn btn-xs btn-secondary sched-edit-btn" data-id="${em.id}"><i class="fas fa-edit"></i></button>
                          <button class="btn btn-xs btn-danger sched-del-btn" data-id="${em.id}"><i class="fas fa-trash"></i></button>
                        </div>
                      </div>
                    </div>`).join('')}
                </div>`
          }
        </div>

      </div>`;

    // ── Bind toolbar ──
    document.getElementById('schedAddBtn').onclick = () => _openEmbedModal(null);
    if (isAdmin) {
      document.getElementById('sfDept').onchange    = e => { state.scheduleFilterDept    = e.target.value; _loadScheduleManagement(); };
      document.getElementById('sfYear').onchange    = e => { state.scheduleFilterYear    = e.target.value; _loadScheduleManagement(); };
      document.getElementById('sfSection').onchange = e => { state.scheduleFilterSection = e.target.value; _loadScheduleManagement(); };
    }

    // Edit / delete
    document.querySelectorAll('.sched-edit-btn').forEach(btn => {
      btn.onclick = () => {
        const found = embeds.find(em => em.id === btn.dataset.id);
        if (found) _openEmbedModal(found);
      };
    });
    document.querySelectorAll('.sched-del-btn').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Remove this schedule embed?')) return;
        try {
          await api(`/api/schedules/embeds/${btn.dataset.id}`, { method: 'DELETE' });
          showToast('Schedule removed', 'success');
          _loadScheduleManagement();
        } catch (err) { showToast(err.message, 'error'); }
      };
    });
  }

  // ── Post / Edit embed modal ───────────────────────────────
  function _openEmbedModal(existing) {
    // Store on state so the openModal case can read it
    state._embedModalData = existing || null;
    openModal('schedule-embed');
  }

  // ════════════════════════════════
  //  PROFILE
  // ════════════════════════════════
  async function loadProfile() {
    const pageArea = document.getElementById('pageArea');
    pageArea.innerHTML = `<div class="page-header"><h1 class="page-title">My Profile</h1><p class="page-subtitle">Manage your personal information</p></div><div class="page-content"><div class="loader"><div class="spinner"></div></div></div>`;
    try {
      const me = await api('/api/auth/me');
      state.profile = me;
      renderProfilePage();
    } catch (err) {
      pageArea.querySelector('.page-content').innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Failed to load</h3><p>${escHtml(err.message)}</p></div>`;
    }
  }

  function renderProfilePage() {
    const p = state.profile || {};
    const pageArea = document.getElementById('pageArea');
    const fullName = p.role === 'admin'
      ? (p.first_name || 'Admin')
      : ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
    const roleColor = p.role === 'admin' ? '#800000' : p.role === 'faculty' ? '#1565c0' : '#2e7d32';
    const roleLabel = p.role === 'admin' ? 'Administrator' : p.role === 'faculty' ? 'Faculty' : 'Student';
    const avatarBg = getAvatarColor(fullName);

    pageArea.innerHTML = `
      <div class="page-header"><h1 class="page-title">My Profile</h1><p class="page-subtitle">Manage your personal information</p></div>
      <div class="page-content profile-page">

        <!-- Hero banner card -->
        <div class="card profile-hero">
          <div class="profile-hero-banner" style="background:linear-gradient(135deg,var(--maroon),var(--maroon-dark));"></div>
          <div class="profile-hero-body">
            <div class="profile-avatar-wrap">
              <div class="profile-avatar" id="profileAvatar" style="${p.profile_image ? '' : `background:${avatarBg};`}">
                ${p.profile_image ? `<img src="${p.profile_image}" alt="avatar">` : getInitials(fullName || 'U')}
              </div>
              <button class="profile-avatar-btn" id="profileAvatarBtn" title="Change photo"><i class="fas fa-camera"></i></button>
              <input type="file" id="profileAvatarInput" accept="image/*" style="display:none">
            </div>
            <div class="profile-hero-info">
              <h2 class="profile-name">${escHtml(fullName || 'User')}</h2>
              <div class="profile-badges">
                <span class="profile-role-badge" style="background:${roleColor}20;color:${roleColor};">
                  <i class="fas fa-${p.role === 'admin' ? 'shield-alt' : p.role === 'faculty' ? 'chalkboard-teacher' : 'user-graduate'}"></i>
                  ${roleLabel}
                </span>
                ${p.department ? `<span class="profile-dept-badge"><i class="fas fa-building"></i> ${escHtml(p.department)}</span>` : ''}
                ${p.role === 'student' && p.year_level ? `<span class="profile-dept-badge"><i class="fas fa-layer-group"></i> ${escHtml(p.year_level)} Year</span>` : ''}
                ${p.role === 'student' && p.section ? `<span class="profile-dept-badge"><i class="fas fa-users"></i> Sec ${escHtml(p.section)}</span>` : ''}
              </div>
              <p class="profile-email"><i class="fas fa-envelope"></i> ${escHtml(p.email || '')}</p>
              ${p.position ? `<p class="profile-position"><i class="fas fa-briefcase"></i> ${escHtml(p.position)}</p>` : ''}
            </div>
          </div>
        </div>

        <!-- 2-column layout: form + sidebar -->
        <div class="profile-layout">
          <!-- Personal Information card -->
          <div class="card profile-section">
            <div class="profile-section-header">
              <i class="fas fa-user-edit" style="color:var(--maroon);"></i>
              <span>Personal Information</span>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">${p.role === 'admin' ? 'Display Name' : 'First Name'}</label>
                <input type="text" class="form-input" id="pfFirst" value="${escHtml(p.first_name || '')}" placeholder="${p.role === 'admin' ? 'Display name' : 'First name'}">
              </div>
              ${p.role !== 'admin' ? `
              <div class="form-group">
                <label class="form-label">Last Name</label>
                <input type="text" class="form-input" id="pfLast" value="${escHtml(p.last_name || '')}">
              </div>` : ''}
            </div>

            <div class="form-row">
              ${(p.role === 'student' || p.role === 'admin') ? `
              <div class="form-group">
                <label class="form-label">Department</label>
                <select class="form-input form-select" id="pfDept">
                  ${departments.filter(d => !['All','General','Campus'].includes(d)).map(d => `<option value="${d}" ${p.department===d?'selected':''}>${d}</option>`).join('')}
                </select>
              </div>` : ''}
              <div class="form-group">
                <label class="form-label">Phone Number</label>
                <input type="text" class="form-input" id="pfPhone" placeholder="e.g., 09xx-xxx-xxxx" value="${escHtml(p.phone || '')}">
              </div>
            </div>

            ${p.role === 'student' ? `
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Year Level</label>
                <div class="form-input pf-readonly">${escHtml(p.year_level || '—')}</div>
              </div>
              <div class="form-group">
                <label class="form-label">Section</label>
                <div class="form-input pf-readonly">${escHtml(p.section || '—')}</div>
              </div>
            </div>` : ''}

            ${(p.role === 'faculty' || p.role === 'admin') ? `
            <div class="form-group">
              <label class="form-label">Position / Title</label>
              <input type="text" class="form-input" id="pfPosition" placeholder="e.g., Associate Professor" value="${escHtml(p.position || '')}">
            </div>` : ''}

            <div class="form-group">
              <label class="form-label">Bio</label>
              <textarea class="form-input" id="pfBio" rows="3" placeholder="Tell others a bit about yourself...">${escHtml(p.bio || '')}</textarea>
            </div>

            <button class="btn btn-primary profile-save-btn" id="pfSaveBtn">
              <i class="fas fa-save"></i> Save Changes
            </button>
          </div>

          <!-- Right sidebar cards -->
          <div class="profile-sidebar">

            <!-- Account info card -->
            <div class="card profile-section">
              <div class="profile-section-header">
                <i class="fas fa-id-card" style="color:var(--maroon);"></i>
                <span>Account Info</span>
              </div>
              <div class="profile-info-list">
                <div class="profile-info-row">
                  <span class="pil-label">Student / Employee ID</span>
                  <span class="pil-value">${escHtml(p.student_number || '—')}</span>
                </div>
                <div class="profile-info-row">
                  <span class="pil-label">Role</span>
                  <span class="pil-value" style="color:${roleColor};font-weight:700;">${roleLabel}</span>
                </div>
                <div class="profile-info-row">
                  <span class="pil-label">Status</span>
                  <span class="pil-value">
                    ${p.is_verified
                      ? '<span class="status-badge verified"><i class="fas fa-check-circle"></i> Verified</span>'
                      : '<span class="status-badge pending"><i class="fas fa-clock"></i> Pending</span>'}
                  </span>
                </div>
                <div class="profile-info-row">
                  <span class="pil-label">Account</span>
                  <span class="pil-value">${p.is_active ? '<span style="color:var(--success);">Active</span>' : '<span style="color:var(--danger);">Inactive</span>'}</span>
                </div>
              </div>
            </div>

            <!-- Appearance card -->
            <div class="card profile-section">
              <div class="profile-section-header">
                <i class="fas fa-palette" style="color:var(--maroon);"></i>
                <span>Appearance</span>
              </div>
              <p class="profile-section-desc">Choose how PUPSJ HUB looks on your device.</p>
              <div class="theme-switcher" id="themeSwitcher">
                <button class="theme-option ${getStoredTheme()==='light'?'active':''}" data-theme="light">
                  <i class="fas fa-sun"></i><span>Light</span>
                </button>
                <button class="theme-option ${getStoredTheme()==='dark'?'active':''}" data-theme="dark">
                  <i class="fas fa-moon"></i><span>Dark</span>
                </button>
                <button class="theme-option ${getStoredTheme()==='system'?'active':''}" data-theme="system">
                  <i class="fas fa-desktop"></i><span>System</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      </div>`;

    // Avatar upload
    const avatarBtn = document.getElementById('profileAvatarBtn');
    const avatarInput = document.getElementById('profileAvatarInput');
    avatarBtn.onclick = () => avatarInput.click();
    avatarInput.onchange = async () => {
      if (!avatarInput.files[0]) return;
      const fd = new FormData();
      fd.append('avatar', avatarInput.files[0]);
      try {
        const res = await fetch('/api/auth/me/avatar', { method: 'POST', headers: getToken() ? { 'Authorization': `Bearer ${getToken()}` } : {}, body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        // Add cache-buster so browser doesn't serve old image
        const imageUrl = data.profile_image + '?v=' + Date.now();
        state.profile.profile_image = imageUrl;
        if (state.user) state.user.profile_image = imageUrl;
        showToast('Profile photo updated', 'success');
        renderProfilePage();
        // refresh sidebar avatar
        const sa = document.querySelector('.sidebar-avatar');
        if (sa) sa.innerHTML = `<img src="${imageUrl}" alt="avatar">`;
      } catch (err) { showToast(err.message, 'error'); }
    };

    // Theme switcher
    document.querySelectorAll('#themeSwitcher .theme-option').forEach(btn => {
      btn.onclick = () => {
        setTheme(btn.dataset.theme);
        document.querySelectorAll('#themeSwitcher .theme-option').forEach(b => b.classList.toggle('active', b === btn));
        showToast(`Theme: ${btn.dataset.theme}`, 'info');
      };
    });

    // Save profile
    document.getElementById('pfSaveBtn').onclick = async () => {
      const first_name = document.getElementById('pfFirst').value.trim();
      const isAdmin    = p.role === 'admin';
      const pfLastEl   = document.getElementById('pfLast');
      const last_name  = isAdmin ? 'ADMIN' : (pfLastEl ? pfLastEl.value.trim() : '');
      if (!first_name || (!isAdmin && !last_name)) {
        showToast('First name and last name are required', 'error'); return;
      }
      const pfDeptEl = document.getElementById('pfDept');
      const body = {
        first_name,
        last_name,
        department: pfDeptEl ? pfDeptEl.value : null,
        phone: document.getElementById('pfPhone').value.trim(),
        bio: document.getElementById('pfBio').value.trim(),
      };
      const posEl = document.getElementById('pfPosition');
      if (posEl) body.position = posEl.value.trim();
      try {
        const updated = await api('/api/auth/me', { method: 'PATCH', body: JSON.stringify(body) });
        state.profile = updated;
        if (state.user) {
          state.user.first_name = updated.first_name;
          state.user.last_name  = updated.last_name;
          state.user.department = updated.department;
        }
        // Refresh sidebar name live
        const sidebarName = document.querySelector('.sidebar-user-name');
        if (sidebarName) {
          sidebarName.textContent = updated.role === 'admin'
            ? updated.first_name
            : updated.first_name + ' ' + updated.last_name;
        }
        showToast('Profile saved', 'success');
        renderProfilePage();
      } catch (err) { showToast(err.message, 'error'); }
    };
  }

  // ════════════════════════════════
  //  CHATBOT (with image support)
  // ════════════════════════════════
  function renderChatbot() {
    // Clear chat history if last message was more than 1 hour ago
    const CHAT_TTL = 60 * 60 * 1000;
    if (state.chatLastMessageAt && Date.now() - state.chatLastMessageAt > CHAT_TTL) {
      state.chatMessages = [];
      state.chatLastMessageAt = null;
    }

    const pageArea = document.getElementById('pageArea');

    pageArea.innerHTML = `
      <div class="page-header"><h1 class="page-title">PUPBot</h1><p class="page-subtitle">Your campus AI assistant</p></div>
      <div class="page-content chatbot-page">
        <div class="chatbot-container">
          <div class="chat-messages" id="chatMessages">
            <div class="chat-message-row bot-row">
              <div class="bot-avatar-circle"><i class="fas fa-robot"></i></div>
              <div class="chat-bubble bot">
                <div class="bot-label">PUPBot</div>
                Hello! I'm PUPBot, your PUPSJ HUB assistant. I can help with questions about enrollment, schedules, events, lost &amp; found, feedback, and campus policies. What would you like to know?
              </div>
            </div>
            ${state.chatMessages.map(m => `
              <div class="chat-message-row user-row">
                <div class="chat-bubble user">${escHtml(m.user)}</div>
              </div>
              <div class="chat-message-row bot-row">
                <div class="bot-avatar-circle"><i class="fas fa-robot"></i></div>
                <div class="chat-bubble bot">
                  <div class="bot-label">PUPBot</div>
                  ${renderBotMd(m.bot)}
                  ${m.images && m.images.length > 0 ? `<div class="chat-bot-images">${m.images.map(url => `<img src="${url}" alt="related" onclick="window._openImageViewer('${url}')">`).join('')}</div>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
          <div class="chat-typing" id="chatTyping"><i class="fas fa-circle-notch fa-spin"></i> PUPBot is typing...</div>
        </div>
      </div>`;

    const chatInput = document.getElementById('chatInput');
    const chatSend = document.getElementById('chatSend');
    const chatMessages = document.getElementById('chatMessages');

    // Set disabled state on global input elements
    if (chatInput) chatInput.disabled = state.chatInputDisabled;
    if (chatSend) chatSend.disabled = state.chatInputDisabled;

    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  async function sendChatMessage(inputEl, messagesEl) {
    const message = inputEl.value.trim();
    if (!message) return;
    inputEl.value = '';

    // If more than 1 hour has passed since the last message, wipe history
    const CHAT_TTL = 60 * 60 * 1000;
    if (state.chatLastMessageAt && Date.now() - state.chatLastMessageAt > CHAT_TTL) {
      state.chatMessages = [];
      state.chatLastMessageAt = null;
      // Show a subtle session-cleared notice in the chat window
      const divider = document.createElement('div');
      divider.className = 'chat-session-divider';
      divider.textContent = 'Session cleared after 1 hour of inactivity';
      messagesEl.appendChild(divider);
    }

    // Add user bubble
    const userRow = document.createElement('div');
    userRow.className = 'chat-message-row user-row';
    const userBubble = document.createElement('div');
    userBubble.className = 'chat-bubble user';
    userBubble.textContent = message;
    userRow.appendChild(userBubble);
    messagesEl.appendChild(userRow);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // Show typing
    document.getElementById('chatTyping').classList.add('show');

    try {
      const history = state.chatMessages.slice(-6).map(m => ({ user: m.user, bot: m.bot }));
      const data = await api('/api/chatbot/message', { method: 'POST', body: JSON.stringify({ message, history }) });

      document.getElementById('chatTyping').classList.remove('show');

      const botRow = document.createElement('div');
      botRow.className = 'chat-message-row bot-row';
      const botAvatar = document.createElement('div');
      botAvatar.className = 'bot-avatar-circle';
      botAvatar.innerHTML = '<i class="fas fa-robot"></i>';
      const botBubble = document.createElement('div');
      botBubble.className = 'chat-bubble bot';
      let botHtml = `<div class="bot-label">PUPBot</div>${renderBotMd(data.response)}`;

      // Show images if returned
      if (data.images && data.images.length > 0) {
        botHtml += `<div class="chat-bot-images">${data.images.map(url => `<img src="${url}" alt="related" onclick="window._openImageViewer('${url}')">`).join('')}</div>`;
      }

      botBubble.innerHTML = botHtml;
      botRow.appendChild(botAvatar);
      botRow.appendChild(botBubble);
      messagesEl.appendChild(botRow);

      state.chatMessages.push({ user: message, bot: data.response, images: data.images || [] });
      state.chatLastMessageAt = Date.now();
    } catch (err) {
      document.getElementById('chatTyping').classList.remove('show');
      const errRow = document.createElement('div');
      errRow.className = 'chat-message-row bot-row';
      errRow.innerHTML = `<div class="bot-avatar-circle"><i class="fas fa-robot"></i></div><div class="chat-bubble bot"><div class="bot-label">PUPBot</div>Sorry, I'm having trouble responding right now. Please try again.</div>`;
      messagesEl.appendChild(errRow);
    }

    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ════════════════════════════════
  //  PROFESSOR LOCATOR (real-time)
  // ════════════════════════════════
  function stopLocatorPolling() {
    if (locatorPollTimer) {
      clearInterval(locatorPollTimer);
      locatorPollTimer = null;
    }
  }

  async function fetchFacultyLocations() {
    try {
      const data = await api('/api/faculty/locations');
      state.facultyLocations = data.locations || [];
      state.facultyLocationsUpdatedAt = new Date();
      updateLocatorWidget();
    } catch (err) {
      // Silent fail — widget stays with last data
    }
  }

  function startLocatorPolling() {
    stopLocatorPolling();
    fetchFacultyLocations();
    locatorPollTimer = setInterval(() => {
      // Pause when tab is hidden
      if (document.visibilityState === 'visible') {
        fetchFacultyLocations();
      }
    }, 60000); // 60s
  }

  // Status metadata for the locator (Option B: manual status).
  const LOCATOR_STATUS_META = {
    in_class:    { label: 'In Class',    icon: 'fa-chalkboard-teacher', tone: 'in-class' },
    in_office:   { label: 'In Office',   icon: 'fa-door-open',          tone: 'in-office' },
    available:   { label: 'Available',   icon: 'fa-check-circle',       tone: 'available' },
    unavailable: { label: 'Unavailable', icon: 'fa-circle-minus',       tone: 'unavailable' },
  };

  function renderLocatorWidget() {
    const u = state.user;
    const isFacultyOrAdmin = u.role === 'faculty' || u.role === 'admin';
    const list = state.facultyLocations || [];

    const counts = { in_class: 0, in_office: 0, available: 0, unavailable: 0 };
    list.forEach(f => { counts[f.status || 'unavailable'] = (counts[f.status || 'unavailable'] || 0) + 1; });

    const updatedLabel = state.facultyLocationsUpdatedAt
      ? `Updated ${timeAgo(state.facultyLocationsUpdatedAt.toISOString())}`
      : 'Loading...';

    return `
      <div class="locator-widget" id="locatorWidget">
        <div class="locator-header">
          <div class="locator-title">
            <i class="fas fa-map-marker-alt"></i>
            <span>Professor Locator</span>
            <span class="locator-live-dot" title="Live"></span>
          </div>
          <div class="locator-header-right">
            <span class="locator-updated">${updatedLabel}</span>
            ${isFacultyOrAdmin ? '<button class="btn btn-sm btn-secondary" id="btnSetMyStatus"><i class="fas fa-user-clock"></i> Set My Status</button>' : ''}
          </div>
        </div>
        <div class="locator-stats">
          <span class="locator-stat"><span class="dot in-class"></span> ${counts.in_class} In Class</span>
          <span class="locator-stat"><span class="dot in-office"></span> ${counts.in_office} In Office</span>
          <span class="locator-stat"><span class="dot available"></span> ${counts.available} Available</span>
        </div>
        <div class="locator-cards-scroll">
          ${list.length === 0 ? `
            <div class="locator-empty">
              <i class="fas fa-user-slash"></i>
              <span>No faculty data yet.</span>
            </div>
          ` : list.map(f => {
            const meta = LOCATOR_STATUS_META[f.status] || LOCATOR_STATUS_META.unavailable;
            return `
              <div class="locator-card ${meta.tone}">
                <div class="locator-card-status-bar"></div>
                <div class="locator-card-body">
                  <div class="locator-card-name">${escHtml(f.first_name + ' ' + f.last_name)}</div>
                  ${f.department ? `<div class="locator-card-dept">${escHtml(f.department)}</div>` : ''}
                  <div class="locator-card-status">
                    <i class="fas ${meta.icon}"></i>
                    <span>${meta.label}</span>
                  </div>
                  ${f.room ? `<div class="locator-card-room"><i class="fas fa-door-open"></i> ${escHtml(f.room)}</div>` : ''}
                  ${f.note ? `<div class="locator-card-subject">${escHtml(f.note)}</div>` : ''}
                  ${f.until_time ? `<div class="locator-card-subject" style="color:var(--text-light);">Until ${new Date(f.until_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>` : ''}
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  function updateLocatorWidget() {
    const existing = document.getElementById('locatorWidget');
    if (!existing) return;
    existing.outerHTML = renderLocatorWidget();
    bindLocatorEvents();
  }

  function bindLocatorEvents() {
    const btn = document.getElementById('btnSetMyStatus');
    if (btn) btn.onclick = () => openModal('facultyStatus');
  }

  // ════════════════════════════════
  //  FACULTY TEACHING SCHEDULE (faculty/admin)
  // ════════════════════════════════
  async function loadTeachingSchedules() { return loadSchedules(); }

  // (Legacy CSV-era teaching-schedule grid removed — teaching schedules are now embed URLs.)

  // ════════════════════════════════
  //  DOCUMENT TEMPLATES
  // ════════════════════════════════
  async function loadDocuments(fromNav = false) {
    const pageArea = document.getElementById('pageArea');

    if (fromNav && state.docCategories.length > 0 &&
        pageLoadedAt.documents && Date.now() - pageLoadedAt.documents < PAGE_CACHE_TTL) {
      renderDocumentsPage();
      requestAnimationFrame(() => { pageArea.scrollTop = pageScrollCache.documents || 0; });
      return;
    }

    pageArea.innerHTML = `<div class="page-header"><h1 class="page-title">Document Templates</h1><p class="page-subtitle">Accreditation documents, templates & forms</p></div><div class="page-content"><div class="loader"><div class="spinner"></div></div></div>`;

    try {
      const [categories, documents] = await Promise.all([
        api('/api/documents/categories'),
        api('/api/documents' + (state.docSelectedCategory ? `?category_id=${state.docSelectedCategory}` : '') + (state.docSearch ? `${state.docSelectedCategory ? '&' : '?'}search=${encodeURIComponent(state.docSearch)}` : '')),
      ]);
      state.docCategories = categories;
      state.docTemplates = documents;
      pageLoadedAt.documents = Date.now();
      renderDocumentsPage();
    } catch (err) {
      pageArea.querySelector('.page-content').innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Failed to load</h3><p>${err.message}</p></div>`;
    }
  }

  function getFileIcon(fileType) {
    if (!fileType) return 'fa-file';
    if (fileType.includes('pdf')) return 'fa-file-pdf';
    if (fileType.includes('word') || fileType.includes('document')) return 'fa-file-word';
    if (fileType.includes('sheet') || fileType.includes('excel')) return 'fa-file-excel';
    if (fileType.includes('presentation') || fileType.includes('powerpoint')) return 'fa-file-powerpoint';
    if (fileType.includes('image')) return 'fa-file-image';
    if (fileType.includes('text')) return 'fa-file-alt';
    return 'fa-file';
  }

  function getFileIconColor(fileType) {
    if (!fileType) return 'var(--text-light)';
    if (fileType.includes('pdf')) return '#e74c3c';
    if (fileType.includes('word') || fileType.includes('document')) return '#2b579a';
    if (fileType.includes('sheet') || fileType.includes('excel')) return '#217346';
    if (fileType.includes('presentation') || fileType.includes('powerpoint')) return '#d24726';
    if (fileType.includes('image')) return '#8e44ad';
    if (fileType.includes('text')) return '#7f8c8d';
    return 'var(--text-light)';
  }

  function formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function renderDocumentsPage() {
    const pageArea = document.getElementById('pageArea');
    const isFacultyOrAdmin = state.user.role === 'faculty' || state.user.role === 'admin';
    const selectedCat = state.docCategories.find(c => c.id === state.docSelectedCategory);

    // ── Folder palette — body, tab, icon, border (solid colors for real folder look) ──
    const FOLDER_PALETTES = [
      { body: '#fdf2f2', tab: '#f0c8c8', iconColor: '#800000', border: 'rgba(128,0,0,0.18)' },
      { body: '#fdf9ec', tab: '#f0dcaa', iconColor: '#c48000', border: 'rgba(196,128,0,0.22)' },
      { body: '#f9e8e8', tab: '#e8c0c0', iconColor: '#5c0000', border: 'rgba(92,0,0,0.18)'   },
      { body: '#fdf5da', tab: '#eeda98', iconColor: '#a06010', border: 'rgba(160,96,16,0.20)' },
      { body: '#f4dcdc', tab: '#e4b0b0', iconColor: '#800000', border: 'rgba(128,0,0,0.22)'  },
      { body: '#fef6dc', tab: '#f4d878', iconColor: '#8a5c00', border: 'rgba(138,92,0,0.20)' },
    ];

    // ── File type card header gradient ──
    function getFileHeaderBg(fileType) {
      if (!fileType) return 'linear-gradient(135deg,#800000,#5c0000)';
      if (fileType.includes('pdf'))          return 'linear-gradient(135deg,#e74c3c,#c0392b)';
      if (fileType.includes('word') || fileType.includes('document')) return 'linear-gradient(135deg,#2b579a,#1a3a6e)';
      if (fileType.includes('sheet') || fileType.includes('excel'))   return 'linear-gradient(135deg,#217346,#145a32)';
      if (fileType.includes('presentation') || fileType.includes('powerpoint')) return 'linear-gradient(135deg,#d24726,#a3320f)';
      if (fileType.includes('image')) return 'linear-gradient(135deg,#8e44ad,#6c3483)';
      if (fileType.includes('text'))  return 'linear-gradient(135deg,#7f8c8d,#566573)';
      return 'linear-gradient(135deg,var(--maroon),var(--maroon-dark))';
    }

    // Total documents across all categories (for the stats bar)
    const totalDocs = state.docCategories.reduce((sum, c) => sum + (c.file_count || 0), 0);

    // ── Folders section (shown when no category selected and not searching) ──
    const foldersSection = (!state.docSelectedCategory && !state.docSearch && state.docCategories.length > 0) ? `
      <div class="doc-section">
        <div class="doc-section-hdr">
          <div class="doc-section-hdr-left">
            <span class="doc-section-title">Folders</span>
            <span class="doc-section-count">${state.docCategories.length}</span>
          </div>
          ${isFacultyOrAdmin ? `<button class="doc-new-folder-btn" id="addCategoryBtn"><i class="fas fa-plus"></i> New Folder</button>` : ''}
        </div>
        <div class="doc-folders-grid">
          ${state.docCategories.map((c, i) => {
            const pal = FOLDER_PALETTES[i % FOLDER_PALETTES.length];
            return `
              <div class="doc-folder-card" data-cat-nav="${c.id}"
                   style="--fc-body:${pal.body}; --fc-tab:${pal.tab}; --fc-icon:${pal.iconColor}; --fc-border:${pal.border};">
                ${isFacultyOrAdmin ? `
                <div class="doc-folder-actions">
                  <button class="doc-folder-action-btn" onclick="event.stopPropagation(); window._editCategory('${c.id}','${jsEsc(c.name)}','${jsEsc(c.description || '')}')" title="Edit"><i class="fas fa-pen"></i></button>
                  <button class="doc-folder-action-btn doc-folder-del-btn" onclick="event.stopPropagation(); window._deleteCategory('${c.id}')" title="Delete"><i class="fas fa-trash"></i></button>
                </div>` : ''}
                <div class="doc-folder-info">
                  <h3 class="doc-folder-name">${escHtml(c.name)}</h3>
                  ${c.description ? `<p class="doc-folder-desc">${escHtml(c.description)}</p>` : ''}
                  <span class="doc-folder-count"><i class="fas fa-file-alt"></i> ${c.file_count} item${c.file_count !== 1 ? 's' : ''}</span>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>` : '';

    // ── Documents grid section (shown when category selected or searching) ──
    const docsSection = (state.docSelectedCategory || state.docSearch) ? `
      <div class="doc-section">
        <div class="doc-section-hdr">
          <div class="doc-section-hdr-left">
            <button class="doc-back-btn" id="docBackBtn"><i class="fas fa-arrow-left"></i></button>
            <span class="doc-section-title">${selectedCat ? escHtml(selectedCat.name) : 'Search Results'}</span>
            ${selectedCat && selectedCat.description ? `<span class="doc-section-subtitle">${escHtml(selectedCat.description)}</span>` : ''}
            <span class="doc-section-count">${state.docTemplates.length}</span>
          </div>
          ${isFacultyOrAdmin && selectedCat ? `
          <div style="display:flex;gap:8px;">
            <button class="btn btn-secondary btn-sm" style="width:auto;" onclick="window._editCategory('${selectedCat.id}','${jsEsc(selectedCat.name)}','${jsEsc(selectedCat.description || '')}')"><i class="fas fa-pen"></i> Edit</button>
            <button class="btn btn-danger btn-sm" style="width:auto;" onclick="window._deleteCategory('${selectedCat.id}')"><i class="fas fa-trash"></i></button>
          </div>` : ''}
        </div>

        ${state.docTemplates.length === 0 ? `
          <div class="empty-state">
            <i class="fas fa-file-search"></i>
            <h3>${state.docSearch ? 'No documents found' : 'Folder is empty'}</h3>
            <p>${state.docSearch ? 'Try a different search term.' : (isFacultyOrAdmin ? 'Upload documents using the + button.' : 'Check back later.')}</p>
          </div>
        ` : `
          <div class="doc-files-grid">
            ${state.docTemplates.map(d => `
              <div class="doc-file-grid-card">
                <div class="doc-file-grid-hdr" style="background:${getFileHeaderBg(d.file_type)};">
                  <i class="fas ${getFileIcon(d.file_type)} doc-file-grid-icon"></i>
                  ${isFacultyOrAdmin ? `
                  <div class="doc-file-grid-actions">
                    <button class="doc-file-action-btn" onclick="window._editDocument('${d.id}','${jsEsc(d.title)}','${jsEsc(d.description || '')}','${d.category_id}','${jsEsc(d.department || 'General')}')" title="Edit"><i class="fas fa-pen"></i></button>
                    <button class="doc-file-action-btn" onclick="window._deleteDocument('${d.id}')" title="Delete"><i class="fas fa-trash"></i></button>
                  </div>` : ''}
                </div>
                <div class="doc-file-grid-body">
                  <h4 class="doc-file-grid-title">${escHtml(d.title)}</h4>
                  ${d.description ? `<p class="doc-file-grid-desc">${escHtml(d.description)}</p>` : ''}
                  <div class="doc-file-grid-meta">
                    ${d.file_size ? `<span><i class="fas fa-hdd"></i> ${formatFileSize(d.file_size)}</span>` : ''}
                    <span><i class="fas fa-download"></i> ${d.download_count || 0}</span>
                    <span><i class="fas fa-clock"></i> ${timeAgo(d.created_at)}</span>
                    ${d.category_name && state.docSearch ? `<span><i class="fas fa-folder"></i> ${escHtml(d.category_name)}</span>` : ''}
                  </div>
                  <a href="${d.file_url}" download="${escHtml(d.file_name)}" class="doc-dl-btn" onclick="window._trackDownload('${d.id}')">
                    <i class="fas fa-download"></i> Download
                  </a>
                </div>
              </div>`).join('')}
          </div>`}
      </div>` : '';

    // ── Empty (no categories at all) ──
    const emptyState = (state.docCategories.length === 0 && state.docTemplates.length === 0 && !state.docSearch) ? `
      <div class="empty-state">
        <i class="fas fa-folder-plus"></i>
        <h3>No documents yet</h3>
        <p>${isFacultyOrAdmin ? 'Start by creating a folder, then upload documents.' : 'Check back later for document templates.'}</p>
      </div>` : '';

    let html = `
      <div class="page-header">
        <h1 class="page-title">Document Templates</h1>
        <p class="page-subtitle">Accreditation documents, templates &amp; forms</p>
      </div>
      <div class="page-content">
        <!-- Toolbar -->
        <div class="doc-toolbar">
          <div class="doc-search-input-wrap" style="flex:1;max-width:480px;">
            <i class="fas fa-search"></i>
            <input type="text" class="doc-search-input" id="docSearchInput" placeholder="Search documents..." value="${escHtml(state.docSearch)}">
            ${state.docSearch ? '<button class="doc-search-clear" id="docSearchClear"><i class="fas fa-times"></i></button>' : ''}
          </div>
          <div class="doc-toolbar-stats">
            <span class="doc-toolbar-stat"><strong>${state.docCategories.length}</strong> Folders</span>
            <span class="doc-toolbar-dot"></span>
            <span class="doc-toolbar-stat"><strong>${totalDocs}</strong> Documents</span>
          </div>
        </div>
        ${emptyState}
        ${foldersSection}
        ${docsSection}
      </div>`;

    if (isFacultyOrAdmin) {
      html += `<button class="fab" id="fabDoc" title="Upload Document"><i class="fas fa-upload"></i></button>`;
    }

    pageArea.innerHTML = html;

    // Back button
    const backBtn = document.getElementById('docBackBtn');
    if (backBtn) backBtn.onclick = () => { state.docSelectedCategory = null; state.docSearch = ''; loadDocuments(); };

    // Folder card navigation
    document.querySelectorAll('.doc-folder-card[data-cat-nav]').forEach(el => {
      el.onclick = () => { state.docSelectedCategory = el.dataset.catNav; loadDocuments(); };
    });

    // Add category
    const addCatBtn = document.getElementById('addCategoryBtn');
    if (addCatBtn) addCatBtn.onclick = () => openModal('doc-category');

    // Search
    const searchInput = document.getElementById('docSearchInput');
    if (searchInput) {
      let searchTimeout;
      searchInput.oninput = () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => { state.docSearch = searchInput.value.trim(); loadDocuments(); }, 400);
      };
      searchInput.onkeydown = (e) => {
        if (e.key === 'Enter') { clearTimeout(searchTimeout); state.docSearch = searchInput.value.trim(); loadDocuments(); }
      };
    }
    const clearBtn = document.getElementById('docSearchClear');
    if (clearBtn) clearBtn.onclick = () => { state.docSearch = ''; loadDocuments(); };

    // FAB
    const fab = document.getElementById('fabDoc');
    if (fab) fab.onclick = () => openModal('doc-upload');
  }

  window._trackDownload = async (id) => {
    try { await api(`/api/documents/${id}/download`, { method: 'POST' }); } catch (e) {}
  };

  window._deleteDocument = async (id) => {
    if (!confirm('Delete this document?')) return;
    try {
      await api(`/api/documents/${id}`, { method: 'DELETE' });
      showToast('Document deleted', 'success');
      loadDocuments();
    } catch (err) { showToast(err.message, 'error'); }
  };

  window._deleteCategory = async (id) => {
    if (!confirm('Delete this category and all its documents?')) return;
    try {
      await api(`/api/documents/categories/${id}`, { method: 'DELETE' });
      showToast('Category deleted', 'success');
      if (state.docSelectedCategory === id) state.docSelectedCategory = null;
      loadDocuments();
    } catch (err) { showToast(err.message, 'error'); }
  };

  window._editCategory = (id, name, description) => {
    openModal('doc-category-edit', { id, name, description });
  };

  window._editDocument = (id, title, description, categoryId, department) => {
    openModal('doc-edit', { id, title, description, categoryId, department });
  };

  // ════════════════════════════════
  //  ADMIN DASHBOARD
  // ════════════════════════════════
  async function loadAdminDashboard() {
    const pageArea = document.getElementById('pageArea');
    pageArea.innerHTML = `<div class="page-header"><h1 class="page-title">Admin Dashboard</h1><p class="page-subtitle">System overview</p></div><div class="page-content"><div class="loader"><div class="spinner"></div></div></div>`;

    try {
      const [stats, pendingAnn, pendingEv] = await Promise.all([
        api('/api/admin/stats'),
        api('/api/announcements/pending/list').catch(() => []),
        api('/api/events/pending/list').catch(() => []),
      ]);
      state.adminStats = stats;
      state.pendingAnnouncements = pendingAnn || [];
      state.pendingEvents = pendingEv || [];

      // Backwards compatible: stats.announcements may be number (old) or {total, pending} (new).
      const annStat = typeof stats.announcements === 'object' ? stats.announcements : { total: stats.announcements, pending: 0 };
      const evStat  = typeof stats.events === 'object' ? stats.events : { total: stats.events, pending: 0 };
      const totalPending = (annStat.pending || 0) + (evStat.pending || 0);

      pageArea.innerHTML = `
        <div class="page-header"><h1 class="page-title">Admin Dashboard</h1><p class="page-subtitle">System overview & management</p></div>
        <div class="page-content">
          <div class="stats-grid">
            <div class="card stat-card">
              <div class="stat-card-icon maroon"><i class="fas fa-users"></i></div>
              <div class="stat-card-value">${stats.users.total}</div>
              <div class="stat-card-label">Total Users${stats.users.pending > 0 ? ` · <b style="color:var(--warning)">${stats.users.pending} pending</b>` : ''}</div>
            </div>
            <div class="card stat-card">
              <div class="stat-card-icon gold"><i class="fas fa-bullhorn"></i></div>
              <div class="stat-card-value">${annStat.total}</div>
              <div class="stat-card-label">Announcements${annStat.pending > 0 ? ` · <b style="color:var(--warning)">${annStat.pending} pending</b>` : ''}</div>
            </div>
            <div class="card stat-card">
              <div class="stat-card-icon blue"><i class="fas fa-calendar-alt"></i></div>
              <div class="stat-card-value">${evStat.total}</div>
              <div class="stat-card-label">Events${evStat.pending > 0 ? ` · <b style="color:var(--warning)">${evStat.pending} pending</b>` : ''}</div>
            </div>
            <div class="card stat-card">
              <div class="stat-card-icon green"><i class="fas fa-search-location"></i></div>
              <div class="stat-card-value">${stats.lostFound.open}</div>
              <div class="stat-card-label">Open L&F Reports</div>
            </div>
          </div>

          <div class="card" style="padding:20px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
              <h3 style="font-family:var(--font-display);font-size:16px;font-weight:700;margin:0;">
                Approval Queue ${totalPending > 0 ? `<span class="status-pill status-pending">${totalPending}</span>` : ''}
              </h3>
            </div>
            ${renderApprovalQueue(state.pendingAnnouncements, state.pendingEvents)}
          </div>

          <div class="card" style="padding:20px;">
            <h3 style="font-family:var(--font-display);font-size:16px;font-weight:700;margin-bottom:16px;">Quick Actions</h3>
            <div class="admin-quick-actions">
              <button class="btn btn-primary quick-action-full" onclick="navigateTo('admin-users')"><i class="fas fa-users-cog"></i> Manage Users</button>
              <div class="quick-action-row">
                <button class="btn btn-gold" onclick="openModal('announcement')"><i class="fas fa-bullhorn"></i> Post Announcement</button>
                <button class="btn btn-secondary" onclick="openModal('event')"><i class="fas fa-calendar-plus"></i> Create Event</button>
              </div>
            </div>
          </div>
        </div>`;

      bindApprovalActions();
    } catch (err) {
      console.error('[Admin dashboard] load error:', err);
      pageArea.querySelector('.page-content').innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Failed to load dashboard</h3><p>${escHtml(err.message || '')}</p></div>`;
    }
  }

  // Render the admin approval queue (announcements + events).
  function renderApprovalQueue(pendingAnn, pendingEv) {
    const totalPending = (pendingAnn?.length || 0) + (pendingEv?.length || 0);
    if (totalPending === 0) {
      return '<div class="empty-state" style="padding:24px;"><i class="fas fa-check-circle"></i><h3>All caught up</h3><p>No posts waiting for approval.</p></div>';
    }
    const annHtml = (pendingAnn || []).map(a => `
      <div class="approval-row" data-id="${a.id}" data-kind="announcement">
        <div class="approval-row-main">
          <div class="approval-row-meta"><i class="fas fa-bullhorn"></i> Announcement · <strong>${escHtml(a.author_name || 'Unknown')}</strong>${a.author_department ? ' · ' + escHtml(a.author_department) : ''} · ${timeAgo(a.created_at)}</div>
          <div class="approval-row-title">${escHtml(a.title)}</div>
          <div class="approval-row-body">${escHtml(a.content).slice(0, 240)}${a.content.length > 240 ? '…' : ''}</div>
          <div class="approval-row-tag">Visibility: ${escHtml(a.department || 'General')}</div>
        </div>
        <div class="approval-row-actions">
          <button class="btn btn-primary btn-sm approve-btn"><i class="fas fa-check"></i> Approve</button>
          <button class="btn btn-secondary btn-sm reject-btn"><i class="fas fa-times"></i> Reject</button>
        </div>
      </div>`).join('');
    const evHtml = (pendingEv || []).map(e => `
      <div class="approval-row" data-id="${e.id}" data-kind="event">
        <div class="approval-row-main">
          <div class="approval-row-meta"><i class="fas fa-calendar-alt"></i> Event · <strong>${escHtml(e.author_name || 'Unknown')}</strong>${e.author_department ? ' · ' + escHtml(e.author_department) : ''} · ${timeAgo(e.created_at)}</div>
          <div class="approval-row-title">${escHtml(e.title)}</div>
          <div class="approval-row-body">${escHtml(e.description || '').slice(0, 240)}</div>
          <div class="approval-row-tag">${escHtml(new Date(e.event_date).toLocaleDateString())} ${e.start_time ? '· ' + e.start_time : ''} · Visibility: ${escHtml(e.department || 'General')}</div>
        </div>
        <div class="approval-row-actions">
          <button class="btn btn-primary btn-sm approve-btn"><i class="fas fa-check"></i> Approve</button>
          <button class="btn btn-secondary btn-sm reject-btn"><i class="fas fa-times"></i> Reject</button>
        </div>
      </div>`).join('');
    return `<div class="approval-list">${annHtml}${evHtml}</div>`;
  }

  function bindApprovalActions() {
    document.querySelectorAll('.approval-row').forEach(row => {
      const id = row.dataset.id;
      const kind = row.dataset.kind; // 'announcement' or 'event'
      const base = kind === 'announcement' ? '/api/announcements' : '/api/events';
      row.querySelector('.approve-btn').onclick = async () => {
        try {
          await api(`${base}/${id}/approve`, { method: 'POST' });
          showToast(`${kind === 'announcement' ? 'Announcement' : 'Event'} approved`, 'success');
          loadAdminDashboard();
        } catch (err) { showToast(err.message, 'error'); }
      };
      row.querySelector('.reject-btn').onclick = async () => {
        const reason = prompt('Optional reason for rejection (leave empty to skip):') || '';
        try {
          await api(`${base}/${id}/reject`, {
            method: 'POST',
            body: JSON.stringify({ reason }),
          });
          showToast(`${kind === 'announcement' ? 'Announcement' : 'Event'} rejected`, 'success');
          loadAdminDashboard();
        } catch (err) { showToast(err.message, 'error'); }
      };
    });
  }

  // ════════════════════════════════
  //  ADMIN - MANAGE USERS
  // ════════════════════════════════
  async function loadAdminUsers() {
    const pageArea = document.getElementById('pageArea');
    pageArea.innerHTML = `<div class="page-header"><h1 class="page-title">Manage Users</h1><p class="page-subtitle">Approve, verify, and manage accounts</p></div><div class="page-content"><div class="loader"><div class="spinner"></div></div></div>`;

    try {
      if (state.adminUsersTab === 'users') {
        const users = await api('/api/admin/users');
        state.adminUsers = users;
      } else {
        const regs = await api('/api/admin/allowed-registrations');
        state.adminAllowedRegs = regs;
      }
      renderAdminUsersPage();
    } catch (err) {
      pageArea.querySelector('.page-content').innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Failed to load data</h3></div>`;
    }
  }

  // ── Helper: user action buttons ─────────────────────────────────────────────
  function _userActions(u) {
    return `<div style="display:flex;flex-direction:row;flex-wrap:wrap;gap:6px;align-items:center;">
      ${!u.is_verified ? `<button class="btn btn-success btn-sm" style="width:auto;" onclick="window._verifyUser('${u.id}')">Verify</button>` : ''}
      ${u.is_active
        ? `<button class="btn btn-secondary btn-sm" style="width:auto;" onclick="window._toggleUser('${u.id}','deactivate')">Disable</button>`
        : `<button class="btn btn-secondary btn-sm" style="width:auto;" onclick="window._toggleUser('${u.id}','activate')">Enable</button>`}
      <button class="btn btn-danger btn-sm" style="width:auto;" onclick="window._deleteUser('${u.id}')">Delete</button>
    </div>`;
  }
  function _userStatus(u) {
    return `${u.is_verified ? '<span class="status-badge verified"><i class="fas fa-check-circle"></i> Verified</span>' : '<span class="status-badge pending"><i class="fas fa-clock"></i> Pending</span>'}
      ${!u.is_active ? '<span class="status-badge inactive" style="margin-left:4px;">Inactive</span>' : ''}`;
  }

  // ── Renders the Registered Users tab content ─────────────────────────────────
  function _renderGroupedUsers(users) {
    const YEAR_ORDER = ['1st', '2nd', '3rd', '4th'];
    const faculty  = users.filter(u => u.role === 'faculty');
    const students = users.filter(u => u.role !== 'faculty');

    // Group: dept → year → []
    const byDept = {};
    students.forEach(u => {
      const d = u.department || 'No Department';
      const y = u.year_level  || 'Unknown';
      if (!byDept[d]) byDept[d] = {};
      if (!byDept[d][y]) byDept[d][y] = [];
      byDept[d][y].push(u);
    });

    // Faculty table
    const facultyRows = faculty.length === 0
      ? `<tr><td colspan="4" style="text-align:center;padding:28px;color:var(--text-light);">No faculty accounts</td></tr>`
      : faculty.map(u => `<tr>
          <td><strong>${escHtml(u.first_name)} ${escHtml(u.last_name)}</strong><br>
              <span style="font-size:11px;color:var(--text-light);">${escHtml(u.email)}</span></td>
          <td>${escHtml(u.student_number || '—')}</td>
          <td>${_userStatus(u)}</td>
          <td>${_userActions(u)}</td>
        </tr>`).join('');

    // Student sections: dept → year
    const studentSections = Object.keys(byDept).sort().map(dept => {
      const deptTotal = Object.values(byDept[dept]).flat().length;
      const yearSections = [...YEAR_ORDER, ...Object.keys(byDept[dept]).filter(y => !YEAR_ORDER.includes(y))]
        .filter(y => byDept[dept][y])
        .map(year => {
          const list = byDept[dept][year];
          const rows = list.map(u => `<tr>
            <td><strong>${escHtml(u.first_name)} ${escHtml(u.last_name)}</strong><br>
                <span style="font-size:11px;color:var(--text-light);">${escHtml(u.email)}</span></td>
            <td>${escHtml(u.student_number || '—')}</td>
            <td>${escHtml(u.section || '—')}</td>
            <td>${_userStatus(u)}</td>
            <td>${_userActions(u)}</td>
          </tr>`).join('');
          return `<details class="admin-year-group" open>
            <summary class="admin-year-summary">
              ${year} Year <span class="admin-dept-badge" style="margin-left:6px;">${list.length}</span>
            </summary>
            <div class="admin-table-wrap">
              <table class="admin-table">
                <thead><tr><th>Name</th><th>ID Number</th><th>Section</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </details>`;
        }).join('');
      return `<details class="admin-dept-group" open>
        <summary class="admin-dept-summary">
          ${escHtml(dept)} <span class="admin-dept-badge">${deptTotal} student${deptTotal !== 1 ? 's' : ''}</span>
        </summary>
        ${yearSections}
      </details>`;
    }).join('');

    return `
      <div class="admin-role-section">
        <div class="admin-role-header">
          <i class="fas fa-chalkboard-teacher"></i> Faculty
          <span class="admin-count-badge">${faculty.length}</span>
        </div>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead><tr><th>Name</th><th>ID Number</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>${facultyRows}</tbody>
          </table>
        </div>
      </div>
      <div class="admin-role-section">
        <div class="admin-role-header">
          <i class="fas fa-user-graduate"></i> Students
          <span class="admin-count-badge">${students.length}</span>
        </div>
        ${students.length === 0
          ? '<div style="padding:28px;text-align:center;color:var(--text-light);">No students found</div>'
          : studentSections}
      </div>`;
  }

  // ── Renders the Allowed IDs tab content ──────────────────────────────────────
  function _renderGroupedAllowedIds(regs) {
    const faculty  = regs.filter(r => r.role === 'faculty');
    const students = regs.filter(r => r.role === 'student');

    const byDept = {};
    students.forEach(r => {
      const d = r.department || 'Unknown';
      if (!byDept[d]) byDept[d] = [];
      byDept[d].push(r);
    });

    const regRow = r => `<tr>
      <td style="text-align:center;">
        <input type="checkbox" class="allowed-reg-check" data-reg-id="${r.id}" style="cursor:pointer;" ${state.adminSelectedAllowedIds.has(String(r.id)) ? 'checked' : ''}>
      </td>
      <td><strong>${escHtml(r.id_number)}</strong></td>
      <td>${r.is_used
        ? '<span class="status-badge verified"><i class="fas fa-user-check"></i> Registered</span>'
        : '<span class="status-badge pending"><i class="fas fa-hourglass-half"></i> Not Yet Registered</span>'}</td>
      <td>${timeAgo(r.created_at)}</td>
      <td><button class="btn btn-danger btn-sm" onclick="window._deleteAllowedReg('${r.id}')"><i class="fas fa-trash-alt"></i> Remove</button></td>
    </tr>`;

    const regTableHead = `<thead><tr>
      <th style="width:40px;text-align:center;">
        <input type="checkbox" class="select-all-in-section" style="cursor:pointer;" title="Select all in this section">
      </th>
      <th>ID Number</th><th>Registration Status</th><th>Added At</th><th>Actions</th>
    </tr></thead>`;

    const facultyRows  = faculty.length === 0
      ? `<tr><td colspan="5" style="text-align:center;padding:28px;color:var(--text-light);">No faculty IDs added</td></tr>`
      : faculty.map(regRow).join('');

    const studentSections = Object.keys(byDept).sort().map(dept => {
      const list = byDept[dept];
      return `<details class="admin-dept-group" open>
        <summary class="admin-dept-summary">
          ${escHtml(dept)} <span class="admin-dept-badge">${list.length}</span>
        </summary>
        <div class="admin-table-wrap">
          <table class="admin-table">
            ${regTableHead}
            <tbody>${list.map(regRow).join('')}</tbody>
          </table>
        </div>
      </details>`;
    }).join('');

    return `
      <div class="teaching-actions" style="margin-bottom:16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <button class="btn btn-primary btn-sm" id="btnUploadAllowed"><i class="fas fa-file-upload"></i> Upload CSV</button>
        <button class="btn btn-secondary btn-sm" id="btnAddAllowed"><i class="fas fa-plus"></i> Add Single ID</button>
        <button class="btn btn-danger btn-sm" id="btnRemoveSelected" style="${state.adminSelectedAllowedIds.size > 0 ? '' : 'display:none;'}">
          <i class="fas fa-trash-alt"></i> Remove Selected (<span id="selectedCount">${state.adminSelectedAllowedIds.size}</span>)
        </button>
      </div>
      <div class="admin-role-section">
        <div class="admin-role-header">
          <i class="fas fa-chalkboard-teacher"></i> Faculty IDs
          <span class="admin-count-badge">${faculty.length}</span>
        </div>
        <div class="admin-table-wrap">
          <table class="admin-table">
            ${regTableHead}
            <tbody>${facultyRows}</tbody>
          </table>
        </div>
      </div>
      <div class="admin-role-section">
        <div class="admin-role-header">
          <i class="fas fa-user-graduate"></i> Student IDs
          <span class="admin-count-badge">${students.length}</span>
        </div>
        ${students.length === 0
          ? '<div style="padding:28px;text-align:center;color:var(--text-light);">No student IDs added</div>'
          : studentSections}
      </div>`;
  }

  function renderAdminUsersPage() {
    const pageArea = document.getElementById('pageArea');

    const filteredUsers = state.adminUsers.filter(u => {
      const matchSearch = (u.first_name + ' ' + u.last_name + ' ' + (u.student_number || '') + ' ' + (u.email || '')).toLowerCase().includes(state.adminUsersSearch.toLowerCase());
      // Faculty have no department — only show them when filter is 'All'
      const matchDept = state.adminUsersDept === 'All'
        || u.department === state.adminUsersDept
        || (u.role === 'faculty' && state.adminUsersDept === 'All');
      return matchSearch && matchDept;
    });

    const filteredRegs = state.adminAllowedRegs.filter(r => {
      const matchSearch = r.id_number.toLowerCase().includes(state.adminUsersSearch.toLowerCase());
      // Faculty have no department — only show them when filter is 'All'
      const matchDept = state.adminUsersDept === 'All'
        || r.department === state.adminUsersDept
        || (r.role === 'faculty' && state.adminUsersDept === 'All');
      return matchSearch && matchDept;
    });

    const tabsHtml = `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:24px;">
        <div class="tabs" style="margin-bottom:0;">
          <button class="tab-btn ${state.adminUsersTab === 'users' ? 'active' : ''}" data-tab="admin-users-list"><i class="fas fa-user-check"></i> Registered Users</button>
          <button class="tab-btn ${state.adminUsersTab === 'allowed' ? 'active' : ''}" data-tab="admin-allowed-ids"><i class="fas fa-id-card"></i> Allowed IDs</button>
        </div>
        <div class="admin-filters-bar" style="display:flex; gap:10px; flex-grow:1; justify-content:flex-end;">
          <div class="search-input-wrap" style="position:relative; max-width:300px; width:100%;">
            <i class="fas fa-search" style="position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--text-light); font-size:12px;"></i>
            <input type="text" id="adminUsersSearch" class="form-input" placeholder="Search ID or Name..." value="${escHtml(state.adminUsersSearch)}" style="padding-left:34px; height:42px; border-radius:var(--radius-md);">
          </div>
          <select id="adminUsersDeptFilter" class="form-input form-select" style="width:160px; height:42px; border-radius:var(--radius-md);">
            ${departments.map(d => `<option value="${d}" ${state.adminUsersDept === d ? 'selected' : ''}>${d}</option>`).join('')}
          </select>
        </div>
      </div>
    `;

    const contentHtml = state.adminUsersTab === 'users'
      ? _renderGroupedUsers(filteredUsers)
      : _renderGroupedAllowedIds(filteredRegs);

    const dynamicContent = document.getElementById('adminUsersDynamicContent');
    if (dynamicContent) {
      dynamicContent.innerHTML = contentHtml;
      // Re-bind specific buttons if on allowed tab
      if (state.adminUsersTab === 'allowed') {
        const bu = document.getElementById('btnUploadAllowed');
        const ba = document.getElementById('btnAddAllowed');
        if (bu) bu.onclick = () => openModal('allowed-upload');
        if (ba) ba.onclick = () => openModal('allowed-single');
        _bindAllowedTabCheckboxes();
      }
      return;
    }

    pageArea.innerHTML = `
      <div class="page-header"><h1 class="page-title">Manage Users</h1><p class="page-subtitle">Approve and manage campus accounts</p></div>
      <div class="page-content">
        ${tabsHtml}
        <div id="adminUsersDynamicContent">${contentHtml}</div>
      </div>`;

    // Bind tabs
    document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
      btn.onclick = () => {
        state.adminUsersTab = btn.dataset.tab === 'admin-users-list' ? 'users' : 'allowed';
        state.adminSelectedAllowedIds = new Set();
        loadAdminUsers();
      };
    });

    // Bind Search
    const searchInput = document.getElementById('adminUsersSearch');
    if (searchInput) {
      searchInput.oninput = () => {
        state.adminUsersSearch = searchInput.value;
        renderAdminUsersPage(); // This will now only update dynamicContent
      };
    }

    // Bind Dept Filter
    const deptFilter = document.getElementById('adminUsersDeptFilter');
    if (deptFilter) {
      deptFilter.onchange = () => {
        state.adminUsersDept = deptFilter.value;
        renderAdminUsersPage();
      };
    }

    if (state.adminUsersTab === 'allowed') {
      const btnUpload = document.getElementById('btnUploadAllowed');
      const btnAdd = document.getElementById('btnAddAllowed');
      if (btnUpload) btnUpload.onclick = () => openModal('allowed-upload');
      if (btnAdd) btnAdd.onclick = () => openModal('allowed-single');
      _bindAllowedTabCheckboxes();
    }
  }

  window._verifyUser = async (id) => {
    try {
      await api(`/api/admin/users/${id}/verify`, { method: 'PATCH' });
      showToast('User verified', 'success');
      loadAdminUsers();
    } catch (err) { showToast(err.message, 'error'); }
  };

  window._toggleUser = async (id, action) => {
    try {
      await api(`/api/admin/users/${id}/${action}`, { method: 'PATCH' });
      showToast(`User ${action}d`, 'success');
      loadAdminUsers();
    } catch (err) { showToast(err.message, 'error'); }
  };

  window._deleteUser = async (id) => {
    if (!confirm('Delete this user permanently?')) return;
    try {
      await api(`/api/admin/users/${id}`, { method: 'DELETE' });
      showToast('User deleted', 'success');
      loadAdminUsers();
    } catch (err) { showToast(err.message, 'error'); }
  };

  window._deleteAllowedReg = async (id) => {
    if (!confirm('Remove this ID from the allowed list? If the user has already registered, their account will ALSO be deleted.')) return;
    try {
      const res = await api(`/api/admin/allowed-registrations/${id}`, { method: 'DELETE' });
      showToast(res.message || 'ID removed', 'success');
      state.adminSelectedAllowedIds.delete(String(id));
      loadAdminUsers();
    } catch (err) { showToast(err.message, 'error'); }
  };

  function _bindAllowedTabCheckboxes() {
    // Individual row checkboxes
    document.querySelectorAll('.allowed-reg-check').forEach(cb => {
      cb.onchange = () => {
        const rid = cb.dataset.regId;
        if (cb.checked) state.adminSelectedAllowedIds.add(rid);
        else state.adminSelectedAllowedIds.delete(rid);
        _syncRemoveSelectedBtn();
        // Sync the nearest section's select-all header checkbox
        const table = cb.closest('table');
        if (table) {
          const sectionChecks = table.querySelectorAll('.allowed-reg-check');
          const sectionSelectAll = table.querySelector('.select-all-in-section');
          if (sectionSelectAll) sectionSelectAll.checked = sectionChecks.length > 0 && [...sectionChecks].every(c => c.checked);
        }
      };
    });

    // Per-section "select all" header checkboxes
    document.querySelectorAll('.select-all-in-section').forEach(selectAll => {
      const table = selectAll.closest('table');
      if (!table) return;
      const sectionChecks = table.querySelectorAll('.allowed-reg-check');
      // Reflect current state
      selectAll.checked = sectionChecks.length > 0 && [...sectionChecks].every(c => c.checked);
      selectAll.onchange = () => {
        sectionChecks.forEach(cb => {
          cb.checked = selectAll.checked;
          if (selectAll.checked) state.adminSelectedAllowedIds.add(cb.dataset.regId);
          else state.adminSelectedAllowedIds.delete(cb.dataset.regId);
        });
        _syncRemoveSelectedBtn();
      };
    });

    // Remove Selected button
    const btnRemove = document.getElementById('btnRemoveSelected');
    if (btnRemove) btnRemove.onclick = window._bulkDeleteAllowedRegs;
  }

  function _syncRemoveSelectedBtn() {
    const btn = document.getElementById('btnRemoveSelected');
    const countEl = document.getElementById('selectedCount');
    if (!btn) return;
    const n = state.adminSelectedAllowedIds.size;
    if (countEl) countEl.textContent = n;
    btn.style.display = n > 0 ? '' : 'none';
  }

  window._bulkDeleteAllowedRegs = async () => {
    const ids = [...state.adminSelectedAllowedIds];
    if (ids.length === 0) return;
    const hasAccounts = ids.some(id => {
      const r = state.adminAllowedRegs.find(x => String(x.id) === String(id));
      return r && r.is_used;
    });
    const warning = hasAccounts
      ? `Remove ${ids.length} selected ID${ids.length !== 1 ? 's' : ''}? Registered accounts linked to these IDs will ALSO be permanently deleted.`
      : `Remove ${ids.length} selected ID${ids.length !== 1 ? 's' : ''} from the allowed list?`;
    if (!confirm(warning)) return;
    try {
      const res = await api('/api/admin/allowed-registrations', {
        method: 'DELETE',
        body: JSON.stringify({ ids })
      });
      showToast(res.message || `${ids.length} IDs removed`, 'success');
      state.adminSelectedAllowedIds = new Set();
      loadAdminUsers();
    } catch (err) { showToast(err.message, 'error'); }
  };

  // Make navigateTo globally accessible for inline onclick
  window.navigateTo = navigateTo;
  window.openModal = openModal;

  // ════════════════════════════════
  //  MODALS
  // ════════════════════════════════
  function openModal(type, modalData) {
    let title, bodyHtml, onSubmit, footerHtml = null;
    pendingFiles = [];

    switch (type) {
      case 'facultyStatus': {
        title = 'Set My Status';
        const current = state.user.faculty_status || 'unavailable';
        const room = state.user.faculty_status_room || '';
        const note = state.user.faculty_status_note || '';
        // Convert UTC → local for the datetime-local input (which expects local time).
        let until = '';
        if (state.user.faculty_status_until) {
          const d = new Date(state.user.faculty_status_until);
          const pad = (n) => String(n).padStart(2, '0');
          until = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        }
        bodyHtml = `
          <div class="form-group">
            <label>Status</label>
            <div class="status-picker" id="statusPicker">
              ${[
                { v: 'in_class',    label: 'In Class',    icon: 'fa-chalkboard-teacher' },
                { v: 'in_office',   label: 'In Office',   icon: 'fa-door-open' },
                { v: 'available',   label: 'Available',   icon: 'fa-check-circle' },
                { v: 'unavailable', label: 'Unavailable', icon: 'fa-circle-minus' },
              ].map(o => `
                <label class="status-option ${current === o.v ? 'active' : ''}">
                  <input type="radio" name="facStatus" value="${o.v}" ${current === o.v ? 'checked' : ''}>
                  <i class="fas ${o.icon}"></i>
                  <span>${o.label}</span>
                </label>
              `).join('')}
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Room <span class="muted-hint">(optional)</span></label>
              <input type="text" class="form-input" id="statusRoom" value="${escHtml(room)}" placeholder="e.g., Room 305">
            </div>
            <div class="form-group">
              <label>Until <span class="muted-hint">(optional)</span></label>
              <input type="datetime-local" class="form-input" id="statusUntil" value="${until}">
            </div>
          </div>
          <div class="form-group">
            <label>Note <span class="muted-hint">(optional)</span></label>
            <input type="text" class="form-input" id="statusNote" value="${escHtml(note)}" placeholder="e.g., Back after lunch" maxlength="255">
          </div>
          <div class="form-help"><i class="fas fa-info-circle"></i> Your status will auto-clear to "Unavailable" after the "Until" time passes.</div>
        `;
        onSubmit = async () => {
          const selected = document.querySelector('input[name="facStatus"]:checked');
          if (!selected) { showToast('Please pick a status', 'error'); return; }
          const payload = {
            status: selected.value,
            room: document.getElementById('statusRoom').value.trim() || null,
            note: document.getElementById('statusNote').value.trim() || null,
            until: document.getElementById('statusUntil').value || null,
          };
          try {
            const res = await api('/api/auth/me/faculty-status', {
              method: 'PATCH',
              body: JSON.stringify(payload),
            });
            Object.assign(state.user, res);
            showToast('Status updated', 'success');
            closeModal();
            fetchFacultyLocations();
          } catch (err) {
            showToast(err.message || 'Failed to update status', 'error');
          }
        };
        break;
      }
      case 'announcement':
        title = 'New Announcement';
        bodyHtml = `
          <div class="form-group">
            <label>Title</label>
            <input type="text" class="form-input" id="modalTitle" placeholder="Announcement title">
          </div>
          <div class="form-group">
            <label>Content</label>
            <textarea class="form-input" id="modalContent" rows="4" placeholder="Write your announcement..." style="resize:vertical;"></textarea>
          </div>
          <div class="form-group">
            <label>Visibility</label>
            <select class="form-input form-select" id="modalDept">
              ${(state.user.role === 'admin' || state.user.role === 'faculty'
                ? departments.filter(d => d !== 'All')
                : ['General', state.user.department].filter(Boolean).filter((v,i,a) => a.indexOf(v)===i)
              ).map(d => `<option value="${d}"${d === 'General' ? ' selected' : ''}>${d}</option>`).join('')}
            </select>
            <div class="form-help"><i class="fas fa-info-circle"></i> <strong>General</strong> and <strong>Campus</strong> are visible to everyone. Department options limit the audience to that department.</div>
          </div>
          <div class="form-group">
            <label>Photos</label>
            ${renderImageUploadWidget('annImages')}
          </div>
          ${state.user.role !== 'admin' ? '<div class="form-note"><i class="fas fa-clock"></i> Your post will be reviewed by an admin before it appears in the feed.</div>' : ''}`;
        onSubmit = async () => {
          const titleVal = document.getElementById('modalTitle').value.trim();
          const content = document.getElementById('modalContent').value.trim();
          const department = document.getElementById('modalDept').value;
          if (!titleVal || !content) { showToast('Please fill in title and content', 'error'); return; }

          const formData = new FormData();
          formData.append('title', titleVal);
          formData.append('content', content);
          formData.append('department', department);
          pendingFiles.forEach(f => formData.append('images', f));

          const res = await apiFormData('/api/announcements', formData);
          showToast(res.message || 'Announcement posted!', 'success');
          closeModal();
          loadAnnouncements();
        };
        break;

      case 'event':
        title = 'Create Event';
        bodyHtml = `
          <div class="form-group">
            <label>Event Title</label>
            <input type="text" class="form-input" id="modalTitle" placeholder="Event name">
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea class="form-input" id="modalDesc" rows="3" placeholder="Event details..." style="resize:vertical;"></textarea>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Date</label>
              <input type="date" class="form-input" id="modalDate" min="${new Date().toISOString().split('T')[0]}">
            </div>
            <div class="form-group">
              <label>Location</label>
              <input type="text" class="form-input" id="modalLocation" placeholder="Venue">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Start Time</label>
              <input type="time" class="form-input" id="modalStart">
            </div>
            <div class="form-group">
              <label>End Time</label>
              <input type="time" class="form-input" id="modalEnd">
            </div>
          </div>
          <div class="form-group">
            <label>Visibility</label>
            <select class="form-input form-select" id="modalDept">
              ${(state.user.role === 'admin' || state.user.role === 'faculty'
                ? departments.filter(d => d !== 'All')
                : ['General', state.user.department].filter(Boolean).filter((v,i,a) => a.indexOf(v)===i)
              ).map(d => `<option value="${d}"${d === 'General' ? ' selected' : ''}>${d}</option>`).join('')}
            </select>
            <div class="form-help"><i class="fas fa-info-circle"></i> <strong>General</strong> and <strong>Campus</strong> are visible to everyone. Department options limit the event to that department.</div>
          </div>
          <div class="form-group">
            <label>Event Photos</label>
            ${renderImageUploadWidget('eventImages')}
          </div>
          ${state.user.role !== 'admin' ? '<div class="form-note"><i class="fas fa-clock"></i> Your event will be reviewed by an admin before it appears in the calendar.</div>' : ''}`;
        onSubmit = async () => {
          const titleVal = document.getElementById('modalTitle').value.trim();
          const description = document.getElementById('modalDesc').value.trim();
          const event_date = document.getElementById('modalDate').value;
          const location = document.getElementById('modalLocation').value.trim();
          const start_time = document.getElementById('modalStart').value;
          const end_time = document.getElementById('modalEnd').value;
          const department = document.getElementById('modalDept').value;
          if (!titleVal || !event_date) { showToast('Please fill in title and date', 'error'); return; }

          const formData = new FormData();
          formData.append('title', titleVal);
          formData.append('description', description);
          formData.append('event_date', event_date);
          formData.append('location', location);
          formData.append('start_time', start_time);
          formData.append('end_time', end_time);
          formData.append('department', department);
          pendingFiles.forEach(f => formData.append('images', f));

          const res = await apiFormData('/api/events', formData);
          showToast(res.message || 'Event created!', 'success');
          closeModal();
          loadEvents();
        };
        break;

      case 'lostfound':
        title = 'Report Item';
        bodyHtml = `
          <div class="form-group">
            <label>Type</label>
            <div class="lf-tabs" style="margin-bottom:0;">
              <button class="lf-tab active" data-val="lost" id="lfTypeLost">I Lost Something</button>
              ${state.user.role === 'admin' ? '<button class="lf-tab" data-val="found" id="lfTypeFound">I Found Something</button>' : ''}
            </div>
            <input type="hidden" id="modalLFType" value="lost">
          </div>
          <div class="form-group">
            <label>Item Name</label>
            <input type="text" class="form-input" id="modalItemName" placeholder="e.g., Blue Water Bottle">
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea class="form-input" id="modalItemDesc" rows="3" placeholder="Describe the item in detail (color, size, brand, distinguishing features)..." style="resize:vertical;"></textarea>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Category</label>
              <select class="form-input form-select" id="modalItemCat">
                ${lfCategories.map(c => `<option value="${c}">${c}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Location</label>
              <input type="text" class="form-input" id="modalItemLoc" placeholder="Where lost/found">
            </div>
          </div>
          <div class="form-group">
            <label>Contact Information</label>
            <input type="text" class="form-input" id="modalItemContact" placeholder="Phone, email, messenger \u2014 anything that helps the owner reach you">
          </div>
          <div class="form-group">
            <label>Photos</label>
            ${renderImageUploadWidget('lfImages')}
          </div>`;
        onSubmit = async () => {
          // Get the submit button and disable it immediately
          const submitButton = document.getElementById('modalSubmit');
          if (submitButton) submitButton.disabled = true;

          const data = {
            type: document.getElementById('modalLFType').value,
            item_name: document.getElementById('modalItemName').value.trim(),
            description: document.getElementById('modalItemDesc').value.trim(),
            category: document.getElementById('modalItemCat').value,
            location_found: document.getElementById('modalItemLoc').value.trim(),
            contact_info: document.getElementById('modalItemContact').value.trim(),
          };
          if (!data.item_name || !data.description) { 
            showToast('Please fill in item name and description', 'error'); 
            if (submitButton) submitButton.disabled = false; // Re-enable if validation fails
            return; 
          }

          const formData = new FormData();
          Object.entries(data).forEach(([k, v]) => formData.append(k, v));
          const fingerprints = await fingerprintFiles(pendingFiles);
          formData.append('image_fingerprints', JSON.stringify(fingerprints));
          pendingFiles.forEach(f => formData.append('images', f));

          try {
            const res = await apiFormData('/api/lost-found', formData);
            if (state.user.role === 'student' && res.autoMatch && res.autoMatch.matched) {
              showToast('Possible match found. Check the Lost and Found office.', 'success');
            } else {
              showToast(res.message || 'Item reported successfully!', 'success');
            }
            closeModal();
            loadLostFound();
          } catch (err) {
            console.error('Lost/Found submission error:', err);
            showToast(err.message || 'Failed to submit report', 'error');
            // Re-enable button on error
            if (submitButton) submitButton.disabled = false;
          }
        };
        break;

      case 'section-schedule':
        title = 'Post Class Schedule';
        bodyHtml = `
          <div class="form-group">
            <label>Schedule Title</label>
            <input type="text" class="form-input" id="ssTitle" placeholder="e.g., BSIT 1-A Schedule AY 2024-2025">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Department</label>
              <select class="form-input form-select" id="ssDept">
                ${departments.filter(d => d !== 'All').map(d => `<option value="${d}">${d}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Year Level</label>
              <select class="form-input form-select" id="ssYear">
                <option value="1st">1st Year</option>
                <option value="2nd">2nd Year</option>
                <option value="3rd">3rd Year</option>
                <option value="4th">4th Year</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>Section</label>
            <input type="text" class="form-input" id="ssSection" placeholder="e.g., A, B, BSIT-1A">
          </div>
          <div class="form-group">
            <label>Schedule Link (optional)</label>
            <input type="url" class="form-input" id="ssUrl" placeholder="https://drive.google.com/...">
            <small style="color:var(--text-light);font-size:11px;">Paste a Google Drive, Docs, or any URL to the schedule</small>
          </div>`;
        onSubmit = async () => {
          const title_val = document.getElementById('ssTitle').value.trim();
          const department = document.getElementById('ssDept').value;
          const year_level = document.getElementById('ssYear').value;
          const section = document.getElementById('ssSection').value.trim();
          const embed_url = document.getElementById('ssUrl').value.trim();
          if (!title_val || !section) { showToast('Please fill in title and section', 'error'); return; }
          await api('/api/section-schedules', { method: 'POST', body: JSON.stringify({ title: title_val, department, year_level, section, embed_url }) });
          showToast('Schedule posted!', 'success');
          closeModal();
          loadSectionSchedules();
        };
        break;

      case 'resolve-confirm': {
        // modalData = { id, item_name }
        const rd = modalData || {};
        title = 'Mark as Resolved';
        bodyHtml = `
          <div class="resolve-warning">
            <div class="resolve-warning-icon"><i class="fas fa-check-circle"></i></div>
            <div class="resolve-warning-body">
              <p class="resolve-warning-title">Are you sure this item has been returned?</p>
              <p class="resolve-warning-item">"${escHtml(rd.item_name || 'this item')}"</p>
              <ul class="resolve-warning-list">
                <li><i class="fas fa-eye-slash"></i> Students will no longer see this report.</li>
                <li><i class="fas fa-lock"></i> The item will be archived under the <strong>Resolved</strong> tab.</li>
                <li><i class="fas fa-undo"></i> You can still delete it later if needed.</li>
              </ul>
              <p class="resolve-warning-note">Only do this if the item was physically returned to its owner.</p>
            </div>
          </div>`;
        footerHtml = `
          <button class="btn btn-secondary btn-sm" onclick="closeModal()">
            <i class="fas fa-arrow-left"></i> Go Back
          </button>
          <button class="btn btn-success btn-sm" id="modalSubmit">
            <i class="fas fa-check-circle"></i> Yes, Mark as Resolved
          </button>`;
        onSubmit = async () => {
          await api(`/api/lost-found/${rd.id}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'resolved' }),
          });
          showToast('Item marked as resolved!', 'success');
          closeModal();
          loadLostFound();
        };
        break;
      }

      case 'lostfound-edit': {
        title = 'Edit Item';
        const lfItem = modalData || {};
        bodyHtml = `
          <div class="form-group">
            <label>Type</label>
            <div class="lf-tabs" style="margin-bottom:0;">
              <button class="lf-tab ${lfItem.type === 'lost' ? 'active' : ''}" data-val="lost" id="lfTypeLost">I Lost Something</button>
              <button class="lf-tab ${lfItem.type === 'found' ? 'active' : ''}" data-val="found" id="lfTypeFound">I Found Something</button>
            </div>
            <input type="hidden" id="modalLFType" value="${lfItem.type || 'lost'}">
          </div>
          <div class="form-group">
            <label>Item Name</label>
            <input type="text" class="form-input" id="modalItemName" value="${escHtml(lfItem.item_name || '')}">
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea class="form-input" id="modalItemDesc" rows="3" style="resize:vertical;">${escHtml(lfItem.description || '')}</textarea>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Category</label>
              <select class="form-input form-select" id="modalItemCat">
                ${lfCategories.map(c => `<option value="${c}"${c === lfItem.category ? ' selected' : ''}>${c}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Location</label>
              <input type="text" class="form-input" id="modalItemLoc" value="${escHtml(lfItem.location_found || '')}">
            </div>
          </div>
          <div class="form-group">
            <label>Contact Information</label>
            <input type="text" class="form-input" id="modalItemContact" value="${escHtml(lfItem.contact_info || '')}" placeholder="Phone, email, messenger">
          </div>`;
        onSubmit = async () => {
          const data = {
            type: document.getElementById('modalLFType').value,
            item_name: document.getElementById('modalItemName').value.trim(),
            description: document.getElementById('modalItemDesc').value.trim(),
            category: document.getElementById('modalItemCat').value,
            location_found: document.getElementById('modalItemLoc').value.trim(),
            contact_info: document.getElementById('modalItemContact').value.trim(),
          };
          if (!data.item_name || !data.description) { showToast('Please fill in item name and description', 'error'); return; }
          await api(`/api/lost-found/${lfItem.id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
          });
          showToast('Item updated', 'success');
          closeModal();
          loadLostFound();
        };
        break;
      }

      case 'doc-category':
        title = 'New Category';
        bodyHtml = `
          <div class="form-group">
            <label>Category Name</label>
            <input type="text" class="form-input" id="modalCatName" placeholder="e.g., Accreditation Forms">
          </div>
          <div class="form-group">
            <label>Description (optional)</label>
            <textarea class="form-input" id="modalCatDesc" rows="3" placeholder="Brief description of this category..." style="resize:vertical;"></textarea>
          </div>`;
        onSubmit = async () => {
          const name = document.getElementById('modalCatName').value.trim();
          if (!name) { showToast('Please enter a category name', 'error'); return; }
          await api('/api/documents/categories', { method: 'POST', body: JSON.stringify({ name, description: document.getElementById('modalCatDesc').value.trim() }) });
          showToast('Category created!', 'success');
          closeModal();
          loadDocuments();
        };
        break;

      case 'doc-category-edit':
        title = 'Edit Category';
        bodyHtml = `
          <div class="form-group">
            <label>Category Name</label>
            <input type="text" class="form-input" id="modalCatName" placeholder="e.g., Accreditation Forms">
          </div>
          <div class="form-group">
            <label>Description (optional)</label>
            <textarea class="form-input" id="modalCatDesc" rows="3" placeholder="Brief description of this category..." style="resize:vertical;"></textarea>
          </div>`;
        onSubmit = async () => {
          const name = document.getElementById('modalCatName').value.trim();
          if (!name) { showToast('Please enter a category name', 'error'); return; }
          await api(`/api/documents/categories/${modalData.id}`, { method: 'PATCH', body: JSON.stringify({ name, description: document.getElementById('modalCatDesc').value.trim() }) });
          showToast('Category updated!', 'success');
          closeModal();
          loadDocuments();
        };
        break;

      case 'doc-upload':
        title = 'Upload Document';
        bodyHtml = `
          <div class="form-group">
            <label>Title</label>
            <input type="text" class="form-input" id="modalDocTitle" placeholder="Document title">
          </div>
          <div class="form-group">
            <label>Description (optional)</label>
            <textarea class="form-input" id="modalDocDesc" rows="2" placeholder="Brief description..." style="resize:vertical;"></textarea>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Category</label>
              <select class="form-input form-select" id="modalDocCat">
                <option value="">-- Select Category --</option>
                ${state.docCategories.map(c => `<option value="${c.id}"${state.docSelectedCategory === c.id ? ' selected' : ''}>${escHtml(c.name)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Visible to</label>
              <select class="form-input form-select" id="modalDocDept">
                ${(state.user.role === 'admin'
                  ? departments.filter(d => d !== 'All')
                  : ['General', state.user.department].filter(Boolean)
                ).map(d => `<option value="${d}"${state.user.role !== 'admin' && d === state.user.department ? ' selected' : ''}>${escHtml(d)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>File</label>
            <div class="doc-file-upload-zone" id="docFileZone">
              <input type="file" id="docFileInput" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.jpg,.jpeg,.png,.gif,.webp" style="display:none;">
              <div class="doc-file-upload-placeholder" id="docFilePlaceholder">
                <i class="fas fa-cloud-upload-alt"></i>
                <span>Click or drag to upload</span>
                <small>PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, Images (max 25MB)</small>
              </div>
              <div class="doc-file-upload-selected" id="docFileSelected" style="display:none;"></div>
            </div>
          </div>`;
        onSubmit = async () => {
          const docTitle = document.getElementById('modalDocTitle').value.trim();
          const category_id = document.getElementById('modalDocCat').value;
          if (!docTitle) { showToast('Please enter a title', 'error'); return; }
          if (!category_id) { showToast('Please select a category', 'error'); return; }
          if (!pendingFiles[0]) { showToast('Please select a file', 'error'); return; }

          const formData = new FormData();
          formData.append('title', docTitle);
          formData.append('description', document.getElementById('modalDocDesc').value.trim());
          formData.append('category_id', category_id);
          const deptEl = document.getElementById('modalDocDept');
          if (deptEl) formData.append('department', deptEl.value);
          formData.append('file', pendingFiles[0]);

          await apiFormData('/api/documents', formData);
          showToast('Document uploaded!', 'success');
          closeModal();
          loadDocuments();
        };
        break;

      case 'doc-edit': {
        title = 'Edit Document';
        const currentDept = modalData?.department || 'General';
        const deptOptions = state.user.role === 'admin'
          ? departments.filter(d => d !== 'All')
          : Array.from(new Set(['General', state.user.department, currentDept].filter(Boolean)));
        bodyHtml = `
          <div class="form-group">
            <label>Title</label>
            <input type="text" class="form-input" id="modalDocTitle" placeholder="Document title">
          </div>
          <div class="form-group">
            <label>Description (optional)</label>
            <textarea class="form-input" id="modalDocDesc" rows="2" placeholder="Brief description..." style="resize:vertical;"></textarea>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Category</label>
              <select class="form-input form-select" id="modalDocCat">
                ${state.docCategories.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Visible to</label>
              <select class="form-input form-select" id="modalDocDept">
                ${deptOptions.map(d => `<option value="${d}"${d === currentDept ? ' selected' : ''}>${escHtml(d)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-help"><i class="fas fa-info-circle"></i> <strong>General</strong> is visible to everyone. Department choices limit visibility to that department (plus admins).</div>`;
        onSubmit = async () => {
          const docTitle = document.getElementById('modalDocTitle').value.trim();
          const category_id = document.getElementById('modalDocCat').value;
          const department = document.getElementById('modalDocDept').value;
          if (!docTitle) { showToast('Please enter a title', 'error'); return; }
          await api(`/api/documents/${modalData.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              title: docTitle,
              description: document.getElementById('modalDocDesc').value.trim(),
              category_id,
              department,
            }),
          });
          showToast('Document updated!', 'success');
          closeModal();
          loadDocuments();
        };
        break;
      }

      case 'schedule':
        title = 'Add Class';
        bodyHtml = `
          <div class="form-row">
            <div class="form-group"><label>Subject Code</label>
              <input type="text" class="form-input" id="modalSubCode" placeholder="e.g., IT132" style="text-transform:uppercase"></div>
            <div class="form-group"><label>Subject Name</label>
              <input type="text" class="form-input" id="modalSubName" placeholder="e.g., Web Development" style="text-transform:uppercase"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Department</label>
              <select class="form-input form-select" id="modalDept">
                <option value="">-- Select --</option>
                ${departments.filter(d => !['All', 'General', 'Campus'].includes(d)).map(d => '<option value="' + d + '"' + (d === (state.user.department || '') ? ' selected' : '') + '>' + d + '</option>').join('')}
              </select></div>
            <div class="form-group"><label>Year Level</label>
              <select class="form-input form-select" id="modalYearLevel">
                ${yearLevels.map(y => '<option value="' + y + '">' + y + ' Year</option>').join('')}
              </select></div>
            <div class="form-group"><label>Section</label>
              <select class="form-input form-select" id="modalSection">
                <option value="">-- Select --</option>
                ${sectionOptions.map(s => '<option value="' + s + '">' + s + '</option>').join('')}
              </select></div>
          </div>
          <div class="form-group"><label>Day of Week</label>
            <select class="form-input form-select" id="modalDay">
              ${days.map(d => '<option value="' + d + '">' + d + '</option>').join('')}
            </select></div>
          <div class="form-row">
            <div class="form-group"><label>Start Time</label><input type="time" class="form-input" id="modalStartTime"></div>
            <div class="form-group"><label>End Time</label><input type="time" class="form-input" id="modalEndTime"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Room</label>
              <input type="text" class="form-input" id="modalRoom" placeholder="e.g., Room 301" style="text-transform:uppercase"></div>
            <div class="form-group"><label>Instructor</label>
              <select class="form-input form-select" id="modalFacultyUser">
                <option value="">-- Select Faculty --</option>
                ${state.facultyList.map(f => '<option value="' + f.id + '">' + escHtml(f.last_name + ', ' + f.first_name) + (f.department ? ' (' + escHtml(f.department) + ')' : '') + '</option>').join('')}
              </select></div>
          </div>`;
        onSubmit = async () => {
          const facultySelect = document.getElementById('modalFacultyUser');
          const facultyUserId = facultySelect.value || null;
          const selectedFacultyLabel = facultySelect.value ? facultySelect.options[facultySelect.selectedIndex].text : '';
          const data = {
            subject_code: document.getElementById('modalSubCode').value.trim().toUpperCase(),
            subject_name: document.getElementById('modalSubName').value.trim().toUpperCase(),
            day_of_week: document.getElementById('modalDay').value,
            start_time: document.getElementById('modalStartTime').value,
            end_time: document.getElementById('modalEndTime').value,
            room: document.getElementById('modalRoom').value.trim().toUpperCase(),
            instructor: selectedFacultyLabel,
            faculty_user_id: facultyUserId,
            department: document.getElementById('modalDept').value,
            year_level: document.getElementById('modalYearLevel').value,
            section: document.getElementById('modalSection').value,
          };
          if (!data.subject_code || !data.subject_name || !data.start_time || !data.end_time) { showToast('Please fill in required fields', 'error'); return; }
          if (!data.department) { showToast('Please select a department', 'error'); return; }
          if (!data.instructor) { showToast('Please select an instructor', 'error'); return; }
          await api('/api/schedules', { method: 'POST', body: JSON.stringify(data) });
          showToast('Class added!', 'success');
          closeModal();
          loadSchedules();
        };
        break;

      case 'teaching':
        title = 'Add Teaching Class';
        bodyHtml = `
          <div class="form-row">
            <div class="form-group"><label>Subject Code</label>
              <input type="text" class="form-input" id="modalSubCode" placeholder="e.g., IT132" style="text-transform:uppercase"></div>
            <div class="form-group"><label>Subject Name</label>
              <input type="text" class="form-input" id="modalSubName" placeholder="e.g., Web Development" style="text-transform:uppercase"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Department</label>
              <select class="form-input form-select" id="modalDept">
                <option value="">-- Select --</option>
                ${departments.filter(d => !['All', 'General', 'Campus'].includes(d)).map(d => '<option value="' + d + '"' + (d === (state.user.department || '') ? ' selected' : '') + '>' + d + '</option>').join('')}
              </select></div>
            <div class="form-group"><label>Year Level</label>
              <select class="form-input form-select" id="modalYearLevel">
                ${yearLevels.map(y => '<option value="' + y + '">' + y + ' Year</option>').join('')}
              </select></div>
            <div class="form-group"><label>Section</label>
              <select class="form-input form-select" id="modalSection">
                <option value="">-- Select --</option>
                ${sectionOptions.map(s => '<option value="' + s + '">' + s + '</option>').join('')}
              </select></div>
          </div>
          <div class="form-group"><label>Day of Week</label>
            <select class="form-input form-select" id="modalDay">
              ${days.map(d => '<option value="' + d + '">' + d + '</option>').join('')}
            </select></div>
          <div class="form-row">
            <div class="form-group"><label>Start Time</label><input type="time" class="form-input" id="modalStartTime"></div>
            <div class="form-group"><label>End Time</label><input type="time" class="form-input" id="modalEndTime"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Room</label>
              <input type="text" class="form-input" id="modalRoom" placeholder="e.g., Room 301" style="text-transform:uppercase"></div>
            <div class="form-group"><label>Instructor</label>
              ${state.user.role === 'admin'
                ? '<select class="form-input form-select" id="modalFacultyUser"><option value="">-- Select Faculty --</option>' + state.facultyList.map(f => '<option value="' + f.id + '">' + escHtml(f.last_name + ', ' + f.first_name) + (f.department ? ' (' + escHtml(f.department) + ')' : '') + '</option>').join('') + '</select>'
                : '<input type="text" class="form-input" id="modalInstructorName" value="' + escHtml((state.user.last_name || '') + ', ' + (state.user.first_name || '')) + '" readonly style="background:var(--bg-secondary);cursor:not-allowed;text-transform:uppercase">'
              }</div>
          </div>`;
        onSubmit = async () => {
          const data = {
            subject_code: document.getElementById('modalSubCode').value.trim().toUpperCase(),
            subject_name: document.getElementById('modalSubName').value.trim().toUpperCase(),
            day_of_week: document.getElementById('modalDay').value,
            start_time: document.getElementById('modalStartTime').value,
            end_time: document.getElementById('modalEndTime').value,
            room: document.getElementById('modalRoom').value.trim().toUpperCase(),
            section: document.getElementById('modalSection').value,
            department: document.getElementById('modalDept').value,
            year_level: document.getElementById('modalYearLevel').value,
          };
          if (state.user.role === 'admin') {
            const fs = document.getElementById('modalFacultyUser');
            if (!fs || !fs.value) { showToast('Please select an instructor', 'error'); return; }
            data.faculty_id = fs.value;
          }
          if (!data.subject_code || !data.subject_name || !data.start_time || !data.end_time) { showToast('Please fill in required fields', 'error'); return; }
          if (!data.department) { showToast('Please select a department', 'error'); return; }
          await api('/api/faculty-schedules', { method: 'POST', body: JSON.stringify(data) });
          showToast('Teaching class added!', 'success');
          closeModal();
          loadTeachingSchedules();
        };
        break;

      case 'classUpload':
        title = 'Upload Class Schedule';
        bodyHtml = `
          <div class="csv-upload-info">
            <p><strong>Heads up:</strong> uploading replaces schedules for the selected department.</p>
            <p>CSV columns: <code>subject_code, subject_name, day_of_week, start_time, end_time, room, instructor, year_level, section</code></p>
            <p>PUP official exports also work. <a href="/api/schedules/template" download>Download template</a>.</p>
          </div>
          <div class="form-row" style="margin-bottom:12px">
            <div class="form-group"><label>Department</label>
              <select class="form-input form-select" id="modalUploadDept">
                <option value="">-- Select --</option>
                ${departments.filter(d => !['All', 'General', 'Campus'].includes(d)).map(d => '<option value="' + d + '"' + (d === (state.user.department || '') ? ' selected' : '') + '>' + d + '</option>').join('')}
              </select></div>
            <div class="form-group"><label>Year Level</label>
              <select class="form-input form-select" id="modalUploadYearLevel">
                ${yearLevels.map(y => '<option value="' + y + '">' + y + ' Year</option>').join('')}
              </select></div>
            <div class="form-group"><label>Section</label>
              <select class="form-input form-select" id="modalUploadSection">
                <option value="">-- Select --</option>
                ${sectionOptions.map(s => '<option value="' + s + '">' + s + '</option>').join('')}
              </select></div>
          </div>
          <div class="csv-dropzone" id="csvDropzone">
            <i class="fas fa-cloud-upload-alt"></i>
            <p id="csvDropText">Drop your CSV here or click to browse</p>
            <input type="file" id="csvFileInput" accept=".csv,text/csv" style="display:none">
          </div>
          <div id="csvResult"></div>`;
        onSubmit = async () => {
          const fileInput = document.getElementById('csvFileInput');
          if (!fileInput.files || fileInput.files.length === 0) { showToast('Please choose a CSV file first', 'error'); return; }
          const dept = document.getElementById('modalUploadDept').value;
          if (!dept) { showToast('Please select a department', 'error'); return; }
          const yearLevel = document.getElementById('modalUploadYearLevel').value;
          const fd = new FormData();
          fd.append('file', fileInput.files[0]);
          fd.append('department', dept);
          fd.append('year_level', yearLevel);
          const sec = document.getElementById('modalUploadSection').value;
          if (sec) fd.append('section', sec);
          const resultDiv = document.getElementById('csvResult');
          resultDiv.innerHTML = '<div class="loader"><div class="spinner"></div></div>';
          try {
            const res = await fetch('/api/schedules/upload', { method: 'POST', headers: getToken() ? { 'Authorization': `Bearer ${getToken()}` } : {}, body: fd });
            const data = await res.json();
            if (!res.ok) {
              resultDiv.innerHTML = '<div class="csv-error"><i class="fas fa-exclamation-triangle"></i> ' + escHtml(data.error || 'Upload failed') + '</div>' +
                (data.errors && data.errors.length ? '<ul class="csv-error-list">' + data.errors.map(function(e) { return '<li>Line ' + e.line + ': ' + escHtml(e.errors.join(', ')) + '</li>'; }).join('') + '</ul>' : '');
              return;
            }
            resultDiv.innerHTML = '<div class="csv-success"><i class="fas fa-check-circle"></i> ' + escHtml(data.message) + '</div>' +
              (data.errors && data.errors.length ? '<ul class="csv-error-list">' + data.errors.map(function(e) { return '<li>Line ' + e.line + ': ' + escHtml(e.errors.join(', ')) + '</li>'; }).join('') + '</ul>' : '');
            showToast(data.message, 'success');
            setTimeout(function() { closeModal(); loadSchedules(); }, 1200);
          } catch (err) {
            resultDiv.innerHTML = '<div class="csv-error"><i class="fas fa-exclamation-triangle"></i> ' + escHtml(err.message) + '</div>';
          }
        };
        break;

      case 'teachingUpload':
        title = 'Upload Teaching Schedule';
        bodyHtml = `
          <div class="csv-upload-info">
            <p><strong>Heads up:</strong> uploading replaces your current teaching schedule.</p>
            <p>CSV columns: <code>subject_code, subject_name, day_of_week, start_time, end_time, room, section</code></p>
            <p>Times can be <code>08:00</code>, <code>8:00 AM</code>, or <code>13:30</code>. Need a starter? <a href="/api/faculty-schedules/template" download>Download template</a>.</p>
          </div>
          <div class="csv-dropzone" id="csvDropzone">
            <i class="fas fa-cloud-upload-alt"></i>
            <p id="csvDropText">Drop your CSV here or click to browse</p>
            <input type="file" id="csvFileInput" accept=".csv,text/csv" style="display:none">
          </div>
          <div id="csvResult"></div>`;
        onSubmit = async () => {
          const fileInput = document.getElementById('csvFileInput');
          if (!fileInput.files || fileInput.files.length === 0) {
            showToast('Please choose a CSV file first', 'error'); return;
          }
          const fd = new FormData();
          fd.append('file', fileInput.files[0]);
          const resultDiv = document.getElementById('csvResult');
          resultDiv.innerHTML = '<div class="loader"><div class="spinner"></div></div>';
          try {
            const res = await fetch('/api/faculty-schedules/upload', { method: 'POST', headers: getToken() ? { 'Authorization': `Bearer ${getToken()}` } : {}, body: fd });
            const data = await res.json();
            if (!res.ok) {
              resultDiv.innerHTML = `<div class="csv-error"><i class="fas fa-exclamation-triangle"></i> ${escHtml(data.error || 'Upload failed')}</div>` +
                (data.errors && data.errors.length ? `<ul class="csv-error-list">${data.errors.map(e => `<li>Line ${e.line}: ${escHtml(e.errors.join(', '))}</li>`).join('')}</ul>` : '');
              return;
            }
            resultDiv.innerHTML = `<div class="csv-success"><i class="fas fa-check-circle"></i> ${escHtml(data.message)}</div>` +
              (data.errors && data.errors.length ? `<ul class="csv-error-list">${data.errors.map(e => `<li>Line ${e.line}: ${escHtml(e.errors.join(', '))}</li>`).join('')}</ul>` : '');
            showToast(data.message, 'success');
            setTimeout(() => { closeModal(); loadTeachingSchedules(); }, 1200);
          } catch (err) {
            resultDiv.innerHTML = `<div class="csv-error"><i class="fas fa-exclamation-triangle"></i> ${escHtml(err.message)}</div>`;
          }
        };
        break;

      case 'allowed-single':
        title = 'Add Authorized ID';
        bodyHtml = `
          <div class="form-group">
            <label>ID Number</label>
            <input type="text" class="form-input" id="modalIdNum" placeholder="e.g., 2023-00001-SJ-0 or F-0001" oninput="this.value=this.value.toUpperCase()" autocomplete="off" spellcheck="false">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Role</label>
              <select class="form-input form-select" id="modalRole">
                <option value="student">Student</option>
                <option value="faculty">Faculty</option>
              </select>
            </div>
            <div class="form-group" id="allowedDeptRow">
              <label>Department</label>
              <select class="form-input form-select" id="modalDept">
                 ${departments.filter(d => !['All', 'General', 'Campus'].includes(d)).map(d => `<option value="${d}">${d}</option>`).join('')}
              </select>
            </div>
          </div>`;
        // Wire up role→dept visibility after the modal renders
        setTimeout(() => {
          const mRole = document.getElementById('modalRole');
          const mDeptRow = document.getElementById('allowedDeptRow');
          if (mRole && mDeptRow) {
            const toggleAllowedDept = () => { mDeptRow.style.display = mRole.value === 'faculty' ? 'none' : ''; };
            mRole.onchange = toggleAllowedDept;
            toggleAllowedDept();
          }
        }, 0);
        onSubmit = async () => {
          const id_number = document.getElementById('modalIdNum').value.trim();
          const role = document.getElementById('modalRole').value;
          const deptEl = document.getElementById('modalDept');
          const department = (role === 'faculty' || !deptEl) ? null : deptEl.value;
          if (!id_number) { showToast('Please enter an ID number', 'error'); return; }
          await api('/api/admin/allowed-registrations', { method: 'POST', body: JSON.stringify({ id_number, role, department }) });
          showToast('ID added to authorized list', 'success');
          closeModal();
          loadAdminUsers();
        };
        break;

      case 'allowed-upload':
        title = 'Bulk Upload Authorized IDs';
        bodyHtml = `
          <div class="csv-upload-info">
            <p>Upload a CSV file containing ID numbers. IDs must match the campus format:</p>
            <ul style="margin: 8px 0 0 16px; font-size: 12px; color: var(--text-secondary);">
              <li><b>Students:</b> 2023-XXXXX-SJ-0</li>
              <li><b>Faculty:</b> F-XXXX</li>
            </ul>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Role</label>
              <select class="form-input form-select" id="modalRole">
                <option value="student">Students</option>
                <option value="faculty">Faculty</option>
              </select>
            </div>
            <div class="form-group" id="uploadDeptRow">
              <label>Department</label>
              <select class="form-input form-select" id="modalDept">
                 ${departments.filter(d => !['All', 'General', 'Campus'].includes(d)).map(d => `<option value="${d}">${d}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-group" style="margin-top:12px;">
            <label>CSV File</label>
            <div class="csv-dropzone" id="csvDropzone">
              <i class="fas fa-file-csv"></i>
              <p id="csvDropText">Click or drag CSV here</p>
              <input type="file" id="csvFileInput" accept=".csv" style="display:none">
            </div>
          </div>`;
        // Toggle department visibility based on role selection
        setTimeout(() => {
          const mRole = document.getElementById('modalRole');
          const mDeptRow = document.getElementById('uploadDeptRow');
          if (mRole && mDeptRow) {
            const toggle = () => { mDeptRow.style.display = mRole.value === 'faculty' ? 'none' : ''; };
            mRole.onchange = toggle;
            toggle();
          }
        }, 0);
        onSubmit = async () => {
          const role = document.getElementById('modalRole').value;
          const deptEl = document.getElementById('modalDept');
          const department = (role === 'faculty' || !deptEl) ? null : deptEl.value;
          const fileInput = document.getElementById('csvFileInput');
          if (!fileInput.files || fileInput.files.length === 0) { showToast('Please select a CSV file', 'error'); return; }
          if (role === 'student' && !department) { showToast('Please select a department for student IDs', 'error'); return; }

          const formData = new FormData();
          formData.append('role', role);
          if (department) formData.append('department', department);
          formData.append('file', fileInput.files[0]);

          const res = await apiFormData('/api/admin/allowed-registrations/upload', formData);
          showToast(`Bulk upload complete: ${res.added} IDs added.`, 'success');
          closeModal();
          loadAdminUsers();
        };
        break;

      case 'schedule-embed': {
        const existing  = state._embedModalData || null;
        const e         = existing || {};
        const yearOpts  = ['1st','2nd','3rd','4th'];
        const sectOpts  = ['1-1','1-2','1-3','2-1','2-2','2-3','3-1','3-2','3-3','4-1','4-2','4-3'];
        const deptOpts  = departments.filter(d => d !== 'All');
        title = existing ? 'Edit Schedule' : 'Post Schedule';
        bodyHtml = `
          <div class="form-row">
            <div class="form-group">
              <label>Department</label>
              <select class="form-input form-select" id="emDept">
                ${deptOpts.map(d => `<option value="${d}"${d === (e.department || state.scheduleFilterDept || deptOpts[0]) ? ' selected' : ''}>${d}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Year Level</label>
              <select class="form-input form-select" id="emYear">
                <option value="">Select</option>
                ${yearOpts.map(y => `<option value="${y}"${y === (e.year_level || state.scheduleFilterYear) ? ' selected' : ''}>${y}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Section</label>
              <select class="form-input form-select" id="emSection">
                <option value="">Select</option>
                ${sectOpts.map(s => `<option value="${s}"${s === (e.section || state.scheduleFilterSection) ? ' selected' : ''}>${s}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>Title <span style="color:var(--text-secondary);font-weight:400;">(optional)</span></label>
            <input type="text" class="form-input" id="emTitle" value="${escHtml(e.title || '')}" placeholder="e.g. 2nd Semester Schedule">
          </div>
          <div class="form-group">
            <label>Embed / Share URL</label>
            <input type="url" class="form-input" id="emUrl" value="${escHtml(e.embed_url || '')}" placeholder="https://docs.google.com/spreadsheets/d/...">
            <div class="embed-how-to">
              <div class="embed-how-to-title"><i class="fas fa-lightbulb"></i> How to share your Google Sheet</div>
              <ol class="embed-how-to-steps">
                <li>Open your Google Sheet</li>
                <li>Click the <strong>Share</strong> button (top-right)</li>
                <li>Under "General access", change it to <strong>Anyone with the link</strong></li>
                <li>Make sure it is set to <strong>Viewer</strong></li>
                <li>Click <strong>Copy link</strong> and paste it here</li>
              </ol>
              <p class="embed-how-to-note"><i class="fas fa-check-circle" style="color:var(--success);"></i> The system will automatically read your sheet and display it to students — no Google sign-in required.</p>
            </div>
          </div>`;
        onSubmit = async () => {
          const dept      = document.getElementById('emDept').value;
          const year      = document.getElementById('emYear').value;
          const section   = document.getElementById('emSection').value;
          const titleVal  = document.getElementById('emTitle').value.trim();
          const embed_url = document.getElementById('emUrl').value.trim();
          if (!dept || !year || !section || !embed_url) {
            showToast('Please fill in Department, Year Level, Section and the URL', 'error'); return;
          }
          const body = JSON.stringify({ department: dept, year_level: year, section, title: titleVal, embed_url });
          if (existing) {
            await api(`/api/schedules/embeds/${existing.id}`, { method: 'PATCH', body });
            showToast('Schedule updated', 'success');
          } else {
            await api('/api/schedules/embeds', { method: 'POST', body });
            showToast('Schedule posted', 'success');
          }
          closeModal();
          _loadScheduleManagement();
        };
        break;
      }

      default: return;
    }

    // Render modal
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'modalOverlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>${title}</h3>
          <button class="modal-close" onclick="closeModal()"><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
        <div class="modal-footer">
          ${footerHtml !== null
            ? footerHtml
            : `<button class="btn btn-secondary btn-sm" onclick="closeModal()">Cancel</button>
               <button class="btn btn-primary btn-sm" id="modalSubmit">Submit</button>`
          }
        </div>
      </div>`;

    document.body.appendChild(overlay);
    overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

    const submitBtn = document.getElementById('modalSubmit');
    if (submitBtn && onSubmit) {
      submitBtn.onclick = async () => {
        submitBtn.disabled = true;
        try { await onSubmit(); } catch (err) { showToast(err.message, 'error'); submitBtn.disabled = false; }
      };
    }

    // Lost/Found type toggle
    if (type === 'lostfound' || type === 'lostfound-edit') {
      const lostBtn = document.getElementById('lfTypeLost');
      const foundBtn = document.getElementById('lfTypeFound');
      const typeInput = document.getElementById('modalLFType');
      lostBtn.onclick = () => { lostBtn.classList.add('active'); if(foundBtn) foundBtn.classList.remove('active'); typeInput.value = 'lost'; };
      if (foundBtn) foundBtn.onclick = () => { foundBtn.classList.add('active'); if(lostBtn) lostBtn.classList.remove('active'); typeInput.value = 'found'; };
    }

    // CSV dropzone for schedule and allowed-id uploads
    if (type === 'teachingUpload' || type === 'classUpload' || type === 'allowed-upload') {
      const dz = document.getElementById('csvDropzone');
      const input = document.getElementById('csvFileInput');
      const txt = document.getElementById('csvDropText');
      dz.onclick = () => input.click();
      input.onchange = () => { if (input.files[0]) txt.textContent = input.files[0].name; };
      ['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('dragover'); }));
      ['dragleave','drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('dragover'); }));
      dz.addEventListener('drop', e => {
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          input.files = e.dataTransfer.files;
          txt.textContent = e.dataTransfer.files[0].name;
        }
      });
    }

    // Bind image upload widgets
    if (type === 'announcement') bindImageUpload('annImages');
    if (type === 'event') bindImageUpload('eventImages');
    if (type === 'lostfound') bindImageUpload('lfImages');

    // Document modal bindings
    if (type === 'doc-category-edit' && modalData) {
      const nameInput = document.getElementById('modalCatName');
      const descInput = document.getElementById('modalCatDesc');
      if (nameInput) nameInput.value = modalData.name || '';
      if (descInput) descInput.value = modalData.description || '';
    }
    if (type === 'doc-edit' && modalData) {
      const titleInput = document.getElementById('modalDocTitle');
      const descInput = document.getElementById('modalDocDesc');
      const catInput = document.getElementById('modalDocCat');
      if (titleInput) titleInput.value = modalData.title || '';
      if (descInput) descInput.value = modalData.description || '';
      if (catInput) catInput.value = modalData.categoryId || '';
    }
    if (type === 'doc-upload') {
      const zone = document.getElementById('docFileZone');
      const input = document.getElementById('docFileInput');
      const placeholder = document.getElementById('docFilePlaceholder');
      const selected = document.getElementById('docFileSelected');
      if (zone && input) {
        zone.onclick = (e) => { if (!e.target.closest('.doc-file-remove')) input.click(); };
        input.onchange = () => {
          if (input.files[0]) {
            pendingFiles = [input.files[0]];
            placeholder.style.display = 'none';
            selected.style.display = 'flex';
            selected.innerHTML = `
              <i class="fas ${getFileIcon(input.files[0].type)}" style="font-size:24px;color:${getFileIconColor(input.files[0].type)}"></i>
              <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(input.files[0].name)}</div>
                <div style="font-size:11px;color:var(--text-light);">${formatFileSize(input.files[0].size)}</div>
              </div>
              <button class="doc-file-remove"><i class="fas fa-times"></i></button>`;
            selected.querySelector('.doc-file-remove').onclick = (e) => {
              e.stopPropagation();
              pendingFiles = [];
              input.value = '';
              placeholder.style.display = '';
              selected.style.display = 'none';
            };
          }
        };
        zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('drag-over'); };
        zone.ondragleave = () => zone.classList.remove('drag-over');
        zone.ondrop = (e) => {
          e.preventDefault();
          zone.classList.remove('drag-over');
          if (e.dataTransfer.files[0]) {
            pendingFiles = [e.dataTransfer.files[0]];
            input.files = e.dataTransfer.files;
            input.dispatchEvent(new Event('change'));
          }
        };
      }
    }
  }

  window.closeModal = function () {
    const overlay = document.getElementById('modalOverlay');
    if (overlay) overlay.remove();
    pendingFiles = [];
  };

  // ── UTILITY ──
  function escHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Render bot response: escape HTML, then apply safe markdown subset
  function renderBotMd(str) {
    if (!str) return '';
    // Escape HTML first
    const div = document.createElement('div');
    div.textContent = str;
    let s = div.innerHTML;
    // Bold: **text** or __text__
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__(.+?)__/g, '<strong>$1</strong>');
    // Italic: *text* or _text_ (single, not double)
    s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    // Section headers: lines starting with ### or ## or #
    s = s.replace(/(^|\n)#{1,3} (.+)/g, '$1<strong>$2</strong>');
    // Bullet lists: lines starting with * or - or •
    s = s.replace(/(^|\n)[*\-•] (.+)/g, '$1<li>$2</li>');
    // Numbered lists: lines starting with 1. 2. etc.
    s = s.replace(/(^|\n)\d+\. (.+)/g, '$1<li>$2</li>');
    // Wrap consecutive <li> blocks in <ul>
    s = s.replace(/(<li>[\s\S]*?<\/li>)(?=\s*<li>|$)/g, (match) => match);
    s = s.replace(/((?:<li>.*?<\/li>\n?)+)/g, '<ul style="margin:.4em 0 .4em 1.2em;padding:0;">$1</ul>');
    // Newlines to <br> (skip inside ul)
    s = s.replace(/\n/g, '<br>');
    // Clean up <br> inside <ul>
    s = s.replace(/<ul([^>]*)>(<br>)?/g, '<ul$1>');
    s = s.replace(/(<\/ul>)<br>/g, '$1');
    return s;
  }

  // Escape a string for safe embedding inside a single-quoted JS string literal in an HTML onclick.
  // Prevents XSS via quote-breaking, backslash injection, or </script> breakout.
  function jsEsc(str) {
    if (!str) return '';
    return String(str)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\x22')
      .replace(/</g, '\\x3C')
      .replace(/>/g, '\\x3E')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');
  }

  // ── PWA REGISTRATION ──
  // if ('serviceWorker' in navigator) {
  //   navigator.serviceWorker.register('/sw.js').catch(() => {});
  // }

  // ── CHECK AUTH ON LOAD ──
  async function init() {
    // Handle email verification / password reset tokens in the URL
    const urlParams = new URLSearchParams(window.location.search);
    const verifyToken = urlParams.get('verify');
    const resetToken  = urlParams.get('reset');

    if (verifyToken) {
      // Clean URL immediately
      window.history.replaceState({}, document.title, '/');
      authMode = 'verifying';
      state.user = null;
      render();
      try {
        const data = await api(`/api/auth/verify-email?token=${encodeURIComponent(verifyToken)}`);
        authMode = 'verify-success';
        state.verifyMessage = data.message;
      } catch (err) {
        authMode = 'verify-error';
        state.verifyMessage = err.message || 'Verification failed.';
      }
      render();
      return;
    }

    if (resetToken) {
      window.history.replaceState({}, document.title, '/');
      authMode = 'reset-password';
      state.resetToken = resetToken;
      state.user = null;
      render();
      return;
    }

    // Only hit /api/auth/me if we actually have a stored token — avoids a
    // noisy 401 in the browser console when the user is simply not logged in.
    const storedToken = sessionStorage.getItem('pupsj_token');
    if (storedToken) {
      try {
        const user = await api('/api/auth/me');
        state.user = user;
      } catch (e) {
        // Token is expired or invalid — clear it silently
        sessionStorage.removeItem('pupsj_token');
        state.user = null;
      }
    } else {
      state.user = null;
    }
    render();
  }

  init();

})();
