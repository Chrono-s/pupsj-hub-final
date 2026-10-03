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
    lostFoundRejected: [],
    lfMatchIndex: 0,
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
      if (!res.ok) {
        const e = new Error(data.error || 'Request failed');
        e.status = res.status;
        e.responseData = data; // preserve full body (conflict details, recommendations, etc.)
        throw e;
      }
      return data;
    } catch (err) {
      if (err.message === 'Authentication required' || err.message === 'Invalid or expired token') {
        const wasLoggedIn = !!state.user;
        state.user = null;
        sessionStorage.removeItem('pupsj_token');
        localStorage.removeItem('pupsj_token');
        if (window._studentQueueInterval) {
          clearInterval(window._studentQueueInterval);
          window._studentQueueInterval = null;
        }
        stopNotificationsPolling();
        if (typeof stopLocatorPolling === 'function') stopLocatorPolling();
        if (wasLoggedIn) {
          render();
        }
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
        const wasLoggedIn = !!state.user;
        state.user = null;
        sessionStorage.removeItem('pupsj_token');
        localStorage.removeItem('pupsj_token');
        if (window._studentQueueInterval) {
          clearInterval(window._studentQueueInterval);
          window._studentQueueInterval = null;
        }
        stopNotificationsPolling();
        if (typeof stopLocatorPolling === 'function') stopLocatorPolling();
        if (wasLoggedIn) {
          render();
        }
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
    const hr = parseInt(h, 10);
    if (isNaN(hr)) return t;
    const ampm = hr >= 12 ? 'PM' : 'AM';
    const hour12 = hr % 12 || 12;
    return `${hour12}:${m || '00'} ${ampm}`;
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
  window._toggleTheme = () => {
    const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.querySelectorAll('.landing-theme-btn i, .theme-toggle-btn i').forEach(icon => {
      icon.className = next === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    });
    showToast(`${next === 'dark' ? 'Dark' : 'Light'} mode enabled`, 'info');
  };
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
      if (!state.authViewActive) {
        startCarouselAutoplay();
      }
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
    if (state.authViewActive) return;
    carouselTimer = setInterval(() => {
      if (state.authViewActive) {
        stopCarouselAutoplay();
        return;
      }
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
      if (track.classList.contains('slide-active')) {
        // If already showing auth view, smoothly switch modes instead of tearing the DOM
        if (mode && typeof switchAuthMode === 'function') {
          switchAuthMode(mode);
        }
        return;
      }
      if (!formsSlide.querySelector('.auth-card') || formsSlide.dataset.authMode !== authMode) {
        formsSlide.innerHTML = renderAuthPanel();
        formsSlide.dataset.authMode = authMode;
        bindAuthEvents();
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
    state.resetToken = '';
    sessionStorage.removeItem('pupsj_reset_token');
    startCarouselAutoplay();

    const track = document.querySelector('.auth-track');
    if (track) {
      // Keep scrollbar layout stable to prevent glitching

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
    // Clear all authenticated background timers when rendering auth screens
    if (window._studentQueueInterval) {
      clearInterval(window._studentQueueInterval);
      window._studentQueueInterval = null;
    }
    stopNotificationsPolling();
    if (typeof stopLocatorPolling === 'function') stopLocatorPolling();

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
                    <button class="landing-theme-btn" onclick="window._toggleTheme()" title="Toggle Dark/Light Mode" aria-label="Toggle theme">
                      <i class="${document.documentElement.getAttribute('data-theme') === 'dark' ? 'fas fa-sun' : 'fas fa-moon'}"></i>
                    </button>
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
                <section class="landing-about" id="about" style="padding: 80px 0; border-top: 1px solid var(--border);">
                  <div class="section-container" style="max-width: 800px; margin: 0 auto; text-align: center;">
                    <h2 class="section-title" style="margin-bottom: 24px;">About PUPSJ HUB</h2>
                    <p style="font-size: 15px; color: var(--text-secondary); line-height: 1.8; margin-bottom: 0;">${escHtml(state.systemSettings?.app_description || 'PUPSJ HUB is the centralized campus portal designed exclusively for the Polytechnic University of the Philippines San Juan Campus. Engineered to optimize campus communication and student organization coordination, this portal serves as a unified progressive portal for faculty, students, and campus administrators alike.')}</p>
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

    // Keep overflow smooth during mode transition
    const panel = document.querySelector('.auth-form-panel');
    if (panel) {
      panel.scrollTop = 0;
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
        if (newMode === 'login') card.innerHTML = renderLogin();
        else if (newMode === 'register') card.innerHTML = renderRegister();
        else if (newMode === 'forgot-password') card.innerHTML = renderForgotPassword();
        else if (newMode === 'reset-password') card.innerHTML = renderResetPassword();
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
      <form id="loginForm" method="post" action="#" onsubmit="return false;" autocomplete="on">
        <div class="form-group">
          <label for="loginEmail">Email</label>
          <input type="email" class="form-input" id="loginEmail" name="email" placeholder="you@pupsj.edu.ph" autocomplete="username email" required>
        </div>
        <div class="form-group">
          <label for="loginPassword">Password</label>
          <div class="auth-password-wrapper">
            <input type="password" class="form-input" id="loginPassword" name="password" placeholder="Enter your password" autocomplete="current-password" required>
            <button type="button" class="toggle-password-btn" onclick="window._togglePasswordVisibility('loginPassword', this)"><i class="far fa-eye"></i></button>
          </div>
          <div class="auth-forgot-link"><a id="forgotPasswordLink" href="#">Forgot Password?</a></div>
        </div>
        <button type="submit" class="btn btn-primary" id="loginBtn"><i class="fas fa-sign-in-alt"></i> Login</button>
      </form>
      <p class="auth-switch">Don't have an account? <a id="switchToRegister">Sign up</a></p>`;
  }

  function renderForgotPassword() {
    return `
      <h2>Forgot Password</h2>
      <p class="subtitle">Enter your email to receive a reset link</p>
      <div class="auth-error" id="authError"></div>
      <div class="auth-success" id="authSuccess"></div>
      <div class="form-group">
        <label>Email or ID Number</label>
        <input type="text" class="form-input" id="fpEmail" placeholder="you@pupsj.edu.ph or 2024-00001-SJ-0" autocomplete="username">
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
        <div class="auth-password-wrapper">
          <input type="password" class="form-input" id="rpPassword" placeholder="Min. 6 characters" autocomplete="new-password">
          <button type="button" class="toggle-password-btn" onclick="window._togglePasswordVisibility('rpPassword', this)"><i class="far fa-eye"></i></button>
        </div>
      </div>
      <div class="form-group">
        <label>Confirm Password</label>
        <div class="auth-password-wrapper">
          <input type="password" class="form-input" id="rpConfirm" placeholder="Repeat new password" autocomplete="new-password">
          <button type="button" class="toggle-password-btn" onclick="window._togglePasswordVisibility('rpConfirm', this)"><i class="far fa-eye"></i></button>
        </div>
      </div>
      <button class="btn btn-primary" id="rpBtn"><i class="fas fa-lock"></i> Set New Password</button>
      <p class="auth-switch">Remember your password? <a id="switchToLogin">Sign In</a></p>`;
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
          <label>Employment Type <span class="req">*</span></label>
          <select class="form-input form-select" id="regEmploymentType">
            <option value="">Select</option>
            <option value="full_time">Full Time</option>
            <option value="part_time">Part Time</option>
          </select>
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
    if (switchToReg) switchToReg.onclick = () => switchAuthMode('register');
    if (switchToLog) switchToLog.onclick = () => switchAuthMode('login');

    // Forgot Password link on login form
    const forgotLink = document.getElementById('forgotPasswordLink');
    if (forgotLink) forgotLink.onclick = (e) => { e.preventDefault(); switchAuthMode('forgot-password'); };

    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
      loginForm.onsubmit = (e) => {
        e.preventDefault();
        handleLogin();
      };
    }
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

    // Enter key on login inputs
    const loginEm = document.getElementById('loginEmail');
    if (loginEm) loginEm.onkeydown = (e) => { if (e.key === 'Enter') handleLogin(); };
    const loginPw = document.getElementById('loginPassword');
    if (loginPw) loginPw.onkeydown = (e) => { if (e.key === 'Enter') handleLogin(); };

    // Enter key on forgot password
    const fpEmail = document.getElementById('fpEmail');
    if (fpEmail) fpEmail.onkeydown = (e) => { if (e.key === 'Enter') handleForgotPassword(); };

    // Enter key on reset password
    const rpPassword = document.getElementById('rpPassword');
    if (rpPassword) rpPassword.onkeydown = (e) => { if (e.key === 'Enter') handleResetPassword(); };
    const rpConfirm = document.getElementById('rpConfirm');
    if (rpConfirm) rpConfirm.onkeydown = (e) => { if (e.key === 'Enter') handleResetPassword(); };
  }

  async function handleForgotPassword() {
    const email = document.getElementById('fpEmail')?.value.trim();
    const errEl = document.getElementById('authError');
    const sucEl = document.getElementById('authSuccess');
    if (!email) {
      if (errEl) { errEl.textContent = 'Please enter your email or ID number'; errEl.classList.add('show'); }
      return;
    }
    const btn = document.getElementById('fpBtn');
    try {
      if (errEl) errEl.classList.remove('show');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
      }
      await api('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
      if (sucEl) {
        sucEl.textContent = 'If that email is registered, a reset link has been sent. Please check your inbox.';
        sucEl.classList.add('show');
      }
      if (errEl) errEl.classList.remove('show');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Reset Link';
      }
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || 'Failed to send reset link';
        errEl.classList.add('show');
      }
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Reset Link';
      }
    }
  }

  async function handleResetPassword() {
    const password = document.getElementById('rpPassword')?.value;
    const confirm  = document.getElementById('rpConfirm')?.value;
    const errEl    = document.getElementById('authError');
    if (!password || !confirm) {
      if (errEl) { errEl.textContent = 'Please fill in both fields'; errEl.classList.add('show'); }
      return;
    }
    if (password !== confirm) {
      if (errEl) { errEl.textContent = 'Passwords do not match'; errEl.classList.add('show'); }
      return;
    }
    if (password.length < 6) {
      if (errEl) { errEl.textContent = 'Password must be at least 6 characters'; errEl.classList.add('show'); }
      return;
    }
    if (!state.resetToken) {
      if (errEl) { errEl.textContent = 'Invalid or missing reset token. Please request a new link.'; errEl.classList.add('show'); }
      return;
    }
    const btn = document.getElementById('rpBtn');
    try {
      if (errEl) errEl.classList.remove('show');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Resetting...';
      }
      await api('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: state.resetToken, password }) });
      showToast('Password reset successfully! You can now log in.', 'success');
      state.resetToken = '';
      sessionStorage.removeItem('pupsj_reset_token');
      authMode = 'login';
      switchAuthMode('login');
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || 'Failed to reset password';
        errEl.classList.add('show');
      }
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-lock"></i> Set New Password';
      }
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
      localStorage.removeItem('pupsj_token');
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
      employment_type: document.getElementById('regEmploymentType')?.value,
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
    } else if (fields.role === 'faculty') {
      requiredFields.push('employment_type');
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
    // Module access for admins. Superadmin implicitly has every module.
    const canMod = (m) => isSuperAdmin || (Array.isArray(u.modules) && u.modules.includes(m));

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
            <div class="sidebar-brand-text">
              <h2>${escHtml(state.systemSettings?.app_title || 'PUPSJ HUB')}</h2>
              <small>San Juan Campus</small>
            </div>
          </div>
          <div class="sidebar-header-actions">
            <button class="sidebar-btn-icon theme-toggle-btn" onclick="window._toggleTheme()" title="Toggle Dark/Light Mode" aria-label="Toggle theme">
              <i class="${document.documentElement.getAttribute('data-theme') === 'dark' ? 'fas fa-sun' : 'fas fa-moon'}"></i>
            </button>
            ${isGuest ? '' : `
            <button class="sidebar-btn-icon notification-bell-btn" id="desktopNotificationsBtn" title="Notifications" aria-label="Notifications" style="position: relative;">
              <i class="fas fa-bell"></i>
              ${renderNotificationBadge('desktopNotificationBadge', 'top-bell-badge')}
            </button>
            `}
          </div>
        </div>
        <div class="sidebar-nav">
          ${isAdmin ? `
            <div class="nav-section-label">Administration</div>
            <div class="nav-item" data-page="admin-dashboard"><i class="fas fa-chart-pie"></i> Dashboard</div>
            ${canMod('queueing') ? `<div class="nav-item" data-page="queueing"><i class="fas fa-ticket-alt"></i> Queueing</div>` : ''}
            ${canMod('loading_requests') ? `<div class="nav-item" data-page="admin-loading"><i class="fas fa-chalkboard-teacher"></i> Course Preference <span class="nav-badge is-hidden" id="badge-admin-loading">0</span></div>` : ''}
            ${isSuperAdmin ? `
              <div class="nav-item" data-page="admin-users"><i class="fas fa-users-cog"></i> Manage Users</div>
              <div class="nav-item" data-page="system-maintenance"><i class="fas fa-tools"></i> System Maintenance</div>
            ` : ''}

            <div class="nav-section-label">Main</div>
            <div class="nav-item active" data-page="announcements"><i class="fas fa-bullhorn"></i> Announcements <span class="nav-badge is-hidden" id="badge-announcements">0</span></div>
            ${isGuest ? '' : `<div class="nav-item" data-page="events"><i class="fas fa-calendar-alt"></i> Event Calendar <span class="nav-badge is-hidden" id="badge-events">0</span></div>`}
            ${canMod('lost_found') ? `<div class="nav-item" data-page="lostfound"><i class="fas fa-search-location"></i> Lost & Found <span class="nav-badge is-hidden" id="badge-lostfound">0</span></div>` : ''}
            ${isGuest ? '' : `
              <div class="nav-item" data-page="teaching"><i class="fas fa-clock"></i> Class Schedules <span class="nav-badge is-hidden" id="badge-teaching">0</span></div>
            `}
            <div class="nav-item" data-page="chatbot"><i class="fas fa-robot"></i> PUPBot</div>
            <div class="nav-item" data-page="documents"><i class="fas fa-folder-open"></i> Document Templates</div>
          ` : `
            <div class="nav-section-label">Main</div>
            <div class="nav-item active" data-page="announcements"><i class="fas fa-bullhorn"></i> Announcements <span class="nav-badge is-hidden" id="badge-announcements">0</span></div>
            ${isGuest ? '' : `<div class="nav-item" data-page="events"><i class="fas fa-calendar-alt"></i> Event Calendar <span class="nav-badge is-hidden" id="badge-events">0</span></div>`}
            <div class="nav-item" data-page="queueing"><i class="fas fa-ticket-alt"></i> Queueing</div>
            <div class="nav-item" data-page="lostfound"><i class="fas fa-search-location"></i> Lost & Found <span class="nav-badge is-hidden" id="badge-lostfound">0</span></div>
            ${isGuest ? '' : `
              ${u.role === 'faculty' ? `
                <div class="nav-item" data-page="teaching"><i class="fas fa-chalkboard-teacher"></i> Course Preference <span class="nav-badge is-hidden" id="badge-teaching">0</span></div>
              ` : `
                <div class="nav-item" data-page="section-schedules"><i class="fas fa-clock"></i> Class Schedules <span class="nav-badge is-hidden" id="badge-section-schedules">0</span></div>
              `}
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

        <!-- Mobile Header -->
        <div class="top-header">
          <button class="hamburger-btn" id="hamburgerBtn" aria-label="Open menu"><i class="fas fa-bars"></i></button>
          <div class="top-header-brand">
            <div class="brand-icon"><img src="${state.systemSettings?.app_logo || '/icons/pup_logo.png'}" alt="PUP Logo"></div>
            ${escHtml(state.systemSettings?.app_title || 'PUPSJ HUB')}
          </div>
          <div class="top-header-actions">
            <button class="btn-icon theme-toggle-btn" onclick="window._toggleTheme()" title="Toggle Dark/Light Mode">
              <i class="${document.documentElement.getAttribute('data-theme') === 'dark' ? 'fas fa-sun' : 'fas fa-moon'}"></i>
            </button>
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
        <div class="guest-banner">
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
      localStorage.removeItem('pupsj_token');
      sessionStorage.removeItem('ann_search_query');
      sessionStorage.removeItem('ann_date_filter');
      sessionStorage.removeItem('ann_custom_start');
      sessionStorage.removeItem('ann_custom_end');
      if (window._studentQueueInterval) {
        clearInterval(window._studentQueueInterval);
        window._studentQueueInterval = null;
      }
      stopNotificationsPolling();
      if (typeof stopLocatorPolling === 'function') stopLocatorPolling();
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
    // Module-gated admin pages: require the module (superadmin always allowed)
    const hasMod = (m) => isSuperAdmin || (Array.isArray(state.user?.modules) && state.user.modules.includes(m));
    if (page === 'admin-loading' && !(isAdmin && hasMod('loading_requests'))) {
      page = 'announcements';
    }
    if (page === 'lostfound' && isAdmin && !hasMod('lost_found')) {
      showToast('You do not have access to Lost & Found.', 'error');
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
      case 'teaching':
        if (state.user.role === 'faculty') renderLoadingPage();
        else loadSchedules(true);
        break;
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
      case 'admin-loading': renderAdminLoading(); break;
      case 'queueing': (['student', 'faculty', 'guest'].includes(state.user.role) ? renderStudentQueueing() : renderQueueing()); break;
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
      if (state.user.role === 'student' && state.myPages.length === 0) {
        await loadMyPages();
      }
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
        <div class="event-header-actions">
          ${isFacultyOrAdmin ? `
            <button class="btn btn-secondary" id="btnArchivedEvents" style="border-radius: 9999px; padding: 10px 20px; display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; cursor: pointer; transition: all 0.2s;">
              <i class="fas fa-archive"></i> Archived Events
            </button>
          ` : ''}
          ${state.user.role !== 'student' || state.myPages.length > 0 ? `
            <button class="btn btn-primary" id="btnCreateEvent" style="background: #880808; border: none; color: #fff; border-radius: 9999px; padding: 10px 20px; display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; cursor: pointer; transition: all 0.2s; box-shadow: 0 2px 8px rgba(136,8,8,0.25);">
              <i class="fas fa-plus"></i> ${state.user.role === 'student' ? 'Post Event' : 'Create Event'}
            </button>
          ` : ''}
        </div>
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
            <div class="event-detail-author"><i class="fas fa-user"></i> Posted by ${escHtml(event.author_name || 'Unknown')}${event.page_name ? ` <span style="margin-left:6px;background:var(--bg-soft,#f3f4f6);border:1px solid var(--border);border-radius:20px;padding:2px 10px;font-size:11px;font-weight:600;color:var(--text-secondary);display:inline-flex;align-items:center;gap:5px;">${event.page_logo ? `<img src="${event.page_logo}" style="width:14px;height:14px;border-radius:50%;object-fit:cover;">` : '<i class="fas fa-flag" style="font-size:10px;"></i>'} ${escHtml(event.page_name)}</span>` : ''}</div>
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
      const isLFAdmin = state.user && (state.user.role === 'admin' || state.user.role === 'superadmin');
      if (!isLFAdmin) {
        state.filters.lfType = 'lost';
      }
      let lfQuery = '';
      if (!isLFAdmin) {
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
      if (isLFAdmin) {
        state.lostFoundReviews = await api('/api/lost-found/matches/all').catch(() => []);
        state.lostFoundRejected = await api('/api/lost-found/matches/rejected').catch(() => []);
      } else {
        state.lostFoundReviews = [];
        state.lostFoundRejected = [];
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
    const isAdmin = state.user && (state.user.role === 'admin' || state.user.role === 'superadmin');
    const isRestrictedRole = !isAdmin;
    const canPost = true;
    if (!state.activeMatchTab) state.activeMatchTab = 'pending';

    const hasLFLayout = pageArea.querySelector('.lf-layout-shell');

    // Build the matches dashboard content
    let matchDashboardHtml = '';
    if (isAdmin && (state.lostFoundReviews.length > 0 || state.lostFoundRejected.length > 0)) {
      matchDashboardHtml = `
        <div class="card lf-review-queue" style="margin-bottom: 24px; padding: 24px; border-radius: 12px; border: 1px solid var(--border); background: var(--bg-card);">
          <div class="lf-review-head" style="margin-bottom: 18px;">
            <h3 style="font-size: 18px; font-weight: 700; color: var(--text-primary); margin-bottom: 6px;"><i class="fas fa-magic" style="color: var(--primary);"></i> AI Matches &amp; Claim Dashboard</h3>
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
            <button class="btn btn-sm ${state.activeMatchTab === 'rejected' ? 'btn-primary' : 'btn-secondary'}" onclick="window._changeActiveMatchTab('rejected')" style="font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 6px; ${state.lostFoundRejected.length > 0 ? 'position:relative;' : ''}">
              Rejected (${state.lostFoundRejected.length})
              ${state.lostFoundRejected.length > 0 ? `<span style="position:absolute;top:-5px;right:-5px;background:#dc2626;color:#fff;border-radius:999px;font-size:10px;padding:1px 5px;font-weight:700;">${state.lostFoundRejected.length}</span>` : ''}
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

              const rejectedMatches = state.lostFoundRejected;

              const currentTabList = state.activeMatchTab === 'pending' ? pendingMatches 
                                    : state.activeMatchTab === 'approved' ? approvedMatches 
                                    : state.activeMatchTab === 'rejected' ? rejectedMatches
                                    : claimedMatches;
                                      
              if (currentTabList.length === 0) {
                return `<div class="empty-state" style="padding: 24px 0; text-align: center; color: var(--text-secondary);">
                  <i class="fas fa-search-location" style="font-size: 24px; margin-bottom: 8px; opacity: 0.5;"></i>
                  <p style="font-size: 13px; margin: 0;">${state.activeMatchTab === 'rejected' ? 'No rejected matches. Good work!' : 'No items found in this category.'}</p>
                </div>`;
              }

              // Ensure valid index bounds
              const maxIdx = currentTabList.length - 1;
              if (typeof state.lfMatchIndex !== 'number' || state.lfMatchIndex < 0) state.lfMatchIndex = 0;
              if (state.lfMatchIndex > maxIdx) state.lfMatchIndex = maxIdx;
              const currentIndex = state.lfMatchIndex;
              const review = currentTabList[currentIndex];
              
              const lost = review.lost_item;
              const found = review.found_item;
              const score = review.match_score || 0;
              const normalizedScore = score > 1 ? score / 100 : score;
              const pct = Math.round(normalizedScore * 100);
              const isRejected = state.activeMatchTab === 'rejected';
              
              return `
                <!-- Top Arrow Navigation Bar -->
                <div class="lf-match-nav-bar" style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-primary); padding: 10px 16px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 4px;">
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="background: var(--primary); color: #fff; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 999px; display: inline-flex; align-items: center; gap: 6px;">
                      <i class="fas fa-layer-group" style="font-size: 10px;"></i> Match ${currentIndex + 1} of ${currentTabList.length}
                    </span>
                    <span style="font-size: 12px; color: var(--text-secondary); display: inline-flex; align-items: center; gap: 4px;">
                      <i class="fas fa-keyboard" style="opacity: 0.7;"></i> Use <kbd style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 4px; padding: 1px 6px; font-size: 11px; font-family: monospace;">←</kbd> <kbd style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 4px; padding: 1px 6px; font-size: 11px; font-family: monospace;">→</kbd> arrow keys to scroll
                    </span>
                  </div>
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <button class="btn btn-sm btn-secondary" onclick="window._navigateLFMatch(-1)" ${currentIndex <= 0 ? 'disabled style="opacity: 0.45; cursor: not-allowed;"' : ''} title="Previous Match (← Left Arrow)" style="font-size: 12px; font-weight: 600; padding: 5px 12px; border-radius: 6px; display: inline-flex; align-items: center; gap: 6px;">
                      <i class="fas fa-chevron-left"></i> Prev
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="window._navigateLFMatch(1)" ${currentIndex >= maxIdx ? 'disabled style="opacity: 0.45; cursor: not-allowed;"' : ''} title="Next Match (→ Right Arrow)" style="font-size: 12px; font-weight: 600; padding: 5px 12px; border-radius: 6px; display: inline-flex; align-items: center; gap: 6px;">
                      Next <i class="fas fa-chevron-right"></i>
                    </button>
                  </div>
                </div>

                <div class="lf-review-card" style="border: 1px solid var(--border); border-radius: 10px; padding: 20px; background: var(--bg-primary); display: flex; flex-direction: column; gap: 16px; transition: all 0.2s ease;">
                  <!-- Card Header: Match Score / Status -->
                  <div class="lf-review-card-hdr" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed var(--border); padding-bottom: 10px;">
                    <span class="match-score-badge" style="font-size: 12px; font-weight: 700; background: var(--primary-soft); color: var(--primary); padding: 4px 10px; border-radius: 999px; display: flex; align-items: center; gap: 6px;">
                      <i class="fas fa-chart-line"></i> AI Match Score: ${pct}%
                    </span>
                    <span class="lf-status-badge ${state.activeMatchTab}" style="font-size: 11px; font-weight: 700; text-transform: uppercase; padding: 4px 10px; border-radius: 4px; ${
                      state.activeMatchTab === 'pending' ? 'background: #fef3c7; color: #d97706;' 
                      : state.activeMatchTab === 'approved' ? 'background: #dbeafe; color: #2563eb;' 
                      : state.activeMatchTab === 'rejected' ? 'background: #fee2e2; color: #b91c1c;'
                      : 'background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe;'
                    }">
                      ${state.activeMatchTab === 'pending' ? 'Pending Review' : state.activeMatchTab === 'approved' ? 'Approved' : state.activeMatchTab === 'rejected' ? 'Rejected' : 'Claimed'}
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
                  <div class="lf-review-actions" style="display: flex; justify-content: space-between; align-items: center; gap: 10px; border-top: 1px solid var(--border); padding-top: 12px;">
                    <div style="display: flex; gap: 6px;">
                      <button class="btn btn-sm btn-secondary" onclick="window._navigateLFMatch(-1)" ${currentIndex <= 0 ? 'disabled style="opacity: 0.45; cursor: not-allowed;"' : ''} title="Previous Match" style="font-size: 11px; font-weight: 600; padding: 5px 12px; border-radius: 6px; display: inline-flex; align-items: center; gap: 5px;">
                        <i class="fas fa-chevron-left"></i> Prev
                      </button>
                      <button class="btn btn-sm btn-secondary" onclick="window._navigateLFMatch(1)" ${currentIndex >= maxIdx ? 'disabled style="opacity: 0.45; cursor: not-allowed;"' : ''} title="Next Match" style="font-size: 11px; font-weight: 600; padding: 5px 12px; border-radius: 6px; display: inline-flex; align-items: center; gap: 5px;">
                        Next <i class="fas fa-chevron-right"></i>
                      </button>
                    </div>

                    <div style="display: flex; align-items: center; gap: 10px;">
                      ${state.activeMatchTab === 'pending' ? `
                        <button class="btn btn-success btn-sm" onclick="window._decideLostFoundReview('${found.id}','approve','${lost.id}')" style="font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 6px;"><i class="fas fa-check"></i> Approve Match</button>
                        <button class="btn btn-danger btn-sm" onclick="window._decideLostFoundReview('${found.id}','reject','${lost.id}')" style="font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 6px;"><i class="fas fa-times"></i> Reject Match</button>
                      ` : state.activeMatchTab === 'approved' ? `
                        <button class="btn btn-success btn-sm" onclick="window._claimLostFoundMatch('${lost.id}','${found.id}')" style="font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 6px; background: #166534 !important; border-color: #166534 !important;"><i class="fas fa-hand-holding-heart"></i> Claimed</button>
                      ` : state.activeMatchTab === 'rejected' ? `
                        <span style="font-size: 12px; color: var(--text-secondary); margin-right: 6px;"><i class="fas fa-info-circle"></i> Previously rejected — re-open if this was a mistake</span>
                        <button class="btn btn-secondary btn-sm" onclick="window._reopenLostFoundMatch('${found.id}','${lost.id}')" style="font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 6px;"><i class="fas fa-undo"></i> Re-open for Review</button>
                      ` : `
                        <span style="font-size: 13px; color: #166534; font-weight: 600; display: flex; align-items: center; gap: 6px; margin-right: 6px;"><i class="fas fa-check-circle"></i> Handed over and resolved</span>
                        <button class="btn btn-secondary btn-sm" onclick="window._unclaimLostFoundMatch('${lost.id}','${found.id}')" style="font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 6px;"><i class="fas fa-undo"></i> Unclaim</button>
                      `}
                    </div>
                  </div>
                </div>
              `;
            })()}
          </div>
        </div>
      `;
    }

    // Filter items: only unresolved lost items can be seen in student account, guest and faculty
    const displayLostFound = state.lostFound.filter(item => {
      if (!isAdmin) {
        if (item.type !== 'lost') return false;
        if (['resolved', 'claimed', 'closed', 'deleted'].includes(item.status) || item.is_archived) return false;
        if (item.matched_item && ['resolved', 'claimed', 'closed'].includes(item.matched_item.status)) return false;
        if (item.matched_with && (item.status === 'resolved' || item.status === 'claimed')) return false;
      }
      return true;
    });

    // Build the items list content
    const renderedCards = displayLostFound.map(item => {
      const isResolved = item.status === 'resolved' || item.status === 'claimed';
      if (!isAdmin && (item.type !== 'lost' || isResolved)) {
        return '';
      }
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
      } else if (item.status === 'matched') {
        statusBadge = '<span style="background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; padding:4px 10px; border-radius:4px; font-size:11px; font-weight:700; display:inline-flex; align-items:center; gap:5px; text-transform:uppercase; letter-spacing:0.5px;"><i class="fas fa-link"></i> Match Found</span>';
      }

      if (isResolved && item.matched_item) {
        if (!isAdmin) return '';
        const match = item.matched_item;
        return `
          <div class="card lf-card lf-card--resolved lf-card-pair" style="padding: 20px; border: 1px solid var(--border); margin-bottom: 16px; border-radius: 12px; background: var(--bg-card);">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px dashed var(--border); padding-bottom: 12px; margin-bottom: 14px;">
              <span style="font-size: 13px; font-weight: 700; color: #15803d; display: flex; align-items: center; gap: 6px;">
                <i class="fas fa-check-circle"></i> Resolved Match Pair (Handed Over & Closed)
              </span>
              <span class="lf-resolved-badge"><i class="fas fa-hand-holding-heart"></i> Matched & Resolved</span>
            </div>
            <div class="lf-pair-columns" style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
              <!-- Left: Found Item -->
              <div class="lf-pair-subcard" style="background: var(--bg-primary); padding: 14px; border-radius: 8px; border: 1px solid var(--border);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
                  <span class="lf-type-badge found" style="font-size: 10px;">Found Item</span>
                  <span style="font-size: 11px; color: var(--text-light);"><i class="fas fa-clock"></i> ${timeAgo(item.created_at)}</span>
                </div>
                <h4 style="margin:0 0 6px; font-size: 15px; color: var(--text-primary); text-decoration: line-through; opacity: 0.75;">${escHtml(item.item_name)}</h4>
                <p style="font-size: 13px; color: var(--text-secondary); margin: 0 0 8px;">${escHtml(item.description || 'No description')}</p>
                <div class="lf-card-meta" style="font-size: 11px;">
                  ${item.category ? `<span><i class="fas fa-tag"></i> ${escHtml(item.category)}</span>` : ''}
                  ${item.location_found ? `<span><i class="fas fa-map-marker-alt"></i> ${escHtml(item.location_found)}</span>` : ''}
                  ${item.reporter_name ? `<span><i class="fas fa-user-tie"></i> Reporter: ${escHtml(item.reporter_name)}</span>` : ''}
                </div>
                ${item.images && item.images.length > 0 && item.images[0].id ? `
                <div class="lf-card-images" style="margin-top: 8px;">
                  ${item.images.map(img => `<img src="${img.image_url}" alt="item" onclick="window._openImageViewer('${img.image_url}')" style="width: 44px; height: 44px; object-fit: cover; border-radius: 6px; cursor: pointer;">`).join('')}
                </div>` : ''}
              </div>

              <!-- Right: Lost Item -->
              <div class="lf-pair-subcard" style="background: var(--bg-primary); padding: 14px; border-radius: 8px; border: 1px solid var(--border);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
                  <span class="lf-type-badge lost" style="font-size: 10px;">Matched Lost Report</span>
                  <span style="font-size: 11px; color: var(--text-light);"><i class="fas fa-calendar"></i> ${match.date_lost_found ? new Date(match.date_lost_found).toLocaleDateString('en-US', {month: 'short', day: 'numeric'}) : 'Reported'}</span>
                </div>
                <h4 style="margin:0 0 6px; font-size: 15px; color: var(--text-primary); text-decoration: line-through; opacity: 0.75;">${escHtml(match.item_name)}</h4>
                <p style="font-size: 13px; color: var(--text-secondary); margin: 0 0 8px;">${escHtml(match.description || 'No description')}</p>
                <div class="lf-card-meta" style="font-size: 11px;">
                  ${match.category ? `<span><i class="fas fa-tag"></i> ${escHtml(match.category)}</span>` : ''}
                  ${match.location_found ? `<span><i class="fas fa-map-marker-alt"></i> ${escHtml(match.location_found)}</span>` : ''}
                  ${match.reporter_name ? `<span><i class="fas fa-user"></i> Poster: ${escHtml(match.reporter_name)}</span>` : ''}
                </div>
                ${match.images && match.images.length > 0 && match.images[0].id ? `
                <div class="lf-card-images" style="margin-top: 8px;">
                  ${match.images.map(img => `<img src="${img.image_url}" alt="item" onclick="window._openImageViewer('${img.image_url}')" style="width: 44px; height: 44px; object-fit: cover; border-radius: 6px; cursor: pointer;">`).join('')}
                </div>` : ''}
              </div>
            </div>
            ${canManage ? `
              <div class="lf-card-actions" style="margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end;">
                <button class="btn btn-danger btn-sm" onclick="window._deleteLostFound('${item.id}')"><i class="fas fa-trash-alt"></i> Delete</button>
              </div>` : ''}
          </div>
        `;
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
    }).filter(Boolean).join('');

    let itemsHtml = '';
    if (!renderedCards) {
      itemsHtml = `
        <div class="empty-state">
          <i class="fas fa-box-open"></i>
          <h3>${state.filters.lfType === 'resolved' ? 'No resolved cases yet' : 'No items reported'}</h3>
          <p>${canPost ? 'Report a lost or found item using the + button.' : 'Check back later.'}</p>
        </div>`;
    } else {
      itemsHtml = `<div class="lf-items-list">${renderedCards}</div>`;
    }

    const tabsHtml = isRestrictedRole ? `
      <button class="lf-tab active" data-type="lost">Lost Items</button>
    ` : `
      <button class="lf-tab ${state.filters.lfType === 'all' ? 'active' : ''}" data-type="all">All</button>
      <button class="lf-tab ${state.filters.lfType === 'lost' ? 'active' : ''}" data-type="lost">Lost</button>
      <button class="lf-tab ${state.filters.lfType === 'found' ? 'active' : ''}" data-type="found">Found</button>
      ${isAdmin ? `
        <button class="lf-tab ${state.filters.lfType === 'resolved' ? 'active' : ''}" data-type="resolved">Resolved</button>
        <button class="lf-tab ${state.filters.lfType === 'archived' ? 'active' : ''}" data-type="archived">Archived</button>
      ` : ''}
      <button class="lf-tab ${state.filters.lfType === 'pending-guest' ? 'active' : ''}" data-type="pending-guest">Pending Guest Reports</button>
    `;

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
        tabs.innerHTML = tabsHtml;
        tabs.querySelectorAll('.lf-tab').forEach(el => {
          el.onclick = () => {
            state.filters.lfType = el.dataset.type;
            loadLostFound();
          };
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
              ${tabsHtml}
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
    const isArchived = state.filters.lfType === 'archived';
    const msg = isArchived
      ? 'Permanently delete this item from archives? This action cannot be undone.'
      : 'Delete this item?';
    if (!await window.showSystemConfirm(msg)) return;
    try {
      await api(`/api/lost-found/${id}${isArchived ? '?permanent=true' : ''}`, { method: 'DELETE' });
      showToast(isArchived ? 'Item permanently deleted' : 'Item deleted', 'success');
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


  window._reopenLostFoundMatch = (foundId, lostId) => {
    openModal('custom-confirm', {
      title: 'Re-open Match Review',
      message: 'Restore this rejected match back to pending review?',
      submessage: 'This allows admins to review and approve the match again if it was rejected by mistake.',
      icon: 'fa-undo',
      yesLabel: 'Yes, Re-open Match',
      onConfirm: async () => {
        try {
          const res = await api(`/api/lost-found/matches/reopen/${foundId}`, {
            method: 'PATCH',
            body: JSON.stringify({ lostId }),
          });
          showToast(res.message || 'Match re-opened for review', 'success');
          state.activeMatchTab = 'pending';
          loadLostFound();
        } catch (err) {
          showToast(err.message || 'Failed to re-open match', 'error');
        }
      }
    });
  };

  window._changeActiveMatchTab = (tab) => {
    state.activeMatchTab = tab;
    state.lfMatchIndex = 0;
    renderLostFoundPage();
  };

  window._navigateLFMatch = (dir) => {
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
    const rejectedMatches = state.lostFoundRejected || [];
    const currentTabList = state.activeMatchTab === 'pending' ? pendingMatches 
                          : state.activeMatchTab === 'approved' ? approvedMatches 
                          : state.activeMatchTab === 'rejected' ? rejectedMatches
                          : claimedMatches;

    if (!currentTabList || currentTabList.length <= 1) return;
    const cur = typeof state.lfMatchIndex === 'number' ? state.lfMatchIndex : 0;
    const next = cur + dir;
    if (next >= 0 && next < currentTabList.length) {
      state.lfMatchIndex = next;
      renderLostFoundPage();
    }
  };

  if (!window._lfMatchKeyNavInitialized) {
    window._lfMatchKeyNavInitialized = true;
    window.addEventListener('keydown', (e) => {
      if (state.currentPage !== 'lostfound') return;
      const isAdmin = state.user && (state.user.role === 'admin' || state.user.role === 'superadmin');
      if (!isAdmin) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
      if (document.querySelector('.modal-backdrop.show, .modal.show, .modal-open, .custom-modal.show')) return;
      
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        window._navigateLFMatch(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        window._navigateLFMatch(1);
      }
    });
  }

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
    if (state.user.role === 'faculty') return 'Class Schedules';
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

  // ════════════════════════════════
  //  FACULTY LOADING REQUEST (replaces the old teaching-schedule view)
  //  Term -> Type -> Program -> Subject (offering). Faculty claim admin-defined
  //  slots; times/rooms are fixed by the offering, so no free-text time entry.
  // ════════════════════════════════
  const TERM_LABELS = { SUMMER: 'Summer', FIRST_SEMESTER: '1st Semester', SECOND_SEMESTER: '2nd Semester' };
  const LOADING_STATUS = {
    pending:  { label: 'Pending',  color: '#b45309', bg: '#fef3c7' },
    approved: { label: 'Approved', color: '#15803d', bg: '#dcfce7' },
    rejected: { label: 'Rejected', color: '#b91c1c', bg: '#fee2e2' },
    returned: { label: 'Returned for revision', color: '#1d4ed8', bg: '#dbeafe' },
  };

  // ── Shared portfolio-section builder ─────────────────────────────────────────
  // Used in both the gate form and the approved-faculty edit panel.
  // `cred`    — current faculty_credentials object
  // `pfx`     — CSS class prefix (e.g. 'gate' → classes gate-research-title, etc.)
  const _PORT_CATS = [
    { key: 'research',  label: 'Research'  },
    { key: 'trainings', label: 'Trainings' },
    { key: 'extension', label: 'Extension' },
    { key: 'awards',    label: 'Awards'    },
  ];
  function buildPortfolioSection(cred, pfx) {
    const port = (cred && cred.portfolio) ? cred.portfolio : {};
    const rows = _PORT_CATS.map((cat, ci) =>
      [0,1,2].map(i => {
        const entry = (port[cat.key] || [])[i] || {};
        const bg    = (ci * 3 + i) % 2 === 0 ? 'var(--bg-card,#fff)' : '#fafafa';
        const sep   = (ci > 0 || i > 0) ? 'border-top:1px solid var(--border,#e2e8f0);' : '';
        return `<div style="display:grid;grid-template-columns:110px 1fr 1fr;${sep}background:${bg};">
          <div style="padding:5px 10px;border-right:1px solid var(--border,#e2e8f0);display:flex;align-items:center;">
            ${i === 0 ? `<span style="font-size:12px;font-weight:700;color:#b91c1c;">${cat.label}</span>` : ''}
          </div>
          <div style="padding:5px 8px;border-right:1px solid var(--border,#e2e8f0);">
            <input class="form-input ${pfx}-${cat.key}-title" style="font-size:12px;padding:4px 8px;" placeholder="Title / description..." value="${escHtml(entry.title||'')}">
          </div>
          <div style="padding:5px 8px;">
            <input class="form-input ${pfx}-${cat.key}-url" style="font-size:12px;padding:4px 8px;" placeholder="https://..." value="${escHtml(entry.url||'')}">
          </div>
        </div>`;
      }).join('')
    ).join('');
    return `
      <div class="form-group" style="border-top:1px solid var(--border,#e2e8f0);padding-top:16px;margin-top:8px;">
        <label class="form-label" style="font-size:14px;font-weight:700;display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <i class="fas fa-link" style="color:var(--maroon);font-size:13px;"></i>Portfolio Links
          <span style="font-size:12px;font-weight:400;color:var(--text-light);">(For the Last 3 Years)</span>
        </label>
        <p style="font-size:12px;color:var(--text-light);margin:0 0 10px;">Fill in your research, trainings, extension work, and awards. Leave blank if not applicable.</p>
        <div style="border:1px solid var(--border,#e2e8f0);border-radius:8px;overflow:hidden;">
          <div style="display:grid;grid-template-columns:110px 1fr 1fr;background:var(--maroon,#880808);">
            <div style="color:#fff;font-size:11px;font-weight:700;padding:8px 10px;border-right:1px solid #6b0606;">Category</div>
            <div style="color:#fff;font-size:11px;font-weight:700;padding:8px 10px;border-right:1px solid #6b0606;">Title / Description</div>
            <div style="color:#fff;font-size:11px;font-weight:700;padding:8px 10px;">Link / URL</div>
          </div>
          ${rows}
        </div>
      </div>`;
  }
  function collectPortfolio(pfx) {
    const result = {};
    _PORT_CATS.forEach(cat => {
      const titles = [...document.querySelectorAll(`.${pfx}-${cat.key}-title`)].map(i => i.value.trim());
      const urls   = [...document.querySelectorAll(`.${pfx}-${cat.key}-url`)].map(i => i.value.trim());
      result[cat.key] = titles.map((t, i) => ({ title: t, url: urls[i] || '' }))
                               .filter(e => e.title || e.url);
    });
    return result;
  }

  // Shown when faculty's profile is not yet approved.
  // The specialization form is embedded directly here — no redirect to My Profile.
  function renderProfileGatePage(prof) {
    const pageArea = document.getElementById('pageArea');
    const status = prof.status; // null | 'pending' | 'rejected'
    const cred = prof.credentials || {};
    const arr = (v, n) => { const a = Array.isArray(v) ? v.slice(0, n) : []; while (a.length < n) a.push(''); return a; };
    // Use employment_type from the API response (most reliable — covers old sessions)
    const isPartTime = (prof.employment_type || '').toLowerCase() === 'part_time';

    const isPending  = status === 'pending';
    const isRejected = status === 'rejected';
    const isFirst    = !status;

    // Top status banner
    const banner = isPending
      ? `<div style="background:#fef9c3;border:1px solid #fde047;border-radius:10px;padding:16px 20px;display:flex;gap:14px;align-items:flex-start;margin-bottom:20px;">
           <i class="fas fa-hourglass-half" style="color:#b45309;font-size:22px;margin-top:2px;"></i>
           <div>
             <div style="font-weight:700;font-size:14px;color:#92400e;">Specialization Under Review</div>
             <p style="margin:4px 0 0;font-size:13px;color:#78350f;">Your profile is waiting for admin review. You can still update your information below and re-submit — this will reset the review so admin sees your latest details.</p>
           </div>
         </div>`
      : isRejected
      ? `<div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:10px;padding:16px 20px;display:flex;gap:14px;align-items:flex-start;margin-bottom:20px;">
           <i class="fas fa-exclamation-circle" style="color:#b91c1c;font-size:22px;margin-top:2px;"></i>
           <div>
             <div style="font-weight:700;font-size:14px;color:#991b1b;">Profile Needs Revision</div>
             <p style="margin:4px 0 0;font-size:13px;color:#7f1d1d;">${escHtml(prof.remarks || 'Please update your specialization and re-submit.')}</p>
           </div>
         </div>`
      : `<div style="background:#dbeafe;border:1px solid #93c5fd;border-radius:10px;padding:16px 20px;display:flex;gap:14px;align-items:flex-start;margin-bottom:20px;">
           <i class="fas fa-info-circle" style="color:#1d4ed8;font-size:22px;margin-top:2px;"></i>
           <div>
             <div style="font-weight:700;font-size:14px;color:#1e3a8a;">Specialization Required</div>
             <p style="margin:4px 0 0;font-size:13px;color:#1e40af;">Fill in your specialization below and submit for admin review. The admin will assign programs you are qualified to teach before you can submit loading requests.</p>
           </div>
         </div>`;

    // The editable form (shown for first-time and rejected; read-only when pending)
    const specInputs = arr(cred.specializations, 3).map((v, i) =>
      `<input class="form-input spec-input" style="margin-bottom:6px;" placeholder="Specialization ${i + 1}${i===0?' (required)':''}" value="${escHtml(v)}" >`).join('');
    const eduInputs = arr(cred.education, 3).map((v, i) =>
      `<input class="form-input edu-input" style="margin-bottom:6px;" placeholder="Degree ${i + 1} (e.g. BSIT, MIT)" value="${escHtml(v)}" >`).join('');

    pageArea.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Course Preference</h1>
        <p class="page-subtitle">Complete your specialization profile to get access to loading requests.</p>
      </div>
      <div class="page-content">
        ${banner}
        <div class="card" style="padding:20px;margin-bottom:24px;">
          <div style="font-weight:700;font-size:15px;margin-bottom:16px;display:flex;align-items:center;gap:8px;">
            <i class="fas fa-award" style="color:var(--maroon);"></i> Faculty Specialization Profile
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Academic Title</label>
              <input class="form-input" id="gateTitle" placeholder="e.g. Assistant Professor 1"
                value="${escHtml(cred.academic_title || '')}" >
            </div>
            <div class="form-group">
              <label class="form-label">Preferred Programs / Departments <span style="color:var(--maroon);">*</span></label>
              <p style="font-size:12px;color:var(--text-light);margin:0 0 6px;">Select all programs you want to teach. Admin reviews and confirms the final assignment.</p>
              <div style="position:relative;" id="gateProgramWrap">
                <div id="gateProgramTrigger" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border:1px solid var(--border,#e2e8f0);border-radius:8px;cursor:pointer;background:var(--bg-card,#fff);min-height:40px;gap:8px;">
                  <span id="gateProgramLabel" style="font-size:13px;color:var(--text-secondary,#777);">-- Select programs --</span>
                  <i class="fas fa-chevron-down" style="font-size:11px;color:var(--text-light);flex-shrink:0;"></i>
                </div>
                <div id="gateProgramList" style="display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;background:var(--bg-card,#fff);border:1px solid var(--border,#e2e8f0);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);z-index:200;padding:8px;">
                  ${['BSA','BSBAFM','BSEDEN','BSENT','BSHM','BSIT','BSPSY','DIT'].map(p => {
                    const checked = (cred.preferred_programs || []).includes(p);
                    return `<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:13px;user-select:none;">
                      <input type="checkbox" class="gate-prog-chk" value="${p}" ${checked ? 'checked' : ''}  onchange="window._updateGateProgramLabel()"> ${p}
                    </label>`;
                  }).join('')}
                </div>
              </div>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Specializations <span style="color:var(--maroon);">*</span></label>
            <p style="font-size:12px;color:var(--text-light);margin:0 0 8px;">Enter at least one subject area or field you specialize in.</p>
            ${specInputs}
          </div>

          <div class="form-group">
            <label class="form-label">Educational Background</label>
            <p style="font-size:12px;color:var(--text-light);margin:0 0 8px;">List your degrees, most recent first (e.g. MIT — Technology Management, BSIT).</p>
            ${eduInputs}
          </div>

          ${buildPortfolioSection(cred, 'gate')}

          ${isPartTime ? `
            <div class="form-group" style="border-top:1px solid var(--border,#e2e8f0);padding-top:16px;margin-top:8px;" id="gateSchedSection">
              <label class="form-label" style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                <i class="fas fa-clock" style="color:var(--maroon);font-size:13px;"></i>
                Preferred Schedule
                <span style="background:#fef3c7;color:#92400e;font-size:11px;padding:2px 8px;border-radius:20px;font-weight:700;">Part-Time</span>
              </label>
              <p style="font-size:12px;color:var(--text-light);margin:0 0 12px;">Add each day you are available and the time window for that day. You can add multiple days.</p>

              <div style="display:grid;grid-template-columns:1fr 1fr 1fr 32px;gap:8px;margin-bottom:6px;padding:0 2px;">
                <div style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;">Day</div>
                <div style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;">From</div>
                <div style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;">To</div>
                <div></div>
              </div>
              <div id="gateSchedRows"></div>
              <button type="button" class="btn btn-secondary btn-sm" id="gateAddSchedRow" style="margin-top:8px;font-size:12px;">
                <i class="fas fa-plus"></i> Add Day
              </button>
            </div>` : ''}

          <div style="margin-top:16px;">
            <button class="btn btn-primary" id="ldSubmitProfile">
              <i class="fas fa-paper-plane"></i>
              ${isPending ? 'Update & Resubmit' : isRejected ? 'Re-submit for Review' : 'Submit for Review'}
            </button>
          </div>
        </div>

        <h2 style="font-size:16px;font-weight:700;margin:0 0 12px;">My Requests</h2>
        <div id="ldRequests"><div class="loader"><div class="spinner"></div></div></div>
      </div>`;

    // Programs dropdown toggle
    const trigger = document.getElementById('gateProgramTrigger');
    const list    = document.getElementById('gateProgramList');
    if (trigger && list) {
      trigger.onclick = () => { list.style.display = list.style.display === 'none' ? 'block' : 'none'; };
      document.addEventListener('click', function _closeGateDrop(e) {
        if (!document.getElementById('gateProgramWrap')?.contains(e.target)) {
          list.style.display = 'none';
          document.removeEventListener('click', _closeGateDrop);
        }
      });
    }

    // Programs dropdown label updater
    window._updateGateProgramLabel = () => {
      const checked = [...document.querySelectorAll('.gate-prog-chk:checked')].map(c => c.value);
      const lbl = document.getElementById('gateProgramLabel');
      if (lbl) lbl.textContent = checked.length ? checked.join(', ') : '-- Select programs --';
    };
    window._updateGateProgramLabel();

    // ── Part-time preferred schedule rows ──────────────────────────────────────
    if (isPartTime) {
      const _SCHED_DAYS  = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
      const _SCHED_SLOTS = (() => {
        const s = [];
        for (let h = 7; h <= 21; h++) {
          ['00','30'].forEach(m => {
            if (h === 21 && m === '30') return;
            const val = `${String(h).padStart(2,'0')}:${m}`;
            s.push({ val, label: val });
          });
        }
        return s;
      })();
      const _TIME_OPTS = `<option value="">--</option>` +
        _SCHED_SLOTS.map(s => `<option value="${s.val}">${s.label}</option>`).join('');

      // Migrate old format (preferred_days + preferred_time_from/to → new rows)
      const _savedRows = Array.isArray(cred.preferred_schedule) && cred.preferred_schedule.length
        ? cred.preferred_schedule
        : Array.isArray(cred.preferred_days) && cred.preferred_days.length
          ? cred.preferred_days.map(d => ({ day: d, from: cred.preferred_time_from || '', to: cred.preferred_time_to || '' }))
          : [{ day: '', from: '', to: '' }];

      window._gateSchedRows = _savedRows.map(r => ({ ...r }));

      function _setOpts(sel, val) {
        // Set selected option on a freshly built select
        [...sel.options].forEach(o => { o.selected = o.value === val; });
      }

      window._renderGateSchedRows = () => {
        const container = document.getElementById('gateSchedRows');
        if (!container) return;
        container.innerHTML = window._gateSchedRows.map((row, i) => `
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr 32px;gap:8px;margin-bottom:8px;align-items:center;" id="gsRow${i}">
            <select class="form-input form-select" id="gsDay${i}" style="font-size:13px;">
              <option value="">-- Day --</option>
              ${_SCHED_DAYS.map(d => `<option value="${d}" ${row.day===d?'selected':''}>${d}</option>`).join('')}
            </select>
            <select class="form-input form-select" id="gsFrom${i}" style="font-size:13px;">
              ${_TIME_OPTS}
            </select>
            <select class="form-input form-select" id="gsTo${i}" style="font-size:13px;">
              ${_TIME_OPTS}
            </select>
            <button type="button" onclick="window._removeGateSchedRow(${i})"
              style="width:32px;height:32px;border:1px solid #fca5a5;border-radius:6px;background:#fee2e2;color:#b91c1c;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;"
              title="Remove row">&times;</button>
          </div>`).join('');
        // Re-apply saved from/to values (innerHTML wipes them)
        window._gateSchedRows.forEach((row, i) => {
          _setOpts(document.getElementById(`gsFrom${i}`), row.from || '');
          _setOpts(document.getElementById(`gsTo${i}`),   row.to   || '');
          document.getElementById(`gsDay${i}` ).onchange  = e => { window._gateSchedRows[i].day  = e.target.value; };
          document.getElementById(`gsFrom${i}`).onchange  = e => { window._gateSchedRows[i].from = e.target.value; };
          document.getElementById(`gsTo${i}`  ).onchange  = e => { window._gateSchedRows[i].to   = e.target.value; };
        });
      };

      window._removeGateSchedRow = (i) => {
        window._gateSchedRows.splice(i, 1);
        if (!window._gateSchedRows.length) window._gateSchedRows.push({ day: '', from: '', to: '' });
        window._renderGateSchedRows();
      };

      window._addGateSchedRow = () => {
        window._gateSchedRows.push({ day: '', from: '', to: '' });
        window._renderGateSchedRows();
      };

      window._renderGateSchedRows();
      const addBtn = document.getElementById('gateAddSchedRow');
      if (addBtn) addBtn.onclick = window._addGateSchedRow;
    }

    document.getElementById('ldSubmitProfile').onclick = async () => {
        const specializations    = [...document.querySelectorAll('.spec-input')].map(i => i.value.trim()).filter(Boolean);
        const education          = [...document.querySelectorAll('.edu-input')].map(i => i.value.trim()).filter(Boolean);
        const academic_title     = (document.getElementById('gateTitle')?.value || '').trim();
        const preferred_programs = [...document.querySelectorAll('.gate-prog-chk:checked')].map(c => c.value);

        if (!specializations.length) {
          showToast('Please enter at least one specialization.', 'error');
          return;
        }
        if (!preferred_programs.length) {
          showToast('Please select at least one preferred program/department.', 'error');
          return;
        }

        // Collect part-time schedule rows; validate each filled row
        let preferred_schedule;
        if (isPartTime) {
          const rows = (window._gateSchedRows || []).filter(r => r.day || r.from || r.to);
          for (const r of rows) {
            if (!r.day) { showToast('Please select a day for every schedule row.', 'error'); return; }
            if (r.from && r.to && r.from >= r.to) {
              showToast(`End time must be after start time for ${r.day}.`, 'error'); return;
            }
          }
          preferred_schedule = rows;
        }

        const updatedCred = {
          ...cred,
          academic_title,
          specializations,
          education,
          preferred_programs,
          portfolio: collectPortfolio('gate'),
        };
        if (isPartTime) updatedCred.preferred_schedule = preferred_schedule;

        try {
          await api('/api/auth/me', {
            method: 'PATCH',
            body: JSON.stringify({
              first_name: state.user.first_name,
              last_name:  state.user.last_name,
              faculty_credentials: updatedCred,
            }),
          });
          await api('/api/loading/profile/submit', { method: 'POST' });
          showToast('Specialization submitted! You will be notified once programs are assigned.', 'success');
          renderLoadingPage();
        } catch (err) { showToast(err.message, 'error'); }
    };

    loadMyLoadingRequests();
  }

  async function renderLoadingPage() {
    const pageArea = document.getElementById('pageArea');
    // Gate: check profile status before showing the request form
    try {
      const prof = await api('/api/loading/my-programs');
      if (prof.status !== 'approved') {
        renderProfileGatePage(prof);
        return;
      }
      state._ldAllowedPrograms = prof.programs;
    } catch (err) {
      pageArea.innerHTML = `<div class="page-header"><h1 class="page-title">Course Preference</h1></div><div class="page-content"><div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${escHtml(err.message)}</p></div></div>`;
      return;
    }
    state._loadingOfferings = [];
    pageArea.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Course Preference</h1>
        <p class="page-subtitle">Choose a term and subject offering, then submit your loading request for admin review.</p>
        ${state._ldAllowedPrograms?.length ? `<p style="font-size:12px;color:var(--text-light);margin:2px 0 0;">Your assigned programs: <strong style="color:var(--maroon);">${state._ldAllowedPrograms.map(escHtml).join(', ')}</strong></p>` : ''}
      </div>
      <div class="page-content">
        <div class="card" style="padding:20px; margin-bottom:20px;">
          <div class="form-row">
            <div class="form-group"><label>Term</label>
              <input type="hidden" id="ldTerm" value="${state.activeTerm || 'FIRST_SEMESTER'}">
              <div class="form-input" style="background:var(--bg-soft,#f8fafc);color:var(--text-secondary,#555);cursor:default;display:flex;align-items:center;gap:6px;">
                <i class="fas fa-lock" style="font-size:11px;opacity:.6;"></i>
                ${state.activeYear || ''} · ${TERM_LABELS[state.activeTerm] || state.activeTerm || 'Not set'}
              </div></div>
            <div class="form-group"><label>Subject Type</label>
              <select class="form-input form-select" id="ldType" disabled><option value="">--</option></select></div>
            <div class="form-group"><label>Program</label>
              <select class="form-input form-select" id="ldProgram" disabled><option value="">--</option></select></div>
          </div>
          <div class="form-group"><label>Subject Offering</label>
            <select class="form-input form-select" id="ldOffering" disabled><option value="">--</option></select></div>
          <div id="ldOfferingInfo" style="display:none; background:var(--bg-soft,#f8fafc); border:1px solid var(--border); border-radius:8px; padding:12px 16px; margin-bottom:14px; font-size:13px;"></div>
          <div class="form-group"><label>Remarks (optional)</label>
            <textarea class="form-input" id="ldRemarks" rows="2" placeholder="Any note for the admin reviewing your request"></textarea></div>
          <button class="btn btn-primary" id="ldSubmit" disabled><i class="fas fa-paper-plane"></i> Submit Request</button>
        </div>
        <h2 style="font-size:16px; font-weight:700; margin:8px 0 12px;">My Requests</h2>
        <div id="ldRequests"><div class="loader"><div class="spinner"></div></div></div>

        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin:24px 0 12px; flex-wrap:wrap;">
          <h2 style="font-size:16px; font-weight:700; margin:0;">My Schedule</h2>
          <select class="form-input form-select" id="ldGridTerm" style="max-width:200px;">
            ${Object.entries(TERM_LABELS).map(([v, l]) => `<option value="${v}" ${v === (state.activeTerm||'') ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
        <div id="ldGrid"><div class="loader"><div class="spinner"></div></div></div>

        <!-- Edit Specialization — always available after approval -->
        <details id="ldEditSpecDetails" style="margin-top:28px;">
          <summary style="cursor:pointer;list-style:none;display:flex;align-items:center;gap:10px;padding:12px 16px;background:var(--bg-card,#fff);border:1px solid var(--border,#e2e8f0);border-radius:10px;font-weight:700;font-size:14px;user-select:none;" id="ldEditSpecSummary">
            <i class="fas fa-chevron-right" id="ldEditSpecChevron" style="font-size:11px;color:var(--text-light);transition:transform .2s;"></i>
            <i class="fas fa-edit" style="color:var(--maroon);"></i> Edit Specialization Profile
            <span style="font-size:12px;font-weight:400;color:var(--text-light);margin-left:4px;">— update and resubmit for admin re-review</span>
          </summary>
          <div style="padding:16px 0 0;" id="ldEditSpecBody">
            <div class="card" style="padding:20px;">
              <div id="ldEditSpecForm"><div class="loader"><div class="spinner"></div></div></div>
            </div>
          </div>
        </details>
      </div>`;

    const $ = (id) => document.getElementById(id);
    const termSel = $('ldTerm'), typeSel = $('ldType'), progSel = $('ldProgram'),
          offSel = $('ldOffering'), info = $('ldOfferingInfo'), submitBtn = $('ldSubmit');

    function resetSelect(sel, placeholder) {
      sel.innerHTML = `<option value="">${placeholder}</option>`;
      sel.disabled = true;
    }
    function fillSelect(sel, values, placeholder) {
      sel.innerHTML = `<option value="">${placeholder}</option>` +
        values.map(v => `<option value="${escHtml(v)}">${escHtml(v)}</option>`).join('');
      sel.disabled = values.length === 0;
    }
    function currentOfferings() {
      const t = typeSel.value, p = progSel.value;
      return state._loadingOfferings.filter(o =>
        (!t || (o.subject_type || '') === t) && (!p || (o.program || '') === p));
    }
    function refreshOfferingList() {
      const list = currentOfferings();
      offSel.innerHTML = `<option value="">-- Select subject --</option>` +
        list.map(o => {
          const pending = o.pending_count > 0 ? ` (${o.pending_count} other${o.pending_count > 1 ? 's' : ''} applied)` : '';
          return `<option value="${o.id}">${escHtml(o.subject_name)} — ${o.day_of_week} ${formatTime(o.start_time)}-${formatTime(o.end_time)}${o.section ? ' · ' + escHtml(o.section) : ''}${pending}</option>`;
        }).join('');
      offSel.disabled = list.length === 0;
      info.style.display = 'none';
      submitBtn.disabled = true;
    }

    async function loadOfferings() {
      resetSelect(typeSel, '--'); resetSelect(progSel, '--'); resetSelect(offSel, '--');
      info.style.display = 'none'; submitBtn.disabled = true;
      if (!termSel.value) return;
      try {
        state._loadingOfferings = await api(`/api/loading/offerings?term=${encodeURIComponent(termSel.value)}&academic_year=${encodeURIComponent(state.activeYear||'')}`);
        const types = [...new Set(state._loadingOfferings.map(o => o.subject_type).filter(Boolean))].sort();
        fillSelect(typeSel, types, 'All types');
        const progs = [...new Set(state._loadingOfferings.map(o => o.program).filter(Boolean))].sort();
        fillSelect(progSel, progs, 'All programs');
        refreshOfferingList();
        if (state._loadingOfferings.length === 0) showToast('No available offerings for this term yet.', 'info');
      } catch (err) { showToast(err.message, 'error'); }
    }
    termSel.onchange = loadOfferings;
    typeSel.onchange = refreshOfferingList;
    progSel.onchange = refreshOfferingList;
    offSel.onchange = () => {
      const o = state._loadingOfferings.find(x => x.id === offSel.value);
      if (!o) { info.style.display = 'none'; submitBtn.disabled = true; return; }
      info.style.display = 'block';
      info.innerHTML = `<strong>${escHtml(o.subject_name)}</strong><br>
        <i class="fas fa-calendar-day"></i> ${o.day_of_week} &nbsp;
        <i class="fas fa-clock"></i> ${formatTime(o.start_time)}-${formatTime(o.end_time)} &nbsp;
        ${o.room ? `<i class="fas fa-door-open"></i> ${escHtml(o.room)} &nbsp;` : ''}
        ${o.section ? `<i class="fas fa-users"></i> ${escHtml(o.section)}` : ''}
        ${o.pending_count > 0 ? `<br><span style="color:#b45309;font-size:12px;"><i class="fas fa-users" style="margin-right:4px;"></i>${o.pending_count} other ${o.pending_count === 1 ? 'faculty has' : 'faculty have'} also requested this subject. The admin will decide who gets assigned.</span>` : ''}`;
      submitBtn.disabled = false;
    };
    submitBtn.onclick = async () => {
      if (!offSel.value) return;
      submitBtn.disabled = true;
      try {
        const r = await api('/api/loading/requests', {
          method: 'POST',
          body: JSON.stringify({ offering_id: offSel.value, remarks: $('ldRemarks').value }),
        });
        if (r.warnings && r.warnings.length) showToast(r.warnings.join(' '), 'info');
        showToast('Request submitted for review.', 'success');
        $('ldRemarks').value = '';
        loadOfferings();
        loadMyLoadingRequests();
      } catch (err) {
        showToast(err.message, 'error');
        submitBtn.disabled = false;
      }
    };

    loadOfferings();
    loadMyLoadingRequests();

    const gridTerm = $('ldGridTerm');
    gridTerm.value = termSel.value || state.activeTerm || 'FIRST_SEMESTER';
    gridTerm.onchange = () => loadScheduleGrid(gridTerm.value);
    loadScheduleGrid(gridTerm.value);

    loadMyLoadingRequests();
  }

  async function renderLoadingPage() {
    const pageArea = document.getElementById('pageArea');
    // Gate: check profile status before showing the request form
    try {
      const prof = await api('/api/loading/my-programs');
      if (prof.status !== 'approved') {
        renderProfileGatePage(prof);
        return;
      }
      state._ldAllowedPrograms = prof.programs;
    } catch (err) {
      pageArea.innerHTML = `<div class="page-header"><h1 class="page-title">Course Preference</h1></div><div class="page-content"><div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${escHtml(err.message)}</p></div></div>`;
      return;
    }
    state._loadingOfferings = [];
    pageArea.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Course Preference</h1>
        <p class="page-subtitle">Choose a term and subject offering, then submit your loading request for admin review.</p>
        ${state._ldAllowedPrograms?.length ? `<p style="font-size:12px;color:var(--text-light);margin:2px 0 0;">Your assigned programs: <strong style="color:var(--maroon);">${state._ldAllowedPrograms.map(escHtml).join(', ')}</strong></p>` : ''}
      </div>
      <div class="page-content">
        <div class="card" style="padding:20px; margin-bottom:20px;">
          <div class="form-row">
            <div class="form-group"><label>Term</label>
              <input type="hidden" id="ldTerm" value="${state.activeTerm || 'FIRST_SEMESTER'}">
              <div class="form-input" style="background:var(--bg-soft,#f8fafc);color:var(--text-secondary,#555);cursor:default;display:flex;align-items:center;gap:6px;">
                <i class="fas fa-lock" style="font-size:11px;opacity:.6;"></i>
                ${state.activeYear || ''} · ${TERM_LABELS[state.activeTerm] || state.activeTerm || 'Not set'}
              </div></div>
            <div class="form-group"><label>Subject Type</label>
              <select class="form-input form-select" id="ldType" disabled><option value="">--</option></select></div>
            <div class="form-group"><label>Program</label>
              <select class="form-input form-select" id="ldProgram" disabled><option value="">--</option></select></div>
          </div>
          <div class="form-group"><label>Subject Offering</label>
            <select class="form-input form-select" id="ldOffering" disabled><option value="">--</option></select></div>
          <div id="ldOfferingInfo" style="display:none; background:var(--bg-soft,#f8fafc); border:1px solid var(--border); border-radius:8px; padding:12px 16px; margin-bottom:14px; font-size:13px;"></div>
          <div class="form-group"><label>Remarks (optional)</label>
            <textarea class="form-input" id="ldRemarks" rows="2" placeholder="Any note for the admin reviewing your request"></textarea></div>
          <button class="btn btn-primary" id="ldSubmit" disabled><i class="fas fa-paper-plane"></i> Submit Request</button>
        </div>
        <h2 style="font-size:16px; font-weight:700; margin:8px 0 12px;">My Requests</h2>
        <div id="ldRequests"><div class="loader"><div class="spinner"></div></div></div>

        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin:24px 0 12px; flex-wrap:wrap;">
          <h2 style="font-size:16px; font-weight:700; margin:0;">My Schedule</h2>
          <select class="form-input form-select" id="ldGridTerm" style="max-width:200px;">
            ${Object.entries(TERM_LABELS).map(([v, l]) => `<option value="${v}" ${v === (state.activeTerm||'') ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
        <div id="ldGrid"><div class="loader"><div class="spinner"></div></div></div>

        <!-- Edit Specialization — always available after approval -->
        <details id="ldEditSpecDetails" style="margin-top:28px;">
          <summary style="cursor:pointer;list-style:none;display:flex;align-items:center;gap:10px;padding:12px 16px;background:var(--bg-card,#fff);border:1px solid var(--border,#e2e8f0);border-radius:10px;font-weight:700;font-size:14px;user-select:none;" id="ldEditSpecSummary">
            <i class="fas fa-chevron-right" id="ldEditSpecChevron" style="font-size:11px;color:var(--text-light);transition:transform .2s;"></i>
            <i class="fas fa-edit" style="color:var(--maroon);"></i> Edit Specialization Profile
            <span style="font-size:12px;font-weight:400;color:var(--text-light);margin-left:4px;">— update and resubmit for admin re-review</span>
          </summary>
          <div style="padding:16px 0 0;" id="ldEditSpecBody">
            <div class="card" style="padding:20px;">
              <div id="ldEditSpecForm"><div class="loader"><div class="spinner"></div></div></div>
            </div>
          </div>
        </details>
      </div>`;

    const $ = (id) => document.getElementById(id);
    const termSel = $('ldTerm'), typeSel = $('ldType'), progSel = $('ldProgram'),
          offSel = $('ldOffering'), info = $('ldOfferingInfo'), submitBtn = $('ldSubmit');

    function resetSelect(sel, placeholder) {
      sel.innerHTML = `<option value="">${placeholder}</option>`;
      sel.disabled = true;
    }
    function fillSelect(sel, values, placeholder) {
      sel.innerHTML = `<option value="">${placeholder}</option>` +
        values.map(v => `<option value="${escHtml(v)}">${escHtml(v)}</option>`).join('');
      sel.disabled = values.length === 0;
    }
    function currentOfferings() {
      const t = typeSel.value, p = progSel.value;
      return state._loadingOfferings.filter(o =>
        (!t || (o.subject_type || '') === t) && (!p || (o.program || '') === p));
    }
    function refreshOfferingList() {
      const list = currentOfferings();
      offSel.innerHTML = `<option value="">-- Select subject --</option>` +
        list.map(o => {
          const pending = o.pending_count > 0 ? ` (${o.pending_count} other${o.pending_count > 1 ? 's' : ''} applied)` : '';
          return `<option value="${o.id}">${escHtml(o.subject_name)} — ${o.day_of_week} ${formatTime(o.start_time)}-${formatTime(o.end_time)}${o.section ? ' · ' + escHtml(o.section) : ''}${pending}</option>`;
        }).join('');
      offSel.disabled = list.length === 0;
      info.style.display = 'none';
      submitBtn.disabled = true;
    }

    async function loadOfferings() {
      resetSelect(typeSel, '--'); resetSelect(progSel, '--'); resetSelect(offSel, '--');
      info.style.display = 'none'; submitBtn.disabled = true;
      if (!termSel.value) return;
      try {
        state._loadingOfferings = await api(`/api/loading/offerings?term=${encodeURIComponent(termSel.value)}&academic_year=${encodeURIComponent(state.activeYear||'')}`);
        const types = [...new Set(state._loadingOfferings.map(o => o.subject_type).filter(Boolean))].sort();
        fillSelect(typeSel, types, 'All types');
        const progs = [...new Set(state._loadingOfferings.map(o => o.program).filter(Boolean))].sort();
        fillSelect(progSel, progs, 'All programs');
        refreshOfferingList();
        if (state._loadingOfferings.length === 0) showToast('No available offerings for this term yet.', 'info');
      } catch (err) { showToast(err.message, 'error'); }
    }
    termSel.onchange = loadOfferings;
    typeSel.onchange = refreshOfferingList;
    progSel.onchange = refreshOfferingList;
    offSel.onchange = () => {
      const o = state._loadingOfferings.find(x => x.id === offSel.value);
      if (!o) { info.style.display = 'none'; submitBtn.disabled = true; return; }
      info.style.display = 'block';
      info.innerHTML = `<strong>${escHtml(o.subject_name)}</strong><br>
        <i class="fas fa-calendar-day"></i> ${o.day_of_week} &nbsp;
        <i class="fas fa-clock"></i> ${formatTime(o.start_time)}-${formatTime(o.end_time)} &nbsp;
        ${o.room ? `<i class="fas fa-door-open"></i> ${escHtml(o.room)} &nbsp;` : ''}
        ${o.section ? `<i class="fas fa-users"></i> ${escHtml(o.section)}` : ''}
        ${o.pending_count > 0 ? `<br><span style="color:#b45309;font-size:12px;"><i class="fas fa-users" style="margin-right:4px;"></i>${o.pending_count} other ${o.pending_count === 1 ? 'faculty has' : 'faculty have'} also requested this subject. The admin will decide who gets assigned.</span>` : ''}`;
      submitBtn.disabled = false;
    };
    submitBtn.onclick = async () => {
      if (!offSel.value) return;
      submitBtn.disabled = true;
      try {
        const r = await api('/api/loading/requests', {
          method: 'POST',
          body: JSON.stringify({ offering_id: offSel.value, remarks: $('ldRemarks').value }),
        });
        if (r.warnings && r.warnings.length) showToast(r.warnings.join(' '), 'info');
        showToast('Request submitted for review.', 'success');
        $('ldRemarks').value = '';
        loadOfferings();
        loadMyLoadingRequests();
      } catch (err) {
        showToast(err.message, 'error');
        submitBtn.disabled = false;
      }
    };

    loadOfferings();
    loadMyLoadingRequests();

    const gridTerm = $('ldGridTerm');
    gridTerm.value = termSel.value || state.activeTerm || 'FIRST_SEMESTER';
    gridTerm.onchange = () => loadScheduleGrid(gridTerm.value);
    loadScheduleGrid(gridTerm.value);

    // Edit specialization details — lazy-load form when expanded
    const editDetails  = $('ldEditSpecDetails');
    const editChevron  = $('ldEditSpecChevron');
    let   editLoaded   = false;
    editDetails.addEventListener('toggle', async () => {
      editChevron.style.transform = editDetails.open ? 'rotate(90deg)' : '';
      if (!editDetails.open || editLoaded) return;
      editLoaded = true;
      const form = $('ldEditSpecForm');
      try {
        const prof = await api('/api/loading/my-programs');
        const c = prof.credentials || {};
        const arr = (v, n) => { const a = Array.isArray(v) ? v.slice(0, n) : []; while (a.length < n) a.push(''); return a; };
        const specInputs = arr(c.specializations, 3).map((v, i) =>
          `<input class="form-input edit-spec-input" style="margin-bottom:6px;" placeholder="Specialization ${i+1}${i===0?' (required)':''}" value="${escHtml(v)}">`).join('');
        const eduInputs = arr(c.education, 3).map((v, i) =>
          `<input class="form-input edit-edu-input" style="margin-bottom:6px;" placeholder="Degree ${i+1} (e.g. MIT, BSIT)" value="${escHtml(v)}">`).join('');
        const progChks = ['BSA','BSBAFM','BSEDEN','BSENT','BSHM','BSIT','BSPSY','DIT'].map(p => {
          const sel = (c.preferred_programs||[]).includes(p);
          return `<label style="display:flex;align-items:center;gap:6px;font-size:13px;padding:4px 8px;border-radius:6px;border:1px solid ${sel?'var(--maroon)':'var(--border)'};background:${sel?'#fff0f0':'transparent'};cursor:pointer;">
            <input type="checkbox" class="edit-prog-chk" value="${p}" ${sel?'checked':''}> ${p}
          </label>`;
        }).join('');
        form.innerHTML = `
          <div class="form-row" style="margin-bottom:12px;">
            <div class="form-group"><label class="form-label">Academic Title</label>
              <input class="form-input" id="editCredTitle" value="${escHtml(c.academic_title||'')}" placeholder="e.g. Assistant Professor 1"></div>
          </div>
          <div class="form-group"><label class="form-label">Specializations <span style="color:var(--maroon);">*</span></label>${specInputs}</div>
          <div class="form-group"><label class="form-label">Educational Background</label>${eduInputs}</div>
          <div class="form-group">
            <label class="form-label">Preferred Programs</label>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:6px;">${progChks}</div>
          </div>
          ${buildPortfolioSection(c, 'edit')}
          ${(state.user.employment_type||'').toLowerCase()==='part_time' ? `
          <div class="form-group" style="border-top:1px solid var(--border,#e2e8f0);padding-top:16px;margin-top:8px;">
            <label class="form-label" style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              <i class="fas fa-clock" style="color:var(--maroon);font-size:13px;"></i>Preferred Schedule
              <span style="background:#fef3c7;color:#92400e;font-size:11px;padding:2px 8px;border-radius:20px;font-weight:700;">Part-Time</span>
            </label>
            <p style="font-size:12px;color:var(--text-light);margin:0 0 12px;">Add each day you are available and the time window for that day.</p>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr 32px;gap:8px;margin-bottom:6px;padding:0 2px;">
              <div style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;">Day</div>
              <div style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;">From</div>
              <div style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;">To</div>
              <div></div>
            </div>
            <div id="editSchedRows"></div>
            <button type="button" class="btn btn-secondary btn-sm" id="editAddSchedRow" style="margin-top:8px;font-size:12px;">
              <i class="fas fa-plus"></i> Add Day
            </button>
          </div>` : ''}
          <div style="margin-top:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <button class="btn btn-primary" id="editCredSave"><i class="fas fa-paper-plane"></i> Save & Resubmit for Review</button>
            <span style="font-size:12px;color:var(--text-light);">Your profile status will reset to Pending until admin re-reviews.</span>
          </div>`;

        // Init edit schedule rows (part-time only)
        if ((state.user.employment_type||'').toLowerCase() === 'part_time') {
          const _EDIT_DAYS  = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
          const _EDIT_SLOTS = (() => {
            const s = [];
            for (let h = 7; h <= 21; h++) {
              ['00','30'].forEach(m => {
                if (h === 21 && m === '30') return;
                const val = `${String(h).padStart(2,'0')}:${m}`;
                s.push({ val, label: val });
              });
            }
            return s;
          })();
          const _EDIT_TIME_OPTS = `<option value="">--</option>` +
            _EDIT_SLOTS.map(s => `<option value="${s.val}">${s.label}</option>`).join('');
          const _savedEditRows = Array.isArray(c.preferred_schedule) && c.preferred_schedule.length
            ? c.preferred_schedule
            : Array.isArray(c.preferred_days) && c.preferred_days.length
              ? c.preferred_days.map(d => ({ day: d, from: c.preferred_time_from||'', to: c.preferred_time_to||'' }))
              : [{ day: '', from: '', to: '' }];
          window._editSchedRows = _savedEditRows.map(r => ({ ...r }));

          function _setEditOpts(sel, val) { [...sel.options].forEach(o => { o.selected = o.value === val; }); }
          window._renderEditSchedRows = () => {
            const container = $('editSchedRows');
            if (!container) return;
            container.innerHTML = window._editSchedRows.map((row, i) => `
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr 32px;gap:8px;margin-bottom:8px;align-items:center;">
                <select class="form-input form-select" id="esDay${i}" style="font-size:13px;">
                  <option value="">-- Day --</option>
                  ${_EDIT_DAYS.map(d => `<option value="${d}" ${row.day===d?'selected':''}>${d}</option>`).join('')}
                </select>
                <select class="form-input form-select" id="esFrom${i}" style="font-size:13px;">${_EDIT_TIME_OPTS}</select>
                <select class="form-input form-select" id="esTo${i}"   style="font-size:13px;">${_EDIT_TIME_OPTS}</select>
                <button type="button" onclick="window._removeEditSchedRow(${i})"
                  style="width:32px;height:32px;border:1px solid #fca5a5;border-radius:6px;background:#fee2e2;color:#b91c1c;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">&times;</button>
              </div>`).join('');
            window._editSchedRows.forEach((row, i) => {
              _setEditOpts($(`esFrom${i}`), row.from||'');
              _setEditOpts($(`esTo${i}`),   row.to  ||'');
              $(`esDay${i}` ).onchange = e => { window._editSchedRows[i].day  = e.target.value; };
              $(`esFrom${i}`).onchange = e => { window._editSchedRows[i].from = e.target.value; };
              $(`esTo${i}`  ).onchange = e => { window._editSchedRows[i].to   = e.target.value; };
            });
          };
          window._removeEditSchedRow = (i) => {
            window._editSchedRows.splice(i, 1);
            if (!window._editSchedRows.length) window._editSchedRows.push({ day:'', from:'', to:'' });
            window._renderEditSchedRows();
          };
          window._renderEditSchedRows();
          const addEditBtn = $('editAddSchedRow');
          if (addEditBtn) addEditBtn.onclick = () => { window._editSchedRows.push({day:'',from:'',to:''}); window._renderEditSchedRows(); };
        }

        $('editCredSave').onclick = async () => {
          const specializations    = [...document.querySelectorAll('.edit-spec-input')].map(i=>i.value.trim()).filter(Boolean);
          const education          = [...document.querySelectorAll('.edit-edu-input')].map(i=>i.value.trim()).filter(Boolean);
          const preferred_programs = [...document.querySelectorAll('.edit-prog-chk:checked')].map(c=>c.value);
          const academic_title     = ($('editCredTitle')?.value||'').trim();
          if (!specializations.length) { showToast('Enter at least one specialization.','error'); return; }
          if (!preferred_programs.length) { showToast('Select at least one preferred program.','error'); return; }
          const isEditPartTime = (state.user.employment_type||'').toLowerCase() === 'part_time';
          let preferred_schedule;
          if (isEditPartTime) {
            const rows = (window._editSchedRows||[]).filter(r => r.day||r.from||r.to);
            for (const r of rows) {
              if (!r.day) { showToast('Please select a day for every schedule row.','error'); return; }
              if (r.from && r.to && r.from >= r.to) { showToast(`End time must be after start time for ${r.day}.`,'error'); return; }
            }
            preferred_schedule = rows;
          }
          try {
            const updatedCred = { ...c, academic_title, specializations, education, preferred_programs, portfolio: collectPortfolio('edit') };
            if (isEditPartTime) updatedCred.preferred_schedule = preferred_schedule;
            await api('/api/auth/me',{ method:'PATCH', body:JSON.stringify({
              first_name: state.user.first_name, last_name: state.user.last_name,
              faculty_credentials: updatedCred,
            })});
            await api('/api/loading/profile/submit',{ method:'POST' });
            showToast('Profile updated and resubmitted. You will be notified once programs are re-assigned.','success');
            renderLoadingPage();
          } catch(err) { showToast(err.message,'error'); }
        };
      } catch(err) {
        form.innerHTML = `<p style="color:var(--text-light);">${escHtml(err.message)}</p>`;
      }
    });
  }

  async function loadScheduleGrid(term) {
    const wrap = document.getElementById('ldGrid');
    if (!wrap) return;
    wrap.innerHTML = `<div class="loader"><div class="spinner"></div></div>`;
    try {
      const entries = await api(`/api/loading/schedule?term=${encodeURIComponent(term)}&mine=true&academic_year=${encodeURIComponent(state.activeYear||'')}`);
      wrap.innerHTML = buildFacultyPersonalGrid(entries);
    } catch (err) {
      wrap.innerHTML = `<div class="empty-state"><p>${escHtml(err.message)}</p></div>`;
    }
  }

  // ── Faculty personal timetable (own approved schedule only) ─────────────────
  function buildFacultyPersonalGrid(entries) {
    const DAYS  = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    const SHORT = { Monday:'Mon',Tuesday:'Tue',Wednesday:'Wed',Thursday:'Thu',Friday:'Fri',Saturday:'Sat',Sunday:'Sun' };
    const STEP  = 30;
    const ROW_HEIGHT = 44;
    const tmin  = t => {
      if (!t) return 0;
      const str = String(t).trim();
      const ampm = str.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i);
      if (ampm) {
        let h = parseInt(ampm[1], 10);
        const m = parseInt(ampm[2], 10);
        const ap = (ampm[3] || '').toUpperCase();
        if (ap === 'PM' && h !== 12) h += 12;
        if (ap === 'AM' && h === 12) h = 0;
        return h * 60 + m;
      }
      const [h, m] = str.split(':');
      return (+h || 0) * 60 + (+m || 0);
    };
    const fmt24 = m => { const h=Math.floor(m/60),mm=m%60; return `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`; };

    if (!entries.length) return `<div class="empty-state" style="padding:40px 0;"><i class="fas fa-calendar-times" style="font-size:32px;opacity:.3;"></i><h3 style="margin:12px 0 4px;">No approved schedule yet</h3><p style="color:var(--text-light);font-size:13px;">Your approved loading requests will appear here.</p></div>`;

    const activeDays = entries.some(e => e.day_of_week === 'Sunday')
      ? ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
      : ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const allStarts  = entries.map(e => tmin(e.start_time));
    const allEnds    = entries.map(e => tmin(e.end_time));
    const gridStart  = Math.floor(Math.min(...allStarts) / 60) * 60;
    const gridEnd    = Math.ceil(Math.max(...allEnds) / 60) * 60;

    const slots = [];
    for (let t = gridStart; t < gridEnd; t += STEP) slots.push(t);

    const covered = {};
    let rows = '';

    for (const slot of slots) {
      const isHour     = slot % 60 === 0;
      const timeTd = `<td style="
        width:80px;min-width:80px;
        background:${isHour ? '#f8f9fa' : '#fff'};
        border-right:2px solid #dee2e6;
        border-bottom:1px solid ${isHour ? '#ced4da' : '#f1f3f5'};
        padding:0 10px;height:${ROW_HEIGHT}px;
        vertical-align:top;
        text-align:right;white-space:nowrap;">
        <span style="display:block;position:relative;top:0;transform:translateY(-50%);font-size:11px;font-weight:${isHour ? '700' : '500'};color:${isHour ? '#495057' : '#6c757d'};">${fmt24(slot)}</span>
      </td>`;

      let dayCells = '';
      for (const day of activeDays) {
        if (covered[slot]?.[day]) { dayCells += ''; continue; }
        const entry = entries.find(e => e.day_of_week === day && tmin(e.start_time) === slot);
        if (entry) {
          const span = Math.max(1, Math.round((tmin(entry.end_time) - tmin(entry.start_time)) / STEP));
          for (let i = 1; i < span; i++) {
            const cs = slot + i * STEP;
            if (!covered[cs]) covered[cs] = {};
            covered[cs][day] = true;
          }
          const bg  = _color(entry.subject_name);
          const acc = _accent(entry.subject_name);
          dayCells += `<td rowspan="${span}" class="course-timetable-slot course-timetable-slot--occupied" style="padding:0;border:1px solid #e9ecef;vertical-align:top;min-width:130px;">
            <div class="course-timetable-event" style="background:${bg};border-left:4px solid ${acc};border-radius:6px;padding:7px 10px;height:100%;box-sizing:border-box;min-height:${span * ROW_HEIGHT}px;">
              <div style="font-size:12px;font-weight:700;color:#1a1a2e;line-height:1.3;margin-bottom:4px;">${escHtml(entry.subject_name)}</div>
              ${entry.section ? `<div style="display:inline-block;background:${acc};color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:20px;margin-bottom:5px;letter-spacing:.3px;">${escHtml(entry.section)}</div>` : ''}
              <div style="font-size:10.5px;color:#495057;margin-top:2px;">
                <i class="fas fa-clock" style="color:${acc};font-size:9px;margin-right:4px;"></i>${fmt24(tmin(entry.start_time))} – ${fmt24(tmin(entry.end_time))}
              </div>
              ${entry.room ? `<div style="font-size:10.5px;color:#495057;margin-top:3px;"><i class="fas fa-map-marker-alt" style="color:${acc};font-size:9px;margin-right:4px;"></i>Room ${escHtml(entry.room)}</div>` : ''}
            </div>
          </td>`;
        } else {
          const inBlock = Object.keys(covered[slot]||{}).includes(day);
          if (!inBlock) dayCells += `<td class="course-timetable-slot" style="border:1px solid #f1f3f5;height:${ROW_HEIGHT}px;background:#fdfdfe;"></td>`;
        }
      }
      rows += `<tr>${timeTd}${dayCells}</tr>`;
    }

    if (!rows) return `<div class="empty-state" style="padding:40px 0;"><i class="fas fa-calendar-times" style="font-size:32px;opacity:.3;"></i><h3 style="margin:12px 0 4px;">No approved schedule yet</h3></div>`;

    return `
      <div class="course-timetable" style="overflow-x:auto;border-radius:10px;border:1px solid #dee2e6;box-shadow:0 2px 8px rgba(0,0,0,0.07);">
        <table class="course-timetable-table" style="border-collapse:collapse;width:100%;min-width:520px;font-family:inherit;background:var(--bg-card);">
          <thead>
            <tr>
              <th class="course-timetable-time-head" style="background:#880808;color:#fff;padding:12px 10px;font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;text-align:center;width:80px;border-right:2px solid rgba(255,255,255,.2);">TIME</th>
              ${activeDays.map(d => `
                <th class="course-timetable-day-head" style="background:#880808;color:#fff;padding:12px 8px;text-align:center;border-left:1px solid rgba(255,255,255,.15);min-width:130px;">
                  <div style="font-size:13px;font-weight:700;letter-spacing:.3px;">${d}</div>
                </th>`).join('')}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // ── Shared grid constants ──────────────────────────────────────────────────
  const _GRID_DAYS   = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const _GRID_SHORT  = { Monday:'Mon',Tuesday:'Tue',Wednesday:'Wed',Thursday:'Thu',Friday:'Fri',Saturday:'Sat' };
  const _GRID_START  = 420, _GRID_END = 1230, _GRID_STEP = 30;
  const _GRID_COLORS  = ['#fff3cd','#d1ecf1','#d4edda','#fce8d5','#f8d7da','#e2d9f3','#d0f0fd','#dff5e3'];
  const _GRID_ACCENTS = ['#d4a017','#0c7b93','#1e7e34','#c96a1f','#b02a37','#6f42c1','#0077a8','#1a7d3c'];
  const _tmin  = (t) => {
    if (!t) return 0;
    const str = String(t).trim();
    const ampm = str.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i);
    if (ampm) {
      let h = parseInt(ampm[1], 10);
      const m = parseInt(ampm[2], 10);
      const ap = (ampm[3] || '').toUpperCase();
      if (ap === 'PM' && h !== 12) h += 12;
      if (ap === 'AM' && h === 12) h = 0;
      return h * 60 + m;
    }
    const [h, m] = str.split(':');
    return (+h || 0) * 60 + (+m || 0);
  };
  const _fmt   = (m) => { const h=Math.floor(m/60),mm=m%60; return `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`; };
  const _color = (s) => { let h=0; for(const c of String(s)) h=(h*31+c.charCodeAt(0))>>>0; return _GRID_COLORS[h%_GRID_COLORS.length]; };
  const _accent= (s) => { let h=0; for(const c of String(s)) h=(h*31+c.charCodeAt(0))>>>0; return _GRID_ACCENTS[h%_GRID_ACCENTS.length]; };
  const _th    = (txt, w) => `<th style="background:var(--maroon,#880808);color:#fff;border:1px solid #6b0606;padding:6px 4px;font-size:11px;${w?`width:${w};`:''}">${txt}</th>`;

  // Single program/dept grid
  function buildScheduleGridHtml(entries) {
    if (!entries.length) return `<div class="empty-state" style="padding:24px 0;"><i class="fas fa-calendar-times" style="font-size:28px;opacity:.3;"></i><p style="margin:8px 0 0;color:var(--text-light);font-size:13px;">No approved schedules yet.</p></div>`;

    const activeDays = _GRID_DAYS;
    const dayIndex = new Map(activeDays.map((day, index) => [day, index]));
    const summaryId = `course-timetable-summary-${entries.reduce((hash, entry) => {
      const key = `${entry.id || ''}${entry.day_of_week || ''}${entry.start_time || ''}`;
      for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
      return hash;
    }, 17)}`;
    const usedStarts = entries.map(e => _tmin(e.start_time));
    const usedEnds   = entries.map(e => _tmin(e.end_time));
    const rangeStart = Math.floor(Math.min(...usedStarts) / 60) * 60;
    const rangeEnd   = Math.ceil(Math.max(...usedEnds)   / 60) * 60 + _GRID_STEP;
    const slotHeight = 44;
    const slotCount = (rangeEnd - rangeStart) / _GRID_STEP;
    const dayLayouts = new Map();

    activeDays.forEach(day => {
      const dayEntries = entries
        .filter(entry => entry.day_of_week === day)
        .slice()
        .sort((a, b) => _tmin(a.start_time) - _tmin(b.start_time) || _tmin(a.end_time) - _tmin(b.end_time));
      const layout = new Map();
      let group = [];
      let groupEnd = -Infinity;

      const assignGroupLanes = () => {
        if (!group.length) return;
        const laneEnds = [];
        group.forEach(entry => {
          const start = _tmin(entry.start_time);
          let lane = laneEnds.findIndex(end => end <= start);
          if (lane === -1) lane = laneEnds.length;
          laneEnds[lane] = _tmin(entry.end_time);
          layout.set(entry, { lane });
        });
        group.forEach(entry => { layout.get(entry).laneCount = laneEnds.length; });
      };

      dayEntries.forEach(entry => {
        const start = _tmin(entry.start_time);
        if (group.length && start >= groupEnd) {
          assignGroupLanes();
          group = [];
          groupEnd = -Infinity;
        }
        group.push(entry);
        groupEnd = Math.max(groupEnd, _tmin(entry.end_time));
      });
      assignGroupLanes();
      dayLayouts.set(day, layout);
    });

    const timeLabels = Array.from({ length: slotCount + 1 }, (_, index) => {
      const isLast = index === slotCount;
      const timeStr = _fmt(rangeStart + index * _GRID_STEP);
      if (isLast) {
        return `<div class="course-grid-time course-grid-time--last" style="height:0;padding:0 12px;transform:translateY(-50%);position:relative;z-index:2;line-height:1;font-size:10px;font-weight:700;color:var(--text-secondary,#555);text-align:right;">${timeStr}</div>`;
      }
      return `<div class="course-grid-time">${timeStr}</div>`;
    }).join('');
    const dayColumns = activeDays.map(day => {
      const layout = dayLayouts.get(day);
      const events = entries.filter(entry => entry.day_of_week === day).map(entry => {
        const { lane, laneCount } = layout.get(entry);
        const top = ((_tmin(entry.start_time) - rangeStart) / _GRID_STEP) * slotHeight;
        const height = (((_tmin(entry.end_time) - _tmin(entry.start_time)) / _GRID_STEP) + 1) * slotHeight;
        const bg = _color(entry.subject_name);
        const accent = _accent(entry.subject_name);
        return `<article class="course-grid-event" style="top:${top}px;height:${height}px;left:calc(${lane} * 100% / ${laneCount});width:calc(100% / ${laneCount});background:${bg};border-left-color:${accent};">
          <h3>${escHtml(entry.subject_name)}</h3>
          <p class="course-grid-faculty">${escHtml(entry.faculty_name || 'Faculty to be assigned')}</p>
          ${entry.section ? `<span class="course-grid-section" style="background:${accent};">${escHtml(entry.section)}</span>` : ''}
          <p class="course-grid-meta"><i class="fas fa-clock"></i> ${_fmt(_tmin(entry.start_time))} – ${_fmt(_tmin(entry.end_time))}</p>
          ${entry.room ? `<p class="course-grid-meta"><i class="fas fa-map-marker-alt"></i> ${escHtml(entry.room)}</p>` : ''}
        </article>`;
      }).join('');
      return `<section class="course-grid-day" aria-label="${day} schedule" style="height:${slotCount * slotHeight}px;">${events}</section>`;
    }).join('');

    const summaryRows = entries.slice().sort((a, b) =>
      (dayIndex.get(a.day_of_week) ?? 99) - (dayIndex.get(b.day_of_week) ?? 99) || _tmin(a.start_time) - _tmin(b.start_time)
    ).map(entry => `<li>
      <span class="course-timetable-summary-day">${escHtml(_GRID_SHORT[entry.day_of_week] || entry.day_of_week)}</span>
      <span><strong>${escHtml(entry.subject_name)}</strong>${entry.section ? ` · ${escHtml(entry.section)}` : ''}</span>
      <span>${_fmt(_tmin(entry.start_time))}–${_fmt(_tmin(entry.end_time))}${entry.room ? ` · ${escHtml(entry.room)}` : ''}</span>
    </li>`).join('');

    return `<div class="course-timetable course-timetable--canvas">
      <div class="course-grid" style="min-width:980px;">
        <div class="course-grid-corner">Time</div>
        ${activeDays.map(day => `<div class="course-grid-day-head">${day}</div>`).join('')}
        <div class="course-grid-time-rail" style="height:${slotCount * slotHeight}px;">${timeLabels}</div>
        ${dayColumns}
      </div>
    </div>
    <details class="course-timetable-summary" id="${summaryId}">
      <summary><span>All scheduled subjects</span><span>${entries.length} subject${entries.length === 1 ? '' : 's'}</span></summary>
      <ul>${summaryRows}</ul>
    </details>`;
  }

  // Overview summary card (admin only) — one row per program
  function buildOverviewCard(entries) {
    const programs = [...new Set(entries.map(e => e.program || 'General'))].sort();
    const days = _GRID_DAYS;
    const rows = programs.map(p => {
      const pe = entries.filter(e => (e.program || 'General') === p);
      const facultySet = new Set(pe.map(e => e.faculty_name));
      const daySet = days.filter(d => pe.some(e => e.day_of_week === d));
      return `<tr style="border-bottom:1px solid #e2e8f0;">
        <td style="padding:8px 12px;font-weight:700;font-size:13px;">${escHtml(p)}</td>
        <td style="padding:8px 12px;font-size:12px;text-align:center;">${pe.length}</td>
        <td style="padding:8px 12px;font-size:12px;text-align:center;">${facultySet.size}</td>
        <td style="padding:8px 12px;font-size:12px;">${daySet.map(d=>_GRID_SHORT[d]).join(', ') || '—'}</td>
        <td style="padding:8px 12px;"><a href="#dept-${p.replace(/\s+/g,'-')}" style="font-size:12px;color:var(--maroon);text-decoration:none;"><i class="fas fa-arrow-down"></i> View</a></td>
      </tr>`;
    }).join('');
    return `<div class="card" style="margin-bottom:20px;overflow:hidden;">
      <div style="background:var(--maroon,#880808);color:#fff;padding:12px 16px;font-weight:700;font-size:14px;display:flex;align-items:center;gap:8px;">
        <i class="fas fa-table"></i> Schedule Overview — All Departments
      </div>
      <table style="border-collapse:collapse;width:100%;">
        <thead><tr style="background:#f8fafc;font-size:11px;color:var(--text-light);text-transform:uppercase;">
          <th style="padding:8px 12px;text-align:left;font-weight:700;">Program / Dept</th>
          <th style="padding:8px 12px;text-align:center;font-weight:700;">Subjects</th>
          <th style="padding:8px 12px;text-align:center;font-weight:700;">Faculty</th>
          <th style="padding:8px 12px;text-align:left;font-weight:700;">Days</th>
          <th style="padding:8px 12px;"></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  // Grouped output: overview (admin) + one collapsible section per program
  function buildAllDeptGrids(entries, isAdmin) {
    if (!entries.length) {
      return `<div class="empty-state"><i class="fas fa-calendar-times"></i><h3>No approved schedules yet</h3><p>Approve a loading request to see it here.</p></div>`;
    }
    const programs = [...new Set(entries.map(e => e.program || 'General'))].sort();
    const overview = isAdmin ? buildOverviewCard(entries) : '';
    const sections = programs.map(p => {
      const pe = entries.filter(e => (e.program || 'General') === p);
      const anchor = `dept-${p.replace(/\s+/g,'-')}`;
      return `<details id="${anchor}" open style="margin-bottom:14px;">
        <summary style="cursor:pointer;list-style:none;display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--bg-card,#fff);border:1px solid var(--border,#e2e8f0);border-radius:8px;font-weight:700;font-size:14px;user-select:none;">
          <i class="fas fa-chevron-right" style="font-size:11px;color:var(--text-light);transition:transform .2s;"></i>
          <i class="fas fa-graduation-cap" style="color:var(--maroon,#880808);"></i>
          ${escHtml(p)}
          <span style="margin-left:auto;font-size:11px;font-weight:400;color:var(--text-light);">${pe.length} subject${pe.length!==1?'s':''} · ${new Set(pe.map(e=>e.faculty_name)).size} faculty</span>
        </summary>
        <div style="padding:10px 0 0 0;">${buildScheduleGridHtml(pe)}</div>
      </details>`;
    }).join('');
    return overview + sections;
  }

  async function loadMyLoadingRequests() {
    const wrap = document.getElementById('ldRequests');
    if (!wrap) return;
    try {
      const rows = await api('/api/loading/requests/mine');
      if (!rows.length) {
        wrap.innerHTML = `<div class="empty-state"><i class="fas fa-clipboard-list"></i><h3>No requests yet</h3><p>Submit a request above to get started.</p></div>`;
        return;
      }
      // Group requests by curriculum (program) + semester so the list stays organized.
      const TERM_ORDER = { FIRST_SEMESTER: 0, SECOND_SEMESTER: 1, SUMMER: 2 };
      const groups = new Map();
      rows.forEach(r => {
        const program = r.program || 'General';
        const key = `${program}||${r.term}||${r.academic_year || ''}`;
        if (!groups.has(key)) groups.set(key, { program, term: r.term, academic_year: r.academic_year, items: [] });
        groups.get(key).items.push(r);
      });
      const sortedGroups = [...groups.values()].sort((a, b) =>
        a.program.localeCompare(b.program) ||
        (TERM_ORDER[a.term] ?? 9) - (TERM_ORDER[b.term] ?? 9) ||
        String(b.academic_year || '').localeCompare(String(a.academic_year || ''))
      );

      const cardHtml = (r) => {
        const s = LOADING_STATUS[r.status] || LOADING_STATUS.pending;
        return `<div class="card" style="padding:14px 16px; margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
            <div style="min-width:0; overflow:hidden;">
              <div style="font-weight:700; word-break:break-word; overflow-wrap:anywhere;">${escHtml(r.subject_name)}</div>
              <div style="font-size:12px; color:var(--text-light); margin-top:2px;">
                ${r.day_of_week} ${formatTime(r.start_time)}-${formatTime(r.end_time)}${r.room ? ' · ' + escHtml(r.room) : ''}${r.section ? ' · ' + escHtml(r.section) : ''}
              </div>
              ${r.admin_remarks ? `<div style="font-size:12px; margin-top:6px; color:var(--text-secondary,#555); word-break:break-word; overflow-wrap:anywhere;"><i class="fas fa-comment-dots"></i> ${escHtml(r.admin_remarks)}</div>` : ''}
            </div>
            <span style="background:${s.bg}; color:${s.color}; font-size:11px; font-weight:700; padding:3px 9px; border-radius:99px; white-space:nowrap;">${s.label}</span>
          </div>
          ${r.status === 'pending' ? `<div style="margin-top:10px;"><button class="btn btn-sm btn-secondary" onclick="window._withdrawLoading('${r.id}')"><i class="fas fa-times"></i> Withdraw</button></div>` : ''}
          ${r.status === 'rejected' ? `<div style="margin-top:10px;">
            ${r.is_available
              ? `<button class="btn btn-sm btn-primary" onclick="window._resubmitLoading('${r.offering_id}')"><i class="fas fa-redo"></i> Resubmit</button>`
              : `<span style="font-size:12px; color:var(--text-light);"><i class="fas fa-lock"></i> Slot already taken — resubmission unavailable</span>`}
          </div>` : ''}
        </div>`;
      };

      wrap.innerHTML = sortedGroups.map(g => {
        const semester = TERM_LABELS[g.term] || g.term;
        return `<div style="margin-bottom:18px;">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
            <span style="background:var(--maroon,#880808); color:#fff; font-size:11px; font-weight:700; padding:3px 10px; border-radius:99px;"><i class="fas fa-graduation-cap"></i> ${escHtml(g.program)}</span>
            <span style="font-size:13px; font-weight:700; color:var(--text-secondary,#333);">${escHtml(semester)}</span>
            ${g.academic_year ? `<span style="font-size:12px; color:var(--text-light);">A.Y. ${escHtml(g.academic_year)}</span>` : ''}
          </div>
          ${g.items.map(cardHtml).join('')}
        </div>`;
      }).join('');
    } catch (err) {
      wrap.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${escHtml(err.message)}</p></div>`;
    }
  }

  window._withdrawLoading = async (id) => {
    if (!await showSystemConfirm('Withdraw this pending request?')) return;
    try {
      await api(`/api/loading/requests/${id}`, { method: 'DELETE' });
      showToast('Request withdrawn.', 'success');
      loadMyLoadingRequests();
    } catch (err) { showToast(err.message, 'error'); }
  };

  window._resubmitLoading = async (offeringId) => {
    if (!await showSystemConfirm('Resubmit a request for this slot?')) return;
    try {
      await api('/api/loading/requests', { method: 'POST', body: JSON.stringify({ offering_id: offeringId }) });
      showToast('Request resubmitted successfully.', 'success');
      loadMyLoadingRequests();
    } catch (err) { showToast(err.message, 'error'); }
  };

  // ════════════════════════════════
  //  ADMIN — LOADING MANAGEMENT (offerings + approvals)
  // ════════════════════════════════
  const LOADING_PROGRAMS = ['BSA', 'BSBAFM', 'BSEDEN', 'BSENT', 'BSHM', 'BSIT', 'BSPSY', 'DIT'];

  function buildYearOptions(selected) {
    const cur = new Date().getFullYear();
    const years = [];
    for (let y = cur - 3; y <= cur + 10; y++) years.push(`${y}-${y+1}`);
    return years.map(y => `<option value="${y}"${y === selected ? ' selected' : ''}>${y}</option>`).join('');
  }

  function buildTimeSelect(id, selected, style) {
    const opts = ['<option value="">-- time --</option>'];
    for (let h = 6; h <= 22; h++) {
      for (const m of [0, 30]) {
        if (h === 22 && m === 30) continue;
        const val = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
        opts.push(`<option value="${val}"${selected === val ? ' selected' : ''}>${val}</option>`);
      }
    }
    return `<select class="form-input form-select" id="${id}"${style ? ` style="${style}"` : ''}>${opts.join('')}</select>`;
  }
  const LOADING_TYPES = ['MAJOR', 'GEED', 'ELEC', 'NSTP', 'PATHFIT'];
  const LOADING_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  function renderAdminLoading() {
    const pageArea = document.getElementById('pageArea');
    state._ldAdminTab  = state._ldAdminTab  || 'profiles';
    state._ldAdminTerm = state._ldAdminTerm || state.activeTerm || 'FIRST_SEMESTER';
    state._ldAdminYear = state._ldAdminYear || state.activeYear || '2025-2026';
    pageArea.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Course Preference</h1>
        <p class="page-subtitle">Define subject offerings, then review faculty course preferences.</p>
      </div>
      <div class="page-content">

        <!-- Semester control bar -->
        <div style="background:var(--bg-card,#fff);border:1px solid var(--border);border-radius:12px;padding:12px 16px;margin-bottom:12px;display:flex;align-items:center;gap:10px;flex-wrap:nowrap;overflow-x:auto;">
          <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-light);white-space:nowrap;">Viewing</span>
          <select class="form-input form-select" id="ldaYear" style="width:130px;min-width:130px;font-size:13px;">
            ${buildYearOptions(state._ldAdminYear)}
          </select>
          <select class="form-input form-select" id="ldaTerm" style="width:160px;min-width:160px;font-size:13px;">
            ${Object.entries(TERM_LABELS).map(([v, l]) => `<option value="${v}"${v === state._ldAdminTerm ? ' selected' : ''}>${l}</option>`).join('')}
          </select>
          <div style="flex:1;"></div>
          <div class="active-term-banner">
            <i class="fas fa-circle" style="font-size:7px;color:#15803d;"></i>
            <span style="font-size:12px;color:#15803d;">Active semester:</span>
            <strong id="ldaActiveTermLabel" style="font-size:13px;color:#14532d;">${state.activeYear} · ${TERM_LABELS[state.activeTerm] || state.activeTerm}</strong>
          </div>
          <button class="btn btn-sm btn-primary" id="ldaSetActiveTerm" style="font-size:12px;white-space:nowrap;flex-shrink:0;">
            <i class="fas fa-check-circle"></i> Set as Active
          </button>
        </div>

        <!-- Tab bar -->
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:16px;padding-bottom:2px;">
          <button class="btn btn-sm ${state._ldAdminTab === 'profiles' ? 'btn-primary' : 'btn-secondary'}" id="ldaTabProf">Faculty Profiles</button>
          <button class="btn btn-sm ${state._ldAdminTab === 'offerings' ? 'btn-primary' : 'btn-secondary'}" id="ldaTabOff">Offerings</button>
          <button class="btn btn-sm ${state._ldAdminTab === 'requests' ? 'btn-primary' : 'btn-secondary'}" id="ldaTabReq">Requests</button>
          <button class="btn btn-sm ${state._ldAdminTab === 'timetable' ? 'btn-primary' : 'btn-secondary'}" id="ldaTabGrid">Timetable</button>
          <div style="flex:1;"></div>
          <a class="btn btn-sm btn-secondary" id="ldaExport" href="#"><i class="fas fa-file-csv"></i> Export approved</a>
        </div>

        <div id="ldaBody"><div class="loader"><div class="spinner"></div></div></div>
      </div>`;

    const yearSel = document.getElementById('ldaYear');
    const termSel = document.getElementById('ldaTerm');
    yearSel.onchange = () => { state._ldAdminYear = yearSel.value; renderAdminLoadingBody(); };
    termSel.onchange = () => { state._ldAdminTerm = termSel.value; renderAdminLoadingBody(); };
    document.getElementById('ldaSetActiveTerm').onclick = async () => {
      const newYear = state._ldAdminYear;
      const newTerm = state._ldAdminTerm;
      try {
        await api('/api/admin/system-settings', { method: 'POST', body: JSON.stringify({ active_term: newTerm, active_year: newYear }) });
        state.activeTerm = newTerm;
        state.activeYear = newYear;
        document.getElementById('ldaActiveTermLabel').textContent = `${newYear} · ${TERM_LABELS[newTerm] || newTerm}`;
        showToast(`Active period set to ${newYear} · ${TERM_LABELS[newTerm] || newTerm}.`, 'success');
      } catch (err) { showToast(err.message, 'error'); }
    };
    document.getElementById('ldaTabProf').onclick = () => { state._ldAdminTab = 'profiles'; renderAdminLoading(); };
    document.getElementById('ldaTabOff').onclick = () => { state._ldAdminTab = 'offerings'; renderAdminLoading(); };
    document.getElementById('ldaTabReq').onclick = () => { state._ldAdminTab = 'requests'; renderAdminLoading(); };
    document.getElementById('ldaTabGrid').onclick = () => { state._ldAdminTab = 'timetable'; renderAdminLoading(); };
    document.getElementById('ldaExport').onclick = async (e) => {
      e.preventDefault();
      try {
        const res = await fetch(`/api/loading/admin/export?term=${state._ldAdminTerm}&academic_year=${encodeURIComponent(state._ldAdminYear||'')}`, {
          headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
        });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Export failed'); }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `loading-${state._ldAdminTerm}.csv`; a.click();
        URL.revokeObjectURL(url);
      } catch (err) { showToast(err.message, 'error'); }
    };
    renderAdminLoadingBody();
  }

  async function renderAdminLoadingBody() {
    if (state._ldAdminTab === 'profiles')  return renderAdminProfiles();
    if (state._ldAdminTab === 'offerings') return renderAdminOfferings();
    if (state._ldAdminTab === 'timetable') return renderAdminTimetable();
    return renderAdminRequests();
  }

  window._toggleFacultyAccordion = (id) => {
    const body = document.getElementById(`prof-body-${id}`);
    const chevron = document.getElementById(`prof-chevron-${id}`);
    if (!body) return;
    const isHidden = body.style.display === 'none';
    body.style.display = isHidden ? 'block' : 'none';
    if (chevron) {
      chevron.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
    }
  };

  async function renderAdminProfiles() {
    const body = document.getElementById('ldaBody');
    body.innerHTML = `<div class="loader"><div class="spinner"></div></div>`;
    try {
      const faculty = await api('/api/loading/admin/profiles');
      if (!faculty.length) {
        body.innerHTML = `<div class="empty-state"><i class="fas fa-users"></i><h3>No faculty accounts yet</h3><p>Faculty will appear here once they register.</p></div>`;
        return;
      }
      const STATUS_STYLE = {
        pending:  { bg:'#fef9c3', color:'#b45309', label:'Pending Review' },
        approved: { bg:'#dcfce7', color:'#15803d', label:'Approved' },
        rejected: { bg:'#fee2e2', color:'#b91c1c', label:'Needs Revision' },
        null:     { bg:'#f1f5f9', color:'#64748b', label:'Not Submitted' },
      };
      body.innerHTML = faculty.map(f => {
        const s = STATUS_STYLE[f.status] || STATUS_STYLE['null'];
        const cred = f.credentials || {};
        const specs = cred.specializations?.filter(Boolean) || [];
        const edu = cred.education?.filter(Boolean) || [];
        const assigned = Array.isArray(f.assigned_programs) ? f.assigned_programs : [];
        const isPending = f.status === 'pending';
        const isApproved = f.status === 'approved';
        const isPartTimeFaculty = (f.employment_type || '') === 'part_time';
        const fmt24 = t => { if (!t) return ''; const [h,m] = t.split(':'); return `${String(parseInt(h, 10)).padStart(2,'0')}:${m}`; };
        // ── Reusable panel + section-label styling for an organized layout ──────
        const labelCss  = 'font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--maroon,#880808);margin-bottom:10px;';
        const panelCss  = 'background:var(--bg-soft,#f8fafc);border:1px solid var(--border,#e2e8f0);border-radius:12px;padding:16px 18px;';
        const panel = (title, icon, inner) => `<div style="${panelCss}">
          <div style="${labelCss}">${icon ? `<i class="fas ${icon}" style="margin-right:6px;"></i>` : ''}${title}</div>
          ${inner}
        </div>`;
        const bullet = txt => `<div style="font-size:14px;padding:3px 0;display:flex;align-items:flex-start;gap:8px;"><i class="fas fa-circle" style="font-size:5px;color:var(--maroon,#880808);margin-top:7px;flex-shrink:0;"></i><span>${escHtml(txt)}</span></div>`;

        // Left panel: specializations + education + academic title
        const profilePanel = panel('Profile', 'fa-id-badge', `
          <div style="font-size:11px;font-weight:700;color:var(--text-light);margin-bottom:4px;">Specializations</div>
          ${specs.length ? specs.map(bullet).join('') : '<div style="font-size:13px;color:var(--text-light);font-style:italic;">None submitted yet.</div>'}
          ${edu.length ? `<div style="font-size:11px;font-weight:700;color:var(--text-light);margin:12px 0 4px;">Educational Background</div>${edu.map(bullet).join('')}` : ''}
          ${cred.academic_title ? `<div style="margin-top:12px;font-size:13px;color:var(--text-secondary,#555);">Academic Title: <strong style="color:var(--text-primary,#111);">${escHtml(cred.academic_title)}</strong></div>` : ''}
        `);

        // Right panel: faculty-requested programs
        const requestedPanel = cred.preferred_programs?.length ? panel('Requested Programs', 'fa-star', `
          <div style="font-size:11px;color:var(--text-light);margin:-4px 0 10px;">Faculty preference</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${cred.preferred_programs.map(p=>`<span style="background:#fff0f0;color:var(--maroon);font-size:12px;font-weight:700;padding:4px 12px;border-radius:99px;border:1px solid #fca5a5;">${escHtml(p)}</span>`).join('')}
          </div>
        `) : '';

        // Part-time preferred schedule panel
        const schedPanel = (() => {
          if (!isPartTimeFaculty) return '';
          const sched = Array.isArray(cred.preferred_schedule) && cred.preferred_schedule.length
            ? cred.preferred_schedule
            : Array.isArray(cred.preferred_days) && cred.preferred_days.length
              ? cred.preferred_days.map(d => ({ day: d, from: cred.preferred_time_from||'', to: cred.preferred_time_to||'' }))
              : [];
          if (!sched.length) return '';
          return `<div class="lda-pt-sched-panel" style="border-radius:12px;padding:16px 18px;border:1px solid var(--border);">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#92400e;margin-bottom:10px;"><i class="fas fa-clock" style="margin-right:6px;"></i>Preferred Schedule (Part-Time)</div>
            <div style="display:grid;grid-template-columns:auto auto auto auto;gap:6px 12px;align-items:center;">
              ${sched.map(r => `
                <span style="font-size:13px;font-weight:700;color:#92400e;">${escHtml(r.day||'')}</span>
                <span style="font-size:13px;">${r.from ? fmt24(r.from) : '–'}</span>
                <span style="font-size:13px;text-align:center;">→</span>
                <span style="font-size:13px;">${r.to ? fmt24(r.to) : ''}</span>
              `).join('')}
            </div>
          </div>`;
        })();

        // Portfolio links (full width, with URL wrapping so long links never overflow)
        const portfolioPanel = (() => {
          const port = cred.portfolio || {};
          const hasAny = _PORT_CATS.some(cat => (port[cat.key]||[]).some(e => e.title || e.url));
          if (!hasAny) return '';
          return panel('Portfolio Links (Last 3 Years)', 'fa-link', `
            ${_PORT_CATS.map(cat => {
              const items = (port[cat.key]||[]).filter(e => e.title || e.url);
              if (!items.length) return '';
              const fieldLabel = 'font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--text-light);min-width:46px;flex-shrink:0;';
              return `<div style="margin-bottom:12px;">
                <div style="font-size:12px;font-weight:700;color:#b91c1c;margin-bottom:6px;">${cat.label}</div>
                ${items.map(e => `<div style="border:1px solid var(--border,#e2e8f0);border-radius:8px;padding:10px 12px;margin-bottom:8px;background:var(--bg-card,#fff);">
                  <div style="display:flex;gap:10px;font-size:13px;line-height:1.5;${e.url?'margin-bottom:6px;':''}">
                    <span style="${fieldLabel}">Title</span>
                    <span style="font-weight:600;">${e.title ? escHtml(e.title) : '<span style="color:var(--text-light);font-weight:400;font-style:italic;">Untitled</span>'}</span>
                  </div>
                  ${e.url ? `<div style="display:flex;gap:10px;font-size:13px;line-height:1.5;">
                    <span style="${fieldLabel}">Link</span>
                    <a href="${escHtml(e.url)}" target="_blank" rel="noopener" style="color:var(--maroon);word-break:break-all;overflow-wrap:anywhere;">${escHtml(e.url)}</a>
                  </div>` : ''}
                </div>`).join('')}
              </div>`;
            }).join('')}
          `);
        })();

        return `<div class="card faculty-accordion-card" style="margin-bottom:18px;border:1px solid var(--border);border-radius:12px;overflow:hidden;padding:0;" id="prof-${f.id}">
          <div class="faculty-accordion-header" onclick="window._toggleFacultyAccordion('${f.id}')" style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;padding:18px 22px;cursor:pointer;background:var(--bg-card);transition:background .2s;">
            <div style="display:flex;align-items:center;gap:12px;">
              <div style="width:38px;height:38px;border-radius:50%;background:var(--primary-soft);color:var(--primary);display:grid;place-items:center;font-weight:700;font-size:14px;flex-shrink:0;">
                ${getInitials(`${f.first_name} ${f.last_name}`)}
              </div>
              <div>
                <div style="font-weight:800;font-size:17px;letter-spacing:-.2px;color:var(--text-primary);">${escHtml(f.last_name)}, ${escHtml(f.first_name)}
                  ${isPartTimeFaculty ? `<span style="background:#fef3c7;color:#92400e;font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px;margin-left:8px;vertical-align:middle;">Part-Time</span>` : `<span style="background:#dcfce7;color:#15803d;font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px;margin-left:8px;vertical-align:middle;">Full-Time</span>`}
                </div>
                ${(f.position||f.department) ? `<div style="font-size:12px;color:var(--text-light);margin-top:2px;">${escHtml(f.position||'')}${f.department?' · '+escHtml(f.department):''}</div>` : ''}
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:12px;">
              <span style="background:${s.bg};color:${s.color};font-size:12px;font-weight:700;padding:4px 12px;border-radius:99px;white-space:nowrap;">${s.label}</span>
              <span id="prof-chevron-${f.id}" style="font-size:13px;color:var(--text-light);transition:transform .2s;"><i class="fas fa-chevron-down"></i></span>
            </div>
          </div>

          <div id="prof-body-${f.id}" class="faculty-accordion-body" style="display:none;padding:20px 24px;border-top:1px solid var(--border);background:var(--bg-card);">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;">
              ${profilePanel}
              ${requestedPanel}
              ${schedPanel}
            </div>

            ${portfolioPanel ? `<div style="margin-top:14px;">${portfolioPanel}</div>` : ''}

            <div style="margin-top:20px;border-top:1px solid var(--border);padding-top:18px;">
              <div style="font-size:13px;font-weight:800;margin-bottom:12px;"><i class="fas fa-sliders-h" style="margin-right:6px;color:var(--maroon,#880808);"></i>Assign Programs</div>
              <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:18px;">
                ${['BSA','BSBAFM','BSEDEN','BSENT','BSHM','BSIT','BSPSY','DIT'].map(p => {
                  const isAssigned   = assigned.includes(p);
                  const isPreferred  = !isAssigned && (cred.preferred_programs || []).includes(p);
                  const border = isAssigned ? 'var(--maroon)' : isPreferred ? '#93c5fd' : 'var(--border)';
                  const bg     = isAssigned ? '#fff0f0'       : isPreferred ? '#eff6ff' : 'var(--bg-card,#fff)';
                  return `<label style="display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;cursor:pointer;padding:10px 12px;border-radius:8px;border:1px solid ${border};background:${bg};transition:border-color .15s;" title="${isPreferred?'Faculty requested this program':''}">
                    <input type="checkbox" class="prog-chk-${f.id}" value="${p}" ${isAssigned||isPreferred?'checked':''} style="width:16px;height:16px;cursor:pointer;accent-color:var(--maroon,#880808);"> ${p}${isPreferred?` <span style="font-size:10px;font-weight:700;color:#1d4ed8;">requested</span>`:''}
                  </label>`;
                }).join('')}
              </div>
              <div style="display:flex;gap:10px;flex-wrap:wrap;">
                ${(isPending || !isApproved) ? `<button class="btn btn-primary" onclick="window._approveProfile('${f.id}')"><i class="fas fa-check"></i> Approve & Assign</button>` : ''}
                ${isApproved ? `<button class="btn btn-secondary" onclick="window._updatePrograms('${f.id}')"><i class="fas fa-save"></i> Update Programs</button>` : ''}
                ${isPending ? `<button class="btn btn-secondary" onclick="window._rejectProfile('${f.id}')"><i class="fas fa-undo"></i> Return for Revision</button>` : ''}
              </div>
            </div>
          </div>
        </div>`;
      }).join('');
    } catch (err) {
      body.innerHTML = `<div class="empty-state"><p>${escHtml(err.message)}</p></div>`;
    }
  }

  function _getCheckedPrograms(facultyId) {
    return [...document.querySelectorAll(`.prog-chk-${facultyId}:checked`)].map(c => c.value);
  }

  window._approveProfile = async (id) => {
    const programs = _getCheckedPrograms(id);
    if (!programs.length) { showToast('Select at least one program to assign.', 'error'); return; }
    try {
      await api(`/api/loading/admin/profiles/${id}/approve`, { method:'POST', body:JSON.stringify({ programs }) });
      showToast('Profile approved and programs assigned.', 'success');
      renderAdminProfiles();
    } catch (err) { showToast(err.message, 'error'); }
  };

  window._updatePrograms = async (id) => {
    const programs = _getCheckedPrograms(id);
    try {
      await api(`/api/loading/admin/profiles/${id}/programs`, { method:'PUT', body:JSON.stringify({ programs }) });
      showToast('Programs updated.', 'success');
      renderAdminProfiles();
    } catch (err) { showToast(err.message, 'error'); }
  };

  window._rejectProfile = async (id) => {
    const remarks = await showSystemPrompt('What does the faculty need to fix or add?');
    if (remarks === null) return;
    if (!remarks.trim()) { showToast('Please provide remarks.', 'error'); return; }
    try {
      await api(`/api/loading/admin/profiles/${id}/reject`, { method:'POST', body:JSON.stringify({ remarks }) });
      showToast('Returned for revision.', 'success');
      renderAdminProfiles();
    } catch (err) { showToast(err.message, 'error'); }
  };

  window._unapproveProfile = (id) => {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.style.zIndex = '99999';
      overlay.innerHTML = `
        <div class="modal modal-sm" style="max-width:440px;transform:scale(0.95);transition:transform 0.2s ease-out;">
          <div class="modal-header" style="border-bottom:1px solid var(--border);padding:14px 18px;">
            <h3 class="modal-title" style="font-size:16px;font-weight:700;color:var(--text-primary);display:flex;align-items:center;gap:8px;margin:0;">
              <i class="fas fa-ban" style="color:#b91c1c;"></i> Unapprove Faculty
            </h3>
          </div>
          <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px;">
            <div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;padding:10px 14px;font-size:13px;color:#b91c1c;line-height:1.5;">
              <i class="fas fa-exclamation-triangle" style="margin-right:6px;"></i>
              This will remove the faculty's assigned programs. They will need to re-submit their specialization for admin review before they can request subjects again.
            </div>
            <div>
              <label style="font-size:12px;font-weight:700;color:var(--text-secondary);display:block;margin-bottom:6px;">
                Reason for unapproving <span style="color:var(--text-light);font-weight:400;">(shown to the faculty)</span>
              </label>
              <textarea id="unapproveRemarks" class="form-input" rows="3"
                placeholder="e.g. Credentials need to be updated, specialization does not match assigned programs…"
                style="width:100%;resize:vertical;font-size:13px;box-sizing:border-box;"></textarea>
            </div>
          </div>
          <div class="modal-footer" style="border-top:1px solid var(--border);padding:12px 18px;display:flex;justify-content:flex-end;gap:10px;">
            <button class="btn btn-secondary btn-sm" id="unapproveCancel">Cancel</button>
            <button class="btn btn-sm" id="unapproveConfirm"
              style="background:#b91c1c;color:#fff;border:none;">
              <i class="fas fa-ban"></i> Unapprove
            </button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      setTimeout(() => { const d = overlay.querySelector('.modal'); if (d) d.style.transform = 'scale(1)'; }, 10);

      const close = () => {
        const d = overlay.querySelector('.modal');
        if (d) d.style.transform = 'scale(0.95)';
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.15s ease-out';
        setTimeout(() => { overlay.remove(); resolve(); }, 150);
      };

      overlay.querySelector('#unapproveCancel').onclick = close;
      overlay.onclick = (e) => { if (e.target === overlay) close(); };
      overlay.querySelector('#unapproveConfirm').onclick = async () => {
        const remarks = overlay.querySelector('#unapproveRemarks').value.trim();
        close();
        try {
          await api(`/api/loading/admin/profiles/${id}/unapprove`, { method:'POST', body:JSON.stringify({ remarks }) });
          showToast('Faculty profile unapproved and programs cleared.', 'success');
          renderAdminProfiles();
        } catch (err) { showToast(err.message, 'error'); }
      };
    });
  };

  async function renderAdminTimetable() {
    const body = document.getElementById('ldaBody');
    body.innerHTML = `<div class="loader"><div class="spinner"></div></div>`;
    try {
      const entries = await api(`/api/loading/schedule?term=${state._ldAdminTerm}&academic_year=${encodeURIComponent(state._ldAdminYear||'')}`);
      body.innerHTML = `<p style="font-size:13px;color:var(--text-light);margin:0 0 16px;">
        Approved loads for <strong>${TERM_LABELS[state._ldAdminTerm] || state._ldAdminTerm}</strong> — separated by program/department.
      </p>${buildAllDeptGrids(entries, true)}`;
      _bindDetailsChevrons(body);
    } catch (err) {
      body.innerHTML = `<div class="empty-state"><p>${escHtml(err.message)}</p></div>`;
    }
  }

  // Rotate chevron icon when a <details> opens/closes
  function _bindDetailsChevrons(root) {
    (root || document).querySelectorAll('details').forEach(det => {
      const chevron = det.querySelector('summary .fa-chevron-right');
      if (!chevron) return;
      const update = () => chevron.style.transform = det.open ? 'rotate(90deg)' : '';
      update();
      det.addEventListener('toggle', update);
    });
  }

  async function renderAdminOfferings() {
    const body = document.getElementById('ldaBody');
    body.innerHTML = `
      <div class="card" style="padding:18px; margin-bottom:18px;">
        <h3 style="margin:0 0 10px; font-size:15px;">Add Offering</h3>
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#1e40af;display:flex;gap:10px;align-items:flex-start;">
          <i class="fas fa-info-circle" style="margin-top:1px;flex-shrink:0;"></i>
          <span><strong>Conflict rules:</strong>
            Same room + same day + overlapping time = blocked.
            Same section + same day + overlapping time = blocked.
            <strong>Parallel sections of the same subject are allowed — each needs a unique room.</strong>
          </span>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Type</label>
            <select class="form-input form-select" id="ofType">${LOADING_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}</select></div>
          <div class="form-group"><label>Program</label>
            <select class="form-input form-select" id="ofProgram"><option value="">-- select program --</option>${LOADING_PROGRAMS.map(p => `<option value="${p}">${p}</option>`).join('')}</select></div>
          <div class="form-group"><label>Subject</label>
            <select class="form-input form-select" id="ofCourse"><option value="">-- pick type/program --</option></select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Section</label><input class="form-input" id="ofSection" placeholder="e.g. BSIT 1-1"></div>
          <div class="form-group"><label>Day</label>
            <select class="form-input form-select" id="ofDay">${LOADING_DAYS.map(d => `<option value="${d}">${d}</option>`).join('')}</select></div>
          <div class="form-group"><label>Start</label>${buildTimeSelect('ofStart','')}</div>
          <div class="form-group"><label>End</label>${buildTimeSelect('ofEnd','')}</div>
          <div class="form-group"><label>Room</label><input class="form-input" id="ofRoom" placeholder="e.g. 201"></div>
        </div>

        <!-- Live conflict status banner -->
        <div id="ofConflictStatus" style="display:none;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:13px;display:flex;gap:10px;align-items:flex-start;"></div>

        <button class="btn btn-primary" id="ofAdd" disabled style="opacity:.5;cursor:not-allowed;">
          <i class="fas fa-plus"></i> Add Offering
        </button>
        <span id="ofAddHint" style="font-size:11px;color:var(--text-light);margin-left:10px;">Fill in day, start &amp; end time to enable.</span>
      </div>
      <div id="ldaOffList"><div class="loader"><div class="spinner"></div></div></div>`;

    // ── Course cascade ────────────────────────────────────────────────────────
    const typeSel = document.getElementById('ofType'), progSel = document.getElementById('ofProgram'),
          courseSel = document.getElementById('ofCourse');
    async function reloadCourses() {
      if (!progSel.value) {
        courseSel.innerHTML = `<option value="">-- select program first --</option>`;
        courseSel.disabled = true;
        return;
      }
      courseSel.disabled = false;
      const q = new URLSearchParams({ type: typeSel.value, program: progSel.value });
      try {
        const courses = await api(`/api/loading/admin/courses?${q.toString()}`);
        courseSel.innerHTML = `<option value="">-- Select subject --</option>` +
          courses.map(c => `<option value="${c.id}" data-name="${escHtml(c.subject_name)}" data-code="${escHtml(c.subject_code || '')}" data-program="${escHtml(c.program || '')}">${escHtml(c.subject_name)}</option>`).join('');
      } catch (err) { showToast(err.message, 'error'); }
    }
    typeSel.onchange = reloadCourses;
    progSel.onchange = reloadCourses;
    reloadCourses();

    // ── Live conflict check ───────────────────────────────────────────────────
    const statusDiv = document.getElementById('ofConflictStatus');
    const addBtn    = document.getElementById('ofAdd');
    const addHint   = document.getElementById('ofAddHint');
    let _checkTimer = null;
    let _conflictClear = false;

    function setConflictStatus(state, msg) {
      // state: 'checking' | 'clear' | 'conflict' | 'idle'
      statusDiv.style.display = 'flex';
      if (state === 'idle') { statusDiv.style.display = 'none'; return; }
      const styles = {
        checking: { bg:'#f8fafc', border:'#e2e8f0', color:'#64748b', icon:'fa-spinner fa-spin' },
        clear:    { bg:'#f0fdf4', border:'#86efac', color:'#15803d', icon:'fa-check-circle'    },
        conflict: { bg:'#fee2e2', border:'#fca5a5', color:'#b91c1c', icon:'fa-times-circle'    },
      };
      const s = styles[state] || styles.checking;
      statusDiv.style.cssText = `display:flex;gap:10px;align-items:flex-start;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:13px;background:${s.bg};border:1px solid ${s.border};color:${s.color};`;
      statusDiv.innerHTML = `<i class="fas ${s.icon}" style="margin-top:2px;flex-shrink:0;font-size:15px;"></i><span>${escHtml(msg)}</span>`;
      _conflictClear = (state === 'clear');
      const ready = _conflictClear && !!courseSel.value;
      addBtn.disabled = !ready;
      addBtn.style.opacity = ready ? '1' : '.5';
      addBtn.style.cursor  = ready ? 'pointer' : 'not-allowed';
      addHint.style.display = ready ? 'none' : 'inline';
    }

    async function runConflictCheck() {
      const day   = document.getElementById('ofDay').value;
      const start = document.getElementById('ofStart').value;
      const end   = document.getElementById('ofEnd').value;
      const room  = document.getElementById('ofRoom').value.trim();
      const sec   = document.getElementById('ofSection').value.trim();

      if (!start || !end) { setConflictStatus('idle', ''); return; }
      if (start >= end)   { setConflictStatus('conflict', 'Start time must be before end time.'); return; }

      setConflictStatus('checking', 'Checking for conflicts…');
      try {
        const result = await api('/api/loading/admin/offerings/check-conflict', {
          method: 'POST',
          body: JSON.stringify({
            term: state._ldAdminTerm,
            academic_year: state._ldAdminYear || null,
            day_of_week: day,
            start_time: start,
            end_time: end,
            room: room || null,
            section: sec || null,
            course_id: courseSel.value || null,
          }),
        });
        if (result.clear === true)  setConflictStatus('clear',    result.message);
        else if (result.clear === false) setConflictStatus('conflict', result.message);
        else setConflictStatus('idle', '');
      } catch (err) {
        setConflictStatus('conflict', err.message);
      }
    }

    function scheduleCheck() {
      clearTimeout(_checkTimer);
      _checkTimer = setTimeout(runConflictCheck, 600);
    }

    // Watch all schedule-related fields + course selection
    ['ofDay','ofStart','ofEnd','ofRoom','ofSection'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', scheduleCheck);
      if (el && el.type !== 'select-one') el.addEventListener('input', scheduleCheck);
    });
    // Re-run full conflict check (including duplicate subject+section) when course changes
    courseSel.addEventListener('change', () => {
      scheduleCheck();
    });

    // ── Submit ────────────────────────────────────────────────────────────────
    addBtn.onclick = async () => {
      const opt = courseSel.selectedOptions[0];
      if (!courseSel.value) { showToast('Select a subject', 'error'); return; }
      const payload = {
        term: state._ldAdminTerm,
        academic_year: state._ldAdminYear || null,
        course_id: courseSel.value,
        subject_name: opt.dataset.name,
        subject_code: opt.dataset.code || null,
        program: progSel.value || opt.dataset.program || null,
        section: document.getElementById('ofSection').value.trim() || null,
        day_of_week: document.getElementById('ofDay').value,
        start_time: document.getElementById('ofStart').value,
        end_time: document.getElementById('ofEnd').value,
        room: document.getElementById('ofRoom').value.trim() || null,
      };
      addBtn.disabled = true;
      try {
        await api('/api/loading/admin/offerings', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Offering added.', 'success');
        // Reset all form fields
        document.getElementById('ofSection').value = '';
        document.getElementById('ofRoom').value    = '';
        // Reset dropdowns and trigger change so custom UI syncs
        ['ofType','ofProgram','ofDay','ofStart','ofEnd'].forEach(id => {
          const el = document.getElementById(id);
          if (!el) return;
          el.selectedIndex = 0;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        setConflictStatus('idle', '');
        loadAdminOfferingList();
      } catch (err) {
        // Server-side double-check failed (race condition) — show the reason
        setConflictStatus('conflict', err.message);
      }
    };

    loadAdminOfferingList();
  }

  async function loadAdminOfferingList() {
    const wrap = document.getElementById('ldaOffList');
    if (!wrap) return;
    try {
      const rows = await api(`/api/loading/admin/offerings?term=${state._ldAdminTerm}&academic_year=${encodeURIComponent(state._ldAdminYear||'')}`);
      state._adminOfferingsMap = new Map(rows.map(o => [String(o.id), o]));
      if (!rows.length) { wrap.innerHTML = `<div class="empty-state"><i class="fas fa-list"></i><h3>No offerings yet</h3><p>Add offerings above so faculty can request them.</p></div>`; return; }

      // Group by program
      const byProgram = {};
      rows.forEach(o => {
        const prog = o.program || 'General';
        if (!byProgram[prog]) byProgram[prog] = [];
        byProgram[prog].push(o);
      });

      wrap.innerHTML = Object.keys(byProgram).sort().map(prog => {
        const offerings = byProgram[prog];
        const assignedCount = offerings.filter(o => !!o.approved_faculty).length;
        const pendingCount  = offerings.filter(o => !o.approved_faculty && o.pending_count > 0).length;

        const offRows = offerings.map(o => {
          const taken = !!o.approved_faculty;
          return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);">
            <div style="min-width:0;">
              <div style="font-weight:700;font-size:14px;">${escHtml(o.subject_name)}</div>
              <div style="font-size:12px;color:var(--text-light);margin-top:1px;">
                ${o.day_of_week} ${formatTime(o.start_time)}–${formatTime(o.end_time)}${o.room ? ' · Room ' + escHtml(o.room) : ''}${o.section ? ' · ' + escHtml(o.section) : ''}
              </div>
              <div style="font-size:12px;margin-top:4px;">
                ${taken
                  ? `<span style="color:#15803d;"><i class="fas fa-check-circle"></i> Assigned: ${escHtml(o.approved_faculty)}</span>`
                  : o.pending_count > 0
                    ? `<span style="color:#b45309;"><i class="fas fa-hourglass-half"></i> ${o.pending_count} pending request${o.pending_count > 1 ? 's' : ''}</span>`
                    : `<span style="color:var(--text-light);"><i class="fas fa-circle" style="font-size:7px;vertical-align:middle;"></i> No requests yet</span>`}
              </div>
            </div>
            <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">
              <button class="btn btn-sm btn-secondary" onclick="window._editOffering('${o.id}')" title="Edit offering" style="padding:5px 9px;border-radius:6px;"><i class="fas fa-edit"></i></button>
              <button class="btn btn-sm btn-secondary" onclick="window._delOffering('${o.id}')" title="Delete offering" style="padding:5px 9px;border-radius:6px;"><i class="fas fa-trash"></i></button>
            </div>
          </div>`;
        }).join('');

        return `<div style="margin-bottom:20px;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
            <div style="background:var(--maroon,#880808);color:#fff;font-size:11px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;padding:4px 12px;border-radius:6px;">${escHtml(prog)}</div>
            <span style="font-size:12px;color:var(--text-light);">${offerings.length} offering${offerings.length !== 1 ? 's' : ''}${assignedCount ? ` · ${assignedCount} assigned` : ''}${pendingCount ? ` · ${pendingCount} with requests` : ''}</span>
          </div>
          <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--bg-card,#fff);">
            ${offRows}
          </div>
        </div>`;
      }).join('');

    } catch (err) { wrap.innerHTML = `<div class="empty-state"><p>${escHtml(err.message)}</p></div>`; }
  }

  window._editOffering = async (id) => {
    const o = state._adminOfferingsMap?.get(String(id));
    if (!o) return;

    const existingModal = document.getElementById('editOfferingModalOverlay');
    if (existingModal) existingModal.remove();

    const overlay = document.createElement('div');
    overlay.id = 'editOfferingModalOverlay';
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'display:flex;align-items:center;justify-content:center;position:fixed;inset:0;background:rgba(0,0,0,0.55);backdrop-filter:blur(3px);z-index:9999;padding:16px;';

    overlay.innerHTML = `
      <div class="modal card" style="max-width:620px;width:100%;max-height:90vh;overflow-y:auto;padding:24px;border-radius:12px;background:var(--bg-card,#fff);box-shadow:var(--shadow-lg);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid var(--border);padding-bottom:12px;">
          <h3 style="margin:0;font-size:16px;font-weight:800;color:var(--text-primary);display:flex;align-items:center;gap:8px;">
            <i class="fas fa-edit" style="color:var(--primary,#880808);"></i> Edit Offering
          </h3>
          <button class="btn-icon" id="editOfCloseBtn" style="cursor:pointer;border:none;background:transparent;font-size:16px;color:var(--text-secondary);width:32px;height:32px;border-radius:6px;display:flex;align-items:center;justify-content:center;" title="Close"><i class="fas fa-times"></i></button>
        </div>

        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#1e40af;display:flex;gap:10px;align-items:flex-start;">
          <i class="fas fa-info-circle" style="margin-top:2px;flex-shrink:0;"></i>
          <span>Modify offering details. Conflict checks will run in real time.</span>
        </div>

        <div class="form-row">
          <div class="form-group"><label>Type</label>
            <select class="form-input form-select" id="ofEditType">
              ${LOADING_TYPES.map(t => `<option value="${t}"${(o.subject_type || 'MAJOR') === t ? ' selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>Program</label>
            <select class="form-input form-select" id="ofEditProgram">
              <option value="">-- select program --</option>
              ${LOADING_PROGRAMS.map(p => `<option value="${p}"${(o.program || '') === p ? ' selected' : ''}>${p}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>Subject</label>
            <select class="form-input form-select" id="ofEditCourse">
              <option value="${o.course_id || ''}" data-name="${escHtml(o.subject_name)}" data-code="${escHtml(o.subject_code || '')}" data-program="${escHtml(o.program || '')}" selected>${escHtml(o.subject_name)}</option>
            </select>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group"><label>Section</label>
            <input class="form-input" id="ofEditSection" placeholder="e.g. BSIT 1-1" value="${escHtml(o.section || '')}">
          </div>
          <div class="form-group"><label>Day</label>
            <select class="form-input form-select" id="ofEditDay">
              ${LOADING_DAYS.map(d => `<option value="${d}"${o.day_of_week === d ? ' selected' : ''}>${d}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>Start</label>
            ${buildTimeSelect('ofEditStart', (o.start_time || '').slice(0, 5))}
          </div>
          <div class="form-group"><label>End</label>
            ${buildTimeSelect('ofEditEnd', (o.end_time || '').slice(0, 5))}
          </div>
          <div class="form-group"><label>Room</label>
            <input class="form-input" id="ofEditRoom" placeholder="e.g. 201" value="${escHtml(o.room || '')}">
          </div>
        </div>

        <!-- Live conflict status banner for edit -->
        <div id="ofEditConflictStatus" style="display:none;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:13px;display:flex;gap:10px;align-items:flex-start;"></div>

        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px;border-top:1px solid var(--border);padding-top:14px;">
          <button class="btn btn-secondary" id="ofEditCancel">Cancel</button>
          <button class="btn btn-primary" id="ofEditSave"><i class="fas fa-save"></i> Save Changes</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#editOfCloseBtn').onclick = close;
    overlay.querySelector('#ofEditCancel').onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };

    // Course cascading
    const typeSel = overlay.querySelector('#ofEditType');
    const progSel = overlay.querySelector('#ofEditProgram');
    const courseSel = overlay.querySelector('#ofEditCourse');
    const statusDiv = overlay.querySelector('#ofEditConflictStatus');
    const saveBtn = overlay.querySelector('#ofEditSave');

    async function reloadCourses(preserveSelected) {
      if (!progSel.value) {
        courseSel.innerHTML = `<option value="">-- select program first --</option>`;
        courseSel.disabled = true;
        return;
      }
      courseSel.disabled = false;
      const q = new URLSearchParams({ type: typeSel.value, program: progSel.value });
      try {
        const courses = await api(`/api/loading/admin/courses?${q.toString()}`);
        courseSel.innerHTML = `<option value="">-- Select subject --</option>` +
          courses.map(c => {
            const sel = (preserveSelected && (c.id === o.course_id || c.subject_name === o.subject_name)) ? ' selected' : '';
            return `<option value="${c.id}" data-name="${escHtml(c.subject_name)}" data-code="${escHtml(c.subject_code || '')}" data-program="${escHtml(c.program || '')}"${sel}>${escHtml(c.subject_name)}</option>`;
          }).join('');
      } catch (err) { showToast(err.message, 'error'); }
    }

    typeSel.onchange = () => { reloadCourses(false); scheduleCheck(); };
    progSel.onchange = () => { reloadCourses(false); scheduleCheck(); };
    reloadCourses(true);

    // Live conflict check
    let _editTimer = null;
    function setEditConflictStatus(state, msg) {
      statusDiv.style.display = 'flex';
      if (state === 'idle') { statusDiv.style.display = 'none'; return; }
      const styles = {
        checking: { bg:'#f8fafc', border:'#e2e8f0', color:'#64748b', icon:'fa-spinner fa-spin' },
        clear:    { bg:'#f0fdf4', border:'#86efac', color:'#15803d', icon:'fa-check-circle'    },
        conflict: { bg:'#fee2e2', border:'#fca5a5', color:'#b91c1c', icon:'fa-times-circle'    },
      };
      const s = styles[state] || styles.checking;
      statusDiv.style.cssText = `display:flex;gap:10px;align-items:flex-start;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:13px;background:${s.bg};border:1px solid ${s.border};color:${s.color};`;
      statusDiv.innerHTML = `<i class="fas ${s.icon}" style="margin-top:2px;flex-shrink:0;font-size:15px;"></i><span>${escHtml(msg)}</span>`;
      const isClear = (state === 'clear');
      saveBtn.disabled = !isClear;
      saveBtn.style.opacity = isClear ? '1' : '.5';
      saveBtn.style.cursor  = isClear ? 'pointer' : 'not-allowed';
    }

    async function runEditConflictCheck() {
      const day   = overlay.querySelector('#ofEditDay').value;
      const start = overlay.querySelector('#ofEditStart').value;
      const end   = overlay.querySelector('#ofEditEnd').value;
      const room  = overlay.querySelector('#ofEditRoom').value.trim();
      const sec   = overlay.querySelector('#ofEditSection').value.trim();

      if (!start || !end) { setEditConflictStatus('idle', ''); return; }
      if (start >= end)   { setEditConflictStatus('conflict', 'Start time must be before end time.'); return; }

      setEditConflictStatus('checking', 'Checking for conflicts…');
      try {
        const result = await api('/api/loading/admin/offerings/check-conflict', {
          method: 'POST',
          body: JSON.stringify({
            term: o.term || state._ldAdminTerm,
            academic_year: o.academic_year || state._ldAdminYear || null,
            day_of_week: day,
            start_time: start,
            end_time: end,
            room: room || null,
            section: sec || null,
            course_id: courseSel.value || o.course_id || null,
            exclude_id: o.id,
          }),
        });
        if (result.clear === true)  setEditConflictStatus('clear', result.message);
        else if (result.clear === false) setEditConflictStatus('conflict', result.message);
        else setEditConflictStatus('idle', '');
      } catch (err) {
        setEditConflictStatus('conflict', err.message);
      }
    }

    function scheduleCheck() {
      clearTimeout(_editTimer);
      _editTimer = setTimeout(runEditConflictCheck, 500);
    }

    ['ofEditDay','ofEditStart','ofEditEnd','ofEditRoom','ofEditSection'].forEach(id => {
      const el = overlay.querySelector('#' + id);
      if (el) el.addEventListener('change', scheduleCheck);
      if (el && el.type !== 'select-one') el.addEventListener('input', scheduleCheck);
    });
    courseSel.addEventListener('change', scheduleCheck);

    // Initial conflict check
    runEditConflictCheck();

    // Submit edit
    saveBtn.onclick = async () => {
      const opt = courseSel.selectedOptions[0];
      const selectedCourseId = courseSel.value || o.course_id || null;
      const subName = opt?.dataset?.name || opt?.text || o.subject_name;
      const subCode = opt?.dataset?.code || o.subject_code || null;
      const prog = progSel.value || opt?.dataset?.program || o.program || null;
      const sec = overlay.querySelector('#ofEditSection').value.trim() || null;
      const day = overlay.querySelector('#ofEditDay').value;
      const start = overlay.querySelector('#ofEditStart').value;
      const end = overlay.querySelector('#ofEditEnd').value;
      const room = overlay.querySelector('#ofEditRoom').value.trim() || null;

      if (!start || !end) { showToast('Start and end time are required', 'error'); return; }
      if (start >= end) { showToast('Start time must be before end time', 'error'); return; }

      const payload = {
        term: o.term || state._ldAdminTerm,
        academic_year: o.academic_year || state._ldAdminYear || null,
        course_id: selectedCourseId,
        subject_name: subName,
        subject_code: subCode,
        program: prog,
        section: sec,
        day_of_week: day,
        start_time: start,
        end_time: end,
        room: room,
      };

      saveBtn.disabled = true;
      try {
        await api(`/api/loading/admin/offerings/${o.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        showToast('Offering updated successfully.', 'success');
        close();
        loadAdminOfferingList();
      } catch (err) {
        saveBtn.disabled = false;
        setEditConflictStatus('conflict', err.message);
        showToast(err.message, 'error');
      }
    };
  };

  window._delOffering = async (id) => {
    if (!await showSystemConfirm('Delete this offering? Related requests will also be removed.')) return;
    try {
      await api(`/api/loading/admin/offerings/${id}`, { method: 'DELETE' });
      showToast('Offering deleted.', 'success');
      loadAdminOfferingList();
    } catch (err) { showToast(err.message, 'error'); }
  };

  async function renderAdminRequests() {
    const body = document.getElementById('ldaBody');
    body.innerHTML = `<div class="loader"><div class="spinner"></div></div>`;
    try {
      const rows = await api(`/api/loading/admin/requests?term=${state._ldAdminTerm}&academic_year=${encodeURIComponent(state._ldAdminYear||'')}`);
      if (!rows.length) { body.innerHTML = `<div class="empty-state"><i class="fas fa-inbox"></i><h3>No requests</h3><p>No loading requests for this term yet.</p></div>`; return; }

      // Group: program → offering_id → [requests]
      const byProgram = {};
      rows.forEach(r => {
        const prog = r.program || 'General';
        if (!byProgram[prog]) byProgram[prog] = {};
        if (!byProgram[prog][r.offering_id]) byProgram[prog][r.offering_id] = [];
        byProgram[prog][r.offering_id].push(r);
      });

      const DAYS_LIST = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

      body.innerHTML = Object.keys(byProgram).sort().map(prog => {
        const offeringsMap = byProgram[prog];
        const totalReqs = Object.values(offeringsMap).reduce((n, arr) => n + arr.length, 0);

        const offeringsHtml = Object.values(offeringsMap).map(reqs => {
          const o = reqs[0];
          const hasApproved = reqs.some(r => r.status === 'approved');
          const pendingCount = reqs.filter(r => r.status === 'pending').length;

          const facultyRows = reqs.map(r => {
            const s = LOADING_STATUS[r.status] || LOADING_STATUS.pending;
            const isApproved = r.status === 'approved';
            return `<div style="border-top:1px solid var(--border); padding:12px 0;">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
                <div style="min-width:0; overflow:hidden;">
                  <div style="font-weight:600; font-size:14px; word-break:break-word; overflow-wrap:anywhere;">${escHtml(r.faculty_name)}
                    <span style="background:${s.bg};color:${s.color};font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;margin-left:6px;">${s.label}</span>
                  </div>
                  <div style="font-size:12px; color:var(--text-light); margin-top:1px;">${escHtml(r.faculty_position || '')}${r.faculty_department ? ' · ' + escHtml(r.faculty_department) : ''}</div>
                  ${r.remarks ? `<div style="font-size:12px; margin-top:4px; color:var(--text-secondary); word-break:break-word; overflow-wrap:anywhere; white-space:pre-wrap;"><i class="fas fa-comment" style="margin-right:4px;"></i>${escHtml(r.remarks)}</div>` : ''}
                  ${renderCredentialsSummary(r.faculty_credentials)}
                </div>
                <div style="display:flex; gap:6px; flex-wrap:wrap; flex-shrink:0;">
                  ${(r.status === 'pending' || r.status === 'returned') ? `
                    <button class="btn btn-sm btn-primary" onclick="window._reviewLoading('${r.id}','approve')" title="Assign this subject to ${escHtml(r.faculty_name)}. Other pending requests will be auto-denied.">
                      <i class="fas fa-user-check"></i> Assign to ${escHtml(r.faculty_name.split(' ')[0])}
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="window._reviewLoading('${r.id}','return')">Return</button>
                    <button class="btn btn-sm btn-secondary" onclick="window._reviewLoading('${r.id}','reject')">Reject</button>` : ''}
                  ${isApproved ? `
                    <button class="btn btn-sm" style="background:#fff7ed;color:#c2410c;border:1px solid #fed7aa;font-size:12px;"
                      onclick="window._toggleReschedule('${r.id}')">
                      <i class="fas fa-pen"></i> Edit Schedule
                    </button>` : ''}
                </div>
              </div>
              ${isApproved ? `
              <div id="rsp-${r.id}" data-offering-id="${o.offering_id}" class="sched-edit-panel" style="display:none; margin-top:12px; border-radius:10px; padding:14px 16px; border:1px solid var(--border);">
                <div style="font-size:13px; font-weight:700; color:#c2410c; margin-bottom:10px;">
                  <i class="fas fa-calendar-edit" style="margin-right:6px;"></i>Edit Schedule for ${escHtml(r.faculty_name)}
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:10px; margin-bottom:10px;">
                  <div>
                    <label style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-secondary);display:block;margin-bottom:4px;">Day</label>
                    <select class="form-input form-select" id="rsp-day-${r.id}" style="font-size:13px;">
                      ${DAYS_LIST.map(d => `<option value="${d}" ${d === o.day_of_week ? 'selected' : ''}>${d}</option>`).join('')}
                    </select>
                  </div>
                  <div>
                    <label style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-secondary);display:block;margin-bottom:4px;">Start</label>
                    ${buildTimeSelect(`rsp-start-${r.id}`, o.start_time.slice(0,5), 'font-size:13px;')}
                  </div>
                  <div>
                    <label style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-secondary);display:block;margin-bottom:4px;">End</label>
                    ${buildTimeSelect(`rsp-end-${r.id}`, o.end_time.slice(0,5), 'font-size:13px;')}
                  </div>
                  <div>
                    <label style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-secondary);display:block;margin-bottom:4px;">Room</label>
                    <input type="text" class="form-input" id="rsp-room-${r.id}" value="${escHtml(o.room || '')}" placeholder="e.g. 201" style="font-size:13px;">
                  </div>
                </div>
                <div id="rsp-status-${r.id}" style="display:none; border-radius:7px; padding:8px 12px; font-size:12px; margin-bottom:10px;"></div>
                <div style="display:flex; gap:8px; align-items:center;">
                  <button class="btn btn-primary btn-sm" id="rsp-save-${r.id}" onclick="window._saveReschedule('${r.id}')">
                    <i class="fas fa-save"></i> Save Changes
                  </button>
                  <button class="btn btn-secondary btn-sm" onclick="window._toggleReschedule('${r.id}')">Cancel</button>
                  <span style="font-size:11px;color:var(--text-light);margin-left:4px;"><i class="fas fa-info-circle"></i> Faculty will be notified of the change.</span>
                </div>
              </div>` : ''}
            </div>`;
          }).join('');

          const statusBadge = hasApproved
            ? `<span style="background:#dcfce7;color:#15803d;font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px;">Assigned</span>`
            : pendingCount > 0
              ? `<span style="background:#fef9c3;color:#b45309;font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px;">${pendingCount} pending</span>`
              : '';

          return `<div style="border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:10px;background:var(--bg-card,#fff);">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:2px;">
              <div style="font-weight:700;font-size:14px;">${escHtml(o.subject_name)}</div>
              ${statusBadge}
            </div>
            <div style="font-size:12px; color:var(--text-light); margin-bottom:8px;">
              ${o.day_of_week} ${formatTime(o.start_time)}–${formatTime(o.end_time)}${o.room ? ' · Room ' + escHtml(o.room) : ''}${o.section ? ' · ' + escHtml(o.section) : ''}
            </div>
            ${facultyRows}
          </div>`;
        }).join('');

        return `<div style="margin-bottom:24px;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
            <div style="background:var(--maroon,#880808);color:#fff;font-size:11px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;padding:4px 12px;border-radius:6px;">${escHtml(prog)}</div>
            <span style="font-size:12px;color:var(--text-light);">${totalReqs} request${totalReqs !== 1 ? 's' : ''}</span>
          </div>
          ${offeringsHtml}
        </div>`;
      }).join('');

    } catch (err) { body.innerHTML = `<div class="empty-state"><p>${escHtml(err.message)}</p></div>`; }
  }

  function renderCredentialsSummary(c) {
    if (!c || typeof c !== 'object') return '';
    const line = (label, val) => {
      const items = Array.isArray(val) ? val.filter(Boolean) : (val ? [val] : []);
      return items.length ? `<div style="font-size:11px;"><strong>${label}:</strong> ${items.map(escHtml).join('; ')}</div>` : '';
    };
    const parts = [
      line('Title', c.academic_title),
      line('Specialization', c.specializations),
      line('Education', c.education),
      line('Research', c.research),
      line('Trainings', c.trainings),
      line('Extension', c.extension),
      line('Awards', c.awards),
    ].filter(Boolean);
    if (!parts.length) return '';
    return `<details style="margin-top:6px;"><summary style="font-size:11px; color:var(--maroon); cursor:pointer;">View credentials</summary>
      <div style="margin-top:4px; padding:8px; background:var(--bg-soft,#f8fafc); border-radius:6px; display:flex; flex-direction:column; gap:3px;">${parts.join('')}</div></details>`;
  }

  // ── Conflict modal ─────────────────────────────────────────────────────────
  function showConflictModal(data) {
    document.getElementById('schedConflictModal')?.remove();
    const fmt = t => {
      if (!t) return '–';
      const [h, m] = t.split(':');
      const n = parseInt(h, 10);
      return `${String(n).padStart(2, '0')}:${m}`;
    };
    const c   = data.conflict        || {};
    const rec = data.recommendations || {};

    const typeMeta = {
      faculty: { icon: 'fa-user-clock',      color: '#1d4ed8', bg: '#dbeafe', border: '#93c5fd', label: 'Faculty Double-Booking' },
      room:    { icon: 'fa-door-open',        color: '#b91c1c', bg: '#fee2e2', border: '#fca5a5', label: 'Room Already Occupied'   },
      section: { icon: 'fa-users',            color: '#b45309', bg: '#fef3c7', border: '#fde68a', label: 'Section Conflict'        },
    };
    const tm = typeMeta[c.type] || typeMeta.room;

    const pill = (txt, bg, color, border) =>
      `<span style="background:${bg};color:${color};border:1px solid ${border};padding:3px 12px;border-radius:99px;font-size:12px;font-weight:700;white-space:nowrap;">${escHtml(txt)}</span>`;

    const roomPills = rec.available_rooms?.length
      ? rec.available_rooms.map(r => pill(r, '#dcfce7', '#15803d', '#86efac')).join('')
      : `<span style="font-size:12px;color:var(--text-light);font-style:italic;">No free rooms found at this time.</span>`;

    const timePills = rec.available_times?.length
      ? rec.available_times.map(t => pill(`${fmt(t.from)} – ${fmt(t.to)}`, '#dbeafe', '#1d4ed8', '#93c5fd')).join('')
      : `<span style="font-size:12px;color:var(--text-light);font-style:italic;">No free windows found for this room on this day.</span>`;

    const overlay = document.createElement('div');
    overlay.id = 'schedConflictModal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `
      <div style="background:var(--bg-card,#fff);border-radius:16px;max-width:540px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,.35);overflow:hidden;animation:fadeInUp .2s ease;">
        <!-- Header -->
        <div style="background:linear-gradient(135deg,#7f1d1d,#b91c1c);padding:20px 24px;display:flex;align-items:center;gap:14px;">
          <div style="background:rgba(255,255,255,.15);border-radius:50%;width:44px;height:44px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <i class="fas fa-exclamation-triangle" style="color:#fbbf24;font-size:20px;"></i>
          </div>
          <div>
            <div style="color:#fff;font-weight:800;font-size:17px;">Schedule Conflict Detected</div>
            <div style="color:#fca5a5;font-size:12px;margin-top:2px;">This request cannot be approved without resolving the conflict below.</div>
          </div>
        </div>

        <!-- Conflict card -->
        <div style="padding:20px 24px 0;">
          <div style="background:${tm.bg};border:1px solid ${tm.border};border-radius:10px;padding:14px 16px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
              <i class="fas ${tm.icon}" style="color:${tm.color};font-size:15px;"></i>
              <span style="font-size:12px;font-weight:800;text-transform:uppercase;color:${tm.color};">${tm.label}</span>
            </div>
            ${c.blocking_subject
              ? `<div style="font-size:15px;font-weight:700;color:#1e293b;margin-bottom:4px;">${escHtml(c.blocking_subject)}</div>` : ''}
            ${c.blocking_faculty
              ? `<div style="font-size:13px;color:#475569;">Assigned to: <strong>${escHtml(c.blocking_faculty)}</strong></div>` : ''}
            <div style="font-size:13px;color:#475569;margin-top:6px;display:flex;gap:16px;flex-wrap:wrap;">
              <span><i class="fas fa-calendar-day" style="color:${tm.color};margin-right:4px;"></i>${escHtml(c.day || '')}</span>
              <span><i class="fas fa-clock" style="color:${tm.color};margin-right:4px;"></i>${fmt(c.start_time)} – ${fmt(c.end_time)}</span>
              ${c.room ? `<span><i class="fas fa-door-open" style="color:${tm.color};margin-right:4px;"></i>Room ${escHtml(c.room)}</span>` : ''}
            </div>
          </div>
        </div>

        <!-- Recommendations -->
        <div style="padding:16px 24px 0;">
          <div style="font-size:12px;font-weight:800;text-transform:uppercase;color:var(--text-secondary);margin-bottom:14px;display:flex;align-items:center;gap:6px;">
            <i class="fas fa-lightbulb" style="color:#f59e0b;font-size:14px;"></i> Suggested Alternatives
          </div>

          <div style="margin-bottom:14px;">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-light);margin-bottom:8px;">
              <i class="fas fa-door-open" style="margin-right:4px;"></i>Available Rooms — ${escHtml(c.day || '')} ${fmt(c.start_time)} to ${fmt(c.end_time)}
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">${roomPills}</div>
          </div>

          ${c.room ? `
          <div style="margin-bottom:4px;">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-light);margin-bottom:8px;">
              <i class="fas fa-clock" style="margin-right:4px;"></i>Free Windows for Room ${escHtml(c.room)} — ${escHtml(c.day || '')}
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">${timePills}</div>
          </div>` : ''}
        </div>

        <!-- Footer -->
        <div style="padding:16px 24px 20px;display:flex;align-items:center;gap:12px;margin-top:8px;">
          <div style="flex:1;font-size:12px;color:var(--text-light);">
            <i class="fas fa-info-circle" style="margin-right:4px;"></i>
            Edit the offering's room or time in the <strong>Offerings</strong> tab, then try approving again.
          </div>
          <button onclick="document.getElementById('schedConflictModal').remove()" class="btn btn-secondary" style="flex-shrink:0;">Close</button>
        </div>
      </div>`;
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
  }

  window._reviewLoading = async (id, action) => {
    let admin_remarks = '';
    if (action === 'reject' || action === 'return') {
      admin_remarks = await showSystemPrompt(action === 'reject' ? 'Reason for rejection (optional):' : 'What needs revision?') || '';
      if (action === 'return' && !admin_remarks.trim()) { showToast('Please add a note for the faculty.', 'error'); return; }
    }
    try {
      await api(`/api/loading/admin/requests/${id}/${action}`, { method: 'POST', body: JSON.stringify({ admin_remarks }) });
      showToast(`Request ${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'returned'}.`, 'success');
      renderAdminRequests();
    } catch (err) {
      if (action === 'approve' && err.status === 409 && err.responseData?.conflict) {
        showConflictModal(err.responseData);
      } else {
        showToast(err.message, 'error');
      }
    }
  };

  // ── Reschedule helpers ────────────────────────────────────────────────────
  window._toggleReschedule = (id) => {
    const panel = document.getElementById(`rsp-${id}`);
    if (!panel) return;
    const opening = panel.style.display === 'none';
    panel.style.display = opening ? 'block' : 'none';
    if (opening) {
      // Wire up live conflict check for this panel
      const term = state._ldAdminTerm;
      let _rspTimer = null;

      function _rspSetStatus(st, msg) {
        const div = document.getElementById(`rsp-status-${id}`);
        const btn = document.getElementById(`rsp-save-${id}`);
        if (!div) return;
        const styles = {
          checking: { bg:'#f8fafc', border:'#e2e8f0', color:'#64748b', icon:'fa-spinner fa-spin' },
          clear:    { bg:'#f0fdf4', border:'#86efac', color:'#15803d', icon:'fa-check-circle'   },
          conflict: { bg:'#fee2e2', border:'#fca5a5', color:'#b91c1c', icon:'fa-times-circle'   },
        };
        if (st === 'idle') { div.style.display = 'none'; if (btn) { btn.disabled = false; btn.style.opacity = '1'; } return; }
        const s = styles[st] || styles.checking;
        div.style.cssText = `display:flex;gap:8px;align-items:flex-start;border-radius:7px;padding:8px 12px;font-size:12px;margin-bottom:10px;background:${s.bg};border:1px solid ${s.border};color:${s.color};`;
        div.innerHTML = `<i class="fas ${s.icon}" style="margin-top:1px;flex-shrink:0;"></i><span>${escHtml(msg)}</span>`;
        const ok = st === 'clear';
        if (btn) { btn.disabled = !ok; btn.style.opacity = ok ? '1' : '.5'; }
      }

      async function _rspCheck() {
        const day   = document.getElementById(`rsp-day-${id}`)?.value;
        const start = document.getElementById(`rsp-start-${id}`)?.value;
        const end   = document.getElementById(`rsp-end-${id}`)?.value;
        const room  = document.getElementById(`rsp-room-${id}`)?.value.trim();
        if (!start || !end) { _rspSetStatus('idle', ''); return; }
        if (start >= end)   { _rspSetStatus('conflict', 'Start time must be before end time.'); return; }
        _rspSetStatus('checking', 'Checking for conflicts…');
        try {
          const excludeId = panel.dataset.offeringId || null;
          const result = await api('/api/loading/admin/offerings/check-conflict', {
            method: 'POST',
            body: JSON.stringify({ term, day_of_week: day, start_time: start, end_time: end, room: room || null, exclude_id: excludeId }),
          });
          if (result.clear === true)       _rspSetStatus('clear',    result.message);
          else if (result.clear === false) _rspSetStatus('conflict', result.message);
          else                             _rspSetStatus('idle', '');
        } catch (e) { _rspSetStatus('conflict', e.message); }
      }

      [`rsp-day-${id}`, `rsp-start-${id}`, `rsp-end-${id}`, `rsp-room-${id}`].forEach(eid => {
        const el = document.getElementById(eid);
        if (el) {
          el.addEventListener('change', () => { clearTimeout(_rspTimer); _rspTimer = setTimeout(_rspCheck, 600); });
          if (el.type !== 'select-one') el.addEventListener('input', () => { clearTimeout(_rspTimer); _rspTimer = setTimeout(_rspCheck, 600); });
        }
      });
      _rspCheck(); // run immediately when panel opens
    }
  };

  window._saveReschedule = async (id) => {
    const day   = document.getElementById(`rsp-day-${id}`)?.value;
    const start = document.getElementById(`rsp-start-${id}`)?.value;
    const end   = document.getElementById(`rsp-end-${id}`)?.value;
    const room  = (document.getElementById(`rsp-room-${id}`)?.value || '').trim();
    if (!start || !end) { showToast('Set start and end time.', 'error'); return; }
    const btn = document.getElementById(`rsp-save-${id}`);
    if (btn) btn.disabled = true;
    try {
      await api(`/api/loading/admin/requests/${id}/reschedule`, {
        method: 'PATCH',
        body: JSON.stringify({ day_of_week: day, start_time: start, end_time: end, room: room || null }),
      });
      showToast('Schedule updated. Faculty has been notified.', 'success');
      renderAdminRequests();
    } catch (err) {
      const div = document.getElementById(`rsp-status-${id}`);
      if (div) {
        div.style.cssText = 'display:flex;gap:8px;align-items:flex-start;border-radius:7px;padding:8px 12px;font-size:12px;margin-bottom:10px;background:#fee2e2;border:1px solid #fca5a5;color:#b91c1c;';
        div.innerHTML = `<i class="fas fa-times-circle" style="margin-top:1px;"></i><span>${escHtml(err.message)}</span>`;
      }
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    }
  };

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
    if (!state.scheduleFilterTerm) state.scheduleFilterTerm = state.activeTerm || 'FIRST_SEMESTER';
    if (!state.scheduleFilterYear) state.scheduleFilterYear2 = state.activeYear || '2025-2026';
    const params = new URLSearchParams();
    if (state.scheduleFilterTerm) params.set('term', state.scheduleFilterTerm);
    if (state.scheduleFilterYear2) params.set('academic_year', state.scheduleFilterYear2);
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
          <div class="sched-filter-bar schedule-filters" style="margin-bottom: 0;">
            <select class="sched-filter-select" id="sfTerm" style="max-width:180px;">
              ${Object.entries(TERM_LABELS).map(([v, l]) => `<option value="${v}"${state.scheduleFilterTerm === v ? ' selected' : ''}>${l}</option>`).join('')}
            </select>
            <select class="sched-filter-select" id="sfDept" style="max-width:170px;">
              ${departments.map(d => `<option value="${d}"${state.scheduleFilterDept === d ? ' selected' : ''}>${d === 'All' ? 'All Departments' : d}</option>`).join('')}
            </select>
            <select class="sched-filter-select" id="sfYear" style="max-width:140px;">
              <option value="">All Years</option>
              ${yearLevelOpts.map(y => `<option value="${y}"${state.scheduleFilterYear === y ? ' selected' : ''}>${y} Year</option>`).join('')}
            </select>
            <select class="sched-filter-select" id="sfSection" style="max-width:140px;">
              <option value="">All Sections</option>
              ${sectionOpts.map(s => `<option value="${s}"${state.scheduleFilterSection === s ? ' selected' : ''}>Section ${s}</option>`).join('')}
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
                    <summary class="sched-dept-header">
                      <div class="sched-dept-header-left">
                        <i class="fas fa-chevron-right sched-dept-arrow"></i>
                        <div class="sched-dept-icon-box"><i class="fas fa-chalkboard-teacher"></i></div>
                        <span class="sched-dept-name">Faculty Teaching Schedules</span>
                      </div>
                      <span class="sched-dept-count">${facultyEmbeds.length} schedule${facultyEmbeds.length === 1 ? '' : 's'}</span>
                    </summary>
                    <div class="sched-dept-body">
                      ${facultyEmbeds.map(em => `
                        <details class="sched-card">
                          <summary class="sched-card-summary" onclick="const target = event.target; if(target.closest('a') || target.closest('button')) event.stopPropagation();">
                            <div class="sched-card-left">
                              <i class="fas fa-chevron-right sched-arrow" style="font-size:12px; color:var(--text-light); transition: transform 0.2s;"></i>
                              <div class="sched-card-icon"><i class="fas fa-user-tie"></i></div>
                              <div class="sched-card-title-group">
                                <div class="sched-card-title">${escHtml(em.title || 'Untitled Schedule')}</div>
                                <div class="sched-card-tags">
                                  <span class="sched-tag sched-tag--type">Faculty</span>
                                  <span class="sched-tag sched-tag--sec"><i class="fas fa-user-tie"></i> ${escHtml(em.faculty_name || 'Unassigned')}</span>
                                  <span class="sched-tag sched-tag--dept"><i class="fas fa-building"></i> ${escHtml(em.department || 'General')}</span>
                                </div>
                              </div>
                            </div>
                            <div class="sched-card-right" onclick="event.stopPropagation();">
                              <span class="sched-embed-by" style="font-size:12px; color:var(--text-secondary);"><i class="fas fa-user-edit" style="margin-right:4px;"></i>by ${escHtml(em.posted_by_name || 'Faculty')}</span>
                              ${em.embed_url ? `
                                <a href="${escHtml(em.embed_url)}" target="_blank" rel="noopener" class="btn btn-secondary btn-xs" style="padding:5px 10px; font-size:11px; font-weight: 600; display: inline-flex; align-items: center; gap: 5px; border-radius: 6px;">
                                  <i class="fas fa-external-link-alt"></i> Open Sheet
                                </a>
                              ` : ''}
                              ${canManageSchedules ? `<div class="sched-actions" style="display:flex; gap:6px;"><button class="btn btn-xs btn-secondary sched-edit-btn" data-id="${em.id}" title="Edit Schedule" style="padding: 5px 8px; border-radius: 6px;"><i class="fas fa-edit"></i></button><button class="btn btn-xs btn-danger sched-del-btn" data-id="${em.id}" title="Delete Schedule" style="padding: 5px 8px; border-radius: 6px;"><i class="fas fa-trash"></i></button></div>` : ''}
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
                ` : Object.entries(grouped).map(([dept, years]) => {
                  const deptCount = Object.values(years).flatMap(y => Object.values(y)).flat().length;
                  return `
                  <details class="sched-dept-group" open>
                    <summary class="sched-dept-header">
                      <div class="sched-dept-header-left">
                        <i class="fas fa-chevron-right sched-dept-arrow"></i>
                        <div class="sched-dept-icon-box"><i class="fas fa-graduation-cap"></i></div>
                        <span class="sched-dept-name">${escHtml(dept)}</span>
                      </div>
                      <span class="sched-dept-count">${deptCount} schedule${deptCount === 1 ? '' : 's'}</span>
                    </summary>
                    <div class="sched-dept-body">
                      ${Object.entries(years).map(([yr, sections]) => {
                        const yearItems = Object.values(sections).flat();
                        return `
                        <details class="sched-year-group" open>
                          <summary class="sched-year-header">
                            <div class="sched-year-header-left">
                              <i class="fas fa-chevron-right sched-year-arrow"></i>
                              <span class="sched-year-pill"><i class="fas fa-layer-group" style="color:var(--primary); font-size:12px;"></i> ${escHtml(yr)} Year</span>
                            </div>
                            <span class="sched-year-count">${yearItems.length} schedule${yearItems.length === 1 ? '' : 's'}</span>
                          </summary>
                          <div class="sched-year-body">
                            ${yearItems.map(em => `
                              <details class="sched-card">
                                <summary class="sched-card-summary" onclick="const target = event.target; if(target.closest('a') || target.closest('button')) event.stopPropagation();">
                                  <div class="sched-card-left">
                                    <i class="fas fa-chevron-right sched-arrow" style="font-size:12px; color:var(--text-light); transition: transform 0.2s;"></i>
                                    <div class="sched-card-icon"><i class="fas fa-users"></i></div>
                                    <div class="sched-card-title-group">
                                      <div class="sched-card-title">${escHtml(em.title || 'Untitled Schedule')}</div>
                                      <div class="sched-card-tags">
                                        <span class="sched-tag sched-tag--sec"><i class="fas fa-users"></i> Section ${escHtml(em.section || '—')}</span>
                                        <span class="sched-tag sched-tag--dept"><i class="fas fa-graduation-cap"></i> ${escHtml(em.department || dept)}</span>
                                        <span class="sched-tag sched-tag--year"><i class="fas fa-layer-group"></i> ${escHtml(em.year_level || yr)} Year</span>
                                      </div>
                                    </div>
                                  </div>
                                  <div class="sched-card-right" onclick="event.stopPropagation();">
                                    <span class="sched-embed-by" style="font-size:12px; color:var(--text-secondary);"><i class="fas fa-user-edit" style="margin-right:4px;"></i>by ${escHtml(em.posted_by_name || 'Faculty')}</span>
                                    ${em.embed_url ? `
                                      <a href="${escHtml(em.embed_url)}" target="_blank" rel="noopener" class="btn btn-secondary btn-xs" style="padding:5px 10px; font-size:11px; font-weight: 600; display: inline-flex; align-items: center; gap: 5px; border-radius: 6px;">
                                        <i class="fas fa-external-link-alt"></i> Open Sheet
                                      </a>
                                    ` : ''}
                                    ${canManageSchedules ? `<div class="sched-actions" style="display:flex; gap:6px;"><button class="btn btn-xs btn-secondary sched-edit-btn" data-id="${em.id}" title="Edit Schedule" style="padding: 5px 8px; border-radius: 6px;"><i class="fas fa-edit"></i></button><button class="btn btn-xs btn-danger sched-del-btn" data-id="${em.id}" title="Delete Schedule" style="padding: 5px 8px; border-radius: 6px;"><i class="fas fa-trash"></i></button></div>` : ''}
                                  </div>
                                </summary>
                                <div class="sched-embed-details-body" style="padding:20px; border-top:1px dashed var(--border); display:flex; flex-direction:column; gap:16px;">
                                  ${window._buildFlexibleScheduleTableHtml(em.rows, em.error, em.embed_url, em.title, true)}
                                </div>
                              </details>
                            `).join('')}
                          </div>
                        </details>
                        `;
                      }).join('')}
                    </div>
                  </details>
                  `;
                }).join('')}
              `
              // ── Faculty: flat card list ──
              : `<div style="display:flex;flex-direction:column;gap:14px;">
                  ${embeds.map(em => `
                    <details class="sched-card">
                      <summary class="sched-card-summary" onclick="const target = event.target; if(target.closest('a') || target.closest('button')) event.stopPropagation();">
                        <div class="sched-card-left">
                          <i class="fas fa-chevron-right sched-arrow" style="font-size:12px; color:var(--text-light); transition: transform 0.2s;"></i>
                          <div class="sched-card-icon"><i class="${em.schedule_type === 'faculty' ? 'fas fa-chalkboard-teacher' : 'fas fa-users'}"></i></div>
                          <div class="sched-card-title-group">
                            <div class="sched-card-title">${escHtml(em.title || 'Untitled Schedule')}</div>
                            <div class="sched-card-tags">
                              ${em.schedule_type === 'faculty' ? `
                                <span class="sched-tag sched-tag--type">Faculty</span>
                                <span class="sched-tag sched-tag--sec"><i class="fas fa-user-tie"></i> ${escHtml(em.faculty_name || (state.user ? state.user.first_name + ' ' + state.user.last_name : 'Faculty'))}</span>
                                <span class="sched-tag sched-tag--dept"><i class="fas fa-building"></i> ${escHtml(em.department || 'General')}</span>
                              ` : `
                                <span class="sched-tag sched-tag--sec"><i class="fas fa-users"></i> Section ${escHtml(em.section || '—')}</span>
                                <span class="sched-tag sched-tag--dept"><i class="fas fa-graduation-cap"></i> ${escHtml(em.department || '—')}</span>
                                <span class="sched-tag sched-tag--year"><i class="fas fa-layer-group"></i> ${escHtml(em.year_level || '—')} Year</span>
                              `}
                            </div>
                          </div>
                        </div>
                        <div class="sched-card-right" onclick="event.stopPropagation();">
                          <span class="sched-embed-by" style="font-size:12px; color:var(--text-secondary);"><i class="fas fa-user-edit" style="margin-right:4px;"></i>by ${escHtml(em.posted_by_name || 'Faculty')}</span>
                          ${em.embed_url ? `
                            <a href="${escHtml(em.embed_url)}" target="_blank" rel="noopener" class="btn btn-secondary btn-xs" style="padding:5px 10px; font-size:11px; font-weight: 600; display: inline-flex; align-items: center; gap: 5px; border-radius: 6px;">
                              <i class="fas fa-external-link-alt"></i> Open Sheet
                            </a>
                          ` : ''}
                          ${canManageSchedules ? `<div class="sched-actions" style="display:flex; gap:6px;"><button class="btn btn-xs btn-secondary sched-edit-btn" data-id="${em.id}" title="Edit Schedule" style="padding: 5px 8px; border-radius: 6px;"><i class="fas fa-edit"></i></button><button class="btn btn-xs btn-danger sched-del-btn" data-id="${em.id}" title="Delete Schedule" style="padding: 5px 8px; border-radius: 6px;"><i class="fas fa-trash"></i></button></div>` : ''}
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
      document.getElementById('sfTerm').onchange    = e => { state.scheduleFilterTerm    = e.target.value; _loadScheduleManagement(); };
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

  // Faculty credentials card — mirrors the PROFILE sheet (academic title,
  // specializations, education, and portfolio links). Stored as JSON.
  const CRED_GROUPS = [
    { key: 'research', label: 'Research', hint: 'e.g. "Study on AI Ethics - https://..."' },
    { key: 'trainings', label: 'Trainings', hint: 'e.g. "Advanced Python Training (2025) - https://..."' },
    { key: 'extension', label: 'Extension', hint: 'e.g. "Coding for Kids Program (2024) - https://..."' },
    { key: 'awards', label: 'Awards', hint: 'e.g. "Outstanding Faculty Award (2025) - https://..."' },
  ];
  function renderCredentialsCard(p) {
    const c = p.faculty_credentials || {};
    const arr = (v, n) => { const a = Array.isArray(v) ? v.slice(0, n) : []; while (a.length < n) a.push(''); return a; };
    const rows = (key, n, ph) => arr(c[key], n).map((v, i) =>
      `<input type="text" class="form-input cred-${key}" style="margin-bottom:6px;" placeholder="${ph} ${i + 1}" value="${escHtml(v || '')}">`).join('');
    return `
      <div class="card profile-section" style="grid-column:1 / -1;">
        <div class="profile-section-header">
          <i class="fas fa-award" style="color:var(--maroon);"></i>
          <span>Faculty Credentials</span>
        </div>
        <p class="profile-section-desc">Used by admins when reviewing your loading requests. Filling this out does not guarantee a load.</p>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Academic Title</label>
            <input type="text" class="form-input" id="credTitle" placeholder="e.g., Assistant Professor 1" value="${escHtml(c.academic_title || '')}"></div>
          <div class="form-group"><label class="form-label">Program</label>
            <div class="form-input pf-readonly">${escHtml(p.department || '—')}</div></div>
        </div>
        <div class="form-group"><label class="form-label">Specializations</label>${rows('specializations', 3, 'Specialization')}</div>
        <div class="form-group"><label class="form-label">Educational Background (Undergrad & Postgrad)</label>${rows('education', 3, 'Degree')}</div>
        <div style="border-top:1px solid var(--border); margin:8px 0 12px;"></div>
        <p class="form-label" style="margin-bottom:8px;"><strong>Portfolio Links (last 3 years)</strong></p>
        ${CRED_GROUPS.map(g => `<div class="form-group"><label class="form-label">${g.label}</label>${rows(g.key, 3, g.label)}</div>`).join('')}
        <button class="btn btn-primary" id="credSaveBtn"><i class="fas fa-save"></i> Save Credentials</button>
      </div>`;
  }
  function collectCredentials() {
    const vals = (cls) => [...document.querySelectorAll('.' + cls)].map(i => i.value.trim()).filter(Boolean);
    return {
      academic_title: (document.getElementById('credTitle')?.value || '').trim(),
      specializations: vals('cred-specializations'),
      education: vals('cred-education'),
      research: vals('cred-research'),
      trainings: vals('cred-trainings'),
      extension: vals('cred-extension'),
      awards: vals('cred-awards'),
    };
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

            ${(p.role === 'student') ? `
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Department</label>
                <select class="form-input form-select" id="pfDept">
                  ${departments.filter(d => !['All','General','Campus'].includes(d)).map(d => `<option value="${d}" ${p.department===d?'selected':''}>${d}</option>`).join('')}
                </select>
              </div>
            </div>` : ''}

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
                ${p.role === 'faculty' && p.employment_type ? `
                <div class="profile-info-row">
                  <span class="pil-label">Employment Type</span>
                  <span class="pil-value">
                    ${p.employment_type === 'part_time'
                      ? `<span style="background:#fef3c7;color:#92400e;font-size:11px;font-weight:700;padding:2px 9px;border-radius:99px;">Part-Time</span>`
                      : `<span style="background:#dcfce7;color:#15803d;font-size:11px;font-weight:700;padding:2px 9px;border-radius:99px;">Full-Time</span>`}
                  </span>
                </div>` : ''}
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
          <div class="suggestion-card" onclick="window._chipSendText('What are the class schedules?')">
            <div class="suggestion-icon"><i class="fas fa-calendar-alt"></i></div>
            <div class="suggestion-title">Class schedules</div>
            <div class="suggestion-desc">View or search section timetables</div>
          </div>
          <div class="suggestion-card" onclick="window._chipSendText('Check lost and found items')">
            <div class="suggestion-icon"><i class="fas fa-search"></i></div>
            <div class="suggestion-title">Lost & Found</div>
            <div class="suggestion-desc">Report or check lost items</div>
          </div>
          <div class="suggestion-card" onclick="window._chipSendText('What are the enrollment steps?')">
            <div class="suggestion-icon"><i class="fas fa-clipboard-list"></i></div>
            <div class="suggestion-title">Enrollment steps</div>
            <div class="suggestion-desc">Guide to campus enrollment</div>
          </div>
          <div class="suggestion-card" onclick="window._chipSendText('What are the latest announcements?')">
            <div class="suggestion-icon"><i class="fas fa-bullhorn"></i></div>
            <div class="suggestion-title">Latest announcements</div>
            <div class="suggestion-desc">What is new on campus today</div>
          </div>
          <div class="suggestion-card" onclick="window._chipSendText('Show available document templates')">
            <div class="suggestion-icon"><i class="fas fa-file-pdf"></i></div>
            <div class="suggestion-title">Document templates</div>
            <div class="suggestion-desc">Download forms & templates</div>
          </div>
          <div class="suggestion-card" onclick="window._chipSendText('Check faculty status and locator')">
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
        .doc-folder-theme-5{--fc-tab:rgba(230,126,34,.16);--fc-body:#fff6ed;--fc-border:rgba(230,126,34,.2);--fc-icon:#d97706}
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
      const isSuperAdmin = state.user?.role === 'superadmin';
      const hasMod = (m) => isSuperAdmin || (Array.isArray(state.user?.modules) && state.user.modules.includes(m));

      const [stats, pendingAnn, pendingEv] = await Promise.all([
        api('/api/admin/stats'),
        hasMod('announcements') ? api('/api/announcements/pending/list').catch(() => []) : Promise.resolve([]),
        hasMod('events') ? api('/api/events/pending/list').catch(() => []) : Promise.resolve([]),
      ]);
      state.adminStats = stats;
      state.pendingAnnouncements = pendingAnn || [];
      state.pendingEvents = pendingEv || [];

      const annStat = typeof stats.announcements === 'object' ? stats.announcements : { total: stats.announcements, pending: 0 };
      const evStat  = typeof stats.events === 'object' ? stats.events : { total: stats.events, pending: 0 };
      const annPending = hasMod('announcements') ? (annStat.pending || 0) : 0;
      const evPending = hasMod('events') ? (evStat.pending || 0) : 0;
      const totalPending = annPending + evPending;

      pageArea.innerHTML = `
        <div class="page-header"><h1 class="page-title">Admin Dashboard</h1><p class="page-subtitle">System overview & management</p></div>
        <div class="page-content">
          <div class="card" style="padding:20px;">
            <h3 style="font-family:var(--font-display);font-size:16px;font-weight:700;margin-bottom:16px;">Quick Actions</h3>
            <div class="admin-quick-actions">
              ${isSuperAdmin ? `<button class="btn btn-primary quick-action-full" onclick="navigateTo('admin-users')"><i class="fas fa-users-cog"></i> Manage Users</button>` : ''}
              ${isSuperAdmin ? `
                <div class="quick-action-row" style="margin-top: 6px;">
                  <button class="btn btn-warning quick-action-full" style="background:#b45309; border-color:#b45309; color:#fff;" onclick="window._promoteSemester()">
                    <i class="fas fa-graduation-cap"></i> Update Semester (Advance Year Levels)
                  </button>
                </div>
              ` : ''}
              <div class="quick-action-row" style="margin-top: 6px;">
                ${hasMod('announcements') ? `<button class="btn btn-gold" onclick="openModal('announcement')"><i class="fas fa-bullhorn"></i> Post Announcement</button>` : ''}
                ${hasMod('events') ? `<button class="btn btn-secondary" onclick="openModal('event')"><i class="fas fa-calendar-plus"></i> Create Event</button>` : ''}
              </div>
              ${hasMod('schedules') ? `
              <div class="quick-action-row" style="margin-top: 10px;">
                <button class="btn btn-primary quick-action-full" style="background:#2e7d32; border-color:#2e7d32;" onclick="openModal('section-schedule')">
                  <i class="fas fa-calendar-alt"></i> Upload & Assign Schedule
                </button>
              </div>` : ''}
            </div>
          </div>

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

        </div>`;

      bindApprovalActions();
    } catch (err) {
      console.error('[Admin dashboard] load error:', err);
      pageArea.querySelector('.page-content').innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Failed to load dashboard</h3><p>${escHtml(err.message || '')}</p></div>`;
    }
  }

  window._promoteSemester = async () => {
    const confirmed = await window.showSystemConfirm(
      'Are you sure you want to update the semester? This will advance all students by one year level: 1st → 2nd, 2nd → 3rd, 3rd → 4th, and 4th Year students will be marked as Graduated.'
    );
    if (!confirmed) return;
    try {
      const res = await api('/api/admin/promote-year-levels', { method: 'POST' });
      showToast(res.message || 'Semester updated successfully!', 'success');
      loadAdminDashboard();
    } catch (err) {
      showToast(err.message || 'Failed to update semester', 'error');
    }
  };

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
        const reason = await showSystemPrompt('Optional reason for rejection (leave empty to skip):') || '';
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
      ${u.role === 'student' ? `<button class="btn btn-secondary btn-sm" style="width:auto;" onclick="window._editStudentYearLevel('${u.id}', '${escHtml(u.year_level || '1st')}', '${escHtml(u.first_name)} ${escHtml(u.last_name)}')"><i class="fas fa-graduation-cap"></i> Year Level</button>` : ''}
      <button class="btn btn-secondary btn-sm" style="width:auto;" onclick="window._adminResetUserPassword('${u.id}', '${escHtml(u.first_name)}')"><i class="fas fa-key"></i> Reset PW</button>
      <button class="btn btn-danger btn-sm" style="width:auto;" onclick="window._deleteUser('${u.id}')">Delete</button>
    </div>`;
  }
  window._adminResetUserPassword = async (id, name) => {
    if (!await window.showSystemConfirm(`Send password reset email to ${name}?`)) return;
    try {
      const res = await api(`/api/admin/users/${id}/reset-password`, { method: 'POST' });
      showToast(res.message || 'Password reset link sent!', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to send password reset', 'error');
    }
  };
  window._editStudentYearLevel = (id, currentYear, name) => {
    openModal('custom-confirm', {
      title: 'Edit Student Year Level',
      message: `Select year level for ${name}:`,
      submessage: `
        <div style="margin-top:10px;">
          <select id="editStudentYearSelect" class="form-input form-select" style="width:100%; font-size:14px; padding:8px 12px;">
            <option value="1st"${currentYear === '1st' ? ' selected' : ''}>1st Year</option>
            <option value="2nd"${currentYear === '2nd' ? ' selected' : ''}>2nd Year</option>
            <option value="3rd"${currentYear === '3rd' ? ' selected' : ''}>3rd Year</option>
            <option value="4th"${currentYear === '4th' ? ' selected' : ''}>4th Year</option>
            <option value="Graduated"${currentYear === 'Graduated' ? ' selected' : ''}>Graduated</option>
          </select>
        </div>
      `,
      yesLabel: 'Save Changes',
      icon: 'fa-graduation-cap',
      onConfirm: async () => {
        const select = document.getElementById('editStudentYearSelect');
        const newYear = select ? select.value : '';
        if (!newYear) return;
        try {
          const res = await api(`/api/admin/users/${id}/year-level`, {
            method: 'PATCH',
            body: JSON.stringify({ year_level: newYear })
          });
          showToast(res.message || 'Year level updated!', 'success');
          if (typeof loadAdminUsers === 'function') loadAdminUsers();
        } catch (err) {
          showToast(err.message || 'Failed to update year level', 'error');
        }
      }
    });
  };
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
    const YEAR_ORDER = ['1st', '2nd', '3rd', '4th', 'Graduated'];
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
              ${year === 'Graduated' ? 'Graduated' : `${year} Year`} <span class="admin-dept-badge" style="margin-left:6px;">${list.length}</span>
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
  window._navigate = navigateTo;
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
          <div class="form-group">
            <label>Office / Department <span class="muted-hint">(label only)</span></label>
            <input type="text" class="form-input" id="adminCreateDept" placeholder="e.g., Student Affairs / Academic Affairs" autocomplete="off">
          </div>
          <div class="form-group">
            <label>Module Access <span class="req">*</span></label>
            <p class="muted-hint" style="margin:2px 0 8px;">Choose which admin areas this account can access.</p>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
              ${[
                ['loading_requests','Loading Requests (schedules)'],
                ['lost_found','Lost & Found'],
                ['announcements','Announcements'],
                ['events','Events'],
                ['feedback','Feedback'],
                ['documents','Documents'],
                ['schedules','Class Schedules'],
                ['faculty','Faculty'],
                ['notifications','Notifications'],
                ['chatbot','PUPBot'],
                ['pages','Pages'],
                ['queueing','Queueing'],
              ].map(([m, label]) => `<label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:500;cursor:pointer;">
                <input type="checkbox" class="adminModuleChk" value="${m}"> ${label}</label>`).join('')}
            </div>
          </div>
        `;
        onSubmit = async () => {
          const first_name = document.getElementById('adminCreateName').value.trim();
          const email = document.getElementById('adminCreateEmail').value.trim();
          const password = document.getElementById('adminCreatePassword').value;
          const position = document.getElementById('adminCreatePosition').value.trim() || null;
          const department = document.getElementById('adminCreateDept').value.trim() || null;
          const modules = [...document.querySelectorAll('.adminModuleChk:checked')].map(c => c.value);

          if (!first_name || !email || !password) {
            showToast('Please fill in all required fields', 'error');
            return;
          }
          if (password.length < 6) {
            showToast('Password must be at least 6 characters', 'error');
            return;
          }
          if (!modules.length) {
            showToast('Select at least one module this admin can access', 'error');
            return;
          }

          const payload = { first_name, email, password, department, position, modules };
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
                ${state.user.role === 'student' ? `
                  <select class="form-input form-select" id="modalDept">
                    ${['General', state.user.department].filter(Boolean).filter((v,i,a) => a.indexOf(v)===i)
                      .map(d => `<option value="${d}"${isEdit && modalData.department === d ? ' selected' : (d === 'General' ? ' selected' : '')}>${d}</option>`).join('')}
                  </select>
                  <div class="form-help"><i class="fas fa-info-circle"></i> <strong>General</strong> is visible to everyone. Your department option limits the event to your department only.</div>
                ` : `
                  <select class="form-input form-select" id="modalDept">
                    ${(state.user.role === 'admin' || state.user.role === 'faculty' || state.user.role === 'superadmin'
                      ? departments.filter(d => d !== 'All')
                      : [state.user.department].filter(Boolean)
                    ).map(d => `<option value="${d}"${isEdit && modalData.department === d ? ' selected' : ''}>${d}</option>`).join('')}
                  </select>
                  <div class="form-help"><i class="fas fa-info-circle"></i> <strong>General</strong> and <strong>Campus</strong> are visible to everyone. Department options limit the event to that department.</div>
                `}
              </div>
              ${state.user.role === 'student' ? `
              <div class="form-group">
                <label>Posting As (Page) <span class="req">*</span></label>
                <select class="form-input form-select" id="modalPageId">
                  <option value="">-- Select a page --</option>
                  ${state.myPages.filter(p => p.status === 'approved').map(p => `<option value="${p.id}"${isEdit && modalData.page_id === p.id ? ' selected' : ''}>${escHtml(p.name)}</option>`).join('')}
                </select>
                <div class="form-help"><i class="fas fa-info-circle"></i> Your event will be posted on behalf of this page and requires admin approval.</div>
              </div>
              ` : ''}
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

          ${state.user.role !== 'admin' && state.user.role !== 'superadmin' ? '<div class="form-note" style="margin-top: 16px;"><i class="fas fa-clock"></i> Your event will be reviewed by an admin before it appears in the calendar.</div>' : ''}
        `;
        
        onSubmit = async () => {
          const titleVal = document.getElementById('modalTitle').value.trim();
          const description = document.getElementById('modalDesc').value.trim();
          const event_date = document.getElementById('modalDate').value;
          const location = document.getElementById('modalLocation').value.trim();
          const start_time = document.getElementById('modalStart').value;
          const end_time = document.getElementById('modalEnd').value;
          const department = document.getElementById('modalDept').value;
          const pageIdEl = document.getElementById('modalPageId');
          const page_id = pageIdEl ? pageIdEl.value : null;
          if (!titleVal || !event_date) { showToast('Please fill in title and date', 'error'); return; }
          if (state.user.role === 'student' && !page_id) { showToast('Please select a page to post on behalf of', 'error'); return; }

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
            if (page_id) formData.append('page_id', page_id);
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
          if (!/[a-zA-Z]{3,}/.test(data.description)) {
            showToast('Description must include descriptive words, not just numbers or symbols', 'error');
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
          <input type="hidden" id="ssTargetType" value="section">
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
                  ${departments.filter(d => !['All', 'General', 'Campus'].includes(d)).map(d => `<option value="${d}">${d}</option>`).join('')}
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

          <div class="form-group">
            <label id="ssUrlLabel">Schedule Link (optional)</label>
            <input type="url" class="form-input" id="ssUrl" placeholder="https://drive.google.com/...">
            <small style="color:var(--text-light);font-size:11px;" id="ssUrlHint">Paste a Google Drive, Docs, or any URL to the schedule</small>
          </div>`;
          
        onSubmit = async () => {
          const title_val = document.getElementById('ssTitle').value.trim();
          const embed_url = document.getElementById('ssUrl').value.trim();

          if (!title_val) {
            showToast('Schedule Title is required', 'error');
            return;
          }

          const department = document.getElementById('ssDept').value;
          const year_level = document.getElementById('ssYear').value;
          const section = document.getElementById('ssSection').value.trim();
          if (!section) {
            showToast('Section is required', 'error');
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
        title = 'Upload Course Preference';
        bodyHtml = `
          <div class="csv-upload-info">
            <p><strong>Heads up:</strong> uploading replaces your current course preferences.</p>
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
        const deptOpts  = departments.filter(d => !['All', 'General', 'Campus'].includes(d));
        
        title = existing ? 'Edit Schedule' : 'Upload Schedule';
        bodyHtml = `
          <input type="hidden" id="ssTargetType" value="section">
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

          <div class="form-group">
            <label id="ssUrlLabel">Schedule Link (optional)</label>
            <input type="url" class="form-input" id="ssUrl" placeholder="https://drive.google.com/..." value="${escHtml(e.embed_url || '')}">
            <small style="color:var(--text-light);font-size:11px;" id="ssUrlHint">Paste a Google Drive, Docs, or any URL to the schedule</small>
          </div>`;
          
        onSubmit = async () => {
          const title_val = document.getElementById('ssTitle').value.trim();
          const embed_url = document.getElementById('ssUrl').value.trim();

          if (!title_val) {
            showToast('Schedule Title is required', 'error');
            return;
          }

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
      state.activeTerm = (state.systemSettings && state.systemSettings.active_term) || 'FIRST_SEMESTER';
      state.activeYear = (state.systemSettings && state.systemSettings.active_year) || '2025-2026';
    } catch (err) {
      console.warn('System settings failed to load, falling back to default branding.', err);
      state.systemSettings = {};
      state.activeTerm = 'FIRST_SEMESTER';
      state.activeYear = '2025-2026';
    }

    // Handle email verification / password reset tokens in the URL
    const urlParams = new URLSearchParams(window.location.search);
    const verifyToken = urlParams.get('verify');
    const resetToken  = urlParams.get('reset') || sessionStorage.getItem('pupsj_reset_token');

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
      sessionStorage.setItem('pupsj_reset_token', resetToken);
      if (urlParams.get('reset')) {
        window.history.replaceState({}, document.title, '/');
      }
      authMode = 'reset-password';
      state.resetToken = resetToken;
      state.authViewActive = true;
      state.user = null;
      render();
      return;
    }

    // Only hit /api/auth/me if we actually have a stored token — avoids a
    // noisy 401 in the browser console when the user is simply not logged in.
    localStorage.removeItem('pupsj_token'); // Clean up any old cross-tab token
    const storedToken = sessionStorage.getItem('pupsj_token');
    if (storedToken) {
      try {
        const user = await api('/api/auth/me');
        state.user = user;
      } catch (e) {
        // Token is expired or invalid — clear it silently
        sessionStorage.removeItem('pupsj_token');
        localStorage.removeItem('pupsj_token');
        state.user = null;
      }
    } else {
      state.user = null;
    }
    render();
  }

  window._guestExit = () => {
    sessionStorage.removeItem('pupsj_token');
    localStorage.removeItem('pupsj_token');
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
      localStorage.removeItem('pupsj_token');
      state.user = data.user;
      state.currentPage = 'announcements';
      showToast('Welcome! You are browsing as a guest.', 'info');
      render();
    } catch (err) {
      showToast(err.message || 'Guest login failed', 'error');
    }
  };

  async function renderStudentQueueing() {
    const pageArea = document.getElementById('pageArea');
    pageArea.innerHTML = `<div class="page-header"><h1 class="page-title">Office Queueing & Appointments</h1><p class="page-subtitle">Get a same-day queue ticket or schedule a future appointment with campus offices.</p></div><div class="page-content"><div class="loader"><div class="spinner"></div></div></div>`;
    try {
      const offices = await api('/api/queueing/offices');

      // Format date helper that avoids UTC timezone day shifts
      const formatLocalDate = (dateStr) => {
        if (!dateStr) return '';
        const parts = String(dateStr).split('-');
        if (parts.length === 3) {
          const y = parseInt(parts[0], 10);
          const m = parseInt(parts[1], 10) - 1;
          const d = parseInt(parts[2], 10);
          const dt = new Date(y, m, d);
          return {
            full: dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
            month: dt.toLocaleDateString('en-US', { month: 'short' }),
            day: String(d),
            dayOfWeek: dt.getDay()
          };
        }
        return { full: dateStr, month: '', day: '', dayOfWeek: -1 };
      };

      // Calculate local minimum date (strictly tomorrow in local time)
      const now = new Date();
      const tmrw = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const minDateStr = `${tmrw.getFullYear()}-${String(tmrw.getMonth() + 1).padStart(2, '0')}-${String(tmrw.getDate()).padStart(2, '0')}`;
      const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      pageArea.innerHTML = `
        <div class="page-header">
          <h1 class="page-title">Office Queueing & Appointments</h1>
          <p class="page-subtitle">Get a same-day queue ticket or book a scheduled appointment before visiting an office.</p>
        </div>
        <div class="page-content">
          <div class="student-queue-layout">
            <!-- LEFT MAIN CARD -->
            <section class="student-queue-ticket-card">
              <!-- Side-by-side Tabs -->
              <div class="tabs queue-tabs" role="tablist">
                <button type="button" class="tab-btn active" id="queueTabWalkIn" role="tab" aria-selected="true">
                  <i class="fas fa-ticket-alt"></i>
                  <span>Walk-in Queue</span>
                </button>
                <button type="button" class="tab-btn" id="queueTabAppointment" role="tab" aria-selected="false">
                  <i class="fas fa-calendar-check"></i>
                  <span>Book Appointment</span>
                </button>
              </div>

              <!-- Active Live Ticket Notice (Visible whenever an active ticket exists) -->
              <div id="studentQueueActive" class="queue-student-status-area"></div>

              <!-- ═════════════════════════════════════════
                   TAB 1: WALK-IN QUEUE
                   ═════════════════════════════════════════ -->
              <div id="queueWalkInSection" class="queue-tab-panel">
                <div class="queue-panel-header">
                  <div class="queue-panel-header-icon"><i class="fas fa-ticket-alt"></i></div>
                  <div>
                    <span class="queue-panel-kicker">Same-Day Walk-in</span>
                    <h2 class="queue-panel-title">Get a Queue Ticket</h2>
                    <p class="queue-panel-desc">Join today's live office queue. Walk-in queueing is open daily from 06:00 to 18:00.</p>
                  </div>
                </div>

                <!-- Instant Ticket Result Alert -->
                <div id="studentQueueResult"></div>

                <div class="form-group">
                  <label for="walkInOffice">Office</label>
                  <select id="walkInOffice" class="form-input form-select">
                    <option value="">Select an office</option>
                    ${offices.map(o => `<option value="${o.id}">${escHtml(o.name)}</option>`).join('')}
                  </select>
                </div>

                <div class="form-group">
                  <label for="walkInPurpose">Purpose <span class="muted-hint" style="font-weight:400;text-transform:none;letter-spacing:0;">(optional)</span></label>
                  <input id="walkInPurpose" class="form-input" placeholder="e.g. Document request, Inquiries, Clearance">
                </div>

                <div class="form-group">
                  <label for="walkInPriority">Are you part of a priority group?</label>
                  <select id="walkInPriority" class="form-input form-select">
                    <option value="no">No</option>
                    <option value="yes">Yes (PWD, Senior Citizen, Pregnant)</option>
                  </select>
                </div>

                <div id="walkInPriorityGroup" class="form-group" style="display:none;">
                  <label for="walkInPriorityType">Specify Priority Group</label>
                  <input id="walkInPriorityType" class="form-input" placeholder="e.g. PWD, Senior Citizen, Pregnant" maxlength="80">
                </div>

                <button type="button" id="studentQueueJoin" class="btn btn-primary btn-queue-action">
                  <i class="fas fa-ticket-alt"></i> Get Queue Ticket
                </button>
              </div>

              <!-- ═════════════════════════════════════════
                   TAB 2: SCHEDULE AN APPOINTMENT
                   (Strictly NO 'Get queue ticket' button!)
                   ═════════════════════════════════════════ -->
              <div id="queueAppointmentSection" class="queue-tab-panel is-hidden" style="display:none;">
                <div class="queue-panel-header">
                  <div class="queue-panel-header-icon"><i class="fas fa-calendar-check"></i></div>
                  <div>
                    <span class="queue-panel-kicker">Advance Booking</span>
                    <h2 class="queue-panel-title">Schedule an Appointment</h2>
                    <p class="queue-panel-desc">Reserve a guaranteed future time slot. Scheduled appointments are called with priority once their scheduled time arrives.</p>
                  </div>
                </div>

                <!-- Booking Confirmation Banner -->
                <div id="appointmentBookingAlert"></div>

                ${state.user?.role === 'guest' ? `
                <div class="guest-appointment-notice" style="background:rgba(136,8,8,0.06);border:1.5px solid rgba(136,8,8,0.18);border-radius:8px;padding:12px 14px;margin-bottom:14px;display:flex;align-items:flex-start;gap:10px;">
                  <i class="fas fa-id-card" style="color:var(--maroon);font-size:16px;margin-top:2px;flex-shrink:0;"></i>
                  <div>
                    <strong style="font-size:13px;color:var(--maroon);display:block;">Guest Visitor Details Required</strong>
                    <span style="font-size:12px;color:var(--text-secondary);line-height:1.4;display:block;">As a guest, please provide your full name and contact number so the office can identify your appointment and reach you.</span>
                  </div>
                </div>

                <div class="form-row-2col">
                  <div class="form-group">
                    <label for="guestApptName">Your Full Name <span style="color:#dc2626;">*</span></label>
                    <input id="guestApptName" class="form-input" placeholder="e.g. Juan Dela Cruz" required maxlength="100">
                    <span class="form-field-hint">Your complete name</span>
                  </div>
                  <div class="form-group">
                    <label for="guestApptContact">Contact Number <span style="color:#dc2626;">*</span></label>
                    <input id="guestApptContact" class="form-input" type="tel" placeholder="e.g. 09123456789" required maxlength="20">
                    <span class="form-field-hint">Active mobile number</span>
                  </div>
                </div>
                ` : ''}

                <div class="form-group">
                  <label for="apptOffice">Office</label>
                  <select id="apptOffice" class="form-input form-select">
                    <option value="">Select an office</option>
                    ${offices.map(o => `<option value="${o.id}">${escHtml(o.name)}</option>`).join('')}
                  </select>
                </div>

                <div class="form-group">
                  <label for="apptPurpose">Purpose <span class="muted-hint" style="font-weight:400;text-transform:none;letter-spacing:0;">(optional)</span></label>
                  <input id="apptPurpose" class="form-input" placeholder="e.g. Consultation, Enrollment, Document claiming">
                </div>

                <div class="form-group">
                  <label for="apptPriority">Are you part of a priority group?</label>
                  <select id="apptPriority" class="form-input form-select">
                    <option value="no">No</option>
                    <option value="yes">Yes (PWD, Senior Citizen, Pregnant)</option>
                  </select>
                </div>

                <div id="apptPriorityGroup" class="form-group" style="display:none;">
                  <label for="apptPriorityType">Specify Priority Group</label>
                  <input id="apptPriorityType" class="form-input" placeholder="e.g. PWD, Senior Citizen, Pregnant" maxlength="80">
                </div>

                <div class="form-row-2col">
                  <div class="form-group" style="margin:0;">
                    <label for="queueAppointmentDate">Appointment Date</label>
                    <input id="queueAppointmentDate" class="form-input" type="date" min="${minDateStr}">
                    <span class="form-field-hint" id="queueDateHint">Must be at least 1 day in advance (Mon–Sat)</span>
                  </div>

                  <div class="form-group" style="margin:0;">
                    <label for="queueAppointmentTime">Available Time Slot</label>
                    <select id="queueAppointmentTime" class="form-input form-select" disabled>
                      <option value="">Choose office & date first</option>
                    </select>
                    <span class="form-field-hint" id="queueBookingNote">15-minute slot intervals</span>
                  </div>
                </div>

                <button type="button" id="queueBookAppointment" class="btn btn-primary btn-queue-action" disabled>
                  <i class="fas fa-calendar-plus"></i> Book Appointment
                </button>

                <!-- Upcoming Appointments List (Within Appointment Tab) -->
                <div id="appointmentListContainer" class="queue-my-appointments-section"></div>
              </div>
            </section>

            <!-- RIGHT COLUMN: GUIDE -->
            <aside class="student-queue-guide" id="queueGuideSidebar"></aside>
          </div>
        </div>
      `;

      // Guide Renderer
      const updateGuide = (mode) => {
        const guide = document.getElementById('queueGuideSidebar');
        if (!guide) return;
        if (mode === 'appointment') {
          guide.innerHTML = `
            <div class="student-queue-guide-head">
              <i class="fas fa-calendar-check"></i>
              <div>
                <p>Appointment Guide</p>
                <h2>How Booking Works</h2>
              </div>
            </div>
            <ol class="student-queue-steps">
              <li>
                <span>1</span>
                <div>
                  <strong>Choose office & date</strong>
                  <p>Pick an office and select any future day from Monday to Saturday.</p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Select an available time slot</strong>
                  <p>Choose an open 15-minute slot that fits your schedule.</p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>Check in on your visit day</strong>
                  <p>Open this tab on your scheduled date to check in and be called first at your booked time.</p>
                </div>
              </li>
            </ol>
            <div class="student-queue-guide-note">
              <i class="fas fa-bell"></i>
              <span>Scheduled appointments receive priority over walk-ins once their time arrives.</span>
            </div>
          `;
        } else {
          guide.innerHTML = `
            <div class="student-queue-guide-head">
              <i class="fas fa-route"></i>
              <div>
                <p>Walk-in Guide</p>
                <h2>How Walk-in Works</h2>
              </div>
            </div>
            <ol class="student-queue-steps">
              <li>
                <span>1</span>
                <div>
                  <strong>Choose an office</strong>
                  <p>Select the office you need to visit and add an optional purpose.</p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Keep your ticket number</strong>
                  <p>Your ticket is saved to your account and shown right on this screen.</p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>Watch for your turn</strong>
                  <p>Keep an eye on the office monitor or this page. You will be alerted when called.</p>
                </div>
              </li>
            </ol>
            <div class="student-queue-guide-note">
              <i class="fas fa-tv"></i>
              <span>Office monitors and your status update live whenever a ticket is called.</span>
            </div>
          `;
        }
      };

      updateGuide('walk_in');

      // Tab Switching Logic
      const tabWalkIn = document.getElementById('queueTabWalkIn');
      const tabAppointment = document.getElementById('queueTabAppointment');
      const walkInSection = document.getElementById('queueWalkInSection');
      const appointmentSection = document.getElementById('queueAppointmentSection');

      const setTab = (mode) => {
        const isAppt = mode === 'appointment';
        tabWalkIn.classList.toggle('active', !isAppt);
        tabWalkIn.setAttribute('aria-selected', !isAppt);
        tabAppointment.classList.toggle('active', isAppt);
        tabAppointment.setAttribute('aria-selected', isAppt);

        walkInSection.style.display = isAppt ? 'none' : 'block';
        walkInSection.classList.toggle('is-hidden', isAppt);

        appointmentSection.style.display = isAppt ? 'block' : 'none';
        appointmentSection.classList.toggle('is-hidden', !isAppt);

        updateGuide(mode);
        if (isAppt) {
          refreshAppointments();
        }
      };

      tabWalkIn.addEventListener('click', () => setTab('walk_in'));
      tabAppointment.addEventListener('click', () => setTab('appointment'));

      // Priority field toggles
      const setupPriorityToggle = (selectId, groupId, inputId) => {
        const select = document.getElementById(selectId);
        const group = document.getElementById(groupId);
        const input = document.getElementById(inputId);
        select.addEventListener('change', (e) => {
          const isYes = e.target.value === 'yes';
          group.style.display = isYes ? 'block' : 'none';
          if (!isYes && input) input.value = '';
        });
      };

      setupPriorityToggle('walkInPriority', 'walkInPriorityGroup', 'walkInPriorityType');
      setupPriorityToggle('apptPriority', 'apptPriorityGroup', 'apptPriorityType');

      // ── WALK-IN SUBMISSION & TICKET HANDLING ──
      const walkInOffice = document.getElementById('walkInOffice');
      const walkInPurpose = document.getElementById('walkInPurpose');
      const walkInPriority = document.getElementById('walkInPriority');
      const walkInPriorityType = document.getElementById('walkInPriorityType');
      const joinButton = document.getElementById('studentQueueJoin');
      const ticketResult = document.getElementById('studentQueueResult');

      joinButton.addEventListener('click', async () => {
        const officeId = walkInOffice.value;
        if (!officeId) { showToast('Please select an office.', 'error'); return; }

        const isPriority = walkInPriority.value === 'yes';
        const priorityTypeVal = walkInPriorityType.value.trim();
        if (isPriority && !priorityTypeVal) {
          showToast('Please specify your priority group (e.g., PWD, Senior Citizen, Pregnant).', 'error');
          return;
        }

        joinButton.disabled = true;
        try {
          const payload = {
            office_id: officeId,
            service_name: walkInPurpose.value.trim(),
            is_priority: isPriority,
            priority_type: isPriority ? priorityTypeVal : undefined,
            visitor_name: state.user.role === 'guest'
              ? `${state.user.first_name || ''} ${state.user.last_name || ''}`.trim() || 'Guest Visitor'
              : undefined
          };

          const ticket = await api('/api/queueing/tickets', {
            method: 'POST',
            body: JSON.stringify(payload)
          });

          // Store ticket in localStorage for instant retrieval (especially guest users)
          try {
            localStorage.setItem('pupsj_active_ticket', JSON.stringify(ticket));
            localStorage.setItem('activeQueueTicket', ticket.id);
          } catch (_) {}

          const officeText = walkInOffice.options[walkInOffice.selectedIndex]?.text || 'Office';

          // Prominently display the ticket result
          ticketResult.innerHTML = `
            <div class="queue-ticket-result">
              <span class="queue-ticket-result-badge">
                <i class="fas fa-check-circle"></i> Ticket Generated Successfully
              </span>
              <div class="queue-ticket-result-number">${escHtml(ticket.ticket_number)}</div>
              <p style="margin:0 0 8px;font-size:14px;color:var(--text-primary);font-weight:700;">
                <i class="fas fa-building" style="color:var(--primary);margin-right:6px;"></i>${escHtml(officeText)}
                ${ticket.is_priority ? '<span class="badge badge-warning" style="margin-left:6px;">Priority</span>' : ''}
              </p>
              <p style="margin:0;font-size:12.5px;color:var(--text-secondary);line-height:1.45;">
                Your number is saved to your session. Please watch the monitor or this screen for updates.
              </p>
            </div>
          `;

          ticketResult.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          showToast(`Queue Ticket ${ticket.ticket_number} created!`, 'success');

          // Reset inputs
          walkInPurpose.value = '';
          walkInPriority.value = 'no';
          document.getElementById('walkInPriorityGroup').style.display = 'none';
          walkInPriorityType.value = '';

          await refreshStudentTicket();
        } catch (err) {
          showToast(err.message || 'Could not create ticket.', 'error');
        } finally {
          joinButton.disabled = false;
        }
      });

      // ── ACTIVE TICKET REFRESH ──
      let previouslyCalled = false;
      const refreshStudentTicket = async () => {
        if (!state.user || !document.getElementById('studentQueueActive')) {
          if (window._studentQueueInterval) {
            clearInterval(window._studentQueueInterval);
            window._studentQueueInterval = null;
          }
          return;
        }
        try {
          let ticket = null;
          try {
            ticket = await api('/api/queueing/my-tickets/active/current');
          } catch (_) {}

          // Fallback to localStorage if guest session or network hiccup
          if (!ticket) {
            try {
              const cached = localStorage.getItem('pupsj_active_ticket');
              if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed && parsed.queue_date === localToday && ['waiting', 'called', 'serving'].includes(parsed.status)) {
                  ticket = parsed;
                }
              }
            } catch (_) {}
          }

          const statusEl = document.getElementById('studentQueueActive');
          if (!statusEl) return;

          if (!ticket) {
            statusEl.innerHTML = '';
            return;
          }

          const isCalled = ticket.status === 'called';
          const isServing = ticket.status === 'serving';
          const canCancel = ['waiting', 'called'].includes(ticket.status);

          statusEl.innerHTML = `
            <div class="active-ticket-card ${isCalled ? 'called' : ''}">
              <div class="active-ticket-top">
                <div>
                  <span class="active-ticket-badge ${ticket.status}">
                    <i class="fas ${isCalled ? 'fa-bullhorn' : isServing ? 'fa-user-check' : 'fa-hourglass-half'}"></i>
                    ${isCalled ? 'NOW CALLED · PROCEED TO COUNTER' : isServing ? 'NOW SERVING · IN PROGRESS' : 'WAITING IN QUEUE'}
                  </span>
                  <h3 class="active-ticket-num">${escHtml(ticket.ticket_number)}</h3>
                  <p class="active-ticket-office">
                    <i class="fas fa-building" style="color:var(--primary);"></i>
                    <strong>${escHtml(ticket.office_name || 'Campus Office')}</strong>
                    ${ticket.service_name ? ` · <span>${escHtml(ticket.service_name)}</span>` : ''}
                    ${ticket.is_priority ? '<span class="badge badge-warning" style="font-size:10px;padding:2px 6px;">Priority</span>' : ''}
                  </p>
                </div>
                ${canCancel ? `<button type="button" class="btn btn-secondary queue-cancel-ticket" data-id="${ticket.id}" style="width:auto!important;padding:6px 12px!important;font-size:12px!important;"><i class="fas fa-times"></i> Cancel Ticket</button>` : ''}
              </div>
              <div class="active-ticket-msg">
                ${isCalled
                  ? '<strong style="color:#dc2626;font-size:14px;"><i class="fas fa-bullhorn"></i> Your number has been called! Please proceed to the office counter now.</strong>'
                  : isServing
                  ? '<span style="color:#166534;font-weight:600;"><i class="fas fa-user-check"></i> Your transaction is currently being processed at the office counter.</span>'
                  : '<span><i class="fas fa-info-circle"></i> You are currently waiting in queue. The office monitor will alert you when it is your turn.</span>'}
              </div>
            </div>
          `;

          statusEl.querySelector('.queue-cancel-ticket')?.addEventListener('click', async (event) => {
            const btn = event.currentTarget;
            if (!window.confirm('Cancel this queue ticket? The office will no longer call this number.')) return;
            btn.disabled = true;
            try {
              await api(`/api/queueing/my-tickets/${btn.dataset.id}/cancel`, { method: 'POST' });
              showToast('Your queue ticket has been cancelled.', 'success');
              try {
                localStorage.removeItem('pupsj_active_ticket');
                localStorage.removeItem('activeQueueTicket');
              } catch (_) {}
              previouslyCalled = false;
              ticketResult.innerHTML = '';
              await refreshStudentTicket();
            } catch (err) {
              showToast(err.message || 'Unable to cancel ticket.', 'error');
              btn.disabled = false;
            }
          });

          if (isCalled && !previouslyCalled) {
            showToast(`Your ticket ${ticket.ticket_number} has been called! Please proceed to the office.`, 'success');
            previouslyCalled = true;
          }
        } catch (_) {}
      };

      // ── APPOINTMENT LOGIC & TIME SLOTS ──
      const apptOffice = document.getElementById('apptOffice');
      const apptPurpose = document.getElementById('apptPurpose');
      const apptPriority = document.getElementById('apptPriority');
      const apptPriorityType = document.getElementById('apptPriorityType');
      const appointmentDate = document.getElementById('queueAppointmentDate');
      const appointmentTime = document.getElementById('queueAppointmentTime');
      const appointmentButton = document.getElementById('queueBookAppointment');
      const appointmentNote = document.getElementById('queueBookingNote');
      const bookingAlert = document.getElementById('appointmentBookingAlert');
      const appointmentList = document.getElementById('appointmentListContainer');

      let officeUnavailableDates = new Set();
      const loadAppointmentSlots = async () => {
        const officeId = apptOffice.value;
        const dateVal = appointmentDate.value;
        appointmentButton.disabled = true;
        appointmentTime.disabled = true;

        if (!officeId || !dateVal) {
          appointmentTime.innerHTML = '<option value="">Choose office and date first</option>';
          appointmentNote.textContent = 'Select an office and a future date to see available time slots.';
          return;
        }

        // Sunday check
        const dateInfo = formatLocalDate(dateVal);
        if (dateInfo.dayOfWeek === 0) {
          appointmentTime.innerHTML = '<option value="">Offices closed on Sundays</option>';
          appointmentNote.innerHTML = '<span style="color:#dc2626;font-weight:600;"><i class="fas fa-exclamation-circle"></i> Offices are closed on Sundays. Please choose Monday through Saturday.</span>';
          return;
        }

        // Check if office marked this date as unavailable / closed
        if (officeUnavailableDates.has(dateVal)) {
          appointmentTime.innerHTML = '<option value="">Office unavailable on this date</option>';
          appointmentNote.innerHTML = '<span style="color:#dc2626;font-weight:700;"><i class="fas fa-ban"></i> The office/admin is unavailable for appointments on this date. Please choose another date.</span>';
          return;
        }

        appointmentNote.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking available time slots...';

        try {
          const data = await api(`/api/queueing/offices/${officeId}/availability?date=${encodeURIComponent(dateVal)}`);
          if (data.is_unavailable || (data.slots && !data.slots.length && data.message && data.message.toLowerCase().includes('closed'))) {
            appointmentTime.innerHTML = '<option value="">Office unavailable on this date</option>';
            appointmentTime.disabled = true;
            appointmentNote.innerHTML = `<span style="color:#dc2626;font-weight:700;"><i class="fas fa-ban"></i> ${escHtml(data.message || 'The office/admin is unavailable for appointments on this date. Please choose another date.')}</span>`;
            return;
          }
          if (data.slots && data.slots.length) {
            appointmentTime.innerHTML = `<option value="">Select a time slot</option>${data.slots.map(t => `<option value="${t}">${t}</option>`).join('')}`;
            appointmentTime.disabled = false;
            appointmentNote.innerHTML = `<span style="color:#16a34a;font-weight:600;"><i class="fas fa-clock"></i> ${data.slots.length} time slot(s) available</span>`;
          } else {
            appointmentTime.innerHTML = '<option value="">No available time slots</option>';
            appointmentTime.disabled = true;
            appointmentNote.textContent = data.message || 'No appointment slots are available on this date.';
          }
        } catch (err) {
          appointmentTime.innerHTML = '<option value="">Unable to load time slots</option>';
          appointmentTime.disabled = true;
          appointmentNote.textContent = err.message || 'Could not load appointment slots.';
        }
      };

      const updateOfficeClosures = async () => {
        const officeId = apptOffice.value;
        officeUnavailableDates = new Set();
        if (officeId) {
          try {
            const closures = await api(`/api/queueing/offices/${officeId}/closures`);
            if (Array.isArray(closures)) {
              closures.forEach(d => officeUnavailableDates.add(d));
            }
          } catch (_) {}
        }
        await loadAppointmentSlots();
      };

      apptOffice.addEventListener('change', updateOfficeClosures);
      appointmentDate.addEventListener('change', loadAppointmentSlots);
      appointmentTime.addEventListener('change', () => {
        appointmentButton.disabled = !appointmentTime.value;
      });

      // Book appointment click
      appointmentButton.addEventListener('click', async () => {
        const officeId = apptOffice.value;
        const officeName = apptOffice.options[apptOffice.selectedIndex]?.text || 'Office';
        const dateVal = appointmentDate.value;
        const timeVal = appointmentTime.value;

        if (!officeId) { showToast('Please select an office.', 'error'); return; }
        if (!dateVal) { showToast('Please select an appointment date.', 'error'); return; }
        if (!timeVal) { showToast('Please select an available time slot.', 'error'); return; }

        const isGuest = state.user?.role === 'guest';
        const guestNameInput = document.getElementById('guestApptName');
        const guestContactInput = document.getElementById('guestApptContact');

        let visitorName = undefined;
        let contactNumber = undefined;

        if (isGuest) {
          visitorName = guestNameInput ? guestNameInput.value.trim() : '';
          contactNumber = guestContactInput ? guestContactInput.value.trim() : '';

          if (!visitorName) {
            showToast('Please enter your full name for the appointment.', 'error');
            if (guestNameInput) guestNameInput.focus();
            return;
          }
          if (!contactNumber) {
            showToast('Please enter your contact number for the appointment.', 'error');
            if (guestContactInput) guestContactInput.focus();
            return;
          }
          const cleanPhone = contactNumber.replace(/[\s\-\(\)]/g, '');
          if (!/^(\+?63|0)?[0-9]{7,12}$/.test(cleanPhone)) {
            showToast('Please enter a valid mobile number (e.g. 09123456789).', 'error');
            if (guestContactInput) guestContactInput.focus();
            return;
          }
        }

        const isPriority = apptPriority.value === 'yes';
        const priorityTypeVal = apptPriorityType.value.trim();
        if (isPriority && !priorityTypeVal) {
          showToast('Please specify your priority group.', 'error');
          return;
        }

        appointmentButton.disabled = true;
        try {
          const appointment = await api('/api/queueing/appointments', {
            method: 'POST',
            body: JSON.stringify({
              office_id: officeId,
              date: dateVal,
              time: timeVal,
              service_name: apptPurpose.value.trim(),
              is_priority: isPriority,
              priority_type: isPriority ? priorityTypeVal : undefined,
              visitor_name: visitorName,
              contact_number: contactNumber
            })
          });

          const formattedInfo = formatLocalDate(dateVal);

          bookingAlert.innerHTML = `
            <div class="appointment-success-card">
              <i class="fas fa-calendar-check"></i>
              <div>
                <h4>Appointment Successfully Booked!</h4>
                <p><strong>${escHtml(formattedInfo.full)} at ${escHtml(timeVal)}</strong> · ${escHtml(officeName)}</p>
                ${visitorName ? `<p style="font-size:12px;color:var(--text-secondary);margin:2px 0 0;"><strong>Visitor:</strong> ${escHtml(visitorName)} (${escHtml(contactNumber)})</p>` : ''}
                <span>Please arrive on time. On your appointment day, return to this tab and click "Check In" to receive your priority queue number.</span>
              </div>
            </div>
          `;

          bookingAlert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          showToast('Appointment booked successfully.', 'success');

          // Reset appointment inputs
          appointmentDate.value = '';
          appointmentTime.innerHTML = '<option value="">Choose office and date first</option>';
          appointmentTime.disabled = true;
          apptPurpose.value = '';
          if (guestNameInput) guestNameInput.value = '';
          if (guestContactInput) guestContactInput.value = '';
          apptPriority.value = 'no';
          document.getElementById('apptPriorityGroup').style.display = 'none';
          apptPriorityType.value = '';
          appointmentNote.textContent = '15-minute slot intervals';

          await refreshAppointments();
        } catch (err) {
          showToast(err.message || 'Could not book appointment.', 'error');
          appointmentButton.disabled = false;
        }
      });

      // ── REFRESH APPOINTMENTS LIST ──
      const refreshAppointments = async () => {
        try {
          const appointments = await api('/api/queueing/my-appointments');
          if (!appointments || !appointments.length) {
            appointmentList.innerHTML = `
              <div style="padding:24px 0 10px;text-align:center;color:var(--text-secondary);">
                <i class="fas fa-calendar-xmark" style="font-size:28px;margin-bottom:8px;opacity:.4;"></i>
                <p style="margin:0;font-size:13px;">There are no appointments yet.</p>
              </div>
            `;
            return;
          }

          appointmentList.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
              <p class="queue-overline" style="margin:0;">Your Appointments</p>
              <span class="badge" style="background:var(--primary-soft);color:var(--primary);font-size:11px;">${appointments.length} booked</span>
            </div>
            <div class="queue-appointments-list">
              ${appointments.map(item => {
                const dateInfo = formatLocalDate(item.date);
                const isToday = item.date === localToday;
                const isCheckedIn = item.status === 'checked_in';

                return `
                  <article class="queue-appointment-card">
                    <div class="queue-appt-left">
                      <div class="queue-appt-date-box">
                        <span class="month">${escHtml(dateInfo.month || 'DAY')}</span>
                        <span class="day">${escHtml(dateInfo.day || '')}</span>
                      </div>
                      <div class="queue-appt-details">
                        <h4>${escHtml(item.office_name)}</h4>
                        <div class="queue-appt-meta">
                          <span><i class="fas fa-clock" style="color:var(--primary);"></i> ${escHtml(formatTime(item.time))}</span>
                          <span>·</span>
                          <span>${escHtml(dateInfo.full)}</span>
                          ${item.service_name ? `<span>·</span><span>${escHtml(item.service_name)}</span>` : ''}
                          ${item.visitor_name ? `<span>·</span><span title="Visitor"><i class="fas fa-user"></i> ${escHtml(item.visitor_name)}</span>` : ''}
                          ${item.contact_number ? `<span>·</span><span title="Contact"><i class="fas fa-phone-alt"></i> ${escHtml(item.contact_number)}</span>` : ''}
                          ${item.is_priority ? '<span class="badge badge-warning" style="font-size:10px;padding:2px 6px;">Priority</span>' : ''}
                        </div>
                      </div>
                    </div>
                    <div class="queue-appt-actions" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
                      ${isCheckedIn
                        ? '<span class="badge" style="background:rgba(46,204,113,.15);color:#2ecc71;font-weight:700;"><i class="fas fa-check"></i> Checked in</span>'
                        : isToday
                        ? `<button class="btn btn-primary queue-check-in-btn" data-id="${item.id}" style="padding:7px 12px!important;font-size:12px!important;"><i class="fas fa-sign-in-alt"></i> Check In</button>`
                        : '<span class="badge" style="background:var(--primary-soft);color:var(--primary);font-size:11px;padding:4px 8px;">Upcoming</span>'}
                      ${!isCheckedIn ? `
                        <button class="btn btn-secondary queue-cancel-appt-btn" data-id="${item.id}" data-office="${escHtml(item.office_name)}" data-date="${escHtml(dateInfo.full)}" data-time="${escHtml(formatTime(item.time))}" style="padding:7px 10px!important;font-size:12px!important;color:#dc2626!important;border-color:rgba(220,38,38,0.35)!important;" title="Cancel this appointment">
                          <i class="fas fa-times"></i> Cancel
                        </button>` : ''}
                    </div>
                  </article>
                `;
              }).join('')}
            </div>
          `;

          appointmentList.querySelectorAll('.queue-check-in-btn').forEach(btn => {
            btn.onclick = async () => {
              btn.disabled = true;
              try {
                const ticket = await api(`/api/queueing/appointments/${btn.dataset.id}/check-in`, { method: 'POST' });
                showToast(`Checked in successfully! Your ticket number is ${ticket.ticket_number}.`, 'success');
                try {
                  localStorage.setItem('pupsj_active_ticket', JSON.stringify(ticket));
                  localStorage.setItem('activeQueueTicket', ticket.id);
                } catch (_) {}
                await refreshAppointments();
                await refreshStudentTicket();
                setTab('walk_in');
              } catch (err) {
                btn.disabled = false;
                showToast(err.message || 'Unable to check in.', 'error');
              }
            };
          });

          appointmentList.querySelectorAll('.queue-cancel-appt-btn').forEach(btn => {
            btn.onclick = async () => {
              const officeName = btn.dataset.office || 'this office';
              const dateStr = btn.dataset.date || '';
              const timeStr = btn.dataset.time || '';
              if (!window.confirm(`Cancel your appointment for ${officeName} on ${dateStr} at ${timeStr}?`)) return;
              btn.disabled = true;
              try {
                await api(`/api/queueing/my-appointments/${btn.dataset.id}/cancel`, { method: 'POST' });
                showToast('Appointment cancelled successfully.', 'success');
                await refreshAppointments();
                await refreshStudentTicket();
              } catch (err) {
                showToast(err.message || 'Unable to cancel appointment.', 'error');
                btn.disabled = false;
              }
            };
          });
        } catch (_) {}
      };

      // Initial loads
      await refreshStudentTicket();
      await refreshAppointments();

      // Clear any existing polling interval before starting a clean one
      if (window._studentQueueInterval) clearInterval(window._studentQueueInterval);
      window._studentQueueInterval = setInterval(refreshStudentTicket, 3000);

    } catch (err) {
      pageArea.innerHTML = `<div class="page-content"><div class="empty-state"><p>${escHtml(err.message)}</p></div></div>`;
    }
  }

  async function renderQueueing() {
    const pageArea = document.getElementById('pageArea');
    pageArea.innerHTML = `<div class="page-header"><h1 class="page-title">Office Queueing</h1><p class="page-subtitle">Manage walk-in tickets for your assigned office.</p></div><div class="page-content"><div class="loader"><div class="spinner"></div></div></div>`;
    try {
      const superadmin = state.user.role === 'superadmin';
      const offices = await api('/api/queueing/manage/offices');
      const admins = superadmin ? await api('/api/queueing/manage/admins') : [];
      pageArea.innerHTML = `<div class="page-header"><p style="margin:0 0 5px;color:var(--primary);font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;">Queue operations</p><h1 class="page-title">Office Queueing</h1><p class="page-subtitle">Choose an office, then manage its live queue and scheduled visitors.</p></div><div class="page-content" style="display:grid;gap:18px;">
        ${superadmin ? `<section class="card" style="padding:22px 24px;"><div style="display:flex;align-items:flex-start;gap:12px;"><span style="width:38px;height:38px;display:grid;place-items:center;flex:0 0 38px;border-radius:10px;background:#fff0f0;color:#880808;"><i class="fas fa-plus"></i></span><div><p style="margin:0 0 3px;color:#880808;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;">Administration</p><h3 style="margin:0;color:var(--text-primary);font-size:18px;">Add an office</h3><p style="margin:4px 0 0;color:var(--text-secondary);font-size:12px;">Create an office and optionally assign its queue manager.</p></div></div><div style="display:grid;grid-template-columns:minmax(180px,1fr) minmax(180px,1fr) auto;gap:10px;margin-top:18px;"><input id="queueOfficeName" class="form-input" placeholder="Office name, e.g. OSAS"><select id="queueOfficeAdmin" class="form-input form-select"><option value="">Assign later</option>${admins.map(a=>`<option value="${a.id}">${escHtml(a.first_name)}${a.department?' · '+escHtml(a.department):''}</option>`).join('')}</select><button id="queueAddOffice" class="btn btn-primary">Add office</button></div></section>` : ''}
        <section class="card" style="padding:22px 24px;"><div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;"><div><p style="margin:0 0 3px;color:#880808;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;">Step 1</p><h3 style="margin:0;color:var(--text-primary);font-size:18px;">${superadmin ? 'Choose an office to manage' : 'Your assigned offices'}</h3><p style="margin:4px 0 0;color:var(--text-secondary);font-size:12px;">Select an office to open its queue workspace.</p></div><span style="width:38px;height:38px;display:grid;place-items:center;border-radius:10px;background:#fff0f0;color:#880808;"><i class="fas fa-building"></i></span></div><div id="queueOfficeButtons" style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px;">${offices.map(o=>`<div style="display:flex;align-items:stretch;"><button class="btn btn-secondary queue-office-btn" data-id="${o.id}" data-code="${escHtml(o.code)}" data-name="${escHtml(o.name)}" style="border-radius:9px 0 0 9px;"><i class="fas fa-building"></i> ${escHtml(o.name)}</button>${superadmin?`<button class="queue-office-delete" data-id="${o.id}" data-name="${escHtml(o.name)}" title="Delete ${escHtml(o.name)}" aria-label="Delete ${escHtml(o.name)}" style="width:35px;border:1px solid #ecd4d4;border-left:0;border-radius:0 9px 9px 0;background:#fff7f7;color:#9d1616;cursor:pointer;"><i class="fas fa-trash"></i></button>`:''}</div>`).join('') || '<p style="margin:0;color:var(--text-secondary);font-size:13px;">No office is assigned to this account.</p>'}</div></section>
        <section class="card" id="queuePanel" style="padding:24px;"><div style="display:flex;gap:12px;align-items:center;color:var(--text-secondary);"><i class="fas fa-arrow-up-right-dots" style="color:var(--primary);"></i><span>Select an office above to open its live queue workspace.</span></div></section></div>`;
      if (superadmin) document.getElementById('queueAddOffice').onclick = async () => { const name=document.getElementById('queueOfficeName').value.trim(); if(!name)return; await api('/api/queueing/manage/offices',{method:'POST',body:JSON.stringify({name,manager_user_id:document.getElementById('queueOfficeAdmin').value||null})}); renderQueueing(); };
      document.querySelectorAll('.queue-office-btn').forEach(btn => {
        btn.onclick = () => {
          document.querySelectorAll('.queue-office-btn').forEach(b => {
            b.classList.remove('btn-primary', 'is-active');
            b.classList.add('btn-secondary');
            const badge = b.querySelector('.active-office-badge');
            if (badge) badge.remove();
          });
          btn.classList.remove('btn-secondary');
          btn.classList.add('btn-primary', 'is-active');
          if (!btn.querySelector('.active-office-badge')) {
            const badge = document.createElement('span');
            badge.className = 'active-office-badge';
            badge.style.cssText = 'background:#16a34a;color:#fff;font-size:9.5px;font-weight:800;padding:2px 6px;border-radius:10px;margin-left:6px;';
            badge.textContent = 'Active';
            btn.appendChild(badge);
          }
          loadQueueOffice(btn.dataset.id, btn.dataset.code, btn.dataset.name);
        };
      });
      document.querySelectorAll('.queue-office-delete').forEach(button => button.onclick = async () => { const name=button.dataset.name; if (!window.confirm(`Delete ${name}? This permanently removes its queue tickets and appointments.`)) return; button.disabled=true; try { await api(`/api/queueing/manage/offices/${button.dataset.id}`,{method:'DELETE'}); showToast(`${name} was deleted.`,'success'); renderQueueing(); } catch (err) { showToast(err.message || 'Unable to delete the office.','error'); button.disabled=false; } });
    } catch (err) { pageArea.innerHTML = `<div class="page-content"><div class="empty-state"><p>${escHtml(err.message)}</p></div></div>`; }
  }
  async function loadQueueOffice(officeId, code, officeName) {
    const panel = document.getElementById('queuePanel'); panel.innerHTML = '<div class="loader"><div class="spinner"></div></div>';
    try {
      if (!officeName) {
        const btn = document.querySelector(`.queue-office-btn[data-id="${officeId}"]`);
        officeName = btn ? btn.dataset.name : code;
      }
      // Keep office button highlighted
      document.querySelectorAll('.queue-office-btn').forEach(b => {
        if (b.dataset.id === officeId) {
          b.classList.remove('btn-secondary');
          b.classList.add('btn-primary', 'is-active');
          if (!b.querySelector('.active-office-badge')) {
            const badge = document.createElement('span');
            badge.className = 'active-office-badge';
            badge.style.cssText = 'background:#16a34a;color:#fff;font-size:9.5px;font-weight:800;padding:2px 6px;border-radius:10px;margin-left:6px;';
            badge.textContent = 'Active';
            b.appendChild(badge);
          }
        } else {
          b.classList.remove('btn-primary', 'is-active');
          b.classList.add('btn-secondary');
          const badge = b.querySelector('.active-office-badge');
          if (badge) badge.remove();
        }
      });

      const [tickets, appointments, closures] = await Promise.all([
        api(`/api/queueing/manage/offices/${officeId}/tickets`),
        api(`/api/queueing/manage/offices/${officeId}/appointments`),
        api(`/api/queueing/manage/offices/${officeId}/schedule-closures`).catch(() => [])
      ]);
      const closedDates = new Set(Array.isArray(closures) ? closures : []);
      const queueStatus = {
        waiting: { icon: 'fa-hourglass-half', label: 'Waiting', color: '#9a6700', bg: '#fff8db' },
        called: { icon: 'fa-bullhorn', label: 'Called', color: '#a10909', bg: '#fff0f0' },
        serving: { icon: 'fa-user-check', label: 'In progress', color: '#166534', bg: '#dcfce7' },
        skipped: { icon: 'fa-forward', label: 'Skipped', color: '#64748b', bg: '#f1f5f9' },
      };
      const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

      function formatTime(timeStr) {
        if (!timeStr) return '';
        const [hStr, mStr] = timeStr.split(':');
        const h = parseInt(hStr, 10);
        if (isNaN(h)) return timeStr;
        const ampm = h >= 12 ? 'PM' : 'AM';
        const hour12 = h % 12 || 12;
        return `${hour12}:${mStr || '00'} ${ampm}`;
      }

      function formatApptDate(dateStr, timeStr) {
        if (!dateStr) return '';
        const parts = dateStr.split('-');
        if (parts.length === 3) {
          const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
          const datePart = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
          return `${datePart} · ${formatTime(timeStr)}`;
        }
        return `${dateStr} · ${formatTime(timeStr)}`;
      }

      const todayAppts = appointments.filter(a => a.date === localDate);
      const upcomingAppts = appointments.filter(a => a.date > localDate);
      const pastAppts = appointments.filter(a => a.date < localDate);

      panel.innerHTML = `
        <!-- ACTIVE OFFICE LOCATION & STATUS INDICATOR -->
        <div class="queue-active-office-banner" style="background:linear-gradient(135deg, rgba(136,8,8,0.06) 0%, rgba(136,8,8,0.01) 100%);border:1.5px solid rgba(136,8,8,0.22);border-radius:12px;padding:14px 18px;margin-bottom:18px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="width:40px;height:40px;border-radius:10px;background:var(--primary,#880808);color:#fff;display:grid;place-items:center;font-size:17px;flex-shrink:0;box-shadow:0 2px 6px rgba(136,8,8,0.2);">
              <i class="fas fa-building"></i>
            </div>
            <div>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--primary,#880808);background:rgba(136,8,8,0.09);padding:2px 7px;border-radius:4px;">Currently Open Office</span>
                <span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:#16a34a;background:#dcfce7;padding:2px 8px;border-radius:10px;">
                  <span style="width:6px;height:6px;border-radius:50%;background:#16a34a;display:inline-block;"></span> Active Workspace
                </span>
              </div>
              <h2 style="margin:3px 0 0;font-size:18px;font-weight:800;color:var(--text-primary);">${escHtml(officeName || code)} <span style="font-size:13px;font-weight:600;color:var(--text-secondary);opacity:.85;">(${escHtml(code)})</span></h2>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <span style="font-size:12px;color:var(--text-secondary);"><i class="fas fa-users" style="color:var(--primary);margin-right:4px;"></i> <strong>${tickets.length}</strong> active in queue</span>
            <span style="color:var(--border-light);">|</span>
            <span style="font-size:12px;color:var(--text-secondary);"><i class="fas fa-calendar-check" style="color:#0284c7;margin-right:4px;"></i> <strong>${appointments.length}</strong> scheduled</span>
          </div>
        </div>

        <div class="queue-panel-head" style="display:flex;justify-content:space-between;align-items:center;gap:16px;padding-bottom:16px;border-bottom:1px solid var(--border-light);flex-wrap:wrap;">
          <div>
            <p class="queue-overline" style="margin:0 0 5px;color:var(--primary);font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;">Live queue workspace · ${escHtml(code)}</p>
            <h3 style="margin:0;color:var(--text-primary);font-size:20px;font-weight:700;line-height:1.25;">Today’s Operations · ${escHtml(officeName || code)}</h3>
          </div>
          <div class="queue-primary-actions" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <button id="queueCallNext" class="btn btn-primary"><i class="fas fa-bullhorn"></i> Call next</button>
            <a class="btn btn-secondary" target="_blank" href="/queue-display/${encodeURIComponent(code)}"><i class="fas fa-tv"></i> Monitor controls</a>
          </div>
        </div>

        <div class="queue-admin-grid">
          <!-- COLUMN 1: Scheduled Appointments -->
          <div class="queue-admin-col">
            <div class="queue-admin-col-head">
              <h4 class="queue-admin-col-title">
                <i class="fas fa-calendar-check" style="color:var(--primary);"></i> Scheduled Appointments
              </h4>
              <span class="badge" style="background:#e0f2fe;color:#0369a1;font-weight:700;font-size:11px;">
                ${appointments.length} ${appointments.length === 1 ? 'appointment' : 'appointments'}
              </span>
            </div>

            <p style="margin:0 0 12px;font-size:12px;color:var(--text-secondary);line-height:1.45;">
              Upcoming reservations. When a scheduled student arrives, click <strong>Admit / Check In</strong> to place them directly into the live queue.
            </p>

            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
              <div class="queue-appt-filters" role="tablist" style="margin-bottom:0;">
                <button class="queue-appt-filter-btn ${todayAppts.length > 0 ? 'is-active' : ''}" data-filter="today" type="button">
                  Today <span class="queue-appt-filter-badge">${todayAppts.length}</span>
                </button>
                <button class="queue-appt-filter-btn ${todayAppts.length === 0 ? 'is-active' : ''}" data-filter="all" type="button">
                  All <span class="queue-appt-filter-badge">${appointments.length}</span>
                </button>
                <button class="queue-appt-filter-btn" data-filter="upcoming" type="button">
                  Upcoming <span class="queue-appt-filter-badge">${upcomingAppts.length}</span>
                </button>
              </div>
              <div style="position:relative;flex:1;min-width:140px;max-width:210px;">
                <input type="text" id="queueApptSearch" class="form-input" placeholder="Search name or service…" style="padding:5px 8px 5px 26px;font-size:11.5px;border-radius:8px;width:100%;box-sizing:border-box;">
                <i class="fas fa-search" style="position:absolute;left:8px;top:50%;transform:translateY(-50%);font-size:10px;color:var(--text-light);pointer-events:none;"></i>
              </div>
            </div>

            <div id="queueAppointmentsList" class="queue-appointments-list" style="display:flex;flex-direction:column;gap:7px;">
            </div>
          </div>

          <!-- COLUMN 2: Today's Live Queue -->
          <div class="queue-admin-col">
            <div class="queue-admin-col-head">
              <h4 class="queue-admin-col-title">
                <i class="fas fa-users-line" style="color:var(--primary);"></i> Today’s Live Queue
              </h4>
              <span class="badge" style="background:#fff0f0;color:#880808;font-weight:700;font-size:11px;">
                ${tickets.length} ${tickets.length === 1 ? 'ticket' : 'tickets'}
              </span>
            </div>

            <div class="queue-priority-note" style="display:flex;gap:8px;align-items:flex-start;margin:0 0 14px;padding:9px 12px;border-radius:8px;background:#fff8db;color:#765300;font-size:11.5px;line-height:1.4;">
              <i class="fas fa-circle-info" style="margin-top:2px;"></i>
              <span>Scheduled appointments are called first once their appointment time arrives. Walk-ins follow in arrival order.</span>
            </div>

            <div class="queue-list" style="margin-top:0;border:1px solid var(--border-light);border-radius:12px;overflow:hidden;">
              ${tickets.map(t => {
                const meta = queueStatus[t.status] || queueStatus.waiting;
                const isScheduled = t.source === 'appointment';
                const type = isScheduled ? 'Scheduled' : 'Walk-in';
                return `
                  <article class="queue-row queue-row--${escHtml(t.status)}" style="display:grid!important;grid-template-columns:130px minmax(130px,1fr) 95px auto!important;align-items:center!important;gap:14px!important;padding:14px 16px!important;">
                    <div class="queue-ticket" style="display:flex!important;flex-direction:column!important;gap:3px!important;">
                      <span style="display:inline-flex!important;align-items:center!important;gap:4px!important;font-size:10px!important;font-weight:800!important;text-transform:uppercase!important;letter-spacing:.06em!important;color:${isScheduled ? '#0284c7' : 'var(--text-light)'}!important;">
                        <i class="fas ${isScheduled ? 'fa-calendar-check' : 'fa-person-walking'}"></i> ${type}
                      </span>
                      <strong style="display:block!important;font-size:15px!important;color:var(--primary)!important;white-space:nowrap!important;">${escHtml(t.ticket_number)}</strong>
                    </div>
                    <div class="queue-purpose" style="display:flex!important;flex-direction:column!important;gap:3px!important;min-width:0!important;">
                      <strong style="display:block!important;font-size:13.5px!important;color:var(--text-primary)!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;">${escHtml(t.service_name || type)}</strong>
                      <span style="display:block!important;font-size:11.5px!important;color:var(--text-light)!important;">${t.status === 'waiting' ? 'Ready to call' : t.status === 'called' ? 'Called · Awaiting arrival' : 'Transaction in progress'}</span>
                    </div>
                    <span class="queue-status queue-status--${t.status}" style="display:inline-flex!important;align-items:center!important;gap:5px!important;width:max-content!important;padding:6px 9px!important;border-radius:999px!important;">
                      <i class="fas ${meta.icon}"></i>
                      <span style="font-size:11px!important;font-weight:800!important;line-height:1!important;">${meta.label}</span>
                    </span>
                    <div class="queue-row-actions" style="display:flex!important;align-items:center!important;justify-content:flex-end!important;gap:6px!important;">
                      ${t.status === 'called' ? `<button class="btn btn-secondary btn-sm queue-action" data-id="${t.id}" data-status="serving" style="padding:5px 9px;font-size:11px;"><i class="fas fa-user-check"></i> Start</button>` : ''}
                      ${['called', 'serving'].includes(t.status) ? `<button class="btn btn-success btn-sm queue-action" data-id="${t.id}" data-status="completed" style="padding:5px 9px;font-size:11px;"><i class="fas fa-check"></i> Done</button>` : ''}
                      <button class="btn btn-secondary btn-sm queue-action" data-id="${t.id}" data-status="skipped" style="padding:5px 8px;font-size:11px;">Skip</button>
                    </div>
                  </article>
                `;
              }).join('') || '<p class="queue-empty" style="margin:0;padding:28px 18px;color:var(--text-secondary);font-size:13px;text-align:center;">No tickets in queue right now.</p>'}
            </div>
          </div>
        </div>

        <!-- Office Availability & Unavailable Dates Card -->
        <div style="margin-top:20px;padding:18px 20px;border:1.5px solid var(--border-light);border-radius:12px;background:var(--bg-card);">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;">
            <div>
              <strong style="display:block;font-size:14px;color:var(--text-primary);"><i class="fas fa-calendar-xmark" style="color:var(--primary);margin-right:6px;"></i> Office Availability & Unavailable Dates (Blackout Dates)</strong>
              <span style="font-size:12px;color:var(--text-secondary);">Set dates when you or this office are unavailable (e.g. meetings, holidays, leave). Users will be blocked from booking appointments on these dates.</span>
            </div>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
              <input id="queueScheduleClosureDate" class="form-input" type="date" min="${localDate}" value="${localDate}" style="padding:6px 10px;font-size:13px;width:auto;">
              <div id="queueScheduleActionSlot" style="display:inline-flex;align-items:center;gap:8px;"></div>
            </div>
          </div>
          <div id="queueClosedDatesSection" style="margin-top:14px;padding-top:12px;border-top:1px dashed var(--border-light);display:none;">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
              <span style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.05em;"><i class="fas fa-ban" style="color:#ef4444;margin-right:4px;"></i> Currently Unavailable Dates:</span>
              <div id="queueClosedDatesChips" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"></div>
            </div>
          </div>
        </div>
      `;

      function renderApptCard(item) {
        const isToday = item.date === localDate;
        const isPast = item.date < localDate;
        const isCheckedIn = item.status === 'checked_in';
        const visitorName = item.visitor_name || `${item.first_name || ''} ${item.last_name || ''}`.trim() || 'Visitor';
        const isGuestAppt = item.role === 'guest' || !!item.visitor_name;
        const timeFormatted = formatTime(item.time);
        
        let datePart = item.date;
        const parts = item.date ? item.date.split('-') : [];
        if (parts.length === 3) {
          const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
          datePart = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
        }

        const dateChipClass = isToday 
          ? 'queue-date-highlight--today' 
          : isPast 
          ? 'queue-date-highlight--past' 
          : 'queue-date-highlight--upcoming';

        const dateChipContent = isToday
          ? `<i class="fas fa-star" style="color:#d97706;font-size:11px;"></i> <span class="highlight-label">TODAY</span> <span class="highlight-dot">·</span> <i class="fas fa-clock" style="font-size:10px;opacity:.75;"></i> <span>${timeFormatted}</span>`
          : `<i class="fas fa-calendar-day" style="font-size:11px;"></i> <span class="highlight-label">${escHtml(datePart)}</span> <span class="highlight-dot">·</span> <i class="fas fa-clock" style="font-size:10px;opacity:.75;"></i> <span>${timeFormatted}</span>`;

        return `
          <div class="queue-appt-card ${isToday ? 'queue-appt-card--today' : ''}" data-id="${item.id}">
            <!-- Top Row: Highlighted Date & Time + Status Badges -->
            <div class="queue-appt-card-top">
              <div class="queue-date-highlight ${dateChipClass}">
                ${dateChipContent}
              </div>
              <div class="queue-appt-tags">
                ${isGuestAppt ? `
                  <span class="badge" style="background:rgba(100,116,139,0.12);color:#475569;font-weight:700;font-size:10px;padding:2px 6px;border-radius:4px;">
                    <i class="fas fa-user-tag" style="font-size:9px;margin-right:3px;"></i>Guest
                  </span>` : ''}
                ${item.is_priority ? `
                  <span class="queue-priority-badge" title="Priority Visitor">
                    <i class="fas fa-bolt"></i> Priority${item.priority_type ? ' · ' + escHtml(item.priority_type) : ''}
                  </span>` : ''}
                ${isCheckedIn ? `
                  <span class="queue-inqueue-badge">
                    <i class="fas fa-check-circle"></i> In Queue · ${escHtml(item.ticket_number || 'Admitted')}
                  </span>` : ''}
              </div>
            </div>

            <!-- Bottom Row: Visitor Info on Left, Actions on Right -->
            <div class="queue-appt-card-main">
              <div class="queue-appt-visitor">
                <div class="queue-appt-name">
                  <i class="fas fa-user-circle" style="color:var(--text-light);font-size:13px;flex-shrink:0;"></i>
                  <span class="name-text" title="${escHtml(visitorName)}">${escHtml(visitorName)}</span>
                </div>
                <div class="queue-service-badge" title="Service / Purpose">
                  <i class="fas fa-tag" style="font-size:9.5px;opacity:.7;"></i>
                  <span>${escHtml(item.service_name || 'Consultation')}</span>
                </div>
                ${item.contact_number ? `
                <div class="queue-contact-badge" style="font-size:11px;color:var(--text-secondary);margin-top:2px;display:flex;align-items:center;gap:4px;" title="Contact Number">
                  <i class="fas fa-phone-alt" style="font-size:9.5px;color:var(--text-light);"></i>
                  <span>${escHtml(item.contact_number)}</span>
                </div>` : ''}
              </div>

              <div class="queue-appt-actions">
                ${isCheckedIn ? '' : `
                  <button class="btn btn-sm ${isToday ? 'btn-primary queue-admit-btn' : 'queue-admit-btn queue-admit-early-btn'}" data-id="${item.id}" data-name="${escHtml(visitorName)}">
                    <i class="fas fa-user-check"></i> ${isToday ? 'Admit / Check In' : 'Admit Early'}
                  </button>
                  <button class="queue-decline-btn" data-id="${item.id}" data-name="${escHtml(visitorName)}" title="Decline appointment">
                    <i class="fas fa-ban"></i> Decline
                  </button>
                `}
                <button class="queue-delete-appt-btn" data-id="${item.id}" data-name="${escHtml(visitorName)}" title="Permanently delete appointment record">
                  <i class="fas fa-trash-alt"></i>
                </button>
              </div>
            </div>
          </div>
        `;
      }

      function bindApptEvents() {
        // Wire Admit / Check In buttons
        panel.querySelectorAll('.queue-admit-btn').forEach(btn => {
          btn.onclick = async () => {
            btn.disabled = true;
            try {
              const res = await api(`/api/queueing/manage/appointments/${btn.dataset.id}/check-in`, { method: 'POST' });
              showToast(res.ticket ? `Checked in! Ticket ${res.ticket.ticket_number} placed in live queue.` : 'Admitted to queue.', 'success');
              await loadQueueOffice(officeId, code);
            } catch (err) {
              showToast(err.message || 'Unable to admit appointment to queue.', 'error');
              btn.disabled = false;
            }
          };
        });

        // Wire Decline buttons
        panel.querySelectorAll('.queue-decline-btn').forEach(btn => {
          btn.onclick = async () => {
            const name = btn.dataset.name || 'this appointment';
            if (!window.confirm(`Decline appointment for ${name}? The appointment will be cancelled and the student notified.`)) return;
            btn.disabled = true;
            try {
              await api(`/api/queueing/manage/appointments/${btn.dataset.id}/decline`, { method: 'POST' });
              showToast(`Appointment for ${name} declined.`, 'success');
              await loadQueueOffice(officeId, code);
            } catch (err) {
              showToast(err.message || 'Unable to decline appointment.', 'error');
              btn.disabled = false;
            }
          };
        });

        // Wire Delete buttons
        panel.querySelectorAll('.queue-delete-appt-btn').forEach(btn => {
          btn.onclick = async () => {
            const name = btn.dataset.name || 'this appointment';
            if (!window.confirm(`Permanently delete appointment record for ${name}? This action cannot be undone.`)) return;
            btn.disabled = true;
            try {
              await api(`/api/queueing/manage/appointments/${btn.dataset.id}`, { method: 'DELETE' });
              showToast(`Appointment for ${name} deleted.`, 'success');
              await loadQueueOffice(officeId, code);
            } catch (err) {
              showToast(err.message || 'Unable to delete appointment.', 'error');
              btn.disabled = false;
            }
          };
        });
      }

      let currentApptFilter = todayAppts.length > 0 ? 'today' : 'all';
      let currentApptSearch = '';

      function renderApptList() {
        const listEl = panel.querySelector('#queueAppointmentsList');
        if (!listEl) return;
        if (appointments.length === 0) {
          listEl.innerHTML = `
            <div class="empty-state" style="padding:28px 14px;text-align:center;border:1px dashed var(--border-light);border-radius:10px;">
              <i class="fas fa-calendar-xmark" style="font-size:24px;opacity:.35;margin-bottom:6px;color:var(--text-secondary);"></i>
              <p style="margin:0;font-size:13px;color:var(--text-secondary);">There are no appointments yet.</p>
            </div>
          `;
          return;
        }

        let filtered = appointments;
        if (currentApptFilter === 'today') {
          filtered = todayAppts;
        } else if (currentApptFilter === 'upcoming') {
          filtered = upcomingAppts;
        }

        if (currentApptSearch) {
          const q = currentApptSearch.toLowerCase();
          filtered = filtered.filter(a => {
            const name = `${a.first_name || ''} ${a.last_name || ''}`.toLowerCase();
            const svc = (a.service_name || '').toLowerCase();
            const date = (a.date || '').toLowerCase();
            return name.includes(q) || svc.includes(q) || date.includes(q);
          });
        }

        if (filtered.length === 0) {
          let emptyMsg = 'No appointments found.';
          if (currentApptSearch) {
            emptyMsg = `No appointments matching "${escHtml(currentApptSearch)}".`;
          } else if (currentApptFilter === 'today') {
            emptyMsg = 'No appointments scheduled for today.';
          } else if (currentApptFilter === 'upcoming') {
            emptyMsg = 'No upcoming appointments scheduled.';
          }
          listEl.innerHTML = `
            <div class="empty-state" style="padding:24px 14px;text-align:center;border:1px dashed var(--border-light);border-radius:10px;">
              <i class="fas fa-search" style="font-size:20px;opacity:.35;margin-bottom:6px;color:var(--text-secondary);"></i>
              <p style="margin:0;font-size:12.5px;color:var(--text-secondary);">${emptyMsg}</p>
            </div>
          `;
          return;
        }

        let html = '';
        if (currentApptFilter === 'all' && !currentApptSearch) {
          const fToday = filtered.filter(a => a.date === localDate);
          const fUpcoming = filtered.filter(a => a.date > localDate);
          const fPast = filtered.filter(a => a.date < localDate);
          if (fToday.length > 0) {
            html += `<div class="queue-appt-section-divider"><i class="fas fa-calendar-day" style="color:#d97706;"></i> Today’s Schedule (${fToday.length})</div>`;
            html += fToday.map(renderApptCard).join('');
          }
          if (fUpcoming.length > 0) {
            html += `<div class="queue-appt-section-divider"><i class="fas fa-calendar-week" style="color:#0284c7;"></i> Upcoming Schedule (${fUpcoming.length})</div>`;
            html += fUpcoming.map(renderApptCard).join('');
          }
          if (fPast.length > 0) {
            html += `<div class="queue-appt-section-divider"><i class="fas fa-clock-rotate-left"></i> Past (${fPast.length})</div>`;
            html += fPast.map(renderApptCard).join('');
          }
        } else {
          html = filtered.map(renderApptCard).join('');
        }
        listEl.innerHTML = html;
        bindApptEvents();
      }

      // Initial render of appointments
      renderApptList();

      // Wire Filter tabs
      panel.querySelectorAll('.queue-appt-filter-btn').forEach(btn => {
        btn.onclick = () => {
          panel.querySelectorAll('.queue-appt-filter-btn').forEach(b => b.classList.remove('is-active'));
          btn.classList.add('is-active');
          currentApptFilter = btn.dataset.filter;
          renderApptList();
        };
      });

      // Wire Search box
      const searchInput = panel.querySelector('#queueApptSearch');
      if (searchInput) {
        searchInput.oninput = (e) => {
          currentApptSearch = e.target.value.trim();
          renderApptList();
        };
      }

      // Wire Schedule Closures / Reopen
      function updateClosureUI() {
        const input = panel.querySelector('#queueScheduleClosureDate');
        if (!input) return;
        const selectedDate = input.value || localDate;
        const isClosed = closedDates.has(selectedDate);
        const actionSlot = panel.querySelector('#queueScheduleActionSlot');
        const closedDatesSection = panel.querySelector('#queueClosedDatesSection');
        const closedDatesChips = panel.querySelector('#queueClosedDatesChips');

        if (actionSlot) {
          if (isClosed) {
            actionSlot.innerHTML = `
              <span class="badge" style="background:rgba(239,68,68,0.12);color:#dc2626;border:1px solid rgba(239,68,68,0.25);padding:6px 11px;font-size:11px;font-weight:700;border-radius:6px;display:inline-flex;align-items:center;gap:5px;">
                <i class="fas fa-ban"></i> Unavailable / Blocked
              </span>
              <button id="queueToggleScheduleBtn" class="btn btn-primary" style="padding:7px 14px;font-size:12px;font-weight:600;background:#16a34a;border:none;display:inline-flex;align-items:center;gap:6px;">
                <i class="fas fa-check-circle"></i> Make Available / Unblock Date
              </button>
            `;
          } else {
            actionSlot.innerHTML = `
              <span class="badge" style="background:rgba(22,163,74,0.12);color:#16a34a;border:1px solid rgba(22,163,74,0.25);padding:6px 11px;font-size:11px;font-weight:700;border-radius:6px;display:inline-flex;align-items:center;gap:5px;">
                <i class="fas fa-check-circle"></i> Available
              </span>
              <button id="queueToggleScheduleBtn" class="btn btn-secondary" style="padding:7px 14px;font-size:12px;font-weight:600;color:#dc2626;border-color:rgba(239,68,68,0.35);display:inline-flex;align-items:center;gap:6px;">
                <i class="fas fa-ban"></i> Mark as Unavailable / Block Date
              </button>
            `;
          }

          const toggleBtn = panel.querySelector('#queueToggleScheduleBtn');
          if (toggleBtn) {
            toggleBtn.onclick = async () => {
              const curDate = input.value;
              if (!curDate) return;
              if (isClosed) {
                if (!window.confirm(`Mark ${curDate} as available for appointments again? Users will be able to book appointments.`)) return;
                toggleBtn.disabled = true;
                try {
                  await api(`/api/queueing/manage/offices/${officeId}/schedule-closures/${curDate}`, { method: 'DELETE' });
                  closedDates.delete(curDate);
                  showToast(`Appointments are now available for ${curDate}.`, 'success');
                  updateClosureUI();
                } catch (err) {
                  showToast(err.message || 'Unable to unblock date.', 'error');
                  toggleBtn.disabled = false;
                }
              } else {
                if (!window.confirm(`Mark ${curDate} as unavailable for appointments? Users will not be able to book on this date.`)) return;
                toggleBtn.disabled = true;
                try {
                  await api(`/api/queueing/manage/offices/${officeId}/schedule-closures`, { method: 'POST', body: JSON.stringify({ date: curDate }) });
                  closedDates.add(curDate);
                  showToast(`${curDate} marked as unavailable for appointments.`, 'success');
                  updateClosureUI();
                } catch (err) {
                  showToast(err.message || 'Unable to block date.', 'error');
                  toggleBtn.disabled = false;
                }
              }
            };
          }
        }

        if (closedDatesSection && closedDatesChips) {
          const sortedClosures = Array.from(closedDates).sort();
          if (sortedClosures.length === 0) {
            closedDatesSection.style.display = 'none';
            closedDatesChips.innerHTML = '';
          } else {
            closedDatesSection.style.display = 'block';
            closedDatesChips.innerHTML = sortedClosures.map(d => {
              let dLabel = d;
              const parts = d.split('-');
              if (parts.length === 3) {
                const dateObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
                dLabel = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              }
              return `
                <span style="display:inline-flex;align-items:center;gap:6px;background:rgba(239,68,68,0.08);color:#ef4444;border:1px solid rgba(239,68,68,0.22);padding:3px 8px 3px 10px;border-radius:16px;font-size:11px;font-weight:600;">
                  <i class="fas fa-calendar-xmark" style="font-size:10px;"></i>
                  <span>${dLabel}</span>
                  <button class="queue-reopen-chip-btn" data-date="${d}" title="Unblock ${d}" style="display:inline-flex;align-items:center;justify-content:center;background:none;border:none;color:#ef4444;cursor:pointer;padding:2px 4px;border-radius:4px;font-size:11px;font-weight:700;margin-left:2px;">
                    <i class="fas fa-rotate-left" style="margin-right:3px;"></i> Unblock
                  </button>
                </span>
              `;
            }).join('');

            closedDatesChips.querySelectorAll('.queue-reopen-chip-btn').forEach(chipBtn => {
              chipBtn.onclick = async () => {
                const targetDate = chipBtn.dataset.date;
                if (!window.confirm(`Unblock / mark ${targetDate} as available for appointments?`)) return;
                chipBtn.disabled = true;
                try {
                  await api(`/api/queueing/manage/offices/${officeId}/schedule-closures/${targetDate}`, { method: 'DELETE' });
                  closedDates.delete(targetDate);
                  showToast(`Appointments are now available for ${targetDate}.`, 'success');
                  updateClosureUI();
                } catch (err) {
                  showToast(err.message || 'Unable to unblock date.', 'error');
                  chipBtn.disabled = false;
                }
              };
            });
          }
        }
      }

      const closureDateInput = panel.querySelector('#queueScheduleClosureDate');
      if (closureDateInput) {
        closureDateInput.onchange = () => updateClosureUI();
      }
      updateClosureUI();

      // Wire Monitor Link
      const monitorLink = panel.querySelector('a[href^="/queue-display/"]');
      if (monitorLink) {
        monitorLink.href = `/queue-monitor/${encodeURIComponent(code)}`;
        monitorLink.onclick = event => {
          event.preventDefault();
          const monitorWindow = window.open('about:blank', '_blank');
          if (!monitorWindow) {
            showToast('Allow pop-ups to open the monitor controls.', 'error');
            return;
          }
          monitorWindow.sessionStorage.setItem('pupsj_token', getToken());
          monitorWindow.location.replace(monitorLink.href);
        };
      }

      // Wire Call Next
      document.getElementById('queueCallNext').onclick = async () => {
        const button = document.getElementById('queueCallNext');
        button.disabled = true;
        try {
          const result = await api(`/api/queueing/manage/offices/${officeId}/next`, { method: 'POST' });
          showToast(result.ticket_number ? `${result.ticket_number} has been called.` : result.completed_ticket ? `${result.completed_ticket.ticket_number} completed. No other tickets in queue.` : 'No eligible tickets in queue.', 'success');
          await loadQueueOffice(officeId, code);
        } catch (err) {
          showToast(err.message || 'No eligible tickets in queue.', 'info');
          button.disabled = false;
        }
      };

      // Wire Queue Actions (serving, completed, skipped)
      panel.querySelectorAll('.queue-action').forEach(b => {
        b.onclick = async () => {
          b.disabled = true;
          try {
            await api(`/api/queueing/manage/tickets/${b.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ status: b.dataset.status }) });
            showToast(b.dataset.status === 'called' ? 'Ticket called and student notified.' : 'Queue updated.', 'success');
            await loadQueueOffice(officeId, code);
          } catch (err) {
            showToast(err.message || 'Unable to update this ticket.', 'error');
            b.disabled = false;
          }
        };
      });
    } catch (err) {
      panel.innerHTML = `<p>${escHtml(err.message)}</p>`;
    }
  }

  init();

})();

/* ══════════════════════════════════════════════
   CUSTOM SELECT DROPDOWN ENGINE  (portal mode)
   ══════════════════════════════════════════════ */
(function () {
  let _openState = null; // { wrapper, dropdown, trigger }

  function _positionDropdown(trigger, dropdown) {
    const r = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    const dropH = Math.min(230, dropdown.scrollHeight);
    const goUp = spaceBelow < dropH + 8 && spaceAbove > spaceBelow;
    dropdown.style.width  = r.width + 'px';
    dropdown.style.left   = (r.left + window.scrollX) + 'px';
    if (goUp) {
      dropdown.style.top    = '';
      dropdown.style.bottom = (window.innerHeight - r.top + window.scrollY + 5) + 'px';
    } else {
      dropdown.style.bottom = '';
      dropdown.style.top    = (r.bottom + window.scrollY + 5) + 'px';
    }
  }

  function _close() {
    if (!_openState) return;
    const { wrapper, dropdown } = _openState;
    wrapper.classList.remove('cs-open');
    dropdown.classList.remove('cs-open');
    _openState = null;
  }

  function _open(wrapper, trigger, dropdown, sel, valueSpan) {
    if (_openState) _close();
    _positionDropdown(trigger, dropdown);
    wrapper.classList.add('cs-open');
    dropdown.classList.add('cs-open');
    // scroll selected option into view
    const sel_opt = dropdown.querySelector('.cs-selected');
    if (sel_opt) sel_opt.scrollIntoView({ block: 'nearest' });
    _openState = { wrapper, dropdown, trigger };
  }

  document.addEventListener('click', function (e) {
    if (!_openState) return;
    if (!_openState.wrapper.contains(e.target) && !_openState.dropdown.contains(e.target)) _close();
  });
  window.addEventListener('scroll', function () { if (_openState) _positionDropdown(_openState.trigger, _openState.dropdown); }, true);
  window.addEventListener('resize', function () { if (_openState) _positionDropdown(_openState.trigger, _openState.dropdown); });

  function _syncOptions(sel, dropdown) {
    dropdown.innerHTML = '';
    Array.from(sel.options).forEach(function (opt) {
      const div = document.createElement('div');
      div.className = 'cs-option' +
        (opt.value === '' ? ' cs-placeholder-opt' : '') +
        (opt.selected ? ' cs-selected' : '');
      div.textContent = opt.textContent.trim();
      div.dataset.value = opt.value;
      dropdown.appendChild(div);
    });
  }

  function _syncValue(sel, valueSpan, dropdown) {
    const opt = sel.options[sel.selectedIndex];
    if (opt) {
      valueSpan.textContent = opt.textContent.trim();
      valueSpan.className = 'cs-value' + (opt.value === '' ? ' cs-placeholder' : '');
    }
    dropdown.querySelectorAll('.cs-option').forEach(function (div) {
      div.classList.toggle('cs-selected', div.dataset.value === sel.value);
    });
  }

  function _syncDisabled(sel, wrapper) {
    wrapper.classList.toggle('cs-disabled', !!sel.disabled);
  }

  function _build(sel) {
    if (sel.dataset.csInit) return;
    sel.dataset.csInit = '1';

    const wrapper = document.createElement('div');
    wrapper.className = 'cs-wrapper';

    const trigger = document.createElement('div');
    trigger.className = 'cs-trigger';
    trigger.setAttribute('tabindex', '0');
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');

    const valueSpan = document.createElement('span');
    valueSpan.className = 'cs-value';

    const arrowSpan = document.createElement('span');
    arrowSpan.className = 'cs-arrow';

    trigger.appendChild(valueSpan);
    trigger.appendChild(arrowSpan);

    // Dropdown is portalled to body so it is never clipped
    const dropdown = document.createElement('div');
    dropdown.className = 'cs-dropdown cs-portal';
    dropdown.setAttribute('role', 'listbox');
    document.body.appendChild(dropdown);

    wrapper.appendChild(trigger);

    sel.parentNode.insertBefore(wrapper, sel);
    sel.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;';
    wrapper.appendChild(sel);

    _syncOptions(sel, dropdown);
    _syncValue(sel, valueSpan, dropdown);
    _syncDisabled(sel, wrapper);

    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      if (wrapper.classList.contains('cs-disabled')) return;
      if (_openState && _openState.wrapper === wrapper) _close();
      else _open(wrapper, trigger, dropdown, sel, valueSpan);
    });

    trigger.addEventListener('keydown', function (e) {
      const isOpen = _openState && _openState.wrapper === wrapper;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        isOpen ? _close() : _open(wrapper, trigger, dropdown, sel, valueSpan);
      } else if (e.key === 'Escape') {
        _close();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const idx = Math.min(sel.selectedIndex + 1, sel.options.length - 1);
        sel.selectedIndex = idx; sel.dispatchEvent(new Event('change', { bubbles: true }));
        _syncValue(sel, valueSpan, dropdown);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const idx = Math.max(sel.selectedIndex - 1, 0);
        sel.selectedIndex = idx; sel.dispatchEvent(new Event('change', { bubbles: true }));
        _syncValue(sel, valueSpan, dropdown);
      }
    });

    dropdown.addEventListener('click', function (e) {
      const opt = e.target.closest('.cs-option');
      if (!opt) return;
      sel.value = opt.dataset.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      _syncValue(sel, valueSpan, dropdown);
      _close();
      trigger.focus();
    });

    const mo = new MutationObserver(function () {
      _syncOptions(sel, dropdown);
      _syncValue(sel, valueSpan, dropdown);
      _syncDisabled(sel, wrapper);
      if (_openState && _openState.wrapper === wrapper) _positionDropdown(trigger, dropdown);
    });
    mo.observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });

    // Sync UI when value is changed programmatically via dispatchEvent('change')
    sel.addEventListener('change', function () { _syncValue(sel, valueSpan, dropdown); });
  }

  function _initAll(root) {
    (root || document).querySelectorAll('select.form-select:not([data-cs-init])').forEach(_build);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { _initAll(); });
  else _initAll();

  const _bodyMO = new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      m.addedNodes.forEach(function (node) {
        if (node.nodeType !== 1) return;
        if (node.matches && node.matches('select.form-select:not([data-cs-init])')) _build(node);
        if (node.querySelectorAll) node.querySelectorAll('select.form-select:not([data-cs-init])').forEach(_build);
      });
    });
  });
  _bodyMO.observe(document.body, { childList: true, subtree: true });
})();
