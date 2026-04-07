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
    chatMessages: [],
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
    teachingSchedules: [],
    locatorShowAll: false,
    profile: null,
  };

  // Polling handle for Professor Locator
  let locatorPollTimer = null;

  const departments = ['All', 'General', 'BSIT', 'BSBA', 'BAC', 'BEED', 'BSED'];
  const lfCategories = ['Personal Items', 'School Supplies', 'Electronics', 'Clothing', 'Documents', 'Others'];
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Pending files for image uploads
  let pendingFiles = [];

  // ── API HELPERS ──
  async function api(url, options = {}) {
    try {
      const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        credentials: 'include',
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
        credentials: 'include',
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

  // ════════════════════════════════
  //  AUTH SCREENS
  // ════════════════════════════════
  let authMode = 'login';

  function renderAuth() {
    return `
    <div class="auth-screen">
      <div class="auth-container">
        <div class="auth-logo">
          <div class="auth-logo-icon"><img src="/icons/pup_logo.png" alt="PUP Logo"></div>
          <h1>PUPSJ HUB</h1>
          <p>PUP San Juan Campus Hub</p>
        </div>
        <div class="auth-card">
          ${authMode === 'login' ? renderLogin() : renderRegister()}
        </div>
      </div>
    </div>`;
  }

  function renderLogin() {
    return `
      <h2>Welcome back</h2>
      <p class="subtitle">Sign in to your PUPSJ HUB account</p>
      <div class="auth-error" id="authError"></div>
      <div class="form-group">
        <label>Email</label>
        <input type="email" class="form-input" id="loginEmail" placeholder="you@pupsj.edu.ph" autocomplete="email">
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" class="form-input" id="loginPassword" placeholder="Enter your password" autocomplete="current-password">
      </div>
      <button class="btn btn-primary" id="loginBtn"><i class="fas fa-sign-in-alt"></i> Sign In</button>
      <p class="auth-switch">Don't have an account? <a id="switchToRegister">Register</a></p>`;
  }

  function renderRegister() {
    return `
      <h2>Create Account</h2>
      <p class="subtitle">Join the PUPSJ HUB community</p>
      <div class="auth-error" id="authError"></div>
      <div class="form-row">
        <div class="form-group">
          <label>First Name</label>
          <input type="text" class="form-input" id="regFirst" placeholder="Juan">
        </div>
        <div class="form-group">
          <label>Last Name</label>
          <input type="text" class="form-input" id="regLast" placeholder="Dela Cruz">
        </div>
      </div>
      <div class="form-group">
        <label>Student / Faculty Number</label>
        <input type="text" class="form-input" id="regStudentNum" placeholder="2024-00001-SJ-0">
      </div>
      <div class="form-group">
        <label>Email</label>
        <input type="email" class="form-input" id="regEmail" placeholder="you@pupsj.edu.ph">
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" class="form-input" id="regPassword" placeholder="Min. 6 characters">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Role</label>
          <select class="form-input form-select" id="regRole">
            <option value="student">Student</option>
            <option value="faculty">Faculty</option>
          </select>
        </div>
        <div class="form-group">
          <label>Department</label>
          <select class="form-input form-select" id="regDept">
            ${departments.filter(d => d !== 'All').map(d => `<option value="${d}">${d}</option>`).join('')}
          </select>
        </div>
      </div>
      <button class="btn btn-primary" id="registerBtn"><i class="fas fa-user-plus"></i> Create Account</button>
      <p class="auth-switch">Already have an account? <a id="switchToLogin">Sign In</a></p>`;
  }

  function bindAuthEvents() {
    const switchToReg = document.getElementById('switchToRegister');
    const switchToLog = document.getElementById('switchToLogin');
    if (switchToReg) switchToReg.onclick = () => { authMode = 'register'; render(); };
    if (switchToLog) switchToLog.onclick = () => { authMode = 'login'; render(); };

    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) loginBtn.onclick = handleLogin;

    const registerBtn = document.getElementById('registerBtn');
    if (registerBtn) registerBtn.onclick = handleRegister;

    // Enter key support
    const loginPw = document.getElementById('loginPassword');
    if (loginPw) loginPw.onkeydown = (e) => { if (e.key === 'Enter') handleLogin(); };
    const regPw = document.getElementById('regPassword');
    if (regPw) regPw.onkeydown = (e) => { if (e.key === 'Enter') handleRegister(); };
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
      state.user = data.user;
      showToast(`Welcome back, ${state.user.first_name}!`, 'success');
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
      last_name: document.getElementById('regLast')?.value.trim(),
      student_number: document.getElementById('regStudentNum')?.value.trim(),
      email: document.getElementById('regEmail')?.value.trim(),
      password: document.getElementById('regPassword')?.value,
      role: document.getElementById('regRole')?.value,
      department: document.getElementById('regDept')?.value,
    };
    const errEl = document.getElementById('authError');
    if (Object.values(fields).some(v => !v)) { errEl.textContent = 'Please fill in all fields'; errEl.classList.add('show'); return; }
    if (fields.password.length < 6) { errEl.textContent = 'Password must be at least 6 characters'; errEl.classList.add('show'); return; }
    try {
      errEl.classList.remove('show');
      await api('/api/auth/register', { method: 'POST', body: JSON.stringify(fields) });
      showToast('Registration successful! Please wait for admin approval.', 'success');
      authMode = 'login';
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
          <div class="nav-item" data-page="schedules"><i class="fas fa-clock"></i> ${isFaculty ? 'Teaching Schedule' : 'Class Schedule'}</div>
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
            <div class="sidebar-avatar">${u.profile_image ? `<img src="${u.profile_image}" alt="avatar">` : getInitials(u.first_name + ' ' + u.last_name)}</div>
            <div class="sidebar-user-info">
              <div class="sidebar-user-name">${u.first_name} ${u.last_name}</div>
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
      state.user = null;
      showToast('Logged out', 'info');
      render();
    };
    if (logoutBtn) logoutBtn.onclick = doLogout;
    if (mobileLogout) mobileLogout.onclick = doLogout;
  }

  function closeSidebar() { document.body.classList.remove('sidebar-open'); }

  function navigateTo(page) {
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

    const pageArea = document.getElementById('pageArea');
    if (!pageArea) return;

    switch (page) {
      case 'announcements': loadAnnouncements(); break;
      case 'events': loadEvents(); break;
      case 'lostfound': loadLostFound(); break;
      case 'schedules': loadSchedules(); break;
      case 'teaching': loadSchedules(); break;
      case 'chatbot': renderChatbot(); break;
      case 'documents': loadDocuments(); break;
      case 'profile': loadProfile(); break;
      case 'admin-dashboard': loadAdminDashboard(); break;
      case 'admin-users': loadAdminUsers(); break;
      default: loadAnnouncements();
    }
  }

  // ════════════════════════════════
  //  ANNOUNCEMENTS (Facebook-style)
  // ════════════════════════════════
  async function loadAnnouncements() {
    const pageArea = document.getElementById('pageArea');
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

    let html = `
      <div class="page-header"><h1 class="page-title">Announcements</h1><p class="page-subtitle">Stay updated with campus news</p></div>
      <div class="page-content">
        ${renderLocatorWidget()}
        <div class="filter-bar">
          ${departments.map(d => `<button class="filter-chip ${state.filters.department === d ? 'active' : ''}" data-dept="${d}">${d}</button>`).join('')}
        </div>
        ${state.announcements.length === 0 ? '<div class="empty-state"><i class="fas fa-newspaper"></i><h3>No announcements yet</h3><p>Check back later for updates</p></div>' :
        state.announcements.map(a => `
          <div class="card announcement-card">
            <div class="announcement-card-header">
              ${a.is_anonymous ? '<div class="announcement-avatar">?</div>' : renderAvatar(a.author_name || 'UN', a.author_image, 'announcement-avatar')}
              <div class="announcement-meta">
                <span class="announcement-author">${a.author_name || 'Unknown'}</span>
                <span class="announcement-dept">${a.department}</span>
                <div class="announcement-time">${timeAgo(a.created_at)}${a.author_role ? ' · ' + a.author_role : ''}</div>
              </div>
            </div>
            <div class="announcement-body">
              ${a.is_pinned ? '<div class="announcement-pin"><i class="fas fa-thumbtack"></i> Pinned</div>' : ''}
              <h3 class="announcement-title">${escHtml(a.title)}</h3>
              <p class="announcement-text">${escHtml(a.content)}</p>
            </div>
            ${a.images && a.images.length > 0 && a.images[0].id ? `
            <div class="announcement-images ${a.images.length === 1 ? 'single' : a.images.length === 2 ? 'double' : 'multi'}">
              ${a.images.map(img => `<img src="${img.image_url}" alt="attachment" onclick="window._openImageViewer('${img.image_url}')">`).join('')}
            </div>` : ''}
            ${(isFacultyOrAdmin || (a.author_id === state.user.id)) ? `
            <div class="announcement-actions">
              <button class="announcement-action-btn" onclick="window._deleteAnnouncement('${a.id}')"><i class="fas fa-trash-alt"></i> Delete</button>
            </div>` : ''}
          </div>`).join('')}
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
  async function loadEvents() {
    const pageArea = document.getElementById('pageArea');
    pageArea.innerHTML = `<div class="page-header"><h1 class="page-title">Event Calendar</h1><p class="page-subtitle">Upcoming campus activities</p></div><div class="page-content"><div class="loader"><div class="spinner"></div></div></div>`;

    try {
      const data = await api(`/api/events?month=${state.calendarMonth + 1}&year=${state.calendarYear}`);
      state.events = data;
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

    let calendarCells = '';
    const dayHeaders = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    calendarCells += dayHeaders.map(d => `<div class="calendar-day-header">${d}</div>`).join('');

    // Previous month padding
    const prevLast = new Date(state.calendarYear, state.calendarMonth, 0).getDate();
    for (let i = startDay - 1; i > 0; i--) {
      calendarCells += `<div class="calendar-day other-month">${prevLast - i + 1}</div>`;
    }
    // Current month
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const isToday = d === today.getDate() && state.calendarMonth === today.getMonth() && state.calendarYear === today.getFullYear();
      const hasEvent = eventDates.has(d);
      calendarCells += `<div class="calendar-day${isToday ? ' today' : ''}${hasEvent ? ' has-event' : ''}">${d}</div>`;
    }
    // Next month padding
    const totalCells = startDay - 1 + lastDay.getDate();
    const remaining = 7 - (totalCells % 7);
    if (remaining < 7) {
      for (let i = 1; i <= remaining; i++) {
        calendarCells += `<div class="calendar-day other-month">${i}</div>`;
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
        <h3 style="font-family:var(--font-display);font-size:16px;font-weight:700;margin-bottom:12px;">
          Events this month <span style="color:var(--text-light);font-weight:400;">(${state.events.length})</span>
        </h3>
        <div class="event-list">
          ${state.events.length === 0 ? '<div class="empty-state"><i class="fas fa-calendar-times"></i><h3>No events this month</h3></div>' :
          state.events.map(e => {
            const d = new Date(e.event_date);
            const hasImages = e.images && e.images.length > 0 && e.images[0].id;
            return `
            <div class="card event-item-card" data-event-id="${e.id}" onclick="window._openEventDetail('${e.id}')">
              <div class="event-item-inner">
                <div class="event-date-badge">
                  <div class="month">${months[d.getMonth()].slice(0, 3)}</div>
                  <div class="day">${d.getDate()}</div>
                </div>
                <div class="event-info">
                  <h4>${escHtml(e.title)}</h4>
                  <p>${escHtml(e.description || '')}</p>
                  <div class="event-meta-row">
                    ${e.start_time ? `<span><i class="fas fa-clock"></i> ${formatTime(e.start_time)}${e.end_time ? ' - ' + formatTime(e.end_time) : ''}</span>` : ''}
                    ${e.location ? `<span><i class="fas fa-map-marker-alt"></i> ${escHtml(e.location)}</span>` : ''}
                    <span class="event-feedback-hint"><i class="fas fa-comment-dots"></i> View & Give Feedback</span>
                  </div>
                </div>
              </div>
              ${hasImages ? `
              <div class="event-item-images">
                ${e.images.slice(0, 3).map(img => `<img src="${img.image_url}" alt="event">`).join('')}
                ${e.images.length > 3 ? `<div class="event-images-more">+${e.images.length - 3}</div>` : ''}
              </div>` : ''}
            </div>`;
          }).join('')}
        </div>
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

  function renderStars(rating) {
    const r = Math.round(parseFloat(rating));
    return [1,2,3,4,5].map(i => `<i class="fas fa-star${i <= r ? ' active' : ''}"></i>`).join('');
  }

  // ════════════════════════════════
  //  LOST & FOUND
  // ════════════════════════════════
  async function loadLostFound() {
    const pageArea = document.getElementById('pageArea');
    pageArea.innerHTML = `<div class="page-header"><h1 class="page-title">Lost & Found</h1><p class="page-subtitle">Report or find missing items</p></div><div class="page-content"><div class="loader"><div class="spinner"></div></div></div>`;

    try {
      const typeParam = state.filters.lfType !== 'all' ? `?type=${state.filters.lfType}` : '';
      const data = await api(`/api/lost-found${typeParam}`);
      state.lostFound = data;
      renderLostFoundPage();
    } catch (err) {
      pageArea.querySelector('.page-content').innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Failed to load</h3></div>`;
    }
  }

  function renderLostFoundPage() {
    const pageArea = document.getElementById('pageArea');

    let html = `
      <div class="page-header"><h1 class="page-title">Lost & Found</h1><p class="page-subtitle">Help reunite items with their owners</p></div>
      <div class="page-content">
        <div class="lf-tabs">
          <button class="lf-tab ${state.filters.lfType === 'all' ? 'active' : ''}" data-type="all">All</button>
          <button class="lf-tab ${state.filters.lfType === 'lost' ? 'active' : ''}" data-type="lost">Lost</button>
          <button class="lf-tab ${state.filters.lfType === 'found' ? 'active' : ''}" data-type="found">Found</button>
        </div>
        ${state.lostFound.length === 0 ? '<div class="empty-state"><i class="fas fa-box-open"></i><h3>No items reported</h3><p>Report a lost or found item using the + button</p></div>' :
        state.lostFound.map(item => `
          <div class="card lf-card">
            <div class="lf-card-header">
              <span class="lf-type-badge ${item.type}">${item.type}</span>
              <div style="flex:1">
                <h4>${escHtml(item.item_name)}</h4>
                <p>${escHtml(item.description)}</p>
                <div class="lf-card-meta">
                  ${item.category ? `<span><i class="fas fa-tag"></i> ${item.category}</span>` : ''}
                  ${item.location_found ? `<span><i class="fas fa-map-marker-alt"></i> ${escHtml(item.location_found)}</span>` : ''}
                  <span><i class="fas fa-clock"></i> ${timeAgo(item.created_at)}</span>
                </div>
                ${item.contact_info ? `<div style="margin-top:6px;font-size:12px;color:var(--text-secondary);"><i class="fas fa-phone"></i> ${escHtml(item.contact_info)}</div>` : ''}
              </div>
            </div>
            ${item.images && item.images.length > 0 && item.images[0].id ? `
            <div class="lf-card-images">
              ${item.images.map(img => `<img src="${img.image_url}" alt="item" onclick="window._openImageViewer('${img.image_url}')">`).join('')}
            </div>` : ''}
            ${item.matched_with ? `<div class="lf-match-hint"><i class="fas fa-magic"></i> Potential match found! Check matched items.</div>` : ''}
          </div>`).join('')}
      </div>
      <button class="fab" id="fabLF" title="Report Item"><i class="fas fa-plus"></i></button>`;

    pageArea.innerHTML = html;

    document.querySelectorAll('.lf-tab').forEach(el => {
      el.onclick = () => { state.filters.lfType = el.dataset.type; loadLostFound(); };
    });
    document.getElementById('fabLF').onclick = () => openModal('lostfound');
  }

  // ════════════════════════════════
  //  SCHEDULE (unified — class for students, teaching for faculty/admin)
  // ════════════════════════════════
  function isFacultySched() {
    return state.user.role === 'faculty' || state.user.role === 'admin';
  }

  async function loadSchedules() {
    const pageArea = document.getElementById('pageArea');
    const title = isFacultySched() ? 'Teaching Schedule' : 'Class Schedule';
    pageArea.innerHTML = `<div class="page-header"><h1 class="page-title">${title}</h1><p class="page-subtitle">Loading...</p></div><div class="page-content"><div class="loader"><div class="spinner"></div></div></div>`;

    try {
      if (isFacultySched()) {
        const data = await api('/api/faculty-schedules');
        state.teachingSchedules = data;
      } else {
        const [data, facultyList] = await Promise.all([
          api('/api/schedules'),
          state.facultyList.length === 0 ? api('/api/faculty/list').catch(() => []) : Promise.resolve(state.facultyList),
        ]);
        state.schedules = data;
        state.facultyList = facultyList;
      }
      renderSchedulesPage();
    } catch (err) {
      pageArea.querySelector('.page-content').innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Failed to load</h3><p>${escHtml(err.message)}</p></div>`;
    }
  }

  function renderSchedulesPage() {
    const pageArea = document.getElementById('pageArea');
    const facultyMode = isFacultySched();
    const items = facultyMode ? state.teachingSchedules : state.schedules;
    const pageTitle = facultyMode ? 'Teaching Schedule' : 'Class Schedule';
    const pageSub = facultyMode
      ? 'Your classes are shown live in the campus Professor Locator'
      : 'Your weekly timetable — link a faculty to track them in the locator';
    const templateUrl = facultyMode ? '/api/faculty-schedules/template' : '/api/schedules/template';
    const addType = facultyMode ? 'teaching' : 'schedule';
    const uploadType = facultyMode ? 'teachingUpload' : 'classUpload';

    const grouped = {};
    days.forEach(d => { grouped[d] = items.filter(s => s.day_of_week === d); });

    let html = `
      <div class="page-header"><h1 class="page-title">${pageTitle}</h1><p class="page-subtitle">${pageSub}</p></div>
      <div class="page-content">
        <div class="teaching-actions">
          <button class="btn btn-primary btn-sm" id="btnUploadSched"><i class="fas fa-file-upload"></i> Upload CSV</button>
          <a class="btn btn-secondary btn-sm" href="${templateUrl}" download><i class="fas fa-download"></i> Download Template</a>
          <button class="btn btn-secondary btn-sm" id="btnAddSingle"><i class="fas fa-plus"></i> Add One Class</button>
        </div>
        <div class="schedule-grid">
          ${days.map(day => {
            const classes = grouped[day];
            if (classes.length === 0) return '';
            return `
              <div class="schedule-day-group">
                <div class="schedule-day-label">${day}</div>
                ${classes.map(c => `
                  <div class="card schedule-item">
                    <div class="schedule-time">${formatTime(c.start_time)} - ${formatTime(c.end_time)}</div>
                    <div class="schedule-details">
                      <h4>${escHtml(c.subject_code)} - ${escHtml(c.subject_name)}</h4>
                      <p>${facultyMode ? (c.section ? escHtml(c.section) : 'No section') : (c.instructor ? escHtml(c.instructor) : 'No instructor assigned')}</p>
                    </div>
                    ${c.room ? `<span class="schedule-room">${escHtml(c.room)}</span>` : ''}
                    <button class="btn-icon" onclick="window._deleteSchedItem('${c.id}', ${facultyMode})" title="Remove"><i class="fas fa-times"></i></button>
                  </div>`).join('')}
              </div>`;
          }).join('')}
          ${items.length === 0 ? `<div class="empty-state"><i class="fas fa-calendar-plus"></i><h3>No classes yet</h3><p>Upload a CSV of your weekly schedule, or add classes one by one.</p></div>` : ''}
        </div>
      </div>`;

    pageArea.innerHTML = html;
    document.getElementById('btnUploadSched').onclick = () => openModal(uploadType);
    document.getElementById('btnAddSingle').onclick = () => openModal(addType);
  }

  window._deleteSchedItem = async (id, facultyMode) => {
    if (!confirm('Remove this class?')) return;
    try {
      const url = facultyMode ? `/api/faculty-schedules/${id}` : `/api/schedules/${id}`;
      await api(url, { method: 'DELETE' });
      showToast('Class removed', 'success');
      loadSchedules();
    } catch (err) { showToast(err.message, 'error'); }
  };

  // Legacy alias
  window._deleteSchedule = (id) => window._deleteSchedItem(id, false);

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
    const avatar = p.profile_image
      ? `<img src="${p.profile_image}" alt="avatar">`
      : `<span>${getInitials((p.first_name || '') + ' ' + (p.last_name || ''))}</span>`;

    pageArea.innerHTML = `
      <div class="page-header"><h1 class="page-title">My Profile</h1><p class="page-subtitle">Manage your personal information</p></div>
      <div class="page-content">
        <div class="profile-card">
          <div class="profile-avatar-wrap">
            <div class="profile-avatar" id="profileAvatar">${avatar}</div>
            <button class="profile-avatar-btn" id="profileAvatarBtn" title="Change photo"><i class="fas fa-camera"></i></button>
            <input type="file" id="profileAvatarInput" accept="image/*" style="display:none">
          </div>
          <div class="profile-head-info">
            <h2>${escHtml((p.first_name || '') + ' ' + (p.last_name || ''))}</h2>
            <p class="profile-role">${escHtml(p.role || '')}${p.department ? ' · ' + escHtml(p.department) : ''}</p>
            <p class="profile-email"><i class="fas fa-envelope"></i> ${escHtml(p.email || '')}</p>
          </div>
        </div>

        <div class="profile-form card">
          <h3>Personal Information</h3>
          <div class="form-row">
            <div class="form-group">
              <label>First Name</label>
              <input type="text" class="form-input" id="pfFirst" value="${escHtml(p.first_name || '')}">
            </div>
            <div class="form-group">
              <label>Last Name</label>
              <input type="text" class="form-input" id="pfLast" value="${escHtml(p.last_name || '')}">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Department</label>
              <select class="form-input form-select" id="pfDept">
                ${departments.filter(d => d !== 'All').map(d => `<option value="${d}" ${p.department === d ? 'selected' : ''}>${d}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Phone</label>
              <input type="text" class="form-input" id="pfPhone" placeholder="e.g., 09xx-xxx-xxxx" value="${escHtml(p.phone || '')}">
            </div>
          </div>
          ${(p.role === 'faculty' || p.role === 'admin') ? `
          <div class="form-group">
            <label>Position / Title</label>
            <input type="text" class="form-input" id="pfPosition" placeholder="e.g., Associate Professor" value="${escHtml(p.position || '')}">
          </div>` : ''}
          <div class="form-group">
            <label>Bio</label>
            <textarea class="form-input" id="pfBio" rows="4" placeholder="Tell others a bit about yourself...">${escHtml(p.bio || '')}</textarea>
          </div>
          <div class="form-group" style="display:flex;gap:10px;justify-content:flex-end;">
            <button class="btn btn-primary" id="pfSaveBtn"><i class="fas fa-save"></i> Save Changes</button>
          </div>
        </div>

        <div class="profile-form card">
          <h3>Appearance</h3>
          <p style="font-size:13px;color:var(--text-secondary);margin-bottom:14px;">Choose how PUPSJ HUB looks on your device.</p>
          <div class="theme-switcher" id="themeSwitcher">
            <button class="theme-option ${getStoredTheme() === 'light' ? 'active' : ''}" data-theme="light">
              <i class="fas fa-sun"></i><span>Light</span>
            </button>
            <button class="theme-option ${getStoredTheme() === 'dark' ? 'active' : ''}" data-theme="dark">
              <i class="fas fa-moon"></i><span>Dark</span>
            </button>
            <button class="theme-option ${getStoredTheme() === 'system' ? 'active' : ''}" data-theme="system">
              <i class="fas fa-desktop"></i><span>System</span>
            </button>
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
        const res = await fetch('/api/auth/me/avatar', { method: 'POST', credentials: 'include', body: fd });
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
      const last_name = document.getElementById('pfLast').value.trim();
      if (!first_name || !last_name) {
        showToast('First name and last name are required', 'error'); return;
      }
      const body = {
        first_name,
        last_name,
        department: document.getElementById('pfDept').value,
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
          state.user.last_name = updated.last_name;
          state.user.department = updated.department;
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
    const pageArea = document.getElementById('pageArea');

    pageArea.innerHTML = `
      <div class="page-header"><h1 class="page-title">PUPBot</h1><p class="page-subtitle">Your campus assistant</p></div>
      <div class="page-content">
        <div class="chatbot-container">
          <div class="chat-messages" id="chatMessages">
            <div class="chat-bubble bot">
              <div class="bot-label"><i class="fas fa-robot"></i> PUPBot</div>
              Hello! I'm PUPBot, your PUPSJ HUB assistant. I can help with questions about enrollment, schedules, events, lost & found, feedback, and campus policies. What would you like to know?
            </div>
            ${state.chatMessages.map(m => `
              <div class="chat-bubble user">${escHtml(m.user)}</div>
              <div class="chat-bubble bot">
                <div class="bot-label"><i class="fas fa-robot"></i> PUPBot</div>
                ${escHtml(m.bot).replace(/\n/g, '<br>')}
                ${m.images && m.images.length > 0 ? `<div class="chat-bot-images">${m.images.map(url => `<img src="${url}" alt="related" onclick="window._openImageViewer('${url}')">`).join('')}</div>` : ''}
              </div>
            `).join('')}
          </div>
          <div class="chat-typing" id="chatTyping"><i class="fas fa-circle-notch fa-spin"></i> PUPBot is typing...</div>
          <div class="chat-input-bar">
            <input type="text" id="chatInput" placeholder="Ask me anything about PUPSJ..." autocomplete="off">
            <button class="chat-send-btn" id="chatSend"><i class="fas fa-paper-plane"></i></button>
          </div>
        </div>
      </div>`;

    const chatInput = document.getElementById('chatInput');
    const chatSend = document.getElementById('chatSend');
    const chatMessages = document.getElementById('chatMessages');

    const send = () => sendChatMessage(chatInput, chatMessages);
    chatSend.onclick = send;
    chatInput.onkeydown = (e) => { if (e.key === 'Enter') send(); };

    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  async function sendChatMessage(inputEl, messagesEl) {
    const message = inputEl.value.trim();
    if (!message) return;
    inputEl.value = '';

    // Add user bubble
    const userBubble = document.createElement('div');
    userBubble.className = 'chat-bubble user';
    userBubble.textContent = message;
    messagesEl.appendChild(userBubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // Show typing
    document.getElementById('chatTyping').classList.add('show');

    try {
      const data = await api('/api/chatbot/message', { method: 'POST', body: JSON.stringify({ message }) });

      document.getElementById('chatTyping').classList.remove('show');

      const botBubble = document.createElement('div');
      botBubble.className = 'chat-bubble bot';
      let botHtml = `<div class="bot-label"><i class="fas fa-robot"></i> PUPBot</div>${escHtml(data.response).replace(/\n/g, '<br>')}`;

      // Show images if returned
      if (data.images && data.images.length > 0) {
        botHtml += `<div class="chat-bot-images">${data.images.map(url => `<img src="${url}" alt="related" onclick="window._openImageViewer('${url}')">`).join('')}</div>`;
      }

      botBubble.innerHTML = botHtml;
      messagesEl.appendChild(botBubble);

      state.chatMessages.push({ user: message, bot: data.response, images: data.images || [] });
    } catch (err) {
      document.getElementById('chatTyping').classList.remove('show');
      const errBubble = document.createElement('div');
      errBubble.className = 'chat-bubble bot';
      errBubble.innerHTML = `<div class="bot-label"><i class="fas fa-robot"></i> PUPBot</div>Sorry, I'm having trouble responding right now. Please try again.`;
      messagesEl.appendChild(errBubble);
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

  function renderLocatorWidget() {
    const u = state.user;
    // For students: default to "my profs" (those linked via faculty_user_id in their class_schedules)
    const linkedFacultyIds = new Set(
      (state.schedules || []).map(s => s.faculty_user_id).filter(Boolean)
    );
    const isStudent = u.role === 'student';
    const showAll = state.locatorShowAll || !isStudent || linkedFacultyIds.size === 0;

    let list = state.facultyLocations;
    if (!showAll && isStudent) {
      list = list.filter(f => linkedFacultyIds.has(f.faculty_id));
    }

    const inClassCount = list.filter(f => f.status === 'in_class').length;
    const availableCount = list.length - inClassCount;

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
            ${isStudent && linkedFacultyIds.size > 0 ? `
              <div class="locator-toggle">
                <button class="locator-toggle-btn ${!state.locatorShowAll ? 'active' : ''}" data-locator-mode="mine">My Profs</button>
                <button class="locator-toggle-btn ${state.locatorShowAll ? 'active' : ''}" data-locator-mode="all">All</button>
              </div>
            ` : ''}
          </div>
        </div>
        <div class="locator-stats">
          <span class="locator-stat"><span class="dot in-class"></span> ${inClassCount} In Class</span>
          <span class="locator-stat"><span class="dot available"></span> ${availableCount} Available</span>
        </div>
        <div class="locator-cards-scroll">
          ${list.length === 0 ? `
            <div class="locator-empty">
              <i class="fas fa-user-slash"></i>
              <span>${isStudent && !showAll ? 'Link faculty to your classes to see their status.' : 'No faculty data yet.'}</span>
            </div>
          ` : list.map(f => `
            <div class="locator-card ${f.status}">
              <div class="locator-card-status-bar"></div>
              <div class="locator-card-body">
                <div class="locator-card-name">${escHtml(f.first_name + ' ' + f.last_name)}</div>
                ${f.department ? `<div class="locator-card-dept">${escHtml(f.department)}</div>` : ''}
                <div class="locator-card-status">
                  ${f.status === 'in_class' ? `
                    <i class="fas fa-chalkboard-teacher"></i>
                    <span>In Class</span>
                  ` : `
                    <i class="fas fa-check-circle"></i>
                    <span>Available</span>
                  `}
                </div>
                ${f.status === 'in_class' && f.room ? `<div class="locator-card-room"><i class="fas fa-door-open"></i> ${escHtml(f.room)}</div>` : ''}
                ${f.status === 'in_class' && f.subject_code ? `<div class="locator-card-subject">${escHtml(f.subject_code)}${f.subject_name ? ' · ' + escHtml(f.subject_name) : ''}</div>` : ''}
              </div>
            </div>
          `).join('')}
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
    document.querySelectorAll('.locator-toggle-btn[data-locator-mode]').forEach(btn => {
      btn.onclick = () => {
        state.locatorShowAll = btn.dataset.locatorMode === 'all';
        updateLocatorWidget();
      };
    });
  }

  // ════════════════════════════════
  //  FACULTY TEACHING SCHEDULE (faculty/admin)
  // ════════════════════════════════
  async function loadTeachingSchedules() { return loadSchedules(); }

  function _unused_renderTeachingSchedulesPage() {
    const pageArea = document.getElementById('pageArea');
    const grouped = {};
    days.forEach(d => { grouped[d] = state.teachingSchedules.filter(s => s.day_of_week === d); });

    let html = `
      <div class="page-header">
        <h1 class="page-title">Teaching Schedule</h1>
        <p class="page-subtitle">Your classes are shown live in the campus Professor Locator</p>
      </div>
      <div class="page-content">
        <div class="teaching-actions">
          <button class="btn btn-primary btn-sm" id="btnUploadSched"><i class="fas fa-file-upload"></i> Upload CSV</button>
          <a class="btn btn-secondary btn-sm" id="btnDlTemplate" href="/api/faculty-schedules/template" download><i class="fas fa-download"></i> Download Template</a>
          <button class="btn btn-secondary btn-sm" id="btnAddSingle"><i class="fas fa-plus"></i> Add One Class</button>
        </div>
        <div class="schedule-grid">
          ${days.map(day => {
            const classes = grouped[day];
            if (classes.length === 0) return '';
            return `
              <div class="schedule-day-group">
                <div class="schedule-day-label">${day}</div>
                ${classes.map(c => `
                  <div class="card schedule-item">
                    <div class="schedule-time">${formatTime(c.start_time)} - ${formatTime(c.end_time)}</div>
                    <div class="schedule-details">
                      <h4>${escHtml(c.subject_code)} - ${escHtml(c.subject_name)}</h4>
                      <p>${c.section ? escHtml(c.section) : 'No section'}</p>
                    </div>
                    ${c.room ? `<span class="schedule-room">${escHtml(c.room)}</span>` : ''}
                    <button class="btn-icon" onclick="window._deleteTeaching('${c.id}')" title="Remove"><i class="fas fa-times"></i></button>
                  </div>`).join('')}
              </div>`;
          }).join('')}
          ${state.teachingSchedules.length === 0 ? '<div class="empty-state"><i class="fas fa-chalkboard"></i><h3>No teaching classes yet</h3><p>Upload a CSV of your weekly schedule, or add classes one by one.</p></div>' : ''}
        </div>
      </div>`;

    pageArea.innerHTML = html;
    document.getElementById('btnUploadSched').onclick = () => openModal('teachingUpload');
    document.getElementById('btnAddSingle').onclick = () => openModal('teaching');
  }

  window._deleteTeaching = async (id) => {
    if (!confirm('Remove this teaching class?')) return;
    try {
      await api(`/api/faculty-schedules/${id}`, { method: 'DELETE' });
      showToast('Class removed', 'success');
      loadTeachingSchedules();
    } catch (err) { showToast(err.message, 'error'); }
  };

  // ════════════════════════════════
  //  DOCUMENT TEMPLATES
  // ════════════════════════════════
  async function loadDocuments() {
    const pageArea = document.getElementById('pageArea');
    pageArea.innerHTML = `<div class="page-header"><h1 class="page-title">Document Templates</h1><p class="page-subtitle">Accreditation documents, templates & forms</p></div><div class="page-content"><div class="loader"><div class="spinner"></div></div></div>`;

    try {
      const [categories, documents] = await Promise.all([
        api('/api/documents/categories'),
        api('/api/documents' + (state.docSelectedCategory ? `?category_id=${state.docSelectedCategory}` : '') + (state.docSearch ? `${state.docSelectedCategory ? '&' : '?'}search=${encodeURIComponent(state.docSearch)}` : '')),
      ]);
      state.docCategories = categories;
      state.docTemplates = documents;
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

    // Group documents by category
    const docsByCategory = {};
    state.docTemplates.forEach(d => {
      const catId = d.category_id || 'uncategorized';
      if (!docsByCategory[catId]) docsByCategory[catId] = [];
      docsByCategory[catId].push(d);
    });

    let html = `
      <div class="page-header"><h1 class="page-title">Document Templates</h1><p class="page-subtitle">Accreditation documents, templates & forms</p></div>
      <div class="page-content">
        <!-- Search Bar -->
        <div class="doc-search-bar">
          <div class="doc-search-input-wrap">
            <i class="fas fa-search"></i>
            <input type="text" class="doc-search-input" id="docSearchInput" placeholder="Search documents..." value="${escHtml(state.docSearch)}">
            ${state.docSearch ? '<button class="doc-search-clear" id="docSearchClear"><i class="fas fa-times"></i></button>' : ''}
          </div>
        </div>

        <!-- Category Filter Chips -->
        <div class="filter-bar doc-category-filter">
          <button class="filter-chip ${!state.docSelectedCategory ? 'active' : ''}" data-cat-id="">All Categories</button>
          ${state.docCategories.map(c => `
            <button class="filter-chip ${state.docSelectedCategory === c.id ? 'active' : ''}" data-cat-id="${c.id}">
              ${escHtml(c.name)} <span class="doc-cat-count">${c.file_count}</span>
            </button>`).join('')}
          ${isFacultyOrAdmin ? `<button class="filter-chip doc-add-cat-chip" id="addCategoryBtn"><i class="fas fa-plus"></i> Add Category</button>` : ''}
        </div>

        ${state.docCategories.length === 0 && state.docTemplates.length === 0 ? `
          <div class="empty-state">
            <i class="fas fa-folder-plus"></i>
            <h3>No documents yet</h3>
            <p>${isFacultyOrAdmin ? 'Start by creating a category, then upload documents.' : 'Check back later for document templates.'}</p>
          </div>` : ''}

        ${state.docSelectedCategory && selectedCat ? `
          <div class="doc-category-header">
            <div class="doc-category-header-info">
              <h2>${escHtml(selectedCat.name)}</h2>
              ${selectedCat.description ? `<p>${escHtml(selectedCat.description)}</p>` : ''}
            </div>
            ${isFacultyOrAdmin ? `
              <div class="doc-category-header-actions">
                <button class="btn btn-secondary btn-sm" onclick="window._editCategory('${selectedCat.id}', '${escHtml(selectedCat.name).replace(/'/g, "\\'")}', '${escHtml(selectedCat.description || '').replace(/'/g, "\\'")}')"><i class="fas fa-edit"></i> Edit</button>
                <button class="btn btn-danger btn-sm" onclick="window._deleteCategory('${selectedCat.id}')"><i class="fas fa-trash"></i> Delete</button>
              </div>` : ''}
          </div>` : ''}

        ${!state.docSelectedCategory && state.docCategories.length > 0 && !state.docSearch ? `
          <!-- Category Cards Grid -->
          <div class="doc-categories-grid">
            ${state.docCategories.map(c => `
              <div class="card doc-category-card" data-cat-nav="${c.id}">
                <div class="doc-category-card-icon"><i class="fas fa-folder"></i></div>
                <div class="doc-category-card-body">
                  <h3>${escHtml(c.name)}</h3>
                  ${c.description ? `<p>${escHtml(c.description)}</p>` : '<p>No description</p>'}
                  <span class="doc-category-card-count">${c.file_count} file${c.file_count !== 1 ? 's' : ''}</span>
                </div>
                ${isFacultyOrAdmin ? `
                <div class="doc-category-card-actions">
                  <button class="btn-icon" onclick="event.stopPropagation(); window._editCategory('${c.id}', '${escHtml(c.name).replace(/'/g, "\\'")}', '${escHtml(c.description || '').replace(/'/g, "\\'")}')"><i class="fas fa-edit"></i></button>
                  <button class="btn-icon" onclick="event.stopPropagation(); window._deleteCategory('${c.id}')"><i class="fas fa-trash-alt"></i></button>
                </div>` : ''}
              </div>`).join('')}
          </div>` : ''}

        ${(state.docSelectedCategory || state.docSearch) && state.docTemplates.length > 0 ? `
          <!-- Documents List -->
          <div class="doc-files-list">
            ${state.docTemplates.map(d => `
              <div class="card doc-file-card">
                <div class="doc-file-icon" style="color:${getFileIconColor(d.file_type)}">
                  <i class="fas ${getFileIcon(d.file_type)}"></i>
                </div>
                <div class="doc-file-info">
                  <h4>${escHtml(d.title)}</h4>
                  ${d.description ? `<p class="doc-file-desc">${escHtml(d.description)}</p>` : ''}
                  <div class="doc-file-meta">
                    <span><i class="fas fa-file"></i> ${escHtml(d.file_name)}</span>
                    ${d.file_size ? `<span><i class="fas fa-weight-hanging"></i> ${formatFileSize(d.file_size)}</span>` : ''}
                    <span><i class="fas fa-clock"></i> ${timeAgo(d.created_at)}</span>
                    ${d.uploaded_by_name ? `<span><i class="fas fa-user"></i> ${escHtml(d.uploaded_by_name)}</span>` : ''}
                    ${d.category_name && state.docSearch ? `<span><i class="fas fa-folder"></i> ${escHtml(d.category_name)}</span>` : ''}
                    <span><i class="fas fa-download"></i> ${d.download_count || 0} downloads</span>
                  </div>
                </div>
                <div class="doc-file-actions">
                  <a href="${d.file_url}" download="${escHtml(d.file_name)}" class="btn btn-primary btn-sm doc-download-btn" onclick="window._trackDownload('${d.id}')" title="Download"><i class="fas fa-download"></i></a>
                  ${isFacultyOrAdmin ? `
                    <button class="btn btn-secondary btn-sm" onclick="window._editDocument('${d.id}', '${escHtml(d.title).replace(/'/g, "\\'")}', '${escHtml(d.description || '').replace(/'/g, "\\'")}', '${d.category_id}')" title="Edit"><i class="fas fa-edit"></i></button>
                    <button class="btn btn-danger btn-sm" onclick="window._deleteDocument('${d.id}')" title="Delete"><i class="fas fa-trash-alt"></i></button>
                  ` : ''}
                </div>
              </div>`).join('')}
          </div>` : ''}

        ${(state.docSelectedCategory || state.docSearch) && state.docTemplates.length === 0 ? `
          <div class="empty-state">
            <i class="fas fa-file-search"></i>
            <h3>${state.docSearch ? 'No documents found' : 'No documents in this category'}</h3>
            <p>${state.docSearch ? 'Try a different search term.' : (isFacultyOrAdmin ? 'Upload documents using the + button.' : 'Check back later.')}</p>
          </div>` : ''}
      </div>`;

    if (isFacultyOrAdmin) {
      html += `<button class="fab" id="fabDoc" title="Upload Document"><i class="fas fa-upload"></i></button>`;
    }

    pageArea.innerHTML = html;

    // Bind category filter chips
    document.querySelectorAll('.filter-chip[data-cat-id]').forEach(el => {
      el.onclick = () => {
        state.docSelectedCategory = el.dataset.catId || null;
        loadDocuments();
      };
    });

    // Bind category card navigation
    document.querySelectorAll('.doc-category-card[data-cat-nav]').forEach(el => {
      el.onclick = () => {
        state.docSelectedCategory = el.dataset.catNav;
        loadDocuments();
      };
    });

    // Bind search
    const searchInput = document.getElementById('docSearchInput');
    if (searchInput) {
      let searchTimeout;
      searchInput.oninput = () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          state.docSearch = searchInput.value.trim();
          loadDocuments();
        }, 400);
      };
      searchInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
          clearTimeout(searchTimeout);
          state.docSearch = searchInput.value.trim();
          loadDocuments();
        }
      };
    }

    const clearBtn = document.getElementById('docSearchClear');
    if (clearBtn) {
      clearBtn.onclick = () => { state.docSearch = ''; loadDocuments(); };
    }

    // Bind add category
    const addCatBtn = document.getElementById('addCategoryBtn');
    if (addCatBtn) addCatBtn.onclick = () => openModal('doc-category');

    // Bind FAB
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

  window._editDocument = (id, title, description, categoryId) => {
    openModal('doc-edit', { id, title, description, categoryId });
  };

  // ════════════════════════════════
  //  ADMIN DASHBOARD
  // ════════════════════════════════
  async function loadAdminDashboard() {
    const pageArea = document.getElementById('pageArea');
    pageArea.innerHTML = `<div class="page-header"><h1 class="page-title">Admin Dashboard</h1><p class="page-subtitle">System overview</p></div><div class="page-content"><div class="loader"><div class="spinner"></div></div></div>`;

    try {
      const stats = await api('/api/admin/stats');
      state.adminStats = stats;

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
              <div class="stat-card-value">${stats.announcements}</div>
              <div class="stat-card-label">Announcements</div>
            </div>
            <div class="card stat-card">
              <div class="stat-card-icon blue"><i class="fas fa-calendar-alt"></i></div>
              <div class="stat-card-value">${stats.events}</div>
              <div class="stat-card-label">Active Events</div>
            </div>
            <div class="card stat-card">
              <div class="stat-card-icon green"><i class="fas fa-search-location"></i></div>
              <div class="stat-card-value">${stats.lostFound.open}</div>
              <div class="stat-card-label">Open L&F Reports</div>
            </div>
          </div>
          <div class="card" style="padding:20px;">
            <h3 style="font-family:var(--font-display);font-size:16px;font-weight:700;margin-bottom:12px;">Quick Actions</h3>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              <button class="btn btn-primary btn-sm" onclick="navigateTo('admin-users')"><i class="fas fa-users-cog"></i> Manage Users</button>
              <button class="btn btn-gold btn-sm" onclick="openModal('announcement')"><i class="fas fa-bullhorn"></i> Post Announcement</button>
              <button class="btn btn-secondary btn-sm" onclick="openModal('event')"><i class="fas fa-calendar-plus"></i> Create Event</button>
            </div>
          </div>
        </div>`;
    } catch (err) {
      pageArea.querySelector('.page-content').innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Failed to load dashboard</h3></div>`;
    }
  }

  // ════════════════════════════════
  //  ADMIN - MANAGE USERS
  // ════════════════════════════════
  async function loadAdminUsers() {
    const pageArea = document.getElementById('pageArea');
    pageArea.innerHTML = `<div class="page-header"><h1 class="page-title">Manage Users</h1><p class="page-subtitle">Approve, verify, and manage accounts</p></div><div class="page-content"><div class="loader"><div class="spinner"></div></div></div>`;

    try {
      const users = await api('/api/admin/users');
      state.adminUsers = users;
      renderAdminUsersPage();
    } catch (err) {
      pageArea.querySelector('.page-content').innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Failed to load users</h3></div>`;
    }
  }

  function renderAdminUsersPage() {
    const pageArea = document.getElementById('pageArea');

    pageArea.innerHTML = `
      <div class="page-header"><h1 class="page-title">Manage Users</h1><p class="page-subtitle">Approve and manage campus accounts</p></div>
      <div class="page-content">
        <div class="card" style="padding:0;overflow:hidden;">
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>ID Number</th>
                  <th>Role</th>
                  <th>Dept</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${state.adminUsers.length === 0 ? '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-light);">No users found</td></tr>' :
                state.adminUsers.map(u => `
                  <tr>
                    <td><strong>${escHtml(u.first_name)} ${escHtml(u.last_name)}</strong><br><span style="font-size:11px;color:var(--text-light);">${escHtml(u.email)}</span></td>
                    <td>${escHtml(u.student_number)}</td>
                    <td style="text-transform:capitalize;">${u.role}</td>
                    <td>${u.department || '-'}</td>
                    <td>
                      ${u.is_verified ? '<span class="status-badge verified">Verified</span>' : '<span class="status-badge pending">Pending</span>'}
                      ${!u.is_active ? '<span class="status-badge inactive" style="margin-left:4px;">Inactive</span>' : ''}
                    </td>
                    <td>
                      <div style="display:flex;flex-direction:column;gap:6px;width:90px;">
                        ${!u.is_verified ? `<button class="btn btn-success btn-sm" onclick="window._verifyUser('${u.id}')" style="width:90px;height:34px;">Verify</button>` : ''}
                        ${u.is_active ? `<button class="btn btn-secondary btn-sm" onclick="window._toggleUser('${u.id}','deactivate')" style="width:90px;height:34px;">Disable</button>` : `<button class="btn btn-secondary btn-sm" onclick="window._toggleUser('${u.id}','activate')" style="width:90px;height:34px;">Enable</button>`}
                        <button class="btn btn-danger btn-sm" onclick="window._deleteUser('${u.id}')" style="width:90px;height:34px;">Delete</button>
                      </div>
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>`;
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

  // Make navigateTo globally accessible for inline onclick
  window.navigateTo = navigateTo;
  window.openModal = openModal;

  // ════════════════════════════════
  //  MODALS
  // ════════════════════════════════
  function openModal(type, modalData) {
    let title, bodyHtml, onSubmit;
    pendingFiles = [];

    switch (type) {
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
          <div class="form-row">
            <div class="form-group">
              <label>Department</label>
              <select class="form-input form-select" id="modalDept">
                ${departments.filter(d => d !== 'All').map(d => `<option value="${d}">${d}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="display:flex;align-items:flex-end;">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                <input type="checkbox" id="modalAnon"> Post anonymously
              </label>
            </div>
          </div>
          <div class="form-group">
            <label>Photos</label>
            ${renderImageUploadWidget('annImages')}
          </div>`;
        onSubmit = async () => {
          const titleVal = document.getElementById('modalTitle').value.trim();
          const content = document.getElementById('modalContent').value.trim();
          const department = document.getElementById('modalDept').value;
          const is_anonymous = document.getElementById('modalAnon').checked;
          if (!titleVal || !content) { showToast('Please fill in title and content', 'error'); return; }

          const formData = new FormData();
          formData.append('title', titleVal);
          formData.append('content', content);
          formData.append('department', department);
          formData.append('is_anonymous', is_anonymous);
          pendingFiles.forEach(f => formData.append('images', f));

          await apiFormData('/api/announcements', formData);
          showToast('Announcement posted!', 'success');
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
              <input type="date" class="form-input" id="modalDate">
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
            <label>Department</label>
            <select class="form-input form-select" id="modalDept">
              ${departments.filter(d => d !== 'All').map(d => `<option value="${d}">${d}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Event Photos</label>
            ${renderImageUploadWidget('eventImages')}
          </div>`;
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

          await apiFormData('/api/events', formData);
          showToast('Event created!', 'success');
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
              <button class="lf-tab" data-val="found" id="lfTypeFound">I Found Something</button>
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
            <label>Contact Info</label>
            <input type="text" class="form-input" id="modalItemContact" placeholder="How can the owner reach you?">
          </div>
          <div class="form-group">
            <label>Photos</label>
            ${renderImageUploadWidget('lfImages')}
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

          const formData = new FormData();
          Object.entries(data).forEach(([k, v]) => formData.append(k, v));
          pendingFiles.forEach(f => formData.append('images', f));

          await apiFormData('/api/lost-found', formData);
          showToast('Item reported successfully!', 'success');
          closeModal();
          loadLostFound();
        };
        break;

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
          <div class="form-group">
            <label>Category</label>
            <select class="form-input form-select" id="modalDocCat">
              <option value="">-- Select Category --</option>
              ${state.docCategories.map(c => `<option value="${c.id}"${state.docSelectedCategory === c.id ? ' selected' : ''}>${escHtml(c.name)}</option>`).join('')}
            </select>
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
          formData.append('file', pendingFiles[0]);

          await apiFormData('/api/documents', formData);
          showToast('Document uploaded!', 'success');
          closeModal();
          loadDocuments();
        };
        break;

      case 'doc-edit':
        title = 'Edit Document';
        bodyHtml = `
          <div class="form-group">
            <label>Title</label>
            <input type="text" class="form-input" id="modalDocTitle" placeholder="Document title">
          </div>
          <div class="form-group">
            <label>Description (optional)</label>
            <textarea class="form-input" id="modalDocDesc" rows="2" placeholder="Brief description..." style="resize:vertical;"></textarea>
          </div>
          <div class="form-group">
            <label>Category</label>
            <select class="form-input form-select" id="modalDocCat">
              ${state.docCategories.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('')}
            </select>
          </div>`;
        onSubmit = async () => {
          const docTitle = document.getElementById('modalDocTitle').value.trim();
          const category_id = document.getElementById('modalDocCat').value;
          if (!docTitle) { showToast('Please enter a title', 'error'); return; }
          await api(`/api/documents/${modalData.id}`, { method: 'PATCH', body: JSON.stringify({ title: docTitle, description: document.getElementById('modalDocDesc').value.trim(), category_id }) });
          showToast('Document updated!', 'success');
          closeModal();
          loadDocuments();
        };
        break;

      case 'schedule':
        title = 'Add Class';
        bodyHtml = `
          <div class="form-row">
            <div class="form-group">
              <label>Subject Code</label>
              <input type="text" class="form-input" id="modalSubCode" placeholder="e.g., IT132">
            </div>
            <div class="form-group">
              <label>Subject Name</label>
              <input type="text" class="form-input" id="modalSubName" placeholder="e.g., Web Development">
            </div>
          </div>
          <div class="form-group">
            <label>Day of Week</label>
            <select class="form-input form-select" id="modalDay">
              ${days.map(d => `<option value="${d}">${d}</option>`).join('')}
            </select>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Start Time</label>
              <input type="time" class="form-input" id="modalStartTime">
            </div>
            <div class="form-group">
              <label>End Time</label>
              <input type="time" class="form-input" id="modalEndTime">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Room</label>
              <input type="text" class="form-input" id="modalRoom" placeholder="e.g., Room 301">
            </div>
            <div class="form-group">
              <label>Instructor</label>
              <select class="form-input form-select" id="modalFacultyUser">
                <option value="">-- Select Faculty --</option>
                ${state.facultyList.map(f => `<option value="${f.id}">${escHtml(f.last_name + ', ' + f.first_name)}${f.department ? ' (' + escHtml(f.department) + ')' : ''}</option>`).join('')}
              </select>
            </div>
          </div>
          <small style="color:var(--text-light);font-size:11px;">Linking to a faculty lets you see their real-time location in the Professor Locator.</small>`;
        onSubmit = async () => {
          const facultySelect = document.getElementById('modalFacultyUser');
          const facultyUserId = facultySelect.value || null;
          const selectedFacultyLabel = facultySelect.value
            ? facultySelect.options[facultySelect.selectedIndex].text
            : '';
          const data = {
            subject_code: document.getElementById('modalSubCode').value.trim(),
            subject_name: document.getElementById('modalSubName').value.trim(),
            day_of_week: document.getElementById('modalDay').value,
            start_time: document.getElementById('modalStartTime').value,
            end_time: document.getElementById('modalEndTime').value,
            room: document.getElementById('modalRoom').value.trim(),
            instructor: selectedFacultyLabel,
            faculty_user_id: facultyUserId,
          };
          if (!data.subject_code || !data.subject_name || !data.start_time || !data.end_time) {
            showToast('Please fill in required fields', 'error'); return;
          }
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
            <div class="form-group">
              <label>Subject Code</label>
              <input type="text" class="form-input" id="modalSubCode" placeholder="e.g., IT132">
            </div>
            <div class="form-group">
              <label>Subject Name</label>
              <input type="text" class="form-input" id="modalSubName" placeholder="e.g., Web Development">
            </div>
          </div>
          <div class="form-group">
            <label>Day of Week</label>
            <select class="form-input form-select" id="modalDay">
              ${days.map(d => `<option value="${d}">${d}</option>`).join('')}
            </select>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Start Time</label>
              <input type="time" class="form-input" id="modalStartTime">
            </div>
            <div class="form-group">
              <label>End Time</label>
              <input type="time" class="form-input" id="modalEndTime">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Room</label>
              <input type="text" class="form-input" id="modalRoom" placeholder="e.g., Room 301">
            </div>
            <div class="form-group">
              <label>Section (optional)</label>
              <input type="text" class="form-input" id="modalSection" placeholder="e.g., BSIT-3A">
            </div>
          </div>`;
        onSubmit = async () => {
          const data = {
            subject_code: document.getElementById('modalSubCode').value.trim(),
            subject_name: document.getElementById('modalSubName').value.trim(),
            day_of_week: document.getElementById('modalDay').value,
            start_time: document.getElementById('modalStartTime').value,
            end_time: document.getElementById('modalEndTime').value,
            room: document.getElementById('modalRoom').value.trim(),
            section: document.getElementById('modalSection').value.trim(),
          };
          if (!data.subject_code || !data.subject_name || !data.start_time || !data.end_time) {
            showToast('Please fill in required fields', 'error'); return;
          }
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
            <p><strong>Heads up:</strong> uploading replaces your current class schedule.</p>
            <p>CSV columns: <code>subject_code, subject_name, day_of_week, start_time, end_time, room, instructor</code></p>
            <p>If <code>instructor</code> matches a faculty's name, they'll be auto-linked to the locator. <a href="/api/schedules/template" download>Download template</a>.</p>
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
            const res = await fetch('/api/schedules/upload', { method: 'POST', credentials: 'include', body: fd });
            const data = await res.json();
            if (!res.ok) {
              resultDiv.innerHTML = `<div class="csv-error"><i class="fas fa-exclamation-triangle"></i> ${escHtml(data.error || 'Upload failed')}</div>` +
                (data.errors && data.errors.length ? `<ul class="csv-error-list">${data.errors.map(e => `<li>Line ${e.line}: ${escHtml(e.errors.join(', '))}</li>`).join('')}</ul>` : '');
              return;
            }
            resultDiv.innerHTML = `<div class="csv-success"><i class="fas fa-check-circle"></i> ${escHtml(data.message)}</div>` +
              (data.errors && data.errors.length ? `<ul class="csv-error-list">${data.errors.map(e => `<li>Line ${e.line}: ${escHtml(e.errors.join(', '))}</li>`).join('')}</ul>` : '');
            showToast(data.message, 'success');
            setTimeout(() => { closeModal(); loadSchedules(); }, 1200);
          } catch (err) {
            resultDiv.innerHTML = `<div class="csv-error"><i class="fas fa-exclamation-triangle"></i> ${escHtml(err.message)}</div>`;
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
            const res = await fetch('/api/faculty-schedules/upload', { method: 'POST', credentials: 'include', body: fd });
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
          <button class="btn btn-secondary btn-sm" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary btn-sm" id="modalSubmit">Submit</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

    document.getElementById('modalSubmit').onclick = async () => {
      document.getElementById('modalSubmit').disabled = true;
      try { await onSubmit(); } catch (err) { showToast(err.message, 'error'); document.getElementById('modalSubmit').disabled = false; }
    };

    // Lost/Found type toggle
    if (type === 'lostfound') {
      const lostBtn = document.getElementById('lfTypeLost');
      const foundBtn = document.getElementById('lfTypeFound');
      const typeInput = document.getElementById('modalLFType');
      lostBtn.onclick = () => { lostBtn.classList.add('active'); foundBtn.classList.remove('active'); typeInput.value = 'lost'; };
      foundBtn.onclick = () => { foundBtn.classList.add('active'); lostBtn.classList.remove('active'); typeInput.value = 'found'; };
    }

    // CSV dropzone for schedule uploads
    if (type === 'teachingUpload' || type === 'classUpload') {
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

  // ── PWA REGISTRATION ──
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // ── CHECK AUTH ON LOAD ──
  async function init() {
    try {
      const user = await api('/api/auth/me');
      state.user = user;
    } catch (e) {
      state.user = null;
    }
    render();
  }

  init();

})();
