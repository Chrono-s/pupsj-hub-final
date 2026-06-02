/* ============================================
   PUPSJ HUB - Single Page Application
   ============================================ */

(function () {
  'use strict';

  // ── STATE ──
  const state = {
    user: null,
    systemSettings: {},
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
    notifications: [],
    notificationsUnread: 0,
    authViewActive: false,
    announcementSearchQuery: sessionStorage.getItem('ann_search_query') || '',
    announcementDateFilter: sessionStorage.getItem('ann_date_filter') || 'all',
    announcementCustomStartDate: sessionStorage.getItem('ann_custom_start') || '',
    announcementCustomEndDate: sessionStorage.getItem('ann_custom_end') || '',
    // Pages feature
    annViewMode: 'feed', // 'feed' or 'pages'
    activePages: [],
    myPages: [],
    pageRequests: [],
    currentPageProfile: null,
  };

  // Polling handle for Professor Locator
  let locatorPollTimer = null;
  let notificationsPollTimer = null;

  // Per-page scroll position + data-freshness cache
  const pageScrollCache = {};
  const pageLoadedAt    = {};
  const PAGE_CACHE_TTL  = 5 * 60 * 1000; // 5 minutes
  const NOTIFICATIONS_CACHE_TTL = 60 * 1000;

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

  async function apiFormData(url, formData, method = 'POST') {
    try {
      const res = await fetch(url, {
        method: method,
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

  function formatBadgeCount(count) {
    return count > 99 ? '99+' : String(count);
  }

  function renderNotificationBadge(id, className = 'nav-badge') {
    const count = Number(state.notificationsUnread) || 0;
    return `<span class="${className}${count > 0 ? '' : ' is-hidden'}" id="${id}">${formatBadgeCount(count)}</span>`;
  }

  function updateNotificationIndicators() {
    const count = Number(state.notificationsUnread) || 0;
    const label = formatBadgeCount(count);

    // General badges
    ['sidebarNotificationBadge', 'mobileNotificationBadge', 'desktopNotificationBadge'].forEach(id => {
      const badge = document.getElementById(id);
      if (badge) {
        badge.textContent = label;
        badge.classList.toggle('is-hidden', count <= 0);
      }
    });

    // Feature-specific badges breakdown
    const types = state.notificationsByType || {};

    // Announcements
    const annCount = Number(types['announcement']) || 0;
    const annBadge = document.getElementById('badge-announcements');
    if (annBadge) {
      annBadge.textContent = formatBadgeCount(annCount);
      annBadge.classList.toggle('is-hidden', annCount <= 0);
    }

    // Events
    const evCount = Number(types['event']) || 0;
    const evBadge = document.getElementById('badge-events');
    if (evBadge) {
      evBadge.textContent = formatBadgeCount(evCount);
      evBadge.classList.toggle('is-hidden', evCount <= 0);
    }

    // Lost & Found
    const lfCount = Number(types['lostfound']) || 0;
    const lfBadge = document.getElementById('badge-lostfound');
    if (lfBadge) {
      lfBadge.textContent = formatBadgeCount(lfCount);
      lfBadge.classList.toggle('is-hidden', lfCount <= 0);
    }

    // Schedules (Teaching Schedule & Class Schedules)
    const schedCount = Number(types['schedule']) || 0;
    ['badge-teaching', 'badge-section-schedules'].forEach(id => {
      const badge = document.getElementById(id);
      if (badge) {
        badge.textContent = formatBadgeCount(schedCount);
        badge.classList.toggle('is-hidden', schedCount <= 0);
      }
    });
  }

  async function refreshNotificationSummary() {
    if (!state.user) return;
    const data = await api('/api/notifications/summary');
    state.notificationsUnread = Number(data.unread_count) || 0;
    state.notificationsByType = data.types || {};
    updateNotificationIndicators();
  }

  async function clearNotificationsForPage(page) {
    if (!state.user) return;
    let typeToClear = null;
    if (page === 'announcements') {
      typeToClear = 'announcement';
    } else if (page === 'events') {
      typeToClear = 'event';
    } else if (page === 'lostfound') {
      typeToClear = 'lostfound';
    } else if (page === 'teaching' || page === 'section-schedules' || page === 'schedules') {
      typeToClear = 'schedule';
    }

    if (typeToClear) {
      try {
        await api(`/api/notifications/read-type/${typeToClear}`, { method: 'PATCH' });
        if (state.notificationsByType && state.notificationsByType[typeToClear]) {
          const clearedCount = Number(state.notificationsByType[typeToClear]) || 0;
          state.notificationsByType[typeToClear] = 0;
          state.notificationsUnread = Math.max(0, state.notificationsUnread - clearedCount);
          updateNotificationIndicators();
        }
      } catch (err) {
        console.error('Failed to clear notifications for type:', typeToClear, err);
      }
    } else if (page === 'notifications') {
      try {
        await api('/api/notifications/read-all', { method: 'PATCH' });
        state.notifications = state.notifications.map(n => ({ ...n, is_read: true }));
        state.notificationsUnread = 0;
        if (state.notificationsByType) {
          Object.keys(state.notificationsByType).forEach(k => {
            state.notificationsByType[k] = 0;
          });
        }
        updateNotificationIndicators();
      } catch (err) {
        console.error('Failed to clear all notifications:', err);
      }
    }
  }

  function stopNotificationsPolling() {
    if (notificationsPollTimer) {
      clearInterval(notificationsPollTimer);
      notificationsPollTimer = null;
    }
  }

  function startNotificationsPolling() {
    if (!state.user) return;
    stopNotificationsPolling();
    refreshNotificationSummary().catch(() => {});
    notificationsPollTimer = setInterval(() => {
      if (!state.user) {
        stopNotificationsPolling();
        return;
      }
      refreshNotificationSummary().catch(() => {});
    }, 45000);
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

  window.showSystemConfirm = function(message) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.style.zIndex = '99999';
      overlay.innerHTML = `
        <div class="modal modal-sm" style="max-width: 400px; transform: scale(0.95); transition: transform 0.2s ease-out;">
          <div class="modal-header" style="border-bottom: 1px solid var(--border); padding: 12px 16px;">
            <h3 class="modal-title" style="font-size: 16px; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 8px; margin: 0;">
              <i class="fas fa-exclamation-triangle" style="color: var(--primary);"></i> Confirmation
            </h3>
          </div>
          <div class="modal-body" style="padding: 20px 16px; font-size: 14px; color: var(--text-secondary); line-height: 1.5;">
            ${message}
          </div>
          <div class="modal-footer" style="border-top: 1px solid var(--border); padding: 12px 16px; display: flex; justify-content: flex-end; gap: 10px;">
            <button class="btn btn-secondary btn-sm" id="sysConfirmCancel" style="padding: 6px 14px; border-radius: 6px; font-weight: 600; font-size: 13px; cursor: pointer;">Cancel</button>
            <button class="btn btn-primary btn-sm" id="sysConfirmOk" style="padding: 6px 14px; border-radius: 6px; font-weight: 600; font-size: 13px; background: var(--primary) !important; color: #fff !important; cursor: pointer; border: none;">Confirm</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      
      setTimeout(() => {
        const dialog = overlay.querySelector('.modal');
        if (dialog) dialog.style.transform = 'scale(1)';
      }, 10);

      const cleanup = (value) => {
        const dialog = overlay.querySelector('.modal');
        if (dialog) dialog.style.transform = 'scale(0.95)';
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.15s ease-out';
        setTimeout(() => {
          document.body.removeChild(overlay);
          resolve(value);
        }, 150);
      };

      overlay.querySelector('#sysConfirmCancel').onclick = () => cleanup(false);
      overlay.querySelector('#sysConfirmOk').onclick = () => cleanup(true);
      overlay.onclick = (e) => {
        if (e.target === overlay) cleanup(false);
      };
    });
  };

  window.showSystemPrompt = function(message, defaultValue = '') {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.style.zIndex = '99999';
      overlay.innerHTML = `
        <div class="modal modal-sm" style="max-width: 400px; transform: scale(0.95); transition: transform 0.2s ease-out;">
          <div class="modal-header" style="border-bottom: 1px solid var(--border); padding: 12px 16px;">
            <h3 class="modal-title" style="font-size: 16px; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 8px; margin: 0;">
              <i class="fas fa-question-circle" style="color: var(--primary);"></i> Input Required
            </h3>
          </div>
          <div class="modal-body" style="padding: 20px 16px; font-size: 14px; color: var(--text-secondary); line-height: 1.5; display:flex; flex-direction:column; gap:12px;">
            <span>${message}</span>
            <input type="text" id="sysPromptInput" class="form-input" value="${defaultValue}" style="background: var(--bg-card); color: var(--text-primary); border-color: var(--border); width: 100%; border-radius: 6px; height: 38px; padding: 0 10px; box-sizing: border-box;" />
          </div>
          <div class="modal-footer" style="border-top: 1px solid var(--border); padding: 12px 16px; display: flex; justify-content: flex-end; gap: 10px;">
            <button class="btn btn-secondary btn-sm" id="sysPromptCancel" style="padding: 6px 14px; border-radius: 6px; font-weight: 600; font-size: 13px; cursor: pointer;">Cancel</button>
            <button class="btn btn-primary btn-sm" id="sysPromptOk" style="padding: 6px 14px; border-radius: 6px; font-weight: 600; font-size: 13px; background: var(--primary) !important; color: #fff !important; cursor: pointer; border: none;">Submit</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const input = overlay.querySelector('#sysPromptInput');
      input.focus();
      input.select();
      
      setTimeout(() => {
        const dialog = overlay.querySelector('.modal');
        if (dialog) dialog.style.transform = 'scale(1)';
      }, 10);

      const cleanup = (value) => {
        const dialog = overlay.querySelector('.modal');
        if (dialog) dialog.style.transform = 'scale(0.95)';
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.15s ease-out';
        setTimeout(() => {
          document.body.removeChild(overlay);
          resolve(value);
        }, 150);
      };

      overlay.querySelector('#sysPromptCancel').onclick = () => cleanup(null);
      overlay.querySelector('#sysPromptOk').onclick = () => cleanup(input.value);
      input.onkeydown = (e) => {
        if (e.key === 'Enter') cleanup(input.value);
        if (e.key === 'Escape') cleanup(null);
      };
      overlay.onclick = (e) => {
        if (e.target === overlay) cleanup(null);
      };
    });
  };

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
    const COLORS = ['#880808','#2980b9','#27ae60','#8e44ad','#d35400','#16a085','#c0392b','#1a5276','#6d4c41','#00796b'];
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
      stopNotificationsPolling();
      app.innerHTML = renderAuth();
      bindAuthEvents();
      startCarouselAutoplay();
    } else {
      stopCarouselAutoplay();
      app.innerHTML = renderLayout();
      bindLayoutEvents();
      updateNotificationIndicators();
      startNotificationsPolling();
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
            <img src="${state.systemSettings?.app_logo || '/icons/pup_logo.png'}" alt="PUP Logo">
          </div>
          <h1 class="auth-brand-title">Welcome to<br><span>${escHtml(state.systemSettings?.app_title || 'PUPSJ HUB')}</span></h1>
          <p class="auth-brand-sub" style="margin-bottom: 0;">Login to access your campus portal and stay connected with PUP San Juan.</p>
        </div>
      </div>`;
  }

  let activeSlide = 0;
  let carouselTimer = null;

  function getCarouselSlides() {
    const heroRaw = state.systemSettings?.app_landing_hero || '/landing_hero.png';
    const heroImages = heroRaw.split(',').map(u => u.trim()).filter(Boolean);
    
    const defaultSlideTitles = [
      { title: `${escHtml(state.systemSettings?.app_title || 'PUPSJ HUB')} Main Campus`, subtitle: 'San Juan Campus building & landmarks' },
      { title: 'Interactive Portal', subtitle: 'Keep track of all campus announcements & event calendars' },
      { title: 'Smart PUPBot AI', subtitle: 'Interact with our smart campus companion anytime' },
      { title: 'Campus Community', subtitle: 'Connect with student organizations and committees' },
      { title: 'Digital Hub', subtitle: 'Access academic documents and class schedules easily' }
    ];

    if (heroImages.length > 0) {
      return heroImages.map((img, i) => {
        const defaults = defaultSlideTitles[i % defaultSlideTitles.length];
        return {
          image: img,
          title: defaults.title,
          subtitle: defaults.subtitle
        };
      });
    }

    return [
      { image: '/landing_hero.png', title: `${escHtml(state.systemSettings?.app_title || 'PUPSJ HUB')} Main Campus`, subtitle: 'San Juan Campus building & landmarks' }
    ];
  }

  function startCarouselAutoplay() {
    stopCarouselAutoplay();
    carouselTimer = setInterval(() => {
      const slides = getCarouselSlides();
      if (slides.length <= 1) return;
      activeSlide = (activeSlide + 1) % slides.length;
      updateCarousel();
    }, 4500);
  }

  function stopCarouselAutoplay() {
    if (carouselTimer) {
      clearInterval(carouselTimer);
      carouselTimer = null;
    }
  }

  window._prevSlide = () => {
    const slides = getCarouselSlides();
    if (slides.length <= 1) return;
    activeSlide = (activeSlide - 1 + slides.length) % slides.length;
    updateCarousel();
    startCarouselAutoplay();
  };
  window._nextSlide = () => {
    const slides = getCarouselSlides();
    if (slides.length <= 1) return;
    activeSlide = (activeSlide + 1) % slides.length;
    updateCarousel();
    startCarouselAutoplay();
  };
  window._setSlide = (idx) => {
    const slides = getCarouselSlides();
    if (slides.length <= 1) return;
    activeSlide = idx;
    updateCarousel();
    startCarouselAutoplay();
  };
  
  function updateCarousel() {
    const track = document.querySelector('.carousel-container .carousel-track');
    if (track) {
      track.style.transform = `translateX(-${activeSlide * 100}%)`;
    }
    const indicators = document.querySelectorAll('.carousel-container .carousel-indicators .indicator');
    indicators.forEach((ind, i) => {
      ind.classList.toggle('active', activeSlide === i);
    });
  }

  function renderCarousel() {
    const slides = getCarouselSlides();
    return `
      <div class="carousel-container" style="overflow: hidden; position: relative; border-radius: 12px;">
        <div class="carousel-track" style="display: flex; transition: transform 0.6s cubic-bezier(0.25, 1, 0.5, 1); transform: translateX(-${activeSlide * 100}%);">
          ${slides.map(slide => `
            <div class="carousel-slide" style="min-width: 100%; box-sizing: border-box; position: relative;">
              <img src="${slide.image}" alt="${slide.title}" style="width: 100%; display: block; object-fit: cover;">
              <div class="carousel-caption">
                <h4>${slide.title}</h4>
                <p>${slide.subtitle}</p>
              </div>
            </div>
          `).join('')}
        </div>
        ${slides.length > 1 ? `
          <button class="carousel-arrow prev" onclick="window._prevSlide()"><i class="fas fa-chevron-left"></i></button>
          <button class="carousel-arrow next" onclick="window._nextSlide()"><i class="fas fa-chevron-right"></i></button>
          <div class="carousel-indicators">
            ${slides.map((_, i) => `<span class="indicator ${activeSlide === i ? 'active' : ''}" onclick="window._setSlide(${i})"></span>`).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }

  window._openAuthView = (mode) => {
    if (mode) authMode = mode;
    state.authViewActive = true;
    stopCarouselAutoplay();

    const track = document.querySelector('.auth-track');
    const formsSlide = document.querySelector('.slide-forms');

    if (track && formsSlide) {
      // Render correct panel dynamically before sliding
      formsSlide.innerHTML = renderAuthPanel();
      bindAuthEvents();

      // Temporarily hide panel scrollbar to avoid visual layout scroll shifting during translation
      const panel = formsSlide.querySelector('.auth-form-panel');
      if (panel) {
        panel.style.overflowY = 'hidden';
        setTimeout(() => { panel.style.overflowY = 'auto'; }, 600);
      }

      requestAnimationFrame(() => {
        track.classList.add('slide-active');
      });
    } else {
      render();
    }
    document.body.style.overflow = 'hidden';
  };

  window._closeAuthView = () => {
    state.authViewActive = false;
    startCarouselAutoplay();

    const track = document.querySelector('.auth-track');
    if (track) {
      // Temporarily hide scrollbar of the form panel to prevent visual scrollbar slide glitch!
      const panel = track.querySelector('.auth-form-panel');
      if (panel) {
        panel.style.overflowY = 'hidden';
      }

      track.classList.remove('slide-active');
    } else {
      render();
    }
    document.body.style.overflow = 'hidden';
  };

  function renderAuthPanel() {
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
    <div class="auth-screen${isWide ? ' auth-screen--wide' : ''} force-light">
      <!-- LEFT: White form panel -->
      <div class="auth-form-panel" style="position: relative;">
        <!-- Elegantly placed Back button -->
        <a href="#" class="auth-back-btn" onclick="event.preventDefault(); window._closeAuthView()">
          <i class="fas fa-arrow-left"></i> Back to Home
        </a>
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

  function renderAuth() {
    // Force body overflow to hidden when rendering auth views to handle transition correctly
    document.body.style.overflow = 'hidden';

    // ── Special full-screen auth states ──
    if (authMode === 'verifying') {
      return `<div class="auth-screen auth-status-screen force-light">
        <div class="auth-status-card">
          <div class="auth-status-icon spin"><i class="fas fa-circle-notch"></i></div>
          <h2>Verifying your email…</h2>
          <p>Please wait a moment.</p>
        </div>
      </div>`;
    }
    if (authMode === 'verify-success') {
      return `<div class="auth-screen auth-status-screen force-light">
        <div class="auth-status-card success">
          <div class="auth-status-icon"><i class="fas fa-check-circle"></i></div>
          <h2>Email Verified!</h2>
          <p>${escHtml(state.verifyMessage || 'Your email has been verified successfully.')}</p>
          <button class="auth-submit-btn" onclick="window._authGoLogin()">Go to Login</button>
        </div>
      </div>`;
    }
    if (authMode === 'verify-error') {
      return `<div class="auth-screen auth-status-screen force-light">
        <div class="auth-status-card error">
          <div class="auth-status-icon"><i class="fas fa-exclamation-circle"></i></div>
          <h2>Verification Failed</h2>
          <p>${escHtml(state.verifyMessage || 'Invalid or expired verification link.')}</p>
          <button class="auth-submit-btn" onclick="window._authGoLogin()">Back to Login</button>
        </div>
      </div>`;
    }
    if (authMode === 'registered') {
      return `<div class="auth-screen auth-status-screen force-light">
        <div class="auth-status-card success">
          <div class="auth-status-icon"><i class="fas fa-envelope-open-text"></i></div>
          <h2>Check Your Email!</h2>
          <p>We sent a verification link to <strong>${escHtml(state.registeredEmail || 'your email')}</strong>. Click the link to activate your account before logging in.</p>
          <p class="auth-status-note">Didn't receive it? Check your spam folder or <a id="resendVerificationLink" href="#">resend the email</a>.</p>
          <button class="auth-submit-btn" onclick="window._authGoLogin()">Back to Login</button>
        </div>
      </div>`;
    }

    // Default: render full-width viewport track with Slide 0 (Landing) & Slide 1 (Auth)
    return `
      <div class="auth-viewport">
        <div class="auth-track ${state.authViewActive ? 'slide-active' : ''}">
          <!-- SLIDE 0: LANDING PAGE -->
          <div class="auth-slide slide-landing">
            <div class="landing-page">
              <!-- NAVBAR -->
              <header class="landing-navbar">
                <div class="navbar-container">
                  <a href="#" class="navbar-brand">
                    <img src="${state.systemSettings?.app_logo || '/icons/pup_logo.png'}" alt="PUP Logo">
                    <span>${escHtml(state.systemSettings?.app_title || 'PUPSJ HUB')}</span>
                  </a>
                  <nav class="navbar-menu">
                    <a href="#" class="nav-link active">Home</a>
                    <a href="#features" class="nav-link">Features</a>
                    <a href="#about" class="nav-link">About</a>
                  </nav>
                  <div class="navbar-actions">
                    <a href="#" class="btn-text-link" onclick="event.preventDefault(); window._openAuthView('register')">Sign up</a>
                    <button class="btn btn-primary" onclick="window._openAuthView('login')" style="background: #880808 !important; border-color: #880808 !important; color: #fff !important; font-size: 13px; font-weight: 600; padding: 8px 18px; border-radius: 6px;">Log In</button>
                    <button class="btn btn-outlined" onclick="window._guestLogin()" style="border: 1.5px solid #880808 !important; color: #880808 !important; background: transparent !important; font-size: 13px; font-weight: 600; padding: 8px 18px; border-radius: 6px;">Guest Access</button>
                  </div>
                </div>
              </header>

              <div class="landing-scroll-container">
                <!-- HERO SECTION -->
                <section class="landing-hero" id="home">
                  <div class="hero-container">
                    <div class="hero-content">
                      <span class="hero-label">ABOUT US</span>
                      <h1 class="hero-title">${escHtml(state.systemSettings?.app_title || 'PUPSJ HUB')}</h1>
                      <h2 class="hero-subtitle">${escHtml(state.systemSettings?.app_title_subtitle || 'San Juan Campus Hub')}</h2>
                      <p class="hero-body">Welcome to the complete campus progressive web application. Access class schedules, stay updated with campus announcements, report or find lost items, download academic forms & templates, and interact with our smart AI companion, PUPBot.</p>
                      <div class="hero-ctas">
                        <button class="btn btn-primary btn-lg" onclick="window._guestLogin()">Explore as Guest</button>
                        <button class="btn btn-outlined btn-lg" onclick="window._openAuthView('login')">Log In / Sign Up</button>
                      </div>
                    </div>
                    <div class="hero-graphics">
                      <div class="carousel-container-wrapper">
                        ${renderCarousel()}
                      </div>
                    </div>
                  </div>
                </section>

                <!-- FEATURES SECTION -->
                <section class="landing-features" id="features">
                  <div class="section-container">
                    <h2 class="section-title">Features</h2>
                    <div class="features-grid">
                      <div class="feature-card">
                        <div class="feature-icon"><i class="fas fa-bullhorn"></i></div>
                        <h3 class="feature-name">Announcements</h3>
                        <p class="feature-desc">Stay updated with real-time official school announcements, news, and notifications.</p>
                      </div>
                      <div class="feature-card">
                        <div class="feature-icon"><i class="fas fa-calendar-alt"></i></div>
                        <h3 class="feature-name">Event Calendar</h3>
                        <p class="feature-desc">Explore school activities, student organization events, and campus updates.</p>
                      </div>
                      <div class="feature-card">
                        <div class="feature-icon"><i class="fas fa-search-location"></i></div>
                        <h3 class="feature-name">Lost & Found</h3>
                        <p class="feature-desc">Report lost property or easily locate found items on campus.</p>
                      </div>
                      <div class="feature-card">
                        <div class="feature-icon"><i class="fas fa-clock"></i></div>
                        <h3 class="feature-name">Class Schedules</h3>
                        <p class="feature-desc">Quickly lookup student class schedules and room assignments.</p>
                      </div>
                      <div class="feature-card">
                        <div class="feature-icon"><i class="fas fa-robot"></i></div>
                        <h3 class="feature-name">PUPBot AI</h3>
                        <p class="feature-desc">Chat with our smart AI student assistant for inquiries and academic guides.</p>
                      </div>
                      <div class="feature-card">
                        <div class="feature-icon"><i class="fas fa-folder-open"></i></div>
                        <h3 class="feature-name">Document Templates</h3>
                        <p class="feature-desc">Download official school templates, guidelines, and faculty papers.</p>
                      </div>
                    </div>
                  </div>
                </section>

                <!-- ABOUT SECTION -->
                <section class="landing-about" id="about" style="background: #fafafa; padding: 80px 0; border-top: 1px solid #eaeaea;">
                  <div class="section-container" style="max-width: 800px; margin: 0 auto; text-align: center;">
                    <h2 class="section-title" style="margin-bottom: 24px;">About PUPSJ HUB</h2>
                    <p style="font-size: 15px; color: #555; line-height: 1.8; margin-bottom: 0;">${escHtml(state.systemSettings?.app_description || 'PUPSJ HUB is the centralized campus portal designed exclusively for the Polytechnic University of the Philippines San Juan Campus. Engineered to optimize campus communication and student organization coordination, this portal serves as a unified progressive portal for faculty, students, and campus administrators alike.')}</p>
                  </div>
                </section>

                <!-- FOOTER -->
                <footer class="landing-footer">
                  <div class="footer-container">
                    <p>&copy; 2026 PUPSJ HUB. All Rights Reserved. Dedicated to Academic Excellence.</p>
                  </div>
                </footer>
              </div>
            </div>
          </div>

          <!-- SLIDE 1: AUTH SCREEN -->
          <div class="auth-slide slide-forms">
            ${renderAuthPanel()}
          </div>
        </div>
      </div>
    `;
  }

  // Global helpers for onclick
  window._authGoLogin = () => { authMode = 'login'; render(); };
  window._togglePasswordVisibility = (inputId, btn) => {
    const input = document.getElementById(inputId);
    if (!input) return;
    const icon = btn.querySelector('i');
    if (input.type === 'password') {
      input.type = 'text';
      icon.className = 'far fa-eye-slash';
    } else {
      input.type = 'password';
      icon.className = 'far fa-eye';
    }
  };

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

    // Temporarily hide scrollbar of the form panel to prevent visual scrollbar slide glitch!
    const panel = document.querySelector('.auth-form-panel');
    if (panel) {
      panel.style.overflowY = 'hidden';
      setTimeout(() => { panel.style.overflowY = 'auto'; }, 400); // restore after width transition completes!
    }

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
        <div class="auth-password-wrapper">
          <input type="password" class="form-input" id="loginPassword" placeholder="Enter your password" autocomplete="current-password">
          <button type="button" class="toggle-password-btn" onclick="window._togglePasswordVisibility('loginPassword', this)"><i class="far fa-eye"></i></button>
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
          <div class="auth-password-wrapper">
            <input type="password" class="form-input" id="regPassword" placeholder="Min. 6 characters">
            <button type="button" class="toggle-password-btn" onclick="window._togglePasswordVisibility('regPassword', this)"><i class="far fa-eye"></i></button>
          </div>
        </div>
        <div class="form-group">
          <label>Reenter Password</label>
          <div class="auth-password-wrapper">
            <input type="password" class="form-input" id="regConfirmPassword" placeholder="Reenter password">
            <button type="button" class="toggle-password-btn" onclick="window._togglePasswordVisibility('regConfirmPassword', this)"><i class="far fa-eye"></i></button>
          </div>
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
        <div class="auth-password-wrapper">
          <input type="password" class="form-input" id="regPassword" placeholder="Min. 6 characters">
          <button type="button" class="toggle-password-btn" onclick="window._togglePasswordVisibility('regPassword', this)"><i class="far fa-eye"></i></button>
        </div>
      </div>
      <div class="form-group">
        <label>Reenter Password</label>
        <div class="auth-password-wrapper">
          <input type="password" class="form-input" id="regConfirmPassword" placeholder="Reenter password">
          <button type="button" class="toggle-password-btn" onclick="window._togglePasswordVisibility('regConfirmPassword', this)"><i class="far fa-eye"></i></button>
        </div>
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
        const regConfirmPw = document.getElementById('regConfirmPassword');
        if (regConfirmPw) regConfirmPw.onkeydown = (e) => { if (e.key === 'Enter') handleRegister(); };
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
    const regConfirmPassword = document.getElementById('regConfirmPassword')?.value;
    const errEl = document.getElementById('authError');
    const requiredFields = ['first_name', 'last_name', 'student_number', 'email', 'password', 'role'];
    if (fields.role === 'student') {
      requiredFields.push('year_level', 'section', 'student_type');
    }
    if (requiredFields.some(key => !fields[key]) || !regConfirmPassword) { errEl.textContent = 'Please fill in all fields'; errEl.classList.add('show'); return; }
    if (fields.password !== regConfirmPassword) { errEl.textContent = 'Passwords do not match'; errEl.classList.add('show'); return; }
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
    const isGuest = u.role === 'guest';
    const isSuperAdmin = u.role === 'superadmin';
    const isAdmin = u.role === 'admin' || isSuperAdmin;
    const isFaculty = u.role === 'faculty' || isAdmin;

    const roleLabel = u.role === 'superadmin' ? 'Super Admin' : (u.role === 'admin' ? 'Admin' : u.role.charAt(0).toUpperCase() + u.role.slice(1));
    const roleBadgeHtml = u.role === 'superadmin'
      ? `<div class="sidebar-user-role" style="color:#B8860B;font-weight:700;"><i class="fas fa-crown" style="color:#B8860B;margin-right:2px;"></i> ${roleLabel}${u.department ? ' · ' + u.department : ''}</div>`
      : `<div class="sidebar-user-role">${roleLabel}${u.department ? ' · ' + u.department : ''}</div>`;

    return `
    <div class="app-layout">
      <!-- SIDEBAR (Desktop) -->
      <nav class="sidebar">
        <div class="sidebar-header">
          <div class="sidebar-brand">
            <div class="sidebar-brand-icon"><img src="${state.systemSettings?.app_logo || '/icons/pup_logo.png'}" alt="PUP Logo"></div>
            <div><h2>${escHtml(state.systemSettings?.app_title || 'PUPSJ HUB')}</h2><small>San Juan Campus</small></div>
          </div>
        </div>
        <div class="sidebar-nav">
          ${isAdmin ? `
            <div class="nav-section-label">Administration</div>
            <div class="nav-item" data-page="admin-dashboard"><i class="fas fa-chart-pie"></i> Dashboard</div>
            ${isSuperAdmin ? `
              <div class="nav-item" data-page="admin-users"><i class="fas fa-users-cog"></i> Manage Users</div>
              <div class="nav-item" data-page="system-maintenance"><i class="fas fa-tools"></i> System Maintenance</div>
            ` : ''}
            
            <div class="nav-section-label">Main</div>
            <div class="nav-item active" data-page="announcements"><i class="fas fa-bullhorn"></i> Announcements <span class="nav-badge is-hidden" id="badge-announcements">0</span></div>
            ${isGuest ? '' : `<div class="nav-item" data-page="events"><i class="fas fa-calendar-alt"></i> Event Calendar <span class="nav-badge is-hidden" id="badge-events">0</span></div>`}
            <div class="nav-item" data-page="lostfound"><i class="fas fa-search-location"></i> Lost & Found <span class="nav-badge is-hidden" id="badge-lostfound">0</span></div>
            ${isGuest ? '' : `
              ${isFaculty ? `<div class="nav-item" data-page="teaching"><i class="fas fa-clock"></i> Teaching Schedule <span class="nav-badge is-hidden" id="badge-teaching">0</span></div>` : `<div class="nav-item" data-page="section-schedules"><i class="fas fa-clock"></i> Class Schedules <span class="nav-badge is-hidden" id="badge-section-schedules">0</span></div>`}
            `}
            <div class="nav-item" data-page="chatbot"><i class="fas fa-robot"></i> PUPBot</div>
            <div class="nav-item" data-page="documents"><i class="fas fa-folder-open"></i> Document Templates</div>
          ` : `
            <div class="nav-section-label">Main</div>
            <div class="nav-item active" data-page="announcements"><i class="fas fa-bullhorn"></i> Announcements <span class="nav-badge is-hidden" id="badge-announcements">0</span></div>
            ${isGuest ? '' : `<div class="nav-item" data-page="events"><i class="fas fa-calendar-alt"></i> Event Calendar <span class="nav-badge is-hidden" id="badge-events">0</span></div>`}
            <div class="nav-item" data-page="lostfound"><i class="fas fa-search-location"></i> Lost & Found <span class="nav-badge is-hidden" id="badge-lostfound">0</span></div>
            ${isGuest ? '' : `
              ${isFaculty ? `<div class="nav-item" data-page="teaching"><i class="fas fa-clock"></i> Teaching Schedule <span class="nav-badge is-hidden" id="badge-teaching">0</span></div>` : `<div class="nav-item" data-page="section-schedules"><i class="fas fa-clock"></i> Class Schedules <span class="nav-badge is-hidden" id="badge-section-schedules">0</span></div>`}
            `}
            <div class="nav-item" data-page="chatbot"><i class="fas fa-robot"></i> PUPBot</div>
            <div class="nav-item" data-page="documents"><i class="fas fa-folder-open"></i> Document Templates</div>
          `}
        </div>
        <div class="sidebar-footer">
          <div class="sidebar-user">
            <div class="sidebar-avatar">${u.profile_image ? `<img src="${u.profile_image}" alt="avatar">` : getInitials(isAdmin ? u.first_name : u.first_name + ' ' + u.last_name)}</div>
            <div class="sidebar-user-info">
              <div class="sidebar-user-name">${isAdmin ? u.first_name : u.first_name + ' ' + u.last_name}</div>
              ${roleBadgeHtml}
            </div>
            <i class="fas fa-sign-out-alt sidebar-logout" id="logoutBtn" title="Logout"></i>
          </div>
        </div>
      </nav>

      <!-- Drawer scrim (mobile) -->
      <div class="sidebar-scrim" id="sidebarScrim"></div>

      <!-- MAIN -->
      <div class="main-content">
        <!-- Desktop Header (Premium top-right corner bar) -->
        <div class="desktop-top-header">
          ${isGuest ? '' : `
          <button class="btn-icon notification-bell-btn" id="desktopNotificationsBtn" title="Notifications">
            <i class="fas fa-bell"></i>
            ${renderNotificationBadge('desktopNotificationBadge', 'top-bell-badge')}
          </button>
          `}
        </div>

        <!-- Mobile Header -->
        <div class="top-header">
          <button class="hamburger-btn" id="hamburgerBtn" aria-label="Open menu"><i class="fas fa-bars"></i></button>
          <div class="top-header-brand">
            <div class="brand-icon"><img src="${state.systemSettings?.app_logo || '/icons/pup_logo.png'}" alt="PUP Logo"></div>
            ${escHtml(state.systemSettings?.app_title || 'PUPSJ HUB')}
          </div>
          <div class="top-header-actions">
            ${isGuest ? '' : `
            <button class="btn-icon notification-bell-btn" id="mobileNotifications" title="Notifications">
              <i class="fas fa-bell"></i>
              ${renderNotificationBadge('mobileNotificationBadge', 'top-bell-badge')}
            </button>
            `}
            <button class="btn-icon" id="mobileLogout" title="Logout"><i class="fas fa-sign-out-alt"></i></button>
          </div>
        </div>

        ${isGuest ? `
        <div class="guest-banner" style="background: #FFFBEB; border-bottom: 1.5px solid #F59E0B; padding: 12px 24px; display: flex; align-items: center; justify-content: space-between; font-size: 13px; font-weight: 500; color: #B45309; z-index: 100;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <i class="fas fa-info-circle" style="font-size: 16px; color: #F59E0B;"></i>
            <span>You are browsing as a guest. Login or Register for full access.</span>
          </div>
          <button class="btn btn-primary btn-sm guest-login-btn" onclick="window._guestExit()" style="background: #880808 !important; border-color: #880808 !important; color: #fff !important; font-size: 12px; font-weight: 600; padding: 4px 14px; border-radius: 20px; box-shadow: none;">Login</button>
        </div>
        ` : ''}

        <!-- Page Area -->
        <div class="page-area" id="pageArea"></div>

        <!-- Fixed Chat Input Bar (initially hidden) -->
        <div class="fixed-chat-input-wrapper" id="fixedChatInputWrapper" style="display:none; justify-content:center; align-items:center; border-top:none; background:transparent;">
          <div class="chat-prompt-box">
            <div class="chat-input-row">
              <textarea id="chatInput" placeholder="Message PUPBot AI..." autocomplete="off" rows="1"></textarea>
            </div>
            <div class="chat-actions-row">
              <div class="chat-actions-right">
                <button class="chat-send-btn-circle" id="chatSend" title="Send message"><i class="fas fa-arrow-up"></i></button>
              </div>
            </div>
          </div>
        </div>

        <!-- Global Floating Chatbot Icon/Button -->
        ${isGuest ? '' : `
        <div class="pupbot-float-btn" id="pupbotFloatBtn" title="Ask PUPBot">
          <i class="fas fa-robot"></i>
        </div>
        
        <!-- Global Floating Chatbot Modal/Window -->
        <div class="pupbot-float-window" id="pupbotFloatWindow">
          <div class="pupbot-float-header">
            <div class="pupbot-float-title">
              <i class="fas fa-robot"></i>
              <span>PUPBot Assistant</span>
              <span style="display: inline-block; width: 8px; height: 8px; background: #22c55e; border-radius: 50%; box-shadow: 0 0 8px #22c55e;"></span>
            </div>
            <button class="pupbot-float-close" id="pupbotFloatCloseBtn" title="Close"><i class="fas fa-times"></i></button>
          </div>
          <div class="pupbot-float-messages" id="pupbotFloatMessages">
            <div class="chat-message-row bot-row">
              <div class="bot-avatar-circle" style="width:28px;height:28px;font-size:12px;background:var(--maroon);color:#fff;display:flex;align-items:center;justify-content:center;border-radius:50%;"><i class="fas fa-robot"></i></div>
              <div class="chat-bubble bot" style="font-size:13px; padding: 8px 12px; background:var(--bg-card); border:1px solid var(--border); border-bottom-left-radius:4px; max-width:75%;">
                <div class="bot-label" style="font-size:10px; font-weight:700; color:var(--maroon); margin-bottom:3px; text-transform:uppercase;">PUPBot</div>
                Hello! I'm <strong>PUPBot</strong>, your campus assistant. Ask me about documents, class schedules, announcements, events, or lost &amp; found items!
              </div>
            </div>
          </div>
          <div class="pupbot-float-input-bar" style="padding: 10px; background: var(--bg-card); border-top: 1px solid var(--border); display: flex; gap: 8px; align-items: center;">
            <input type="text" id="pupbotFloatInput" placeholder="Ask PUPBot..." autocomplete="off" style="flex: 1; background: var(--bg-soft); border: 1.5px solid var(--border); border-radius: 20px; padding: 6px 12px; font-size: 13px; outline: none; color: var(--text-primary);">
            <button id="pupbotFloatSend" style="width: 32px; height: 32px; background: var(--maroon); color: #fff; border: none; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; cursor: pointer; transition: background-color 0.15s; flex-shrink: 0;"><i class="fas fa-paper-plane"></i></button>
          </div>
        </div>
        `}

      </div>
    </div>`;
  }

  function bindLayoutEvents() {
    // Global floating chatbot toggle & events
    const floatBtn = document.getElementById('pupbotFloatBtn');
    const floatCloseBtn = document.getElementById('pupbotFloatCloseBtn');
    const floatWindow = document.getElementById('pupbotFloatWindow');
    const floatInput = document.getElementById('pupbotFloatInput');
    const floatSend = document.getElementById('pupbotFloatSend');
    const floatMessages = document.getElementById('pupbotFloatMessages');

    if (floatBtn && floatWindow) {
      floatBtn.onclick = () => {
        const isOpen = floatWindow.classList.toggle('open');
        if (isOpen) {
          floatInput.focus();
          floatMessages.scrollTop = floatMessages.scrollHeight;
        }
      };
      
      if (floatCloseBtn) {
        floatCloseBtn.onclick = () => {
          floatWindow.classList.remove('open');
        };
      }
      
      if (floatSend) {
        floatSend.onclick = () => {
          sendFloatChatMessage();
        };
      }
      
      if (floatInput) {
        floatInput.onkeydown = (e) => {
          if (e.key === 'Enter') {
            sendFloatChatMessage();
          }
        };
      }
    }

    // Sidebar nav
    document.querySelectorAll('.nav-item[data-page]').forEach(el => {
      el.onclick = () => { navigateTo(el.dataset.page); closeSidebar(); };
    });
    // Sidebar user profile click
    const sidebarUser = document.querySelector('.sidebar-user');
    if (sidebarUser) {
      sidebarUser.onclick = (e) => {
        if (e.target.id !== 'logoutBtn' && !e.target.closest('#logoutBtn')) {
          navigateTo('profile');
          closeSidebar();
        }
      };
    }
    // Hamburger menu (mobile)
    const hamburger = document.getElementById('hamburgerBtn');
    const scrim = document.getElementById('sidebarScrim');
    const sidebarEl = document.querySelector('.sidebar');

    function isMobile() { return window.innerWidth <= 991; }

    function openSidebar() {
      if (!sidebarEl) return;
      document.body.classList.add('sidebar-open');
      // Belt-and-suspenders: also force inline styles
      if (isMobile()) {
        sidebarEl.style.transform = 'translateX(0)';
        if (scrim) { scrim.style.opacity = '1'; scrim.style.pointerEvents = 'all'; }
      }
    }

    function _closeSidebar() {
      document.body.classList.remove('sidebar-open');
      if (sidebarEl && isMobile()) {
        sidebarEl.style.transform = 'translateX(-110%)';
        if (scrim) { scrim.style.opacity = '0'; scrim.style.pointerEvents = 'none'; }
      }
    }
    closeSidebar = _closeSidebar;

    // Apply mobile base styles directly on sidebar (no CSS specificity issues)
    function applyMobileDrawerStyles() {
      if (!sidebarEl) return;
      if (isMobile()) {
        sidebarEl.style.cssText = [
          'position: absolute',
          'top: 0',
          'left: 0',
          'height: 100%',
          'width: min(280px, 82vw)',
          'transform: translateX(-110%)',
          'transition: transform 0.3s cubic-bezier(0.4,0,0.2,1)',
          'z-index: 300',
          'box-shadow: 4px 0 32px rgba(0,0,0,0.35)',
          'overflow-y: auto',
          'will-change: transform'
        ].join('; ');
        if (scrim) {
          scrim.style.cssText = [
            'display: block',
            'position: absolute',
            'inset: 0',
            'background: rgba(0,0,0,0.55)',
            'z-index: 299',
            'opacity: 0',
            'pointer-events: none',
            'transition: opacity 0.3s ease'
          ].join('; ');
        }
        // Make app-layout the positioning context
        const layout = document.querySelector('.app-layout');
        if (layout) {
          layout.style.position = 'relative';
          layout.style.overflow = 'hidden';
        }
      } else {
        // Desktop: remove all inline styles
        sidebarEl.style.cssText = '';
        if (scrim) scrim.style.cssText = '';
        const layout = document.querySelector('.app-layout');
        if (layout) { layout.style.position = ''; layout.style.overflow = ''; }
        document.body.classList.remove('sidebar-open');
      }
    }

    applyMobileDrawerStyles();
    window.addEventListener('resize', () => {
      applyMobileDrawerStyles();
    });

    if (hamburger) hamburger.onclick = openSidebar;
    if (scrim) scrim.onclick = _closeSidebar;
    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    const mobileNotifications = document.getElementById('mobileNotifications');
    const mobileLogout = document.getElementById('mobileLogout');
    const desktopNotifications = document.getElementById('desktopNotificationsBtn');
    const doLogout = async () => {
      await api('/api/auth/logout', { method: 'POST' });
      sessionStorage.removeItem('pupsj_token');
      sessionStorage.removeItem('ann_search_query');
      sessionStorage.removeItem('ann_date_filter');
      sessionStorage.removeItem('ann_custom_start');
      sessionStorage.removeItem('ann_custom_end');
      stopNotificationsPolling();
      state.user = null;
      state.currentPage = 'announcements';
      state.announcementSearchQuery = '';
      state.announcementDateFilter = 'all';
      state.announcementCustomStartDate = '';
      state.announcementCustomEndDate = '';
      state.chatMessages = [];
      state.announcements = [];
      state.events = [];
      state.lostFound = [];
      state.notifications = [];
      state.notificationsUnread = 0;
      state.adminStats = null;
      state.adminUsers = [];
      state.adminSelectedAllowedIds = new Set();
      Object.keys(pageLoadedAt).forEach(k => delete pageLoadedAt[k]);
      Object.keys(pageScrollCache).forEach(k => delete pageScrollCache[k]);
      showToast('Logged out', 'info');
      render();
    };
    if (mobileNotifications) mobileNotifications.onclick = () => navigateTo('notifications');
    if (desktopNotifications) desktopNotifications.onclick = () => navigateTo('notifications');
    if (logoutBtn) logoutBtn.onclick = doLogout;
    if (mobileLogout) mobileLogout.onclick = doLogout;
  }

  function closeSidebar() {
    document.body.classList.remove('sidebar-open');
    const sidebarEl = document.querySelector('.sidebar');
    const scrim = document.getElementById('sidebarScrim');
    if (sidebarEl && window.innerWidth <= 991) {
      sidebarEl.style.transform = 'translateX(-110%)';
      if (scrim) { scrim.style.opacity = '0'; scrim.style.pointerEvents = 'none'; }
    }
  }

  function navigateTo(page) {
    const isSuperAdmin = state.user?.role === 'superadmin';
    const isAdmin = state.user?.role === 'admin' || isSuperAdmin;

    // Guard guest-restricted pages
    if (state.user?.role === 'guest' && ['events', 'schedules', 'teaching', 'section-schedules', 'notifications', 'profile', 'admin-dashboard', 'admin-users'].includes(page)) {
      showToast('Guests cannot access this page. Please log in or register.', 'error');
      page = 'announcements';
    }

    // Guard admin-only pages — redirect non-admins/superadmins to announcements
    if (page === 'admin-users' && !isSuperAdmin) {
      page = 'announcements';
    }
    if (page === 'system-maintenance' && !isSuperAdmin) {
      page = 'announcements';
    }
    if (page === 'admin-dashboard' && !isAdmin) {
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

    // Manage floating chatbot button
    const floatBtn = document.getElementById('pupbotFloatBtn');
    const floatWindow = document.getElementById('pupbotFloatWindow');
    if (floatBtn) {
      if (page === 'chatbot') {
        floatBtn.style.display = 'none';
        if (floatWindow) floatWindow.classList.remove('open');
      } else {
        floatBtn.style.display = 'flex';
      }
    }

    // Stop Professor Locator polling when leaving announcements
    if (state.currentPage === 'announcements' && page !== 'announcements') {
      stopLocatorPolling();
    }
    if (page === 'announcements') {
      state.annViewMode = 'feed';
      state.currentPageProfile = null;
    }
    state.currentPage = page;
    state.selectedEvent = null;
    clearNotificationsForPage(page);
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
          if (chatInput) chatInput.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
          if (chatSend)  chatSend.onclick = send;
        }
        break;
      case 'documents': loadDocuments(true); break;
      case 'notifications': loadNotifications(true); break;
      case 'profile': loadProfile(); break;
      case 'admin-dashboard': loadAdminDashboard(); break;
      case 'admin-users': loadAdminUsers(); break;
      case 'system-maintenance': loadSystemMaintenance(); break;
      default: loadAnnouncements();
    }
  }

  // ════════════════════════════════
  //  ANNOUNCEMENTS (Facebook-style)
  // ════════════════════════════════
  async function loadAnnouncements(fromNav = false) {
    if (state.annViewMode === 'pages') {
      window._switchAnnView('pages');
      return;
    }
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
      let queryParams = [];
      if (state.filters.department !== 'All') {
        queryParams.push(`department=${encodeURIComponent(state.filters.department)}`);
      }
      if (state.annViewMode === 'archived') {
        queryParams.push('status=archived');
      }
      const queryString = queryParams.length > 0 ? `?${queryParams.join('&')}` : '';
      const [annData, schedData, locatorData] = await Promise.all([
        api(`/api/announcements${queryString}`),
        // Students need their own class schedules so the locator knows which faculty are "theirs"
        state.user.role === 'student' ? api('/api/schedules').catch(() => []) : Promise.resolve([]),
        api('/api/faculty/locations').catch(() => ({ locations: [] }))
      ]);
      state.announcements = annData.announcements || [];
      if (state.user.role === 'student') state.schedules = schedData;
      state.facultyLocations = locatorData.locations || [];
      state.facultyLocationsUpdatedAt = new Date();
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
    const isFacultyOrAdmin = state.user.role === 'faculty' || state.user.role === 'admin' || state.user.role === 'superadmin';

    let composerHtml = '';
    if (isFacultyOrAdmin) {
      const u = state.user;
      const fullName = ((u.first_name || '') + ' ' + (u.last_name || '')).trim() || 'User';
      const avatarBg = getAvatarColor(fullName);
      const avatarHtml = u.profile_image 
        ? `<img src="${u.profile_image}" alt="avatar" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover;">` 
        : `<div class="ann-composer-avatar" style="width: 40px; height: 40px; border-radius: 50%; background: ${avatarBg}; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px;">${getInitials(fullName)}</div>`;
      
      composerHtml = `
        <div class="card ann-composer-card" id="annComposerCard" style="display: flex; align-items: center; gap: 14px; padding: 12px 16px; margin-bottom: 16px; background: var(--bg-card); border: 1px solid var(--border-light); border-radius: var(--radius-md); cursor: pointer; transition: border-color 0.2s, box-shadow 0.2s;">
          <div style="flex-shrink: 0; display: flex; align-items: center;">
            ${avatarHtml}
          </div>
          <div class="ann-composer-input-trigger" style="flex: 1; background: var(--bg-soft); border: 1.5px solid var(--border); border-radius: 20px; padding: 10px 16px; color: var(--text-light); font-size: 14px; font-weight: 500; user-select: none; text-align: left;">
            Drop your announcement!
          </div>
        </div>
      `;
    }

    // Restrict department filter chips for students/guests
    let visibleDepts = departments;
    if (state.user.role === 'student') {
      const userDept = state.user.department || '';
      visibleDepts = ['All', 'General', 'Campus', userDept].filter(Boolean);
      visibleDepts = [...new Set(visibleDepts)];
    } else if (state.user.role === 'guest') {
      visibleDepts = ['All', 'General', 'Campus'];
    }

    if (!visibleDepts.includes(state.filters.department)) {
      state.filters.department = 'All';
    }

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

    // Filter posts locally based on active search/date filters
    function getFilteredAnnouncements() {
      let posts = state.announcements;

      // 1. Search Query Filter
      if (state.announcementSearchQuery) {
        const q = state.announcementSearchQuery.toLowerCase().trim();
        posts = posts.filter(a => 
          (a.title && a.title.toLowerCase().includes(q)) || 
          (a.content && a.content.toLowerCase().includes(q))
        );
      }

      // 2. Date Range Filter
      const now = new Date();
      if (state.announcementDateFilter === 'today') {
        posts = posts.filter(a => {
          const created = new Date(a.created_at);
          return created.getFullYear() === now.getFullYear() &&
                 created.getMonth() === now.getMonth() &&
                 created.getDate() === now.getDate();
        });
      } else if (state.announcementDateFilter === 'week') {
        const oneWeekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
        posts = posts.filter(a => new Date(a.created_at).getTime() >= oneWeekAgo);
      } else if (state.announcementDateFilter === 'month') {
        posts = posts.filter(a => {
          const created = new Date(a.created_at);
          return created.getFullYear() === now.getFullYear() &&
                 created.getMonth() === now.getMonth();
        });
      } else if (state.announcementDateFilter === 'custom') {
        if (state.announcementCustomStartDate) {
          const start = new Date(state.announcementCustomStartDate).setHours(0, 0, 0, 0);
          posts = posts.filter(a => new Date(a.created_at).getTime() >= start);
        }
        if (state.announcementCustomEndDate) {
          const end = new Date(state.announcementCustomEndDate).setHours(23, 59, 59, 999);
          posts = posts.filter(a => new Date(a.created_at).getTime() <= end);
        }
      }

      return posts;
    }

    function buildFeedHtml(posts) {
      if (posts.length === 0) {
        return '<div class="empty-state"><i class="fas fa-search-minus"></i><h3>No announcements found</h3><p>Try adjusting your search query or date filters</p></div>';
      }
      return posts.map(a => {
        const hasImg = a.images && a.images.length > 0 && a.images[0].id;
        const displayName = a.page_name || a.author_name || 'Unknown';
        const displayImage = a.page_name ? a.page_logo : a.author_image;
        const displayRole = a.page_name ? 'Page' : a.author_role;
        const _aColor = getAvatarColor(displayName);
        return `
        <article class="card ann-post" id="ann-post-${a.id}" data-ann-id="${a.id}">
          <!-- Header -->
          <div class="ann-post-header">
            <div class="ann-post-avatar" style="${displayImage ? '' : `background:${_aColor};`}">${displayImage ? `<img src="${displayImage}" alt="">` : getInitials(displayName)}</div>
            <div class="ann-post-author-meta">
              <span class="ann-post-author">${escHtml(displayName)}</span>
              <span class="ann-post-time">${displayRole ? escHtml(displayRole) + ' · ' : ''}${timeAgo(a.created_at)}</span>
            </div>
            <span class="ann-dept-badge">${escHtml(a.department)}</span>
            ${a.status === 'pending' ? '<span class="ann-status-pill ann-pending" title="Awaiting admin approval">Pending</span>' : ''}
            ${a.status === 'rejected' ? `<span class="ann-status-pill ann-rejected" title="${escHtml(a.rejection_reason || '')}">Rejected</span>` : ''}
          </div>

          <!-- Text body -->
          <div class="ann-post-body">
            ${a.is_pinned ? '<div class="ann-pin-badge"><i class="fas fa-thumbtack"></i> Pinned</div>' : ''}
            <h3 class="ann-post-title">
              ${escHtml(a.title)}
              ${a.status === 'deleted' ? `<span style="background-color:#dc2626; color:white; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:bold; margin-left:8px; display:inline-block; vertical-align:middle; text-transform:uppercase; letter-spacing: 0.5px;">Deleted</span>` : ''}
            </h3>
            ${a.content.length <= 250 ? `
              <p class="ann-post-text">${escHtml(a.content)}</p>
            ` : `
              <p class="ann-post-text truncated" id="ann-text-${a.id}"><span class="text-content">${escHtml(a.content.substring(0, 220))}...</span><span class="full-content" style="display:none;">${escHtml(a.content)}</span><button class="see-more-btn" onclick="window._toggleAnnText('${a.id}', this)">see more....</button></p>
            `}
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
    }

    const filteredPosts = getFilteredAnnouncements();

    // ── Right sidebar — Recent Posts ──
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
              const displayName = a.page_name || a.author_name || 'Unknown';
              const displayImage = a.page_name ? a.page_logo : a.author_image;
              const _rc = getAvatarColor(displayName);
              return `
              <div class="ann-recent-item" onclick="document.getElementById('ann-post-${a.id}')?.scrollIntoView({behavior:'smooth',block:'start'})">
                <div class="ann-recent-item-info">
                  <div class="ann-recent-avatar" style="${displayImage ? '' : `background:${_rc};`}">${displayImage ? `<img src="${displayImage}" alt="">` : getInitials(displayName)}</div>
                  <div class="ann-recent-item-text">
                    <p class="ann-recent-title">${escHtml(a.title)}</p>
                    <span class="ann-recent-meta">${escHtml(displayName)} · ${timeAgo(a.created_at)}</span>
                  </div>
                </div>
                ${a.images && a.images.length > 0 && a.images[0].id
                  ? `<img class="ann-recent-thumb" src="${a.images[0].image_url}" alt="">`
                  : ''}
              </div>`;}).join('')}
        </div>
      </aside>`;

    const searchControlsHtml = `
      <div class="ann-controls-bar">
        <div class="ann-search-wrapper">
          <i class="fas fa-search search-icon"></i>
          <input type="text" class="ann-search-input" id="annSearchInput" placeholder="Search announcements by title or content..." value="${escHtml(state.announcementSearchQuery)}" autocomplete="off">
        </div>
        <div class="ann-date-wrapper">
          <select class="ann-date-select" id="annDateSelect">
            <option value="all" ${state.announcementDateFilter === 'all' ? 'selected' : ''}>All Dates</option>
            <option value="today" ${state.announcementDateFilter === 'today' ? 'selected' : ''}>Today</option>
            <option value="week" ${state.announcementDateFilter === 'week' ? 'selected' : ''}>This Week</option>
            <option value="month" ${state.announcementDateFilter === 'month' ? 'selected' : ''}>This Month</option>
            <option value="custom" ${state.announcementDateFilter === 'custom' ? 'selected' : ''}>Custom Date Range</option>
          </select>
        </div>
        <div class="ann-custom-date-pickers" id="annCustomDatePickers" style="${state.announcementDateFilter === 'custom' ? 'display: flex;' : 'display: none;'}">
          <div class="date-input-group">
            <label>From:</label>
            <input type="date" class="ann-date-picker" id="annStartDate" value="${state.announcementCustomStartDate}">
          </div>
          <div class="date-input-group">
            <label>To:</label>
            <input type="date" class="ann-date-picker" id="annEndDate" value="${state.announcementCustomEndDate}">
          </div>
        </div>
      </div>
    `;

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
        <div class="ann-view-toggle">
          <button class="ann-view-tab ${state.annViewMode === 'feed' ? 'active' : ''}" data-view="feed" onclick="window._switchAnnView('feed')">
            <i class="fas fa-rss" style="margin-right: 6px;"></i>Feed
          </button>
          <button class="ann-view-tab ${state.annViewMode === 'pages' ? 'active' : ''}" data-view="pages" onclick="window._switchAnnView('pages')">
            <i class="fas fa-flag" style="margin-right: 6px;"></i>Pages
          </button>
          ${(state.user.role === 'faculty' || state.user.role === 'admin' || state.user.role === 'superadmin') ? `
          <button class="ann-view-tab ${state.annViewMode === 'archived' ? 'active' : ''}" data-view="archived" onclick="window._switchAnnView('archived')">
            <i class="fas fa-archive" style="margin-right: 6px;"></i>Archived
          </button>
          ` : ''}
        </div>
        ${renderLocatorWidget()}
        <div class="filter-bar">
          ${visibleDepts.map(d => `<button class="filter-chip ${state.filters.department === d ? 'active' : ''}" data-dept="${d}">${d}</button>`).join('')}
        </div>
        ${searchControlsHtml}
        <div class="ann-layout">
          <div class="ann-feed" id="annPostsFeed">${composerHtml}${buildFeedHtml(filteredPosts)}</div>
          ${sidebarHtml}
        </div>
      </div>
      <button class="scroll-top-btn" id="scrollTopBtn" title="Scroll to Top">
        <i class="fas fa-arrow-up"></i>
      </button>`;

    pageArea.innerHTML = html;

    // Filter chips
    document.querySelectorAll('.filter-chip[data-dept]').forEach(el => {
      el.onclick = () => { state.filters.department = el.dataset.dept; loadAnnouncements(); };
    });
    // Composer card click
    const composerCardEl = document.getElementById('annComposerCard');
    if (composerCardEl) composerCardEl.onclick = () => openModal('announcement');
    // Professor Locator toggle
    bindLocatorEvents();

    // Search and Date Filter Event Listeners
    const annSearchInput = document.getElementById('annSearchInput');
    const annDateSelect = document.getElementById('annDateSelect');
    const annCustomDatePickers = document.getElementById('annCustomDatePickers');
    const annStartDate = document.getElementById('annStartDate');
    const annEndDate = document.getElementById('annEndDate');
    const annPostsFeed = document.getElementById('annPostsFeed');

    const updateFeed = () => {
      const filtered = getFilteredAnnouncements();
      if (annPostsFeed) {
        annPostsFeed.innerHTML = composerHtml + buildFeedHtml(filtered);
        // Re-bind composer click since innerHTML resets children
        const composerCardElSub = document.getElementById('annComposerCard');
        if (composerCardElSub) composerCardElSub.onclick = () => openModal('announcement');
      }
    };

    if (annSearchInput) {
      annSearchInput.oninput = (e) => {
        state.announcementSearchQuery = e.target.value;
        sessionStorage.setItem('ann_search_query', state.announcementSearchQuery);
        updateFeed();
      };
    }

    if (annDateSelect) {
      annDateSelect.onchange = (e) => {
        state.announcementDateFilter = e.target.value;
        sessionStorage.setItem('ann_date_filter', state.announcementDateFilter);
        
        if (state.announcementDateFilter === 'custom') {
          if (annCustomDatePickers) annCustomDatePickers.style.display = 'flex';
        } else {
          if (annCustomDatePickers) annCustomDatePickers.style.display = 'none';
          state.announcementCustomStartDate = '';
          state.announcementCustomEndDate = '';
          sessionStorage.removeItem('ann_custom_start');
          sessionStorage.removeItem('ann_custom_end');
          if (annStartDate) annStartDate.value = '';
          if (annEndDate) annEndDate.value = '';
        }
        updateFeed();
      };
    }

    if (annStartDate) {
      annStartDate.onchange = (e) => {
        state.announcementCustomStartDate = e.target.value;
        sessionStorage.setItem('ann_custom_start', state.announcementCustomStartDate);
        updateFeed();
      };
    }

    if (annEndDate) {
      annEndDate.onchange = (e) => {
        state.announcementCustomEndDate = e.target.value;
        sessionStorage.setItem('ann_custom_end', state.announcementCustomEndDate);
        updateFeed();
      };
    }

    // Scroll to Top functionality
    const scrollTopBtn = document.getElementById('scrollTopBtn');
    if (scrollTopBtn) {
      scrollTopBtn.onclick = () => {
        pageArea.scrollTo({
          top: 0,
          behavior: 'smooth'
        });
      };

      const handleScroll = () => {
        if (state.currentPage !== 'announcements') {
          pageArea.removeEventListener('scroll', handleScroll);
          return;
        }
        const posts = document.querySelectorAll('.ann-post');
        let threshold = 300;
        if (posts.length >= 3) {
          threshold = posts[2].offsetTop;
        }
        if (pageArea.scrollTop > threshold) {
          scrollTopBtn.classList.add('visible');
        } else {
          scrollTopBtn.classList.remove('visible');
        }
      };

      pageArea.addEventListener('scroll', handleScroll);
      // Run once immediately to check in case of loaded/cached scroll position
      handleScroll();
    }

  }

  window._deleteAnnouncement = async (id) => {
    if (!await window.showSystemConfirm('Delete this announcement?')) return;
    try {
      await api(`/api/announcements/${id}`, { method: 'DELETE' });
      showToast('Announcement deleted', 'success');
      loadAnnouncements();
    } catch (err) { showToast(err.message, 'error'); }
  };

  window._toggleAnnText = (id, btn) => {
    const parent = document.getElementById(`ann-text-${id}`);
    if (!parent) return;
    const isTruncated = parent.classList.contains('truncated');
    const textContentEl = parent.querySelector('.text-content');
    const fullContentEl = parent.querySelector('.full-content');

    if (isTruncated) {
      parent.classList.remove('truncated');
      textContentEl.style.display = 'none';
      fullContentEl.style.display = 'inline';
      btn.textContent = 'see less....';
    } else {
      parent.classList.add('truncated');
      textContentEl.style.display = 'inline';
      fullContentEl.style.display = 'none';
      btn.textContent = 'see more....';
    }
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
  //  PAGES FEATURE
  // ════════════════════════════════

  async function loadActivePages() {
    try {
      const data = await api('/api/pages/active');
      state.activePages = data;
    } catch (err) { console.error('Load active pages:', err); }
  }

  async function loadMyPages() {
    try {
      const data = await api('/api/pages/my-pages');
      state.myPages = data;
    } catch (err) { console.error('Load my pages:', err); }
  }

  async function loadPageRequests() {
    if (state.user.role !== 'admin' && state.user.role !== 'superadmin') return;
    try {
      const data = await api('/api/pages/requests');
      state.pageRequests = data;
    } catch (err) { console.error('Load page requests:', err); }
  }

  async function openPageProfile(pageId) {
    try {
      state.annViewMode = 'pages';
      if (state.currentPage !== 'announcements' || !document.querySelector('.ann-layout')) {
        state.currentPage = 'announcements';
        document.querySelectorAll('.nav-item[data-page]').forEach(el => el.classList.toggle('active', el.dataset.page === 'announcements'));
        await loadAnnouncements();
      }
      const data = await api(`/api/pages/${pageId}`);
      state.currentPageProfile = data;
      renderPageProfileView();
    } catch (err) {
      showToast(err.message || 'Failed to load page', 'error');
    }
  }

  function renderPagesDirectory() {
    const pageArea = document.getElementById('pageArea');
    const isStudent = state.user.role === 'student';
    const isSuperAdmin = state.user.role === 'superadmin';
    const isAdminLike = state.user.role === 'admin' || isSuperAdmin;

    // Build my pages section (student / owner pages)
    let myPagesHtml = '';
    if (state.myPages.length > 0) {
      myPagesHtml = `
        <div class="my-pages-section">
          <div class="my-pages-hdr">
            <h3><i class="fas fa-bookmark" style="color:var(--maroon);margin-right:6px;"></i>My Pages</h3>
          </div>
          <div class="pages-grid">
            ${state.myPages.map(p => buildPageCard(p, true)).join('')}
          </div>
        </div>`;
    }

    // Build page requests section (admin/superadmin)
    let requestsHtml = '';
    if (isAdminLike) {
      if (state.pageRequests.length > 0) {
        requestsHtml = `
          <div class="my-pages-section">
            <div class="my-pages-hdr">
              <h3><i class="fas fa-inbox" style="color:var(--maroon);margin-right:6px;"></i>Pending Page Requests (${state.pageRequests.length})</h3>
            </div>
            ${state.pageRequests.map(p => buildPageRequestCard(p)).join('')}
          </div>`;
      } else {
        requestsHtml = `
          <div class="my-pages-section">
            <div class="my-pages-hdr">
              <h3><i class="fas fa-inbox" style="color:var(--maroon);margin-right:6px;"></i>Pending Page Requests (0)</h3>
            </div>
            <div class="page-requests-empty" style="padding: 1.5rem; background: var(--bg-card); border: 1px dashed var(--border); border-radius: 8px; text-align: center; color: var(--text-secondary); margin-bottom: 1.5rem;">
              <i class="fas fa-check-circle" style="font-size: 1.5rem; color: #16a34a; margin-bottom: 0.5rem; display: block;"></i>
              <span>No pending page requests at the moment.</span>
            </div>
          </div>`;
      }
    }

    // All active pages
    const allPagesHtml = state.activePages.length > 0
      ? `<div class="pages-grid">${state.activePages.map(p => buildPageCard(p, false)).join('')}</div>`
      : `<div class="pages-empty"><i class="fas fa-flag"></i><h3>No pages yet</h3><p>Be the first to create a page for your organization or club!</p></div>`;

    const html = `
      <div class="pages-directory">
        <button class="page-back-btn" onclick="window._switchAnnView('feed')"><i class="fas fa-arrow-left"></i> Back to Feed</button>
        <div class="pages-header-row">
          <h3>Pages</h3>
          ${isStudent ? `<button class="create-page-btn" onclick="window._openCreatePageModal()"><i class="fas fa-plus"></i> Create Page</button>` : ''}
          ${isSuperAdmin ? `<button class="create-page-btn" onclick="window._openCreatePageModal()"><i class="fas fa-plus"></i> Create Page</button>` : ''}
        </div>
        ${requestsHtml}
        ${myPagesHtml}
        <div class="my-pages-section">
          <div class="my-pages-hdr"><h3><i class="fas fa-globe" style="color:var(--maroon);margin-right:6px;"></i>All Pages</h3></div>
          ${allPagesHtml}
        </div>
      </div>`;

    // Replace only the main content area (keep header intact)
    const annFeed = document.getElementById('annPostsFeed');
    const sidebar = document.querySelector('.ann-sidebar');
    const annLayout = document.querySelector('.ann-layout');
    if (annLayout) {
      annLayout.innerHTML = `<div style="grid-column:1/-1;">${html}</div>`;
    }
  }

  function buildPageCard(p, showStatus) {
    const _c = getAvatarColor(p.name || 'P');
    const statusBadge = showStatus && p.status === 'pending'
      ? `<span class="page-pending-badge"><i class="fas fa-clock"></i> Pending</span>`
      : showStatus && p.status === 'rejected'
      ? `<span class="page-rejected-badge"><i class="fas fa-times-circle"></i> Rejected</span>`
      : '';
    return `
      <div class="page-card" onclick="window._openPageProfile('${p.id}')">
        <div class="page-card-cover">
          ${p.cover_image ? `<img src="${p.cover_image}" alt="">` : ''}
          <div class="page-card-logo" style="${p.logo_image ? '' : `background:${_c};`}">
            ${p.logo_image ? `<img src="${p.logo_image}" alt="">` : (p.name ? p.name.charAt(0).toUpperCase() : 'P')}
          </div>
        </div>
        <div class="page-card-body">
          <div class="page-card-name">${escHtml(p.name)}</div>
          <div class="page-card-category"><i class="fas fa-tag"></i> ${escHtml(p.category)} ${statusBadge}</div>
          ${p.description ? `<div class="page-card-desc">${escHtml(p.description)}</div>` : ''}
        </div>
        <div class="page-card-footer">
          <div class="page-card-owner"><i class="fas fa-user"></i> ${escHtml(p.owner_name || 'Unknown')}</div>
          <span>${p.owner_department || ''}</span>
        </div>
      </div>`;
  }

  function buildPageRequestCard(p) {
    const _c = getAvatarColor(p.name || 'P');
    return `
      <div class="page-request-card">
        <div class="page-request-header">
          <div class="page-request-logo" style="${p.logo_image ? '' : `background:${_c};`}">
            ${p.logo_image ? `<img src="${p.logo_image}" alt="">` : (p.name ? p.name.charAt(0).toUpperCase() : 'P')}
          </div>
          <div class="page-request-info">
            <div class="page-request-name">${escHtml(p.name)}</div>
            <div class="page-request-meta">${escHtml(p.category)} · by ${escHtml(p.owner_name || 'Unknown')} (${escHtml(p.owner_email || '')}) · ${escHtml(p.owner_department || '')}</div>
          </div>
        </div>
        ${p.description ? `<div class="page-request-desc">${escHtml(p.description)}</div>` : ''}
        <div class="page-request-actions">
          <button class="page-action-btn primary" onclick="window._approvePageRequest('${p.id}')"><i class="fas fa-check"></i> Approve</button>
          <button class="page-action-btn danger" onclick="window._rejectPageRequest('${p.id}')"><i class="fas fa-times"></i> Reject</button>
        </div>
      </div>`;
  }

  function renderPageProfileView() {
    const data = state.currentPageProfile;
    if (!data) return;
    const { page, announcements, members, isOwner, isMember, canPost, canManage } = data;
    const _c = getAvatarColor(page.name || 'P');
    const isSuperAdmin = state.user.role === 'superadmin';

    // Build page posts
    const postsHtml = announcements.length > 0
      ? announcements.map(a => {
          const displayName = page.name;
          const displayImage = page.logo_image;
          const hasImg = a.images && a.images.length > 0 && a.images[0].id;
          return `
            <article class="card ann-post" data-ann-id="${a.id}">
              <div class="ann-post-header">
                <div class="ann-post-avatar" style="${displayImage ? '' : `background:${_c};`}">${displayImage ? `<img src="${displayImage}" alt="">` : (displayName ? displayName.charAt(0).toUpperCase() : 'P')}</div>
                <div class="ann-post-author-meta">
                  <span class="ann-post-author">${escHtml(displayName)}</span>
                  <span class="ann-post-time">Page · ${timeAgo(a.created_at)}</span>
                </div>
                <span class="ann-dept-badge">${escHtml(a.department)}</span>
              </div>
              <div class="ann-post-body">
                <h3 class="ann-post-title">
              ${escHtml(a.title)}
              ${a.status === 'deleted' ? `<span style="background-color:#dc2626; color:white; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:bold; margin-left:8px; display:inline-block; vertical-align:middle; text-transform:uppercase; letter-spacing: 0.5px;">Deleted</span>` : ''}
            </h3>
                <p class="ann-post-text">${escHtml(a.content)}</p>
              </div>
              ${hasImg ? `<div class="ann-media-grid ann-media-single"><div class="ann-media-cell" onclick="window._openImageViewer('${a.images[0].image_url}')"><img src="${a.images[0].image_url}" alt="photo"></div></div>` : ''}
              <div class="ann-post-footer">
                <div class="ann-post-footer-left">
                  <span class="ann-footer-time"><i class="fas fa-clock"></i> ${timeAgo(a.created_at)}</span>
                </div>
              </div>
            </article>`;
        }).join('')
      : `<div class="empty-state"><i class="fas fa-newspaper"></i><h3>No posts yet</h3><p>This page hasn't posted any announcements yet.</p></div>`;

    // Build owner item
    const ownerColor = getAvatarColor(page.owner_name || 'O');
    const ownerItem = `
      <div class="page-member-item">
        <div class="page-member-avatar" style="background:${ownerColor};">
          ${getInitials(page.owner_name || 'Owner')}
        </div>
        <div class="page-member-info">
          <div class="page-member-name">${escHtml(page.owner_name || 'Unknown')}</div>
          <div class="page-member-role">Owner</div>
        </div>
      </div>`;

    // Build members list
    const membersListHtml = members.map(m => {
      const mc = getAvatarColor(m.name || 'M');
      return `
        <div class="page-member-item">
          <div class="page-member-avatar" style="${m.profile_image ? '' : `background:${mc};`}">
            ${m.profile_image ? `<img src="${m.profile_image}" alt="">` : getInitials(m.name || 'M')}
          </div>
          <div class="page-member-info">
            <div class="page-member-name">${escHtml(m.name || 'Unknown')}</div>
            <div class="page-member-role">Member</div>
          </div>
          ${(isOwner || isSuperAdmin) ? `<button class="page-member-remove" title="Remove member" onclick="window._removePageMember('${page.id}','${m.user_id}')"><i class="fas fa-times"></i></button>` : ''}
        </div>`;
    }).join('');

    // Add member row (for owner / superadmin)
    const addMemberHtml = (isOwner || isSuperAdmin) ? `
      <div class="add-member-row">
        <input type="email" id="addMemberEmail" placeholder="Enter email to add...">
        <button onclick="window._addPageMember('${page.id}')"><i class="fas fa-plus"></i> Add</button>
      </div>` : '';

    // Action buttons
    let actionsHtml = '';
    if (canPost) {
      actionsHtml += `<button class="page-action-btn primary" onclick="window._openPostAsPageModal('${page.id}')"><i class="fas fa-pen"></i> Post as Page</button>`;
    }
    if (isSuperAdmin) {
      actionsHtml += `<button class="page-action-btn secondary" onclick="window._openEditPageModal('${page.id}')"><i class="fas fa-edit"></i> Edit Page</button>`;
      actionsHtml += `<button class="page-action-btn danger" onclick="window._deletePage('${page.id}')"><i class="fas fa-trash"></i> Delete Page</button>`;
    }

    const annLayout = document.querySelector('.ann-layout');
    if (!annLayout) return;

    annLayout.innerHTML = `
      <div style="grid-column:1/-1;">
        <div class="page-profile">
          <button class="page-back-btn" onclick="window._switchAnnView('pages')"><i class="fas fa-arrow-left"></i> Back to Pages</button>
          <div class="page-profile-cover">${page.cover_image ? `<img src="${page.cover_image}" alt="">` : ''}</div>
          <div class="page-profile-header">
            <div class="page-profile-logo" style="${page.logo_image ? '' : `background:${_c};`}">
              ${page.logo_image ? `<img src="${page.logo_image}" alt="">` : (page.name ? page.name.charAt(0).toUpperCase() : 'P')}
            </div>
            <div class="page-profile-info">
              <div class="page-profile-name">${escHtml(page.name)}</div>
              <div class="page-profile-meta">
                <span><i class="fas fa-tag"></i>${escHtml(page.category)}</span>
                <span><i class="fas fa-user"></i>${escHtml(page.owner_name || 'Unknown')}</span>
                <span><i class="fas fa-building"></i>${escHtml(page.owner_department || 'General')}</span>
              </div>
              ${page.description ? `<div class="page-profile-description">${escHtml(page.description)}</div>` : ''}
              <div class="page-profile-actions">${actionsHtml}</div>
            </div>
          </div>

          <div class="page-feed-layout">
            <div class="page-feed-main">${postsHtml}</div>
            <div class="page-members-panel">
              <div class="page-members-hdr">
                <h4>Members</h4>
                <span class="page-members-count">${members.length + 1}</span>
              </div>
              ${ownerItem}
              ${membersListHtml}
              ${addMemberHtml}
            </div>
          </div>
        </div>
      </div>`;
  }

  // ── Window-exposed page actions ──

  window._switchAnnView = async (mode) => {
    state.annViewMode = mode;
    if (mode === 'pages') {
      await Promise.all([loadActivePages(), loadMyPages(), loadPageRequests()]);
      renderPagesDirectory();
    } else if (mode === 'feed' || mode === 'archived') {
      state.currentPageProfile = null;
      loadAnnouncements();
    }
    // Update toggle buttons
    document.querySelectorAll('.ann-view-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === mode);
    });
  };

  window._openPageProfile = (id) => {
    openPageProfile(id);
  };

  window._openCreatePageModal = () => {
    openModal('create-page');
  };

  window._approvePageRequest = async (id) => {
    if (!await window.showSystemConfirm('Approve this page request?')) return;
    try {
      await api(`/api/pages/${id}/approve`, { method: 'POST' });
      showToast('Page approved!', 'success');
      await Promise.all([loadActivePages(), loadMyPages(), loadPageRequests()]);
      renderPagesDirectory();
    } catch (err) { showToast(err.message, 'error'); }
  };

  window._rejectPageRequest = async (id) => {
    const reason = await window.showSystemPrompt('Rejection reason (optional):');
    if (reason === null) return;
    try {
      await api(`/api/pages/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason || '' }),
      });
      showToast('Page request rejected', 'success');
      await Promise.all([loadActivePages(), loadMyPages(), loadPageRequests()]);
      renderPagesDirectory();
    } catch (err) { showToast(err.message, 'error'); }
  };

  window._addPageMember = async (pageId) => {
    const emailInput = document.getElementById('addMemberEmail');
    if (!emailInput) return;
    const email = emailInput.value.trim();
    if (!email) { showToast('Please enter an email', 'error'); return; }
    try {
      const res = await api(`/api/pages/${pageId}/members`, {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      showToast(res.message || 'Member added!', 'success');
      openPageProfile(pageId);
    } catch (err) { showToast(err.message, 'error'); }
  };

  window._removePageMember = async (pageId, userId) => {
    if (!await window.showSystemConfirm('Remove this member?')) return;
    try {
      await api(`/api/pages/${pageId}/members/${userId}`, { method: 'DELETE' });
      showToast('Member removed', 'success');
      openPageProfile(pageId);
    } catch (err) { showToast(err.message, 'error'); }
  };

  window._openPostAsPageModal = (pageId) => {
    openModal('post-as-page', { pageId });
  };

  window._openEditPageModal = (pageId) => {
    const data = state.currentPageProfile;
    if (!data) return;
    openModal('edit-page', { page: data.page });
  };

  window._deletePage = async (pageId) => {
    if (!await window.showSystemConfirm('Are you sure you want to delete this page? This action cannot be undone.')) return;
    try {
      await api(`/api/pages/${pageId}`, { method: 'DELETE' });
      showToast('Page deleted', 'success');
      state.currentPageProfile = null;
      await Promise.all([loadActivePages(), loadMyPages(), loadPageRequests()]);
      renderPagesDirectory();
    } catch (err) { showToast(err.message, 'error'); }
  };

  // ════════════════════════════════
  //  EVENTS / CALENDAR + FEEDBACK
  // ════════════════════════════════
  async function loadEvents(fromNav = false) {
    const pageArea = document.getElementById('pageArea');

    if (state.eventsViewMode === 'archived') {
      pageArea.innerHTML = `<div class="page-header"><h1 class="page-title">Archived Events</h1><p class="page-subtitle">Historical events older than 3 months</p></div><div class="page-content"><div class="loader"><div class="spinner"></div></div></div>`;
      try {
        const data = await api('/api/events?status=archived');
        state.events = data;
        renderArchivedEventsPage();
      } catch (err) {
        pageArea.querySelector('.page-content').innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Failed to load archived events</h3></div>`;
      }
      return;
    }

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

  function renderArchivedEventsPage() {
    const pageArea = document.getElementById('pageArea');
    let html = `
      <div class="page-header" style="display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap;">
        <div>
          <h1 class="page-title">Archived Events</h1>
          <p class="page-subtitle">Historical events older than 3 months</p>
        </div>
        <button class="btn btn-secondary" id="btnBackToCalendar" style="border-radius: 9999px; padding: 10px 20px; font-weight: 600; font-size: 13px; cursor: pointer; transition: all 0.2s;">
          <i class="fas fa-arrow-left"></i> Back to Calendar
        </button>
      </div>
      <div class="page-content">
        <div class="archived-events-list" style="display: flex; flex-direction: column; gap: 16px;">
          ${state.events.length === 0 ? `
            <div class="empty-state">
              <i class="fas fa-calendar-times"></i>
              <h3>No archived events found</h3>
            </div>` : 
            state.events.map(ev => {
              const dateStr = new Date(ev.event_date).toLocaleDateString('en-US', {month: 'long', day: 'numeric', year: 'numeric'});
              return `
                <div class="card event-chat-card" style="background: var(--bg-card); border: 1.5px solid var(--border); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 6px; box-shadow: var(--shadow-sm); cursor: pointer;" onclick="window._openEventDetail('${ev.id}')">
                  <h4 style="font-size: 16px; font-weight: 700; color: var(--text-primary); margin: 0;">
                    ${escHtml(ev.title)}
                    ${ev.status === 'deleted' ? `<span style="background-color:#dc2626; color:white; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:bold; margin-left:8px; display:inline-block; vertical-align:middle; text-transform:uppercase; letter-spacing: 0.5px;">Deleted</span>` : ''}
                  </h4>
                  <div style="font-size: 12px; color: var(--text-secondary); display: flex; flex-direction: column; gap: 2px;">
                    <div><i class="far fa-calendar-alt" style="width: 14px;"></i> ${dateStr} ${ev.start_time ? ' at ' + formatTime(ev.start_time) : ''}</div>
                    ${ev.location ? `<div><i class="fas fa-map-marker-alt" style="width: 14px;"></i> ${escHtml(ev.location)}</div>` : ''}
                  </div>
                  ${ev.description ? `<p style="font-size: 13px; color: var(--text-secondary); margin: 6px 0 0 0;">${escHtml(ev.description)}</p>` : ''}
                </div>
              `;
            }).join('')
          }
        </div>
      </div>
    `;
    pageArea.innerHTML = html;
    document.getElementById('btnBackToCalendar').onclick = () => {
      state.eventsViewMode = 'calendar';
      loadEvents();
    };
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
      <div class="page-header" style="display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap;">
        <div>
          <h1 class="page-title">Event Calendar</h1>
          <p class="page-subtitle">Campus activities & events</p>
        </div>
        ${isFacultyOrAdmin ? `
          <div class="event-header-actions">
            ${(state.user.role === 'faculty' || state.user.role === 'admin' || state.user.role === 'superadmin') ? `
              <button class="btn btn-secondary" id="btnArchivedEvents" style="border-radius: 9999px; padding: 10px 20px; display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; cursor: pointer; transition: all 0.2s;">
                <i class="fas fa-archive"></i> Archived Events
              </button>
            ` : ''}
            <button class="btn btn-primary" id="btnCreateEvent" style="background: #880808; border: none; color: #fff; border-radius: 9999px; padding: 10px 20px; display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; cursor: pointer; transition: all 0.2s; box-shadow: 0 2px 8px rgba(136,8,8,0.25);">
              <i class="fas fa-plus"></i> Create Event
            </button>
          </div>
        ` : ''}
      </div>
      <div class="page-content">
        <div class="card" style="padding:20px;margin-bottom:20px;">
          <div class="calendar-nav">
            <button class="calendar-nav-btn" id="calPrev"><i class="fas fa-chevron-left"></i></button>
            <div class="calendar-nav-selects" style="display: inline-flex; align-items: center; gap: 12px; z-index: 10;">
              
              <div class="calendar-custom-dropdown" id="monthDropdown">
                <button class="calendar-dropdown-trigger" id="monthTrigger">
                  <span>${months[state.calendarMonth]}</span>
                  <i class="fas fa-chevron-down"></i>
                </button>
                <div class="calendar-dropdown-menu" id="monthMenu">
                  ${months.map((m, idx) => `<div class="calendar-dropdown-item${state.calendarMonth === idx ? ' active' : ''}" data-value="${idx}">${m}</div>`).join('')}
                </div>
              </div>

              <div class="calendar-custom-dropdown" id="yearDropdown">
                <button class="calendar-dropdown-trigger" id="yearTrigger">
                  <span>${state.calendarYear}</span>
                  <i class="fas fa-chevron-down"></i>
                </button>
                <div class="calendar-dropdown-menu" id="yearMenu">
                  ${Array.from({ length: 15 }, (_, i) => today.getFullYear() - 5 + i).map(yr => `<div class="calendar-dropdown-item${state.calendarYear === yr ? ' active' : ''}" data-value="${yr}">${yr}</div>`).join('')}
                </div>
              </div>

            </div>
            <button class="calendar-nav-btn" id="calNext"><i class="fas fa-chevron-right"></i></button>
          </div>
          <div class="calendar-grid">${calendarCells}</div>
        </div>
        ${state.events.length === 0 ? '<div class="empty-state"><i class="fas fa-calendar-times"></i><h3>No events this month</h3><p>Check back later for upcoming events.</p></div>' : ''}
      </div>`;

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
    
    // Toggle month dropdown
    const monthTrigger = document.getElementById('monthTrigger');
    const monthMenu = document.getElementById('monthMenu');
    if (monthTrigger && monthMenu) {
      monthTrigger.onclick = (e) => {
        e.stopPropagation();
        monthMenu.classList.toggle('show');
        const yearMenu = document.getElementById('yearMenu');
        if (yearMenu) yearMenu.classList.remove('show');
      };
      
      monthMenu.querySelectorAll('.calendar-dropdown-item').forEach(item => {
        item.onclick = (e) => {
          e.stopPropagation();
          state.calendarMonth = parseInt(item.dataset.value);
          loadEvents();
        };
      });
    }

    // Toggle year dropdown
    const yearTrigger = document.getElementById('yearTrigger');
    const yearMenu = document.getElementById('yearMenu');
    if (yearTrigger && yearMenu) {
      yearTrigger.onclick = (e) => {
        e.stopPropagation();
        yearMenu.classList.toggle('show');
        const monthMenu = document.getElementById('monthMenu');
        if (monthMenu) monthMenu.classList.remove('show');
      };

      yearMenu.querySelectorAll('.calendar-dropdown-item').forEach(item => {
        item.onclick = (e) => {
          e.stopPropagation();
          state.calendarYear = parseInt(item.dataset.value);
          loadEvents();
        };
      });
    }

    // Close menus on click outside
    document.addEventListener('click', () => {
      const mm = document.getElementById('monthMenu');
      const ym = document.getElementById('yearMenu');
      if (mm) mm.classList.remove('show');
      if (ym) ym.classList.remove('show');
    });
    const btnCreateEvent = document.getElementById('btnCreateEvent');
    if (btnCreateEvent) btnCreateEvent.onclick = () => openModal('event');
    const btnArchivedEvents = document.getElementById('btnArchivedEvents');
    if (btnArchivedEvents) {
      btnArchivedEvents.onclick = () => {
        state.eventsViewMode = 'archived';
        loadEvents();
      };
    }
    window._deleteEvent = async (id) => {
      if (!await window.showSystemConfirm('Delete this event?')) return;
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
  function getEventDateString(event) {
    if (!event || !event.event_date) return '';
    try {
      const d = new Date(event.event_date);
      if (isNaN(d.getTime())) {
        return String(event.event_date).slice(0, 10);
      }
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    } catch (e) {
      return String(event.event_date || '').slice(0, 10);
    }
  }

  function isEventConcluded(event) {
    if (!event || !event.event_date) return false;
    const datePart = getEventDateString(event);
    if (!datePart) return false;
    let targetTime = event.end_time || event.start_time || '23:59:59';
    if (targetTime.split(':').length === 2) {
      targetTime += ':00';
    }
    const eventEndDateTime = new Date(`${datePart}T${targetTime}`);
    if (isNaN(eventEndDateTime.getTime())) return false;
    return new Date() >= eventEndDateTime;
  }

  function isEventEditableByFaculty(event) {
    if (!event || !event.event_date) return false;
    const datePart = getEventDateString(event);
    if (!datePart) return false;
    let targetTime = event.start_time || '00:00:00';
    if (targetTime.split(':').length === 2) {
      targetTime += ':00';
    }
    const eventStartDateTime = new Date(`${datePart}T${targetTime}`);
    if (isNaN(eventStartDateTime.getTime())) return false;
    const oneDayMs = 24 * 60 * 60 * 1000;
    return (eventStartDateTime.getTime() - new Date().getTime()) >= oneDayMs;
  }

  function getEventFeedbackTimeLeft(event) {
    if (!event || !event.event_date) return 0;
    const datePart = getEventDateString(event);
    if (!datePart) return 0;
    let targetTime = event.end_time || event.start_time || '23:59:59';
    if (targetTime.split(':').length === 2) {
      targetTime += ':00';
    }
    const eventEndDateTime = new Date(`${datePart}T${targetTime}`);
    if (isNaN(eventEndDateTime.getTime())) return 0;
    return new Date() - eventEndDateTime;
  }

  window._openEventDetail = async (id) => {
    state.selectedEvent = { id };
    loadSelectedEventDetail();
  };

  async function loadSelectedEventDetail() {
    const pageArea = document.getElementById('pageArea');
    pageArea.innerHTML = `<div class="page-content"><div class="loader"><div class="spinner"></div></div></div>`;
    
    // Find local event from state.events if loaded from calendar
    const localEvent = state.events && Array.isArray(state.events) 
      ? state.events.find(e => String(e.id) === String(state.selectedEvent.id))
      : null;
      
    const isReadOnly = localEvent && (localEvent.is_read_only || String(localEvent.id).startsWith('holiday-') || String(localEvent.id).startsWith('pupsj-'));
    
    if (isReadOnly) {
      state.selectedEvent = localEvent;
      state.eventFeedback = [];
      state.customFormStatus = { schema: null, eventDate: localEvent.event_date, startTime: null, endTime: null, alreadySubmitted: false };
      renderEventDetail(localEvent, [], { total: 0, average_rating: 0 });
      return;
    }

    let fetchedEvent = null;
    let feedback = [];
    let summary = { total: 0, average_rating: 0 };
    let customForm = null;

    try {
      fetchedEvent = await api(`/api/events/${state.selectedEvent.id}`);
      state.selectedEvent = fetchedEvent;
    } catch (err) {
      console.error('Failed to load event details from API:', err);
    }

    const targetEvent = fetchedEvent || localEvent;
    if (!targetEvent) {
      pageArea.innerHTML = `<div class="empty-state"><h3>Failed to load event</h3></div>`;
      return;
    }

    try {
      const [fbRes, sumRes, formRes] = await Promise.all([
        api(`/api/feedback/event/${targetEvent.id}`).catch(() => []),
        api(`/api/feedback/event/${targetEvent.id}/summary`).catch(() => ({ total: 0, average_rating: 0 })),
        api(`/api/events/${targetEvent.id}/feedback-form`).catch(() => null)
      ]);
      feedback = fbRes;
      summary = sumRes;
      customForm = formRes;
    } catch (err) {
      console.error('Failed to load event feedback/form data:', err);
    }

    state.eventFeedback = feedback;
    state.customFormStatus = customForm;
    renderEventDetail(targetEvent, feedback, summary);
  }

  function renderEventDetail(event, feedback, summary) {
    const pageArea = document.getElementById('pageArea');
    const d = new Date(event.event_date);
    const dateStr = d.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const hasImages = event.images && event.images.length > 0 && event.images[0].id;
    const avgRating = parseFloat(summary.average_rating) || 0;
    const totalFeedback = parseInt(summary.total) || 0;

    const hasCustomSchema = !!event.feedback_form_schema && Array.isArray(event.feedback_form_schema) && event.feedback_form_schema.length > 0;
    const concluded = isEventConcluded(event);
    const isAdmin = state.user.role === 'admin' || state.user.role === 'superadmin' || state.user.id === event.author_id;

    let customFeedbackPanel = '';
    if (hasCustomSchema) {
      if (!concluded) {
        customFeedbackPanel = `
          <div class="card event-survey-card" style="padding:24px; text-align:center;">
            <h4 style="margin-top:0; margin-bottom:8px;"><i class="fas fa-poll-h" style="color:var(--primary);"></i> Custom Feedback Survey</h4>
            <p style="font-size:13px; color:var(--text-secondary); margin-bottom:0;">This event is scheduled for the future. The custom feedback survey will open once the event has concluded.</p>
          </div>
        `;
      } else if (getEventFeedbackTimeLeft(event) > 3 * 24 * 60 * 60 * 1000) {
        customFeedbackPanel = `
          <div class="card event-survey-card" style="padding:24px; text-align:center; border: 1px solid var(--border); background: var(--bg-soft);">
            <i class="fas fa-lock" style="color:var(--text-secondary); font-size:32px; margin-bottom:12px;"></i>
            <h4 style="margin:0 0 6px 0;">Survey Period Closed</h4>
            <p style="font-size:13px; color:var(--text-secondary); margin:0;">The survey submission period is closed. Feedback is only accepted within 3 days after the event has concluded.</p>
          </div>
        `;
      } else {
        const status = state.customFormStatus || { alreadySubmitted: false };
        if (status.alreadySubmitted) {
          customFeedbackPanel = `
            <div class="card event-survey-card" style="padding:24px; text-align:center; border: 1px solid var(--success-soft); background: var(--bg-soft);">
              <i class="fas fa-check-circle" style="color:var(--success); font-size:32px; margin-bottom:12px;"></i>
              <h4 style="margin:0 0 6px 0; color:var(--success);">Feedback Submitted</h4>
              <p style="font-size:13px; color:var(--text-secondary); margin:0;">Thank you! You have already submitted feedback for this event survey.</p>
            </div>
          `;
        } else {
          customFeedbackPanel = `
            <div class="card event-survey-card" style="padding:24px; text-align:center;">
              <h4 style="margin-top:0; margin-bottom:8px;"><i class="fas fa-poll-h" style="color:var(--primary);"></i> Custom Feedback Survey</h4>
              <p style="font-size:13px; color:var(--text-secondary); margin-bottom:16px;">Please take a moment to answer our custom survey and help improve our future events!</p>
              <button class="btn btn-primary" id="takeCustomSurveyBtn" style="width:auto; margin:0 auto; display:inline-flex; align-items:center; gap:8px;">
                <i class="fas fa-file-signature"></i> Take Survey
              </button>
            </div>
          `;
        }
      }
    }

    let html = `
      <div class="page-header" style="display:flex;align-items:center;gap:12px;">
        <button class="btn-icon" id="backToEvents" title="Back"><i class="fas fa-arrow-left"></i></button>
        <div>
          <h1 class="page-title">${escHtml(event.title)}</h1>
          <p class="page-subtitle">Event Details & Feedback</p>
        </div>
        <div style="margin-left:auto; display:flex; gap:8px;">
          ${(state.user.role === 'admin' || state.user.role === 'superadmin' || (state.user.id === event.author_id && !concluded)) ? `
            <button class="btn btn-secondary btn-sm" id="editEventBtn" style="width:auto;"><i class="fas fa-edit"></i> Edit</button>
          ` : ''}
          ${(state.user.role === 'admin' || state.user.role === 'superadmin' || state.user.id === event.author_id) ? `
            <button class="btn btn-danger btn-sm" id="deleteEventBtn" style="width:auto;"><i class="fas fa-trash-alt"></i> Delete</button>
          ` : ''}
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
            ${event.status === 'pending' ? '<div><span class="status-pill status-pending">Pending Approval</span></div>' : ''}
            ${event.status === 'rejected' ? `<div><span class="status-pill status-rejected" title="${escHtml(event.rejection_reason || 'Rejected by admin')}">Rejected</span></div>` : ''}
            ${event.description ? `<p class="event-detail-desc">${escHtml(event.description)}</p>` : ''}
          </div>
        </div>

        ${hasCustomSchema ? `
          <!-- Custom Feedback Survey triggers -->
          <div style="margin-top:20px; display:flex; flex-direction:column; gap:20px;">
            ${customFeedbackPanel}
            ${isAdmin ? `
              <div class="card" style="padding:20px; display:flex; align-items:center; justify-content:space-between; background:var(--bg-soft);">
                <div>
                  <h4 style="margin:0 0 4px 0;"><i class="fas fa-poll" style="color:var(--primary);"></i> Questionnaire Dashboard</h4>
                  <p style="font-size:12px; color:var(--text-secondary); margin:0;">View detailed graphical survey statistics, textual responses, and cached AI evaluation report.</p>
                </div>
                <button class="btn btn-primary" style="width:auto;" onclick="window._showCustomFeedbackResults('${event.id}')">
                  <i class="fas fa-chart-bar"></i> View Survey Results
                </button>
              </div>
            ` : ''}
          </div>
        ` : `
          <!-- DEFAULT STAR FEEDBACK SYSTEM (if no custom schema) -->
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
                ${state.user && (state.user.role === 'admin' || state.user.role === 'superadmin' || state.user.id === event.author_id) && totalFeedback >= 3 ? `
                <button class="btn btn-secondary btn-sm" onclick="window._showFeedbackInsights('${event.id}')" style="margin-left:12px;">
                  <i class="fas fa-brain"></i> AI Insights
                </button>` : ''}
              </div>
            </div>
          </div>

          <!-- Write Feedback -->
          ${(event.is_read_only || String(event.id).startsWith('holiday-') || String(event.id).startsWith('pupsj-')) ? `
            <div class="card feedback-form-card" style="padding:24px; text-align:center; border: 1px solid var(--border); background: var(--bg-soft);">
              <i class="fas fa-info-circle" style="color:var(--text-secondary); font-size:32px; margin-bottom:12px;"></i>
              <h4 style="margin:0 0 6px 0; color:var(--text-secondary);">Read-Only Observance</h4>
              <p style="font-size:13px; color:var(--text-secondary); margin:0;">Reviews are not accepted for public holidays or campus observances.</p>
            </div>
          ` : (
            feedback.some(fb => fb.user_id === state.user.id) ? `
              <div class="card feedback-form-card" style="padding:24px; text-align:center; border: 1px solid var(--success-soft); background: var(--bg-soft);">
                <i class="fas fa-check-circle" style="color:var(--success); font-size:32px; margin-bottom:12px;"></i>
                <h4 style="margin:0 0 6px 0; color:var(--success);">Feedback Submitted</h4>
                <p style="font-size:13px; color:var(--text-secondary); margin:0;">Thank you! You have already submitted a review for this event.</p>
              </div>
            ` : (
              !concluded ? `
                <div class="card feedback-form-card" style="padding:24px; text-align:center;">
                  <h4><i class="fas fa-pen"></i> Write a Review</h4>
                  <p style="font-size:13px; color:var(--text-secondary); margin-bottom:0;">This event is scheduled for the future. You can submit a review once the event has concluded.</p>
                </div>
              ` : (
                (getEventFeedbackTimeLeft(event) > 3 * 24 * 60 * 60 * 1000) ? `
                  <div class="card feedback-form-card" style="padding:24px; text-align:center; border: 1px solid var(--border); background: var(--bg-soft);">
                    <i class="fas fa-lock" style="color:var(--text-secondary); font-size:32px; margin-bottom:12px;"></i>
                    <h4 style="margin:0 0 6px 0;">Feedback Period Closed</h4>
                    <p style="font-size:13px; color:var(--text-secondary); margin:0;">Feedback submission is closed. Reviews are only accepted within 3 days after the event has concluded.</p>
                  </div>
                ` : `
                <div class="card feedback-form-card">
                  <h4><i class="fas fa-pen"></i> Write a Review</h4>
                  <div class="feedback-form">
                    <div class="star-picker" id="starPicker">
                      <span>Your Rating:</span>
                      <div class="star-rating" id="feedbackStars">
                        ${[1,2,3,4,5].map(i => `<i class="far fa-star" data-val="${i}"></i>`).join('')}
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
              `
            )
          )
        )}

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
                  ${(fb.user_id === state.user.id || state.user.role === 'admin' || state.user.role === 'superadmin') ? '<button class="btn-icon" onclick="window._deleteFeedback(\'' + fb.id + '\',\' ' + event.id + '\')" title="Delete feedback" style="margin-left:auto;color:var(--danger);"><i class="fas fa-trash"></i></button>' : ''}
                </div>
                ${fb.comment ? `<p class="feedback-card-text">${escHtml(fb.comment)}</p>` : ''}
                ${fb.images && fb.images.length > 0 && fb.images[0].id ? `
                <div class="feedback-card-images">
                  ${fb.images.map(img => `<img src="${img.image_url}" alt="feedback" onclick="window._openImageViewer('${img.image_url}')">`).join('')}
                </div>` : ''}
              </div>`).join('')}
          </div>
        `}
      </div>`;

    pageArea.innerHTML = html;

    // Wire up events
    document.getElementById('backToEvents').onclick = () => {
      state.selectedEvent = null;
      renderEventsPage();
    };

    const deleteEventBtn = document.getElementById('deleteEventBtn');
    if (deleteEventBtn) deleteEventBtn.onclick = () => window._deleteEvent(event.id);

    const editEventBtn = document.getElementById('editEventBtn');
    if (editEventBtn) editEventBtn.onclick = () => openModal('event', event);

    if (hasCustomSchema) {
      const takeSurveyBtn = document.getElementById('takeCustomSurveyBtn');
      if (takeSurveyBtn) {
        takeSurveyBtn.onclick = () => openModal('feedback-submit', event);
      }
    } else {
      // Star picker (default system)
      const stars = document.querySelectorAll('#feedbackStars i');
      const ratingInput = document.getElementById('feedbackRating');
      stars.forEach(star => {
        star.onclick = () => {
          const val = parseInt(star.dataset.val);
          ratingInput.value = val;
          stars.forEach((s, i) => {
            const active = i < val;
            s.classList.toggle('active', active);
            if (active) {
              s.classList.remove('far');
              s.classList.add('fas');
            } else {
              s.classList.remove('fas');
              s.classList.add('far');
            }
          });
        };
        star.onmouseenter = () => {
          const val = parseInt(star.dataset.val);
          stars.forEach((s, i) => {
            const hover = i < val;
            s.classList.toggle('hover', hover);
            if (hover || i < parseInt(ratingInput.value)) {
              s.classList.remove('far');
              s.classList.add('fas');
            } else {
              s.classList.remove('fas');
              s.classList.add('far');
            }
          });
        };
        star.onmouseleave = () => {
          stars.forEach((s, i) => {
            s.classList.remove('hover');
            const active = i < parseInt(ratingInput.value);
            if (active) {
              s.classList.remove('far');
              s.classList.add('fas');
            } else {
              s.classList.remove('fas');
              s.classList.add('far');
            }
          });
        };
      });

      bindImageUpload('feedbackImages');

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
  }

  window._deleteFeedback = async (feedbackId, eventId) => {
    if (!await window.showSystemConfirm('Delete this feedback?')) return;
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
    return [1,2,3,4,5].map(i => `<i class="${i <= r ? 'fas' : 'far'} fa-star${i <= r ? ' active' : ''}"></i>`).join('');
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

    const hasLFLayout = pageArea.querySelector('.lf-layout-shell');
    if (fromNav || !hasLFLayout) {
      pageArea.innerHTML = `<div class="page-header"><h1 class="page-title">Lost & Found</h1><p class="page-subtitle">Report or find missing items</p></div><div class="page-content"><div class="loader"><div class="spinner"></div></div></div>`;
    } else {
      const itemsContainer = document.getElementById('lfItemsContainer');
      if (itemsContainer) {
        itemsContainer.innerHTML = `<div class="loader" style="padding: 40px 0;"><div class="spinner"></div></div>`;
      }
    }

    try {
      // Student and guest are restricted to lost-only; client also locks to 'lost'
      const isRestrictedRole = state.user.role === 'student' || state.user.role === 'guest';
      let lfQuery = '';
      if (isRestrictedRole) {
        lfQuery = '?type=lost';
      } else if (state.filters.lfType === 'archived') {
        lfQuery = '?status=archived';
      } else if (state.filters.lfType === 'resolved') {
        lfQuery = '?status=resolved&type=found';
      } else if (state.filters.lfType !== 'all') {
        lfQuery = `?type=${state.filters.lfType}`;
      }
      const data = await api(`/api/lost-found${lfQuery}`);
      state.lostFound = data;
      const isLFAdmin = state.user.role === 'admin' || state.user.role === 'superadmin';
      if (isLFAdmin) {
        state.lostFoundReviews = await api('/api/lost-found/matches/all').catch(() => []);
      } else {
        state.lostFoundReviews = [];
      }
      pageLoadedAt.lostfound = Date.now();
      renderLostFoundPage();
    } catch (err) {
      if (fromNav || !hasLFLayout) {
        pageArea.querySelector('.page-content').innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Failed to load</h3></div>`;
      } else {
        const itemsContainer = document.getElementById('lfItemsContainer');
        if (itemsContainer) {
          itemsContainer.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Failed to load</h3></div>`;
        }
      }
    }
  }

  function renderLostFoundPage() {
    const pageArea = document.getElementById('pageArea');
    const isRestrictedRole = state.user.role === 'student' || state.user.role === 'guest';
    const isAdmin = state.user.role === 'admin' || state.user.role === 'superadmin';
    const canPost = true;
    if (!state.activeMatchTab) state.activeMatchTab = 'pending';

    const hasLFLayout = pageArea.querySelector('.lf-layout-shell');

    // Build the matches dashboard content
    let matchDashboardHtml = '';
    if (isAdmin && state.lostFoundReviews.length > 0) {
      matchDashboardHtml = `
        <div class="card lf-review-queue" style="margin-bottom: 24px; padding: 24px; border-radius: 12px; border: 1px solid var(--border); background: var(--bg-card);">
          <div class="lf-review-head" style="margin-bottom: 18px;">
            <h3 style="font-size: 18px; font-weight: 700; color: var(--text-primary); margin-bottom: 6px;"><i class="fas fa-magic" style="color: var(--primary);"></i> AI Matches & Claim Dashboard</h3>
            <p style="font-size: 13px; color: var(--text-secondary); margin: 0;">Review suggested matches, approve verified matches, and track item claims.</p>
          </div>
          
          <div class="lf-match-dashboard-tabs" style="display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 1px solid var(--border); padding-bottom: 10px;">
            <button class="btn btn-sm ${state.activeMatchTab === 'pending' ? 'btn-primary' : 'btn-secondary'}" onclick="window._changeActiveMatchTab('pending')" style="font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 6px;">
              Matched by AI (${state.lostFoundReviews.filter(m => (m.found_item?.match_review_status === 'pending' || m.lost_item?.match_review_status === 'pending') && m.found_item?.status !== 'claimed' && m.lost_item?.status !== 'claimed').length})
            </button>
            <button class="btn btn-sm ${state.activeMatchTab === 'approved' ? 'btn-primary' : 'btn-secondary'}" onclick="window._changeActiveMatchTab('approved')" style="font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 6px;">
              Approved Matches (${state.lostFoundReviews.filter(m => m.found_item?.match_review_status === 'approved' && m.found_item?.status === 'matched').length})
            </button>
            <button class="btn btn-sm ${state.activeMatchTab === 'claimed' ? 'btn-primary' : 'btn-secondary'}" onclick="window._changeActiveMatchTab('claimed')" style="font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 6px;">
              Claimed Items (${state.lostFoundReviews.filter(m => m.found_item?.status === 'claimed' || m.lost_item?.status === 'claimed').length})
            </button>
          </div>

          <div class="lf-review-list" style="display: flex; flex-direction: column; gap: 16px;">
            ${(() => {
              const pendingMatches = state.lostFoundReviews.filter(m => 
                (m.found_item?.match_review_status === 'pending' || m.lost_item?.match_review_status === 'pending') &&
                m.found_item?.status !== 'claimed' && m.lost_item?.status !== 'claimed'
              );

              const approvedMatches = state.lostFoundReviews.filter(m => 
                m.found_item?.match_review_status === 'approved' && 
                m.found_item?.status === 'matched'
              );

              const claimedMatches = state.lostFoundReviews.filter(m => 
                m.found_item?.status === 'claimed' || m.lost_item?.status === 'claimed'
              );

              const currentTabList = state.activeMatchTab === 'pending' ? pendingMatches 
                                    : state.activeMatchTab === 'approved' ? approvedMatches 
                                    : claimedMatches;
                                      
              if (currentTabList.length === 0) {
                return `<div class="empty-state" style="padding: 24px 0; text-align: center; color: var(--text-secondary);">
                  <i class="fas fa-search-location" style="font-size: 24px; margin-bottom: 8px; opacity: 0.5;"></i>
                  <p style="font-size: 13px; margin: 0;">No items found in this category.</p>
                </div>`;
              }
              
              return currentTabList.map(review => {
                const lost = review.lost_item;
                const found = review.found_item;
                const score = review.match_score || 0;
                const normalizedScore = score > 1 ? score / 100 : score;
                const pct = Math.round(normalizedScore * 80);
                
                return `
                  <div class="lf-review-card" style="border: 1px solid var(--border); border-radius: 10px; padding: 20px; background: var(--bg-primary); display: flex; flex-direction: column; gap: 16px; transition: all 0.2s ease;">
                    <!-- Card Header: Match Score / Status -->
                    <div class="lf-review-card-hdr" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed var(--border); padding-bottom: 10px;">
                      <span class="match-score-badge" style="font-size: 12px; font-weight: 700; background: var(--primary-soft); color: var(--primary); padding: 4px 10px; border-radius: 999px; display: flex; align-items: center; gap: 6px;">
                        <i class="fas fa-chart-line"></i> AI Match Score: ${pct}%
                      </span>
                      <span class="lf-status-badge ${state.activeMatchTab}" style="font-size: 11px; font-weight: 700; text-transform: uppercase; padding: 4px 10px; border-radius: 4px; ${
                        state.activeMatchTab === 'pending' ? 'background: #fef3c7; color: #d97706;' 
                        : state.activeMatchTab === 'approved' ? 'background: #dbeafe; color: #2563eb;' 
                        : 'background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe;'
                      }">
                        ${state.activeMatchTab === 'pending' ? 'Pending Review' : state.activeMatchTab === 'approved' ? 'Approved' : 'Claimed'}
                      </span>
                    </div>
                    
                    <!-- Side by Side Columns -->
                    <div class="lf-review-columns" style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
                      <!-- Found Item Column (Left) -->
                      <div class="lf-review-side" style="display: flex; flex-direction: column; gap: 8px;">
                        <div class="lf-review-label" style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--primary);">
                          <i class="fas fa-eye"></i> Found Item Report
                        </div>
                        <h4 style="font-size: 14px; font-weight: 700; color: var(--text-primary); margin: 0;">${escHtml(found.item_name)}</h4>
                        <p style="font-size: 13px; color: var(--text-secondary); line-height: 1.5; margin: 0;">${escHtml(found.description || '')}</p>
                        <div class="lf-card-meta" style="display: flex; flex-wrap: wrap; gap: 10px; font-size: 12px; color: var(--text-muted);">
                          ${found.category ? `<span><i class="fas fa-tag"></i> ${escHtml(found.category)}</span>` : ''}
                          ${found.location_found ? `<span><i class="fas fa-map-marker-alt"></i> ${escHtml(found.location_found)}</span>` : ''}
                          ${found.reporter_name ? `<span><i class="fas fa-user-tie"></i> Reporter: ${escHtml(found.reporter_name)}</span>` : ''}
                        </div>
                        ${found.images && found.images.length > 0 && found.images[0].id ? `
                          <div class="lf-card-images" style="display: flex; gap: 6px; margin-top: 6px; overflow-x: auto; padding-bottom: 4px;">
                            ${found.images.map(img => `<img src="${img.image_url}" alt="found item" onclick="window._openImageViewer('${img.image_url}')" style="width: 50px; height: 50px; object-fit: cover; border-radius: 6px; cursor: pointer; border: 1px solid var(--border);">`).join('')}
                          </div>` : ''}
                      </div>
                      
                      <!-- Lost Item Column (Right) -->
                      <div class="lf-review-side" style="display: flex; flex-direction: column; gap: 8px; border-left: 1px dashed var(--border); padding-left: 20px;">
                        <div class="lf-review-label" style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--primary);">
                          <i class="fas fa-search"></i> Matched Lost Report
                        </div>
                        <h4 style="font-size: 14px; font-weight: 700; color: var(--text-primary); margin: 0;">${escHtml(lost.item_name)}</h4>
                        <p style="font-size: 13px; color: var(--text-secondary); line-height: 1.5; margin: 0;">${escHtml(lost.description || '')}</p>
                        <div class="lf-card-meta" style="display: flex; flex-wrap: wrap; gap: 10px; font-size: 12px; color: var(--text-muted);">
                          ${lost.category ? `<span><i class="fas fa-tag"></i> ${escHtml(lost.category)}</span>` : ''}
                          ${lost.location_found ? `<span><i class="fas fa-map-marker-alt"></i> ${escHtml(lost.location_found)}</span>` : ''}
                          ${lost.reporter_name ? `<span><i class="fas fa-user"></i> Poster: ${escHtml(lost.reporter_name)}</span>` : ''}
                        </div>
                        ${lost.images && lost.images.length > 0 && lost.images[0].id ? `
                          <div class="lf-card-images" style="display: flex; gap: 6px; margin-top: 6px; overflow-x: auto; padding-bottom: 4px;">
                            ${lost.images.map(img => `<img src="${img.image_url}" alt="lost item" onclick="window._openImageViewer('${img.image_url}')" style="width: 50px; height: 50px; object-fit: cover; border-radius: 6px; cursor: pointer; border: 1px solid var(--border);">`).join('')}
                          </div>` : ''}
                      </div>
                    </div>
                    
                    <!-- Action Buttons -->
                    <div class="lf-review-actions" style="display: flex; justify-content: flex-end; align-items: center; gap: 10px; border-top: 1px solid var(--border); padding-top: 12px;">
                      ${state.activeMatchTab === 'pending' ? `
                        <button class="btn btn-success btn-sm" onclick="window._decideLostFoundReview('${found.id}','approve','${lost.id}')" style="font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 6px;"><i class="fas fa-check"></i> Approve Match</button>
                        <button class="btn btn-danger btn-sm" onclick="window._decideLostFoundReview('${found.id}','reject','${lost.id}')" style="font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 6px;"><i class="fas fa-times"></i> Reject Match</button>
                      ` : state.activeMatchTab === 'approved' ? `
                        <button class="btn btn-success btn-sm" onclick="window._claimLostFoundMatch('${lost.id}','${found.id}')" style="font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 6px; background: #166534 !important; border-color: #166534 !important;"><i class="fas fa-hand-holding-heart"></i> Claimed</button>
                      ` : `
                        <span style="font-size: 13px; color: #166534; font-weight: 600; display: flex; align-items: center; gap: 6px; margin-right: auto;"><i class="fas fa-check-circle"></i> Handed over and resolved</span>
                        <button class="btn btn-secondary btn-sm" onclick="window._unclaimLostFoundMatch('${lost.id}','${found.id}')" style="font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 6px;"><i class="fas fa-undo"></i> Unclaim</button>
                      `}
                    </div>
                  </div>
                `;
              }).join('');
            })()}
          </div>
        </div>
      `;
    }

    // Build the items list content
    let itemsHtml = '';
    if (state.lostFound.length === 0) {
      itemsHtml = `
        <div class="empty-state">
          <i class="fas fa-box-open"></i>
          <h3>${state.filters.lfType === 'resolved' ? 'No resolved cases yet' : 'No items reported'}</h3>
          <p>${canPost ? 'Report a lost or found item using the + button.' : 'Check back later.'}</p>
        </div>`;
    } else {
      itemsHtml = `
        <div class="lf-items-list">
          ${state.lostFound.map(item => {
            const isResolved = item.status === 'resolved' || item.status === 'claimed';
            const canManage = item.reporter_id === state.user.id || state.user.role === 'admin' || state.user.role === 'superadmin';
            const canResolve = (state.user.role === 'admin' || state.user.role === 'superadmin') && !isResolved && item.type === 'found';
            const showPendingHintAdmin = isAdmin && item.match_review_status === 'pending';
            const showPendingHintUser = !isAdmin && item.reporter_id === state.user.id && item.match_review_status === 'pending';
            const showApprovedHint = item.match_review_status === 'approved' || item.status === 'matched';
            
            let statusBadge = '';
            if (item.status === 'resolved') {
              statusBadge = '<span class="lf-resolved-badge"><i class="fas fa-check-circle"></i> Resolved</span>';
            } else if (item.status === 'claimed') {
              statusBadge = '<span class="lf-claimed-badge"><i class="fas fa-hand-holding-heart"></i> Claimed</span>';
            } else if (item.status === 'deleted') {
              statusBadge = '<span class="lf-deleted-badge" style="background-color:#dc2626; color:white; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:bold; display:inline-flex; align-items:center; gap:4px; text-transform:uppercase;"><i class="fas fa-trash-alt"></i> Deleted</span>';
            }

            return `
            <div class="card lf-card${isResolved ? ' lf-card--resolved' : ''}">
              <div class="lf-card-header">
                <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start;">
                  <span class="lf-type-badge ${item.type}">${item.type}</span>
                  ${statusBadge}
                </div>
                <div style="flex:1">
                  <h4 style="${isResolved ? 'text-decoration:line-through;opacity:0.6;' : ''}">${escHtml(item.item_name)}</h4>
                  <p>${escHtml(item.description)}</p>
                  <div class="lf-card-meta">
                    ${item.category ? `<span><i class="fas fa-tag"></i> ${escHtml(item.category)}</span>` : ''}
                    ${item.location_found ? `<span><i class="fas fa-map-marker-alt"></i> ${escHtml(item.location_found)}</span>` : ''}
                    <span><i class="fas fa-calendar"></i> ${item.date_lost_found ? new Date(item.date_lost_found).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'}) : 'Unknown Date'}</span>
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
              ${state.filters.lfType === 'pending-guest' ? `
                <div class="lf-card-actions" style="margin-top: 12px; display: flex; gap: 8px; justify-content: flex-end;">
                  <button class="btn btn-success btn-sm" onclick="window._approveGuestReport('${item.id}')"><i class="fas fa-check"></i> Approve</button>
                  <button class="btn btn-danger btn-sm" onclick="window._deleteLostFound('${item.id}')"><i class="fas fa-times"></i> Reject</button>
                </div>
              ` : (canManage ? `
                <div class="lf-card-actions">
                  ${canResolve ? `<button class="btn btn-success btn-sm" onclick="window._resolveLostFound('${item.id}')"><i class="fas fa-check-circle"></i> Mark Resolved</button>` : ''}
                  ${!isResolved ? `<button class="btn btn-secondary btn-sm" onclick="window._editLostFound('${item.id}')"><i class="fas fa-edit"></i> Edit</button>` : ''}
                  <button class="btn btn-danger btn-sm" onclick="window._deleteLostFound('${item.id}')"><i class="fas fa-trash-alt"></i> Delete</button>
                </div>` : '')}
            </div>`;
          }).join('')}
        </div>`;
    }

    if (hasLFLayout) {
      const dashboardContainer = document.getElementById('lfMatchDashboardContainer');
      const itemsContainer = document.getElementById('lfItemsContainer');
      const tabs = pageArea.querySelector('.lf-tabs');

      if (dashboardContainer) {
        dashboardContainer.innerHTML = matchDashboardHtml;
      }
      if (itemsContainer) {
        itemsContainer.innerHTML = itemsHtml;
      }

      if (tabs) {
        tabs.querySelectorAll('.lf-tab').forEach(el => {
          if (el.dataset.type === state.filters.lfType) {
            el.classList.add('active');
          } else {
            el.classList.remove('active');
          }
        });
      }
    } else {
      let html = `
        <div class="lf-layout-shell">
          <div class="page-header">
            <h1 class="page-title">Lost & Found</h1>
            <p class="page-subtitle">${isAdmin ? 'Manage lost & found reports' : 'Browse lost-item reports and submit your own report'}</p>
          </div>
          <div class="page-content">
            <div id="lfMatchDashboardContainer">${matchDashboardHtml}</div>
            <div class="lf-tabs">
              ${isRestrictedRole ? `
                <button class="lf-tab active" data-type="lost">Lost Items</button>
              ` : `
                <button class="lf-tab ${state.filters.lfType === 'all' ? 'active' : ''}" data-type="all">All</button>
                <button class="lf-tab ${state.filters.lfType === 'lost' ? 'active' : ''}" data-type="lost">Lost</button>
                <button class="lf-tab ${state.filters.lfType === 'found' ? 'active' : ''}" data-type="found">Found</button>
                <button class="lf-tab ${state.filters.lfType === 'resolved' ? 'active' : ''}" data-type="resolved">Resolved</button>
                ${isAdmin ? `
                  <button class="lf-tab ${state.filters.lfType === 'archived' ? 'active' : ''}" data-type="archived">Archived</button>
                ` : ''}
                <button class="lf-tab ${state.filters.lfType === 'pending-guest' ? 'active' : ''}" data-type="pending-guest">Pending Guest Reports</button>
              `}
            </div>
            <div id="lfItemsContainer">${itemsHtml}</div>
          </div>
          ${canPost ? '<button class="fab" id="fabLF" title="Report Item"><i class="fas fa-plus"></i></button>' : ''}
        </div>
      `;

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
  }



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
    if (!await window.showSystemConfirm('Delete this item?')) return;
    try {
      await api(`/api/lost-found/${id}`, { method: 'DELETE' });
      showToast('Item deleted', 'success');
      loadLostFound();
    } catch (err) { showToast(err.message || 'Delete failed', 'error'); }
  };

  window._approveGuestReport = async (id) => {
    if (!await window.showSystemConfirm('Approve this guest report and make it live?')) return;
    try {
      await api(`/api/lost-found/${id}/approve-guest`, { method: 'PATCH' });
      showToast('Guest report approved and is now live!', 'success');
      loadLostFound();
    } catch (err) { showToast(err.message || 'Approval failed', 'error'); }
  };

  window._decideLostFoundReview = (id, decision, lostId) => {
    const actionLabel = decision === 'approve' ? 'approve' : 'reject';
    openModal('custom-confirm', {
      title: decision === 'approve' ? 'Approve AI Match' : 'Reject AI Match',
      message: `Are you sure you want to ${actionLabel} this AI match suggestion?`,
      submessage: decision === 'approve' 
        ? 'Approving this match will mark the items as matched and notify the lost item poster that their item is ready at OSAS.'
        : 'Rejecting this match will separate these items and return them to the open pool.',
      icon: decision === 'approve' ? 'fa-check-circle' : 'fa-times-circle',
      yesLabel: decision === 'approve' ? 'Yes, Approve Match' : 'Yes, Reject Match',
      onConfirm: async () => {
        try {
          const res = await api(`/api/lost-found/review/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ decision, lostId }),
          });
          showToast(res.message || 'Review updated', 'success');
          loadLostFound();
        } catch (err) {
          showToast(err.message || 'Failed to update match review', 'error');
        }
      }
    });
  };

  window._claimLostFoundMatch = (lostId, foundId) => {
    openModal('custom-confirm', {
      title: 'Confirm Claim Handover',
      message: 'Mark this matched pair as Claimed?',
      submessage: 'This confirms that the lost item has been physically handed over to its rightful owner.',
      icon: 'fa-hand-holding-heart',
      yesLabel: 'Yes, Mark Claimed',
      onConfirm: async () => {
        try {
          const res = await api('/api/lost-found/match/claim', {
            method: 'POST',
            body: JSON.stringify({ lostId, foundId }),
          });
          showToast(res.message || 'Items marked as Claimed', 'success');
          loadLostFound();
        } catch (err) {
          showToast(err.message || 'Claim failed', 'error');
        }
      }
    });
  };

  window._unclaimLostFoundMatch = (lostId, foundId) => {
    openModal('custom-confirm', {
      title: 'Revert Claim Status',
      message: 'Unclaim these matched items?',
      submessage: 'This will change their status from Claimed back to Matched/Approved.',
      icon: 'fa-undo',
      yesLabel: 'Yes, Unclaim',
      onConfirm: async () => {
        try {
          const res = await api('/api/lost-found/match/unclaim', {
            method: 'POST',
            body: JSON.stringify({ lostId, foundId }),
          });
          showToast(res.message || 'Items unmarked as claimed', 'success');
          loadLostFound();
        } catch (err) {
          showToast(err.message || 'Unclaim failed', 'error');
        }
      }
    });
  };


  window._changeActiveMatchTab = (tab) => {
    state.activeMatchTab = tab;
    renderLostFoundPage();
  };

  // ════════════════════════════════
  //  SECTION SCHEDULES DIRECTORY
  // ════════════════════════════════
  // Notifications
  function getNotificationMeta(type) {
    switch (type) {
      case 'announcement':
        return { icon: 'bullhorn', className: 'announcement', label: 'Announcement' };
      case 'event':
        return { icon: 'calendar-alt', className: 'event', label: 'Event' };
      case 'feedback':
        return { icon: 'star', className: 'feedback', label: 'Feedback' };
      case 'lostfound':
        return { icon: 'search-location', className: 'lostfound', label: 'Lost & Found' };
      default:
        return { icon: 'bell', className: 'general', label: 'General' };
    }
  }

  async function markNotificationRead(id) {
    const existing = state.notifications.find((notification) => notification.id === id);
    if (existing?.is_read) return existing;

    const data = await api(`/api/notifications/${id}/read`, { method: 'PATCH' });
    const updated = data.notification || { ...existing, is_read: true };

    state.notifications = state.notifications.map((notification) =>
      notification.id === id ? { ...notification, ...updated, is_read: true } : notification
    );
    if (existing && !existing.is_read) {
      state.notificationsUnread = Math.max(0, state.notificationsUnread - 1);
      updateNotificationIndicators();
    }
    pageLoadedAt.notifications = Date.now();
    return updated;
  }

  function openNotificationLink(link) {
    if (!link || typeof link !== 'string') return;
    if (link.startsWith('page:profile:')) {
      const pageId = link.replace('page:profile:', '');
      openPageProfile(pageId);
    } else if (link.startsWith('page:request:')) {
      state.annViewMode = 'pages';
      navigateTo('announcements');
    } else if (link === 'page:admin-dashboard') {
      state.annViewMode = 'pages';
      navigateTo('announcements');
    } else if (link.startsWith('page:')) {
      navigateTo(link.slice(5));
    }
  }

  async function openNotification(notificationId) {
    const notification = state.notifications.find((item) => item.id === notificationId);
    if (!notification) return;

    try {
      if (!notification.is_read) {
        await markNotificationRead(notificationId);
      }
      openNotificationLink(notification.link);
    } catch (err) {
      showToast(err.message || 'Failed to open notification', 'error');
    }
  }

  async function loadNotifications(fromNav = false) {
    const pageArea = document.getElementById('pageArea');

    if (
      fromNav &&
      state.notifications.length > 0 &&
      pageLoadedAt.notifications &&
      Date.now() - pageLoadedAt.notifications < NOTIFICATIONS_CACHE_TTL
    ) {
      renderNotificationsPage();
      requestAnimationFrame(() => { pageArea.scrollTop = pageScrollCache.notifications || 0; });
      return;
    }

    pageArea.innerHTML = `<div class="page-header"><h1 class="page-title">Notifications</h1><p class="page-subtitle">Stay updated on approvals, events, feedback, and AI matches</p></div><div class="page-content"><div class="loader"><div class="spinner"></div></div></div>`;

    try {
      const data = await api('/api/notifications?limit=50');
      state.notifications = data.notifications || [];
      state.notificationsUnread = Number(data.unread_count) || 0;
      pageLoadedAt.notifications = Date.now();
      updateNotificationIndicators();
      renderNotificationsPage();
    } catch (err) {
      pageArea.querySelector('.page-content').innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Failed to load notifications</h3><p>${escHtml(err.message || 'Please try again.')}</p></div>`;
    }
  }

  function renderNotificationsPage() {
    const pageArea = document.getElementById('pageArea');
    const unreadCount = Number(state.notificationsUnread) || 0;

    pageArea.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Notifications</h1>
        <p class="page-subtitle">Activity from announcements, events, feedback, and lost & found</p>
      </div>
      <div class="page-content">
        <div class="notifications-toolbar">
          <div class="notifications-toolbar-copy">
            <span class="notifications-count">${unreadCount} unread</span>
            <span class="notifications-total">${state.notifications.length} recent notification${state.notifications.length !== 1 ? 's' : ''}</span>
          </div>
          <button class="btn btn-secondary btn-sm" id="markAllNotificationsRead" ${unreadCount === 0 ? 'disabled' : ''}>
            <i class="fas fa-check-double"></i> Mark all as read
          </button>
        </div>
        ${state.notifications.length === 0 ? `
          <div class="empty-state">
            <i class="fas fa-bell-slash"></i>
            <h3>No notifications yet</h3>
            <p>New updates will appear here when something important happens.</p>
          </div>
        ` : `
          <div class="notifications-list">
            ${state.notifications.map((notification) => {
              const meta = getNotificationMeta(notification.type);
              return `
                <div class="card notification-card${notification.is_read ? '' : ' unread'}" data-notification-id="${notification.id}">
                  <div class="notification-icon ${meta.className}">
                    <i class="fas fa-${meta.icon}"></i>
                  </div>
                  <div class="notification-body">
                    <div class="notification-topline">
                      <span class="notification-type">${meta.label}</span>
                      <span class="notification-time">${timeAgo(notification.created_at)}</span>
                    </div>
                    <h3 class="notification-title">${escHtml(notification.title)}</h3>
                    ${notification.message ? `<p class="notification-message">${escHtml(notification.message)}</p>` : ''}
                    <div class="notification-actions-row">
                      ${notification.link ? '<span class="notification-link">Open related page</span>' : '<span class="notification-link muted">No linked page</span>'}
                      ${notification.is_read ? '<span class="notification-status">Read</span>' : '<span class="notification-status unread">Unread</span>'}
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>`;

    const markAllBtn = document.getElementById('markAllNotificationsRead');
    if (markAllBtn) {
      markAllBtn.onclick = async () => {
        try {
          const data = await api('/api/notifications/read-all', { method: 'PATCH' });
          state.notifications = state.notifications.map((notification) => ({ ...notification, is_read: true }));
          state.notificationsUnread = 0;
          pageLoadedAt.notifications = Date.now();
          updateNotificationIndicators();
          renderNotificationsPage();
          showToast(data.message || 'Notifications updated', 'success');
        } catch (err) {
          showToast(err.message || 'Failed to update notifications', 'error');
        }
      };
    }

    document.querySelectorAll('[data-notification-id]').forEach((card) => {
      card.onclick = () => openNotification(card.dataset.notificationId);
    });
  }

  // Section schedules directory
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

      // Fetch sheet rows in parallel for all active section schedules
      const activeSchedules = state.sectionSchedules.filter(s => s.is_active !== false && s.embed_url);
      await Promise.all(activeSchedules.map(async s => {
        try {
          const res = await api(`/api/schedules/fetch-sheet?url=${encodeURIComponent(s.embed_url)}`);
          s.rows = res.rows || [];
          s.error = null;
        } catch (err) {
          s.rows = null;
          s.error = err.message || 'Failed to fetch sheet';
        }
      }));

      renderSectionSchedulesPage();
    } catch (err) {
      pageArea.querySelector('.page-content').innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Failed to load</h3><p>${escHtml(err.message)}</p></div>`;
    }
  }

  function renderSectionSchedulesPage() {
    const pageArea = document.getElementById('pageArea');
    const isStudent = state.user.role === 'student';
    const canPost   = state.user.role === 'admin' || state.user.role === 'superadmin';

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
            <div class="sched-student-card" style="padding: 24px; border-radius: 12px; margin-bottom: 24px; border: 1px solid var(--border); background: var(--bg-card); display: flex; flex-direction: column; gap: 16px; box-shadow: var(--shadow-sm);">
              <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed var(--border); padding-bottom: 12px; flex-wrap: wrap; gap: 12px;">
                <div style="display: flex; align-items: center; gap: 12px;">
                  <div class="sched-student-card-icon" style="width: 40px; height: 40px; border-radius: 8px; background: var(--primary-soft); color: var(--primary); display: flex; align-items: center; justify-content: center; font-size: 18px;"><i class="fas fa-calendar-alt"></i></div>
                  <div class="sched-student-card-body">
                    <div class="sched-student-card-title" style="font-size: 16px; font-weight: 700; color: var(--text-primary);">${escHtml(s.title || 'Class Schedule')}</div>
                    <div class="sched-student-card-meta" style="display: flex; gap: 10px; font-size: 12px; color: var(--text-secondary); margin-top: 4px;">
                      <span><i class="fas fa-building"></i> ${escHtml(s.department)}</span>
                      <span><i class="fas fa-layer-group"></i> ${escHtml(s.year_level)} Year</span>
                      <span><i class="fas fa-users"></i> Section ${escHtml(s.section)}</span>
                    </div>
                  </div>
                </div>
                <div style="display: flex; align-items: center; gap: 12px; margin-left: auto;">
                  <div class="sched-student-card-by" style="font-size: 12px; color: var(--text-secondary); text-align: right;">
                    <span style="display: block; font-weight: 600; opacity: 0.8;">Posted by</span>
                    <span style="font-weight: 700; color: var(--text-primary);">${escHtml(s.posted_by_name || 'Faculty')}</span>
                  </div>
                  ${s.embed_url ? `
                    <a href="${escHtml(s.embed_url)}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="padding: 6px 12px; font-size: 12px; font-weight: 600; border-radius: 6px; display: inline-flex; align-items: center; gap: 6px; background: var(--bg-card); border: 1px solid var(--border); color: var(--text-primary);">
                      <i class="fas fa-external-link-alt"></i> Open Sheet
                    </a>
                  ` : ''}
                </div>
              </div>
              ${window._buildFlexibleScheduleTableHtml(s.rows, s.error, s.embed_url, s.title, true)}
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
    let items = state.sectionSchedules.filter(s => s.target_type !== 'faculty');

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
    const DEPT_COLORS = ['#880808','#1565c0','#2e7d32','#6a1b9a','#e65100','#00695c','#ad1457','#4527a0'];
    const deptColorMap = {};
    allDepts.forEach((d, i) => { deptColorMap[d] = DEPT_COLORS[i % DEPT_COLORS.length]; });

    const deptHtml = Object.entries(grouped).map(([dept, years]) => {
      const deptColor = deptColorMap[dept] || '#880808';
      const deptTotal = Object.values(years).reduce((acc, secs) => acc + Object.values(secs).flat().length, 0);
      const yearsHtml = Object.keys(years).sort().map(yr => {
        const sections = years[yr];
        const yearTotal = Object.values(sections).flat().length;
        const secHtml = Object.keys(sections).sort().map(sec => {
          const list = sections[sec];
          const rowHtml = list.map(s => `
            <div class="sched-row ${s.is_active ? '' : 'sched-row-inactive'}" style="display:flex; flex-direction:column; gap:16px; padding:20px; border:1px solid var(--border); border-radius:10px; background:var(--bg-card); margin-bottom:16px; height:auto; max-height:none; box-shadow: var(--shadow-sm);">
              <div style="display:flex; justify-content:space-between; align-items:center; width:100%; border-bottom: 1px dashed var(--border); padding-bottom: 10px;">
                <div style="display:flex; align-items:center; gap:10px;">
                  <div class="sched-row-icon-wrap" style="width: 36px; height: 36px; border-radius: 6px; background: var(--primary-soft); color: var(--primary); display: flex; align-items: center; justify-content: center; font-size: 16px;"><i class="fas fa-calendar-alt sched-row-icon"></i></div>
                  <div class="sched-row-body">
                    <span class="sched-row-title" style="font-size: 15px; font-weight:700; color:var(--text-primary); display: block;">${escHtml(s.title || 'CLASS SCHEDULE [' + s.section + ']')}</span>
                    <span class="sched-row-by" style="font-size:12px; color:var(--text-secondary);">by ${escHtml(s.posted_by_name || 'Unknown')}</span>
                  </div>
                </div>
                <div class="sched-row-actions" style="display:flex; align-items: center; gap:8px;">
                  ${s.embed_url ? `
                    <a href="${escHtml(s.embed_url)}" target="_blank" rel="noopener" class="btn btn-secondary btn-xs" style="padding:5px 10px; font-size:11px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; border-radius: 5px; background: var(--bg-card); border: 1px solid var(--border); color: var(--text-primary);">
                      <i class="fas fa-external-link-alt"></i> Open Sheet
                    </a>
                  ` : ''}
                  ${canPost ? `
                    <button class="sched-row-btn sched-row-toggle btn btn-xs btn-secondary" onclick="window._toggleSectionSchedule('${s.id}')" title="${s.is_active ? 'Deactivate' : 'Activate'}" style="padding: 5px 8px; border-radius: 5px;">
                      <i class="fas fa-${s.is_active ? 'eye' : 'eye-slash'}"></i>
                    </button>
                    <button class="sched-row-btn sched-row-del btn btn-xs btn-danger" onclick="window._deleteSectionSchedule('${s.id}')" title="Delete" style="padding: 5px 8px; border-radius: 5px;">
                      <i class="fas fa-trash"></i>
                    </button>
                  ` : ''}
                </div>
              </div>
              ${s.is_active ? window._buildFlexibleScheduleTableHtml(s.rows, s.error, s.embed_url, s.title, true) : ''}
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

    const emptyState = `<div class="empty-state"><i class="fas fa-calendar-alt"></i><h3>No schedules found</h3><p>${canPost ? 'Post a schedule using the button above to get started.' : 'No schedules have been posted yet. Check back later.'}</p></div>`;

    pageArea.innerHTML = `
      <div class="page-header"><h1 class="page-title">Class Schedules</h1><p class="page-subtitle">${canPost ? 'Manage posted schedules by section' : 'Browse posted schedules by section'}</p></div>
      <div class="page-content">
        ${canPost ? `<button class="sched-post-btn" id="schedPostBtn"><i class="fas fa-plus"></i> Post Schedule</button>` : ''}
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
    const postBtn = document.getElementById('schedPostBtn');
    if (postBtn) postBtn.onclick = () => openModal('section-schedule');

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
    if (!await window.showSystemConfirm('Delete this schedule?')) return;
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
    return state.user.role === 'faculty' || state.user.role === 'admin' || state.user.role === 'superadmin';
  }
  function schedulePageTitle() {
    if (state.user.role === 'admin' || state.user.role === 'superadmin') return 'Class Schedules';
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
    content.innerHTML = `<div style="display:flex;flex-direction:column;gap:16px;">
      ${results.map(({ em, rows, error }) => `
        <details class="sched-embed-details-group" style="border:1px solid var(--border); border-radius:10px; background:var(--bg-card); box-shadow: var(--shadow-sm); overflow: hidden; display: block;">
          <summary class="sched-embed-details-summary" style="display:flex; justify-content:space-between; align-items:center; width:100%; padding:16px 20px; cursor:pointer; list-style:none; outline:none; user-select:none;" onclick="const target = event.target; if(target.closest('a') || target.closest('button')) event.stopPropagation();">
            <div class="sched-embed-info" style="display:flex; flex-direction:column; align-items:flex-start; gap:4px;">
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <i class="fas fa-chevron-right sched-arrow" style="font-size:12px; color:var(--text-light); transition: transform 0.2s;"></i>
                <i class="fas fa-link" style="color: var(--primary);"></i>
                <span style="font-weight:700; font-size:14px; color:var(--text-primary);">${escHtml(em.title || 'Class Schedule')}</span>
                <span style="background:var(--primary); color:white; font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; text-transform:uppercase; margin-left:4px;">Section Schedule</span>
              </div>
              <div style="display:flex; gap:10px; font-size:11px; color:var(--text-secondary); margin-left:38px; opacity:0.85; flex-wrap:wrap; align-items:center; margin-top:4px;">
                ${em.department ? `<span><i class="fas fa-graduation-cap"></i> ${escHtml(em.department)}</span>` : ''}
                ${em.year_level ? `<span><i class="fas fa-layer-group"></i> ${escHtml(em.year_level)} Year</span>` : ''}
                ${em.section ? `<span><i class="fas fa-users"></i> Section ${escHtml(em.section)}</span>` : ''}
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:10px;" onclick="event.stopPropagation();">
              ${em.embed_url ? `<a href="${escHtml(em.embed_url)}" target="_blank" rel="noopener" class="btn btn-secondary btn-xs" style="padding:5px 10px; font-size:11px; font-weight:600; display:inline-flex; align-items:center; gap:4px; border-radius:5px; background:var(--bg-card); border:1px solid var(--border); color:var(--text-primary);"><i class="fas fa-external-link-alt"></i> Open Sheet</a>` : ''}
            </div>
          </summary>
          <div class="sched-embed-details-body" style="padding:20px; border-top:1px dashed var(--border); display:flex; flex-direction:column; gap:16px;">
            ${window._buildFlexibleScheduleTableHtml(rows, error, em.embed_url, em.title || 'Class Schedule')}
          </div>
        </details>`).join('')}
    </div>`;
  }

  // ── FACULTY / ADMIN: manage embed links ──────────────────
  async function _loadScheduleManagement() {
    const params = new URLSearchParams();
    if (state.scheduleFilterDept && state.scheduleFilterDept !== 'All') params.set('department', state.scheduleFilterDept);
    if (state.scheduleFilterYear)    params.set('year_level', state.scheduleFilterYear);
    if (state.scheduleFilterSection) params.set('section',    state.scheduleFilterSection);
    
    const pageArea = document.getElementById('pageArea');
    const contentArea = pageArea.querySelector('.page-content');
    if (contentArea) {
      contentArea.innerHTML = `<div class="loader"><div class="spinner"></div></div>`;
    }

    const data = await api(`/api/schedules/embeds?${params}`);
    const embeds = Array.isArray(data) ? data : (data.embeds || []);

    // Fetch sheet rows in parallel for all embeds
    await Promise.all(embeds.map(async em => {
      if (em.embed_url) {
        try {
          const res = await api(`/api/schedules/fetch-sheet?url=${encodeURIComponent(em.embed_url)}`);
          em.rows = res.rows || [];
          em.error = null;
        } catch (err) {
          em.rows = null;
          em.error = err.message || 'Failed to fetch sheet';
        }
      }
    }));

    renderScheduleManagement(embeds);
  }

  function renderScheduleManagement(embeds) {
    const pageArea = document.getElementById('pageArea');
    const isAdmin = state.user.role === 'admin' || state.user.role === 'superadmin';
    const canManageSchedules = isAdmin; // only admin/superadmin can post/edit/delete schedules
    const yearLevelOpts = ['1st','2nd','3rd','4th'];
    const sectionOpts   = ['1-1','1-2','1-3','2-1','2-2','2-3','3-1','3-2','3-3','4-1','4-2','4-3'];

    // Separate section-based schedules and faculty-based schedules
    const sectionEmbeds = embeds.filter(em => em.target_type !== 'faculty');
    const facultyEmbeds = embeds.filter(em => em.target_type === 'faculty');

    // Group student section schedules by dept → year → section
    const grouped = {};
    sectionEmbeds.forEach(em => {
      const dept = em.department || '—';
      const yr   = em.year_level || '—';
      const sec  = em.section    || '—';
      if (!grouped[dept]) grouped[dept] = {};
      if (!grouped[dept][yr]) grouped[dept][yr] = {};
      if (!grouped[dept][yr][sec]) grouped[dept][yr][sec] = [];
      grouped[dept][yr][sec].push(em);
    });

    pageArea.innerHTML = `
      <div class="page-header" style="display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap;">
        <div>
          <h1 class="page-title">${schedulePageTitle()}</h1>
          <p class="page-subtitle">${isAdmin ? 'Overview of all posted schedules.' : 'Your assigned section schedules (view only).'}</p>
        </div>
        ${canManageSchedules ? `<button class="btn btn-primary" id="schedAddBtn" style="background: #880808; border: none; color: #fff; border-radius: 9999px; padding: 10px 20px; display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; cursor: pointer; transition: all 0.2s; box-shadow: 0 2px 8px rgba(136,8,8,0.25);"><i class="fas fa-plus"></i> Post Schedule</button>` : ''}
      </div>
      <div class="page-content">

        <!-- Toolbar -->
        <div class="schedule-mgmt-toolbar">
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
            ? `<div class="empty-state"><i class="fas fa-calendar-times"></i><h3>No schedules posted yet</h3><p>Wait for your schedule to be posted.</p></div>`
            : isAdmin
              // ── Admin: Collapsible grids for Section schedules & Faculty schedules ──
              ? `
                <!-- 1. Faculty Teaching Schedules Collapsible Tree (ON TOP) -->
                ${facultyEmbeds.length === 0 ? '' : `
                  <details class="sched-dept-group" open style="margin-bottom: 24px;">
                    <summary class="sched-dept-header" style="cursor: pointer; list-style: none;">
                      <span class="sched-dept-name"><i class="fas fa-chalkboard-teacher"></i> Faculty Teaching Schedules</span>
                      <span class="sched-dept-count">${facultyEmbeds.length}</span>
                    </summary>
                    <div class="sched-dept-body" style="padding:20px; display:flex; flex-direction:column; gap:16px;">
                      ${facultyEmbeds.map(em => `
                        <details class="sched-embed-details-group" style="border:1px solid var(--border); border-radius:10px; background:var(--bg-card); box-shadow: var(--shadow-sm); margin-bottom: 12px; overflow: hidden; display: block;">
                          <summary class="sched-embed-details-summary" style="display:flex; justify-content:space-between; align-items:center; width:100%; padding:16px 20px; cursor:pointer; list-style:none; outline:none; user-select:none;" onclick="const target = event.target; if(target.closest('a') || target.closest('button')) event.stopPropagation();">
                            <div class="sched-embed-info" style="display:flex; flex-direction:column; align-items:flex-start; gap:4px;">
                              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                <i class="fas fa-chevron-right sched-arrow" style="font-size:12px; color:var(--text-light); transition: transform 0.2s;"></i>
                                <i class="fas fa-link" style="color: var(--primary);"></i>
                                <span class="sched-embed-title" style="font-weight:700; font-size:14px; color:var(--text-primary);">${escHtml(em.title || 'Untitled Schedule')}</span>
                                <span class="status-pill status-active" style="background:var(--primary); color:white; font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; text-transform:uppercase; margin-left:8px;">Faculty Schedule</span>
                              </div>
                              <div class="sched-embed-meta-badges" style="display:flex; gap:10px; font-size:11px; color:var(--text-secondary); margin-left:38px; opacity:0.85; flex-wrap:wrap; align-items:center; margin-top:4px;">
                                <span style="font-weight: 600; color: var(--primary); display: inline-flex; align-items: center; gap: 4px; background: rgba(136,8,8,0.06); padding: 3px 8px; border-radius: 4px;">
                                  <i class="fas fa-user-tie"></i> Faculty: ${escHtml(em.faculty_name || 'Unassigned')}
                                </span>
                                <span><i class="fas fa-building"></i> Dept: ${escHtml(em.department || 'General')}</span>
                              </div>
                            </div>
                            <div style="display:flex; align-items:center; gap:10px;" onclick="event.stopPropagation();">
                              <span class="sched-embed-by" style="font-size:12px; color:var(--text-secondary);">by ${escHtml(em.posted_by_name || 'Faculty')}</span>
                              ${em.embed_url ? `
                                <a href="${escHtml(em.embed_url)}" target="_blank" rel="noopener" class="btn btn-secondary btn-xs" style="padding:5px 10px; font-size:11px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; border-radius: 5px; background: var(--bg-card); border: 1px solid var(--border); color: var(--text-primary);">
                                  <i class="fas fa-external-link-alt"></i> Open Sheet
                                </a>
                              ` : ''}
                              ${canManageSchedules ? `<div class="sched-actions" style="display:flex; gap:6px;"><button class="btn btn-xs btn-secondary sched-edit-btn" data-id="${em.id}" style="padding: 5px 8px; border-radius: 5px;"><i class="fas fa-edit"></i></button><button class="btn btn-xs btn-danger sched-del-btn" data-id="${em.id}" style="padding: 5px 8px; border-radius: 5px;"><i class="fas fa-trash"></i></button></div>` : ''}
                            </div>
                          </summary>
                          <div class="sched-embed-details-body" style="padding:20px; border-top:1px dashed var(--border); display:flex; flex-direction:column; gap:16px;">
                            ${window._buildFlexibleScheduleTableHtml(em.rows, em.error, em.embed_url, em.title, true)}
                          </div>
                        </details>`).join('')}
                    </div>
                  </details>
                `}

                <!-- 2. Section Schedules Collapsible Tree -->
                ${sectionEmbeds.length === 0 ? `
                  <div class="empty-state" style="padding: 24px; border: 1px dashed var(--border); border-radius: 8px; margin-bottom: 24px;">
                    <i class="fas fa-users-class" style="color:var(--text-light); font-size: 24px;"></i>
                    <h3>No student class schedules match your filters.</h3>
                  </div>
                ` : Object.entries(grouped).map(([dept, years]) => `
                  <details class="sched-dept-group" open>
                    <summary class="sched-dept-header">
                      <span class="sched-dept-name"><i class="fas fa-graduation-cap"></i> ${escHtml(dept)}</span>
                      <span class="sched-dept-count">${Object.values(years).flatMap(y => Object.values(y)).flat().length}</span>
                    </summary>
                    <div class="sched-dept-body">
                      ${Object.entries(years).map(([yr, sections]) => `
                        <details class="sched-year-group" open>
                          <summary class="sched-year-header">
                            <span>${escHtml(yr)} Year</span>
                            <span>${Object.values(sections).flat().length} schedule(s)</span>
                          </summary>
                          <div class="sched-year-body" style="padding-left:12px; display:flex; flex-direction:column; gap:12px; margin-top:12px;">
                            ${Object.entries(sections).map(([sec, items]) => `
                              <details class="sched-embed-details-group" style="border:1px solid var(--border); border-radius:10px; background:var(--bg-card); box-shadow: var(--shadow-sm); margin-bottom: 12px; overflow: hidden; display: block;">
                                <summary class="sched-embed-details-summary" style="display:flex; justify-content:space-between; align-items:center; width:100%; padding:16px 20px; cursor:pointer; list-style:none; outline:none; user-select:none;" onclick="const target = event.target; if(target.closest('a') || target.closest('button')) event.stopPropagation();">
                                  <div class="sched-embed-info" style="display:flex; flex-direction:column; align-items:flex-start; gap:4px;">
                                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                      <i class="fas fa-chevron-right sched-arrow" style="font-size:12px; color:var(--text-light); transition: transform 0.2s;"></i>
                                      <i class="fas fa-users" style="color: var(--primary);"></i>
                                      <span class="sched-embed-title" style="font-weight:700; font-size:14px; color:var(--text-primary);">Section ${escHtml(sec)}</span>
                                      <span class="status-pill status-active" style="background:#880808; color:white; font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; text-transform:uppercase; margin-left:8px;">Section Schedule</span>
                                    </div>
                                    <div class="sched-embed-meta-badges" style="display:flex; gap:10px; font-size:11px; color:var(--text-secondary); margin-left:38px; opacity:0.85; flex-wrap:wrap; align-items:center; margin-top:4px;">
                                      <span><i class="fas fa-graduation-cap"></i> Dept: ${escHtml(dept)}</span>
                                      <span><i class="fas fa-layer-group"></i> ${escHtml(yr)} Year</span>
                                    </div>
                                  </div>
                                  <div style="display:flex; align-items:center; gap:10px;" onclick="event.stopPropagation();">
                                    <span class="sched-embed-by" style="font-size:12px; color:var(--text-secondary);">${items.length} schedule(s)</span>
                                  </div>
                                </summary>
                                <div class="sched-embed-details-body" style="padding:20px; border-top:1px dashed var(--border); display:flex; flex-direction:column; gap:16px;">
                                  ${items.map(em => `
                                    <details class="sched-embed-details-group" style="border:1px solid var(--border); border-radius:10px; background:var(--bg-card); box-shadow: var(--shadow-sm); margin-bottom:12px; overflow: hidden; display: block;">
                                      <summary class="sched-embed-details-summary" style="display:flex; justify-content:space-between; align-items:center; width:100%; padding:16px 20px; cursor:pointer; list-style:none; outline:none; user-select:none;" onclick="const target = event.target; if(target.closest('a') || target.closest('button')) event.stopPropagation();">
                                        <div class="sched-embed-info" style="display:flex; flex-direction:column; align-items:flex-start; gap:4px;">
                                          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                            <i class="fas fa-chevron-right sched-arrow" style="font-size:12px; color:var(--text-light); transition: transform 0.2s;"></i>
                                            <i class="fas fa-link" style="color: var(--primary);"></i>
                                            <span class="sched-embed-title" style="font-weight:700; font-size:14px; color:var(--text-primary);">${escHtml(em.title || 'Untitled Schedule')}</span>
                                          </div>
                                          <div class="sched-embed-meta-badges" style="display:flex; gap:10px; font-size:11px; color:var(--text-secondary); margin-left:38px; opacity:0.85; flex-wrap:wrap; align-items:center; margin-top:4px;">
                                            <span><i class="fas fa-graduation-cap"></i> ${escHtml(em.department || '—')}</span>
                                            <span><i class="fas fa-layer-group"></i> ${escHtml(em.year_level || '—')} Year</span>
                                            <span><i class="fas fa-users"></i> Section ${escHtml(em.section || '—')}</span>
                                          </div>
                                        </div>
                                        <div style="display:flex; align-items:center; gap:10px;" onclick="event.stopPropagation();">
                                          <span class="sched-embed-by" style="font-size:12px; color:var(--text-secondary);">by ${escHtml(em.posted_by_name || 'Faculty')}</span>
                                          ${em.embed_url ? `
                                            <a href="${escHtml(em.embed_url)}" target="_blank" rel="noopener" class="btn btn-secondary btn-xs" style="padding:5px 10px; font-size:11px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; border-radius: 5px; background: var(--bg-card); border: 1px solid var(--border); color: var(--text-primary);">
                                              <i class="fas fa-external-link-alt"></i> Open Sheet
                                            </a>
                                          ` : ''}
                                          ${canManageSchedules ? `<div class="sched-actions" style="display:flex; gap:6px;"><button class="btn btn-xs btn-secondary sched-edit-btn" data-id="${em.id}" style="padding: 5px 8px; border-radius: 5px;"><i class="fas fa-edit"></i></button><button class="btn btn-xs btn-danger sched-del-btn" data-id="${em.id}" style="padding: 5px 8px; border-radius: 5px;"><i class="fas fa-trash"></i></button></div>` : ''}
                                        </div>
                                      </summary>
                                      <div class="sched-embed-details-body" style="padding:20px; border-top:1px dashed var(--border); display:flex; flex-direction:column; gap:16px;">
                                        ${window._buildFlexibleScheduleTableHtml(em.rows, em.error, em.embed_url, em.title, true)}
                                      </div>
                                    </details>`).join('')}
                                </div>
                              </details>`).join('')}
                          </div>
                        </details>`).join('')}
                    </div>
                  </details>
                `).join('')}
              `
              // ── Faculty: flat card list ──
              : `<div style="display:flex;flex-direction:column;gap:16px;">
                  ${embeds.map(em => `
                    <details class="sched-embed-details-group" style="border:1px solid var(--border); border-radius:10px; background:var(--bg-card); box-shadow: var(--shadow-sm); overflow: hidden; display: block;">
                      <summary class="sched-embed-details-summary" style="display:flex; justify-content:space-between; align-items:center; width:100%; padding:16px 20px; cursor:pointer; list-style:none; outline:none; user-select:none;" onclick="const target = event.target; if(target.closest('a') || target.closest('button')) event.stopPropagation();">
                        <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
                          <div class="sched-embed-info" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                            <i class="fas fa-chevron-right sched-arrow" style="font-size:12px; color:var(--text-light); transition: transform 0.2s;"></i>
                            <i class="fas fa-link" style="color: var(--primary);"></i>
                            <span class="sched-embed-title" style="font-weight:700; font-size:14px; color:var(--text-primary);">${escHtml(em.title || 'Untitled Schedule')}</span>
                            <span class="status-pill status-active" style="background:var(--primary); color:white; font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; text-transform:uppercase;">Faculty Schedule</span>
                          </div>
                          <div class="sched-embed-meta" style="font-size:12px; color:var(--text-secondary); display:flex; gap:10px; margin-left:12px; align-items:center; flex-wrap:wrap;">
                            <span style="font-weight: 600; color: var(--primary); display: inline-flex; align-items: center; gap: 4px; background: rgba(136,8,8,0.06); padding: 3px 8px; border-radius: 4px;">
                              <i class="fas fa-user-tie"></i> Faculty: ${escHtml(em.faculty_name || state.user.first_name + ' ' + state.user.last_name)}
                            </span>
                            <span><i class="fas fa-building"></i> Dept: ${escHtml(em.department || 'General')}</span>
                          </div>
                        </div>
                        <div style="display:flex; align-items:center; gap:10px;" onclick="event.stopPropagation();">
                          ${em.embed_url ? `
                            <a href="${escHtml(em.embed_url)}" target="_blank" rel="noopener" class="btn btn-secondary btn-xs" style="padding:5px 10px; font-size:11px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; border-radius: 5px; background: var(--bg-card); border: 1px solid var(--border); color: var(--text-primary);">
                              <i class="fas fa-external-link-alt"></i> Open Sheet
                            </a>
                          ` : ''}
                          ${canManageSchedules ? `<div class="sched-actions" style="display:flex; gap:6px;"><button class="btn btn-xs btn-secondary sched-edit-btn" data-id="${em.id}" style="padding: 5px 8px; border-radius: 5px;"><i class="fas fa-edit"></i></button><button class="btn btn-xs btn-danger sched-del-btn" data-id="${em.id}" style="padding: 5px 8px; border-radius: 5px;"><i class="fas fa-trash"></i></button></div>` : ''}
                        </div>
                      </summary>
                      <div class="sched-embed-details-body" style="padding:20px; border-top:1px dashed var(--border); display:flex; flex-direction:column; gap:16px;">
                        ${window._buildFlexibleScheduleTableHtml(em.rows, em.error, em.embed_url, em.title, true)}
                      </div>
                    </details>`).join('')}
                </div>`
          }
        </div>

      </div>`;

    // ── Bind toolbar ──
    const schedAddBtnEl = document.getElementById('schedAddBtn');
    if (schedAddBtnEl) schedAddBtnEl.onclick = () => _openEmbedModal(null);
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
        if (!await window.showSystemConfirm('Remove this schedule embed?')) return;
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
    const isSuperAdmin = p.role === 'superadmin';
    const isAdmin = p.role === 'admin' || isSuperAdmin;
    const fullName = isAdmin
      ? (p.first_name || 'Admin')
      : ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
    const roleColor = isSuperAdmin ? '#B8860B' : (p.role === 'admin' ? '#880808' : p.role === 'faculty' ? '#1565c0' : '#2e7d32');
    const roleLabel = isSuperAdmin ? 'Super Admin' : (p.role === 'admin' ? 'Administrator' : p.role === 'faculty' ? 'Faculty' : 'Student');
    const roleIcon = isSuperAdmin ? 'crown' : (p.role === 'admin' ? 'shield-alt' : p.role === 'faculty' ? 'chalkboard-teacher' : 'user-graduate');
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
                  <i class="fas fa-${roleIcon}"></i>
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
                <label class="form-label">${isAdmin ? 'Display Name' : 'First Name'}</label>
                <input type="text" class="form-input" id="pfFirst" value="${escHtml(p.first_name || '')}" placeholder="${isAdmin ? 'Display name' : 'First name'}">
              </div>
              ${!isAdmin ? `
              <div class="form-group">
                <label class="form-label">Last Name</label>
                <input type="text" class="form-input" id="pfLast" value="${escHtml(p.last_name || '')}">
              </div>` : ''}
            </div>

            <div class="form-row">
              ${(p.role === 'student') ? `
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

            ${(p.role === 'faculty' || isAdmin) ? `
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
      const isAdmin    = p.role === 'admin' || p.role === 'superadmin';
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

    // Define chip text sender helper on window
    window._chipSendText = (text) => {
      const chatInput = document.getElementById('chatInput');
      const chatMessages = document.getElementById('chatMessages');
      if (chatInput && chatMessages) {
        chatInput.value = text;
        sendChatMessage(chatInput, chatMessages);
      }
    };

    // If chatMessages is empty, render the centered startup state
    const welcomeHtml = state.chatMessages.length === 0 ? `
      <div class="chat-welcome-container">
        <div class="chat-welcome-logo-wrap">
          <div class="chat-welcome-logo">
            <i class="fas fa-robot"></i>
          </div>
          <div class="logo-ring-pulse"></div>
        </div>
        <h2 class="chat-welcome-greeting">What's on your mind today?</h2>
        <div class="chat-welcome-sub">I'm PUPBot, your PUPSJ campus AI assistant. Ask me anything about class schedules, events, document templates, lost & found, or campus guidelines!</div>
        
        <div class="chat-welcome-suggestions">
          <div class="suggestion-card" onclick="window._chipSendText('Class schedules')">
            <div class="suggestion-icon"><i class="fas fa-calendar-alt"></i></div>
            <div class="suggestion-title">Class schedules</div>
            <div class="suggestion-desc">View or search section timetables</div>
          </div>
          <div class="suggestion-card" onclick="window._chipSendText('Lost & Found')">
            <div class="suggestion-icon"><i class="fas fa-search"></i></div>
            <div class="suggestion-title">Lost & Found</div>
            <div class="suggestion-desc">Report or check lost items</div>
          </div>
          <div class="suggestion-card" onclick="window._chipSendText('Enrollment steps')">
            <div class="suggestion-icon"><i class="fas fa-clipboard-list"></i></div>
            <div class="suggestion-title">Enrollment steps</div>
            <div class="suggestion-desc">Guide to campus enrollment</div>
          </div>
          <div class="suggestion-card" onclick="window._chipSendText('Latest announcements')">
            <div class="suggestion-icon"><i class="fas fa-bullhorn"></i></div>
            <div class="suggestion-title">Latest announcements</div>
            <div class="suggestion-desc">What is new on campus today</div>
          </div>
          <div class="suggestion-card" onclick="window._chipSendText('Document templates')">
            <div class="suggestion-icon"><i class="fas fa-file-pdf"></i></div>
            <div class="suggestion-title">Document templates</div>
            <div class="suggestion-desc">Download forms & templates</div>
          </div>
          <div class="suggestion-card" onclick="window._chipSendText('Faculty status')">
            <div class="suggestion-icon"><i class="fas fa-user-tie"></i></div>
            <div class="suggestion-title">Faculty status</div>
            <div class="suggestion-desc">Check if professors are available</div>
          </div>
        </div>
      </div>
    ` : '';

    pageArea.innerHTML = `
      <div class="page-content chatbot-page">
        <div class="chatbot-container">
          <div class="chat-messages" id="chatMessages">
            ${welcomeHtml}
            ${state.chatMessages.length > 0 ? `
              <div class="chat-message-row bot-row">
                <div class="bot-avatar-circle"><i class="fas fa-robot"></i></div>
                <div class="chat-bubble bot">
                  <div class="bot-label">PUPBot</div>
                  Hello! I'm <strong>PUPBot</strong>, your PUPSJ HUB assistant. I can help with questions about enrollment, schedules, events, lost &amp; found, feedback, and campus policies. What would you like to know?
                </div>
              </div>
            ` : ''}
            ${state.chatMessages.map(m => `
              <div class="chat-message-row user-row">
                <div class="chat-bubble user">${escHtml(m.user)}</div>
              </div>
              <div class="chat-message-row bot-row">
                <div class="bot-avatar-circle"><i class="fas fa-robot"></i></div>
                <div class="chat-bubble bot">
                  <div class="bot-label">PUPBot</div>
                  ${m.richHtml ? m.richHtml : renderBotMd(m.bot)}
                  ${m.images && m.images.length > 0 ? `<div class="chat-bot-images">${m.images.map(url => `<img src="${url}" alt="related" onclick="window._openImageViewer('${url}')">`).join('')}</div>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
          <div class="chat-typing" id="chatTyping">
            <div class="bot-avatar-circle" style="width:26px;height:26px;font-size:11px;"><i class="fas fa-robot"></i></div>
            <div class="chat-typing-dots">
              <div class="chat-typing-dot"></div>
              <div class="chat-typing-dot"></div>
              <div class="chat-typing-dot"></div>
            </div>
            <span class="chat-typing-label">PUPBot is thinking...</span>
          </div>
        </div>
      </div>`;

    const chatInput = document.getElementById('chatInput');
    const chatSend = document.getElementById('chatSend');
    const chatMessages = document.getElementById('chatMessages');

    // Auto-grow textarea height
    if (chatInput) {
      chatInput.disabled = state.chatInputDisabled;
      chatInput.oninput = () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = (chatInput.scrollHeight) + 'px';
      };
    }
    if (chatSend) chatSend.disabled = state.chatInputDisabled;

    // Only scroll to bottom when there are actual chat messages (not the welcome screen)
    if (state.chatMessages.length > 0) {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    } else {
      chatMessages.scrollTop = 0;
    }
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

    // Reset textarea height
    inputEl.style.height = 'auto';

    // On first message: collapse the welcome screen and show the initial bot greeting
    const welcomeEl = messagesEl.querySelector('.chat-welcome-container');
    if (welcomeEl) {
      welcomeEl.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      welcomeEl.style.opacity = '0';
      welcomeEl.style.transform = 'translateY(-10px)';
      setTimeout(() => {
        welcomeEl.remove();
        // Insert initial bot greeting if not there yet
        if (!messagesEl.querySelector('.bot-row')) {
          const greetRow = document.createElement('div');
          greetRow.className = 'chat-message-row bot-row';
          greetRow.innerHTML = `
            <div class="bot-avatar-circle"><i class="fas fa-robot"></i></div>
            <div class="chat-bubble bot">
              <div class="bot-label">PUPBot</div>
              Hello! I'm <strong>PUPBot</strong>, your PUPSJ HUB assistant. I can help with questions about enrollment, schedules, events, lost &amp; found, feedback, and campus policies. What would you like to know?
            </div>`;
          messagesEl.insertBefore(greetRow, messagesEl.firstChild);
        }
      }, 300);
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
      let botHtml = `<div class="bot-label">PUPBot</div>`;
      if (data.richHtml) {
        botHtml += data.richHtml;
      } else {
        botHtml += renderBotMd(data.response);
      }

      // Show images if returned
      if (data.images && data.images.length > 0) {
        botHtml += `<div class="chat-bot-images">${data.images.map(url => `<img src="${url}" alt="related" onclick="window._openImageViewer('${url}')">`).join('')}</div>`;
      }

      botBubble.innerHTML = botHtml;
      botRow.appendChild(botAvatar);
      botRow.appendChild(botBubble);
      messagesEl.appendChild(botRow);

      state.chatMessages.push({ user: message, bot: data.response, images: data.images || [], richHtml: data.richHtml });
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

  async function sendFloatChatMessage() {
    const inputEl = document.getElementById('pupbotFloatInput');
    const messagesEl = document.getElementById('pupbotFloatMessages');
    if (!inputEl || !messagesEl) return;
    const message = inputEl.value.trim();
    if (!message) return;
    inputEl.value = '';

    // Add user message to floating chat
    const userRow = document.createElement('div');
    userRow.className = 'chat-message-row user-row';
    const userBubble = document.createElement('div');
    userBubble.className = 'chat-bubble user';
    userBubble.style.fontSize = '13px';
    userBubble.style.padding = '8px 12px';
    userBubble.textContent = message;
    userRow.appendChild(userBubble);
    messagesEl.appendChild(userRow);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // Show typing indicator in floating chat
    const typingEl = document.createElement('div');
    typingEl.className = 'chat-message-row bot-row float-typing-indicator';
    typingEl.innerHTML = `
      <div class="bot-avatar-circle" style="width:28px;height:28px;font-size:12px;background:var(--maroon);color:#fff;display:flex;align-items:center;justify-content:center;border-radius:50%;"><i class="fas fa-robot"></i></div>
      <div class="chat-bubble bot" style="font-size:13px; padding: 8px 12px; display:flex; align-items:center; gap:6px;">
        <div class="chat-typing-dots" style="display:flex; gap:3px;">
          <div class="chat-typing-dot" style="width:6px; height:6px; background:var(--primary); border-radius:50%; animation: pulse-text 1.2s ease-in-out infinite;"></div>
          <div class="chat-typing-dot" style="width:6px; height:6px; background:var(--primary); border-radius:50%; animation: pulse-text 1.2s ease-in-out infinite; animation-delay:0.15s;"></div>
          <div class="chat-typing-dot" style="width:6px; height:6px; background:var(--primary); border-radius:50%; animation: pulse-text 1.2s ease-in-out infinite; animation-delay:0.3s;"></div>
        </div>
      </div>
    `;
    messagesEl.appendChild(typingEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    try {
      const history = state.chatMessages.slice(-6).map(m => ({ user: m.user, bot: m.bot }));
      const data = await api('/api/chatbot/message', { method: 'POST', body: JSON.stringify({ message, history }) });

      const typingIndicator = messagesEl.querySelector('.float-typing-indicator');
      if (typingIndicator) typingIndicator.remove();

      const botRow = document.createElement('div');
      botRow.className = 'chat-message-row bot-row';
      const botAvatar = document.createElement('div');
      botAvatar.className = 'bot-avatar-circle';
      botAvatar.style.width = '28px';
      botAvatar.style.height = '28px';
      botAvatar.style.fontSize = '12px';
      botAvatar.innerHTML = '<i class="fas fa-robot"></i>';
      
      const botBubble = document.createElement('div');
      botBubble.className = 'chat-bubble bot';
      botBubble.style.fontSize = '13px';
      botBubble.style.padding = '8px 12px';
      
      let botHtml = `<div class="bot-label">PUPBot</div>`;
      if (data.richHtml) {
        botHtml += data.richHtml;
      } else {
        botHtml += renderBotMd(data.response);
      }

      if (data.images && data.images.length > 0) {
        botHtml += `<div class="chat-bot-images">${data.images.map(url => `<img src="${url}" alt="related" onclick="window._openImageViewer('${url}')">`).join('')}</div>`;
      }

      botBubble.innerHTML = botHtml;
      botRow.appendChild(botAvatar);
      botRow.appendChild(botBubble);
      messagesEl.appendChild(botRow);

      state.chatMessages.push({ user: message, bot: data.response, images: data.images || [], richHtml: data.richHtml });
      state.chatLastMessageAt = Date.now();
    } catch (err) {
      const typingIndicator = messagesEl.querySelector('.float-typing-indicator');
      if (typingIndicator) typingIndicator.remove();
      
      const errRow = document.createElement('div');
      errRow.className = 'chat-message-row bot-row';
      errRow.innerHTML = `<div class="bot-avatar-circle" style="width:28px;height:28px;font-size:12px;"><i class="fas fa-robot"></i></div><div class="chat-bubble bot" style="font-size:13px; padding: 8px 12px;"><div class="bot-label">PUPBot</div>Sorry, I'm having trouble responding right now. Please try again.</div>`;
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
    if (!state.facultyLocationsUpdatedAt || Date.now() - state.facultyLocationsUpdatedAt.getTime() > 5000) {
      fetchFacultyLocations();
    }
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

  function getFileIconBgLight(fileType) {
    if (!fileType) return 'rgba(136, 8, 8, 0.08)';
    if (fileType.includes('pdf')) return 'rgba(231, 76, 60, 0.08)';
    if (fileType.includes('word') || fileType.includes('document')) return 'rgba(43, 87, 154, 0.08)';
    if (fileType.includes('sheet') || fileType.includes('excel')) return 'rgba(33, 115, 70, 0.08)';
    if (fileType.includes('presentation') || fileType.includes('powerpoint')) return 'rgba(210, 71, 38, 0.08)';
    if (fileType.includes('image')) return 'rgba(142, 68, 173, 0.08)';
    if (fileType.includes('text')) return 'rgba(127, 140, 141, 0.08)';
    return 'rgba(136, 8, 8, 0.08)';
  }

  function renderDocumentsPage() {
    const pageArea = document.getElementById('pageArea');
    const isFacultyOrAdmin = state.user.role === 'faculty' || state.user.role === 'admin' || state.user.role === 'superadmin';
    const selectedCat = state.docCategories.find(c => c.id === state.docSelectedCategory);
    // Total documents across all categories (for the stats bar)
    const totalDocs = state.docCategories.reduce((sum, c) => sum + (parseInt(c.file_count, 10) || 0), 0);

    // ── Inject scoped styles to guarantee folder design renders regardless of CSS cache ──
    if (!document.getElementById('doc-inline-styles')) {
      const style = document.createElement('style');
      style.id = 'doc-inline-styles';
      style.textContent = `
        .doc-folders-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:18px}
        @media(max-width:900px){.doc-folders-grid{grid-template-columns:repeat(2,1fr)}}
        @media(max-width:480px){.doc-folders-grid{grid-template-columns:1fr}}
        .doc-folder-card-wrapper{position:relative;display:flex;flex-direction:column;margin-top:0;cursor:pointer;transition:transform .25s cubic-bezier(.16,1,.3,1)}
        .doc-folder-card-wrapper:hover{transform:translateY(-5px)}
        .doc-folder-tab{height:18px;width:100px;border-radius:10px 14px 0 0;background:var(--fc-tab,rgba(136,8,8,.18));position:relative;z-index:1}
        .doc-folder-tab::after{content:'';position:absolute;right:-15px;bottom:0;width:15px;height:18px;background:var(--fc-tab,rgba(136,8,8,.18));clip-path:polygon(0 0,0 100%,100% 100%)}
        .doc-folder-card{position:relative;border-radius:0 14px 14px 14px!important;background:var(--fc-body,#fff)!important;padding:20px 18px 16px!important;min-height:140px;display:flex;flex-direction:column;border:1.5px solid var(--fc-border,#e5e5e5)!important;margin-top:-1px;z-index:2;transition:all .25s ease;box-shadow:0 4px 12px rgba(0,0,0,.06)}
        .doc-folder-card-wrapper:hover .doc-folder-card{box-shadow:0 12px 28px rgba(0,0,0,.10)!important;border-color:var(--fc-tab,rgba(136,8,8,.3))!important}
        .doc-folder-icon-wrap{margin-bottom:8px}
        .doc-folder-icon-wrap svg{transition:transform .25s ease}
        .doc-folder-card-wrapper:hover .doc-folder-icon-wrap svg{transform:scale(1.1) rotate(-4deg)}
        .doc-folder-info{display:flex;flex-direction:column;flex-grow:1}
        .doc-folder-name{font-size:15px;font-weight:700;color:var(--text-primary,#1c1517);margin:8px 0 4px}
        .doc-folder-desc{font-size:12px;color:var(--text-secondary,#5a5a58);line-height:1.45;margin:0 0 10px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
        .doc-folder-count-row{display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding-top:8px;border-top:1px solid var(--fc-border,#e5e5e5)}
        .doc-folder-avatar-circle{width:26px;height:26px;border-radius:50%;background:var(--fc-tab,rgba(136,8,8,.15));color:var(--fc-icon,#880808);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid var(--fc-body,#fff);box-shadow:0 1px 4px rgba(0,0,0,.08)}
        .doc-folder-count-text{font-size:12px;font-weight:500;color:var(--text-light,#9ca3af)}
        .doc-folder-actions{position:absolute;top:10px;right:10px;display:flex;gap:6px;opacity:0;pointer-events:none;z-index:10;transition:opacity .2s ease}
        .doc-folder-card-wrapper:hover .doc-folder-actions{opacity:1;pointer-events:auto}
        .doc-folder-action-btn{width:28px;height:28px;border-radius:50%;border:1px solid var(--border,#e5e5e5);background:var(--bg-card,#fff);display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--text-secondary,#5a5a58);cursor:pointer;transition:all .2s}
        .doc-folder-action-btn:hover{color:#880808;border-color:#880808;background:rgba(136,8,8,.07);transform:scale(1.08)}
        .doc-folder-actions .doc-folder-del-btn:hover{color:#e74c3c;border-color:#e74c3c;background:rgba(231,76,60,.07)}
        .doc-folder-theme-0{--fc-tab:rgba(136,8,8,.18);--fc-body:#fff5f5;--fc-border:rgba(136,8,8,.2);--fc-icon:#880808}
        .doc-folder-theme-1{--fc-tab:rgba(136,70,0,.16);--fc-body:#fff8f0;--fc-border:rgba(200,100,0,.18);--fc-icon:#b45309}
        .doc-folder-theme-2{--fc-tab:rgba(52,152,219,.18);--fc-body:#f0f8ff;--fc-border:rgba(52,152,219,.22);--fc-icon:#2980b9}
        .doc-folder-theme-3{--fc-tab:rgba(46,204,113,.16);--fc-body:#f0fdf4;--fc-border:rgba(46,204,113,.2);--fc-icon:#16a34a}
        .doc-folder-theme-4{--fc-tab:rgba(107,6,6,.16);--fc-body:#fdf0ec;--fc-border:rgba(107,6,6,.2);--fc-icon:#6b0606}
        .doc-folder-theme-5{--fc-tab:rgba(109,40,217,.14);--fc-body:#f5f3ff;--fc-border:rgba(109,40,217,.18);--fc-icon:#6d28d9}
        html[data-theme="dark"] .doc-folder-theme-0{--fc-tab:rgba(160,64,64,0.24);--fc-body:#2A1E1E!important;--fc-border:rgba(160,64,64,0.3)!important;--fc-icon:#A04040}
        html[data-theme="dark"] .doc-folder-theme-1{--fc-tab:rgba(241,196,15,0.22);--fc-body:#2A261B!important;--fc-border:rgba(241,196,15,0.3)!important;--fc-icon:#F1C40F}
        html[data-theme="dark"] .doc-folder-theme-2{--fc-tab:rgba(52,152,219,0.22);--fc-body:#1E252C!important;--fc-border:rgba(52,152,219,0.3)!important;--fc-icon:#3498DB}
        html[data-theme="dark"] .doc-folder-theme-3{--fc-tab:rgba(46,204,113,0.22);--fc-body:#1E2B23!important;--fc-border:rgba(46,204,113,0.3)!important;--fc-icon:#2ECC71}
        html[data-theme="dark"] .doc-folder-theme-4{--fc-tab:rgba(160,64,64,0.2);--fc-body:#242424!important;--fc-border:#333333!important;--fc-icon:var(--text-secondary)}
        html[data-theme="dark"] .doc-folder-theme-5{--fc-tab:rgba(230,126,34,0.22);--fc-body:#2D231B!important;--fc-border:rgba(230,126,34,0.3)!important;--fc-icon:#F39C12}
        .doc-title-badge{background:rgba(136,8,8,.1);color:#880808;font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;margin-left:6px;vertical-align:middle}
        .doc-section-title{font-size:16px;font-weight:700;color:var(--text-primary,#1c1517)}
        .doc-new-folder-header-btn{margin-right:64px!important;padding:8px 18px!important;border-radius:20px!important;background:#880808!important;color:#fff!important;border:none!important;font-size:13px!important;font-weight:600!important;cursor:pointer!important;display:inline-flex!important;align-items:center!important;gap:8px!important;transition:all .2s!important;box-shadow:0 2px 8px rgba(136,8,8,.25)!important}
        .doc-new-folder-header-btn:hover{background:#6b0606!important;transform:translateY(-1px)!important}
        @media(max-width:768px){.doc-new-folder-header-btn{margin-right:0!important}}
        .doc-files-list{display:flex;flex-direction:column;gap:12px;margin-top:16px}
        .doc-file-card{display:flex;align-items:center;gap:16px;padding:14px 18px;border-radius:10px;border:1px solid var(--border,#e5e5e5);background:var(--bg-card,#fff)!important;transition:all .2s ease;box-shadow:0 1px 4px rgba(0,0,0,.05)}
        .doc-file-card:hover{box-shadow:0 4px 16px rgba(136,8,8,.08)!important;border-color:rgba(136,8,8,.25);background:#fffafa!important}
        .doc-file-icon-container{width:46px;height:46px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0}
        .doc-file-info{flex:1;min-width:0}
        .doc-file-title{font-size:14px;font-weight:600;color:var(--text-primary,#1c1517);margin:0 0 3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .doc-file-desc{font-size:12px;color:var(--text-secondary,#5a5a58);margin:0 0 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .doc-file-meta{display:flex;flex-wrap:wrap;gap:6px}
        .doc-file-meta-pill{font-size:11px;color:var(--text-secondary,#5a5a58);background:rgba(0,0,0,.04);border:1px solid rgba(0,0,0,.07);border-radius:20px;padding:2px 8px;display:inline-flex;align-items:center;gap:4px}
        .doc-file-actions-wrap{display:flex;align-items:center;gap:12px;flex-shrink:0}
        .doc-file-admin-actions{display:flex;gap:6px}
        .doc-file-action-btn{width:30px;height:30px;border-radius:50%;border:1px solid var(--border,#e5e5e5);background:var(--bg-card,#fff);display:flex;align-items:center;justify-content:center;color:var(--text-secondary,#5a5a58);cursor:pointer;transition:all .2s;font-size:12px}
        .doc-file-action-btn:hover{color:#880808;border-color:#880808;background:rgba(136,8,8,.06)}
        .doc-file-action-btn.doc-file-del-btn:hover{color:#e74c3c;border-color:#e74c3c;background:rgba(231,76,60,.06)}
        .doc-file-download-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;border:1.5px solid #880808;color:#880808;background:transparent;font-size:12px;font-weight:600;text-decoration:none;transition:all .2s;cursor:pointer;white-space:nowrap}
        .doc-file-download-btn:hover{background:#880808;color:#fff;box-shadow:0 3px 10px rgba(136,8,8,.2);transform:translateY(-1px)}
        .doc-breadcrumb{display:flex;align-items:center;gap:10px;margin-bottom:18px;border-bottom:1px solid var(--border,#e5e5e5);padding-bottom:14px}
        .doc-breadcrumb-back{width:32px;height:32px;border-radius:50%;border:1.5px solid var(--border,#e5e5e5);background:var(--bg-card,#fff);display:flex;align-items:center;justify-content:center;color:var(--text-secondary,#5a5a58);cursor:pointer;transition:all .2s}
        .doc-breadcrumb-back:hover{border-color:#880808;color:#880808;background:rgba(136,8,8,.06);transform:translateX(-2px)}
        .doc-breadcrumb-path{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:500}
        .doc-breadcrumb-item{color:var(--text-secondary,#5a5a58)}
        .doc-breadcrumb-item.active{color:var(--text-primary,#1c1517);font-weight:600}
        .doc-breadcrumb-separator{font-size:10px;color:var(--text-light,#9ca3af)}
        .doc-breadcrumb-actions{display:flex;gap:8px;margin-left:auto}
        .doc-breadcrumb-action-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;transition:all .2s}
        .doc-breadcrumb-action-btn.btn-outlined{border:1.5px solid #880808;color:#880808;background:transparent}
        .doc-breadcrumb-action-btn.btn-outlined:hover{background:rgba(136,8,8,.06)}
        .doc-breadcrumb-action-btn.btn-filled-red{background:#e74c3c;color:#fff;border:none}
        .doc-breadcrumb-action-btn.btn-filled-red:hover{background:#c0392b}
        .doc-toolbar{display:flex!important;flex-direction:column!important;align-items:flex-start!important;gap:14px!important}
        .doc-search-input-wrap{width:100%!important;max-width:480px!important}
        .doc-toolbar-stats{display:flex;align-items:center;gap:8px;flex-shrink:0}
        .doc-stat-pill{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:999px;font-size:13px;font-weight:500;border:1.5px solid transparent;transition:all .2s ease;cursor:default;user-select:none}
        .doc-stat-pill strong{font-size:15px;font-weight:800;line-height:1}
        .doc-stat-pill span{font-size:12px;font-weight:500}
        .doc-stat-pill i{font-size:13px}
        .doc-stat-folders{background:rgba(136,8,8,.07);border-color:rgba(136,8,8,.18);color:#880808}
        .doc-stat-folders strong,.doc-stat-folders i{color:#880808}
        .doc-stat-docs{background:rgba(52,152,219,.07);border-color:rgba(52,152,219,.2);color:#2980b9}
        .doc-stat-docs strong,.doc-stat-docs i{color:#2980b9}
      `;
      document.head.appendChild(style);
    }

    // ── Folders section (shown when no category selected and not searching) ──
    const foldersSection = (!state.docSelectedCategory && !state.docSearch && state.docCategories.length > 0) ? `
      <div class="doc-section">
        <div style="margin-bottom: 16px;">
          <span class="doc-section-title">Folders <span class="doc-title-badge">${state.docCategories.length}</span></span>
        </div>
        <div class="doc-folders-grid">
          ${state.docCategories.map((c, i) => {
            return `
              <div class="doc-folder-card-wrapper doc-folder-theme-${i % 6}" data-cat-nav="${c.id}">
                <div class="doc-folder-tab"></div>
                <div class="doc-folder-card">
                  ${isFacultyOrAdmin ? `
                  <div class="doc-folder-actions">
                    <button class="doc-folder-action-btn" onclick="event.stopPropagation(); window._editCategory('${c.id}','${jsEsc(c.name)}','${jsEsc(c.description || '')}')"><i class="fas fa-pen"></i></button>
                    <button class="doc-folder-action-btn doc-folder-del-btn" onclick="event.stopPropagation(); window._deleteCategory('${c.id}')"><i class="fas fa-trash-alt"></i></button>
                  </div>` : ''}
                  <div class="doc-folder-icon-wrap">
                    <svg class="doc-folder-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: 44px; height: 44px;">
                      <path d="M19 20H5C3.89543 20 3 19.1046 3 18V6C3 4.89543 3.89543 4 5 4H9.58579C10.1162 4 10.625 4.21071 11 4.58579L13.4142 7H19C20.1046 7 21 7.89543 21 9V18C21 19.1046 20.1046 20 19 20Z" fill="var(--fc-icon)"/>
                    </svg>
                  </div>
                  <div class="doc-folder-info">
                    <h3 class="doc-folder-name">${escHtml(c.name)}</h3>
                    <p class="doc-folder-desc">${c.description ? escHtml(c.description) : 'No description available.'}</p>
                  </div>
                  <div class="doc-folder-count-row">
                    <div class="doc-folder-avatar-circle">${c.name.slice(0, 1).toUpperCase()}</div>
                    <span class="doc-folder-count-text">${parseInt(c.file_count,10)||0} item${(parseInt(c.file_count,10)||0) !== 1 ? 's' : ''}</span>
                  </div>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>` : '';

    // ── Documents list section (shown when category selected or searching) ──
    const docsSection = (state.docSelectedCategory || state.docSearch) ? `
      <div class="doc-section">
        <div class="doc-breadcrumb">
          <button class="doc-breadcrumb-back" id="docBackBtn">
            <i class="fas fa-arrow-left"></i>
          </button>
          <div class="doc-breadcrumb-path">
            <span class="doc-breadcrumb-item">Folders</span>
            <i class="fas fa-chevron-right doc-breadcrumb-separator"></i>
            <span class="doc-breadcrumb-item active">${selectedCat ? escHtml(selectedCat.name) : 'Search Results'}</span>
          </div>
          ${isFacultyOrAdmin && selectedCat ? `
          <div class="doc-breadcrumb-actions" style="margin-left: auto; display: flex; gap: 8px;">
            <button class="doc-breadcrumb-action-btn btn-outlined" onclick="window._editCategory('${selectedCat.id}','${jsEsc(selectedCat.name)}','${jsEsc(selectedCat.description || '')}')"><i class="fas fa-pen"></i> Edit Folder</button>
            <button class="doc-breadcrumb-action-btn btn-filled-red" onclick="window._deleteCategory('${selectedCat.id}')"><i class="fas fa-trash-alt"></i> Delete Folder</button>
          </div>` : ''}
        </div>

        <div style="margin-bottom: 16px;">
          <span class="doc-section-title">Workflows <span class="doc-title-badge">${state.docTemplates.length}</span></span>
        </div>

        ${state.docTemplates.length === 0 ? `
          <div class="empty-state">
            <i class="fas fa-file-circle-exclamation"></i>
            <h3>${state.docSearch ? 'No documents found' : 'Folder is empty'}</h3>
            <p>${state.docSearch ? 'Try a different search term.' : (isFacultyOrAdmin ? 'Upload documents using the + button.' : 'Check back later.')}</p>
          </div>
        ` : `
          <div class="doc-files-list">
            ${state.docTemplates.map(d => `
              <div class="doc-file-card">
                <!-- Left: File type icon -->
                <div class="doc-file-icon-container" style="color: ${getFileIconColor(d.file_type)}; background: ${getFileIconBgLight(d.file_type)};">
                  <i class="fas ${getFileIcon(d.file_type)}"></i>
                </div>

                <!-- Center: Info Stack -->
                <div class="doc-file-info">
                  <h4 class="doc-file-title">${escHtml(d.title)}</h4>
                  ${d.description ? `<p class="doc-file-desc">${escHtml(d.description)}</p>` : `<p class="doc-file-desc" style="color: var(--text-light); font-style: italic;">No description available.</p>`}
                  <div class="doc-file-meta">
                    ${d.file_size ? `<span class="doc-file-meta-pill"><i class="fas fa-hdd"></i> ${formatFileSize(d.file_size)}</span>` : ''}
                    <span class="doc-file-meta-pill"><i class="fas fa-download"></i> ${d.download_count || 0} downloads</span>
                    <span class="doc-file-meta-pill"><i class="fas fa-clock"></i> ${timeAgo(d.created_at)}</span>
                    ${d.category_name && state.docSearch ? `<span class="doc-file-meta-pill"><i class="fas fa-folder"></i> ${escHtml(d.category_name)}</span>` : ''}
                  </div>
                </div>

                <!-- Right: Action Buttons and Download -->
                <div class="doc-file-actions-wrap">
                  ${isFacultyOrAdmin ? `
                  <div class="doc-file-admin-actions">
                    <button class="doc-file-action-btn" onclick="window._editDocument('${d.id}','${jsEsc(d.title)}','${jsEsc(d.description || '')}','${d.category_id}','${jsEsc(d.department || 'General')}')"><i class="fas fa-pen"></i></button>
                    <button class="doc-file-action-btn doc-file-del-btn" onclick="window._deleteDocument('${d.id}')"><i class="fas fa-trash-alt"></i></button>
                  </div>` : ''}
                  <a href="${d.file_url}" download="${escHtml(d.file_name)}" class="doc-file-download-btn" onclick="window._trackDownload('${d.id}')">
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

    const isShowingFolderView = !state.docSelectedCategory && !state.docSearch;
    let html = `
      <div class="page-header" style="display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap;">
        <div>
          <h1 class="page-title">Document Templates</h1>
          <p class="page-subtitle">Accreditation documents, templates &amp; forms</p>
        </div>
        ${isFacultyOrAdmin ? `
          <div style="display: flex; gap: 8px; align-items: center;">
            ${isShowingFolderView ? `
              <button class="btn btn-outlined" id="addCategoryBtn" style="border: 1.5px solid #880808; color: #880808; background: transparent; border-radius: 9999px; padding: 9px 18px; display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; cursor: pointer; transition: all 0.2s;">
                <i class="fas fa-plus"></i> New Folder
              </button>
            ` : ''}
            <button class="btn btn-primary" id="btnUploadDoc" style="background: #880808; border: none; color: #fff; border-radius: 9999px; padding: 10px 20px; display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; cursor: pointer; transition: all 0.2s; box-shadow: 0 2px 8px rgba(136,8,8,0.25);">
              <i class="fas fa-upload"></i> Upload Template
            </button>
          </div>
        ` : ''}
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
            <span class="doc-stat-pill doc-stat-folders">
              <i class="fas fa-folder"></i>
              <strong>${state.docCategories.length}</strong>
              <span>Folder${state.docCategories.length !== 1 ? 's' : ''}</span>
            </span>
            <span class="doc-stat-pill doc-stat-docs">
              <i class="fas fa-file-alt"></i>
              <strong>${totalDocs}</strong>
              <span>Document${totalDocs !== 1 ? 's' : ''}</span>
            </span>
          </div>
        </div>
        ${emptyState}
        ${foldersSection}
        ${docsSection}
      </div>`;

    pageArea.innerHTML = html;

    // Back button
    const backBtn = document.getElementById('docBackBtn');
    if (backBtn) backBtn.onclick = () => { state.docSelectedCategory = null; state.docSearch = ''; loadDocuments(); };

    // Folder card navigation
    document.querySelectorAll('.doc-folder-card-wrapper[data-cat-nav]').forEach(el => {
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

    const btnUploadDoc = document.getElementById('btnUploadDoc');
    if (btnUploadDoc) btnUploadDoc.onclick = () => openModal('doc-upload');
  }

  window._trackDownload = async (id) => {
    try { await api(`/api/documents/${id}/download`, { method: 'POST' }); } catch (e) {}
  };

  window._deleteDocument = async (id) => {
    if (!await window.showSystemConfirm('Delete this document?')) return;
    try {
      await api(`/api/documents/${id}`, { method: 'DELETE' });
      showToast('Document deleted', 'success');
      loadDocuments();
    } catch (err) { showToast(err.message, 'error'); }
  };

  window._deleteCategory = async (id) => {
    if (!await window.showSystemConfirm('Delete this category and all its documents?')) return;
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
      const [stats, pendingAnn, pendingEv, allSchedules] = await Promise.all([
        api('/api/admin/stats'),
        api('/api/announcements/pending/list').catch(() => []),
        api('/api/events/pending/list').catch(() => []),
        api('/api/section-schedules').catch(() => []),
      ]);
      state.adminStats = stats;
      state.pendingAnnouncements = pendingAnn || [];
      state.pendingEvents = pendingEv || [];

      // Extract faculty schedule embeds
      const facultySchedules = Array.isArray(allSchedules) ? allSchedules.filter(s => s.target_type === 'faculty') : [];

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

          <!-- FACULTY SCHEDULES MASTER OVERVIEW -->
          <div class="card" style="padding:20px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
              <h3 style="font-family:var(--font-display);font-size:16px;font-weight:700;margin:0;display:flex;align-items:center;gap:8px;">
                <i class="fas fa-chalkboard-teacher" style="color:var(--primary);"></i> Faculty Schedules Master Overview
              </h3>
              <span class="status-pill status-active" style="background:var(--primary);color:white;font-weight:600;">${facultySchedules.length} Assigned</span>
            </div>
            
            ${facultySchedules.length === 0 ? `
              <div class="empty-state" style="padding:24px;">
                <i class="fas fa-calendar-times" style="color:var(--text-light);font-size:32px;"></i>
                <h3>No Faculty Schedules Uploaded</h3>
                <p>Use the Quick Actions panel below to upload and assign schedules to faculty members.</p>
              </div>
            ` : `
              <div class="table-responsive" style="margin-top:12px; border-radius:8px; border:1px solid var(--border); overflow-x:auto;">
                <table class="table" style="width:100%; border-collapse:collapse; text-align:left; font-size:13px; min-width:600px;">
                  <thead>
                    <tr style="background:var(--border-soft); border-bottom:1px solid var(--border); color:var(--text-secondary); font-weight:700;">
                      <th style="padding:12px 16px;">Faculty Member</th>
                      <th style="padding:12px 16px;">Schedule Title</th>
                      <th style="padding:12px 16px;">Department</th>
                      <th style="padding:12px 16px;">Embed Link</th>
                      <th style="padding:12px 16px; text-align:right;">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${facultySchedules.map(fs => `
                      <tr style="border-bottom:1px solid var(--border); transition: background 0.2s;">
                        <td style="padding:12px 16px; font-weight:600; color:var(--text-primary);">
                          <i class="fas fa-user-tie" style="color:var(--primary); margin-right:6px;"></i> ${escHtml(fs.faculty_name || 'Unassigned')}
                        </td>
                        <td style="padding:12px 16px; color:var(--text-primary); font-weight:500;">${escHtml(fs.title)}</td>
                        <td style="padding:12px 16px; color:var(--text-secondary);"><i class="fas fa-building" style="font-size:11px;"></i> ${escHtml(fs.department || 'General')}</td>
                        <td style="padding:12px 16px;">
                          <a href="${escHtml(fs.embed_url)}" target="_blank" rel="noopener" style="color:var(--primary); text-decoration:none; font-weight:600; display:inline-flex; align-items:center; gap:4px;">
                            <i class="fas fa-external-link-alt" style="font-size:11px;"></i> Open Link
                          </a>
                        </td>
                        <td style="padding:12px 16px; text-align:right;">
                          <button class="btn btn-xs btn-danger" onclick="window._deleteSectionSchedule('${fs.id}').then(() => loadAdminDashboard())" title="Delete Schedule" style="padding:4px 8px; border-radius:4px;">
                            <i class="fas fa-trash"></i>
                          </button>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `}
          </div>

          <div class="card" style="padding:20px;">
            <h3 style="font-family:var(--font-display);font-size:16px;font-weight:700;margin-bottom:16px;">Quick Actions</h3>
            <div class="admin-quick-actions">
              ${state.user.role === 'superadmin' ? `<button class="btn btn-primary quick-action-full" onclick="navigateTo('admin-users')"><i class="fas fa-users-cog"></i> Manage Users</button>` : ''}
              <div class="quick-action-row">
                <button class="btn btn-gold" onclick="openModal('announcement')"><i class="fas fa-bullhorn"></i> Post Announcement</button>
                <button class="btn btn-secondary" onclick="openModal('event')"><i class="fas fa-calendar-plus"></i> Create Event</button>
              </div>
              <div class="quick-action-row" style="margin-top: 10px;">
                <button class="btn btn-primary quick-action-full" style="background:#2e7d32; border-color:#2e7d32;" onclick="openModal('section-schedule')">
                  <i class="fas fa-calendar-alt"></i> Upload & Assign Schedule
                </button>
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

  // ════════════════════════════════
  //  SUPERADMIN - SYSTEM MAINTENANCE
  // ════════════════════════════════
  async function loadSystemMaintenance() {
    const pageArea = document.getElementById('pageArea');
    pageArea.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">System Maintenance</h1>
        <p class="page-subtitle">Configure application branding, title, logo, and landing page image</p>
      </div>
      <div class="page-content">
        <div class="loader"><div class="spinner"></div></div>
      </div>`;

    try {
      state.systemSettings = await api('/api/system-settings');
      
      const title = state.systemSettings.app_title || 'PUPSJ HUB';
      const subtitle = state.systemSettings.app_title_subtitle || 'San Juan Campus Hub';
      const logo = state.systemSettings.app_logo || '/icons/pup_logo.png';
      const hero = state.systemSettings.app_landing_hero || '/landing_hero.png';
      const description = state.systemSettings.app_description || 'PUPSJ HUB is the centralized campus portal designed exclusively for the Polytechnic University of the Philippines San Juan Campus. Engineered to optimize campus communication and student organization coordination, this portal serves as a unified progressive portal for faculty, students, and campus administrators alike.';

      // Parse current hero images (split by commas)
      let currentHeroImages = hero.split(',').map(u => u.trim()).filter(Boolean);

      window._removeHeroImage = (idx) => {
        currentHeroImages.splice(idx, 1);
        renderHeroGallery();
      };

      window._uploadHeroImage = async (inputEl) => {
        const file = inputEl.files[0];
        if (!file) return;

        const addBox = document.querySelector('.hero-gallery-add');
        if (addBox) {
          addBox.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size:16px;"></i><span style="font-size:10px;font-weight:700;margin-top:6px;">Uploading...</span>';
          addBox.style.pointerEvents = 'none';
        }

        try {
          const fd = new FormData();
          fd.append('file', file);
          const uploadRes = await fetch('/api/admin/system-settings/upload', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${sessionStorage.getItem('pupsj_token')}` },
            body: fd
          });
          if (!uploadRes.ok) throw new Error('Hero image upload failed');
          const data = await uploadRes.json();
          currentHeroImages.push(data.url);
          showToast('Hero image added successfully!', 'success');
        } catch (err) {
          showToast(err.message || 'Upload failed', 'error');
        } finally {
          renderHeroGallery();
          inputEl.value = ''; // reset file input
        }
      };

      function renderHeroGallery() {
        const galleryContainer = document.getElementById('heroGalleryContainer');
        if (!galleryContainer) return;

        galleryContainer.innerHTML = `
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 12px; margin-top: 10px; width: 100%;">
            ${currentHeroImages.map((img, i) => `
              <div style="position: relative; aspect-ratio: 16/9; border-radius: var(--radius-md); border: 1.5px solid var(--border); overflow: hidden; background: var(--bg-secondary); box-shadow: var(--shadow-sm); transition: all 0.2s ease;">
                <img src="${img}" style="width: 100%; height: 100%; object-fit: cover;">
                <button type="button" onclick="window._removeHeroImage(${i})" style="position: absolute; top: 6px; right: 6px; background: rgba(0,0,0,0.75); color: #fff; border: none; border-radius: 50%; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 11px; font-weight: bold; transition: all 0.2s ease; box-shadow: 0 2px 4px rgba(0,0,0,0.35);" onmouseover="this.style.background='var(--primary)'" onmouseout="this.style.background='rgba(0,0,0,0.75)'">&times;</button>
              </div>
            `).join('')}
            <div class="hero-gallery-add" onclick="document.getElementById('sysHeroFile').click()" style="aspect-ratio: 16/9; border-radius: var(--radius-md); border: 1.5px dashed var(--primary); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; cursor: pointer; background: var(--primary-soft); transition: all 0.2s ease; color: var(--primary);" onmouseover="this.style.background='rgba(136,8,8,0.09)'" onmouseout="this.style.background='var(--primary-soft)'">
              <i class="fas fa-plus" style="font-size: 14px;"></i>
              <span style="font-size: 10px; font-weight: 700;">Add Image</span>
            </div>
          </div>
        `;
      }

      pageArea.innerHTML = `
        <div class="page-header">
          <h1 class="page-title">System Maintenance</h1>
          <p class="page-subtitle">Configure application branding, title, logo, and landing page image</p>
        </div>
        <div class="page-content">
          <div class="card" style="padding: 24px; max-width: 700px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px;">
            <h3 style="font-family: var(--font-display); font-size: 18px; font-weight: 700; border-bottom: 1px solid var(--border); padding-bottom: 12px; margin: 0; color: var(--text-primary);">
              <i class="fas fa-palette" style="color: var(--primary); margin-right: 8px;"></i> Application Branding
            </h3>

            <!-- App Title Input -->
            <div style="display: flex; flex-direction: column; gap: 6px;">
              <label style="font-size: 13px; font-weight: 600; color: var(--text-secondary);">Application Title</label>
              <input type="text" id="sysAppTitle" value="${escHtml(title)}" class="form-input" style="width: 100%;" placeholder="e.g. PUPSJ HUB">
            </div>

            <!-- App Subtitle Input -->
            <div style="display: flex; flex-direction: column; gap: 6px;">
              <label style="font-size: 13px; font-weight: 600; color: var(--text-secondary);">Landing Page Subtitle</label>
              <input type="text" id="sysAppSubtitle" value="${escHtml(subtitle)}" class="form-input" style="width: 100%;" placeholder="e.g. San Juan Campus Hub">
            </div>

            <!-- App Description Input -->
            <div style="display: flex; flex-direction: column; gap: 6px;">
              <label style="font-size: 13px; font-weight: 600; color: var(--text-secondary);">System Description</label>
              <textarea id="sysAppDescription" class="form-input" style="width: 100%; min-height: 100px; resize: vertical;" placeholder="Enter system/campus description text...">${escHtml(description)}</textarea>
            </div>

            <!-- App Logo Picker -->
            <div style="display: flex; flex-direction: column; gap: 8px; border-top: 1px dashed var(--border); padding-top: 16px;">
              <label style="font-size: 13px; font-weight: 600; color: var(--text-secondary);">Application Logo</label>
              <div style="display: flex; align-items: center; gap: 16px;">
                <div style="width: 60px; height: 60px; border-radius: 50%; border: 1px solid var(--border); background: var(--bg-secondary); display: flex; align-items: center; justify-content: center; overflow: hidden;">
                  <img id="sysLogoPreview" src="${logo}" style="width: 100%; height: 100%; object-fit: contain;">
                </div>
                <div style="flex: 1;">
                  <input type="file" id="sysLogoFile" accept="image/*" style="display: none;" onchange="
                    const file = this.files[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = (e) => document.getElementById('sysLogoPreview').src = e.target.result;
                      reader.readAsDataURL(file);
                    }
                  ">
                  <button class="btn btn-outlined" onclick="document.getElementById('sysLogoFile').click()" style="padding: 6px 14px; font-size: 12px;">Choose New Logo</button>
                  <p style="font-size: 11px; color: var(--text-muted); margin: 4px 0 0 0;">Recommended: 128x128px PNG</p>
                </div>
              </div>
            </div>

            <!-- App Landing Hero Image Gallery Grid -->
            <div style="display: flex; flex-direction: column; gap: 8px; border-top: 1px dashed var(--border); padding-top: 16px;">
              <label style="font-size: 13px; font-weight: 600; color: var(--text-secondary);">Landing Page Hero Images (Carousel Gallery)</label>
              <p style="font-size: 11px; color: var(--text-muted); margin: 0 0 4px 0;">Upload multiple hero images to dynamically display in your landing page hero slide carousel.</p>
              <div id="heroGalleryContainer" style="width: 100%;"></div>
              <input type="file" id="sysHeroFile" accept="image/*" style="display: none;" onchange="window._uploadHeroImage(this)">
            </div>

            <!-- Save Action -->
            <div style="border-top: 1px solid var(--border); padding-top: 20px; display: flex; justify-content: flex-end; gap: 10px;">
              <button id="sysSaveBtn" class="btn btn-primary" style="padding: 10px 24px; font-weight: 600; display: flex; align-items: center; gap: 8px; width: auto;">
                <i class="fas fa-save"></i> Save Settings
              </button>
            </div>
          </div>
        </div>`;

      // Render the gallery items
      renderHeroGallery();

      // Event listener for saving
      const saveBtn = document.getElementById('sysSaveBtn');
      if (saveBtn) {
        saveBtn.onclick = async () => {
          saveBtn.disabled = true;
          saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

          try {
            const titleInput = document.getElementById('sysAppTitle').value.trim();
            const subtitleInput = document.getElementById('sysAppSubtitle').value.trim();
            const descriptionInput = document.getElementById('sysAppDescription').value.trim();
            const logoFile = document.getElementById('sysLogoFile').files[0];

            let logoUrl = logo;

            // 1. Upload files first if selected
            if (logoFile) {
              const fd = new FormData();
              fd.append('file', logoFile);
              const uploadRes = await fetch('/api/admin/system-settings/upload', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${sessionStorage.getItem('pupsj_token')}` },
                body: fd
              });
              if (!uploadRes.ok) throw new Error('Logo upload failed');
              const logoData = await uploadRes.json();
              logoUrl = logoData.url;
            }

            // 2. Save text settings and image urls
            const settingsPayload = {
              app_title: titleInput || 'PUPSJ HUB',
              app_title_subtitle: subtitleInput || 'San Juan Campus Hub',
              app_description: descriptionInput || 'PUPSJ HUB is the centralized campus portal designed exclusively for the Polytechnic University of the Philippines San Juan Campus. Engineered to optimize campus communication and student organization coordination, this portal serves as a unified progressive portal for faculty, students, and campus administrators alike.',
              app_logo: logoUrl,
              app_landing_hero: currentHeroImages.length > 0 ? currentHeroImages.join(',') : '/landing_hero.png'
            };

            await api('/api/admin/system-settings', {
              method: 'POST',
              body: JSON.stringify(settingsPayload)
            });

            // Update local state immediately
            state.systemSettings = settingsPayload;
            document.title = settingsPayload.app_title;

            showToast('Branding and system settings updated successfully!', 'success');
            
            // Re-render everything so changes apply live!
            render();
            // Re-navigate to stay on system-maintenance view
            navigateTo('system-maintenance');
          } catch (err) {
            console.error(err);
            showToast(err.message || 'Failed to save system settings', 'error');
          } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Settings';
          }
        };
      }

    } catch (e) {
      pageArea.querySelector('.page-content').innerHTML = `
        <div class="empty-state">
          <i class="fas fa-exclamation-triangle"></i>
          <h3>Failed to load system settings</h3>
          <p>${e.message}</p>
        </div>`;
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
  function _adminActions(u) {
    return `<div style="display:flex;flex-direction:row;flex-wrap:wrap;gap:6px;align-items:center;">
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
    const admins   = users.filter(u => u.role === 'admin');
    const faculty  = users.filter(u => u.role === 'faculty');
    const students = users.filter(u => u.role !== 'faculty' && u.role !== 'admin');

    // Group: dept → year → []
    const byDept = {};
    students.forEach(u => {
      const d = u.department || 'No Department';
      const y = u.year_level  || 'Unknown';
      if (!byDept[d]) byDept[d] = {};
      if (!byDept[d][y]) byDept[d][y] = [];
      byDept[d][y].push(u);
    });

    // Admins table
    const adminRows = admins.length === 0
      ? `<tr><td colspan="5" style="text-align:center;padding:28px;color:var(--text-light);">No administrator accounts</td></tr>`
      : admins.map(u => `<tr>
          <td><strong>${escHtml(u.first_name)} ${escHtml(u.last_name || 'ADMIN')}</strong><br>
              <span style="font-size:11px;color:var(--text-light);">${escHtml(u.email)}</span></td>
          <td>
            <span class="editable-id" style="cursor:pointer; border-bottom: 1.5px dashed var(--primary); display:inline-block;" title="Click to edit ID" onclick="window._editUserIdNumber('${u.id}', '${escHtml(u.student_number || '')}', '${escHtml(u.first_name)} ${escHtml(u.last_name || '')}')">
              ${escHtml(u.student_number || '—')} <i class="fas fa-edit" style="font-size:10px; opacity:0.6; margin-left:4px;"></i>
            </span>
          </td>
          <td>${escHtml(u.department || '—')}${u.position ? `<br><small style="color:var(--text-light);">${escHtml(u.position)}</small>` : ''}</td>
          <td>${_userStatus(u)}</td>
          <td>${_adminActions(u)}</td>
        </tr>`).join('');

    const isSuperAdmin = state.user?.role === 'superadmin';
    const adminSection = isSuperAdmin ? `
      <div class="admin-role-section">
        <div class="admin-role-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <i class="fas fa-user-shield"></i> Administrators
            <span class="admin-count-badge">${admins.length}</span>
          </div>
          <button class="btn btn-gold btn-sm" style="width:auto; height:34px; border-radius:17px; font-weight:600; font-size:12px; padding:0 14px; margin:0;" onclick="window._openCreateAdminModal()">
            <i class="fas fa-user-plus"></i> Add Admin
          </button>
        </div>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead><tr><th>Name</th><th>ID Number</th><th>Department / Position</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>${adminRows}</tbody>
          </table>
        </div>
      </div>
    ` : '';

    // Faculty table
    const facultyRows = faculty.length === 0
      ? `<tr><td colspan="4" style="text-align:center;padding:28px;color:var(--text-light);">No faculty accounts</td></tr>`
      : faculty.map(u => `<tr>
          <td><strong>${escHtml(u.first_name)} ${escHtml(u.last_name)}</strong><br>
              <span style="font-size:11px;color:var(--text-light);">${escHtml(u.email)}</span></td>
          <td>
            <span class="editable-id" style="cursor:pointer; border-bottom: 1.5px dashed var(--primary); display:inline-block;" title="Click to edit ID" onclick="window._editUserIdNumber('${u.id}', '${escHtml(u.student_number || '')}', '${escHtml(u.first_name)} ${escHtml(u.last_name || '')}')">
              ${escHtml(u.student_number || '—')} <i class="fas fa-edit" style="font-size:10px; opacity:0.6; margin-left:4px;"></i>
            </span>
          </td>
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
            <td>
              <span class="editable-id" style="cursor:pointer; border-bottom: 1.5px dashed var(--primary); display:inline-block;" title="Click to edit ID" onclick="window._editUserIdNumber('${u.id}', '${escHtml(u.student_number || '')}', '${escHtml(u.first_name)} ${escHtml(u.last_name || '')}')">
                ${escHtml(u.student_number || '—')} <i class="fas fa-edit" style="font-size:10px; opacity:0.6; margin-left:4px;"></i>
              </span>
            </td>
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
      ${adminSection}
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
    if (!await window.showSystemConfirm('Delete this user permanently?')) return;
    try {
      await api(`/api/admin/users/${id}`, { method: 'DELETE' });
      showToast('User deleted', 'success');
      loadAdminUsers();
    } catch (err) { showToast(err.message, 'error'); }
  };

  window._editUserIdNumber = async (userId, currentId, fullName) => {
    const newId = await window.showSystemPrompt(`Edit ID Number for ${fullName}:`, currentId);
    if (newId === null) return;
    const trimmed = newId.trim().toUpperCase();
    if (trimmed === currentId) return;
    if (!trimmed) {
      showToast('ID number cannot be empty', 'error');
      return;
    }
    try {
      await api(`/api/admin/users/${userId}/id-number`, {
        method: 'PATCH',
        body: JSON.stringify({ id_number: trimmed })
      });
      showToast('ID number updated successfully!', 'success');
      loadAdminUsers();
    } catch (err) {
      showToast(err.message || 'Failed to update ID number', 'error');
    }
  };

  window._openCreateAdminModal = () => {
    openModal('admin-create');
  };

  window._deleteAllowedReg = async (id) => {
    if (!await window.showSystemConfirm('Remove this ID from the allowed list? If the user has already registered, their account will ALSO be deleted.')) return;
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
    if (!await window.showSystemConfirm(warning)) return;
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
  // Helper to setup user autocomplete whitelisting UI for students and faculty
  function setupUserAutocomplete(inputEl, resultsEl, tagsContainerEl, initialSelectedUsers = []) {
    let selectedUsers = [...initialSelectedUsers];

    function renderTags() {
      tagsContainerEl.innerHTML = selectedUsers.map(u => `
        <div class="user-tag" data-id="${u.id}">
          <span class="user-tag-avatar">${getInitials(u.first_name + ' ' + u.last_name)}</span>
          <span class="user-tag-name">${escHtml(u.first_name)} ${escHtml(u.last_name)} <small>(${escHtml(u.role)})</small></span>
          <button type="button" class="user-tag-close" onclick="window._removeUserTag('${u.id}')">&times;</button>
        </div>
      `).join('');
    }

    window._removeUserTag = (userId) => {
      selectedUsers = selectedUsers.filter(u => u.id !== userId);
      renderTags();
    };

    let debounceTimer = null;
    inputEl.oninput = () => {
      const q = inputEl.value.trim();
      clearTimeout(debounceTimer);
      if (!q) {
        resultsEl.innerHTML = '';
        resultsEl.style.display = 'none';
        return;
      }

      debounceTimer = setTimeout(async () => {
        try {
          const users = await api(`/api/documents/users-search?q=${encodeURIComponent(q)}`);
          if (users.length === 0) {
            resultsEl.innerHTML = '<div class="user-autocomplete-no-results">No users found</div>';
            resultsEl.style.display = 'block';
            return;
          }

          resultsEl.innerHTML = users.map(u => {
            const isSelected = selectedUsers.some(su => su.id === u.id);
            return `
              <div class="user-autocomplete-item ${isSelected ? 'selected' : ''}" data-user-json="${escHtml(JSON.stringify(u))}">
                <div class="user-item-avatar">${getInitials(u.first_name + ' ' + u.last_name)}</div>
                <div class="user-item-info">
                  <div class="user-item-name">${escHtml(u.first_name)} ${escHtml(u.last_name)} <span class="user-item-role">${escHtml(u.role)}</span></div>
                  <div class="user-item-sub">${escHtml(u.email)} • ${escHtml(u.department || 'No Dept')}</div>
                </div>
              </div>
            `;
          }).join('');

          resultsEl.querySelectorAll('.user-autocomplete-item').forEach(item => {
            item.onclick = () => {
              if (item.classList.contains('selected')) return;
              const u = JSON.parse(item.dataset.userJson);
              if (!selectedUsers.some(su => su.id === u.id)) {
                selectedUsers.push(u);
                renderTags();
              }
              inputEl.value = '';
              resultsEl.innerHTML = '';
              resultsEl.style.display = 'none';
            };
          });

          resultsEl.style.display = 'block';
        } catch (err) {
          console.error('Search autocomplete error:', err);
        }
      }, 250);
    };

    document.addEventListener('click', (e) => {
      if (!inputEl.contains(e.target) && !resultsEl.contains(e.target)) {
        resultsEl.style.display = 'none';
      }
    });

    renderTags();
    return () => selectedUsers.map(u => u.id);
  }

  function openModal(type, modalData) {
    let title, bodyHtml, onSubmit, footerHtml = null;
    pendingFiles = [];

    switch (type) {
      case 'admin-create': {
        title = 'Create Admin Account';
        bodyHtml = `
          <div class="form-group">
            <label>Full Name <span class="req">*</span></label>
            <input type="text" class="form-input" id="adminCreateName" placeholder="e.g. Jane Doe" required autocomplete="off">
          </div>
          <div class="form-group">
            <label>Email <span class="req">*</span></label>
            <input type="email" class="form-input" id="adminCreateEmail" placeholder="e.g. jane.doe@pupsj.edu.ph" required autocomplete="off">
          </div>
          <div class="form-group">
            <label>Password <span class="req">*</span></label>
            <input type="password" class="form-input" id="adminCreatePassword" placeholder="Min. 6 characters" required autocomplete="off">
          </div>
          <div class="form-group">
            <label>Position / Title <span class="muted-hint">(optional)</span></label>
            <input type="text" class="form-input" id="adminCreatePosition" placeholder="e.g., Associate Dean" autocomplete="off">
          </div>
        `;
        onSubmit = async () => {
          const first_name = document.getElementById('adminCreateName').value.trim();
          const email = document.getElementById('adminCreateEmail').value.trim();
          const password = document.getElementById('adminCreatePassword').value;
          const position = document.getElementById('adminCreatePosition').value.trim() || null;

          if (!first_name || !email || !password) {
            showToast('Please fill in all required fields', 'error');
            return;
          }
          if (password.length < 6) {
            showToast('Password must be at least 6 characters', 'error');
            return;
          }

          const payload = { first_name, email, password, department: null, position };
          try {
            await api('/api/admin/create-admin', {
              method: 'POST',
              body: JSON.stringify(payload)
            });
            showToast('Admin account created successfully! Welcome email sent.', 'success');
            closeModal();
            loadAdminUsers();
          } catch (err) {
            showToast(err.message || 'Failed to create admin', 'error');
          }
        };
        break;
      }
      case 'facultyStatus': {
        title = 'Set My Status';
        
        // Detect if the pre-existing status is already expired
        const untilTime = state.user.faculty_status_until ? new Date(state.user.faculty_status_until).getTime() : 0;
        const isExpired = untilTime > 0 && untilTime < Date.now();

        const current = isExpired ? 'unavailable' : (state.user.faculty_status || 'unavailable');
        const room = isExpired ? '' : (state.user.faculty_status_room || '');
        const note = isExpired ? '' : (state.user.faculty_status_note || '');
        // Convert UTC → local for the datetime-local input (which expects local time).
        let until = '';
        if (state.user.faculty_status_until && !isExpired) {
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
          
          const untilInput = document.getElementById('statusUntil').value;
          const payload = {
            status: selected.value,
            room: document.getElementById('statusRoom').value.trim() || null,
            note: document.getElementById('statusNote').value.trim() || null,
            until: untilInput ? new Date(untilInput).toISOString() : null,
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
              ${(state.user.role === 'admin' || state.user.role === 'faculty' || state.user.role === 'superadmin'
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

      case 'event': {
        const isEdit = !!modalData;
        title = isEdit ? 'Edit Event' : 'Create Event';
        state.builderQuestions = isEdit && modalData.feedback_form_schema
          ? (typeof modalData.feedback_form_schema === 'string'
              ? JSON.parse(modalData.feedback_form_schema)
              : modalData.feedback_form_schema)
          : [];
        
        let isFeedbackLocked = false;
        if (isEdit && modalData.event_date) {
          const datePart = getEventDateString(modalData);
          let targetTime = modalData.end_time || modalData.start_time || '23:59:59';
          if (targetTime.split(':').length === 2) {
            targetTime += ':00';
          }
          const evEndDateTime = new Date(`${datePart}T${targetTime}`);
          const isAdmin = state.user.role === 'admin' || state.user.role === 'superadmin';
          if (evEndDateTime < new Date() && !isAdmin) {
            isFeedbackLocked = true;
          }
        }
        state.isEventEnded = isFeedbackLocked;
        
        bodyHtml = `
          <div class="event-modal-split">
            <div class="event-modal-details-column" style="display:flex; flex-direction:column; gap:12px;">
              <div class="form-group">
                <label>Event Title <span class="req">*</span></label>
                <input type="text" class="form-input" id="modalTitle" placeholder="Event name" value="${isEdit ? escHtml(modalData.title) : ''}">
              </div>
              <div class="form-group">
                <label>Description</label>
                <textarea class="form-input" id="modalDesc" rows="3" placeholder="Event details..." style="resize:vertical;">${isEdit ? escHtml(modalData.description || '') : ''}</textarea>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>Date <span class="req">*</span></label>
                  <input type="date" class="form-input" id="modalDate" min="${isEdit ? '' : new Date().toISOString().split('T')[0]}" value="${isEdit && modalData.event_date ? modalData.event_date.split('T')[0] : ''}">
                </div>
                <div class="form-group">
                  <label>Location</label>
                  <input type="text" class="form-input" id="modalLocation" placeholder="Venue" value="${isEdit ? escHtml(modalData.location || '') : ''}">
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>Start Time</label>
                  <input type="time" class="form-input" id="modalStart" value="${isEdit ? modalData.start_time || '' : ''}">
                </div>
                <div class="form-group">
                  <label>End Time</label>
                  <input type="time" class="form-input" id="modalEnd" value="${isEdit ? modalData.end_time || '' : ''}">
                </div>
              </div>
              <div class="form-group">
                <label>Visibility</label>
                <select class="form-input form-select" id="modalDept">
                  ${(state.user.role === 'admin' || state.user.role === 'faculty' || state.user.role === 'superadmin'
                    ? departments.filter(d => d !== 'All')
                    : ['General', state.user.department].filter(Boolean).filter((v,i,a) => a.indexOf(v)===i)
                  ).map(d => `<option value="${d}"${isEdit && modalData.department === d ? ' selected' : (d === 'General' ? ' selected' : '')}>${d}</option>`).join('')}
                </select>
                <div class="form-help"><i class="fas fa-info-circle"></i> <strong>General</strong> and <strong>Campus</strong> are visible to everyone. Department options limit the event to that department.</div>
              </div>
              ${isEdit ? '' : `
              <div class="form-group">
                <label>Event Photos</label>
                ${renderImageUploadWidget('eventImages')}
              </div>
              `}
            </div>
            
            <div class="event-modal-survey-column">
              <!-- CUSTOM QUESTIONNAIRE BUILDER SECTION -->
              ${state.isEventEnded ? `
                <div class="alert alert-warning" style="margin-bottom:12px; font-size:12px; padding:10px; display:flex; align-items:center; gap:8px; border-radius:6px; border:1px solid #d97706; background:rgba(217,119,6,0.06); color:#d97706; font-weight: 500;">
                  <i class="fas fa-exclamation-triangle"></i> This event has ended. Questionnaire is locked and cannot be edited.
                </div>
              ` : ''}
              <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 12px;">
                <label style="font-weight: 700; display:flex; align-items:center; gap:8px; margin:0;">
                  <i class="fas fa-poll-h" style="color:#880808;"></i> Custom Feedback Form (Optional)
                </label>
                <button type="button" class="btn-pill-outline" id="addQuestionBtn" ${state.isEventEnded ? 'disabled style="opacity:0.5; cursor:not-allowed;" title="Cannot edit custom questions after the event has ended"' : ''}>
                  <i class="fas fa-plus"></i> Add Question
                </button>
              </div>
              <p class="form-help" style="margin-top:0; margin-bottom:12px;">Build custom questions (Short Answer, Multiple Choice, Linear Scale, Star Rating, etc.) for attendees to answer after the event has passed.</p>
              <div id="builderQuestionsList" style="display:flex; flex-direction:column; gap:12px;"></div>
            </div>
          </div>
          
          ${state.user.role !== 'admin' ? '<div class="form-note" style="margin-top: 16px;"><i class="fas fa-clock"></i> Your event will be reviewed by an admin before it appears in the calendar.</div>' : ''}
        `;
        
        onSubmit = async () => {
          const titleVal = document.getElementById('modalTitle').value.trim();
          const description = document.getElementById('modalDesc').value.trim();
          const event_date = document.getElementById('modalDate').value;
          const location = document.getElementById('modalLocation').value.trim();
          const start_time = document.getElementById('modalStart').value;
          const end_time = document.getElementById('modalEnd').value;
          const department = document.getElementById('modalDept').value;
          if (!titleVal || !event_date) { showToast('Please fill in title and date', 'error'); return; }

          const compiledSchema = compileFormBuilderSchema();

          if (isEdit) {
            const payload = {
              title: titleVal,
              description,
              event_date,
              location,
              start_time,
              end_time,
              department,
              feedback_form_schema: compiledSchema
            };
            const res = await api(`/api/events/${modalData.id}`, {
              method: 'PATCH',
              body: JSON.stringify(payload)
            });
            showToast('Event updated successfully!', 'success');
            closeModal();
            window._openEventDetail(modalData.id);
          } else {
            const formData = new FormData();
            formData.append('title', titleVal);
            formData.append('description', description);
            formData.append('event_date', event_date);
            formData.append('location', location);
            formData.append('start_time', start_time);
            formData.append('end_time', end_time);
            formData.append('department', department);
            formData.append('feedback_form_schema', JSON.stringify(compiledSchema));
            pendingFiles.forEach(f => formData.append('images', f));

            const res = await apiFormData('/api/events', formData);
            showToast(res.message || 'Event created!', 'success');
            closeModal();
            loadEvents();
          }
        };
        
        setTimeout(() => {
          const addQBtn = document.getElementById('addQuestionBtn');
          if (addQBtn) addQBtn.onclick = window._addBuilderQuestion;
          renderBuilderQuestions();
        }, 50);

        break;
      }

      case 'feedback-submit': {
        const event = modalData;
        title = 'Event Feedback Survey';
        const schema = event.feedback_form_schema || [];
        
        bodyHtml = `
          <p style="font-size:13px; color:var(--text-secondary); margin-top:0; margin-bottom:20px;">
            Thank you for participating in "${escHtml(event.title)}"! Please answer the questionnaire below. Required fields are marked with <span class="req">*</span>.
          </p>
          <form id="customFeedbackSurveyForm" style="display:flex; flex-direction:column; gap:20px;">
            ${schema.map((q, idx) => {
              let fieldHtml = '';
              const reqLabel = q.required ? '<span class="req">*</span>' : '';
              
              if (q.type === 'Short Answer') {
                fieldHtml = `<input type="text" class="form-input" id="q_${q.id}" ${q.required ? 'required' : ''} placeholder="Your answer...">`;
              } else if (q.type === 'Paragraph') {
                fieldHtml = `<textarea class="form-input" id="q_${q.id}" rows="3" ${q.required ? 'required' : ''} placeholder="Your answer..." style="resize:vertical;"></textarea>`;
              } else if (q.type === 'Dropdown') {
                fieldHtml = `
                  <select class="form-input form-select" id="q_${q.id}" ${q.required ? 'required' : ''}>
                    <option value="">Choose option...</option>
                    ${(q.options || []).map(opt => `<option value="${escHtml(opt)}">${escHtml(opt)}</option>`).join('')}
                  </select>
                `;
              } else if (q.type === 'Multiple Choice') {
                fieldHtml = `
                  <div style="display:flex; flex-direction:column; gap:8px;">
                    ${(q.options || []).map(opt => `
                      <label style="display:inline-flex; align-items:center; gap:8px; cursor:pointer; font-size:13px;">
                        <input type="radio" name="q_${q.id}" value="${escHtml(opt)}" ${q.required ? 'required' : ''}>
                        <span>${escHtml(opt)}</span>
                      </label>
                    `).join('')}
                  </div>
                `;
              } else if (q.type === 'Checkboxes') {
                fieldHtml = `
                  <div style="display:flex; flex-direction:column; gap:8px;">
                    ${(q.options || []).map(opt => `
                      <label style="display:inline-flex; align-items:center; gap:8px; cursor:pointer; font-size:13px;">
                        <input type="checkbox" name="q_${q.id}" value="${escHtml(opt)}">
                        <span>${escHtml(opt)}</span>
                      </label>
                    `).join('')}
                  </div>
                `;
              } else if (q.type === 'Linear Scale') {
                const minVal = q.scale_min || 1;
                const maxVal = q.scale_max || 5;
                fieldHtml = `
                  <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                    <span style="font-size:12px; color:var(--text-secondary);">${escHtml(q.scale_min_label || '')}</span>
                    <div style="display:flex; gap:6px;">
                      ${Array.from({ length: maxVal - minVal + 1 }, (_, i) => minVal + i).map(val => `
                        <label class="scale-btn" style="width:36px; height:36px; display:inline-flex; align-items:center; justify-content:center; border:1px solid var(--border); border-radius:50%; cursor:pointer; font-weight:600; font-size:13px; transition:all 0.2s;">
                          <input type="radio" name="q_${q.id}" value="${val}" style="display:none;" onchange="this.parentElement.parentElement.querySelectorAll('label').forEach(l => l.classList.remove('active')); this.parentElement.classList.add('active');" ${q.required ? 'required' : ''}>
                          ${val}
                        </label>
                      `).join('')}
                    </div>
                    <span style="font-size:12px; color:var(--text-secondary);">${escHtml(q.scale_max_label || '')}</span>
                  </div>
                `;
              } else if (q.type === 'Rating') {
                fieldHtml = `
                  <div style="display:flex; align-items:center; gap:6px;">
                    <div class="star-rating" id="stars_${q.id}" style="display:flex; gap:4px; font-size:22px;">
                      ${[1, 2, 3, 4, 5].map(val => `
                        <i class="far fa-star" style="cursor:pointer;" data-val="${val}" 
                           onclick="window._setCustomStarRating('${q.id}', ${val})" 
                           onmouseenter="window._hoverCustomStarRating('${q.id}', ${val})" 
                           onmouseleave="window._hoverCustomStarRating('${q.id}', ${val}, true)">
                        </i>
                      `).join('')}
                    </div>
                    <input type="hidden" id="q_${q.id}" value="" ${q.required ? 'required' : ''}>
                  </div>
                `;
              }

              return `
                <div class="form-group" style="padding:14px; border:1px solid var(--border); border-radius:8px; background:var(--bg-soft);">
                  <label style="font-weight:700; font-size:13.5px; color:var(--text-primary); margin-bottom:4px; display:block;">${idx + 1}. ${escHtml(q.title)} ${reqLabel}</label>
                  ${q.description ? `<p style="font-size:11.5px; color:var(--text-secondary); margin-top:0; margin-bottom:10px;">${escHtml(q.description)}</p>` : ''}
                  <div style="margin-top:8px;">${fieldHtml}</div>
                </div>
              `;
            }).join('')}
          </form>
        `;
        
        onSubmit = async () => {
          const answers = {};
          for (const q of schema) {
            let ans = '';
            if (['Short Answer', 'Paragraph', 'Dropdown'].includes(q.type)) {
              const el = document.getElementById(`q_${q.id}`);
              ans = el ? el.value.trim() : '';
            } else if (q.type === 'Rating') {
              const el = document.getElementById(`q_${q.id}`);
              ans = el ? el.value : '';
            } else if (q.type === 'Linear Scale' || q.type === 'Multiple Choice') {
              const selected = document.querySelector(`input[name="q_${q.id}"]:checked`);
              ans = selected ? selected.value : '';
            } else if (q.type === 'Checkboxes') {
              const checked = Array.from(document.querySelectorAll(`input[name="q_${q.id}"]:checked`)).map(c => c.value);
              ans = checked;
            }

            if (q.required && (!ans || (Array.isArray(ans) && ans.length === 0))) {
              showToast(`Please answer the required question: "${q.title}"`, 'error');
              throw new Error(`Required question left unanswered: "${q.title}"`);
            }
            answers[q.id] = ans;
          }

          await api(`/api/events/${event.id}/feedback-submit`, {
            method: 'POST',
            body: JSON.stringify({ answers })
          });
          
          showToast('Survey submitted successfully! Thank you.', 'success');
          closeModal();
          window._openEventDetail(event.id);
        };
        break;
      }

      case 'lostfound':
        title = 'Report Item';
        bodyHtml = `
          <div class="form-group">
            <label>Type</label>
            <div class="lf-tabs" style="margin-bottom:0;">
              <button class="lf-tab active" data-val="lost" id="lfTypeLost">I Lost Something</button>
              ${(state.user.role === 'admin' || state.user.role === 'superadmin') ? '<button class="lf-tab" data-val="found" id="lfTypeFound">I Found Something</button>' : ''}
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
            <label>Date Lost/Found <span class="req">*</span></label>
            <input type="date" class="form-input" id="modalItemDate" max="${new Date().toISOString().split('T')[0]}" value="${new Date().toISOString().split('T')[0]}">
          </div>
          <div class="form-group">
            <label>Contact Information <span class="req">*</span></label>
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

          const dateVal = document.getElementById('modalItemDate').value;
          if (!dateVal) {
            showToast('Please select a date lost/found', 'error');
            if (submitButton) submitButton.disabled = false;
            return;
          }

          const data = {
            type: document.getElementById('modalLFType').value,
            item_name: document.getElementById('modalItemName').value.trim(),
            description: document.getElementById('modalItemDesc').value.trim(),
            category: document.getElementById('modalItemCat').value,
            location_found: document.getElementById('modalItemLoc').value.trim(),
            contact_info: document.getElementById('modalItemContact').value.trim(),
            date_lost_found: dateVal
          };
          if (!data.item_name || !data.description) { 
            showToast('Please fill in item name and description', 'error'); 
            if (submitButton) submitButton.disabled = false;
            return; 
          }
          if (!data.contact_info) {
            showToast('Contact Information is required', 'error');
            if (submitButton) submitButton.disabled = false;
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
        title = 'Upload Schedule';
        bodyHtml = `
          <div class="form-group">
            <label>Schedule Target Category</label>
            <div class="lf-tabs" style="margin-bottom:16px;">
              <button type="button" class="lf-tab active" id="ssTargetStudent">Student</button>
              <button type="button" class="lf-tab" id="ssTargetFaculty">Faculty</button>
            </div>
            <input type="hidden" id="ssTargetType" value="section">
          </div>
          <div class="form-group">
            <label>Schedule Title <span class="req">*</span></label>
            <input type="text" class="form-input" id="ssTitle" placeholder="e.g., BSIT 1-A Schedule AY 2024-2025" required>
          </div>
          
          <!-- STUDENT FIELDS -->
          <div id="ssStudentFields">
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
              <label>Section <span class="req">*</span></label>
              <input type="text" class="form-input" id="ssSection" placeholder="e.g., 1-1, 2-2">
            </div>
          </div>

          <!-- FACULTY FIELDS -->
          <div id="ssFacultyFields" style="display:none;">
            <div class="form-group" style="position:relative;">
              <label>Search & Select Faculty Member <span class="req">*</span></label>
              <div style="position:relative;">
                <input type="text" class="form-input" id="ssFacultySearch" placeholder="Type faculty name to search..." autocomplete="off">
                <div id="ssFacultySuggestions" class="autocomplete-suggestions" style="display:none; position:absolute; top:100%; left:0; right:0; background:var(--bg-card); border:1px solid var(--border); border-radius:8px; max-height:180px; overflow-y:auto; z-index:1000; box-shadow:var(--shadow-lg); padding: 4px 0;"></div>
              </div>
              <input type="hidden" id="ssFacultyId" value="">
              <div id="ssFacultySelectedName" style="margin-top:8px; font-weight:600; font-size:13px; color:#1565c0; display:none;">
                <i class="fas fa-check-circle"></i> Selected Faculty: <span id="ssFacultySelectedLabel" style="font-weight:700;"></span>
              </div>
            </div>
          </div>

          <div class="form-group">
            <label id="ssUrlLabel">Schedule Link (optional)</label>
            <input type="url" class="form-input" id="ssUrl" placeholder="https://drive.google.com/...">
            <small style="color:var(--text-light);font-size:11px;" id="ssUrlHint">Paste a Google Drive, Docs, or any URL to the schedule</small>
          </div>`;
          
        onSubmit = async () => {
          const target_type = document.getElementById('ssTargetType').value;
          const title_val = document.getElementById('ssTitle').value.trim();
          const embed_url = document.getElementById('ssUrl').value.trim();

          if (!title_val) {
            showToast('Schedule Title is required', 'error');
            return;
          }

          if (target_type === 'section') {
            const department = document.getElementById('ssDept').value;
            const year_level = document.getElementById('ssYear').value;
            const section = document.getElementById('ssSection').value.trim();
            if (!section) {
              showToast('Section is required for Student schedules', 'error');
              return;
            }

            await api('/api/section-schedules', {
              method: 'POST',
              body: JSON.stringify({
                target_type: 'section',
                title: title_val,
                department,
                year_level,
                section,
                embed_url
              })
            });
          } else {
            const faculty_id = document.getElementById('ssFacultyId').value;
            if (!faculty_id) {
              showToast('Please search and select a faculty member', 'error');
              return;
            }
            if (!embed_url) {
              showToast('Embedded link is required for Faculty schedules', 'error');
              return;
            }

            await api('/api/section-schedules', {
              method: 'POST',
              body: JSON.stringify({
                target_type: 'faculty',
                title: title_val,
                faculty_id,
                embed_url
              })
            });
          }

          showToast('Schedule posted!', 'success');
          closeModal();
          loadSectionSchedules();
        };
        break;

      case 'custom-confirm': {
        const rd = modalData || {};
        title = rd.title || 'Are you sure?';
        bodyHtml = `
          <div style="display: flex; gap: 16px; align-items: flex-start; padding: 12px 6px;">
            <div style="width: 44px; height: 44px; background: rgba(136, 8, 8, 0.1); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--primary); font-size: 20px; flex-shrink: 0;">
              <i class="fas ${rd.icon || 'fa-exclamation-triangle'}"></i>
            </div>
            <div style="flex: 1;">
              <p style="font-size: 15px; font-weight: 700; color: var(--text-primary); margin: 0 0 6px 0;">${escHtml(rd.message || 'Please confirm this action.')}</p>
              ${rd.submessage ? `<p style="font-size: 13px; color: var(--text-secondary); margin: 0; line-height: 1.5;">${escHtml(rd.submessage)}</p>` : ''}
            </div>
          </div>`;
        footerHtml = `
          <button class="btn btn-secondary btn-sm" onclick="closeModal()" style="font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 6px;">
            Cancel
          </button>
          <button class="btn btn-primary btn-sm" id="modalSubmit" style="font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 6px;">
            ${escHtml(rd.yesLabel || 'Confirm')}
          </button>`;
        onSubmit = async () => {
          if (typeof rd.onConfirm === 'function') {
            await rd.onConfirm();
          }
          closeModal();
        };
        break;
      }

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
            <label>Date Lost/Found <span class="req">*</span></label>
            <input type="date" class="form-input" id="modalItemDate" max="${new Date().toISOString().split('T')[0]}" value="${lfItem.date_lost_found ? lfItem.date_lost_found.split('T')[0] : new Date().toISOString().split('T')[0]}">
          </div>
          <div class="form-group">
            <label>Contact Information <span class="req">*</span></label>
            <input type="text" class="form-input" id="modalItemContact" value="${escHtml(lfItem.contact_info || '')}" placeholder="Phone, email, messenger">
          </div>
          <div class="form-group">
            <label>Photos (updates existing photos)</label>
            ${renderImageUploadWidget('lfImagesEdit')}
          </div>`;
        onSubmit = async () => {
          const submitButton = document.getElementById('modalSubmit');
          if (submitButton) submitButton.disabled = true;

          const dateVal = document.getElementById('modalItemDate').value;
          if (!dateVal) {
            showToast('Please select a date lost/found', 'error');
            if (submitButton) submitButton.disabled = false;
            return;
          }
          const data = {
            type: document.getElementById('modalLFType').value,
            item_name: document.getElementById('modalItemName').value.trim(),
            description: document.getElementById('modalItemDesc').value.trim(),
            category: document.getElementById('modalItemCat').value,
            location_found: document.getElementById('modalItemLoc').value.trim(),
            contact_info: document.getElementById('modalItemContact').value.trim(),
            date_lost_found: dateVal
          };
          if (!data.item_name || !data.description) {
            showToast('Please fill in item name and description', 'error');
            if (submitButton) submitButton.disabled = false;
            return;
          }
          if (!data.contact_info) {
            showToast('Contact Information is required', 'error');
            if (submitButton) submitButton.disabled = false;
            return;
          }

          const formData = new FormData();
          Object.entries(data).forEach(([k, v]) => formData.append(k, v));
          const fingerprints = await fingerprintFiles(pendingFiles);
          formData.append('image_fingerprints', JSON.stringify(fingerprints));
          pendingFiles.forEach(f => formData.append('images', f));

          try {
            await apiFormData(`/api/lost-found/${lfItem.id}`, formData, 'PATCH');
            showToast('Item updated', 'success');
            closeModal();
            loadLostFound();
          } catch (err) {
            showToast(err.message || 'Update failed', 'error');
            if (submitButton) submitButton.disabled = false;
          }
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

      case 'doc-category-edit': {
        title = 'Edit Folder';
        const currentDept = modalData?.department || 'General';
        const deptOptions = (state.user.role === 'admin' || state.user.role === 'superadmin' || state.user.role === 'faculty'
          ? departments.filter(d => d !== 'All')
          : Array.from(new Set(['General', state.user.department, currentDept].filter(Boolean)))
        ).filter(d => d !== 'Campus');
        if (!deptOptions.includes('Specific Students')) {
          deptOptions.push('Specific Students');
        }
        bodyHtml = `
          <div class="form-group">
            <label>Folder Name</label>
            <input type="text" class="form-input" id="modalCatName" placeholder="e.g., Accreditation Forms">
          </div>
          <div class="form-group">
            <label>Description (optional)</label>
            <textarea class="form-input" id="modalCatDesc" rows="3" placeholder="Brief description of this category..." style="resize:vertical;"></textarea>
          </div>
          <div class="form-group">
            <label>Visible to</label>
            <select class="form-input form-select" id="modalCatDept">
              ${deptOptions.map(d => `<option value="${d}"${d === currentDept ? ' selected' : ''}>${d === 'Specific Students' ? 'Specific Users' : escHtml(d)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" id="catAutocompleteGroup" style="display:none; margin-top: 14px;">
            <label>Search and Whitelist Users (Students & Faculty)</label>
            <div class="user-autocomplete-wrap" style="position:relative;">
              <i class="fas fa-user-plus search-box-icon" style="position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--text-light); font-size:12px;"></i>
              <input type="text" class="form-input" id="catUserSearchInput" placeholder="Search by name, email, or ID..." style="padding-left:34px;">
              <div class="user-autocomplete-results" id="catUserSearchResults" style="display:none;"></div>
            </div>
            <div class="user-tags-container" id="catUserTagsContainer" style="margin-top:10px;"></div>
          </div>`;
        let getWhitelistedUserIds = () => [];
        onSubmit = async () => {
          const name = document.getElementById('modalCatName').value.trim();
          if (!name) { showToast('Please enter a category name', 'error'); return; }
          const department = document.getElementById('modalCatDept').value;
          const whitelist_student_ids = getWhitelistedUserIds();
          await api(`/api/documents/categories/${modalData.id}`, { 
            method: 'PATCH', 
            body: JSON.stringify({ 
              name, 
              description: document.getElementById('modalCatDesc').value.trim(),
              department,
              whitelist_student_ids
            }) 
          });
          showToast('Category updated!', 'success');
          closeModal();
          loadDocuments();
        };
        break;
      }

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
                ${(state.user.role === 'admin' || state.user.role === 'superadmin' || state.user.role === 'faculty'
                  ? departments.filter(d => d !== 'All')
                  : ['General', state.user.department].filter(Boolean)
                ).filter(d => d !== 'Campus').map(d => `<option value="${d}"${(state.user.role !== 'admin' && state.user.role !== 'superadmin' && state.user.role !== 'faculty') && d === state.user.department ? ' selected' : ''}>${escHtml(d)}</option>`).join('')}
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
        const deptOptions = (state.user.role === 'admin' || state.user.role === 'superadmin' || state.user.role === 'faculty'
          ? departments.filter(d => d !== 'All')
          : Array.from(new Set(['General', state.user.department, currentDept].filter(Boolean)))
        ).filter(d => d !== 'Campus');
        if (!deptOptions.includes('Specific Students')) {
          deptOptions.push('Specific Students');
        }
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
                ${deptOptions.map(d => `<option value="${d}"${d === currentDept ? ' selected' : ''}>${d === 'Specific Students' ? 'Specific Users' : escHtml(d)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-group" id="docAutocompleteGroup" style="display:none; margin-top: 14px;">
            <label>Search and Whitelist Users (Students & Faculty)</label>
            <div class="user-autocomplete-wrap" style="position:relative;">
              <i class="fas fa-user-plus search-box-icon" style="position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--text-light); font-size:12px;"></i>
              <input type="text" class="form-input" id="docUserSearchInput" placeholder="Search by name, email, or ID..." style="padding-left:34px;">
              <div class="user-autocomplete-results" id="docUserSearchResults" style="display:none;"></div>
            </div>
            <div class="user-tags-container" id="docUserTagsContainer" style="margin-top:10px;"></div>
          </div>`;
        let getWhitelistedUserIds = () => [];
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
              whitelist_student_ids: getWhitelistedUserIds()
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
              ${(state.user.role === 'admin' || state.user.role === 'superadmin')
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
          if (state.user.role === 'admin' || state.user.role === 'superadmin') {
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
        
        title = existing ? 'Edit Schedule' : 'Upload Schedule';
        bodyHtml = `
          <div class="form-group">
            <label>Schedule Target Category</label>
            <div class="lf-tabs" style="margin-bottom:16px;">
              <button type="button" class="lf-tab active" id="ssTargetStudent">Student</button>
              <button type="button" class="lf-tab" id="ssTargetFaculty">Faculty</button>
            </div>
            <input type="hidden" id="ssTargetType" value="section">
          </div>
          <div class="form-group">
            <label>Schedule Title <span class="req">*</span></label>
            <input type="text" class="form-input" id="ssTitle" placeholder="e.g., BSIT 1-A Schedule AY 2024-2025" value="${escHtml(e.title || '')}" required>
          </div>
          
          <!-- STUDENT FIELDS -->
          <div id="ssStudentFields">
            <div class="form-row">
              <div class="form-group">
                <label>Department</label>
                <select class="form-input form-select" id="ssDept">
                  ${deptOpts.map(d => `<option value="${d}"${d === (e.department || state.scheduleFilterDept || deptOpts[0]) ? ' selected' : ''}>${d}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label>Year Level</label>
                <select class="form-input form-select" id="ssYear">
                  <option value="">Select</option>
                  ${yearOpts.map(y => `<option value="${y}"${y === e.year_level ? ' selected' : ''}>${y} Year</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="form-group">
              <label>Section <span class="req">*</span></label>
              <input type="text" class="form-input" id="ssSection" placeholder="e.g., 1-1, 2-2" value="${escHtml(e.section || '')}">
            </div>
          </div>

          <!-- FACULTY FIELDS -->
          <div id="ssFacultyFields" style="display:none;">
            <div class="form-group" style="position:relative;">
              <label>Search & Select Faculty Member <span class="req">*</span></label>
              <div style="position:relative;">
                <input type="text" class="form-input" id="ssFacultySearch" placeholder="Type faculty name to search..." autocomplete="off">
                <div id="ssFacultySuggestions" class="autocomplete-suggestions" style="display:none; position:absolute; top:100%; left:0; right:0; background:var(--bg-card); border:1px solid var(--border); border-radius:8px; max-height:180px; overflow-y:auto; z-index:1000; box-shadow:var(--shadow-lg); padding: 4px 0;"></div>
              </div>
              <input type="hidden" id="ssFacultyId" value="${escHtml(e.faculty_id || '')}">
              <div id="ssFacultySelectedName" style="margin-top:8px; font-weight:600; font-size:13px; color:#1565c0; display:${e.faculty_id ? 'block' : 'none'};">
                <i class="fas fa-check-circle"></i> Selected Faculty: <span id="ssFacultySelectedLabel" style="font-weight:700;">${escHtml(e.faculty_name || '')}</span>
              </div>
            </div>
          </div>

          <div class="form-group">
            <label id="ssUrlLabel">Schedule Link (optional)</label>
            <input type="url" class="form-input" id="ssUrl" placeholder="https://drive.google.com/..." value="${escHtml(e.embed_url || '')}">
            <small style="color:var(--text-light);font-size:11px;" id="ssUrlHint">Paste a Google Drive, Docs, or any URL to the schedule</small>
          </div>`;
          
        onSubmit = async () => {
          const target_type = document.getElementById('ssTargetType').value;
          const title_val = document.getElementById('ssTitle').value.trim();
          const embed_url = document.getElementById('ssUrl').value.trim();

          if (!title_val) {
            showToast('Schedule Title is required', 'error');
            return;
          }

          if (target_type === 'section') {
            const department = document.getElementById('ssDept').value;
            const year_level = document.getElementById('ssYear').value;
            const section = document.getElementById('ssSection').value.trim();
            if (!section) {
              showToast('Section is required for Student schedules', 'error');
              return;
            }

            const body = JSON.stringify({
              target_type: 'section',
              title: title_val,
              department,
              year_level,
              section,
              embed_url
            });

            if (existing) {
              await api(`/api/section-schedules/${existing.id}`, { method: 'PATCH', body });
              showToast('Schedule updated', 'success');
            } else {
              await api('/api/section-schedules', { method: 'POST', body });
              showToast('Schedule posted!', 'success');
            }
          } else {
            const faculty_id = document.getElementById('ssFacultyId').value;
            if (!faculty_id) {
              showToast('Please search and select a faculty member', 'error');
              return;
            }
            if (!embed_url) {
              showToast('Embedded link is required for Faculty schedules', 'error');
              return;
            }

            const body = JSON.stringify({
              target_type: 'faculty',
              title: title_val,
              faculty_id,
              embed_url
            });

            if (existing) {
              await api(`/api/section-schedules/${existing.id}`, { method: 'PATCH', body });
              showToast('Schedule updated', 'success');
            } else {
              await api('/api/section-schedules', { method: 'POST', body });
              showToast('Schedule posted!', 'success');
            }
          }

          closeModal();
          _loadScheduleManagement();
        };
        break;
      }

      case 'create-page': {
        title = 'Create Page Request';
        bodyHtml = `
          <div class="form-group">
            <label>Page Name <span class="req">*</span></label>
            <input type="text" class="form-input" id="pageCreateName" placeholder="e.g. BSIT Society" required autocomplete="off">
          </div>
          <div class="form-group">
            <label>Category <span class="req">*</span></label>
            <select class="form-input form-select" id="pageCreateCategory">
              <option value="Organization">Organization</option>
              <option value="Club">Club</option>
              <option value="Academic Group">Academic Group</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea class="form-input" id="pageCreateDesc" placeholder="Describe the page's purpose, activities, etc." rows="3"></textarea>
          </div>
          <div class="form-group">
            <label>Logo Image <span class="muted-hint">(optional)</span></label>
            <div class="file-upload-wrapper">
              <input type="file" id="pageCreateLogo" accept="image/*" class="form-file-input">
            </div>
          </div>
          <div class="form-group">
            <label>Cover Image <span class="muted-hint">(optional)</span></label>
            <div class="file-upload-wrapper">
              <input type="file" id="pageCreateCover" accept="image/*" class="form-file-input">
            </div>
          </div>
        `;
        onSubmit = async () => {
          const name = document.getElementById('pageCreateName').value.trim();
          const category = document.getElementById('pageCreateCategory').value;
          const description = document.getElementById('pageCreateDesc').value.trim();
          const logoFile = document.getElementById('pageCreateLogo').files[0];
          const coverFile = document.getElementById('pageCreateCover').files[0];

          if (!name || !category) {
            showToast('Page name and category are required', 'error');
            return;
          }

          const fd = new FormData();
          fd.append('name', name);
          fd.append('category', category);
          fd.append('description', description);
          if (logoFile) fd.append('logo', logoFile);
          if (coverFile) fd.append('cover', coverFile);

          const res = await apiFormData('/api/pages', fd);
          showToast(res.message || 'Page request submitted!', 'success');
          closeModal();
          await Promise.all([loadActivePages(), loadMyPages(), loadPageRequests()]);
          renderPagesDirectory();
        };
        break;
      }

      case 'edit-page': {
        const page = modalData.page;
        title = 'Edit Page Details';
        bodyHtml = `
          <div class="form-group">
            <label>Page Name <span class="req">*</span></label>
            <input type="text" class="form-input" id="pageEditName" value="${escHtml(page.name)}" required autocomplete="off">
          </div>
          <div class="form-group">
            <label>Category <span class="req">*</span></label>
            <select class="form-input form-select" id="pageEditCategory">
              <option value="Organization" ${page.category === 'Organization' ? 'selected' : ''}>Organization</option>
              <option value="Club" ${page.category === 'Club' ? 'selected' : ''}>Club</option>
              <option value="Academic Group" ${page.category === 'Academic Group' ? 'selected' : ''}>Academic Group</option>
              <option value="Other" ${page.category === 'Other' ? 'selected' : ''}>Other</option>
            </select>
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea class="form-input" id="pageEditDesc" rows="3">${escHtml(page.description || '')}</textarea>
          </div>
          <div class="form-group">
            <label>Change Logo Image <span class="muted-hint">(optional)</span></label>
            <div class="file-upload-wrapper">
              <input type="file" id="pageEditLogo" accept="image/*" class="form-file-input">
            </div>
          </div>
          <div class="form-group">
            <label>Change Cover Image <span class="muted-hint">(optional)</span></label>
            <div class="file-upload-wrapper">
              <input type="file" id="pageEditCover" accept="image/*" class="form-file-input">
            </div>
          </div>
        `;
        onSubmit = async () => {
          const name = document.getElementById('pageEditName').value.trim();
          const category = document.getElementById('pageEditCategory').value;
          const description = document.getElementById('pageEditDesc').value.trim();
          const logoFile = document.getElementById('pageEditLogo').files[0];
          const coverFile = document.getElementById('pageEditCover').files[0];

          if (!name || !category) {
            showToast('Page name and category are required', 'error');
            return;
          }

          const fd = new FormData();
          fd.append('name', name);
          fd.append('category', category);
          fd.append('description', description);
          if (logoFile) fd.append('logo', logoFile);
          if (coverFile) fd.append('cover', coverFile);

          const res = await fetch(`/api/pages/${page.id}`, {
            method: 'PATCH',
            headers: getToken() ? { 'Authorization': `Bearer ${getToken()}` } : {},
            body: fd
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to update page');

          showToast('Page updated successfully!', 'success');
          closeModal();
          openPageProfile(page.id);
        };
        break;
      }

      case 'post-as-page': {
        const pageId = modalData.pageId;
        const pageData = state.currentPageProfile;
        if (!pageData || !pageData.page) {
          showToast('Page data not loaded', 'error');
          return;
        }
        const page = pageData.page;
        title = `Post as ${escHtml(page.name)}`;
        
        // Restrict visibility to General and Page Owner's department
        const ownerDept = page.owner_department || '';
        const allowedDepts = ['General', ownerDept].filter(Boolean);
        const uniqueDepts = [...new Set(allowedDepts)];

        bodyHtml = `
          <div class="form-group">
            <label>Announcement Title <span class="req">*</span></label>
            <input type="text" class="form-input" id="pagePostTitle" placeholder="e.g. Join our upcoming coding boot camp!" required autocomplete="off">
          </div>
          <div class="form-group">
            <label>Visibility / Department <span class="req">*</span></label>
            <select class="form-input form-select" id="pagePostDept">
              ${uniqueDepts.map(d => `<option value="${d}">${d}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Content <span class="req">*</span></label>
            <textarea class="form-input" id="pagePostContent" placeholder="Write your page announcement here..." rows="5" required></textarea>
          </div>
          <div class="form-group">
            <label>Upload Images <span class="muted-hint">(Max 5)</span></label>
            ${renderImageUploadWidget('pagePostImages')}
          </div>
        `;
        onSubmit = async () => {
          const titleVal = document.getElementById('pagePostTitle').value.trim();
          const dept = document.getElementById('pagePostDept').value;
          const content = document.getElementById('pagePostContent').value.trim();

          if (!titleVal || !content) {
            showToast('Title and content are required', 'error');
            return;
          }

          const fd = new FormData();
          fd.append('title', titleVal);
          fd.append('department', dept);
          fd.append('content', content);

          // Append images from the widget
          for (let i = 0; i < pendingFiles.length; i++) {
            fd.append('images', pendingFiles[i]);
          }

          const res = await apiFormData(`/api/pages/${pageId}/announcements`, fd);
          showToast(res.message || 'Post submitted for admin approval!', 'success');
          closeModal();
          openPageProfile(pageId);
        };
        break;
      }

      default: return;
    }

    // Render modal
    let modalClass = 'modal';
    if (type === 'event' || type === 'feedback-submit') {
      modalClass = 'modal modal-large';
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'modalOverlay';
    overlay.innerHTML = `
      <div class="${modalClass}">
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

    // Section-schedule target toggle and faculty autocomplete
    if (type === 'section-schedule' || type === 'schedule-embed') {
      const studBtn = document.getElementById('ssTargetStudent');
      const facBtn = document.getElementById('ssTargetFaculty');
      const targetInput = document.getElementById('ssTargetType');
      
      const studFields = document.getElementById('ssStudentFields');
      const facFields = document.getElementById('ssFacultyFields');
      
      const urlLabel = document.getElementById('ssUrlLabel');
      const urlHint = document.getElementById('ssUrlHint');
      const urlInput = document.getElementById('ssUrl');
      
      const setTargetType = (tgt) => {
        targetInput.value = tgt;
        if (tgt === 'section') {
          studBtn.classList.add('active');
          facBtn.classList.remove('active');
          studFields.style.display = 'block';
          facFields.style.display = 'none';
          urlLabel.innerHTML = 'Schedule Link (optional)';
          urlHint.textContent = 'Paste a Google Drive, Docs, or any URL to the schedule';
          urlInput.required = false;
        } else {
          facBtn.classList.add('active');
          studBtn.classList.remove('active');
          studFields.style.display = 'none';
          facFields.style.display = 'block';
          urlLabel.innerHTML = 'Embedded Link <span class="req">*</span>';
          urlHint.textContent = 'Paste a Google Drive, Sheets, or custom URL for the faculty member';
          urlInput.required = true;
        }
      };

      if (studBtn && facBtn) {
        studBtn.onclick = () => setTargetType('section');
        facBtn.onclick = () => setTargetType('faculty');
      }

      const facultySearch = document.getElementById('ssFacultySearch');
      const facultySuggestions = document.getElementById('ssFacultySuggestions');
      const facultyIdInput = document.getElementById('ssFacultyId');
      const selectedNameDiv = document.getElementById('ssFacultySelectedName');
      const selectedLabel = document.getElementById('ssFacultySelectedLabel');

      if (facultySearch) {
        let facultyList = [];
        api('/api/faculty/list')
          .then(list => { facultyList = list || []; })
          .catch(err => { console.error('Error fetching faculty list:', err); });

        facultySearch.oninput = () => {
          const query = facultySearch.value.trim().toLowerCase();
          if (!query) {
            facultySuggestions.style.display = 'none';
            return;
          }
          const matches = facultyList.filter(f => 
            `${f.first_name} ${f.last_name}`.toLowerCase().includes(query) ||
            (f.department && f.department.toLowerCase().includes(query))
          );

          if (matches.length === 0) {
            facultySuggestions.innerHTML = `<div style="padding:8px 12px; color:var(--text-light); font-size:13px; text-align:center;">No matching faculty found</div>`;
          } else {
            facultySuggestions.innerHTML = matches.map(f => `
              <div class="autocomplete-suggestion-item" data-id="${f.id}" data-name="${escHtml(f.first_name + ' ' + f.last_name)}" style="padding:8px 12px; cursor:pointer; font-size:13px; border-bottom:1px solid var(--border-soft); display:flex; flex-direction:column; gap:2px; transition: background 0.2s;">
                <span style="font-weight:600; color:var(--text-primary);">${escHtml(f.first_name + ' ' + f.last_name)}</span>
                ${f.department ? `<span style="font-size:11px; color:var(--text-secondary);"><i class="fas fa-building"></i> ${escHtml(f.department)}</span>` : ''}
              </div>
            `).join('');

            facultySuggestions.querySelectorAll('.autocomplete-suggestion-item').forEach(item => {
              item.onmousedown = () => {
                const id = item.dataset.id;
                const name = item.dataset.name;
                facultyIdInput.value = id;
                facultySearch.value = name;
                selectedLabel.textContent = name;
                selectedNameDiv.style.display = 'block';
                facultySuggestions.style.display = 'none';
              };
            });
          }
          facultySuggestions.style.display = 'block';
        };

        facultySearch.onblur = () => {
          setTimeout(() => { if (facultySuggestions) facultySuggestions.style.display = 'none'; }, 200);
        };
      }
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

    if (type === 'announcement') bindImageUpload('annImages');
    if (type === 'event') bindImageUpload('eventImages');
    if (type === 'lostfound') bindImageUpload('lfImages');
    if (type === 'lostfound-edit') bindImageUpload('lfImagesEdit');
    if (type === 'post-as-page') bindImageUpload('pagePostImages');

    // Autocomplete for Category Create
    if (type === 'doc-category') {
      const deptSel = document.getElementById('modalCatDept');
      const autogroup = document.getElementById('catAutocompleteGroup');
      const input = document.getElementById('catUserSearchInput');
      const results = document.getElementById('catUserSearchResults');
      const tags = document.getElementById('catUserTagsContainer');
      if (deptSel && autogroup) {
        let autocompleteInitialized = false;
        deptSel.onchange = () => {
          if (deptSel.value === 'Specific Students') {
            autogroup.style.display = 'block';
            if (!autocompleteInitialized) {
              getWhitelistedUserIds = setupUserAutocomplete(input, results, tags, []);
              autocompleteInitialized = true;
            }
          } else {
            autogroup.style.display = 'none';
          }
        };
      }
    }

    // Autocomplete for Category Edit
    if (type === 'doc-category-edit' && modalData) {
      const nameInput = document.getElementById('modalCatName');
      const descInput = document.getElementById('modalCatDesc');
      if (nameInput) nameInput.value = modalData.name || '';
      if (descInput) descInput.value = modalData.description || '';

      const deptSel = document.getElementById('modalCatDept');
      const autogroup = document.getElementById('catAutocompleteGroup');
      const input = document.getElementById('catUserSearchInput');
      const results = document.getElementById('catUserSearchResults');
      const tags = document.getElementById('catUserTagsContainer');
      
      if (deptSel && autogroup) {
        let autocompleteInitialized = false;
        const initAutocomplete = async () => {
          let users = [];
          if (deptSel.value === 'Specific Students') {
            autogroup.style.display = 'block';
            try {
              const accessData = await api(`/api/documents/categories/${modalData.id}/access`);
              users = accessData.users || [];
            } catch (err) {
              console.error('Fetch category access err:', err);
            }
            getWhitelistedUserIds = setupUserAutocomplete(input, results, tags, users);
            autocompleteInitialized = true;
          } else {
            autogroup.style.display = 'none';
          }
        };
        deptSel.onchange = () => {
          if (deptSel.value === 'Specific Students') {
            autogroup.style.display = 'block';
            if (!autocompleteInitialized) {
              getWhitelistedUserIds = setupUserAutocomplete(input, results, tags, []);
              autocompleteInitialized = true;
            }
          } else {
            autogroup.style.display = 'none';
          }
        };
        initAutocomplete();
      }
    }

    // Autocomplete for Document Upload
    if (type === 'doc-upload') {
      const deptSel = document.getElementById('modalDocDept');
      const autogroup = document.getElementById('docAutocompleteGroup');
      const input = document.getElementById('docUserSearchInput');
      const results = document.getElementById('docUserSearchResults');
      const tags = document.getElementById('docUserTagsContainer');
      if (deptSel && autogroup) {
        let autocompleteInitialized = false;
        deptSel.onchange = () => {
          if (deptSel.value === 'Specific Students') {
            autogroup.style.display = 'block';
            if (!autocompleteInitialized) {
              getWhitelistedUserIds = setupUserAutocomplete(input, results, tags, []);
              autocompleteInitialized = true;
            }
          } else {
            autogroup.style.display = 'none';
          }
        };
      }
    }

    // Autocomplete for Document Edit
    if (type === 'doc-edit' && modalData) {
      const titleInput = document.getElementById('modalDocTitle');
      const descInput = document.getElementById('modalDocDesc');
      const catInput = document.getElementById('modalDocCat');
      if (titleInput) titleInput.value = modalData.title || '';
      if (descInput) descInput.value = modalData.description || '';
      if (catInput) catInput.value = modalData.categoryId || '';

      const deptSel = document.getElementById('modalDocDept');
      const autogroup = document.getElementById('docAutocompleteGroup');
      const input = document.getElementById('docUserSearchInput');
      const results = document.getElementById('docUserSearchResults');
      const tags = document.getElementById('docUserTagsContainer');
      
      if (deptSel && autogroup) {
        let autocompleteInitialized = false;
        const initAutocomplete = async () => {
          let users = [];
          if (deptSel.value === 'Specific Students') {
            autogroup.style.display = 'block';
            try {
              const accessData = await api(`/api/documents/${modalData.id}/access`);
              users = accessData.students || [];
            } catch (err) {
              console.error('Fetch doc access err:', err);
            }
            getWhitelistedUserIds = setupUserAutocomplete(input, results, tags, users);
            autocompleteInitialized = true;
          } else {
            autogroup.style.display = 'none';
          }
        };
        deptSel.onchange = () => {
          if (deptSel.value === 'Specific Students') {
            autogroup.style.display = 'block';
            if (!autocompleteInitialized) {
              getWhitelistedUserIds = setupUserAutocomplete(input, results, tags, []);
              autocompleteInitialized = true;
            }
          } else {
            autogroup.style.display = 'none';
          }
        };
        initAutocomplete();
      }
    }

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

  // ── CUSTOM FEEDBACK SYSTEM HELPERS ──
  window._addBuilderQuestion = () => {
    if (state.isEventEnded) return;
    if (!state.builderQuestions) state.builderQuestions = [];
    state.builderQuestions.push({
      id: 'q_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      type: 'Short Answer',
      title: '',
      description: '',
      required: false,
      options: ['Option 1'],
      scale_min: 1,
      scale_max: 5,
      scale_min_label: '',
      scale_max_label: ''
    });
    renderBuilderQuestions();
  };

  window._deleteBuilderQuestion = (idx) => {
    if (state.isEventEnded) return;
    state.builderQuestions.splice(idx, 1);
    renderBuilderQuestions();
  };

  window._moveBuilderQuestion = (idx, direction) => {
    if (state.isEventEnded) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= state.builderQuestions.length) return;
    const temp = state.builderQuestions[idx];
    state.builderQuestions[idx] = state.builderQuestions[targetIdx];
    state.builderQuestions[targetIdx] = temp;
    renderBuilderQuestions();
  };

  window._updateBuilderQuestionField = (idx, field, val) => {
    if (state.isEventEnded) return;
    state.builderQuestions[idx][field] = val;
  };

  window._updateBuilderQuestionRequired = (idx, checkbox) => {
    if (state.isEventEnded) return;
    state.builderQuestions[idx].required = checkbox.checked;
  };

  window._changeBuilderQuestionType = (idx, select) => {
    if (state.isEventEnded) return;
    state.builderQuestions[idx].type = select.value;
    renderBuilderQuestions();
  };

  window._addBuilderOption = (qIdx) => {
    if (state.isEventEnded) return;
    state.builderQuestions[qIdx].options.push('Option ' + (state.builderQuestions[qIdx].options.length + 1));
    renderBuilderQuestions();
  };

  window._deleteBuilderOption = (qIdx, oIdx) => {
    if (state.isEventEnded) return;
    state.builderQuestions[qIdx].options.splice(oIdx, 1);
    renderBuilderQuestions();
  };

  window._updateBuilderOptionVal = (qIdx, oIdx, input) => {
    if (state.isEventEnded) return;
    state.builderQuestions[qIdx].options[oIdx] = input.value;
  };

  window._hoverCustomStarRating = (qId, val, isLeave = false) => {
    const container = document.getElementById(`stars_${qId}`);
    if (!container) return;
    const stars = container.querySelectorAll('i');
    const input = document.getElementById(`q_${qId}`);
    const currentVal = input ? parseInt(input.value) || 0 : 0;
    
    stars.forEach((s, idx) => {
      if (isLeave) {
        s.classList.remove('hover');
        const active = idx < currentVal;
        s.classList.toggle('active', active);
        if (active) {
          s.classList.remove('far');
          s.classList.add('fas');
        } else {
          s.classList.remove('fas');
          s.classList.add('far');
        }
      } else {
        const hover = idx < val;
        s.classList.toggle('hover', hover);
        if (hover || idx < currentVal) {
          s.classList.remove('far');
          s.classList.add('fas');
        } else {
          s.classList.remove('fas');
          s.classList.add('far');
        }
      }
    });
  };

  window._setCustomStarRating = (qId, val) => {
    const container = document.getElementById(`stars_${qId}`);
    if (!container) return;
    const stars = container.querySelectorAll('i');
    stars.forEach((s, idx) => {
      const active = idx < val;
      s.classList.toggle('active', active);
      if (active) {
        s.classList.remove('far');
        s.classList.add('fas');
      } else {
        s.classList.remove('fas');
        s.classList.add('far');
      }
      s.style.color = '';
    });
    const input = document.getElementById(`q_${qId}`);
    if (input) input.value = val;
  };

  function renderBuilderQuestions() {
    const container = document.getElementById('builderQuestionsList');
    if (!container) return;

    if (!state.builderQuestions || state.builderQuestions.length === 0) {
      container.innerHTML = `
        <div class="survey-builder-empty-state">
          <i class="fas fa-file-signature"></i>
          <span>No Questions Configured</span>
          <p>${state.isEventEnded ? 'This event has ended. Questionnaire is locked.' : 'Click "+ Add Question" at the top right to start building your custom survey.'}</p>
        </div>
      `;
      return;
    }

    const typeIcons = {
      'Short Answer': 'fa-minus',
      'Paragraph': 'fa-align-left',
      'Multiple Choice': 'fa-dot-circle',
      'Checkboxes': 'fa-check-square',
      'Dropdown': 'fa-caret-square-down',
      'Linear Scale': 'fa-ruler-horizontal',
      'Rating': 'fa-star'
    };

    container.innerHTML = state.builderQuestions.map((q, idx) => {
      const isFirst = idx === 0;
      const isLast = idx === state.builderQuestions.length - 1;
      const typeIcon = typeIcons[q.type] || 'fa-question';
      
      let optionsHtml = '';
      if (['Multiple Choice', 'Checkboxes', 'Dropdown'].includes(q.type)) {
        optionsHtml = `
          <div class="builder-options-container" style="margin-top: 10px; padding-left: 12px; border-left: 2.5px solid #880808;">
            <label style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-secondary); display:block; margin-bottom: 6px;">Answer Options</label>
            <div style="display:flex; flex-direction:column; gap:6px;">
              ${(q.options || []).map((opt, oIdx) => `
                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="font-size:12px; color:var(--text-muted);">${oIdx + 1}.</span>
                  <input type="text" class="form-input" style="height:32px !important; font-size:13px; padding:4px 8px !important;" value="${escHtml(opt)}" oninput="window._updateBuilderOptionVal(${idx}, ${oIdx}, this)" placeholder="Option text" ${state.isEventEnded ? 'disabled style="opacity:0.75; cursor:not-allowed;"' : ''}>
                  <button type="button" class="btn-icon" style="width:24px; height:24px; border:none;" onclick="window._deleteBuilderOption(${idx}, ${oIdx})" title="Delete Option" ${state.isEventEnded ? 'disabled style="opacity:0.3; cursor:not-allowed;"' : ''}><i class="fas fa-times"></i></button>
                </div>
              `).join('')}
            </div>
            <button type="button" class="btn-pill-outline" style="margin-top: 8px; padding: 4px 12px !important;" onclick="window._addBuilderOption(${idx})" ${state.isEventEnded ? 'disabled style="opacity:0.5; cursor:not-allowed;" title="Locked"' : ''}>
              <i class="fas fa-plus"></i> Add Option
            </button>
          </div>
        `;
      } else if (q.type === 'Linear Scale') {
        const minVal = q.scale_min || 1;
        const maxVal = q.scale_max || 5;
        optionsHtml = `
          <div class="builder-scale-container" style="margin-top: 10px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-soft);">
            <div style="display:flex; gap:12px; margin-bottom: 8px;">
              <div style="flex:1;">
                <label style="font-size: 11px; font-weight:600; color:var(--text-secondary);">Min Value</label>
                <select class="form-input form-select" style="height:34px !important; padding:4px 8px !important;" onchange="window._updateBuilderQuestionField(${idx}, 'scale_min', parseInt(this.value)); renderBuilderQuestions();" ${state.isEventEnded ? 'disabled style="opacity:0.75; cursor:not-allowed;"' : ''}>
                  <option value="0" ${minVal === 0 ? 'selected' : ''}>0</option>
                  <option value="1" ${minVal === 1 ? 'selected' : ''}>1</option>
                </select>
              </div>
              <div style="flex:1;">
                <label style="font-size: 11px; font-weight:600; color:var(--text-secondary);">Max Value</label>
                <select class="form-input form-select" style="height:34px !important; padding:4px 8px !important;" onchange="window._updateBuilderQuestionField(${idx}, 'scale_max', parseInt(this.value)); renderBuilderQuestions();" ${state.isEventEnded ? 'disabled style="opacity:0.75; cursor:not-allowed;"' : ''}>
                  ${[2,3,4,5,6,7,8,9,10].map(val => `<option value="${val}" ${maxVal === val ? 'selected' : ''}>${val}</option>`).join('')}
                </select>
              </div>
            </div>
            <div style="display:flex; gap:12px;">
              <div style="flex:1;">
                <label style="font-size: 11px; font-weight:600; color:var(--text-secondary);">Label for Min (${minVal})</label>
                <input type="text" class="form-input" style="height:34px !important; font-size:12px; padding:4px 8px !important;" placeholder="e.g. Strongly Disagree" value="${escHtml(q.scale_min_label || '')}" oninput="window._updateBuilderQuestionField(${idx}, 'scale_min_label', this.value)" ${state.isEventEnded ? 'disabled style="opacity:0.75; cursor:not-allowed;"' : ''}>
              </div>
              <div style="flex:1;">
                <label style="font-size: 11px; font-weight:600; color:var(--text-secondary);">Label for Max (${maxVal})</label>
                <input type="text" class="form-input" style="height:34px !important; font-size:12px; padding:4px 8px !important;" placeholder="e.g. Strongly Agree" value="${escHtml(q.scale_max_label || '')}" oninput="window._updateBuilderQuestionField(${idx}, 'scale_max_label', this.value)" ${state.isEventEnded ? 'disabled style="opacity:0.75; cursor:not-allowed;"' : ''}>
              </div>
            </div>
          </div>
        `;
      }

      return `
        <div class="builder-question-card" style="${state.isEventEnded ? 'opacity:0.95;' : ''}">
          <!-- Drag Handle / Grip indicator on the left -->
          <div class="builder-drag-handle" title="${state.isEventEnded ? 'Locked' : 'Drag / Reorder info'}" style="${state.isEventEnded ? 'opacity:0.3; cursor:not-allowed;' : ''}">
            <i class="fas fa-grip-vertical"></i>
          </div>
          
          <div class="builder-card-header">
            <span class="builder-q-num">
              <i class="fas ${typeIcon}"></i> Q${idx + 1}
            </span>
            <input type="text" class="form-input" style="flex:1; font-weight:600; min-width:180px;" placeholder="Question Title (e.g. Rate your satisfaction)" value="${escHtml(q.title)}" oninput="window._updateBuilderQuestionField(${idx}, 'title', this.value)" ${state.isEventEnded ? 'disabled style="opacity:0.75; cursor:not-allowed;"' : ''}>
            <select class="form-input form-select" style="width:140px; font-size:13px;" onchange="window._changeBuilderQuestionType(${idx}, this)" ${state.isEventEnded ? 'disabled style="opacity:0.75; cursor:not-allowed;"' : ''}>
              ${['Short Answer', 'Paragraph', 'Multiple Choice', 'Checkboxes', 'Dropdown', 'Linear Scale', 'Rating'].map(t => `<option value="${t}" ${q.type === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
          <div>
            <input type="text" class="form-input" style="font-size:12px; height:34px !important; padding:4px 8px !important;" placeholder="Description / Hint (optional)" value="${escHtml(q.description || '')}" oninput="window._updateBuilderQuestionField(${idx}, 'description', this.value)" ${state.isEventEnded ? 'disabled style="opacity:0.75; cursor:not-allowed;"' : ''}>
          </div>
          
          ${optionsHtml}
          
          <div class="builder-card-actions">
            <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer; font-weight:600; font-size:11px; text-transform:uppercase; color:#6B7280; margin:0; ${state.isEventEnded ? 'cursor:not-allowed;' : ''}">
              <input type="checkbox" ${q.required ? 'checked' : ''} onchange="window._updateBuilderQuestionRequired(${idx}, this)" style="accent-color:#880808; width:14px; height:14px; cursor:pointer;" ${state.isEventEnded ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}>
              <span>Required Question</span>
            </label>
            <div style="display:flex; align-items:center; gap:6px;">
              <button type="button" class="btn-icon" ${isFirst || state.isEventEnded ? 'disabled style="opacity:0.3; cursor:not-allowed;"' : `onclick="window._moveBuilderQuestion(${idx}, -1)"`} title="Move Up"><i class="fas fa-chevron-up"></i></button>
              <button type="button" class="btn-icon" ${isLast || state.isEventEnded ? 'disabled style="opacity:0.3; cursor:not-allowed;"' : `onclick="window._moveBuilderQuestion(${idx}, 1)"`} title="Move Down"><i class="fas fa-chevron-down"></i></button>
              <button type="button" class="btn-icon" ${state.isEventEnded ? 'disabled style="opacity:0.3; cursor:not-allowed;"' : `onclick="window._deleteBuilderQuestion(${idx})"`} title="Delete Question"><i class="fas fa-trash-alt"></i></button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function compileFormBuilderSchema() {
    if (!state.builderQuestions) return [];
    return state.builderQuestions.map(q => {
      const qTitle = q.title.trim();
      if (!qTitle) {
        throw new Error('All questions in the feedback builder must have a title.');
      }
      if (['Multiple Choice', 'Checkboxes', 'Dropdown'].includes(q.type)) {
        const validOpts = (q.options || []).map(o => o.trim()).filter(Boolean);
        if (validOpts.length === 0) {
          throw new Error(`Question "${q.title}" must have at least one answer option.`);
        }
        return { ...q, title: qTitle, options: validOpts };
      }
      return { ...q, title: qTitle };
    });
  }

  window._exportFeedbackCSV = (event, stats) => {
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += `"Event Title","${event.title.replace(/"/g, '""')}"\n`;
    csvContent += `"Total Responses",${stats.total}\n\n`;
    
    (stats.stats || []).forEach((q, idx) => {
      csvContent += `"Q${idx + 1}","${q.label.replace(/"/g, '""')}"\n`;
      csvContent += `"Type","${q.type}"\n`;
      csvContent += `"Total Answers",${q.total}\n`;
      
      if (['Short Answer', 'Paragraph'].includes(q.type)) {
        csvContent += `"Answers"\n`;
        (q.responses || []).forEach(ans => {
          csvContent += `"${ans.replace(/"/g, '""')}"\n`;
        });
      } else if (['Multiple Choice', 'Checkboxes', 'Dropdown'].includes(q.type)) {
        csvContent += `"Option","Count","Percentage"\n`;
        Object.entries(q.frequencies || {}).forEach(([opt, count]) => {
          const pct = q.total ? Math.round((count / q.total) * 100) : 0;
          csvContent += `"${opt.replace(/"/g, '""')}",${count},"${pct}%"\n`;
        });
      } else if (['Linear Scale', 'Rating'].includes(q.type)) {
        csvContent += `"Average Rating",${q.average}\n`;
        csvContent += `"Score","Count","Percentage"\n`;
        Object.entries(q.distribution || {}).forEach(([score, count]) => {
          const pct = q.total ? Math.round((count / q.total) * 100) : 0;
          csvContent += `${score},${count},"${pct}%"\n`;
        });
      }
      csvContent += `\n`;
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `survey_results_${event.id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  window._showCustomFeedbackResults = async (eventId) => {
    const event = state.events.find(e => e.id === eventId);
    if (!event) return;

    let modal = document.getElementById('resultsModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'resultsModal';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(3px);';
      modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
      document.body.appendChild(modal);
    }
    
    const cardStyle = 'background:var(--bg-card);border-radius:16px;width:100%;max-width:750px;max-height:90vh;overflow-y:auto;padding:28px;box-shadow:0 24px 64px rgba(0,0,0,0.6);display:flex;flex-direction:column;gap:20px;';
    modal.innerHTML = `
      <div style="${cardStyle}">
        <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);padding-bottom:16px;">
          <div>
            <h2 style="margin:0;font-size:1.25rem;display:flex;align-items:center;gap:10px;"><i class="fas fa-chart-bar" style="color:var(--primary);"></i> Event Survey Results</h2>
            <p style="margin:4px 0 0;font-size:13px;color:var(--text-secondary);">${escHtml(event.title)}</p>
          </div>
          <button onclick="document.getElementById('resultsModal').remove()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:var(--text-secondary);line-height:1;">&times;</button>
        </div>
        <div style="text-align:center;padding:40px 0;"><div class="spinner"></div><p style="margin-top:12px;color:var(--text-secondary);">Loading survey responses...</p></div>
      </div>`;

    try {
      const stats = await api(`/api/events/${eventId}/feedback-stats`);
      
      const drawVisuals = () => {
        if (stats.total === 0) {
          return `<div class="empty-state" style="padding:48px 24px;text-align:center;"><i class="fas fa-poll" style="font-size:48px;opacity:0.4;margin-bottom:12px;"></i><h3>No Responses Yet</h3><p>Nobody has filled out the feedback survey for this event yet.</p></div>`;
        }

        return (stats.stats || []).map((q, idx) => {
          let graphHtml = '';
          if (['Short Answer', 'Paragraph'].includes(q.type)) {
            graphHtml = `
              <div style="display:flex; flex-direction:column; gap:8px; max-height:220px; overflow-y:auto; padding-right:6px; margin-top:8px;">
                ${(q.responses || []).map(ans => `
                  <div style="background:var(--bg-soft); border-radius:6px; padding:10px 14px; font-size:13px; line-height:1.5; color:var(--text-primary); border-left:3px solid var(--primary);">${escHtml(ans)}</div>
                `).join('')}
              </div>
            `;
          } else if (['Multiple Choice', 'Checkboxes', 'Dropdown'].includes(q.type)) {
            graphHtml = `
              <div style="display:flex; flex-direction:column; gap:12px; margin-top:8px;">
                ${Object.entries(q.frequencies || {}).map(([opt, count]) => {
                  const pct = q.total ? Math.round((count / q.total) * 100) : 0;
                  return `
                    <div style="display:flex; flex-direction:column;">
                      <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:600; margin-bottom:4px;">
                        <span>${escHtml(opt)}</span>
                        <span style="color:var(--text-secondary);">${count} (${pct}%)</span>
                      </div>
                      <div style="height:8px; background:var(--bg-soft); border-radius:4px; overflow:hidden;">
                        <div style="height:100%; width:${pct}%; background:#880808; border-radius:4px; transition:width 0.5s ease-out;"></div>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `;
          } else if (['Linear Scale', 'Rating'].includes(q.type)) {
            graphHtml = `
              <div style="display:flex; gap:24px; align-items:center; margin-top:8px;">
                <div style="text-align:center; padding:12px 18px; border-right:1px solid var(--border); min-width:110px;">
                  <span style="font-size:36px; font-weight:800; color:var(--primary); line-height:1;">${q.average || 0}</span>
                  <span style="display:block; font-size:11px; color:var(--text-muted); margin-top:4px;">Average Score</span>
                  ${q.type === 'Rating' ? `<div style="font-size:10px; color:#f59e0b; margin-top:4px;">${renderStars(q.average)}</div>` : ''}
                </div>
                <div style="flex:1; display:flex; flex-direction:column; gap:8px;">
                  ${Object.entries(q.distribution || {}).map(([score, count]) => {
                    const pct = q.total ? Math.round((count / q.total) * 100) : 0;
                    return `
                      <div style="display:flex; align-items:center; gap:8px;">
                        <span style="font-size:11px; font-weight:600; width:16px; text-align:right;">${score}</span>
                        <div style="flex:1; height:8px; background:var(--bg-soft); border-radius:4px; overflow:hidden;">
                          <div style="height:100%; width:${pct}%; background:#880808; border-radius:4px; transition:width 0.5s ease-out;"></div>
                        </div>
                        <span style="font-size:11px; color:var(--text-muted); width:28px;">${count}</span>
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>
            `;
          }

          return `
            <div class="card" style="padding:16px; border:1px solid var(--border); border-radius:10px; background:var(--bg-card); display:flex; flex-direction:column; gap:8px; margin-bottom:16px;">
              <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                <h4 style="margin:0; font-size:14px; font-weight:700; color:var(--text-primary);">Q${idx + 1}. ${escHtml(q.label)}</h4>
                <span style="font-size:11px; color:var(--text-muted); background:var(--bg-soft); padding:2px 6px; border-radius:4px;">${q.total} answer${q.total !== 1 ? 's' : ''} • ${q.type}</span>
              </div>
              ${graphHtml}
            </div>
          `;
        }).join('');
      };

      const loadAIReport = async (triggerRegen = false) => {
        const aiContainer = document.getElementById('surveyAIReportBox');
        if (!aiContainer) return;
        
        aiContainer.innerHTML = `<div style="text-align:center;padding:32px 0;"><div class="spinner" style="margin:0 auto 12px;"></div><p style="font-size:13px;color:var(--text-secondary);">AI is evaluating survey responses, parsing sentiments and compiling suggestions. Please wait...</p></div>`;

        try {
          const res = triggerRegen 
            ? await api(`/api/events/${eventId}/feedback-ai-analysis`, { method: 'POST' })
            : await api(`/api/events/${eventId}/feedback-ai-analysis`);
          
          aiContainer.innerHTML = `
            <div style="background:var(--bg-soft); border-radius:10px; padding:18px; line-height:1.6; font-size:13.5px; border-left:4px solid var(--primary); color: var(--text-primary);">
              ${renderBotMd(res.markdown)}
            </div>
            <button class="btn btn-secondary btn-sm" id="regenAIReportBtn" style="margin-top:12px; font-size:11px; padding:6px 12px; width:auto; display:inline-flex; align-items:center; gap:4px;">
              <i class="fas fa-sync-alt"></i> Re-generate Report
            </button>
          `;
          
          const regenBtn = document.getElementById('regenAIReportBtn');
          if (regenBtn) regenBtn.onclick = () => loadAIReport(true);
        } catch (e) {
          if (e.message.includes('404') && !triggerRegen) {
            aiContainer.innerHTML = `
              <div style="text-align:center; padding:24px; border:1px dashed var(--border); border-radius:10px;">
                <i class="fas fa-brain" style="font-size:36px; opacity:0.3; margin-bottom:12px; display:block;"></i>
                <p style="font-size:13px; color:var(--text-secondary); margin-bottom:16px;">AI Report has not been generated for this event yet.</p>
                <button class="btn btn-primary btn-sm" id="generateAIReportBtn" style="width:auto; margin:0 auto; display:inline-flex; align-items:center; gap:6px;">
                  <i class="fas fa-brain"></i> Generate AI Analysis
                </button>
              </div>`;
            const genBtn = document.getElementById('generateAIReportBtn');
            if (genBtn) genBtn.onclick = () => loadAIReport(true);
          } else {
            aiContainer.innerHTML = `<div style="padding:16px; background:var(--danger-soft); color:var(--danger); border-radius:8px; font-size:13px; text-align:center;"><i class="fas fa-exclamation-triangle"></i> Failed to generate AI analysis: ${escHtml(e.message)}</div>`;
          }
        }
      };

      modal.querySelector('div').innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);padding-bottom:16px;margin-bottom:10px;">
          <div>
            <h2 style="margin:0;font-size:1.25rem;display:flex;align-items:center;gap:10px;"><i class="fas fa-chart-bar" style="color:var(--primary);"></i> Event Survey Results</h2>
            <p style="margin:4px 0 0;font-size:13px;color:var(--text-secondary);">${escHtml(event.title)}</p>
          </div>
          <button onclick="document.getElementById('resultsModal').remove()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:var(--text-secondary);line-height:1;">&times;</button>
        </div>
        
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
          <div style="display:flex; gap:8px; border-bottom: 2px solid var(--border); padding-bottom: 2px; flex:1;">
            <button class="btn-tab active" id="resultsVisualsTabBtn" style="background:none; border:none; padding:8px 12px; font-size:13px; font-weight:700; color:var(--primary); border-bottom:3px solid var(--primary); cursor:pointer;">Visual Results</button>
            <button class="btn-tab" id="resultsAITabBtn" style="background:none; border:none; padding:8px 12px; font-size:13px; font-weight:600; color:var(--text-secondary); cursor:pointer;">AI Insights & Analysis</button>
          </div>
          ${stats.total > 0 ? `
            <button class="btn btn-secondary btn-sm" id="exportCSVBtn" style="font-size:11px; padding:6px 10px; width:auto; display:inline-flex; align-items:center; gap:6px;">
              <i class="fas fa-file-csv"></i> Export CSV
            </button>
          ` : ''}
        </div>

        <div id="resultsContentArea" style="flex:1; overflow-y:auto; max-height:60vh; padding-top:10px;">
          ${drawVisuals()}
        </div>
      `;

      const expBtn = document.getElementById('exportCSVBtn');
      if (expBtn) expBtn.onclick = () => window._exportFeedbackCSV(event, stats);

      const visualsTabBtn = document.getElementById('resultsVisualsTabBtn');
      const aiTabBtn = document.getElementById('resultsAITabBtn');
      const contentArea = document.getElementById('resultsContentArea');

      visualsTabBtn.onclick = () => {
        visualsTabBtn.classList.add('active');
        visualsTabBtn.style.color = 'var(--primary)';
        visualsTabBtn.style.borderBottom = '3px solid var(--primary)';
        aiTabBtn.classList.remove('active');
        aiTabBtn.style.color = 'var(--text-secondary)';
        aiTabBtn.style.borderBottom = 'none';
        contentArea.innerHTML = drawVisuals();
      };

      aiTabBtn.onclick = () => {
        aiTabBtn.classList.add('active');
        aiTabBtn.style.color = 'var(--primary)';
        aiTabBtn.style.borderBottom = '3px solid var(--primary)';
        visualsTabBtn.classList.remove('active');
        visualsTabBtn.style.color = 'var(--text-secondary)';
        visualsTabBtn.style.borderBottom = 'none';
        contentArea.innerHTML = `<div id="surveyAIReportBox" style="padding-top:10px;"></div>`;
        loadAIReport();
      };

    } catch (err) {
      modal.querySelector('div').innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <h2 style="margin:0;font-size:1.2rem;"><i class="fas fa-chart-bar"></i> Event Results</h2>
          <button onclick="document.getElementById('resultsModal').remove()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;">&times;</button>
        </div>
        <div style="text-align:center;padding:24px;color:var(--danger);"><i class="fas fa-exclamation-circle" style="font-size:2rem;"></i><p style="margin-top:8px;">${escHtml(err.message)}</p></div>`;
    }
  };

  window.closeModal = function () {
    const overlay = document.getElementById('modalOverlay');
    if (overlay) overlay.remove();
    pendingFiles = [];
  };

  window._buildFlexibleScheduleTableHtml = (rows, error, embedUrl, title, hideHeader = false) => {
    const headerHtml = hideHeader ? '' : `
      <div class="sched-embed-header" style="margin-top:10px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--primary);">
          <i class="fas fa-calendar-alt"></i> ${escHtml(title || 'Class Schedule')}
        </span>
        ${embedUrl ? `
          <a href="${escHtml(embedUrl)}" target="_blank" rel="noopener" class="btn-open-sheet">
            <i class="fas fa-external-link-alt"></i> Open Sheet
          </a>
        ` : ''}
      </div>`;

    if (error || !rows || rows.length === 0) {
      if (embedUrl) {
        return `
          <div class="sched-table-container-fallback" style="margin-top:10px;">
            ${headerHtml}
            <div class="card schedule-embed-frame" style="border:1px solid var(--border); border-radius:8px; overflow:hidden; height:450px;">
              <iframe src="${escHtml(_toEmbedUrl(embedUrl))}" allowfullscreen loading="lazy" style="width:100%; height:100%; border:none;" title="${escHtml(title || 'Class Schedule')}"></iframe>
            </div>
          </div>`;
      }
      return `
        <div class="sched-table-container-fallback" style="margin-top:10px;">
          ${headerHtml}
          <div class="empty-state" style="padding:20px; border:1px dashed var(--border); border-radius:8px;">
            <i class="fas fa-unlink" style="font-size:24px; opacity:0.5; margin-bottom:8px;"></i>
            <p style="font-size:12px; margin:0; color:var(--text-secondary);">No schedule data available or failed to load.</p>
          </div>
        </div>`;
    }

    const keys = Object.keys(rows[0]);
    const formatHeader = (str) => {
      if (!str) return '';
      return str
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    };

    const tableRows = rows.map(row => {
      return `<tr>${keys.map(k => `<td>${escHtml(String(row[k] ?? ''))}</td>`).join('')}</tr>`;
    }).join('');

    return `
      <div class="sched-table-container" style="margin-top:10px; margin-bottom:10px;">
        ${headerHtml}
        <div style="width:100%; overflow-x:auto; border: 1px solid var(--border); border-radius: 8px;">
          <table class="sched-table" style="width:100%; border-collapse:collapse; min-width:800px;">
            <thead>
              <tr style="background:var(--maroon); color:#fff;">
                ${keys.map(k => `<th style="text-align:left; padding:12px 14px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; white-space:nowrap;">${escHtml(formatHeader(k))}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
        </div>
      </div>
    `;
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
    try {
      state.systemSettings = await api('/api/system-settings');
      if (state.systemSettings && state.systemSettings.app_title) {
        document.title = state.systemSettings.app_title;
      }
    } catch (err) {
      console.warn('System settings failed to load, falling back to default branding.', err);
      state.systemSettings = {};
    }

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

  window._guestExit = () => {
    sessionStorage.removeItem('pupsj_token');
    stopNotificationsPolling();
    state.user = null;
    state.currentPage = 'announcements';
    state.chatMessages = [];
    state.announcements = [];
    state.events = [];
    state.lostFound = [];
    state.notifications = [];
    state.notificationsUnread = 0;
    render();
    setTimeout(() => {
      if (window._openAuthView) window._openAuthView('login');
    }, 100);
  };

  window._guestLogin = async () => {
    try {
      const data = await api('/api/auth/guest-login', { method: 'POST' });
      sessionStorage.setItem('pupsj_token', data.token);
      state.user = data.user;
      state.currentPage = 'announcements';
      showToast('Welcome! You are browsing as a guest.', 'info');
      render();
    } catch (err) {
      showToast(err.message || 'Guest login failed', 'error');
    }
  };

  init();

})();
