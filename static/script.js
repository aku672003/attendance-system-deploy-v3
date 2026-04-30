// Global Variables
let currentUser = null;
let currentAttendanceRecord = null; // Fix for race condition
let isUserGeoInRange = false;       // Fix for race condition
let selectedOffice = null;
let selectedType = null;
let capturedPhotoData = null;
let stream = null;
let accessibleOffices = [];
let editingUserId = null;
let adminUserEditId = null;
let currentCheckOutContext = null;
let notificationTimeout = null;
let currentEditAttendanceId = null;
let allAttendanceRecords = [];
let selectedOfficeInRange = false;
let attendanceDaysOffset = 0;
let attendanceHasMore = false;
let faceapiLoaded = false;
let trackingInterval = null;
const MODEL_URL = 'https://cdn.jsdelivr.net/gh/vladmandic/face-api/model/';
let selectedCalendarDates = [];
let isMultiSelectMode = false;
let currentCalendarMonth = 0; // Set in init
let currentCalendarYear = 0; // Set in init
let currentPhotoLocation = null; // Store for overlay
let serverTimeOffset = 0; // Milliseconds between server and local time
let isExportAllCancelled = false; // Flag for cancellation
let dashboardLocationWatchId = null; // Background watcher for dashboard
let currentSummaryDate = null; // Tracks date for Daily Overview modal
let currentLeaveDates = []; // Store leave dates for the currently viewed month in Status Overview
let dashboardLeaveDates = []; // Store leave dates for the current month on Dashboard
let yearlyLeaveDates = []; // Store all leave dates for the year

/**
 * Returns a new Date object reflecting the current Indian Standard Time (IST),
 * calculated using the server time offset to prevent device clock manipulation.
 */
function getCurrentISTDate() {
    const syncedNow = new Date(Date.now() + serverTimeOffset);
    const utc = syncedNow.getTime() + (syncedNow.getTimezoneOffset() * 60000);
    return new Date(utc + (3600000 * 5.5));
}
// API Configuration
const apiBaseUrl = "/api";
const MAPS_API_KEY = window.MAPS_API_KEY || ''; 

// Helper: Format Date to DD-MM-YYYY
function formatDateDMY(dateInput) {
    if (!dateInput) return 'N/A';
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return dateInput;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
}

// Helper: Format Time only
function formatTimeOnly(dateInput) {
    if (!dateInput) return 'N/A';
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Initialize Application
document.addEventListener('DOMContentLoaded', async function () {
    console.log('MySQL Attendance System Initializing...');
    refreshPrimaryOfficeSelects();
    // Check for stored user session
    const storedUser = sessionStorage.getItem('attendanceUser');
    const tokenVerified = sessionStorage.getItem('attendanceTokenVerified');
    const today = getCurrentISTDate().toISOString().split('T')[0];

    if (storedUser) {
        try {
            currentUser = JSON.parse(storedUser);
            // Apply personalization on reload
            const userAvatar = document.getElementById('userAvatar');
            if (currentUser.avatar_emoji && userAvatar) {
                renderAvatar(currentUser.avatar_emoji, userAvatar);
            }
            if (currentUser.theme_settings) {
                applyUserTheme(currentUser.theme_settings);
            }
            const loginTime = sessionStorage.getItem('attendanceLoginTime');
            const now = Date.now();
            const oneHour = 3600000;

            if (loginTime && (now - parseInt(loginTime) > oneHour)) {
                console.log('Session expired (1 hour limit reached).');
                logout();
                return;
            }

            showScreen('dashboardScreen');
            await syncServerTime(); // Wait for sync before loading data

            const istNow = getCurrentISTDate();
            currentCalendarMonth = istNow.getMonth();
            currentCalendarYear = istNow.getFullYear();

            loadDashboardData();
            updateDashboardVisibility();
            startDashboardLocationWatch(); // Persistent background GPS watcher
            checkAndUpdateLocationStatus(true); // Initial immediate check

            // Register push notifications for the returning session
            setupPushNotifications(currentUser.id);

            // If they are logged in, we skip the gatekeeper logic below
            // because they already "passed" the gatekeeper to get the session.
        } catch (e) {
            sessionStorage.removeItem('attendanceUser');
        }
    } else if (window.GATED_TOKEN && !window.IS_DEVELOPMENT) {
        // PRODUCTION AUTO-LOGIN: If a token exists and we are NOT on local development,
        // hide the login screen immediately and attempt auto-login.
        console.log('Production instance detected with token. Attempting auto-login...');
        const loginScreen = document.getElementById('loginScreen');
        if (loginScreen) loginScreen.classList.remove('active');
        showLoading('Authenticating with HanuAI Portal...');

        try {
            const verifyRes = await fetch(`${apiBaseUrl}/verify-token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: window.GATED_TOKEN })
            });
            const result = await verifyRes.json();

            if (result.success && result.user) {
                console.log('Auto-login successful!');
                currentUser = result.user;
                sessionStorage.setItem('attendanceUser', JSON.stringify(currentUser));
                sessionStorage.setItem('attendanceLoginTime', Date.now().toString());
                
                // Initialize session
                if (currentUser.theme_settings) applyUserTheme(currentUser.theme_settings);
                showScreen('dashboardScreen');
                await syncServerTime();
                const istNow = getCurrentISTDate();
                currentCalendarMonth = istNow.getMonth();
                currentCalendarYear = istNow.getFullYear();
                loadDashboardData();
                updateDashboardVisibility();
                startDashboardLocationWatch();
                checkAndUpdateLocationStatus(true);
                setupPushNotifications(currentUser.id);
                hideLoading();
            } else {
                console.warn('Auto-login failed:', result.message);
                if (loginScreen) loginScreen.classList.add('active');
                hideLoading();
                showNotification('Session expired. Please login through HanuAI portal again.', 'warning');
            }
        } catch (err) {
            console.error('Auto-login error:', err);
            if (loginScreen) loginScreen.classList.add('active');
            hideLoading();
        }
    } else {
        // NORMAL LOGIN: In development or if no token provided.
        console.log('Normal login mode active.');
    }

    // Load face detection models
    loadFaceDetectionModels();

    // Account Status Toggle Listener
    const activeToggle = document.getElementById('newUserIsActive');
    const activeLabel = document.getElementById('newUserIsActiveLabel');
    if (activeToggle && activeLabel) {
        activeToggle.addEventListener('change', function() {
            activeLabel.textContent = this.checked ? 'Active' : 'Inactive';
        });
    }

    // Joining Date Listener for Auto-CL calculation
    const joiningDateInput = document.getElementById('newUserJoiningDate');
    const totalClInput = document.getElementById('newUserTotalCL');
    if (joiningDateInput && totalClInput) {
        joiningDateInput.addEventListener('change', function() {
            if (!this.value) return;
            const joiningDate = new Date(this.value);
            const today = getCurrentISTDate();
            if (joiningDate.getFullYear() === today.getFullYear()) {
                const monthsLeft = 12 - joiningDate.getMonth(); // getMonth() is 0-11
                totalClInput.value = monthsLeft;
                showNotification(`Auto-filled CL for ${monthsLeft} months remaining in ${today.getFullYear()}`, 'info');
            } else {
                totalClInput.value = 12;
            }
        });
    }

    // Background session timeout check (every minute)
    setInterval(() => {
        const loginTime = sessionStorage.getItem('attendanceLoginTime');
        if (loginTime && currentUser) {
            const now = Date.now();
            const oneHour = 3600000;
            if (now - parseInt(loginTime) > oneHour) {
                console.log('Session expired (background check). Logging out...');
                logout();
            }
        }
    }, 60000);
});

// ── Web Push Notification Setup ──────────────────────────────────────────────
/**
 * Convert a URL-safe Base64 string to a Uint8Array (required for VAPID subscription).
 */
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = window.atob(base64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

/**
 * Register the service worker, request notification permission, and save the
 * push subscription to the backend so the server can send reminders.
 * @param {number|string} employeeId – the logged-in employee's primary key.
 */
async function setupPushNotifications(employeeId) {
    try {
        // Guard: feature must be supported by the browser
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            console.log('[Push] Browser does not support push notifications.');
            return;
        }

        // Register (or retrieve) the service worker at the root scope
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        console.log('[Push] Service worker registered:', reg.scope);

        // Request notification permission (graceful if already granted/denied)
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            console.log('[Push] Notification permission:', permission);
            return;
        }

        // Fetch VAPID public key from the backend
        const keyUrl = `${apiBaseUrl}/get-vapid-public-key` + (window.GATED_TOKEN ? `?token=${encodeURIComponent(window.GATED_TOKEN)}` : '');
        const keyRes = await fetch(keyUrl, {
            headers: { 'X-Gated-Token': window.GATED_TOKEN || '' }
        });
        const keyData = await keyRes.json();
        if (!keyData.success || !keyData.public_key) {
            console.warn('[Push] VAPID public key not available — push disabled.');
            return;
        }

        // Subscribe via PushManager
        const applicationServerKey = urlBase64ToUint8Array(keyData.public_key);
        let subscription = await reg.pushManager.getSubscription();
        
        // If there's an existing subscription, unsubscribe first to avoid VAPID key mismatches
        // which often cause "AbortError: Registration failed - push service error"
        if (subscription) {
            console.log('[Push] Unsubscribing existing stale subscription...');
            await subscription.unsubscribe();
        }

        console.log('[Push] Creating fresh subscription...');
        try {
            subscription = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey,
            });
        } catch (subErr) {
            if (subErr.name === 'AbortError') {
                console.error('[Push] Setup failed: The push service rejected the request. (Likely Incognito mode, VPN/Firewall block, or browser push service outage).');
            } else {
                console.error('[Push] Setup failed:', subErr);
            }
            return;
        }

        // Serialize and send subscription to the backend
        const subJson = subscription.toJSON();
        const payload = {
            employee_id: employeeId,
            endpoint: subJson.endpoint,
            p256dh: subJson.keys?.p256dh || '',
            auth: subJson.keys?.auth || '',
        };

        const saveUrl = `${apiBaseUrl}/save-push-subscription` + (window.GATED_TOKEN ? `?token=${encodeURIComponent(window.GATED_TOKEN)}` : '');
        await fetch(saveUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken(),
                'X-Gated-Token': window.GATED_TOKEN || ''
            },
            body: JSON.stringify(payload),
        });

        console.log('[Push] Subscription saved — attendance reminders enabled ✅');
    } catch (err) {
        console.error('[Push] Critical setup error:', err);
    }
}

/** Helper: extract the Django CSRF token from the cookie */
function getCsrfToken() {
    const name = 'csrftoken';
    const cookies = document.cookie.split(';');
    for (let c of cookies) {
        c = c.trim();
        if (c.startsWith(name + '=')) {
            return decodeURIComponent(c.slice(name.length + 1));
        }
    }
    return '';
}
// ── End Web Push Setup ────────────────────────────────────────────────────────

// Toggle password visibility for any button with .toggle-password-btn
document.addEventListener('click', function (e) {
    if (!e.target.classList.contains('toggle-password-btn')) return;

    const targetId = e.target.getAttribute('data-target');
    const input = document.getElementById(targetId);
    if (!input) return;

    if (input.type === 'password') {
        input.type = 'text';
        e.target.textContent = '🙈';
    } else {
        input.type = 'password';
        e.target.textContent = '👁';
    }
});
document.addEventListener('click', e => {
    const card = e.target.closest('.task-card');
    if (!card) return;

    openTaskDetail(card.dataset.taskId);
});

async function loadFaceDetectionModels() {
    console.log('Loading face detection models from:', MODEL_URL);
    try {
        await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL)
        ]);
        faceapiLoaded = true;
        console.log('Face detection models loaded successfully.');
    } catch (e) {
        console.error('Error loading face detection models:', e);
        showNotification('Face detection won\'t be available (model load failed).', 'warning');
    }
}
document.addEventListener("dblclick", e => {
    const card = e.target.closest(".task-card");
    if (!card || !isAdmin()) return;

    window.activeTaskId = card.dataset.taskId;
    openModal("taskCommentModal");
});

function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.classList.contains('active')) return;
    el.classList.add('active');
    updateScrollLock();
}

async function syncServerTime() {
    try {
        const start = Date.now();
        const timeUrl = `${apiBaseUrl}/server-time` + (window.GATED_TOKEN ? `?token=${encodeURIComponent(window.GATED_TOKEN)}` : '');
        const response = await fetch(timeUrl, {
            headers: { 'X-Gated-Token': window.GATED_TOKEN || '' }
        });
        const result = await response.json();
        const end = Date.now();

        if (result.success) {
            // Adjust for network latency (rough estimate: half-round-trip)
            const latency = (end - start) / 2;
            const serverTime = result.timestamp + latency;
            serverTimeOffset = serverTime - end;
            console.log(`Server time synced. Offset: ${serverTimeOffset}ms`);
        }
    } catch (e) {
        console.error("Failed to sync server time:", e);
    }
}

// Re-sync server time every 5 minutes to keep the offset accurate
setInterval(syncServerTime, 5 * 60 * 1000);

function closeModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('active');
    updateScrollLock();


    // If board-empty warning is closed, mark as shown to avoid pop-up loops
    if (id === 'noTasksModal') {
        window._lastTaskWarningShown = true;
    }

    // Refresh dashboard stats when closing requests/calendar modals
    // This ensures that if a request was made/approved, the dashboard counters update.
    if (id === 'myRequestsModal' || id === 'requestsModal' || id === 'calendarModal') {
        if (typeof loadWFHEligibility === 'function') {
            loadWFHEligibility();
        }
    }

    // Close advanced color picker if appearance modal is closed
    if (id === 'appearanceModal') {
        toggleAdvancedColorPicker(false);
    }
}

// Camera Permission Modal Functions
function showCameraPermissionModal() {
    const modal = document.getElementById('cameraPermissionModal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

function closeCameraPermissionModal() {
    const modal = document.getElementById('cameraPermissionModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

async function requestCameraPermission() {
    const enableBtn = document.getElementById('enableCameraBtn');
    const originalText = enableBtn.innerHTML;

    try {
        enableBtn.innerHTML = '⏳ Requesting permission...';
        enableBtn.disabled = true;

        // Request camera access
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });

        // Stop the stream immediately (we just needed to trigger the permission prompt)
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }

        // Close modal and restart camera
        closeCameraPermissionModal();
        showNotification('Camera access granted! Starting camera...', 'success');

        // Wait a bit then restart camera
        setTimeout(() => {
            startCamera();
        }, 500);

    } catch (e) {
        console.error('Camera permission request failed', e);
        enableBtn.innerHTML = originalText;
        enableBtn.disabled = false;

        if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
            showNotification('Camera permission denied. Please enable it in your browser settings.', 'error');
        } else {
            showNotification('Unable to access camera: ' + e.message, 'error');
        }
    }
}

/**
 * Premium Custom Confirmation Modal
 * Returns a promise that resolves to true if OK is clicked, false otherwise
 */
function showConfirm(message, title = "Confirm Action", icon = "⚠️") {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        const titleEl = document.getElementById('confirmTitle');
        const messageEl = document.getElementById('confirmMessage');
        const iconEl = document.getElementById('confirmIcon');
        const okBtn = document.getElementById('confirmOkBtn');
        const cancelBtn = document.getElementById('confirmCancelBtn');

        titleEl.textContent = title;
        messageEl.textContent = message;
        iconEl.textContent = icon;

        const cleanup = (value) => {
            okBtn.onclick = null;
            cancelBtn.onclick = null;
            closeModal('confirmModal');
            resolve(value);
        };

        okBtn.onclick = () => cleanup(true);
        cancelBtn.onclick = () => cleanup(false);

        openModal('confirmModal');
    });
}

// optional: click backdrop to close
document.addEventListener('click', (e) => {
    const modal = e.target.closest('.modal');
    if (modal && e.target === modal) closeModal(modal.id);
});

// optional: ESC key closes active modals
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal.active').forEach(m => closeModal(m.id));
    }
});

// Utility Functions
function resetAttendanceFlow() {
    // clear selections/state
    selectedOffice = null;
    selectedType = null;
    capturedPhotoData = null;

    // stop any running camera stream
    try {
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
            stream = null;
        }
    } catch { }

    // reset camera UI
    const video = document.getElementById('video');
    const img = document.getElementById('capturedPhoto');
    const placeholder = document.getElementById('cameraPlaceholder');

    if (video) { video.srcObject = null; video.style.display = 'none'; }
    if (img) { img.src = ''; img.style.display = 'none'; }
    if (placeholder) { placeholder.style.display = 'flex'; }

    const startBtn = document.getElementById('startCameraBtn');
    const captureBtn = document.getElementById('captureBtn');
    const retakeBtn = document.getElementById('retakeBtn');
    const markBtn = document.getElementById('markBtn');

    if (startBtn) startBtn.style.display = 'inline-block';
    if (captureBtn) captureBtn.style.display = 'none';
    if (retakeBtn) retakeBtn.style.display = 'none';
    if (markBtn) markBtn.style.display = 'none';

    // reset cards selection
    document.querySelectorAll('#typeSelection .office-card, #officeSelection .office-card')
        .forEach(el => el.classList.remove('selected'));

    // show type choices, hide office list & camera until a type is picked
    const typeSection = document.getElementById('typeSelectionSection');
    const officeBlock = document.getElementById('officeBlock');
    const cameraSection = document.getElementById('cameraSection');

    if (typeSection) typeSection.classList.remove('hidden');
    if (officeBlock) officeBlock.style.display = 'none';
    if (cameraSection) cameraSection.classList.add('hidden');

    stopFaceTracking();
}

function showScreen(screenId) {
    // Prevent non-admins from opening adminScreen
    if (screenId === 'adminScreen' && (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'Mentor' && !currentUser.has_subordinates))) {
        showNotification('Admins only.', 'warning');
        screenId = 'dashboardScreen';
        return;
    }

    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    if (screenId === 'dashboardScreen') updateHeaderAvatar();

    // Only keep override on records screen if it was explicitly set before showing
    // If we're entering dashboard, always clear. If we're entering records naturally, clear.
    if (screenId !== 'recordsScreen' || (screenId === 'recordsScreen' && !window._keepOverrideFilter)) {
        if (typeof overrideRecordsEmployeeId !== 'undefined') {
            overrideRecordsEmployeeId = null;
            overrideRecordsEmployeeName = null;
            const recordsTitle = document.querySelector('#recordsScreen .header-title');
            if (recordsTitle) recordsTitle.textContent = 'Attendance Records';
        }
    }
    // reset lock flag
    window._keepOverrideFilter = false;


    if (screenId === 'recordsScreen') {
        loadAttendanceRecords();
    } else if (screenId === 'attendanceScreen') {
        // avoid reference error if you removed resetAttendanceFlow
        if (typeof resetAttendanceFlow === 'function') resetAttendanceFlow();
    } else if (screenId === 'dashboardScreen') {
        // Ensure adminStatsGrid is moved back to the dashboard if it was moved to adminScreen
        const statsGrid = document.getElementById('adminStatsGrid');
        const dashboardStatsGrid = document.getElementById('employeeStatsGrid');
        if (statsGrid && dashboardStatsGrid && statsGrid.parentNode !== dashboardStatsGrid.parentNode) {
            dashboardStatsGrid.parentNode.insertBefore(statsGrid, dashboardStatsGrid);
            statsGrid.style.marginBottom = ''; // reset inline style
        }
        updateDashboardVisibility();
    }
}

function toggleDocRow(key) {
    const config = {
        Identity: {
            checkbox: 'chkDocIdentity',
            fields: ['userPhotoFile', 'userSignatureFile']
        },
        Aadhar: {
            checkbox: 'chkDocAadhar',
            fields: ['docAadharNumber', 'docAadharFile']
        },
        Pan: {
            checkbox: 'chkDocPan',
            fields: ['docPanNumber', 'docPanFile']
        },
        OtherId: {
            checkbox: 'chkDocOtherId',
            fields: ['docOtherIdName', 'docOtherIdNumber', 'docOtherIdFile']
        },
        QualHighest: {
            checkbox: 'chkQualHighest',
            fields: ['qualHighestName', 'qualHighestNumber', 'qualHighestFile']
        },
        QualProfessional: {
            checkbox: 'chkQualProfessional',
            fields: ['qualProfessionalName', 'qualProfessionalNumber', 'qualProfessionalFile']
        },
        QualOther: {
            checkbox: 'chkQualOther',
            fields: ['qualOtherName', 'qualOtherNumber', 'qualOtherFile']
        },

    };

    const cfg = config[key];
    if (!cfg) return;

    const checked = document.getElementById(cfg.checkbox)?.checked;

    cfg.fields.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;

        el.disabled = !checked;

        if (!checked) {
            if (el.type === 'file') {
                el.value = '';
            } else {
                el.value = '';
            }
        }
    });
}


function resetDocCheckboxes() {
    const mapCheckbox = {
        Aadhar: 'chkDocAadhar',
        Pan: 'chkDocPan',
        OtherId: 'chkDocOtherId',
        QualHighest: 'chkQualHighest',
        QualProfessional: 'chkQualProfessional',
        QualOther: 'chkQualOther',
        Identity: 'chkDocIdentity'
    };

    Object.keys(mapCheckbox).forEach(key => {
        const chk = document.getElementById(mapCheckbox[key]);
        if (chk) {
            chk.checked = false;
            toggleDocRow(key);
        }
    });
}


function showNotification(message, type = 'success') {
    const notification = document.getElementById('notification');
    if (!notification) return;

    notification.textContent = message;
    notification.className = `notification ${type} show`;

    // Clear any previous timer
    if (notificationTimeout) {
        clearTimeout(notificationTimeout);
    }

    // Auto-hide after 4 seconds
    notificationTimeout = setTimeout(() => {
        notification.classList.remove('show');
    }, 4000);

    // Also allow manual close on click
    notification.onclick = () => {
        notification.classList.remove('show');
    };
}

/**
 * Shows the global premium loading screen
 */
function showLoading(message = "Loading your dashboard...") {
    const loader = document.getElementById('globalLoader');
    if (!loader) return;

    // Update message if provided
    const subtitle = loader.querySelector('.loader-subtitle');
    if (subtitle) subtitle.textContent = message;

    loader.classList.add('active');
    updateScrollLock();
}

/**
 * Hides the global premium loading screen
 */
function hideLoading() {
    const loader = document.getElementById('globalLoader');
    if (!loader) return;

    loader.classList.remove('active');
    updateScrollLock();
}

// Geolocation permission help UI
function showGeoPermissionHelp(containerEl) {
    const el = containerEl || document.getElementById('locationDistance');
    if (!el) return;

    // If we're updating the main dashboard widget, clear the 'denied' text first
    if (el.id === 'locationDistance') {
        const statusEl = document.getElementById('locationStatus');
        if (statusEl) statusEl.innerHTML = '';
    }

    el.innerHTML = `
        <div class="geo-help" style="font-size:13px; color:var(--gray-600); line-height:1.5; text-align:center; padding: 12px;">
            <div style="font-size: 20px; margin-bottom: 8px;">📍</div>
            <div style="font-weight: 700; color: #1e293b; margin-bottom: 4px;">Location Required</div>
            Enable location in your browser settings to track attendance properly.
            <div style="margin-top:12px; display:flex; gap:8px; justify-content:center;">
                <button class="btn btn-primary" id="geoTryEnableBtn" style="padding: 8px 16px; border-radius: 10px; font-weight: 600; min-height: 36px; font-size: 13px;">Enable</button>
                <button class="btn btn-secondary" id="geoReloadBtn" style="padding: 8px 16px; border-radius: 10px; font-weight: 600; min-height: 36px; font-size: 13px;">Reload</button>
            </div>
        </div>`;
    const btn = document.getElementById('geoReloadBtn');
    if (btn) btn.onclick = () => window.location.reload();
    const enableBtn = document.getElementById('geoTryEnableBtn');
    if (enableBtn) enableBtn.onclick = async () => {
        await requestLocationOnce();
        checkAndUpdateLocationStatus();
    };
}

// Explicit one-shot geolocation request to trigger browser prompt if state is 'prompt'
async function requestLocationOnce() {
    if (!('geolocation' in navigator)) return;
    return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
            (p) => {
                // Also update cache if we get a one-shot fix
                const { latitude: lat, longitude: lng, accuracy } = p.coords;
                currentPhotoLocation = { lat, lng, accuracy: accuracy || 999, timestamp: Date.now() };
                resolve(true);
            },
            () => resolve(false),
            { enableHighAccuracy: true, timeout: 45000, maximumAge: 0 }
        );
    });
}


function formatDate(date) {
    return date.toISOString().split('T')[0];
}

function formatTime(date) {
    return date.toTimeString().split(' ')[0];
}

function getCurrentDateTime() {
    // Always use synchronized server IST — never the device clock
    const now = getCurrentISTDate();
    return {
        date: formatDate(now),
        time: formatTime(now)
    };
}

function formatDisplayDate(dateString) {
    if (!dateString) return 'Unknown Date';
    // Return formatted as "Day, DD-MM-YYYY" or similar if requested, 
    // but the user wants dd-mm-yyyy for the whole task manager.
    // Let's use our standardized helper.
    return formatDateDMY(dateString);
}
function getDateRange(startDate, endDate) {
    const dates = [];
    let d = new Date(startDate);
    const end = new Date(endDate);

    while (d <= end) {
        dates.push(d.toISOString().slice(0, 10)); // YYYY-MM-DD
        d.setDate(d.getDate() + 1);
    }
    return dates;
}
const ATTENDANCE_CELL_STYLES = {
    P: {
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16A34A' } }, // green
        font: { color: { argb: 'FFFFFFFF' }, bold: true }
    },
    A: {
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } }, // red
        font: { color: { argb: 'FFFFFFFF' }, bold: true }
    },
    HD: {
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF59E0B' } }, // yellow
        font: { color: { argb: 'FF000000' }, bold: true }
    }
};

function formatWorkedMinutesToHours(minutes) {
    if (minutes === null || minutes === undefined) return '-';
    const total = Number(minutes);
    if (!Number.isFinite(total) || total < 0) return '-';

    const hours = Math.floor(total / 60);
    const mins = total % 60;

    if (hours === 0 && mins === 0) return '0h 0m';
    return `${hours}h ${mins}m`;
}


// Haversine distance in METERS
function calculateDistance(lat1, lng1, lat2, lng2) {
    const toRad = (v) => (v * Math.PI) / 180;
    const R = 6371000; // Earth radius (m)

    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}


// API Functions
// Django REST API call function
async function apiCall(path, method = 'GET', data = null) {
    method = (method || 'GET').toUpperCase();
    // Remove leading slash if present, add apiBaseUrl prefix
    let cleanPath = path.startsWith('/') ? path.slice(1) : path;
    let url = apiBaseUrl + '/' + cleanPath;

    if (method === 'GET' && data && typeof data === 'object') {
        const qs = Object.keys(data).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(data[k])).join('&');
        if (qs) {
            const separator = url.includes('?') ? '&' : '?';
            url += separator + qs;
        }
    }

    const opts = { method, headers: {} };
    opts.cache = 'no-store';
    opts.headers['Cache-Control'] = 'no-cache';
    
    // Add Gated Token to all API calls for security
    if (window.GATED_TOKEN && window.GATED_TOKEN !== "") {
        // Appending to headers
        opts.headers['X-Gated-Token'] = window.GATED_TOKEN;
        
        // Also appending as a parameter for maximum compatibility (as requested)
        const separator = url.includes('?') ? '&' : '?';
        url += `${separator}token=${encodeURIComponent(window.GATED_TOKEN)}`;
    }

    if (method !== 'GET' && data !== null) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(data);
    }


    try {
        const res = await fetch(url, opts);
        const text = await res.text();
        try { return JSON.parse(text); } catch { return { success: false, raw: text, status: res.status }; }
    } catch (error) {
        console.error("API Call failed:", error);
        return { success: false, message: "Network error or server unreachable" };
    }
}



// Authentication Functions
async function handleLogin(event) {
    event.preventDefault();

    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    const loginBtn = document.getElementById('loginBtn');
    const loginBtnText = document.getElementById('loginBtnText');
    const loginSpinner = document.getElementById('loginSpinner');

    if (!username || !password) {
        showNotification('Please enter username and password', 'error');
        return;
    }

    // Show loading state
    loginBtn.disabled = true;
    loginBtnText.classList.add('hidden');
    loginSpinner.classList.remove('hidden');

    try {
        const result = await apiCall('login', 'POST', {
            username: username,
            password: password
        });

        if (result.success) {
            currentUser = result.user;
            sessionStorage.setItem('attendanceUser', JSON.stringify(currentUser));
            sessionStorage.setItem('attendanceLoginTime', Date.now().toString());
            showLoading("Initializing your workspace...");

            // Apply personalization
            if (currentUser.avatar_emoji) {
                renderAvatar(currentUser.avatar_emoji, document.getElementById('userAvatar'));
            }
            if (currentUser.theme_settings) {
                applyUserTheme(currentUser.theme_settings);
            }

            // Sync server time FIRST — must happen before any time-sensitive operations
            await syncServerTime();

            // Set calendar to synchronized IST date
            const istNow = getCurrentISTDate();
            currentCalendarMonth = istNow.getMonth();
            currentCalendarYear = istNow.getFullYear();

            showNotification('Login successful!');
            showScreen('dashboardScreen');
            startDashboardLocationWatch(); // Start persistent watcher on login

            try {
                await loadDashboardData();
                await populateOfficeDropdowns(); // Ensure this exists or catch if it doesn't
            } catch (err) {
                console.error("Critical error loading dashboard data:", err);
                showNotification("Dashboard loaded with some errors", "warning");
            } finally {
                hideLoading();
            }

            updateDashboardVisibility();
            checkAndUpdateLocationStatus(true); // Automatic geolocation after login

            // Register this browser for push notifications after successful login
            setupPushNotifications(currentUser.id);
        } else {
            showNotification(result.message || 'Login failed', 'error');
        }
    } catch (error) {
        console.error("Login process error:", error);
        showNotification("An unexpected error occurred during login", "error");
    } finally {
        // Reset button state
        loginBtn.disabled = false;
        loginBtnText.classList.remove('hidden');
        loginSpinner.classList.add('hidden');
    }
}

async function handleForgotPasswordSubmit(event) {
    event.preventDefault();
    const username = document.getElementById('forgotUsername').value;
    const email = document.getElementById('forgotEmail').value;
    const btn = document.getElementById('forgotBtn');
    const btnText = document.getElementById('forgotBtnText');
    const spinner = document.getElementById('forgotSpinner');

    if (!username || !email) {
        showNotification('Please enter both username and email', 'error');
        return;
    }

    btn.disabled = true;
    btnText.classList.add('hidden');
    spinner.classList.remove('hidden');

    try {
        const result = await apiCall('send-otp', 'POST', { username, email });
        if (result.success) {
            showNotification(result.message || 'OTP sent to your email');
            document.getElementById('forgotStep1').classList.add('hidden');
            document.getElementById('forgotStep2').classList.remove('hidden');
            document.getElementById('forgotStepSubtitle').textContent = 'Enter the 6-digit OTP sent to ' + email;
        } else {
            showNotification(result.message || 'Failed to send OTP', 'error');
        }
    } catch (err) {
        showNotification('An error occurred. Please try again.', 'error');
    } finally {
        btn.disabled = false;
        btnText.classList.remove('hidden');
        spinner.classList.add('hidden');
    }
}

async function handleResetPasswordSubmit(event) {
    event.preventDefault();
    const username = document.getElementById('forgotUsername').value;
    const email = document.getElementById('forgotEmail').value;
    const otp = document.getElementById('resetOtp').value;
    const newPassword = document.getElementById('resetNewPassword').value;
    const btn = document.getElementById('resetBtn');
    const btnText = document.getElementById('resetBtnText');
    const spinner = document.getElementById('resetSpinner');

    if (!otp || !newPassword) {
        showNotification('OTP and new password are required', 'error');
        return;
    }

    btn.disabled = true;
    btnText.classList.add('hidden');
    spinner.classList.remove('hidden');

    try {
        const result = await apiCall('reset-password', 'POST', {
            username,
            email,
            otp,
            new_password: newPassword
        });

        if (result.success) {
            showNotification('Password reset successfully! Please login with your new password.');
            showScreen('loginScreen');
            // Reset form for next time
            document.getElementById('forgotUsername').value = '';
            document.getElementById('forgotEmail').value = '';
            document.getElementById('resetOtp').value = '';
            document.getElementById('resetNewPassword').value = '';
            document.getElementById('forgotStep1').classList.remove('hidden');
            document.getElementById('forgotStep2').classList.add('hidden');
            document.getElementById('forgotStepSubtitle').textContent = 'Enter your registered username and email to receive an OTP';
        } else {
            showNotification(result.message || 'Reset failed', 'error');
        }
    } catch (err) {
        showNotification('An error occurred. Please try again.', 'error');
    } finally {
        btn.disabled = false;
        btnText.classList.remove('hidden');
        spinner.classList.add('hidden');
    }
}

async function handleSignup(event) {
    event.preventDefault();

    const password = document.getElementById('signupPassword').value;
    const confirmPassword = document.getElementById('signupConfirmPassword').value;

    // Check passwords match before calling API
    if (password !== confirmPassword) {
        showNotification('Passwords do not match', 'error');
        return;
    }

    const formData = {
        name: document.getElementById('signupName').value,
        phone: document.getElementById('signupPhone').value,
        email: document.getElementById('signupEmail').value,
        department: document.getElementById('signupDepartment').value,
        primary_office: document.getElementById('signupOffice').value,
        username: document.getElementById('signupUsername').value,
        password: password
    };

    const signupBtn = document.getElementById('signupBtn');
    const signupBtnText = document.getElementById('signupBtnText');
    const signupSpinner = document.getElementById('signupSpinner');

    // Show loading state
    signupBtn.disabled = true;
    signupBtnText.classList.add('hidden');
    signupSpinner.classList.remove('hidden');

    try {
        const result = await apiCall('register', 'POST', formData);

        if (result.success) {
            showNotification('Account created successfully! Please login.');
            showScreen('loginScreen');

            // Clear form
            Object.keys(formData).forEach(key => {
                const element = document.getElementById(`signup${key.charAt(0).toUpperCase()}${key.slice(1).replace('_', '')}`);
                if (element) element.value = '';
            });
        } else {
            showNotification(result.message || 'Registration failed', 'error');
        }
    } finally {
        // Reset button state
        signupBtn.disabled = false;
        signupBtnText.classList.remove('hidden');
        signupSpinner.classList.add('hidden');
    }
}

function logout() {
    currentUser = null;
    sessionStorage.removeItem('attendanceUser');
    sessionStorage.removeItem('attendanceTokenVerified');
    sessionStorage.removeItem('attendanceLoginTime');

    // Redirect to root without query params to prevent auto-login loop
    window.location.href = window.location.origin + window.location.pathname;
}

// Dashboard Functions
// Notification System
let displayedWishIds = new Set(); // To prevent re-triggering animation for same wish

async function loadNotifications() {
    if (!currentUser) return;
    try {
        const res = await apiCall('notifications', 'GET', { user_id: currentUser.id });

        if (res && res.success) {
            displayNotifications(res.notifications);
            updateNotificationBadge(res.unread_count);

            // Check for Task Warnings
            const taskWarning = res.notifications.find(n => n.type === 'task_warning');
            if (taskWarning && !window._lastTaskWarningShown) {
                openModal('noTasksModal');
                window._lastTaskWarningShown = true;
            } else if (!taskWarning) {
                window._lastTaskWarningShown = false;
            }

            // SOCIAL TRIGGER: Check for unread wishes and trigger animation
            const gender = (currentUser && currentUser.gender) ? currentUser.gender.toLowerCase() : 'other';
            const unreadWishes = res.notifications.filter(n => n.type === 'wish' && !displayedWishIds.has(n.id));

            if (unreadWishes.length > 0) {
                unreadWishes.forEach((wish, index) => {
                    displayedWishIds.add(wish.id);
                    setTimeout(() => {
                        showBirthdayWishFX(wish.message, gender);
                    }, index * 4500);
                });
            }
        }
    } catch (e) {
        console.error('Failed to load notifications', e);
    }
}

// Set up polling for notifications every 2 minutes
setInterval(loadNotifications, 120000);

function displayNotifications(notifications) {
    const container = document.getElementById('notificationItems');
    if (!container) return;

    if (notifications.length === 0) {
        container.innerHTML = `
            <div style="padding: 32px; text-align: center; color: var(--gray-500);">
                <div style="font-size: 3rem; margin-bottom: 8px;">🔕</div>
                <p>No new notifications</p>
            </div>
        `;
        return;
    }

    container.innerHTML = notifications.map((notif, idx) => `
        <div class="notification-item" data-id="${notif.id}" onclick='handleNotificationClick(${JSON.stringify(notif).replace(/'/g, "&apos;")})'>
            <div class="notification-item-icon">${notif.icon}</div>
            <div class="notification-item-content">
                <div class="notification-item-message">${notif.message}</div>
                <div class="notification-item-time">${notif.time}</div>
            </div>
        </div>
    `).join('');
}

async function handleNotificationClick(notif) {
    if (!notif) return;
    const type = notif.type;
    const id = notif.id;

    if (type === 'wish' || id.startsWith('dn_')) {
        // Mark as read
        await apiCall('mark-notifications-read', 'POST', {
            user_id: currentUser.id,
            notification_id: id
        });
        loadNotifications();
        if (type === 'wish') showNotification('Wish marked as read', 'success');
    }

    if (type === 'birthday') {
        openBirthdayCalendar();
    } else if (type === 'task' || type === 'task_warning' || type === 'meeting') {
        // If it's a specific task assignment, try to open that task directly
        if (notif.task_id) {
            openTaskDetail(parseInt(notif.task_id));
        } else {
            if (currentUser.role === 'admin' || currentUser.role === 'Mentor' || currentUser.role === 'mentor' || currentUser.has_subordinates) {
                openTaskMentor();
            } else {
                openMyTasks();
            }
        }
    } else if (type === 'task_comment') {
        // Open the specific task detail
        const taskId = notif.task_id;
        if (taskId) {
            openTaskDetail(parseInt(taskId));
        }
    } else if (type === 'task_request' || type === 'idle_employee' || type === 'idle_employees_summary') {
        if (type === 'idle_employees_summary') {
            openAdminPanel();
            setTimeout(() => {
                const card = document.getElementById('manageEmployeesCard');
                if (card) {
                    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    card.style.transition = 'background 1s';
                    card.style.background = '#f0f9ff';
                    setTimeout(() => card.style.background = '', 2000);
                }
            }, 600);
        } else {
            // Mentor clicks on a task request or single idle employee notification
            openTaskMentor(notif.employee_id);
        }
    } else if (type === 'request') {
        if (currentUser.role === 'admin' || currentUser.role === 'Mentor' || currentUser.has_subordinates) {
            openRequestsModal();
        } else {
            openMyRequests('history');
        }
    }

    // Auto-close notification dropdown
    const dropdown = document.getElementById('notificationDropdown');
    if (dropdown) dropdown.style.display = 'none';
}

function updateNotificationBadge(count) {
    const badge = document.getElementById('notificationBadge');
    const label = document.getElementById('notifBellLabel');
    if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? 'inline-block' : 'none';
    }
    if (label) {
        label.textContent = count > 0 ? `${count} notification${count !== 1 ? 's' : ''}` : 'notifications';
    }
    // Wiggle the bell icon if there are new notifications
    if (count > 0) {
        const bellIcon = document.querySelector('.notif-bell-icon');
        if (bellIcon) {
            bellIcon.animate([
                { transform: 'rotate(0deg)' },
                { transform: 'rotate(-15deg)' },
                { transform: 'rotate(15deg)' },
                { transform: 'rotate(-10deg)' },
                { transform: 'rotate(0deg)' }
            ], { duration: 600, iterations: 2 });
        }
    }
}

function toggleNotifications() {
    const dropdown = document.getElementById('notificationDropdown');
    if (!dropdown) return;

    const isHidden = dropdown.style.display === 'none' || !dropdown.style.display;

    if (isHidden) {
        dropdown.style.display = 'block';
        // Restart animation
        dropdown.style.animation = 'none';
        dropdown.offsetHeight; // reflow
        dropdown.style.animation = '';
    } else {
        dropdown.style.display = 'none';
    }
}

// Close notification dropdown when clicking outside
document.addEventListener('click', function (e) {
    const dropdown = document.getElementById('notificationDropdown');
    const bellBtn = document.getElementById('notifBellBtn');
    if (dropdown && bellBtn && !bellBtn.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.style.display = 'none';
    }
});

async function markAllAsRead() {
    try {
        await apiCall('mark-notifications-read', 'POST', { user_id: currentUser.id });
        updateNotificationBadge(0);
        const dropdown = document.getElementById('notificationDropdown');
        if (dropdown) dropdown.style.display = 'none';

        showNotification('All notifications marked as read', 'success');
        loadNotifications(); // Refresh list
    } catch (e) {
        console.error('Failed to mark notifications as read', e);
    }
}


async function loadDashboardData() {
    if (!currentUser) return;
    showLoading();

    document.getElementById('userName').textContent = currentUser.name;
    const isMentor = currentUser.role === 'Mentor' || currentUser.has_subordinates || currentUser.role === 'mentor';
    const isAdmin = currentUser.role === 'admin';

    // Load custom widget layout
    initWidgetSizes();

    // Load notifications for all users
    loadNotifications();

    if (isAdmin) {
        // Admin sees admin stats grid and admin-specific cards
        document.getElementById('employeeStatsGrid')?.classList.add('hidden');
        document.getElementById('adminStatsGrid')?.classList.remove('hidden');
        document.getElementById('checkInCard')?.classList.add('hidden');
        document.getElementById('checkOutCard')?.classList.add('hidden');
        document.getElementById('recordsCard')?.classList.add('hidden');
        document.getElementById('adminCard')?.classList.remove('hidden');
        document.getElementById('assignMentorDashboardCard')?.classList.remove('hidden');
        document.getElementById('exportCard')?.classList.remove('hidden');
        document.getElementById('trainModelCard')?.classList.remove('hidden');
        document.getElementById('profileCard')?.classList.add('hidden');
        document.getElementById('myTasksCard')?.classList.remove('hidden');
        document.getElementById('myStatsCard')?.classList.remove('hidden');
        document.getElementById('temporaryTagsCard')?.classList.remove('hidden');
        document.getElementById('manageEmployeesCard')?.classList.add('hidden');
        document.getElementById('adminExportNote')?.classList.remove('hidden');

        await Promise.all([
            loadAdminSummary(),
            loadUpcomingBirthdays(),
            loadPendingRequests(),
            loadActiveTasks(),
            loadIntelligenceHubData()
        ]);
    } else {
        // Employee/Mentor section
        document.getElementById('adminStatsGrid')?.classList.add('hidden');
        document.getElementById('employeeStatsGrid')?.classList.remove('hidden');
        document.getElementById('profileCard')?.classList.remove('hidden');
        document.getElementById('adminCard')?.classList.add('hidden');
        document.getElementById('assignMentorDashboardCard')?.classList.add('hidden');
        document.getElementById('exportCard')?.classList.add('hidden');
        document.getElementById('trainModelCard')?.classList.add('hidden');
        document.getElementById('adminExportNote')?.classList.add('hidden');
        document.getElementById('myStatsCard')?.classList.remove('hidden');

        if (isMentor) {
            // Mentor specific tweaks: Show the relevant stats from admin grid
            document.getElementById('adminStatsGrid')?.classList.remove('hidden');
            document.getElementById('manageEmployeesCard')?.classList.remove('hidden');
            document.getElementById('taskMentorCard')?.classList.remove('hidden');
            document.getElementById('meetingMomCard')?.classList.remove('hidden');
            
            // Customize labels for Mentor context
            const summaryTitle = document.querySelector('#widget-admin-summary .stat-card-title');
            if (summaryTitle) summaryTitle.textContent = '👥 Team Summary';
            
            const requestsTitle = document.querySelector('#widget-admin-requests .stat-card-title');
            if (requestsTitle) requestsTitle.textContent = '📋 Team Requests';

            // Hide cards that mentors shouldn't see if necessary
            document.getElementById('widget-admin-birthdays')?.classList.add('hidden');
        } else {
            document.getElementById('manageEmployeesCard')?.classList.add('hidden');
            document.getElementById('taskMentorCard')?.classList.add('hidden');
            document.getElementById('meetingMomCard')?.classList.add('hidden');
        }

        // Initialize Intelligence Hub Visibility
        const intelligenceHubCard = document.getElementById('intelligenceHubCard');
        if (intelligenceHubCard) {
            intelligenceHubCard.classList.remove('hidden');
            document.getElementById('btnViewAnalysis') && (document.getElementById('btnViewAnalysis').style.display = '');
            document.getElementById('btnSearchPersonnel') && (document.getElementById('btnSearchPersonnel').style.display = '');
            document.getElementById('btnMyStats') && (document.getElementById('btnMyStats').style.display = '');
        }

        checkLocationPermission();

        // Load data
        const promises = [
            (async () => { try { await loadEmployeeProfile(); } catch (e) { console.error(e); } })(),
            (async () => { try { await loadTodayAttendance(); } catch (e) { console.error(e); } })(),
            (async () => { try { await loadMonthlyStats(); } catch (e) { console.error(e); } })(),
            (async () => { try { await loadWFHEligibility(); } catch (e) { console.error(e); } })(),
            (async () => { try { await refreshMyTasks(); } catch (e) { console.error(e); } })(),
            (async () => { try { await loadIntelligenceHubData(); } catch (e) { console.error(e); } })(),
            (async () => { try { await loadMentorStatus(); } catch (e) { console.error(e); } })()
        ];

        if (isMentor) {
            promises.push(loadAdminSummary());
            promises.push(loadPendingRequests());
            promises.push(loadActiveTasks());
        }

        await Promise.all(promises);
        await checkProfileCompleteness();
    }

    // Auto-load Task Manager V2 data in background
    if (window.TaskManagerV2) {
        TaskManagerV2.refresh();
    }

    try {
        await checkBirthday();
    } catch (e) {}
    
    hideLoading();
}

async function checkProfileCompleteness() {
    if (!currentUser) return;

    try {
        const res = await apiCall('check-profile-completeness', 'GET', { employee_id: currentUser.id });
        if (res && res.success) {
            if (!res.is_complete) {
                showProfileCompletionAlert(res.missing_fields, res.missing_docs);
            } else {
                const container = document.getElementById('profileCompletionAlert');
                if (container) {
                    container.classList.add('hidden');
                    container.innerHTML = '';
                }
            }
        }
    } catch (e) {
        console.error('Error checking profile completeness:', e);
    }
}

function showProfileCompletionAlert(missingFields, missingDocs) {
    const container = document.getElementById('profileCompletionAlert');
    if (!container) return;

    let message = '';
    if (missingFields.length > 0 && missingDocs.length > 0) {
        message = `Please fill mandatory fields (${missingFields.slice(0, 5).join(', ')}${missingFields.length > 5 ? '...' : ''}) and upload ${missingDocs.join(' & ')}.`;
    } else if (missingFields.length > 0) {
        message = `Please fill missing fields: ${missingFields.slice(0, 6).join(', ')}${missingFields.length > 6 ? '...' : ''}.`;
    } else if (missingDocs.length > 0) {
        message = `Please upload missing documents: ${missingDocs.join(' & ')}.`;
    }

    container.innerHTML = `
        <div class="profile-alert-card">
            <div class="profile-alert-icon">⚠️</div>
            <div class="profile-alert-content">
                <span class="profile-alert-title">Profile Incomplete</span>
                <span class="profile-alert-text">${message}</span>
            </div>
            <div class="profile-alert-action">
                <button class="btn btn-alert" onclick="openProfile()">Complete Now</button>
            </div>
        </div>
    `;
    container.classList.remove('hidden');
}

// Admin Dashboard Functions
async function loadAdminSummary() {
    try {
        const res = await apiCall('admin-summary', 'GET', { user_id: currentUser.id });
        if (res && res.success) {
            // Update Main Workforce Card (Excluding Admins)
            const summaryCard = document.getElementById('widget-admin-summary');
            if (summaryCard) {
                const titleEl = summaryCard.querySelector('.stat-card-title');
                if (titleEl) {
                    if (currentUser.role === 'admin') {
                        titleEl.innerHTML = '📊 Daily Workforce <small style="font-size:0.7rem; opacity:0.6;">(Excl. Admin)</small>';
                    } else {
                        titleEl.innerHTML = '👥 Team Summary';
                    }
                }
            }

            const totalEl = document.getElementById('totalEmployees');
            const presentEl = document.getElementById('presentToday');
            const surveyorSummaryEl = document.getElementById('surveyorsPresent');
            
            if (totalEl) totalEl.textContent = res.total_employees || 0;
            if (presentEl) presentEl.textContent = `${res.present_today || 0} active today`;
            
            // Keep a simple summary line on the dashboard card
            if (surveyorSummaryEl) {
                surveyorSummaryEl.textContent = `${res.surveyors_present || 0} Surveyors Active Today`;
                surveyorSummaryEl.style.fontSize = '0.85rem';
                surveyorSummaryEl.style.marginTop = '4px';
                surveyorSummaryEl.style.color = 'var(--primary, #2563eb)';
                surveyorSummaryEl.style.fontWeight = '600';
            }
        }
    } catch (error) {
        console.error('Error loading admin summary:', error);
    }
}



async function loadPendingRequests() {
    try {
        const res = await apiCall('pending-requests', 'GET', { user_id: currentUser.id });
        if (res && res.success) {
            document.getElementById('pendingRequests').textContent = res.count || 0;
        }
    } catch (error) {
        console.error('Error loading pending requests:', error);
    }
}

async function loadActiveTasks() {
    try {
        const res = await apiCall('active-tasks', 'GET', { employee_id: currentUser.id });
        if (res && res.success) {
            document.getElementById('activeTasks').textContent = res.count || 0;
        }
    } catch (error) {
        console.error('Error loading active tasks:', error);
    }
}

// Admin Card Click Handlers
async function showEmployeeSummary(targetDateStr = null) {
    if (!(currentUser.role === 'admin' || currentUser.role === 'Mentor' || currentUser.has_subordinates)) {
        showNotification('Access denied', 'error');
        return;
    }

    // Handle date tracking
    if (targetDateStr) {
        currentSummaryDate = new Date(targetDateStr);
    } else if (!currentSummaryDate) {
        currentSummaryDate = getCurrentISTDate();
    }

    const formattedDateForApi = currentSummaryDate.toISOString().split('T')[0];
    const todayStr = getCurrentISTDate().toISOString().split('T')[0];
    const isToday = formattedDateForApi === todayStr;

    showLoading(targetDateStr ? `Loading summary for ${formatDateDMY(currentSummaryDate)}...` : "Generating workforce summary...");
    
    try {
        const res = await apiCall('admin-summary', 'GET', { 
            user_id: currentUser.id,
            date: formattedDateForApi 
        });

        if (res && res.success) {
            const summary = res;

            // Updated Minimal Date Nav
            const dateNavHtml = `
                <div class="summary-date-nav" style="display: flex; align-items: center; justify-content: center; gap: 12px; margin: 4px 0 10px 0; width: 100%;">
                    <button onclick="changeSummaryDate(-1)" class="nav-btn-minimal" title="Previous Day" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 50%; width: 28px; height: 28px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease; flex-shrink: 0;">
                        <span style="color: #64748b; font-size: 1rem; font-weight: 400;">‹</span>
                    </button>
                    
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 0px; min-width: 90px;">
                        <span style="font-weight: 800; color: #1e293b; font-size: 0.9rem; letter-spacing: -0.01em; white-space: nowrap;">${formatDateDMY(currentSummaryDate)}</span>
                        ${!isToday ? `<a href="javascript:void(0)" onclick="resetSummaryDate()" style="color: #3b82f6; font-size: 0.65rem; font-weight: 700; text-decoration: none; text-transform: uppercase; letter-spacing: 0.02em;">Today</a>` : '<span style="color: #94a3b8; font-size: 0.6rem; font-weight: 700; text-transform: uppercase;">Current Data</span>'}
                    </div>

                    <button onclick="${isToday ? 'void(0)' : 'changeSummaryDate(1)'}" class="nav-btn-minimal" title="Next Day" style="background: ${isToday ? '#f1f5f9' : '#f8fafc'}; border: 1px solid #e2e8f0; border-radius: 50%; width: 28px; height: 28px; cursor: ${isToday ? 'not-allowed' : 'pointer'}; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease; flex-shrink: 0; ${isToday ? 'opacity: 0.3;' : ''}">
                        <span style="color: #64748b; font-size: 1rem; font-weight: 400;">›</span>
                    </button>
                </div>
            `;

            // Create premium modal content
            const content = `
                <div class="summary-modal-container">
                    <button class="modal-close-btn" onclick="safeRemoveModal(this.closest('.modal'))">✕</button>
                    
                    <div class="summary-header" style="text-align: center; border-bottom: 1px solid #f1f5f9; padding: 10px 5px 5px 5px;">
                        <h3 style="margin-bottom: 8px; font-size: 1.1rem; display: flex; align-items: center; justify-content: center; gap: 8px;">
                            <span style="background: #eff6ff; padding: 5px; border-radius: 10px; font-size: 0.9rem;">📊</span> 
                            Daily Overview
                        </h3>
                        ${dateNavHtml}
                    </div>

                    <div class="summary-hero" style="margin-top: 20px;">
                        <span class="hero-label">TOTAL WORKFORCE</span>
                        <span class="hero-value">${summary.total_employees || 0}</span>
                        <div class="hero-subtitle">Active Employees <small>(Excl. Admin)</small></div>
                    </div>

                    <div class="summary-grid">
                        <div class="summary-card" onclick='showNamesModal("Present Today", ${JSON.stringify(summary.present_names).replace(/"/g, "&quot;")})' style="cursor: pointer;">
                            <div class="summary-icon icon-present">🟢</div>
                            <div class="summary-data">
                                <span class="value">${summary.present_today || 0}</span>
                                <span class="label">Present Today</span>
                            </div>
                        </div>

                        <div class="summary-card" onclick='showNamesModal("Not Marked Today", ${JSON.stringify(summary.absent_names).replace(/"/g, "&quot;")})' style="cursor: pointer;">
                            <div class="summary-icon icon-absent">🔴</div>
                            <div class="summary-data">
                                <span class="value">${summary.absent_today || 0}</span>
                                <span class="label">Not Marked Today</span>
                            </div>
                        </div>

                        <div class="summary-card" onclick='showNamesModal("Work From Home", ${JSON.stringify(summary.wfh_names).replace(/"/g, "&quot;")})' style="cursor: pointer;">
                            <div class="summary-icon icon-wfh">🏠</div>
                            <div class="summary-data">
                                <span class="value">${summary.wfh_today || 0}</span>
                                <span class="label">Work From Home</span>
                            </div>
                        </div>

                        <div class="summary-card" onclick='showNamesModal("On Leave", ${JSON.stringify(summary.leave_names).replace(/"/g, "&quot;")})' style="cursor: pointer;">
                            <div class="summary-icon icon-leave">🏖️</div>
                            <div class="summary-data">
                                <span class="value">${summary.on_leave || 0}</span>
                                <span class="label">On Leave</span>
                            </div>
                        </div>
                        
                        <!-- INTEGRATED SURVEYOR REPORT SECTION -->
                        <div class="surveyor-report-container">
                            <!-- Header Row -->
                            <div class="surveyor-report-header">
                                <div style="display: flex; align-items: center; gap: 12px;">
                                    <div class="surveyor-report-icon">📋</div>
                                    <div>
                                        <div class="surveyor-report-title">Surveyors Report</div>
                                        <div class="surveyor-report-subtitle">Real-time Presence</div>
                                    </div>
                                </div>
                                <div class="surveyor-report-stat">
                                    <div class="surveyor-report-count">
                                        ${summary.surveyors_present || 0}<small>/${summary.surveyors_total || 0}</small>
                                    </div>
                                    <div class="surveyor-report-label">Present</div>
                                </div>
                            </div>
                            
                            <!-- Breakdown Grid -->
                            <div class="surveyor-breakdown-grid">
                                <div class="surveyor-breakdown-item" onclick='showNamesModal("Surveyors: Field", ${JSON.stringify(summary.surveyors_client_names).replace(/"/g, "&quot;")})' style="cursor: pointer;">
                                    <div style="font-size: 1.3rem; font-weight: 800; color: #10b981;">${summary.surveyors_client || 0}</div>
                                    <div style="font-size: 0.65rem; color: #94a3b8; font-weight: 700; text-transform: uppercase; margin-top: 4px;">Field</div>
                                </div>
                                <div class="surveyor-breakdown-item" onclick='showNamesModal("Surveyors: Office", ${JSON.stringify(summary.surveyors_office_names).replace(/"/g, "&quot;")})' style="cursor: pointer;">
                                    <div style="font-size: 1.3rem; font-weight: 800; color: #3b82f6;">${summary.surveyors_office || 0}</div>
                                    <div style="font-size: 0.65rem; color: #94a3b8; font-weight: 700; text-transform: uppercase; margin-top: 4px;">Office</div>
                                </div>
                                <div class="surveyor-breakdown-item" onclick='showNamesModal("Surveyors: WFH", ${JSON.stringify(summary.surveyors_wfh_names).replace(/"/g, "&quot;")})' style="cursor: pointer;">
                                    <div style="font-size: 1.3rem; font-weight: 800; color: #f59e0b;">${summary.surveyors_wfh || 0}</div>
                                    <div style="font-size: 0.65rem; color: #94a3b8; font-weight: 700; text-transform: uppercase; margin-top: 4px;">WFH</div>
                                </div>
                                <div class="surveyor-breakdown-item" onclick='showNamesModal("Surveyors: Leave", ${JSON.stringify(summary.surveyors_leave_names).replace(/"/g, "&quot;")})' style="cursor: pointer;">
                                    <div style="font-size: 1.3rem; font-weight: 800; color: #ef4444;">${summary.surveyors_leave || 0}</div>
                                    <div style="font-size: 0.65rem; color: #94a3b8; font-weight: 700; text-transform: uppercase; margin-top: 4px;">Leave</div>
                                </div>
                                <div class="surveyor-breakdown-item" onclick='showNamesModal("Surveyors: Not Marked", ${JSON.stringify(summary.surveyors_absent_names).replace(/"/g, "&quot;")})' style="cursor: pointer;">
                                    <div style="font-size: 1.3rem; font-weight: 800; color: #64748b;">${summary.surveyors_absent || 0}</div>
                                    <div style="font-size: 0.65rem; color: #94a3b8; font-weight: 700; text-transform: uppercase; margin-top: 4px;">Not Marked</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // If there's already a modal open, just update its content to avoid backdrop stacking
            const existingModal = document.querySelector('.modal.summary-modal-active');
            if (existingModal) {
                const modalContent = existingModal.querySelector('.modal-content');
                if (modalContent) {
                    modalContent.innerHTML = content;
                    return;
                }
            }

            // Create modal wrapper
            const modal = document.createElement('div');
            modal.className = 'modal summary-modal-active'; 
            modal.style.display = 'flex'; 
            modal.style.alignItems = 'flex-start'; 
            modal.style.overflowY = 'auto'; 
            modal.style.padding = '40px 10px'; 
            
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 600px; width: 95%; padding: 0; border-radius: 20px; border: none; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); margin: auto; overflow: visible; flex: none;">
                    ${content}
                </div>
            `;

            document.body.appendChild(modal);

            // Trigger animation
            requestAnimationFrame(() => {
                modal.classList.add('active');
                updateScrollLock();
            });

            // Close on outside click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    safeRemoveModal(modal);
                    currentSummaryDate = null; // Reset on close
                }
            });

        }
    } catch (error) {
        console.error('Error showing employee summary:', error);
        showNotification('Error loading employee summary', 'error');
    } finally {
        hideLoading();
    }
}

async function changeSummaryDate(offset) {
    if (!currentSummaryDate) currentSummaryDate = getCurrentISTDate();
    
    // Logic: check if next day is in future
    const newDate = new Date(currentSummaryDate);
    newDate.setDate(newDate.getDate() + offset);
    
    const todayStr = getCurrentISTDate().toISOString().split('T')[0];
    const newDateStr = newDate.toISOString().split('T')[0];
    
    if (newDateStr > todayStr) {
        return; // Don't allow future dates
    }
    
    currentSummaryDate = newDate;
    await showEmployeeSummary();
}

async function resetSummaryDate() {
    currentSummaryDate = getCurrentISTDate();
    await showEmployeeSummary();
}

/**
 * Shows a premium sub-modal with names of employees in a specific category
 */
function showNamesModal(title, names) {
    if (!names || names.length === 0) {
        showNotification(`No employees found for ${title}`, 'info');
        return;
    }

    const content = `
        <div class="names-list-container" style="padding: 20px;">
            <button class="modal-close-btn" onclick="safeRemoveModal(this.closest('.modal'))">✕</button>
            <div style="margin-bottom: 20px; border-bottom: 2px solid #f1f5f9; padding-bottom: 10px;">
                <h3 style="margin: 0; font-size: 1.25rem; color: #1e293b; display: flex; align-items: center; gap: 10px;">
                    <span style="background: #eff6ff; padding: 6px; border-radius: 12px;">👥</span>
                    ${title}
                </h3>
                <p style="margin: 4px 0 0; color: #64748b; font-size: 0.85rem; font-weight: 600;">
                    ${names.length} employee${names.length === 1 ? '' : 's'} listed
                </p>
            </div>
            <div class="names-scroll-area" style="max-height: 400px; overflow-y: auto; padding-right: 5px;">
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px;">
                    ${names.sort().map((name, idx) => `
                        <div class="name-item" style="background: #f8fafc; padding: 12px 15px; border-radius: 12px; border: 1px solid #e2e8f0; font-weight: 700; color: #334155; font-size: 0.9rem; display: flex; align-items: center; gap: 10px; transition: all 0.2s ease;">
                            <span style="color: #94a3b8; font-size: 0.75rem;">${idx + 1}.</span>
                            ${name}
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;

    const modal = document.createElement('div');
    modal.className = 'modal sub-modal-active';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.zIndex = '10002'; // Higher than summary modal

    modal.innerHTML = `
        <div class="modal-content" style="max-width: 500px; width: 90%; padding: 0; border-radius: 24px; border: none; box-shadow: 0 30px 60px -12px rgba(0,0,0,0.6); animation: modalPop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);">
            ${content}
        </div>
    `;

    document.body.appendChild(modal);

    requestAnimationFrame(() => {
        modal.classList.add('active');
        updateScrollLock();
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) safeRemoveModal(modal);
    });
}







// Birthday Calendar Functions
async function loadUpcomingBirthdays() {
    try {
        const res = await apiCall('upcoming-birthdays', 'GET');
        if (res && res.success) {
            document.getElementById('upcomingBirthdays').textContent = res.count || 0;
        }
    } catch (error) {
        console.error('Error loading upcoming birthdays:', error);
    }
}

function refreshBirthdayCalendar() {
    openBirthdayCalendar();
}

// --- Premium Birthday Calendar Logic ---

async function openBirthdayCalendar() {
    showLoading("Opening birthday celebrations...");
    const content = document.getElementById('birthdayCalendarContent');
    // Premium loading state
    content.innerHTML = '<div class="text-center" style="padding: 40px; color:#64748b;"><div class="loading-spinner" style="border-top-color:#3b82f6; border-bottom-color:#3b82f6;"></div><p style="margin-top:16px; font-weight:600;">Loading Calendar...</p></div>';

    openModal('birthdayCalendarModal');

    if (typeof window.currentBirthdayMonth === 'undefined') {
        const d = new Date();
        window.currentBirthdayMonth = d.getMonth();
        window.currentBirthdayYear = d.getFullYear();
    }

    const viewingMonth = window.currentBirthdayMonth;
    const viewingYear = window.currentBirthdayYear;

    const monthToSend = viewingMonth + 1;
    const yearToSend = viewingYear;

    // Load all birthdays once for global search if not already loaded
    if (!window.allBirthdaysLoaded) {
        loadAllBirthdays();
    }

    try {
        const res = await apiCall(`upcoming-birthdays?month=${monthToSend}&year=${yearToSend}`, 'GET');
        if (res && res.success) {
            const birthdays = res.birthdays || [];
            
            // Also fetch holidays for the current view
            const holidaysRes = await apiCall(`holidays?year=${yearToSend}`, 'GET');
            window.viewingHolidays = (holidaysRes && holidaysRes.success) ? holidaysRes.holidays : [];
            
            const total = birthdays.length;
            const currentDate = getCurrentISTDate();
            const upcoming = birthdays.filter(b => {
                const bDate = new Date(b.date_of_birth);
                // Compare only month and day for "upcoming" in the viewed month
                const todayMonth = currentDate.getMonth();
                const todayDay = currentDate.getDate();
                const bMonth = bDate.getMonth();
                const bDay = bDate.getDate();

                if (viewingYear > currentDate.getFullYear()) return true;
                if (viewingYear < currentDate.getFullYear()) return false;
                if (viewingMonth > todayMonth) return true;
                if (viewingMonth < todayMonth) return false;
                return bDay >= todayDay;
            }).length;

            const calendarData = createBirthdayCalendarData(birthdays, viewingYear, viewingMonth);
            const dateStr = new Date(viewingYear, viewingMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

            content.innerHTML = `
                <div class="premium-calendar-wrap">
                    <!-- Premium Header -->
                    <div class="premium-header">
                        <div class="header-title">
                            <span style="font-size: 1.8rem;">📅</span>
                            <div style="display:flex; flex-direction:column;">
                                <span style="font-size: 1.4rem; font-weight: 800; color: #1e293b;">${dateStr}</span>
                                <span style="font-size: 0.85rem; font-weight: 500; color: #64748b;">Employee Birthdays</span>
                            </div>
                        </div>
                        <div style="display:flex; gap:12px; align-items:center;">
                            <div class="btn-group-premium" style="display:flex; background: #f1f5f9; padding: 4px; border-radius: 12px; gap: 4px; border: 1px solid #e2e8f0;">
                                <button class="btn-premium-toggle" onclick="changeBirthdayMonth(-1)" style="width:36px; height:36px; display:flex; align-items:center; justify-content:center; border-radius:8px; font-weight:800;" title="Previous Month">←</button>
                                <button class="btn-premium-toggle active" onclick="jumpToToday()" style="padding:0 16px; border-radius:8px; font-weight:700; font-size:0.85rem;">Today</button>
                                <button class="btn-premium-toggle" onclick="changeBirthdayMonth(1)" style="width:36px; height:36px; display:flex; align-items:center; justify-content:center; border-radius:8px; font-weight:800;" title="Next Month">→</button>
                            </div>
                            <!-- Holiday Features -->
                            <button onclick="openHolidayCalendarModal()" title="View Holiday Calendar" 
                                style="background: linear-gradient(135deg, #10b981, #059669); border: none; border-radius: 12px; padding: 0 16px; height: 40px; color: white; font-size: 0.85rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 6px rgba(16, 185, 129, 0.2); transition: all 0.2s;">
                                🗓️ Holidays
                            </button>
                            ${currentUser.role === 'admin' ? `
                            <button onclick="openHolidayUploadModal()" title="Upload Holiday File" 
                                style="background: linear-gradient(135deg, #6366f1, #4f46e5); border: none; border-radius: 12px; padding: 0 16px; height: 40px; color: white; font-size: 0.85rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 6px rgba(99, 102, 241, 0.2); transition: all 0.2s;">
                                📂 Upload
                            </button>` : ''}
                            
                            <button onclick="closeModal('birthdayCalendarModal')" style="background: white; border: 1px solid #fee2e2; color: #ef4444; width:40px; height:40px; border-radius:12px; font-size:1.5rem; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.2s; box-shadow:0 2px 4px rgba(0,0,0,0.05);">×</button>
                        </div>
                    </div>

                    <div class="calendar-main-split">
                        <!-- Left: Clean Calendar -->
                        <div class="clean-calendar-panel">
                            <div class="clean-calendar" style="box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.05);">
                                ${createBirthdayCalendarHTML(calendarData, viewingYear, viewingMonth)}
                            </div>
                        </div>

                        <!-- Right: Premium Side Panel -->
                        <div class="premium-side-panel">
                            <!-- Stats Chips -->
                            <div class="premium-stats">
                                <div class="premium-stat-card">
                                    <span class="premium-stat-val" style="color:#8b5cf6;">${total}</span>
                                    <span class="premium-stat-label">Total</span>
                                </div>
                                <div class="premium-stat-card">
                                    <span class="premium-stat-val" style="color:#10b981;">${upcoming}</span>
                                    <span class="premium-stat-label">Upcoming</span>
                                </div>
                            </div>

                            <!-- Search -->
                            <div style="position:relative;">
                                <span style="position:absolute; left:12px; top:50%; transform:translateY(-50%); color:#94a3b8;">🔍</span>
                                <input type="text" class="premium-search" style="padding-left:40px;" placeholder="Search birthdays..." onkeyup="filterPremiumList(this.value)">
                            </div>

                            <!-- List -->
                            <div style="margin-top: 8px; font-weight: 700; font-size: 0.8rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em;">List View</div>
                            <div class="premium-list" id="premiumListContainer">
                                ${createPremiumListHTML(birthdays)}
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // Store birthdays for current view
            window.birthdayData = birthdays;
        } else {
            content.innerHTML = '<div class="text-center" style="padding: 40px;"><p class="text-danger">Failed to load data</p><button class="btn-premium btn-premium-danger" onclick="closeModal(\'birthdayCalendarModal\')">Close</button></div>';
        }
    } catch (error) {
        console.error('Error loading birthday calendar:', error);
        content.innerHTML = '<div class="text-center" style="padding: 40px;"><p class="text-danger">System Error</p><button class="btn-premium btn-premium-danger" onclick="closeModal(\'birthdayCalendarModal\')">Close</button></div>';
    } finally {
        hideLoading();
    }
}

// Helper Functions for Features
function jumpToToday() {
    const d = new Date();
    window.currentBirthdayMonth = d.getMonth();
    window.currentBirthdayYear = d.getFullYear();
    openBirthdayCalendar();
}

function createBirthdayListHTML(birthdays) {
    if (!birthdays || birthdays.length === 0) {
        return '<p class="text-muted text-center" style="margin-top:20px;">No birthdays this month.</p>';
    }

    return birthdays.map(b => `
        <div class="birthday-list-item" onclick="selectBirthdayFromList(this, '${b.name}')">
            <div class="birthday-list-avatar">${b.name.charAt(0)}</div>
            <div class="birthday-list-details">
                <h5>${b.name}</h5>
                <p>${new Date(b.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} • Turning ${b.age}</p>
            </div>
        </div>
    `).join('');
}

function filterBirthdayList(query) {
    const list = document.getElementById('birthdayListContainer');
    const items = list.getElementsByClassName('birthday-list-item');
    const term = query.toLowerCase();

    Array.from(items).forEach(item => {
        const name = item.querySelector('h5').textContent.toLowerCase();
        if (name.includes(term)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

function selectBirthdayFromList(el, name) {
    // Highlight
    document.querySelectorAll('.birthday-list-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');

    // Show Action
    const actionArea = document.getElementById('selectedBirthdayAction');
    actionArea.style.display = 'block';

    // In a real app, we'd store the selected person ID to send the wish
    window.selectedBirthdayPerson = name;
}

function sendBirthdayWish() {
    if (!window.selectedBirthdayPerson) return;

    // Simulate action
    const btn = document.querySelector('.btn-wish');
    const originalText = btn.innerHTML;

    btn.innerHTML = '<span>🚀</span> Sent!';
    btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';

    setTimeout(() => {
        btn.innerHTML = originalText;
        btn.style.background = ''; // reset to CSS default
        alert(`Best wishes sent to ${window.selectedBirthdayPerson}!`);
    }, 1500);
}

async function loadAllBirthdays() {
    try {
        const res = await apiCall('upcoming-birthdays?all=1', 'GET');
        // If 'all' param isn't supported by backend, we'd need to loop or change backend.
        // Assuming backend support or that we might need to adjust.
        // Actually, looking at views.py, it only filters by month if month param is provided.
        // Wait, views.py 1401: current_month = int(request.GET.get('month', today.month))
        // So it ALWAYS filters by month. I should probably update backend or fetch all 12.

        // I will fetch all 12 months for true global search if backend doesn't support 'all'
        let allBirthdays = [];
        const promises = [];
        for (let i = 1; i <= 12; i++) {
            promises.push(apiCall(`upcoming-birthdays?month=${i}`, 'GET'));
        }

        const results = await Promise.all(promises);
        results.forEach(r => {
            if (r.success) allBirthdays = allBirthdays.concat(r.birthdays);
        });

        // Remove duplicates if any (though there shouldn't be across months)
        window.allBirthdays = allBirthdays;
        window.allBirthdaysLoaded = true;
    } catch (e) {
        console.error("Failed to load all birthdays:", e);
    }
}

// Helpers for Futuristic Calendar
function createPremiumListHTML(birthdays) {
    if (!birthdays || birthdays.length === 0) {
        return '<p class="text-center" style="margin-top:20px; color:#94a3b8; font-size:0.9rem;">No birthdays found.</p>';
    }

    return birthdays.map((b, idx) => {
        const dateObj = new Date(b.date_of_birth);
        const zodiac = getZodiacSign(dateObj.getDate(), dateObj.getMonth() + 1);
        const daysLeft = getDaysLeft(dateObj);

        // HSL-tailored premium avatar background
        const colors = [
            { bg: '#eff6ff', border: '#bfdbfe', text: '#2563eb' }, // Blue
            { bg: '#fef2f2', border: '#fecaca', text: '#ef4444' }, // Red
            { bg: '#f0fdf4', border: '#bbf7d0', text: '#16a34a' }, // Green
            { bg: '#fdf4ff', border: '#f5d0fe', text: '#a21caf' }, // Purple
            { bg: '#fff7ed', border: '#ffedd5', text: '#ea580c' }  // Orange
        ];
        const color = colors[b.name.length % colors.length];

        let timeLeftHtml = '';
        if (daysLeft === 0) timeLeftHtml = '<span style="color:#10b981; font-weight:700; font-size:0.75rem;">🎉 TODAY</span>';
        else if (daysLeft > 0) timeLeftHtml = `<span style="color:#64748b; font-size:0.75rem;">in ${daysLeft} days</span>`;
        else timeLeftHtml = '<span style="color:#94a3b8; font-size:0.75rem;">passed</span>';

        return `
            <div class="premium-list-item" onclick="selectBirthday('${b.id}', '${b.name}', '${b.date_of_birth}', '${zodiac}', '${daysLeft}')" style="animation: slideInLeft 0.3s forwards; animation-delay: ${idx * 40}ms; opacity:0; transform:translateX(-10px); padding: 14px;">
                <div class="premium-avatar" style="background: ${color.bg}; border-color: ${color.border}; color: ${color.text}; width:48px; height:48px; font-size:1.2rem;">${b.name.charAt(0)}</div>
                <div class="premium-info" style="flex:1;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                        <h5 style="margin:0; font-size:1.05rem; font-weight:700; color:#1e293b;">${b.name}</h5>
                        ${timeLeftHtml}
                    </div>
                    <div class="premium-meta" style="display:flex; gap:6px; flex-wrap:wrap;">
                        <span class="premium-badge" style="background:rgba(139, 92, 246, 0.1); color:#7c3aed; font-size:0.65rem; padding:2px 6px;">${zodiac}</span>
                        ${b.department ? `<span class="premium-badge" style="background:rgba(59, 130, 246, 0.1); color:#2563eb; font-size:0.65rem; padding:2px 6px;">${b.department}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function filterPremiumList(query) {
    const list = document.getElementById('premiumListContainer');
    const term = query.toLowerCase();

    if (!term) {
        // Reset to current month's birthdays
        list.innerHTML = createPremiumListHTML(window.birthdayData);
        return;
    }

    // Search globally
    const filteredGlobal = window.allBirthdays.filter(b => b.name.toLowerCase().includes(term));
    list.innerHTML = createPremiumGlobalListHTML(filteredGlobal);
}

function createPremiumGlobalListHTML(birthdays) {
    if (!birthdays || birthdays.length === 0) {
        return '<p class="text-center" style="margin-top:20px; color:#94a3b8; font-size:0.9rem;">No matches found.</p>';
    }

    return birthdays.map((b, idx) => {
        const dateObj = new Date(b.date_of_birth);
        const monthName = dateObj.toLocaleDateString('en-US', { month: 'short' });
        const day = dateObj.getDate();
        const zodiac = getZodiacSign(day, dateObj.getMonth() + 1);

        return `
            <div class="premium-list-item" onclick="jumpToBirthday('${b.date_of_birth}')" style="animation: slideInLeft 0.3s forwards; animation-delay: ${idx * 50}ms; opacity:0; transform:translateX(-10px);">
                <div class="premium-avatar">${b.name.charAt(0)}</div>
                <div class="premium-info">
                    <h5>${b.name}</h5>
                    <div class="premium-meta">
                        <span style="color:#3b82f6; font-weight:600;">${monthName} ${day}</span>
                        <span>•</span>
                        <span class="premium-badge">${zodiac}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function jumpToBirthday(dateStr) {
    const date = new Date(dateStr);
    window.currentBirthdayMonth = date.getMonth();
    window.currentBirthdayYear = getCurrentISTDate().getFullYear(); // Assume current year view
    openBirthdayCalendar();
}

function selectBirthday(id, name, dateStr, zodiac, daysLeft) {
    const list = document.getElementById('premiumListContainer');
    const sidePanel = document.querySelector('.premium-side-panel');

    // Create or find detail container
    let detailContainer = document.getElementById('birthdayDetailContainer');
    if (!detailContainer) {
        detailContainer = document.createElement('div');
        detailContainer.id = 'birthdayDetailContainer';
        detailContainer.className = 'premium-birthday-detail';
        sidePanel.appendChild(detailContainer);
    }

    const fullDate = new Date(dateStr).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    const isToday = parseInt(daysLeft) === 0;

    detailContainer.innerHTML = `
        <div style="animation: slideScaleIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; background: white; border: 1px solid rgba(226, 232, 240, 0.6); border-radius: 24px; padding: 24px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.05); margin-top: 10px; position: relative; overflow: hidden;">
            <div style="position: absolute; top:0; left:0; right:0; height:80px; background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); z-index:0; opacity:0.5;"></div>
            
            <div style="position: relative; z-index:1;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 24px;">
                    <div class="premium-avatar" style="width: 64px; height: 64px; font-size: 1.8rem; border-radius: 18px; background: white; border: 2px solid #3b82f6; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">${name.charAt(0)}</div>
                    <button onclick="closeBirthdayDetail()" style="background:white; border: 1px solid #e2e8f0; color:#94a3b8; width:32px; height:32px; border-radius:10px; cursor:pointer; font-size:1.2rem; display:flex; align-items:center; justify-content:center; transition: all 0.2s;">×</button>
                </div>
                
                <h4 style="margin: 0 0 4px; font-size: 1.4rem; font-weight: 800; color: #1e293b;">${name}</h4>
                <div style="display:flex; align-items:center; gap:8px;">
                    <p style="margin: 0; color: #64748b; font-size: 0.9rem; font-weight: 500;">${fullDate}</p>
                    ${isToday ? '<span style="background:#dcfce7; color:#16a34a; font-size:0.7rem; font-weight:800; padding:2px 8px; border-radius:20px; text-transform:uppercase;">Birthday Today! 🎂</span>' : ''}
                </div>
                
                <div style="margin-top: 28px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div style="background: #f8fafc; padding: 16px; border-radius: 16px; border: 1px solid #f1f5f9;">
                        <span style="display:block; font-size: 0.7rem; font-weight: 800; color: #94a3b8; text-transform: uppercase; margin-bottom:8px; letter-spacing:0.05em;">Zodiac Sign</span>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span style="font-size:1.2rem;">✨</span>
                            <span style="font-weight: 700; color: #1e293b; font-size: 0.95rem;">${zodiac}</span>
                        </div>
                    </div>
                    <div style="background: #f8fafc; padding: 16px; border-radius: 16px; border: 1px solid #f1f5f9;">
                        <span style="display:block; font-size: 0.7rem; font-weight: 800; color: #94a3b8; text-transform: uppercase; margin-bottom:8px; letter-spacing:0.05em;">Schedule</span>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span style="font-size:1.2rem;">⏳</span>
                            <span style="font-weight: 700; color: #1e293b; font-size: 0.95rem;">${isToday ? 'Celebration' : (parseInt(daysLeft) >= 0 ? `In ${daysLeft} days` : 'Passed')}</span>
                        </div>
                    </div>
                </div>

                <div style="margin-top: 24px;">
                    <button class="btn-wish" onclick="confirmWish('${id}', '${name}')" ${currentUser?.id == id ? 'disabled' : ''} style="width:100%; height:48px; border-radius:14px; background: ${currentUser?.id == id ? '#cbd5e1' : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)'}; color:white; font-weight:700; border:none; cursor:${currentUser?.id == id ? 'default' : 'pointer'}; box-shadow:${currentUser?.id == id ? 'none' : '0 4px 12px rgba(37, 99, 235, 0.2)'}; transition:all 0.2s; display:flex; align-items:center; justify-content:center; gap:8px;">
                        <span>✨</span> ${currentUser?.id == id ? 'Your Special Day!' : 'Send a Wish'}
                    </button>
                </div>
            </div>
        </div>
    `;

    // Hide stats to show detail if needed, or just append
    const statsArea = document.querySelector('.premium-stats');
    if (statsArea) statsArea.style.display = 'none';

    const searchArea = document.querySelector('.premium-search')?.parentElement;
    if (searchArea) searchArea.style.display = 'none';

    detailContainer.scrollIntoView({ behavior: 'smooth' });
}
function closeBirthdayDetail() {
    const detailContainer = document.getElementById('birthdayDetailContainer');
    if (detailContainer) detailContainer.innerHTML = '';

    const statsArea = document.querySelector('.premium-stats');
    if (statsArea) statsArea.style.display = 'flex';

    const searchArea = document.querySelector('.premium-search')?.parentElement;
    if (searchArea) searchArea.style.display = 'block';
}

async function confirmWish(id, name) {
    if (id == currentUser.id) {
        showNotification("You can't send wishes to yourself!", 'warning');
        return;
    }

    // Call API
    try {
        const btn = document.querySelector('.btn-wish');
        if (btn) {
            btn.innerHTML = 'Sending...';
            btn.disabled = true;
        }

        const wisherName = currentUser ? currentUser.name || currentUser.username : "Someone";
        const wishMessage = `${wisherName} wishes you a very Happy Birthday`;

        const result = await apiCall('send-wish', 'POST', {
            sender_id: currentUser.id,
            receiver_id: id,
            message: wishMessage
        });

        if (result.success) {
            showNotification(`Best wishes sent to ${name}! 🎉`, 'success');

            // Show FX for wisher as immediate feedback
            const wisherName = currentUser ? currentUser.name || currentUser.username : "Someone";
            showBirthdayWishFX(`${wisherName} wishes you a very Happy Birthday`, 'male'); // Use generic gender for feedback

            if (btn) {
                btn.innerHTML = '<span>✅</span> Wishes Sent';
                btn.style.background = '#4ade80';
            }
        } else {
            showNotification(result.message || "Failed to send wishes", 'error');
            if (btn) {
                btn.innerHTML = '<span>🎈</span> Send Wishes';
                btn.disabled = false;
            }
        }
    } catch (e) {
        console.error(e);
        showNotification("An error occurred", 'error');
        const btn = document.querySelector('.btn-wish');
        if (btn) {
            btn.innerHTML = '<span>🎈</span> Send Wishes';
            btn.disabled = false;
        }
    }
}

function getZodiacSign(day, month) {
    const zodiacSigns = [
        'Capricorn', 'Aquarius', 'Pisces', 'Aries', 'Taurus', 'Gemini',
        'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius'
    ];
    const endDates = [19, 18, 20, 19, 20, 20, 22, 22, 22, 22, 21, 21];

    if (day <= endDates[month - 1]) {
        return zodiacSigns[month - 1];
    } else {
        return zodiacSigns[month % 12];
    }
}

function getDaysLeft(targetDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(targetDate);

    // Normalize to the viewed year if possible, otherwise use current year
    const viewedYear = window.currentBirthdayYear || today.getFullYear();

    // Handle Feb 29 on non-leap years (use Feb 28 to match backend logic)
    if (target.getMonth() === 1 && target.getDate() === 29) {
        const isLeap = (viewedYear % 4 === 0 && viewedYear % 100 !== 0) || (viewedYear % 400 === 0);
        if (!isLeap) {
            target.setDate(28);
        }
    }

    target.setFullYear(viewedYear);
    target.setHours(0, 0, 0, 0);

    const diffTime = target - today;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function createBirthdayCalendarData(birthdays, year, month) {
    const calendarData = {};
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    // getDay() returns 0 for Sunday, we want to map correctly to grid
    const firstDayOfMonth = new Date(year, month, 1).getDay();

    // Initialize all days
    for (let day = 1; day <= daysInMonth; day++) {
        calendarData[day] = {
            birthdays: [],
            hasBirthday: false
        };
    }

    // Populate birthdays
    birthdays.forEach(birthday => {
        const birthDate = new Date(birthday.date_of_birth);
        const birthDay = birthDate.getDate();

        // Ensure we only map valid days for this month
        if (birthDay >= 1 && birthDay <= daysInMonth) {
            calendarData[birthDay].birthdays.push(birthday);
            calendarData[birthDay].hasBirthday = true;
        }
    });

    return { calendarData, firstDayOfMonth, daysInMonth };
}

// Tooltip Management
let activeTooltip = null;

function showBirthdayTooltip(event, day) {
    const calendarInfo = createBirthdayCalendarData(window.birthdayData, window.currentBirthdayYear, window.currentBirthdayMonth);
    const dayData = calendarInfo.calendarData[day];

    if (!dayData || !dayData.hasBirthday) return;

    // Remove existing tooltip
    if (activeTooltip) activeTooltip.remove();

    // Create tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'birthday-tooltip';

    // Generate content
    const dateStr = new Date(window.currentBirthdayYear, window.currentBirthdayMonth, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

    const birthdaysList = dayData.birthdays.map(b => `
        <div class="birthday-tooltip-item">
            <div class="birthday-tooltip-avatar">${b.name.charAt(0)}</div>
            <div class="birthday-tooltip-info">
                <span class="birthday-tooltip-name">${b.name}</span>
                <span class="birthday-tooltip-age">Turning ${b.age}</span>
            </div>
        </div>
    `).join('');

    tooltip.innerHTML = `
        <div class="birthday-tooltip-header">${dateStr}</div>
        ${birthdaysList}
    `;

    document.body.appendChild(tooltip);
    activeTooltip = tooltip;

    // Position tooltip
    // Using Popper.js concepts but simplified vanilla JS
    const targetRect = event.currentTarget.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    let top = targetRect.top - tooltipRect.height - 10;
    let left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);

    // Keep within viewport
    if (left < 10) left = 10;
    if (left + tooltipRect.width > window.innerWidth - 10) {
        left = window.innerWidth - tooltipRect.width - 10;
    }

    tooltip.style.top = `${top + window.scrollY}px`;
    tooltip.style.left = `${left + window.scrollX}px`;

    // Trigger animation
    requestAnimationFrame(() => {
        tooltip.classList.add('visible');
    });
}

function hideBirthdayTooltip() {
    if (activeTooltip) {
        const tooltip = activeTooltip;
        tooltip.classList.remove('visible');
        activeTooltip = null;
        setTimeout(() => tooltip.remove(), 200);
    }
}

function createBirthdayCalendarHTML(calendarInfo, year, month) {
    const { calendarData, firstDayOfMonth, daysInMonth } = calendarInfo;
    const weekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

    let html = '';

    // Weekday headers
    html += '<div class="fc-weekdays">';
    weekdays.forEach(day => {
        html += `<div class="fc-weekday ${day === 'SUN' ? 'sun' : ''}">${day}</div>`;
    });
    html += '</div>';

    // Calendar days grid
    html += '<div class="fc-days">';

    // Empty cells for days before the first day of the month
    for (let i = 0; i < firstDayOfMonth; i++) {
        html += '<div class="fc-day empty"></div>';
    }

    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
        const dayData = calendarData[day];
        const dateObj = new Date(year, month, day);
        const now = getCurrentISTDate();
        const isToday = now.getDate() === day &&
            now.getMonth() === month &&
            now.getFullYear() === year;

        const isSunday = dateObj.getDay() === 0;

        // Check for holiday in this day
        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const holiday = window.viewingHolidays ? window.viewingHolidays.find(h => h.date === dateKey) : null;

        const classes = [
            'fc-day',
            dayData.hasBirthday ? 'has-birthday' : '',
            holiday ? (holiday.is_optional ? 'has-optional-holiday' : 'has-holiday') : '',
            holiday && holiday.is_working_day ? 'is-working-day-holiday' : '',
            isToday ? 'today' : '',
            isSunday ? 'sunday' : ''
        ].filter(Boolean).join(' ');

        // If multiple birthdays, show a small counter, otherwise just the day number
        const count = dayData.birthdays.length;
        const indicator = count > 1 ? `<span style="font-size:0.65rem; position:absolute; bottom:8px; background:#ec4899; color:white; width:16px; height:16px; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 4px rgba(236, 72, 153, 0.3);">${count}</span>` : '';

        // Add hover events only if there are birthdays
        let hoverAttrs = dayData.hasBirthday ?
            `onmouseenter="showBirthdayTooltip(event, ${day})"` : '';
        
        if (holiday) {
             hoverAttrs += ` title="Holiday: ${holiday.name}${holiday.is_working_day ? ' (Working)' : ''}"`;
        }

        const clickAttr = (currentUser && currentUser.role === 'admin') ? 
            `onclick="adminManageDate('${dateKey}')"` : `onclick="selectDay(${day})"`;

        html += `
            <div class="${classes}" ${hoverAttrs} ${clickAttr} onmouseleave="hideBirthdayTooltip()">
                <span class="day-number">${day}</span>
                ${indicator}
                ${holiday ? `<div class="holiday-dot ${holiday.is_optional ? 'optional' : ''} ${holiday.is_working_day ? 'working' : ''}"></div>` : ''}
            </div>
        `;
    }

    // Fill remaining cells to complete the grid (optional, but looks better)
    const totalCells = firstDayOfMonth + daysInMonth;
    const remainingCells = Math.ceil(totalCells / 7) * 7 - totalCells;

    for (let i = 0; i < remainingCells; i++) {
        html += '<div class="fc-day empty"></div>';
    }

    html += '</div>'; // Close fc-days
    return html;
}

function changeBirthdayMonth(direction) {
    window.currentBirthdayMonth += direction;

    // Handle year change
    if (window.currentBirthdayMonth > 11) {
        window.currentBirthdayMonth = 0;
        window.currentBirthdayYear++;
    } else if (window.currentBirthdayMonth < 0) {
        window.currentBirthdayMonth = 11;
        window.currentBirthdayYear--;
    }

    // Reload calendar for new month
    openBirthdayCalendar();
}

function showBirthdayDetails(day) {
    const detailsPanel = document.getElementById('birthdayDetailsContent');
    if (!detailsPanel) return;
    
    const calendarInfo = createBirthdayCalendarData(window.birthdayData, window.currentBirthdayYear, window.currentBirthdayMonth);
    const dayData = calendarInfo.calendarData[day];

    if (!dayData || !dayData.hasBirthday) {
        detailsPanel.innerHTML = '<p class="text-muted">No birthdays on this date</p>';
        return;
    }

    const birthdayList = dayData.birthdays.map(birthday => `
        <div class="birthday-detail-item">
            <div class="birthday-detail-header">
                <strong>${birthday.name}</strong>
                <span class="birthday-age">${birthday.age} years old</span>
            </div>
            <div class="birthday-detail-info">
                <small>Username: ${birthday.username}</small>
                <small>Born: ${birthday.date_of_birth}</small>
                <small class="text-muted" style="margin-top:4px;">Days until birthday: ${birthday.days_until}</small>
            </div>
        </div>
    `).join('');

    detailsPanel.innerHTML = `
        <div class="birthday-details-list">
            <div style="margin-bottom:12px; font-weight:600; color:var(--primary-color);">
                Birthdays on ${new Date(window.currentBirthdayYear, window.currentBirthdayMonth, day).toLocaleDateString()}
            </div>
            ${birthdayList}
        </div>
    `;
}

function selectDay(day) {
    showBirthdayDetails(day);
}

/* --- Admin Date Management Logic --- */
let activeManageDate = null;

function adminManageDate(dateStr) {
    if (!currentUser || currentUser.role !== 'admin') return;
    
    activeManageDate = dateStr;
    const display = document.getElementById('manageDateDisplay');
    if (display) display.textContent = dateStr;
    
    // Reset form
    const reasonInput = document.getElementById('manageDateReason');
    if (reasonInput) reasonInput.value = '';
    
    // Find existing holiday
    const holiday = window.viewingHolidays ? window.viewingHolidays.find(h => h.date === dateStr) : null;
    const radios = document.getElementsByName('dateType');
    
    if (holiday) {
        if (holiday.is_working_day) {
            radios.forEach(r => r.checked = (r.value === 'working'));
        } else if (holiday.is_optional) {
            radios.forEach(r => r.checked = (r.value === 'optional'));
        } else {
            radios.forEach(r => r.checked = (r.value === 'holiday'));
        }
        if (reasonInput) reasonInput.value = holiday.name;
    } else {
        radios.forEach(r => r.checked = (r.value === 'working'));
    }
    
    openModal('adminManageDateModal');
}

async function saveAdminDateManagement() {
    if (!activeManageDate) return;
    
    const type = document.querySelector('input[name="dateType"]:checked').value;
    const reason = document.getElementById('manageDateReason').value.trim();
    
    showLoading("Updating date status...");
    try {
        const res = await apiCall('manage-date', 'POST', {
            date: activeManageDate,
            type: type,
            reason: reason,
            user_id: currentUser.id
        });
        
        if (res && res.success) {
            showNotification(res.message || "Date updated successfully", "success");
            closeModal('adminManageDateModal');
            // Refresh the calendar
            openBirthdayCalendar(); 
        } else {
            showNotification(res.message || "Update failed", "error");
        }
    } catch (e) {
        console.error("Manage date error:", e);
        showNotification("Network error", "error");
    } finally {
        hideLoading();
    }
}

async function openRequestsModal() {
    showLoading("Analyzing employee requests...");
    const content = document.getElementById('requestsContent');
    content.innerHTML = '<div class="text-center" style="padding: 40px;"><div class="loading-spinner" style="margin: 0 auto 16px;"></div><p>Loading futuristic dashboard...</p></div>';

    openModal('requestsModal');

    try {
        const res = await apiCall('pending-requests', 'GET', { user_id: currentUser.id });
        if (res && res.success && Array.isArray(res.requests)) {
            const requests = res.requests;
            window.currentRequests = requests; // Store for filtering

            const total = requests.length;
            const wfhCount = requests.filter(r => r.type === 'wfh').length;
            const leaveCount = requests.filter(r => r.type === 'full_day' || r.type === 'half_day').length;
            const blockedCount = requests.filter(r => r.type === 'unblock_attendance').length;

            let html = `
                <div class="premium-calendar-wrap">
                    <!-- Premium Header -->
                    <div class="premium-header">
                        <div class="header-title">
                            <span style="font-size: 1.8rem;">📥</span>
                            <div style="display:flex; flex-direction:column;">
                                <span style="font-size: 1.4rem; font-weight: 800; color: #1e293b;">Active Requests</span>
                                <span style="font-size: 0.85rem; font-weight: 500; color: #64748b;">Review and manage employee submissions</span>
                            </div>
                        </div>
                        <div style="display:flex; gap:12px; align-items:center;">
                            <div class="btn-group-premium" style="display:flex; background: #f1f5f9; padding: 4px; border-radius: 12px; gap: 4px;">
                                <button class="btn-premium-toggle active" id="btn-mode-pending" onclick="switchRequestMode('pending')">Active</button>
                                <button class="btn-premium-toggle" id="btn-mode-history" onclick="switchRequestMode('history')">History</button>
                            </div>
                            <div class="btn-group-premium" style="display:flex; background: #f1f5f9; padding: 4px; border-radius: 12px; gap: 4px;">
                                <button class="btn-premium-toggle active filter-tab" data-type="all" onclick="filterRequestsByType('all', this)">All</button>
                                <button class="btn-premium-toggle filter-tab" data-type="wfh" onclick="filterRequestsByType('wfh', this)">WFH</button>
                                <button class="btn-premium-toggle filter-tab" data-type="leave" onclick="filterRequestsByType('leave', this)">Leave</button>
                                <button class="btn-premium-toggle filter-tab" data-type="blocked" onclick="filterRequestsByType('blocked', this)">Blocked</button>
                            </div>
                            <button class="btn-premium-close" onclick="closeModal('requestsModal')">Close</button>
                        </div>
                    </div>

                    <div class="calendar-main-split">
                        <!-- Left: List -->
                        <div class="clean-calendar-panel" style="padding: 24px;">
                             <div style="margin-bottom: 24px; position:relative;">
                                <span style="position:absolute; left:16px; top:50%; transform:translateY(-50%); color:#94a3b8;">🔍</span>
                                <input type="text" class="premium-search" style="padding: 14px 14px 14px 48px; min-height: 52px;" placeholder="Search by name or username..." onkeyup="filterRequests(this.value)">
                            </div>
                            <div id="requestsListContainer" style="display:flex; flex-direction:column; gap:12px;">
                                ${renderRequestCards(requests)}
                            </div>
                        </div>

                        <!-- Right: Side Panel -->
                        <div class="premium-side-panel">
                            <div style="font-weight: 700; font-size: 0.8rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px;">Quick Stats</div>
                            <div class="premium-stats">
                                <div class="premium-stat-card">
                                    <span class="premium-stat-val" style="color:#8b5cf6;">${total}</span>
                                    <span class="premium-stat-label">Total</span>
                                </div>
                                <div class="premium-stat-card">
                                    <span class="premium-stat-val" style="color:#10b981;">${wfhCount}</span>
                                    <span class="premium-stat-label">WFH</span>
                                </div>
                                <div class="premium-stat-card">
                                    <span class="premium-stat-val" style="color:#f59e0b;">${leaveCount}</span>
                                    <span class="premium-stat-label">Leave</span>
                                </div>
                                <div class="premium-stat-card">
                                    <span class="premium-stat-val" style="color:#ef4444;">${blockedCount}</span>
                                    <span class="premium-stat-label">Blocked</span>
                                </div>
                            </div>
                            
                            <div id="requestDetailContainer" style="margin-top:24px; flex:1;">
                                <div style="height: 100%; border: 2px dashed #e2e8f0; border-radius: 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px; text-align: center; color: #94a3b8;">
                                    <span style="font-size: 3rem; margin-bottom: 16px;">🔍</span>
                                    <p style="font-weight: 600; margin: 0; color: #64748b;">Select a request</p>
                                    <p style="font-size: 0.85rem; margin-top: 4px;">Click any card to review details</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            content.innerHTML = html;

        } else {
            content.innerHTML = '<div class="text-center" style="padding: 40px;"><p>Error loading requests</p></div>';
        }
    } catch (error) {
        console.error('Error loading requests:', error);
        content.innerHTML = '<div class="text-center" style="padding: 40px;"><p>Error loading requests</p></div>';
    } finally {
        setTimeout(hideLoading, 500);
    }
}

function renderRequestCards(requests) {
    if (requests.length === 0) {
        const modeText = (window.requestMode || 'pending') === 'history' ? 'history records' : 'pending requests';
        return `
            <div class="empty-requests">
                <div class="empty-icon">✨</div>
                <h4>All Clear!</h4>
                <p>No ${modeText} found.</p>
            </div>
        `;
    }

    return requests.map((req, index) => {
        let typeLabel = req.type;
        if (req.type === 'wfh') typeLabel = 'Work from Home';
        else if (req.type === 'full_day') typeLabel = 'Full Day Leave';
        else if (req.type === 'half_day') typeLabel = 'Half Day Leave';
        else if (req.type === 'unblock_attendance') typeLabel = 'Unblock Attendance';

        const typeClass = req.type === 'wfh' ? 'tech-wfh' : (req.type === 'unblock_attendance' ? 'tech-blocked' : 'tech-leave');
        const badgeClass = req.type === 'wfh' ? 'badge-tech-wfh' : (req.type === 'unblock_attendance' ? 'badge-tech-blocked' : 'badge-tech-leave');
        const initials = req.employee_name ? req.employee_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : '??';

        // Staggered animation
        const delay = index * 50;

        return `
            <div id="req-card-${req.id}" class="req-card-tech ${typeClass}" onclick="selectRequest(${req.id})" style="animation: slideInUp 0.4s cubic-bezier(0.165, 0.84, 0.44, 1) forwards; animation-delay: ${delay}ms; cursor: pointer;">
                <div class="req-avatar-tech" style="background: linear-gradient(135deg, #f8fafc, #f1f5f9); color: #475569; width: 60px; height: 60px; border-radius: 18px; border: 1px solid #f1f5f9;">${initials}</div>
                <div class="req-content-tech">
                    <div class="req-header-tech">
                        <div>
                            <h4 class="req-name-tech" style="font-size: 1.2rem; margin-bottom: 4px;">${req.employee_name}</h4>
                            <div class="req-badges-tech">
                                <span class="req-badge ${badgeClass}" style="padding: 6px 12px; border-radius: 8px;">${typeLabel}</span>
                                <span style="font-size:0.85rem; color: #64748b; font-weight:600; display: flex; align-items: center; gap: 4px;">
                                    <span style="font-size: 1rem;">📅</span> ${req.date}
                                </span>
                                ${req.task_info ? `
                                    <span class="req-badge" style="background: ${req.task_info.percent === 100 ? '#d1fae5' : '#fef3c7'}; color: ${req.task_info.percent === 100 ? '#059669' : '#d97706'}; padding: 6px 12px; border-radius: 8px; font-weight:700; display: flex; align-items: center; gap: 4px;">
                                        <span style="font-size: 1rem;">📋</span> ${req.task_info.summary}
                                    </span>
                                ` : ''}
                            </div>
                        </div>
                        <div class="req-actions-tech">
                            ${req.status === 'pending' ? `
                                <button class="btn-tech btn-tech-approve" onclick="approveRequest(${req.id}, '${req.type}')" title="Approve" style="width: 48px; height: 48px; border-radius: 14px;">✓</button>
                                <button class="btn-tech btn-tech-reject" onclick="rejectRequest(${req.id}, '${req.type}')" title="Reject" style="width: 48px; height: 48px; border-radius: 14px;">✕</button>
                            ` : `
                                <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
                                    <span class="premium-badge" style="background: ${req.status === 'approved' ? '#dcfce7' : '#fee2e2'}; color: ${req.status === 'approved' ? '#166534' : '#991b1b'}; border-radius: 8px; padding: 6px 14px; font-weight: 700; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.05em;">${req.status}</span>
                                    ${req.reviewed_by_name ? `<span style="font-size:0.7rem; color:#94a3b8; font-weight:600;">By ${req.is_Mentor ? 'Mentor: ' : ''}${req.reviewed_by_name}</span>` : ''}
                                </div>
                            `}
                        </div>
                    </div>
                    ${req.reason ? `
                        <div style="margin-top: 12px; padding: 12px; background: #f8fafc; border-radius: 10px; border-left: 3px solid #e2e8f0;">
                            <p style="margin:0; color:var(--gray-600); font-size:0.95rem; font-style: italic; line-height: 1.5;">"${req.reason}"</p>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

function filterRequests(query) {
    window.requestSearchQuery = query.toLowerCase();
    applyRequestFilters();
}

function filterRequestsByType(type, tabElement) {
    window.requestFilterType = type;

    // Update tabs
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    if (tabElement) tabElement.classList.add('active');

    applyRequestFilters();
}

async function switchRequestMode(mode) {
    window.requestMode = mode;

    // Update title
    const titleEl = document.querySelector('.premium-header .header-title span[style*="font-weight: 800"]');
    if (titleEl) {
        titleEl.textContent = mode === 'history' ? 'Request History' : 'Active Requests';
    }

    // Update button visual state
    document.getElementById('btn-mode-pending').classList.toggle('active', mode === 'pending');
    document.getElementById('btn-mode-history').classList.toggle('active', mode === 'history');

    // Show loading state in list
    document.getElementById('requestsListContainer').innerHTML = '<div class="text-center" style="padding: 40px;"><div class="loading-spinner" style="margin: 0 auto 16px;"></div><p>Fetching ' + mode + ' data...</p></div>';

    try {
        const res = await apiCall('pending-requests' + (mode === 'history' ? '?status=history' : ''), 'GET', { user_id: currentUser.id });
        if (res && res.success && Array.isArray(res.requests)) {
            window.currentRequests = res.requests;

            // Re-render stats if they are visible
            const total = res.requests.length;
            const wfhCount = res.requests.filter(r => r.type === 'wfh').length;
            const leaveCount = res.requests.filter(r => r.type === 'full_day' || r.type === 'half_day').length;
            const blockedCount = res.requests.filter(r => r.type === 'unblock_attendance').length;

            const stats = document.querySelector('.premium-stats');
            if (stats) {
                stats.innerHTML = `
                    <div class="premium-stat-card">
                        <span class="premium-stat-val" style="color:#8b5cf6;">${total}</span>
                        <span class="premium-stat-label">Total</span>
                    </div>
                    <div class="premium-stat-card">
                        <span class="premium-stat-val" style="color:#10b981;">${wfhCount}</span>
                        <span class="premium-stat-label">WFH</span>
                    </div>
                    <div class="premium-stat-card">
                        <span class="premium-stat-val" style="color:#f59e0b;">${leaveCount}</span>
                        <span class="premium-stat-label">Leave</span>
                    </div>
                    <div class="premium-stat-card">
                        <span class="premium-stat-val" style="color:#ef4444;">${blockedCount}</span>
                        <span class="premium-stat-label">Blocked</span>
                    </div>
                `;
            }

            applyRequestFilters();
        }
    } catch (e) {
        console.error(e);
        showNotification("Failed to fetch requests", "error");
    }
}

function applyRequestFilters() {
    const list = document.getElementById('requestsListContainer');
    if (!window.currentRequests) return;

    const query = window.requestSearchQuery || '';
    const type = window.requestFilterType || 'all';

    const filtered = window.currentRequests.filter(req => {
        const matchesSearch = (req.employee_name || '').toLowerCase().includes(query) || (req.username || '').toLowerCase().includes(query);

        // Fix filtering logic
        let matchesType = true;
        if (type === 'wfh') {
            matchesType = req.type === 'wfh';
        } else if (type === 'leave') {
            matchesType = req.type === 'full_day' || req.type === 'half_day';
        } else if (type === 'blocked') {
            matchesType = req.type === 'unblock_attendance';
        }

        return matchesSearch && matchesType;
    });

    list.innerHTML = renderRequestCards(filtered);
}

async function openTaskMentor(autoAssigneeId = null) {
    TaskManagerV2.open();
    if (autoAssigneeId) {
        setTimeout(() => {
            TaskManagerV2.openNewTaskModal(autoAssigneeId);
        }, 800);
    }
}

async function populateTaskExportEmployeeFilter() {
    const select = document.getElementById('taskExportEmployeeFilter');
    if (!select) return;

    // Keep the "All Employees" option
    select.innerHTML = '<option value="all">All Employees</option>';

    try {
        const res = await apiCall('admin-profiles', 'GET', { user_id: currentUser.id });
        const profiles = (res && res.success && Array.isArray(res.profiles)) ? res.profiles : [];

        profiles.forEach(p => {
            const option = document.createElement('option');
            option.value = p.id;
            option.textContent = p.name || p.username;
            select.appendChild(option);
        });
    } catch (e) {
        console.error('Failed to populate employee filter', e);
    }
}

// Task Management Functions
let tasks = [];

async function refreshTasks() {
    showLoading("Refreshing task board...");
    try {
        // Always pass employee_id so backend can verify role (Admin vs Employee)
        const empId = typeof currentUser !== 'undefined' && currentUser ? currentUser.id : '';
        const queryParams = `?employee_id=${empId}&scope=team`;
        const res = await apiCall(`tasks${queryParams}`, 'GET');
        if (res && res.success && Array.isArray(res.tasks)) {
            tasks = res.tasks;
            renderTaskBoard();
        }
        showNotification('Error loading tasks', 'error');
    } finally {
        hideLoading();
    }
}

async function exportTasksToExcel() {
    const employees = window.allEmployeesSimple || [];
    if (!employees.length) {
        try {
            const res = await apiCall('employees-simple', 'GET');
            if (res && res.success) window.allEmployeesSimple = res.employees;
        } catch(e) {}
    }

    const content = `
        <div class="names-list-container" style="padding: 24px;">
            <button class="modal-close-btn" onclick="safeRemoveModal(this.closest('.modal'))" style="position: absolute; right: 20px; top: 20px; width: 36px; height: 36px; background: #f1f5f9; border: none; border-radius: 12px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #64748b; transition: all 0.2s; z-index: 100;">✕</button>
            <div style="margin-bottom: 20px; border-bottom: 2px solid #f1f5f9; padding-bottom: 12px;">
                <h3 style="margin: 0; font-size: 1.25rem; color: #1e293b; display: flex; align-items: center; gap: 12px;">
                    <span style="background: #eef2ff; padding: 8px; border-radius: 12px;">📊</span>
                    Export Tasks to Excel
                </h3>
                <p style="margin: 6px 0 0; color: #64748b; font-size: 0.85rem;">Filter by employee or export all active tasks.</p>
            </div>
            
            <div style="display: flex; flex-direction: column; gap: 16px;">
                <div class="form-group">
                    <label style="font-weight: 700; color: #475569; margin-bottom: 8px; display: block;">Select Employee</label>
                    <select id="exportTaskEmployeeSelect" class="form-control" style="border-radius: 12px; border: 1.5px solid #e2e8f0; height: 48px; font-weight: 600;">
                        <option value="all">All Employees</option>
                        ${(window.allEmployeesSimple || []).map(e => `<option value="${e.id}">${e.name}</option>`).join('')}
                    </select>
                </div>
                
                <button onclick="confirmTaskExport(); safeRemoveModal(this.closest('.modal'));" class="btn btn-primary" style="height: 52px; border-radius: 16px; font-weight: 700; font-size: 1rem; box-shadow: 0 10px 15px -3px rgba(79, 70, 229, 0.3);">
                    <i class="fas fa-file-download" style="margin-right: 8px;"></i> Generate Report
                </button>
            </div>
        </div>
    `;

    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.zIndex = '15000';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 400px; width: 90%; padding: 0; border-radius: 28px; border: none; box-shadow: 0 40px 80px -15px rgba(0,0,0,0.5); animation: modalPop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);">
            ${content}
        </div>
    `;
    document.body.appendChild(modal);
    updateScrollLock();
}

async function confirmTaskExport() {
    if (typeof ExcelJS === 'undefined') {
        showNotification('Excel library not loaded. Please refresh.', 'error');
        return;
    }

    // Use V2 tasks if available, fallback to legacy tasks
    let sourceTasks = (typeof TaskManagerV2 !== 'undefined' && TaskManagerV2.tasks && TaskManagerV2.tasks.length) 
        ? TaskManagerV2.tasks 
        : (tasks || []);

    if (!sourceTasks || sourceTasks.length === 0) {
        showNotification('No tasks to export.', 'warning');
        return;
    }

    const filterId = document.getElementById('exportTaskEmployeeSelect')?.value || 'all';
    let tasksToExport = sourceTasks;

    if (filterId !== 'all') {
        const empId = parseInt(filterId);
        tasksToExport = sourceTasks.filter(t => (t.assignees || []).some(a => a.id === empId));
    }

    if (tasksToExport.length === 0) {
        showNotification('No tasks found for the selected employee.', 'warning');
        return;
    }

    try {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Tasks Report');

        // Define columns
        sheet.columns = [
            { header: 'ID', key: 'id', width: 10 },
            { header: 'Title', key: 'title', width: 30 },
            { header: 'Assignee', key: 'assignee', width: 25 },
            { header: 'Status', key: 'status', width: 15 },
            { header: 'Priority', key: 'priority', width: 15 },
            { header: 'Due Date', key: 'due_date', width: 15 },
            { header: 'Created Date', key: 'created_date', width: 15 },
            { header: 'Created Time', key: 'created_time', width: 15 },
            { header: 'Started Date', key: 'started_date', width: 15 },
            { header: 'Started Time', key: 'started_time', width: 15 },
            { header: 'Completed Date', key: 'completed_date', width: 18 },
            { header: 'Completed Time', key: 'completed_time', width: 18 },
            { header: 'Mentor', key: 'Mentor', width: 25 },
            { header: 'Created By', key: 'created_by', width: 25 },
            { header: 'Description', key: 'description', width: 50 },
            { header: 'Overseers', key: 'overseers', width: 30 }
        ];

        // Format and add rows
        tasksToExport.forEach(task => {
            const assignees = (task.assignees && task.assignees.length > 0) 
                ? task.assignees 
                : [ {id: null, name: 'Unassigned'} ];
            
            assignees.forEach(assignee => {
                sheet.addRow({
                    id: task.id,
                    title: task.title,
                    assignee: assignee.name,
                    status: task.status,
                    priority: task.priority,
                    due_date: formatDateDMY(task.due_date),
                    created_date: formatDateDMY(task.created_at),
                    created_time: formatTimeOnly(task.created_at),
                    started_date: task.started_at ? formatDateDMY(task.started_at) : 'N/A',
                    started_time: task.started_at ? formatTimeOnly(task.started_at) : 'N/A',
                    completed_date: task.completed_at ? formatDateDMY(task.completed_at) : 'N/A',
                    completed_time: task.completed_at ? formatTimeOnly(task.completed_at) : 'N/A',
                    Mentor: task.Mentor_name || '',
                    created_by: task.created_by_name || '',
                    description: task.description || '',
                    overseers: (task.overseers || []).map(o => o.name).join(', ')
                });
            });
        });

        // Style the header row
        sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        sheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4F46E5' } // Indigo-600
        };
        sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

        // Auto-filter and freeze header (A1 to M1 for 13 columns)
        sheet.autoFilter = 'A1:M1';
        sheet.views = [{ state: 'frozen', ySplit: 1 }];

        // Generate buffer and download
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        const timestamp = new Date().toISOString().split('T')[0];

        a.href = url;
        a.download = `Tasks_Report_${timestamp}.xlsx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        closeModal('taskExportModal');
        showNotification('Tasks exported successfully', 'success');
    } catch (error) {
        console.error('Export error:', error);
        showNotification('Error exporting tasks', 'error');
    }
}

function renderTaskBoard() {
    const todoList = document.getElementById('todoList');
    const inProgressList = document.getElementById('inProgressList');
    const completedList = document.getElementById('completedList');

    if (!todoList || !inProgressList || !completedList) return;

    const getPriorityWeight = (p) => {
        if (!p) return 99;
        p = p.toLowerCase();
        const w = { 'p1':1, 'p2':2, 'p3':3, 'p4':4, 'urgent':5, 'high':6, 'medium':7, 'low':8 };
        return w[p] || 99;
    };
    const todoTasks = tasks.filter(t => t.status === 'todo').sort((a,b) => getPriorityWeight(a.priority) - getPriorityWeight(b.priority));
    const inProgressTasks = tasks.filter(t => t.status === 'in_progress').sort((a,b) => getPriorityWeight(a.priority) - getPriorityWeight(b.priority));
    const completedTasks = tasks.filter(t => t.status === 'completed').sort((a,b) => getPriorityWeight(a.priority) - getPriorityWeight(b.priority));

    document.getElementById('todoCount').textContent = todoTasks.length;
    document.getElementById('inProgressCount').textContent = inProgressTasks.length;
    document.getElementById('completedCount').textContent = completedTasks.length;

    const renderList = (taskList, container) => {
        if (!taskList.length) {
            container.innerHTML = '<div class="text-muted text-center p-3" style="color:#94a3b8; font-size:0.9rem;">No tasks</div>';
            return;
        }

        container.innerHTML = taskList.map((task, idx) => {
            const p = (task.priority || 'Medium').toLowerCase();
            const priorityClass = p === 'high' ? 'priority-high' :
                (p === 'medium' ? 'priority-medium' : 
                (p === 'urgent' ? 'priority-urgent' : 
                (['p1','p2','p3','p4'].includes(p)) ? `priority-${p}` : 'priority-low'));

            const priorityLabel = p.toUpperCase();

            // Progress Bar Logic
            const steps = task.steps || [];
            const completedSteps = steps.filter(s => s.is_completed).length;
            const progressPercent = steps.length > 0 ? Math.round((completedSteps / steps.length) * 100) : 0;
            const hasSteps = steps.length > 0;

            // Due Date Logic
            let dueClass = '';
            let dueBadge = '';

            if (task.due_date) {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const due = new Date(task.due_date);
                due.setHours(0, 0, 0, 0);

                const diffTime = due - today;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays < 0) {
                    dueClass = 'task-card-overdue';
                } else if (diffDays <= 2) {
                    dueClass = 'task-card-urgent';
                } else if (diffDays <= 7) {
                    dueClass = 'task-card-warning';
                } else {
                    dueClass = 'task-card-safe';
                }

                if (diffDays === 1) {
                    dueBadge = '<span class="due-tomorrow-badge">Due Tomorrow!</span>';
                }
            }

            // Override for completed tasks: ALWAYS Green
            if (task.status === 'completed') {
                dueClass = 'task-card-safe';
                dueBadge = '';
            }

            // Multi-Assignee Avatar Group
            const assignees = task.assignees || [];
            const avatarGroup = assignees.slice(0, 3).map((a, i) => `
                <span class="premium-user-avatar" style="width:28px; height:28px; font-size:11px; background: linear-gradient(135deg, #f8fafc, #f1f5f9); border: 1px solid #e2e8f0; color: #475569; margin-left: ${i > 0 ? '-10px' : '0'}; z-index: ${5 - i};" title="${a.name}">${a.name.charAt(0).toUpperCase()}</span>
            `).join('') + (assignees.length > 3 ? `<span class="premium-user-avatar" style="width:28px; height:28px; font-size:10px; background: #e2e8f0; border: 1px solid #cbd5e1; color: #475569; margin-left: -10px; z-index: 1;">+${assignees.length - 3}</span>` : '');

            const assigneeNames = assignees.map(a => a.name).join(', ') || 'Unassigned';

            return `
                <div class="premium-task-card ${dueClass}" id="task-${task.id}" draggable="true" ondragstart="drag(event)" onclick="${window._isPriorityMode ? (task.status !== 'completed' ? `togglePrioritySelection(${task.id})` : '') : `openTaskDetail(${task.id})`}" style="animation: slideInUp 0.4s cubic-bezier(0.165, 0.84, 0.44, 1) forwards; animation-delay: ${idx * 50}ms; opacity:1; cursor:pointer; overflow: hidden; position: relative; border: ${window._prioritySelection && window._prioritySelection.includes(task.id) ? '2px solid #f59e0b' : '1px solid #e2e8f0'}">
                    ${task.status !== 'completed' && window._isPriorityMode && window._prioritySelection && window._prioritySelection.includes(task.id) ? `
                    <div style="position: absolute; top: -5px; right: -5px; background: #f59e0b; color: white; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.85rem; z-index: 10; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                        P${window._prioritySelection.indexOf(task.id) + 1}
                    </div>
                    ` : ''}
                    <div class="premium-card-header" style="flex-wrap: wrap; margin-bottom: 6px;">
                        ${task.status !== 'completed' ? `
                        <div style="display: flex; gap: 4px; align-items: center; max-width: 60%; flex-wrap: wrap;">
                            ${(task.history || []).filter(h => h.field === 'priority' && h.old && h.old !== task.priority).reverse().map(h => {
                                const hp = h.old.toLowerCase();
                                const hpClass = hp === 'high' ? 'priority-high' : (hp === 'medium' ? 'priority-medium' : (hp === 'urgent' ? 'priority-urgent' : (['p1','p2','p3','p4'].includes(hp)) ? `priority-${hp}` : 'priority-low'));
                                return `<span class="premium-priority-badge ${hpClass}" style="border-radius: 6px; padding: 4px 10px; opacity: 0.4; text-decoration: line-through; transform: scale(0.9);" title="Old Priority">${hp.toUpperCase()}</span>`;
                            }).join('')}
                            <span class="premium-priority-badge ${priorityClass}" style="border-radius: 6px; padding: 4px 10px;">${priorityLabel}</span>
                        </div>
                        ` : '<div style="display: flex; max-width: 60%;"></div>'}
                        ${dueBadge}
                        <div style="display:flex; gap:8px; margin-left: auto;">
                            ${typeof currentUser !== 'undefined' && currentUser && (currentUser.role === 'admin' || task.Mentor_id === currentUser.id || currentUser.role === 'Mentor' || currentUser.has_subordinates) ? `
                            <button class="btn-icon-sm" onclick="event.stopPropagation(); editTask(${task.id})" style="background:#f1f5f9; border:none; color:#64748b; cursor:pointer; width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; transition:all 0.2s;" title="Edit">✎</button>
                            <button class="btn-icon-sm" onclick="event.stopPropagation(); deleteTask(${task.id})" style="background:#fef2f2; border:none; color:#ef4444; cursor:pointer; width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; transition:all 0.2s;" title="Delete">🗑</button>
                            ` : ''}
                        </div>
                    </div>

                    ${hasSteps ? `
                    <div class="task-card-progress" style="margin: 8px 0;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                            <span style="font-size: 0.7rem; color: #94a3b8; font-weight: 700;">Steps: ${completedSteps}/${steps.length}</span>
                            <span style="font-size: 0.7rem; color: var(--primary-color); font-weight: 800;">${progressPercent}%</span>
                        </div>
                        <div style="height: 4px; background: #e2e8f0; border-radius: 2px; overflow: hidden;">
                            <div style="height: 100%; width: ${progressPercent}%; background: var(--primary-color); transition: width 0.3s ease;"></div>
                        </div>
                    </div>
                    ` : ''}
                    
                    <h5 class="premium-task-title" style="margin: 0; font-size: 1.1rem; line-height: 1.5;">${task.title}</h5>
                    <p style="font-size:0.9rem; color:#64748b; margin: 0; line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${task.description || ''}</p>
                    
                    <div class="premium-task-meta" style="margin-top: 8px; padding-top: 12px; border-top: 1px solid #f1f5f9; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                        <div style="display:flex; align-items:center;">
                            <div style="display:flex;">${avatarGroup}</div>
                            <span style="font-size:0.85rem; color:#475569; font-weight: 500; margin-left: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px;" title="${assigneeNames}">${assigneeNames}</span>
                        </div>
                        
                        <div style="display:flex; align-items:center; gap: 8px;">
                            ${(task.comments && task.comments.length > 0) ? `
                            <span style="font-size:0.75rem; color:var(--primary-color); font-weight: 700; background:rgba(37, 99, 235, 0.1); padding:4px 8px; border-radius:6px; display:flex; align-items:center; gap:4px;" title="${task.comments.length} comments">
                                💬 ${task.comments.length}
                            </span>
                            ` : ''}

                            ${(task.overseers && task.overseers.length > 0) ? `
                            <span style="font-size:0.75rem; color:#64748b; font-weight: 600; background:#f1f5f9; padding:4px 8px; border-radius:6px; display:flex; align-items:center; gap:4px;" title="Overseers: ${task.overseers.map(o => o.name).join(', ')}">
                                👁 <span style="max-width: 60px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${task.overseers.map(o => o.name).join(', ')}</span>
                            </span>
                            ` : (task.Mentor_name ? `
                            <span style="font-size:0.75rem; color:#64748b; font-weight: 600; background:#f1f5f9; padding:4px 8px; border-radius:6px; display:flex; align-items:center; gap:4px;" title="Mentor: ${task.Mentor_name}">
                                👁 <span style="max-width: 60px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${task.Mentor_name}</span>
                            </span>
                            ` : '')}
                            
                            <span style="font-size:0.8rem; color:#94a3b8; font-weight: 600; display: flex; align-items: center; gap: 4px;">
                                <span style="font-size: 0.9rem;">📅</span> ${formatDateDMY(task.due_date)}
                            </span>
                            
                            ${task.comments && task.comments.length > 0 ? `
                                <span style="font-size:0.75rem; color:#3b82f6; font-weight: 600; display:flex; align-items:center; gap:2px;" title="${task.comments.length} comments">
                                    💬 ${task.comments.length}
                                </span>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    };

    renderList(todoTasks, todoList);
    renderList(inProgressTasks, inProgressList);
    renderList(completedTasks, completedList);
}

// --- My Tasks Module (Employee Only) ---
let myTasks = [];

async function openMyTasks() {
    TaskManagerV2.open();
}

async function refreshMyTasks() {
    try {
        const empId = typeof currentUser !== 'undefined' && currentUser ? currentUser.id : '';
        console.log('DEBUG: refreshing my tasks for empId:', empId, 'currentUser:', window.currentUser);
        const res = await apiCall(`tasks?employee_id=${empId}&scope=my`, 'GET');
        console.log('DEBUG: my tasks response:', res);
        if (res && res.success && Array.isArray(res.tasks)) {
            myTasks = res.tasks;
            renderMyTaskBoard();
            checkDueTomorrowReminders();

            // Immediate check for zero active tasks
            const activeCount = myTasks.filter(t => t.status === 'todo' || t.status === 'in_progress').length;
            if (activeCount === 0 && currentUser && currentUser.role !== 'admin') {
                if (!window._lastTaskWarningShown) {
                    openModal('noTasksModal');
                    window._lastTaskWarningShown = true;
                }
            } else {
                window._lastTaskWarningShown = false;
            }
        }
    } catch (error) {
        console.error('Error loading my tasks:', error);
        showNotification('Error loading tasks', 'error');
    }
}

function renderMyTaskBoard() {
    const todoList = document.getElementById('myTodoList');
    const inProgressList = document.getElementById('myInProgressList');
    const completedList = document.getElementById('myCompletedList');

    if (!todoList || !inProgressList || !completedList) return;

    const getPriorityWeight = (p) => {
        if (!p) return 99;
        p = p.toLowerCase();
        const w = { 'p1':1, 'p2':2, 'p3':3, 'p4':4, 'urgent':5, 'high':6, 'medium':7, 'low':8 };
        return w[p] || 99;
    };
    const todoTasks = myTasks.filter(t => t.status === 'todo').sort((a,b) => getPriorityWeight(a.priority) - getPriorityWeight(b.priority));
    const inProgressTasks = myTasks.filter(t => t.status === 'in_progress').sort((a,b) => getPriorityWeight(a.priority) - getPriorityWeight(b.priority));
    const completedTasks = myTasks.filter(t => t.status === 'completed').sort((a,b) => getPriorityWeight(a.priority) - getPriorityWeight(b.priority));

    document.getElementById('myTodoCount').textContent = todoTasks.length;
    document.getElementById('myInProgressCount').textContent = inProgressTasks.length;
    document.getElementById('myCompletedCount').textContent = completedTasks.length;

    const renderList = (taskList, container) => {
        if (!taskList.length) {
            container.innerHTML = '<div class="text-muted text-center p-3" style="color:#94a3b8; font-size:0.9rem;">No tasks</div>';
            return;
        }

        container.innerHTML = taskList.map((task, idx) => {
            const priorityClass = task.priority === 'High' ? 'priority-high' :
                (task.priority === 'Medium' ? 'priority-medium' : 'priority-low');

            // Due Date Logic
            let dueClass = '';
            let dueBadge = '';

            if (task.due_date) {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const due = new Date(task.due_date);
                due.setHours(0, 0, 0, 0);

                const diffTime = due - today;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays < 0) {
                    dueClass = 'task-card-overdue';
                } else if (diffDays <= 2) {
                    dueClass = 'task-card-urgent';
                } else if (diffDays <= 7) {
                    dueClass = 'task-card-warning';
                } else {
                    dueClass = 'task-card-safe';
                }

                if (diffDays === 1) {
                    dueBadge = '<span class="due-tomorrow-badge">Due Tomorrow!</span>';
                }
            }

            // Override for completed tasks: ALWAYS Green
            if (task.status === 'completed') {
                dueClass = 'task-card-safe';
                dueBadge = '';
            }

            return `
                <div class="premium-task-card ${dueClass}" id="mytask-${task.id}" onclick="openTaskDetail(${task.id})" style="animation: slideInUp 0.4s cubic-bezier(0.165, 0.84, 0.44, 1) forwards; animation-delay: ${idx * 50}ms; opacity:1; cursor:pointer;">
                    <div class="premium-card-header" style="flex-wrap: wrap; margin-bottom: 6px;">
                        ${task.status !== 'completed' ? `
                        <div style="display: flex; gap: 4px; align-items: center; max-width: 60%; flex-wrap: wrap;">
                            ${(task.history || []).filter(h => h.field === 'priority' && h.old && h.old !== task.priority).reverse().map(h => {
                                const hp = h.old.toLowerCase();
                                const hpClass = hp === 'high' ? 'priority-high' : (hp === 'medium' ? 'priority-medium' : (hp === 'urgent' ? 'priority-urgent' : (['p1','p2','p3','p4'].includes(hp)) ? `priority-${hp}` : 'priority-low'));
                                return `<span class="premium-priority-badge ${hpClass}" style="border-radius: 6px; padding: 4px 10px; opacity: 0.4; text-decoration: line-through; transform: scale(0.9);" title="Old Priority">${hp.toUpperCase()}</span>`;
                            }).join('')}
                            <span class="premium-priority-badge ${priorityClass}" style="border-radius: 6px; padding: 4px 10px;">${(task.priority || 'Medium').toUpperCase()}</span>
                        </div>
                        ` : '<div style="display: flex; max-width: 60%;"></div>'}
                        ${dueBadge}
                        <div style="display:flex; gap:8px; margin-left: auto;">
                            <button class="btn-icon-sm" onclick="event.stopPropagation(); editTask(${task.id})" style="background:#f1f5f9; border:none; color:#64748b; cursor:pointer; width:28px; height:28px; border-radius:6px; display:flex; align-items:center; justify-content:center; transition:all 0.2s; font-size: 10px;" title="Edit">✎</button>
                            ${typeof currentUser !== 'undefined' && currentUser && (currentUser.role === 'admin' || task.Mentor_id === currentUser.id) ? `
                            <button class="btn-icon-sm" onclick="event.stopPropagation(); deleteTask(${task.id})" style="background:#fef2f2; border:none; color:#ef4444; cursor:pointer; width:28px; height:28px; border-radius:6px; display:flex; align-items:center; justify-content:center; transition:all 0.2s; font-size: 10px;" title="Delete">🗑</button>
                            ` : ''}
                        </div>
                        ${task.comments && task.comments.length > 0 ? `
                        <span style="font-size:0.75rem; color:var(--primary-color); font-weight: 700; background:rgba(37, 99, 235, 0.1); padding:4px 8px; border-radius:6px; display:flex; align-items:center; gap:4px;">💬 ${task.comments.length}</span>
                        ` : ''}
                    </div>
                    
                    <h5 class="premium-task-title" style="margin: 0; font-size: 1.1rem; line-height: 1.5;">${task.title}</h5>
                    <p style="font-size:0.9rem; color:#64748b; margin: 0; line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${task.description || ''}</p>
                    
                    <div class="premium-task-meta" style="margin-top: 8px; padding-top: 12px; border-top: 1px solid #f1f5f9; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                        <span style="font-size:0.8rem; color:#94a3b8; font-weight: 600; display: flex; align-items: center; gap: 4px;">
                            <span style="font-size: 0.95rem;">📅</span> ${formatDateDMY(task.due_date)}
                        </span>
                        
                        ${(task.overseers && task.overseers.length > 0) ? `
                        <span style="font-size:0.75rem; color:#64748b; font-weight: 600; background:#f1f5f9; padding:4px 8px; border-radius:6px; display:flex; align-items:center; gap:4px;" title="Overseers: ${task.overseers.map(o => o.name).join(', ')}">
                            👁 <span style="max-width: 60px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${task.overseers.map(o => o.name).join(', ')}</span>
                        </span>
                        ` : ''}
                    </div>

                    <div style="margin-top: 4px; display:flex; gap:8px; justify-content:flex-end;" onclick="event.stopPropagation()">
                        ${task.status !== 'todo' ? `<button onclick="moveTask(${task.id}, 'todo', true)" style="font-size:0.75rem; padding:6px 12px; border:1px solid #e2e8f0; border-radius:8px; background:#f8fafc; color:#64748b; cursor:pointer; font-weight: 600; transition: all 0.2s;">← Todo</button>` : ''}
                        ${task.status !== 'in_progress' ? `<button onclick="moveTask(${task.id}, 'in_progress', true)" style="font-size:0.75rem; padding:6px 12px; border:1px solid #dbeafe; border-radius:8px; background:#eff6ff; color:#3b82f6; cursor:pointer; font-weight: 600; transition: all 0.2s;">In Prog</button>` : ''}
                        ${task.status !== 'completed' ? `<button onclick="moveTask(${task.id}, 'completed', true)" style="font-size:0.75rem; padding:6px 12px; border:1px solid #dcfce7; border-radius:8px; background:#f0fdf4; color:#10b981; cursor:pointer; font-weight: 600; transition: all 0.2s;">Done ✓</button>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    };

    renderList(todoTasks, todoList);
    renderList(inProgressTasks, inProgressList);
    renderList(completedTasks, completedList);
}

function updateDashboardVisibility() {
    if (!currentUser) return;

    const taskMentorCard = document.getElementById('taskMentorCard');
    const meetingMomCard = document.getElementById('meetingMomCard');
    const myTasksCard = document.getElementById('myTasksCard');
    const taskManagerV2Card = document.getElementById('taskManagerV2Card');
    const intelligenceHubCard = document.getElementById('intelligenceHubCard');
    const intelligenceHubCardEmployee = document.getElementById('intelligenceHubCardEmployee');
    const hubMyStatsBtn = document.getElementById('hubMyStatsBtn');
    const adminStatsGrid = document.getElementById('adminStatsGrid');
    const employeeStatsGrid = document.getElementById('employeeStatsGrid');

    // Task Manager V2 Card is visible for everyone
    if (taskManagerV2Card) taskManagerV2Card.classList.remove('hidden');

    if (currentUser.role === 'admin') {
        // Admin sees Admin Stats Grid and intelligenceHubCard
        if (taskMentorCard) taskMentorCard.classList.remove('hidden');
        if (meetingMomCard) meetingMomCard.classList.remove('hidden');
        if (myTasksCard) myTasksCard.classList.add('hidden');

        if (intelligenceHubCard) intelligenceHubCard.classList.remove('hidden');
        if (intelligenceHubCardEmployee) intelligenceHubCardEmployee.classList.add('hidden');
        if (hubMyStatsBtn) hubMyStatsBtn.classList.add('hidden');

        if (adminStatsGrid) adminStatsGrid.classList.remove('hidden');
        if (employeeStatsGrid) employeeStatsGrid.classList.add('hidden');
    } else if (currentUser.role === 'Mentor' || currentUser.role === 'mentor' || currentUser.has_subordinates) {
        // Mentor sees Employee Stats Grid but retains Task Mentor access
        if (taskMentorCard) taskMentorCard.classList.remove('hidden');
        if (meetingMomCard) meetingMomCard.classList.remove('hidden');
        if (myTasksCard) myTasksCard.classList.remove('hidden');

        if (intelligenceHubCard) intelligenceHubCard.classList.add('hidden');
        if (intelligenceHubCardEmployee) intelligenceHubCardEmployee.classList.remove('hidden');
        if (hubMyStatsBtn) hubMyStatsBtn.classList.remove('hidden');

        if (adminStatsGrid) adminStatsGrid.classList.add('hidden');
        if (employeeStatsGrid) employeeStatsGrid.classList.remove('hidden');
    } else {
        // Regular Employee — now also sees MoM card
        if (taskMentorCard) taskMentorCard.classList.add('hidden');
        if (meetingMomCard) meetingMomCard.classList.remove('hidden'); // ← visible for all
        if (myTasksCard) myTasksCard.classList.remove('hidden');

        if (intelligenceHubCard) intelligenceHubCard.classList.add('hidden');
        if (intelligenceHubCardEmployee) intelligenceHubCardEmployee.classList.remove('hidden');
        if (hubMyStatsBtn) hubMyStatsBtn.classList.remove('hidden');

        if (adminStatsGrid) adminStatsGrid.classList.add('hidden');
        if (employeeStatsGrid) employeeStatsGrid.classList.remove('hidden');
    }

    // Initialize Intelligence Hub if defined
    if (typeof initIntelligenceHubVisibility === 'function') {
        initIntelligenceHubVisibility();
    }
}

// Legacy function removed as it is merged into renderTaskBoard logic above

// ─── MoM — Step-based with @user tagging ─────────────────────────────────────

/** Shared employee cache for @mention autocomplete */
window._momAllEmployees = [];
/** Next step counter */
window._momStepCounter = 0;

async function openMeetingMomModal() {
    showLoading('Opening Meeting MoM…');
    try {
        // Reset state
        window.currentEditingMeetingId = null;
        window._momStepCounter = 0;

        // Pre-fill date/time
        const now = getCurrentISTDate();
        document.getElementById('momTargetTitle').value = '';
        document.getElementById('momTargetDate').value  = now.toISOString().split('T')[0];
        document.getElementById('momStartTime').value   = now.toTimeString().slice(0, 5);
        document.getElementById('momNotes').value       = '';

        // Load employees for @mention
        if (!window._momAllEmployees.length) {
            try {
                const res = await apiCall('employees-simple', 'GET');
                if (res && res.success) window._momAllEmployees = res.employees || [];
            } catch(e) { console.warn('Could not load employees for MoM:', e); }
        }

        // Reset steps
        const stepsWrap = document.getElementById('momStepsWrap');
        stepsWrap.innerHTML = '';
        addMomStep(); // start with one empty step

        // Update button text
        const btnText = document.getElementById('saveMomText');
        if (btnText) btnText.textContent = 'Publish MoM';

        // Load history
        await fetchRecentMeetings();

        openModal('meetingMomModal');
    } finally {
        hideLoading();
    }
}

/** Add a new action-item step row */
function addMomStep(prefill = {}) {
    const wrap = document.getElementById('momStepsWrap');
    const idx = ++window._momStepCounter;
    const stepId = `momStep_${idx}`;

    const div = document.createElement('div');
    div.className = 'mom-step-row';
    div.id = stepId;
    div.innerHTML = `
        <div class="mom-step-number">${idx}</div>
        <div class="mom-step-body">
            <div class="mom-step-input-wrap">
                <textarea class="mom-step-text form-control"
                    placeholder="Describe this action item or discussion point…"
                    rows="2">${prefill.text || ''}</textarea>
                <div class="mom-step-tag-area">
                    <div class="mom-tag-chips" id="${stepId}_chips"></div>
                    <div class="mom-tag-input-row">
                        <span class="mom-at-icon">@</span>
                        <input type="text"
                            class="mom-tag-input"
                            placeholder="Tag a user…"
                            autocomplete="off"
                            oninput="filterMomTagSuggest(this, '${stepId}')"
                            onkeydown="momTagInputKey(event, this, '${stepId}')">
                        <div class="mom-tag-suggest hidden" id="${stepId}_suggest"></div>
                    </div>
                </div>
            </div>
        </div>
        <button type="button" class="mom-step-delete-btn" onclick="removeMomStep('${stepId}')" title="Remove step">×</button>
    `;
    wrap.appendChild(div);

    // Pre-fill tagged users if editing
    if (prefill.tagged && prefill.tagged.length) {
        prefill.tagged.forEach(u => _momAddChip(stepId, u.id, u.name));
    }
}

function removeMomStep(stepId) {
    const el = document.getElementById(stepId);
    if (el) el.remove();
    // Renumber visible steps
    document.querySelectorAll('#momStepsWrap .mom-step-row').forEach((row, i) => {
        const num = row.querySelector('.mom-step-number');
        if (num) num.textContent = i + 1;
    });
}

/** Filter employee suggestions in the tag input */
function filterMomTagSuggest(input, stepId) {
    const q = input.value.trim().toLowerCase();
    const box = document.getElementById(`${stepId}_suggest`);
    if (!q) { box.classList.add('hidden'); return; }

    const chips = _momGetChipIds(stepId);
    const matches = window._momAllEmployees.filter(e =>
        !chips.includes(e.id) &&
        (e.name.toLowerCase().includes(q) || (e.role || '').toLowerCase().includes(q))
    ).slice(0, 8);

    if (!matches.length) { box.classList.add('hidden'); return; }

    box.innerHTML = matches.map(e => `
        <div class="mom-suggest-item" onmousedown="event.preventDefault(); _momPickUser('${stepId}', ${e.id}, '${e.name.replace(/'/g, "\\'")}')">
            <span class="mom-suggest-avatar">${e.name.charAt(0)}</span>
            <span class="mom-suggest-name">${e.name}</span>
            <span class="mom-suggest-role">${e.role || ''}</span>
        </div>
    `).join('');
    box.classList.remove('hidden');
}

function momTagInputKey(e, input, stepId) {
    if (e.key === 'Escape') {
        document.getElementById(`${stepId}_suggest`).classList.add('hidden');
    }
}

function _momPickUser(stepId, empId, empName) {
    _momAddChip(stepId, empId, empName);
    const input = document.querySelector(`#${stepId} .mom-tag-input`);
    if (input) input.value = '';
    document.getElementById(`${stepId}_suggest`).classList.add('hidden');
}

function _momAddChip(stepId, empId, empName) {
    const chipsEl = document.getElementById(`${stepId}_chips`);
    if (!chipsEl) return;
    // Prevent duplicate chips
    if (chipsEl.querySelector(`[data-emp-id="${empId}"]`)) return;
    const chip = document.createElement('span');
    chip.className = 'mom-user-chip';
    chip.dataset.empId = empId;
    chip.innerHTML = `@${empName} <button type="button" onclick="_momRemoveChip('${stepId}', ${empId})">×</button>`;
    chipsEl.appendChild(chip);
}

function _momRemoveChip(stepId, empId) {
    const chipsEl = document.getElementById(`${stepId}_chips`);
    if (!chipsEl) return;
    const chip = chipsEl.querySelector(`[data-emp-id="${empId}"]`);
    if (chip) chip.remove();
}

function _momGetChipIds(stepId) {
    return Array.from(document.querySelectorAll(`#${stepId}_chips .mom-user-chip`))
        .map(c => parseInt(c.dataset.empId));
}

function _momGetSteps() {
    return Array.from(document.querySelectorAll('#momStepsWrap .mom-step-row')).map(row => {
        const stepId = row.id;
        const text   = row.querySelector('.mom-step-text')?.value?.trim() || '';
        const tagged = Array.from(row.querySelectorAll(`#${stepId}_chips .mom-user-chip`)).map(c => ({
            id:   parseInt(c.dataset.empId),
            name: c.textContent.replace('×', '').replace('@', '').trim()
        }));
        return { text, tagged };
    }).filter(s => s.text);
}

/** Save / Publish MoM */
async function saveMeetingMom() {
    const title = document.getElementById('momTargetTitle').value.trim();
    if (!title) { showNotification('Meeting purpose (title) is required', 'error'); return; }

    const steps = _momGetSteps();
    if (!steps.length) { showNotification('Add at least one action item step', 'warning'); return; }

    const meetingDate = document.getElementById('momTargetDate').value;
    const meetingTime = document.getElementById('momStartTime').value;
    const notes       = document.getElementById('momNotes').value.trim();

    const btnBtn  = document.getElementById('saveMomBtn');
    const btnText = document.getElementById('saveMomText');
    const spinner = document.getElementById('saveMomSpinner');
    if (btnBtn) btnBtn.disabled = true;
    if (btnText) btnText.classList.add('hidden');
    if (spinner) spinner.classList.remove('hidden');

    try {
        // Collect all unique participant IDs across steps
        const allParticipantIds = [...new Set(steps.flatMap(s => s.tagged.map(u => u.id)))];

        // Date helpers
        let fmtStart = meetingDate || getCurrentISTDate().toISOString().split('T')[0];
        let dueDate  = new Date(fmtStart);
        dueDate.setDate(dueDate.getDate() + 1);
        const fmtDue = dueDate.toISOString().split('T')[0];
        const scheduledStr = (meetingDate && meetingTime) ? `${meetingDate} at ${meetingTime}` : 'Now';

        // 1. Create or update the Meeting record
        const meetingPayload = {
            title,
            description: notes || `Meeting on ${meetingDate} at ${meetingTime}`,
            date:         fmtStart,
            start_time:   meetingTime || null,
            participants: allParticipantIds,
            created_by:   currentUser.id,
            steps_json:   JSON.stringify(steps)   // stored in description as JSON note
        };

        let meetingId = window.currentEditingMeetingId;
        if (meetingId) {
            await apiCall(`meetings/${meetingId}`, 'PATCH', meetingPayload);
        } else {
            const mRes = await apiCall('meetings', 'POST', meetingPayload);
            meetingId = mRes?.meeting_id;
        }

        // 2. For each step that has tagged users → create one Task (skip duplicates)
        let tasksCreated = 0;
        for (const step of steps) {
            if (!step.tagged.length) continue;
            const assigneeIds = step.tagged.map(u => u.id);
            const taskTitle   = `[MoM] ${title}: ${step.text.slice(0, 80)}`;

            const taskPayload = {
                title:        taskTitle,
                description:  `From MoM: "${title}"\n📅 ${scheduledStr}\n\n${step.text}${notes ? '\n\nNotes: ' + notes : ''}`,
                priority:     'high',
                start_date:   fmtStart,
                due_date:     fmtDue,
                assignees:    assigneeIds,
                overseer_ids: [currentUser.id],
                user_id:      currentUser.id,
                employee_id:  currentUser.id,
                created_by:   currentUser.id,
                mom_meeting_id: meetingId,     // custom marker (backend ignores unknown fields safely)
                check_duplicate_mom: true       // hint to backend
            };
            const tRes = await apiCall('tasks/create', 'POST', taskPayload);
            if (tRes?.success) tasksCreated++;
        }

        showNotification(
            window.currentEditingMeetingId
                ? `MoM updated — ${tasksCreated} task(s) refreshed`
                : `MoM published — ${tasksCreated} task(s) assigned with notifications`,
            'success'
        );
        closeModal('meetingMomModal');
        if (typeof refreshTasks === 'function') await refreshTasks();

    } catch(e) {
        console.error('saveMeetingMom error:', e);
        showNotification('Error publishing MoM', 'error');
    } finally {
        if (btnBtn) btnBtn.disabled = false;
        if (btnText) btnText.classList.remove('hidden');
        if (spinner) spinner.classList.add('hidden');
    }
}

async function fetchRecentMeetings() {
    const listContainer = document.getElementById('recentMeetingsList');
    if (!listContainer) return;
    try {
        const res = await apiCall('meetings', 'GET', { employee_id: currentUser?.id });
        if (res && res.success) {
            renderRecentMeetings(res.meetings);
        } else {
            listContainer.innerHTML = '<div style="text-align:center;color:#ef4444;padding:20px;">Failed to load meetings</div>';
        }
    } catch(e) {
        listContainer.innerHTML = '<div style="text-align:center;color:#ef4444;padding:20px;">Error fetching meetings</div>';
    }
}

function renderRecentMeetings(meetings) {
    const container = document.getElementById('recentMeetingsList');
    if (!container) return;
    if (!meetings || !meetings.length) {
        container.innerHTML = '<div style="text-align:center;color:#64748b;padding:20px;">No meetings yet — create one above!</div>';
        return;
    }
    container.innerHTML = meetings.map(m => {
        const canManage = currentUser && (
            currentUser.role === 'admin' ||
            currentUser.role === 'Mentor' ||
            currentUser.role === 'mentor' ||
            m.created_by_id === currentUser.id
        );
        return `
        <div class="mom-history-item">
            <div class="mom-history-body">
                <div class="mom-history-title">${m.title}</div>
                <div class="mom-history-meta">📅 ${m.display_date} &nbsp;🕒 ${m.display_time}</div>
                <div class="mom-history-creator">By ${m.created_by_name} · ${m.participants.length} participant(s)</div>
            </div>
            ${canManage ? `
            <div class="mom-history-actions">
                <button onclick='editMeeting(${JSON.stringify(m).replace(/'/g,"&apos;")})' class="mom-hist-btn mom-hist-edit" title="Edit">✏️</button>
                <button onclick="deleteMeeting(${m.id})" class="mom-hist-btn mom-hist-del" title="Delete">🗑️</button>
            </div>` : ''}
        </div>`;
    }).join('');
}

async function deleteMeeting(id) {
    if (!(await showConfirm('Delete this meeting record? Assigned tasks will remain.', 'Delete Meeting', '🗑️'))) return;
    try {
        const res = await apiCall(`meetings/${id}`, 'DELETE');
        if (res?.success) {
            showNotification('Meeting deleted', 'success');
            fetchRecentMeetings();
        } else {
            showNotification('Failed to delete meeting', 'error');
        }
    } catch(e) { showNotification('Error deleting meeting', 'error'); }
}

function editMeeting(m) {
    // Populate header fields
    document.getElementById('momTargetTitle').value = m.title;
    document.getElementById('momTargetDate').value  = m.date;
    document.getElementById('momStartTime').value   = m.start_time || '';
    document.getElementById('momNotes').value       = m.description || '';

    // Rebuild steps
    const stepsWrap = document.getElementById('momStepsWrap');
    stepsWrap.innerHTML = '';
    window._momStepCounter = 0;

    // Prefer the parsed steps array from the API
    const parsedSteps = Array.isArray(m.steps) && m.steps.length ? m.steps : [];

    if (parsedSteps.length) {
        parsedSteps.forEach(s => addMomStep(s));
    } else {
        // Legacy fallback: one step with all participants tagged
        addMomStep({ text: m.title, tagged: m.participants || [] });
    }

    window.currentEditingMeetingId = m.id;
    const btnText = document.getElementById('saveMomText');
    if (btnText) btnText.textContent = 'Update MoM';

    // Scroll modal to top
    const body = document.querySelector('#meetingMomModal .premium-modal-body');
    if (body) body.scrollTop = 0;
}


function addNewTask(autoAssigneeId = null) {
    TaskManagerV2.openNewTaskModal(autoAssigneeId);
}

/**
 * Populate Edit Task Modal
 */
async function editTask(taskId) {
    TaskManagerV2.openDetail(taskId);
}

// Task state variables are further down near multi-select logic

async function populateTaskAssigneeDropdown() {
    try {
        const res = await apiCall('employees-simple', 'GET');
        if (res && res.success && Array.isArray(res.employees)) {
            window.allEmployeesSimple = res.employees; // Store for lookup

            // Populate Multi-Select Options
            populateEmployeeListInDropdown('multiSelectOptionsList', false);

            const MentorSelect = document.getElementById('taskMentor');
            if (MentorSelect) {
                // Allow selecting any employee as a Mentor/overseer
                MentorSelect.innerHTML = '<option value="none">Optional: Select Mentor...</option>' +
                    res.employees.map(emp => `<option value="${emp.id}">${emp.name} (${emp.role})</option>`).join('');
            }
            // Populate Overseer Multi-Select
            populateOverseerListInDropdown('overseerOptionsList');
        }
    } catch (error) {
        console.error('Error loading users for task assignment:', error);
    }
}

// Auto-select Mentor when assignee changes
document.addEventListener('change', (e) => {
    if (e.target.id === 'taskAssignee') {
        const empId = parseInt(e.target.value);
        if (!empId || !window.allEmployeesSimple) return;

        const emp = window.allEmployeesSimple.find(x => x.id === empId);
        if (emp && emp.Mentor_id) {
            const MentorSelect = document.getElementById('taskMentor');
            if (MentorSelect) {
                MentorSelect.value = emp.Mentor_id;
            }
        }
    }
});

async function saveNewTask() {
    showLoading("Saving task...");
    const title = document.getElementById('taskTitle').value.trim();
    const description = document.getElementById('taskDescription').value.trim();
    const priority = document.getElementById('taskPriority').value;
    const startDate = document.getElementById('taskStartDate').value;
    const dueDate = document.getElementById('taskDueDate').value;

    if (!title) {
        hideLoading();
        showNotification('Task title is required', 'error');
        return;
    }

    if (!dueDate) {
        hideLoading();
        showNotification('Completion deadline is required', 'error');
        return;
    }

    if (!window.currentEditingTaskId && selectedEmployeeIds.length === 0) {
        hideLoading();
        showNotification('Please select at least one employee', 'error');
        return;
    }

    const btn = document.getElementById('saveTaskBtn');
    const btnText = document.getElementById('saveTaskText');
    const spinner = document.getElementById('saveTaskSpinner');

    btn.disabled = true;
    if (btnText) btnText.classList.add('hidden');
    if (spinner) spinner.classList.remove('hidden');

    try {
        const url = window.currentEditingTaskId ? `tasks/${window.currentEditingTaskId}` : 'tasks/create';
        const method = 'POST'; // Backend uses POST for both creation and update

        const payload = {
            title,
            description,
            priority,
            start_date: startDate || null,
            due_date: dueDate || null,
            assignees: selectedEmployeeIds,
            overseer_ids: selectedOverseerIds,
            user_id: typeof currentUser !== 'undefined' && currentUser ? currentUser.id : null,
            employee_id: typeof currentUser !== 'undefined' && currentUser ? currentUser.id : null,
            created_by: typeof currentUser !== 'undefined' && currentUser ? currentUser.id : null
        };

        const res = await apiCall(url, method, payload);

        if (res && res.success) {
            showNotification(window.currentEditingTaskId ? 'Task updated successfully' : 'Task(s) created successfully');
            closeModal('addTaskModal');
            window.currentEditingTaskId = null;
            await refreshTasks();
            if (typeof refreshMyTasks === 'function') await refreshMyTasks();
            await loadActiveTasks(); // Update dashboard count
        } else {
            showNotification(res?.message || (window.currentEditingTaskId ? 'Failed to update task' : 'Failed to create task'), 'error');
        }
    } catch (error) {
        console.error('Error creating task:', error);
        showNotification('Error creating task', 'error');
    } finally {
        if (btn) btn.disabled = false;
        if (btnText) btnText.classList.remove('hidden');
        if (spinner) spinner.classList.add('hidden');
    }
}

async function requestNewTaskFromMentor() {
    const btn = document.getElementById('btnRequestTask');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Sending...';
    }

    // Close the warning modal immediately (User: "Board Empty card did not close")
    closeModal('noTasksModal');

    showLoading("Requesting new task from mentor...");
    try {
        const res = await apiCall('request-new-task', 'POST', {
            user_id: currentUser.id
        });

        if (res && res.success) {
            showNotification('Request sent successfully! 🚀', 'success');
            window._lastTaskWarningShown = true;
        } else {
            showNotification(res.message || 'Failed to send request', 'error');
            // If already sent or failed, we keep button disabled or just reset? 
            // Better allow them to try again later if it was a real failure.
            if (btn) btn.disabled = false;
        }
    } catch (e) {
        console.error('Task request error:', e);
        showNotification('Connection error', 'error');
        if (btn) btn.disabled = false;
    } finally {
        if (btn) btn.textContent = '🚀 Request New Task';
        hideLoading();
    }
}

let currentSelectedTaskId = null;

async function openTaskDetail(taskId) {
    TaskManagerV2.openDetail(taskId);
}

function renderTaskComments(comments) {
    const list = document.getElementById('taskCommentsList');
    if (!comments.length) {
        list.innerHTML = '<p style="text-align:center; color:#94a3b8; font-size:0.9rem; margin-top:20px;">No comments yet.</p>';
        return;
    }

    list.innerHTML = comments.map(c => `
        <div style="display: flex; flex-direction: column; gap: 4px; background: #f8fafc; padding: 12px; border-radius: 12px; border: 1px solid #f1f5f9;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-weight: 700; color: #1e293b; font-size: 0.85rem;">${c.author_name}</span>
                <span style="font-size: 0.75rem; color: #94a3b8;">${formatDateDMY(c.created_at)} ${formatTimeOnly(c.created_at)}</span>
            </div>
            <p style="margin: 0; color: #334155; font-size: 0.95rem; line-height: 1.5;">${c.content}</p>
        </div>
    `).join('');

    // Scroll to bottom
    setTimeout(() => {
        list.scrollTop = list.scrollHeight;
    }, 100);
}

async function submitTaskComment() {
    showLoading("Posting comment...");
    const content = document.getElementById('newTaskComment').value.trim();
    if (!content || !currentSelectedTaskId) {
        hideLoading();
        return;
    }

    try {
        const res = await apiCall('task-comment', 'POST', {
            task_id: currentSelectedTaskId,
            author_id: currentUser.id,
            content: content
        });

        if (res && res.success) {
            document.getElementById('newTaskComment').value = '';
            // Refresh tasks to get the new comment (or we could just append locally)
            await Promise.all([refreshTasks(), refreshMyTasks()]);

            // Find updated task and re-render comments
            const updatedTask = [...tasks, ...myTasks].find(t => t.id === currentSelectedTaskId);
            if (updatedTask) {
                renderTaskComments(updatedTask.comments || []);
            }
        } else {
            showNotification(res.message || 'Failed to add comment', 'error');
        }
    } catch (error) {
        console.error('Error adding comment:', error);
        showNotification('An error occurred', 'error');
    } finally {
        hideLoading();
    }
}

// NEW TASK STEP FUNCTIONS
function addNewStepUI() {
    document.getElementById('addStepInputWrapper').classList.toggle('hidden');
    document.getElementById('newStepText').focus();
}

async function saveNewStep() {
    const text = document.getElementById('newStepText').value.trim();
    if (!text || !currentSelectedTaskId) return;

    showLoading("Adding step...");
    try {
        const t = [...tasks, ...myTasks].find(t => t.id === currentSelectedTaskId);
        const currentSteps = t.steps || [];
        const newSteps = [...currentSteps, { text: text, is_completed: false }];

        const res = await apiCall(`tasks/${currentSelectedTaskId}`, 'POST', {
            user_id: currentUser.id,
            steps: newSteps
        });

        if (res && res.success) {
            document.getElementById('newStepText').value = '';
            document.getElementById('addStepInputWrapper').classList.add('hidden');
            await Promise.all([refreshTasks(), refreshMyTasks()]);
            await openTaskDetail(currentSelectedTaskId);
        }
    } catch (e) {
        showNotification('Error adding step', 'error');
    } finally {
        hideLoading();
    }
}

async function toggleTaskStep(taskId, stepId, isCompleted) {
    showLoading(isCompleted ? "Completing step..." : "Undoing step...");
    try {
        const t = [...tasks, ...myTasks].find(t => t.id === taskId);
        const updatedSteps = (t.steps || []).map(s => {
            if (s.id === stepId) return { ...s, is_completed: isCompleted };
            return s;
        });

        const res = await apiCall(`tasks/${taskId}`, 'POST', {
            user_id: currentUser.id,
            steps: updatedSteps
        });

        if (res && res.success) {
            await Promise.all([refreshTasks(), refreshMyTasks()]);
            // Re-render only if modal still open
            if (currentSelectedTaskId === taskId) {
                await openTaskDetail(taskId);
            }
        }
    } catch (e) {
        showNotification('Error updating step', 'error');
    } finally {
        hideLoading();
    }
}

// BULK PRIORITY MODE LOGIC
window._isPriorityMode = false;
window._prioritySelection = [];

function enterPriorityMode() {
    window._isPriorityMode = !window._isPriorityMode;
    const btn = document.getElementById('btnEnterPriorityMode');
    const saveBtn = document.getElementById('btnSavePriority');
    
    if (window._isPriorityMode) {
        btn.textContent = '❌ Cancel Mode';
        btn.style.background = '#64748b';
        saveBtn.classList.remove('hidden');
        window._prioritySelection = [];
        showNotification('Priority Mode Active. Click tasks in order (P1, P2...)', 'info');
    } else {
        btn.textContent = '⭐ Prioritize';
        btn.style.background = '#f59e0b';
        saveBtn.classList.add('hidden');
        window._prioritySelection = [];
    }
    
    renderTaskBoard();
}

function togglePrioritySelection(taskId) {
    const index = window._prioritySelection.indexOf(taskId);
    if (index > -1) {
        window._prioritySelection.splice(index, 1);
    } else {
        window._prioritySelection.push(taskId);
    }
    renderTaskBoard();
}

async function savePriorityOrder() {
    if (window._prioritySelection.length === 0) {
        showNotification('No tasks selected', 'warning');
        return;
    }

    showLoading("Saving Priority Order...");
    try {
        const updates = window._prioritySelection.map((id, idx) => ({
            id: id,
            priority: `p${idx + 1}`
        }));

        const res = await apiCall('bulk-update-tasks', 'POST', {
            user_id: currentUser.id,
            updates: updates
        });

        if (res && res.success) {
            showNotification('Priority order updated successfully', 'success');
            enterPriorityMode(); // Exit mode
            await refreshTasks();
        } else {
            showNotification(res.message || 'Failed to update priority', 'error');
        }
    } catch (e) {
        console.error(e);
        showNotification('An error occurred', 'error');
    } finally {
        hideLoading();
    }
}

async function moveTask(taskId, newStatus, isMyTask = false) {
    try {
        const payload = {
            status: newStatus,
            user_id: typeof currentUser !== 'undefined' && currentUser ? currentUser.id : null
        };
        const res = await apiCall(`tasks/${taskId}`, 'POST', payload);
        if (res && res.success) {
            if (isMyTask) {
                await refreshMyTasks();
            } else {
                await refreshTasks();
            }
            await loadActiveTasks(); // Update dashboard count
        } else {
            showNotification('Failed to update task: ' + (res?.message || 'Unauthorized'), 'error');
        }
    } catch (error) {
        console.error('Error updating task:', error);
        showNotification('Error updating task', 'error');
    }
}

async function deleteTask(taskId) {
    if (!(await showConfirm('Are you sure you want to delete this task?', 'Delete Task', '🗑️'))) return;
    showLoading("Deleting task...");

    try {
        const payload = {
            _method: 'DELETE',
            user_id: typeof currentUser !== 'undefined' && currentUser ? currentUser.id : null
        };
        const res = await apiCall(`tasks/${taskId}`, 'POST', payload);
        if (res && res.success) {
            showNotification('Task deleted');
            await refreshTasks();
            if (typeof refreshMyTasks === 'function') await refreshMyTasks();
            await loadActiveTasks(); // Update dashboard count
        } else {
            showNotification('Failed to delete task: ' + (res?.message || 'Unauthorized'), 'error');
        }
    } catch (error) {
        console.error('Error deleting task:', error);
        showNotification('Error deleting task', 'error');
    } finally {
        hideLoading();
    }
}

async function approveRequest(requestId, type) {
    showLoading(`Approving ${type.toUpperCase()} request...`);
    try {
        const endpoint = type === 'wfh' ? 'wfh-request-approve' : 'leave-request-approve';
        const res = await apiCall(endpoint, 'POST', {
            request_id: requestId,
            reviewed_by: typeof currentUser !== 'undefined' && currentUser ? currentUser.id : null
        });

        if (res && res.success) {
            showNotification(`${type.toUpperCase()} request approved`);
            await openRequestsModal(); // Refresh the modal
            await loadPendingRequests(); // Update dashboard count
        } else {
            showNotification('Failed to approve request', 'error');
        }
    } catch (error) {
        console.error('Error approving request:', error);
        showNotification('Error approving request', 'error');
    } finally {
        hideLoading();
    }
}

async function rejectRequest(requestId, type) {
    const reason = await openRejectionModal(requestId);
    if (reason === null) return; // User cancelled

    showLoading(`Rejecting ${type.toUpperCase()} request...`);
    try {
        const endpoint = type === 'wfh' ? 'wfh-request-approve' : 'leave-request-approve';
        // For rejection, we use the approve endpoint but with status='rejected'
        const res = await apiCall(endpoint, 'POST', {
            request_id: requestId,
            status: 'rejected',
            admin_response: reason,
            reviewed_by: typeof currentUser !== 'undefined' && currentUser ? currentUser.id : null
        });

        if (res && res.success) {
            showNotification(`${type.toUpperCase()} request rejected`);
            await openRequestsModal(); // Refresh the modal
            await loadPendingRequests(); // Update dashboard count
        } else {
            showNotification('Failed to reject request', 'error');
        }
    } catch (error) {
        console.error('Error rejecting request:', error);
        showNotification('Error rejecting request', 'error');
    } finally {
        hideLoading();
    }
}

/* ==================== MY REQUESTS POPUP ==================== */

/* ==================== MY REQUESTS POPUP (STATUS OVERVIEW) ==================== */

function openMyRequests(initialView = 'overview') {
    showLoading("Opening your requests...");
    openModal('myRequestsModal');
    loadStatusOverview();
    if (initialView === 'history') {
        // We can't call toggleHistoryView directly because it toggles.
        // We ensure it's in history view.
        const ovContainer = document.querySelector('.overview-container');
        const histView = document.getElementById('historyView');
        if (ovContainer && histView) {
            ovContainer.classList.add('hidden');
            histView.classList.remove('hidden');
            loadMyRequests();
        }
    }
    hideLoading();
}

let viewingOverviewMonth = null;
let viewingOverviewYear = null;

async function loadStatusOverview() {
    if (!currentUser) return;

    if (viewingOverviewMonth === null) {
        const today = getCurrentISTDate();
        viewingOverviewMonth = today.getMonth() + 1; // 1-12
        viewingOverviewYear = today.getFullYear();
    }

    // Reset View
    const ovContainer = document.querySelector('.overview-container');
    const histView = document.getElementById('historyView');
    if (ovContainer) ovContainer.classList.remove('hidden');
    if (histView) histView.classList.add('hidden');

    // 1. Set Date Label
    const dateStr = new Date(viewingOverviewYear, viewingOverviewMonth - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const modalDate = document.getElementById('modalDate');
    if (modalDate) modalDate.textContent = dateStr;

    // 2. Fetch Monthly Stats
    try {
        const result = await apiCall('monthly-stats', 'GET', {
            employee_id: currentUser.id,
            month: viewingOverviewMonth,
            year: viewingOverviewYear
        });

        if (result && result.success && result.stats) {
            const stats = result.stats;

            // Populate Grid
            const officeEl = document.getElementById('ovOffice');
            const wfhEl = document.getElementById('ovWFH');
            const halfDayEl = document.getElementById('ovHalfDay');
            const leavesEl = document.getElementById('ovLeaves');
            const balanceEl = document.getElementById('ovLeaveBalance');
            const optionalEl = document.getElementById('ovOptional');
            const totalDaysEl = document.getElementById('ovTotalDays');
            
            if (totalDaysEl) totalDaysEl.textContent = stats.total_working_days || 0;
            if (officeEl) officeEl.textContent = stats.office_days || 0;
            if (wfhEl) wfhEl.textContent = stats.wfh_days || 0;
            if (halfDayEl) halfDayEl.textContent = stats.half_days || 0;

            // Leaves format: taken / allowance
            if (leavesEl) {
                const allowance = stats.leave_allowance || 0;
                leavesEl.textContent = `${stats.leave_days || 0}/${allowance}`;
            }
            
            // Balance format: taken / total in year
            if (balanceEl) {
                const yearlyTaken = stats.yearly_taken || 0;
                const yearlyTotal = stats.yearly_allowance || 0;
                balanceEl.textContent = `${yearlyTaken}/${yearlyTotal}`;
                balanceEl.title = `Total Yearly Allowance: ${yearlyTotal}`;
            }

            if (optionalEl) {
                optionalEl.textContent = `${stats.optional_holidays || 0}/2`;
            }

            // Save leave dates for this viewed month and year
            currentLeaveDates = stats.leave_dates || [];
            yearlyLeaveDates = stats.yearly_leave_dates || [];

            // Apply Premium Animations
            const heroCard = document.querySelector('.overview-hero-card');
            if (heroCard) {
                heroCard.classList.remove('animate-entry');
                void heroCard.offsetWidth; // Trigger reflow
                heroCard.classList.add('animate-entry');
            }

            const statBoxes = document.querySelectorAll('.stat-box');
            statBoxes.forEach((box, index) => {
                box.classList.remove('animate-entry', `delay-${index + 1}`);
                void box.offsetWidth;
                box.classList.add('animate-entry', `delay-${index + 1}`);
            });
        }
    } catch (error) {
        console.error('Error loading overview stats:', error);
    }
}

function toggleHistoryView() {
    const overview = document.querySelector('.overview-container');
    const history = document.getElementById('historyView');

    if (overview && history) {
        if (history.classList.contains('hidden')) {
            // Show History
            overview.classList.add('hidden');
            history.classList.remove('hidden');
            loadMyRequests(); // Load data
        } else {
            // Show Overview
            history.classList.add('hidden');
            overview.classList.remove('hidden');
        }
    }
}

function changeOverviewMonth(direction) {
    if (viewingOverviewMonth === null) {
        const today = getCurrentISTDate();
        viewingOverviewMonth = today.getMonth() + 1;
        viewingOverviewYear = today.getFullYear();
    }

    viewingOverviewMonth += direction;
    if (viewingOverviewMonth > 12) {
        viewingOverviewMonth = 1;
        viewingOverviewYear++;
    } else if (viewingOverviewMonth < 1) {
        viewingOverviewMonth = 12;
        viewingOverviewYear--;
    }

    loadStatusOverview();
}

async function loadMyRequests() {
    if (!currentUser) return;

    const listEl = document.getElementById('myRequestsList');
    const emptyEl = document.getElementById('myRequestsEmpty');
    if (!listEl) return;

    listEl.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--gray-500);">Loading history...</div>';
    if (emptyEl) emptyEl.classList.add('hidden');

    try {
        const res = await apiCall('my-requests', 'GET', { employee_id: currentUser.id });

        if (res && res.success && Array.isArray(res.requests) && res.requests.length > 0) {
            listEl.innerHTML = res.requests.map(req => {
                let statusClass = 'status-badge status-absent'; // default gray/redish
                let statusText = req.status || 'Pending';
                let statusColor = '#ef4444'; // red
                let statusBg = '#fee2e2';

                if (statusText === 'approved') {
                    statusClass = 'status-badge status-present';
                    statusColor = '#10b981'; // green
                    statusBg = '#dcfce7';
                } else if (statusText === 'pending') {
                    statusClass = 'status-badge status-half_day';
                    statusColor = '#f59e0b'; // orange
                    statusBg = '#fef3c7';
                }

                // Icon & Title
                let icon = '📄';
                let title = 'Request';
                let iconBg = '#f3f4f6';

                if (req.request_type === 'wfh') { icon = '🏠'; title = 'Work From Home'; iconBg = '#e0e7ff'; }
                else if (req.request_type === 'full_day') { icon = '🏖️'; title = 'Leave (Full)'; iconBg = '#fee2e2'; }
                else if (req.request_type === 'half_day') { icon = '⏳'; title = 'Leave (Half)'; iconBg = '#fef9c3'; }

                // Date Formatting
                const dateDisplay = req.start_date === req.end_date
                    ? req.start_date
                    : `${req.start_date} → ${req.end_date}`;

                return `
                    <div class="history-card" style="
                        display: flex; 
                        justify-content: space-between; 
                        align-items: center; 
                        padding: 16px; 
                        background: white; 
                        border-radius: 12px; 
                        border: 1px solid var(--gray-100); 
                        box-shadow: 0 1px 3px rgba(0,0,0,0.02);
                        transition: all 0.2s ease;
                    " onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 4px 6px -1px rgba(0,0,0,0.05)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 1px 3px rgba(0,0,0,0.02)';">
                        
                        <div style="display: flex; align-items: center; gap: 16px;">
                            <div style="
                                width: 48px; 
                                height: 48px; 
                                border-radius: 12px; 
                                background: ${iconBg}; 
                                display: flex; 
                                align-items: center; 
                                justify-content: center; 
                                font-size: 20px;
                            ">${icon}</div>
                            
                            <div style="display: flex; flex-direction: column; gap: 2px;">
                                <div style="font-size: 14px; font-weight: 600; color: var(--gray-900);">${title}</div>
                                <div style="font-size: 12px; font-weight: 500; color: var(--gray-500);">${dateDisplay}</div>
                                <div style="font-size: 12px; color: var(--gray-400); margin-top: 2px; max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${req.reason || ''}</div>
                                ${req.admin_response ? `<div style="font-size: 11px; color: var(--primary-color); margin-top: 2px;">Admin: ${req.admin_response}</div>` : ''}
                            </div>
                        </div>

                        <div style="flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
                            <span style="
                                display: inline-block;
                                padding: 6px 12px;
                                border-radius: 20px;
                                font-size: 11px;
                                font-weight: 600;
                                text-transform: uppercase;
                                letter-spacing: 0.05em;
                                color: ${statusColor};
                                background: ${statusBg};
                            ">${statusText}</span>
                            ${req.reviewed_by_name ? `<div style="font-size: 10px; color: var(--gray-400); font-weight: 500;">By ${req.is_Mentor ? 'Mentor: ' : ''}${req.reviewed_by_name}</div>` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            listEl.innerHTML = '';
            if (emptyEl) emptyEl.classList.remove('hidden');
        }
    } catch (error) {
        console.error('Error loading my requests:', error);
        listEl.innerHTML = '<div style="text-align: center; color: #ef4444;">Failed to load requests</div>';
    }
}



// Custom Calendar Tooltip Helper Functions
function showCalendarTooltip(e, text) {
    let tooltip = document.getElementById('customCalendarTooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'customCalendarTooltip';
        tooltip.className = 'calendar-tooltip';
        document.body.appendChild(tooltip);
    }

    tooltip.textContent = text;
    tooltip.classList.add('visible');

    // Position
    tooltip.style.left = `${e.clientX + 10}px`; // Follow mouse slightly
    tooltip.style.top = `${e.clientY + 10}px`;
}

function hideCalendarTooltip() {
    const tooltip = document.getElementById('customCalendarTooltip');
    if (tooltip) {
        tooltip.classList.remove('visible');
    }
}

function updateCalendarDayDetails(record, day) {
    const panel = document.getElementById('calendarDayDetails');
    if (!panel) return;

    if (!record) {
        resetCalendarDayDetails();
        return;
    }

    let html = '';
    const monthLabel = document.getElementById('calendarMonthLabel')?.textContent || '';
    const dateStr = `${day} ${monthLabel}`;
    
    if (record.source === 'request') {
        const typeLabel = record.status === 'wfh' ? 'WFH' : (record.is_half_day ? 'Half Day' : 'Full Day');
        html = `
            <div style="width: 100%;">
                <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 8px; display: flex; justify-content: space-between;">
                    <span>${dateStr}</span>
                    <span style="color: #6366f1;">REQUEST</span>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div style="background: #f1f5f9; padding: 10px; border-radius: 10px;">
                        <div style="font-size: 9px; color: #94a3b8; font-weight: 700; text-transform: uppercase;">Type</div>
                        <div style="font-size: 14px; font-weight: 700; color: #1e293b;">${typeLabel}</div>
                    </div>
                    <div style="background: #f1f5f9; padding: 10px; border-radius: 10px;">
                        <div style="font-size: 9px; color: #94a3b8; font-weight: 700; text-transform: uppercase;">Status</div>
                        <div style="font-size: 14px; font-weight: 700; color: ${record.request_status === 'approved' ? '#10b981' : '#f59e0b'};">${record.request_status || 'Pending'}</div>
                    </div>
                </div>
            </div>
        `;
    } else if (record.source === 'holiday') {
        html = `
            <div style="width: 100%; text-align: center;">
                <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 4px;">${dateStr}</div>
                <div style="font-size: 18px; font-weight: 800; color: #ef4444; margin-bottom: 2px;">🎉 ${record.name || record.holidayName}</div>
                <div style="font-size: 11px; color: #94a3b8; font-weight: 600;">Public Holiday</div>
            </div>
        `;
    } else {
        // Regular attendance
        const checkIn = record.check_in_time || '--:--';
        const checkOut = record.check_out_time || '--:--';
        let hrs = '--';
        if (record.total_hours) {
            const h = Number(record.total_hours);
            if (!isNaN(h) && h > 0) {
                hrs = `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m`;
            }
        }

        html = `
            <div style="width: 100%;">
                <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 8px;">${dateStr}</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 10px;">
                    <div style="background: #f0fdf4; padding: 8px 12px; border-radius: 12px; border: 1px solid #dcfce7;">
                        <div style="font-size: 9px; color: #15803d; font-weight: 700; text-transform: uppercase;">Check In</div>
                        <div style="font-size: 15px; font-weight: 800; color: #166534;">${checkIn}</div>
                    </div>
                    <div style="background: #fff1f2; padding: 8px 12px; border-radius: 12px; border: 1px solid #ffe4e6;">
                        <div style="font-size: 9px; color: #be123c; font-weight: 700; text-transform: uppercase;">Check Out</div>
                        <div style="font-size: 15px; font-weight: 800; color: #9f1239;">${checkOut}</div>
                    </div>
                    <div style="background: #eef2ff; padding: 8px 12px; border-radius: 12px; border: 1px solid #e0e7ff;">
                        <div style="font-size: 9px; color: #4338ca; font-weight: 700; text-transform: uppercase;">Working Hrs</div>
                        <div style="font-size: 15px; font-weight: 800; color: #3730a3;">${hrs}</div>
                    </div>
                </div>
            </div>
        `;
    }

    panel.innerHTML = html;
    panel.style.background = 'white';
    panel.style.boxShadow = '0 10px 25px -5px rgba(0,0,0,0.05), 0 8px 10px -6px rgba(0,0,0,0.05)';
    panel.style.borderColor = '#e2e8f0';
}

function resetCalendarDayDetails() {
    const panel = document.getElementById('calendarDayDetails');
    if (!panel) return;
    panel.innerHTML = `
        <div class="placeholder-text" style="color: #94a3b8; font-style: italic; font-size: 13px; font-weight: 500;">
            Hover over a day to view detailed check-in / check-out times
        </div>
    `;
    panel.style.background = '#f8fafc';
    panel.style.boxShadow = 'none';
    panel.style.borderColor = '#e2e8f0';
}

let isCalendarBuilding = false;
async function openAttendanceCalendar() {
    if (!currentUser) {
        showNotification('Please login first', 'error');
        return;
    }

    if (isCalendarBuilding) return; // Guard against multiple builds

    showLoading("Initializing Attendance Calendar...");
    const modal = document.getElementById('calendarModal');
    if (modal && modal.classList.contains('active')) {
        hideLoading();
        return;
    }

    isCalendarBuilding = true;
    try {
        const now = getCurrentISTDate();
        currentCalendarMonth = now.getMonth();
        currentCalendarYear = now.getFullYear();
        await buildAttendanceCalendar(currentCalendarYear, currentCalendarMonth);
        openModal('calendarModal');
    } finally {
        isCalendarBuilding = false;
        hideLoading();
    }
}

async function changeCalendarMonth(offset) {
    let newMonth = currentCalendarMonth + offset;
    let newYear = currentCalendarYear;

    if (newMonth > 11) {
        newMonth = 0;
        newYear++;
    } else if (newMonth < 0) {
        newMonth = 11;
        newYear--;
    }

    currentCalendarMonth = newMonth;
    currentCalendarYear = newYear;
    await buildAttendanceCalendar(currentCalendarYear, currentCalendarMonth);
}

async function buildAttendanceCalendar(year, month) {
    showLoading("Building attendance matrix...");
    const grid = document.getElementById('calendarGrid');
    const label = document.getElementById('calendarMonthLabel');
    if (!grid || !label) {
        hideLoading();
        return;
    }

    grid.innerHTML = '';

    const monthName = new Date(year, month, 1).toLocaleString('default', {
        month: 'long',
        year: 'numeric'
    });
    label.textContent = monthName;

    // Weekday labels
    const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    weekDays.forEach(d => {
        const el = document.createElement('div');
        el.className = 'calendar-day-label';
        el.textContent = d;
        grid.appendChild(el);
    });

    // Fetch attendance records, requests, and holidays in parallel
    const [attendanceRes, requestsRes, holidaysRes] = await Promise.all([
        apiCall('attendance-records', 'GET', { employee_id: currentUser.id }),
        apiCall('my-requests', 'GET', { employee_id: currentUser.id }),
        apiCall('holidays', 'GET', { year: year, user_id: currentUser.id })
    ]);

    const allRecords = (attendanceRes && attendanceRes.success && Array.isArray(attendanceRes.records)) ? attendanceRes.records : [];
    const allRequests = (requestsRes && requestsRes.success && Array.isArray(requestsRes.requests)) ? requestsRes.requests : [];
    const allHolidays = (holidaysRes && holidaysRes.success && Array.isArray(holidaysRes.holidays)) ? holidaysRes.holidays : [];

    console.log('DEBUG Calendar Records:', allRecords.length);
    console.log('DEBUG Calendar Requests:', allRequests);

    const byDay = {};

    // 1. Map attendance records first
    allRecords.forEach(r => {
        if (!r.date) return;
        const d = new Date(r.date);
        if (d.getFullYear() === year && d.getMonth() === month) {
            byDay[d.getDate()] = { ...r, source: 'attendance' };
        }
    });

    // 2. Map requests (Leaves, WFH) - they should override 'absent' or empty slots
    allRequests.forEach(req => {
        if (!req.start_date) return;
        if (req.status === 'rejected') return; // User requested: rejected requests should disappear

        // Use a safe date parser to avoid UTC shifts
        const parseDate = (s) => {
            const parts = s.split('-');
            return new Date(parts[0], parts[1] - 1, parts[2]);
        };

        const start = parseDate(req.start_date);
        const end = parseDate(req.end_date || req.start_date);

        let curr = new Date(start);
        while (curr <= end) {
            if (curr.getFullYear() === year && curr.getMonth() === month) {
                const dayNum = curr.getDate();
                const type = req.type; // 'full_day', 'half_day', 'wfh'
                const reqStatus = req.status; // 'pending', 'approved'

                if (type === 'full_day' || type === 'half_day') {
                    // Overwrite if empty OR if currently says 'absent'
                    if (!byDay[dayNum] || byDay[dayNum].status === 'absent') {
                        byDay[dayNum] = {
                            ...req,
                            status: (type === 'half_day') ? 'half_day' : 'leave',
                            request_status: reqStatus,
                            source: 'request'
                        };
                    }
                } else if (type === 'wfh') {
                    if (!byDay[dayNum]) {
                        byDay[dayNum] = {
                            ...req,
                            status: 'wfh',
                            request_status: reqStatus,
                            source: 'request'
                        };
                    }
                }
            }
            curr.setDate(curr.getDate() + 1);
        }
    });
    
    // 3. Map Holidays - they should override 'absent' but NOT 'present'/'wfh'
    allHolidays.forEach(h => {
        if (!h.date) return;
        const d = new Date(h.date + 'T00:00:00');
        if (d.getFullYear() === year && d.getMonth() === month) {
            const dayNum = d.getDate();
            // Show all holidays. Regular ones or selected ones should have 'holiday' status.
            // Unselected optional ones should have 'optional' status.
            const isUserSelected = !!h.user_selected;
            const isRegular = !h.is_optional;

            if ((isRegular || isUserSelected) && !h.is_working_day) {
                // If there's no attendance record, or if it's 'absent', mark as holiday
                if (!byDay[dayNum] || byDay[dayNum].status === 'absent') {
                    byDay[dayNum] = {
                        ...h,
                        status: 'holiday',
                        source: 'holiday',
                        isHoliday: true,
                        holidayName: h.name,
                        isOptional: h.is_optional,
                        isSelected: isUserSelected,
                        isWorkingDay: h.is_working_day
                    };
                } else if (byDay[dayNum]) {
                    byDay[dayNum].isHoliday = true;
                    byDay[dayNum].holidayName = h.name;
                    byDay[dayNum].isOptional = h.is_optional;
                    byDay[dayNum].isSelected = isUserSelected;
                    byDay[dayNum].isWorkingDay = h.is_working_day;
                }
            } else {
                // If it's a working day or unselected optional, just add metadata without changing status
                if (byDay[dayNum]) {
                    byDay[dayNum].isHoliday = true;
                    byDay[dayNum].holidayName = h.name;
                    byDay[dayNum].isOptional = h.is_optional;
                    byDay[dayNum].isSelected = isUserSelected;
                    byDay[dayNum].isWorkingDay = h.is_working_day;
                    if (h.is_optional && !isUserSelected) {
                         // Keep optional status if it was already set or is absent
                         if (!byDay[dayNum].status || byDay[dayNum].status === 'absent') {
                             byDay[dayNum].status = 'optional_holiday';
                         }
                    }
                } else {
                    byDay[dayNum] = {
                        ...h,
                        status: (h.is_optional && !isUserSelected) ? 'optional_holiday' : null,
                        source: 'holiday',
                        isHoliday: true,
                        holidayName: h.name,
                        isOptional: h.is_optional,
                        isSelected: isUserSelected,
                        isWorkingDay: h.is_working_day
                    };
                }
            }
        }
    });

    const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Empty cells before first day
    for (let i = 0; i < firstDay; i++) {
        const empty = document.createElement('div');
        empty.className = 'calendar-day empty';
        grid.appendChild(empty);
    }

    // Actual days
    const todayDate = getCurrentISTDate();
    todayDate.setHours(0, 0, 0, 0);

    for (let day = 1; day <= daysInMonth; day++) {
        const cell = document.createElement('div');
        const record = byDay[day];
        const status = record ? record.status : null;
        const currentDate = new Date(year, month, day);

        let cls = 'calendar-day';
        if (status === 'present') cls += ' cal-present';
        else if (status === 'client') cls += ' cal-client';
        else if (status === 'absent') cls += ' cal-absent';
        else if (status === 'wfh') cls += ' cal-wfh';
        else if (status === 'half_day') cls += ' cal-half';
        else if (status === 'leave') cls += ' cal-leave';
        else if (status === 'holiday') cls += ' cal-holiday';
        else if (status === 'optional_holiday') cls += ' cal-optional';

        // Add structure
        cell.innerHTML = `
            <span class="calendar-day-number">${day}</span>
            ${status ? '<div class="calendar-day-status-dot"></div>' : ''}
        `;

        // Tooltip logic
        if (record) {
            let tooltipLines = [];

            // If it's a request (WFH/Leave), show its status and who approved it
            if (record.source === 'request') {
                const typeLabel = record.status === 'wfh' ? 'WFH' : (record.is_half_day ? 'Half Day' : 'Full Day');
                tooltipLines.push(`Status: ${typeLabel} (${record.request_status || record.status})`);
                if (record.reviewed_by_name) {
                    tooltipLines.push(`${record.is_Mentor ? 'Mentor: ' : 'Admin: '}${record.reviewed_by_name}`);
                }
                if (record.isHoliday) {
                    tooltipLines.push(`Holiday: ${record.holidayName}`);
                    tooltipLines.push(`Type: ${record.isOptional ? 'Optional' : 'Holiday'}`);
                }
            } else if (record.source === 'holiday') {
                tooltipLines.push(`Holiday: ${record.name}`);
                tooltipLines.push(`Type: ${record.is_optional ? 'Optional' : 'Holiday'}`);
                if (record.is_optional) {
                    tooltipLines.push(`Status: ${record.user_selected ? 'Selected' : 'Not Selected'}`);
                }
            } else {
                // Regular attendance record
                if (record.isHoliday) {
                    tooltipLines.push(`Holiday: ${record.holidayName}`);
                    tooltipLines.push(`Type: ${record.isOptional ? 'Optional' : 'Holiday'}`);
                }
                if (record.check_in_time) tooltipLines.push(`In: ${record.check_in_time}`);
                if (record.check_out_time) tooltipLines.push(`Out: ${record.check_out_time}`);
                if (record.total_hours) {
                    const h = Number(record.total_hours);
                    if (!isNaN(h) && h > 0) {
                        tooltipLines.push(`Hrs: ${Math.floor(h)}h ${Math.round((h % 1) * 60)}m`);
                    }
                }
            }

            if (tooltipLines.length > 0) {
                cell.removeAttribute('title');
                const tooltipText = tooltipLines.join('\n');
                cell.onmouseenter = (e) => {
                    showCalendarTooltip(e, tooltipText);
                    updateCalendarDayDetails(record, day);
                };
                cell.onmousemove = (e) => showCalendarTooltip(e, tooltipText);
                cell.onmouseleave = () => {
                    hideCalendarTooltip();
                    resetCalendarDayDetails();
                };
            }
        }


        // Interactive check for future dates
        if (currentDate >= todayDate) { // Allow same day or future requests
            cell.onclick = () => {
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                if (isMultiSelectMode) {
                    toggleDateSelection(dateStr, cell);
                } else {
                    openRequestModal(dateStr);
                }
            };
            cell.style.cursor = 'pointer';
            if (!record) {
                cell.title = "Click to Request Leave/WFH";
            }


            // Restore selection state if re-rendering (e.g. month change)
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            if (selectedCalendarDates.includes(dateStr)) {
                cell.classList.add('selected');
            }
        }

        cell.className = cls;
        grid.appendChild(cell);
    }
    hideLoading();
}

function toggleMultiSelectMode() {
    const toggle = document.getElementById('multiSelectToggle');
    isMultiSelectMode = toggle.checked;

    // Clear selection when toggling
    selectedCalendarDates = [];
    document.querySelectorAll('.calendar-day.selected').forEach(el => el.classList.remove('selected'));
    updateMultiSelectUI();
}

function toggleDateSelection(dateStr, element) {
    const index = selectedCalendarDates.indexOf(dateStr);
    if (index > -1) {
        selectedCalendarDates.splice(index, 1);
        element.classList.remove('selected');
    } else {
        selectedCalendarDates.push(dateStr);
        element.classList.add('selected');
    }
    updateMultiSelectUI();
}

function updateMultiSelectUI() {
    const actions = document.getElementById('multiSelectActions');
    const btn = document.getElementById('multiRequestBtn');
    if (!actions || !btn) return;

    if (isMultiSelectMode && selectedCalendarDates.length > 0) {
        actions.classList.add('visible');
        btn.textContent = `Request for ${selectedCalendarDates.length} Selected Dates`;
    } else {
        actions.classList.remove('visible');
    }
}

function openMultiRequestModal() {
    if (selectedCalendarDates.length === 0) return;

    // Reset form
    const typeSelect = document.getElementById('requestType');
    if (typeSelect) typeSelect.value = 'wfh';
    toggleRequestPeriod();

    const reasonInput = document.getElementById('requestReason');
    if (reasonInput) reasonInput.value = '';

    const display = document.getElementById('requestActionDateDisplay');
    if (display) {
        display.innerHTML = `<strong>${selectedCalendarDates.length} Dates Selected:</strong><br>` +
            selectedCalendarDates.slice(0, 5).join(', ') +
            (selectedCalendarDates.length > 5 ? '...' : '');
    }

    // Use a special value or empty string for the hidden input to indicate multiple
    const input = document.getElementById('requestActionDate');
    if (input) input.value = 'multiple';

    openModal('requestActionModal');
}



async function loadTodayAttendance(isUserInRange = false) {
    // Sync initial state
    isUserGeoInRange = isUserInRange;
    try {
        const result = await apiCall('today-attendance', 'GET', {
            employee_id: currentUser.id
        });

        const statusElement = document.getElementById('todayStatus');
        const timingElement = document.getElementById('todayTiming');
        const checkInCard = document.getElementById('checkInCard');
        const checkOutCard = document.getElementById('checkOutCard');

        if (result.success && result.record) {
            const record = result.record;
            // Store for UI updates
            currentAttendanceRecord = record;
            window.currentAttendanceRecord = record;            // Helper to format time (HH:MM AM/PM)
            const formatTime = (timeStr) => {
                if (!timeStr) return '';
                const [h, m] = timeStr.split(':');
                const date = new Date();
                date.setHours(parseInt(h), parseInt(m));
                return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            };

            if (record.check_out_time) {
                statusElement.textContent = 'Completed';
                statusElement.className = 'stat-card-value success';

                const checkInFormatted = formatTime(record.check_in_time);
                const checkOutFormatted = formatTime(record.check_out_time);

                let html = `<div style="display:flex; flex-direction:column; gap:4px;">
                                <div><span style="opacity:0.8; font-size:0.9em;">Shift:</span> <span style="font-weight:600;">${checkInFormatted} - ${checkOutFormatted}</span></div>`;
                html += `</div>`;
                timingElement.innerHTML = html;

                checkInCard.classList.add('hidden');
                checkOutCard.classList.add('hidden');
            } else {
                statusElement.textContent = 'Checked In';
                statusElement.className = 'stat-card-value success';

                const checkInFormatted = formatTime(record.check_in_time);
                let html = `<div style="display:flex; flex-direction:column; gap:4px;">
                                <div><span style="opacity:0.8; font-size:0.9em;">Check-in:</span> <span style="font-weight:600;">${checkInFormatted}</span></div>`;

                // Add Mini Map Container
                html += `<div id="statusMiniMap" onclick="openMapModal()" style="height: 80px; width: 100%; margin-top: 6px; border-radius: 8px; z-index: 1; cursor: pointer; position: relative;">
                            <div style="position: absolute; bottom: 4px; right: 4px; background: rgba(255,255,255,0.9); padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; box-shadow: 0 2px 4px rgba(0,0,0,0.1); z-index: 1000;">View Full Map ⤢</div>
                         </div>`;
                html += `</div>`;
                timingElement.innerHTML = html;

                // Initialize Mini Map
                setTimeout(() => {
                    const mapEl = document.getElementById('statusMiniMap');
                    if (mapEl && typeof google !== 'undefined') {
                        const map = new google.maps.Map(mapEl, {
                            center: { lat: 20.5937, lng: 78.9629 },
                            zoom: 4,
                            disableDefaultUI: true,
                            gestureHandling: 'none',
                            zoomControl: false
                        });
                        window.statusMap = map;

                        const markers = [];
                        const bounds = new google.maps.LatLngBounds();

                        const getMarkerIcon = (gender) => {
                            let markerImage = '/static/images/marker-user.jpeg';
                            if (gender === 'male') markerImage = '/static/images/marker-user.png';
                            else if (gender === 'female') markerImage = '/static/images/marker-female.png';

                            return {
                                url: markerImage,
                                scaledSize: new google.maps.Size(40, 40),
                                anchor: new google.maps.Point(20, 20)
                            };
                        };

                        // 1. Check-In Location
                        if (record.check_in_location) {
                            try {
                                const loc = typeof record.check_in_location === 'string' ? JSON.parse(record.check_in_location) : record.check_in_location;
                                const lat = loc.latitude || loc.lat;
                                const lon = loc.longitude || loc.lon || loc.lng;
                                if (lat && lon) {
                                    const timeStr = record.check_in_time ? new Date(`1970-01-01T${record.check_in_time}`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                                    const pos = { lat, lng: lon };
                                    const marker = new google.maps.Marker({
                                        position: pos,
                                        map: map,
                                        icon: getMarkerIcon(record.gender),
                                        title: `Check In: ${timeStr}`
                                    });
                                    markers.push(marker);
                                    bounds.extend(pos);
                                }
                            } catch (e) { console.error('Error parsing check-in location', e); }
                        }

                        // 2. Check Out Location
                        if (record.check_out_location) {
                            try {
                                const loc = typeof record.check_out_location === 'string' ? JSON.parse(record.check_out_location) : record.check_out_location;
                                const lat = loc.latitude || loc.lat;
                                const lon = loc.longitude || loc.lon || loc.lng;
                                if (lat && lon) {
                                    const timeStr = record.check_out_time ? new Date(`1970-01-01T${record.check_out_time}`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                                    const pos = { lat, lng: lon };
                                    const marker = new google.maps.Marker({
                                        position: pos,
                                        map: map,
                                        icon: getMarkerIcon(record.gender),
                                        title: `Check Out: ${timeStr}`
                                    });
                                    markers.push(marker);
                                    bounds.extend(pos);
                                }
                            } catch (e) { console.error('Error parsing check_out location', e); }
                        }

                        if (markers.length > 0) {
                            map.fitBounds(bounds);
                            if (markers.length === 1) map.setZoom(15);
                        }
                    }
                }, 100);

                checkInCard.classList.add('hidden');
                checkOutCard.classList.remove('hidden');
                updateCheckOutButtonState();
            }
        } else {
            currentAttendanceRecord = null;
            statusElement.textContent = 'Not Marked';
            statusElement.className = 'stat-card-value error';
            timingElement.textContent = '';
            checkInCard.classList.remove('hidden');
            checkOutCard.classList.add('hidden');
        }
    } catch (error) {
        console.error('Error loading today attendance:', error);
    }
}

function updateCheckOutButtonState() {
    const checkOutCard = document.getElementById('checkOutCard');
    if (!checkOutCard || !currentAttendanceRecord) return;

    // Only apply geofence logic if it's an OFFICE check-in
    if (currentAttendanceRecord.type === 'office' && !isUserGeoInRange) {
        // User is checked in for "office" but is NOT in range
        checkOutCard.classList.add('disabled'); // Add 'disabled' CSS class
        checkOutCard.onclick = () => { // Remove original onclick
            showNotification('You must be in the office geofence to check out.', 'error');
        };
    } else {
        // User is WFH, Client, or in range
        checkOutCard.classList.remove('disabled');
        checkOutCard.onclick = () => showCheckOut(); // Restore original onclick
    }
}

async function loadMonthlyStats() {
    try {
        const result = await apiCall('monthly-stats', 'GET', {
            employee_id: currentUser.id
        });

        if (result && result.success && result.stats) {
            const stats = result.stats;
            const monthlyDaysElement = document.getElementById('monthlyDays');
            if (monthlyDaysElement) {
                monthlyDaysElement.textContent = stats.total_working_days || 0;
            }

            // Calculate Employee Regularity Percentage for the Intelligence Hub
            const regularityEl = document.getElementById('hubRegularityEmployee');
            if (regularityEl) {
                // Calculate total weekdays (Mon-Fri) passed so far in the current month
                const now = new Date();
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                let weekdaysSoFar = 0;
                let current = new Date(startOfMonth);

                while (current <= now) {
                    const dayOfWeek = current.getDay(); // 0 is Sunday, 6 is Saturday
                    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                        weekdaysSoFar++;
                    }
                    current.setDate(current.getDate() + 1);
                }

                const weekdayPresent = stats.weekday_present_days || 0;

                // Regularity: days present on weekdays / weekdays passed so far
                const regularity = weekdaysSoFar > 0 ? Math.min(100, Math.round((weekdayPresent / weekdaysSoFar) * 100)) : 0;
                regularityEl.textContent = `${regularity}%`;
            }
        }
    } catch (error) {
        console.error('Error loading monthly stats:', error);
    }
}

async function loadWFHEligibility() {
    try {
        const today = getCurrentISTDate();
        const year = today.getFullYear();
        const month = today.getMonth() + 1;

        // Fetch monthly stats for current month
        const result = await apiCall('monthly-stats', 'GET', {
            employee_id: currentUser.id,
            month: month,
            year: year
        });

        if (result && result.success && result.stats) {
            const stats = result.stats;

            // Update WFH Widget
            const statWFH = document.getElementById('statWFH');
            const wfhRing = document.getElementById('wfhRing');
            const maxWfhLimit = 2; // Per month
            const currentWfh = stats.wfh_days || 0;

            if (statWFH) {
                statWFH.textContent = `${currentWfh}/${maxWfhLimit}`;
                statWFH.style.color = currentWfh >= maxWfhLimit ? '#ef4444' : '#10b981';

                if (wfhRing) {
                    const wfhPercent = Math.min((currentWfh / maxWfhLimit), 1);
                    const wfhOffset = 150 - (wfhPercent * 150);
                    wfhRing.style.strokeDashoffset = wfhOffset;
                }
            }

            // Update Leave Widget (Dashboard)
            const statCL = document.getElementById('statCL');
            const clRing = document.getElementById('clRing');
            const monthlyLeaveAllowance = stats.leave_allowance || 1;
            const takenThisMonth = stats.leave_days || 0;

            if (statCL) {
                statCL.textContent = `${takenThisMonth}/${monthlyLeaveAllowance}`;
                statCL.style.color = takenThisMonth >= monthlyLeaveAllowance ? '#ef4444' : '#10b981';
                dashboardLeaveDates = stats.leave_dates || [];

                if (clRing) {
                    const clPercent = monthlyLeaveAllowance > 0 ? Math.min((takenThisMonth / monthlyLeaveAllowance), 1) : 0;
                    const clOffset = 150 - (clPercent * 150);
                    clRing.style.strokeDashoffset = clOffset;
                }
            }

            // Update Optional Holidays removed from dashboard

        }

    } catch (error) {
        console.error('Error loading WFH eligibility:', error);
    }
}

async function updateLocationStatus(updateAttendance = true) {
    if (typeof checkAndUpdateLocationStatus === 'function') {
        return await checkAndUpdateLocationStatus(updateAttendance);
    }
    return null;
}


// ── Geolocation Optimizations & Watching ─────────────────────────────────────

/**
 * Starts a persistent background geolocation watcher to keep the GPS hardware warm.
 * Updates the dashboard UI and currentPhotoLocation cache in real-time.
 */
function startDashboardLocationWatch() {
    if (!('geolocation' in navigator)) return;
    if (dashboardLocationWatchId !== null) return; // Already running

    console.log('GPS: Starting background dashboard location watch...');
    dashboardLocationWatchId = navigator.geolocation.watchPosition(
        (pos) => {
            const { latitude: lat, longitude: lng, accuracy } = pos.coords;
            const now = Date.now();

            // 1. Update global cache
            currentPhotoLocation = { lat, lng, accuracy: accuracy || 999, timestamp: now };

            // 2. If on dashboard, perform a lightweight UI refresh
            if (document.getElementById('dashboardScreen') && document.getElementById('dashboardScreen').classList.contains('active')) {
                _updateLocationDashboardUI(lat, lng, accuracy || 999);
            }
        },
        (err) => {
            console.warn('GPS Watcher Error:', err);
            // Don't show notifications here to avoid spamming the user on transient errors
        },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 }
    );
}

/**
 * Lightweight, non-async UI update for the location widget.
 * Used by the background watcher to provide instantaneous feedback.
 */
function _updateLocationDashboardUI(lat, lng, accuracy) {
    const statusEl = document.getElementById('locationStatus');
    const distEl = document.getElementById('locationDistance');
    if (!statusEl || !distEl) return;

    // Accuracy guard: if worse than 200m, keep previous status but show accuracy warning
    if (accuracy > 200) {
        // Only update if current status is checking or empty
        if (statusEl.textContent === 'Checking...') {
            statusEl.textContent = 'Optimizing GPS...';
            distEl.textContent = `Accuracy: ±${Math.round(accuracy)}m...`;
        }
        return;
    }

    // Reuse existing offices list if available in scope or global
    // Since we need offices to compute distance, we'll try to find nearby office.
    // We'll use a globally cached offices list or just wait for the periodic checkAndUpdateLocationStatus
    // to handle the heavy lifting. For now, we'll just update the cache.
}


// Computes "Location Status" on the dashboard and updates the UI
async function checkAndUpdateLocationStatus(updateAttendance = true) {
    const statusEl = document.getElementById('locationStatus');
    const distEl = document.getElementById('locationDistance');
    const btn = document.getElementById('enableLocationBtn');

    // FAST-PATH: If we already have a fresh background fix, use it immediately!
    const now = Date.now();
    if (currentPhotoLocation && currentPhotoLocation.accuracy <= 200 && (now - currentPhotoLocation.timestamp) < 15000) {
        console.log('GPS: Fast-path cache reuse for dashboard UI.');
        return _renderLocationResultInternal(currentPhotoLocation.lat, currentPhotoLocation.lng, currentPhotoLocation.accuracy, updateAttendance);
    }

    // Helper to render a retry link
    const showRetry = (msg, css = 'warning') => {
        statusEl.textContent = msg;
        statusEl.className = 'stat-card-value ' + css;
        distEl.innerHTML = `<a href="#" id="retryGeo" style="text-decoration:underline;">Retry location</a>`;
        const a = document.getElementById('retryGeo');
        if (a) a.onclick = (e) => { e.preventDefault(); checkAndUpdateLocationStatus(); };
    };

    // Start state
    statusEl.textContent = 'Checking...';
    statusEl.className = 'stat-card-value';
    distEl.textContent = '';

    // 1) Load offices (so we can compute distance)
    let offices = [];
    try {
        const res = await apiCall('offices', 'GET', { active: 1, department: currentUser.department });
        offices = (res && res.success && Array.isArray(res.offices)) ? res.offices : [];
    } catch { }
    if (offices.length === 0) {
        statusEl.textContent = 'No offices';
        statusEl.className = 'stat-card-value warning';
        distEl.textContent = '';
        return { inRange: false }; // <-- MODIFIED
    }

    // 2) Geolocation capability?
    if (!('geolocation' in navigator)) {
        showRetry('Location unavailable in this browser', 'warning');
        distEl.textContent = 'Use localhost/https and allow location';
        return { inRange: false }; // <-- MODIFIED
    }

    // 2.5) Check permission state to decide UI before requesting position
    if (navigator.permissions && navigator.permissions.query) {
        try {
            const status = await navigator.permissions.query({ name: 'geolocation' });
            if (status.state === 'denied') {
                showRetry('Location permission denied', 'error');
                showGeoPermissionHelp(distEl);
                return { inRange: false };
            }
            if (status.state === 'prompt') {
                // Render explicit enable button to trigger request and prompt
                distEl.innerHTML = `<button class="btn btn-primary" id="geoEnableBtn">Enable Location</button>`;
                const b = document.getElementById('geoEnableBtn');
                if (b) b.onclick = async () => { await requestLocationOnce(); checkAndUpdateLocationStatus(); };
                status.onchange = () => checkAndUpdateLocationStatus();
                statusEl.textContent = 'Location permission needed';
                statusEl.className = 'stat-card-value warning';
                return { inRange: false };
            }
        } catch { }
    }

    // Ensure background watcher is running
    startDashboardLocationWatch();

    // 3) Try to get position with good timeouts
    try {
        const pos = await new Promise((resolve, reject) => {
            let settled = false;
            const guard = setTimeout(() => { if (!settled) { settled = true; reject(Object.assign(new Error('timeout'), { code: 3 })); } }, 65000);
            navigator.geolocation.getCurrentPosition(
                (p) => { if (!settled) { settled = true; clearTimeout(guard); resolve(p); } },
                (err) => { if (!settled) { settled = true; clearTimeout(guard); reject(err); } },
                { enableHighAccuracy: true, timeout: 60000, maximumAge: 10000 } // Allow 10s old browser cache for speed
            );
        });

        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        return await _renderLocationResultInternal(lat, lng, accuracy, updateAttendance);

    } catch (err) {
        if (btn) btn.style.display = 'block'; // Always show retry button on error

        // Differentiate errors
        if (err && err.code === 1) {            // PERMISSION_DENIED
            showRetry('Location permission denied', 'error');
            showGeoPermissionHelp(distEl);
        } else if (err && err.code === 2) {     // POSITION_UNAVAILABLE
            showRetry('Location unavailable', 'warning');
            distEl.textContent = 'Try moving or check GPS/network';
        } else if (err && err.code === 3) {     // TIMEOUT
            showRetry('Location timed out', 'warning');
            distEl.textContent = 'Retry; go near a window';
        } else {
            showRetry('Location error', 'warning');
            distEl.textContent = 'Retry or check permissions';
        }
        return { inRange: false };
    }
}

/**
 * Internal helper to process a Lat/Lng and update the Dashboard UI.
 * Extracted from checkAndUpdateLocationStatus to support fast-path reuse.
 */
async function _renderLocationResultInternal(lat, lng, accuracy, updateAttendance = true) {
    const statusEl = document.getElementById('locationStatus');
    const distEl = document.getElementById('locationDistance');
    const btn = document.getElementById('enableLocationBtn');
    if (!statusEl || !distEl) return { inRange: false };

    const accuracyM = accuracy || 9999;

    // 1) Load offices (so we can compute distance)
    let offices = [];
    try {
        const res = await apiCall('offices', 'GET', { active: 1, department: currentUser.department });
        offices = (res && res.success && Array.isArray(res.offices)) ? res.offices : [];
    } catch { }

    if (offices.length === 0) {
        statusEl.textContent = 'No offices';
        statusEl.className = 'stat-card-value warning';
        distEl.textContent = '';
        if (btn) btn.style.display = 'block';
        if (updateAttendance) { isUserGeoInRange = false; updateCheckOutButtonState(); }
        return { inRange: false };
    }

    // Save with timestamp for reuse in startAttendanceFlow & loadOfficeSelection
    currentPhotoLocation = { lat, lng, accuracy: accuracyM, timestamp: Date.now() };

    // Guard: if accuracy is worse than 200m
    if (accuracyM > 200) {
        statusEl.textContent = 'Location inaccurate';
        statusEl.className = 'stat-card-value warning';
        distEl.textContent = `Accuracy: ±${Math.round(accuracyM)}m — enable GPS/Wi-Fi for precise detection`;
        if (btn) btn.style.display = 'block';
        if (updateAttendance) { isUserGeoInRange = false; updateCheckOutButtonState(); }
        return { inRange: false };
    }

    // 4) Compute nearest office
    let nearest = { d: Infinity, office: null };
    for (const o of offices) {
        const d = calculateDistance(lat, lng, parseFloat(o.latitude), parseFloat(o.longitude));
        if (d < nearest.d) nearest = { d, office: o };
    }

    if (!nearest.office) {
        statusEl.textContent = 'No offices';
        statusEl.className = 'stat-card-value warning';
        distEl.textContent = '';
        if (btn) btn.style.display = 'block';
        if (updateAttendance) { isUserGeoInRange = false; updateCheckOutButtonState(); }
        return { inRange: false };
    }

    const inRange = nearest.d <= (nearest.office.radius_meters || 0);
    statusEl.textContent = inRange ? 'In Office Range' : 'Out of Range';
    statusEl.className = 'stat-card-value ' + (inRange ? 'success' : 'warning');
    distEl.textContent = `${nearest.office.name} • ${Math.round(nearest.d)} m`;

    // Success: hide the manual button
    if (btn) btn.style.display = 'none';

    // If we successfully get location, ensure the Check In card is enabled
    // This overrides any false-positive from navigator.permissions API
    const checkInCard = document.getElementById('checkInCard');
    if (checkInCard && typeof _enableCheckInCard === 'function') {
        _enableCheckInCard(checkInCard);
    }

    if (updateAttendance) { isUserGeoInRange = inRange; updateCheckOutButtonState(); }
    return { inRange: inRange };
}

/**
 * Manually trigger a high-accuracy location check from the dashboard button
 */
async function manualLocationCheck() {
    const btn = document.getElementById('enableLocationBtn');
    if (btn) btn.style.display = 'none';

    const statusEl = document.getElementById('locationStatus');
    const distEl = document.getElementById('locationDistance');
    if (statusEl) statusEl.textContent = 'Locating...';
    if (distEl) distEl.textContent = 'Requesting GPS fix (up to 45s)...';

    showNotification('Requesting high-precision location. Please stay still.', 'info');

    try {
        // Force a fresh fetch by calling with updateAttendance=true
        await checkAndUpdateLocationStatus(true);
    } catch (e) {
        console.error('Manual location check failed', e);
        if (btn) btn.style.display = 'block';
    }
}

/* ===== renderOfficeCards ===== */
async function renderOfficeCards(userLat, userLng) {
    const container = document.getElementById('officeSelection');
    container.innerHTML = '';

    for (const office of accessibleOffices) {
        const distance = (typeof userLat === 'number' && typeof userLng === 'number')
            ? calculateDistance(userLat, userLng, parseFloat(office.latitude), parseFloat(office.longitude))
            : null;

        const inRange = distance !== null ? (distance <= office.radius_meters) : false;
        // Visual class still indicates disabled, but card remains clickable.
        const cardClass = 'office-card' + (inRange ? '' : ''); // remove 'disabled' so it's clickable

        const officeCard = document.createElement('div');
        officeCard.className = cardClass;
        officeCard.innerHTML = `
            <span class="action-card-icon">🏢</span>
            <h3>${office.name}</h3>
            <p>${office.address || ''}</p>
            <div class="location-status ${inRange ? 'in-range' : 'out-of-range'}">
                ${inRange ? 'In Range' : 'Out of Range'}${distance !== null ? ` (${Math.round(distance)}m)` : ''}
            </div>
        `;

        officeCard.onclick = (e) => {
            selectedOfficeInRange = inRange;
            selectOffice(e, office.id);
        };

        container.appendChild(officeCard);
    }

    // Also ensure the WFH option is updated (keeps eligibility logic separate)
    await updateWFHOption();
}

/* ===== renderOfficeCardsWithoutLocation ===== */
function renderOfficeCardsWithoutLocation() {
    const container = document.getElementById('officeSelection');
    container.innerHTML = '';

    accessibleOffices.forEach(office => {
        const officeCard = document.createElement('div');
        officeCard.className = 'office-card';
        officeCard.innerHTML = `
            <span class="action-card-icon">🏢</span>
            <h3>${office.name}</h3>
            <p>${office.address || ''}</p>
            <div class="location-status checking">Location check unavailable</div>
        `;

        // Still allow selecting an office even when location is unavailable.
        officeCard.onclick = (e) => selectOffice(e, office.id);
        container.appendChild(officeCard);
    });

    // Update WFH option as well
    updateWFHOption().catch(err => console.error(err));
}

/* ===== selectOffice =====
   Accept event explicitly (to safely use event.target), and always show type selection.
*/
async function selectOffice(e, officeId) {
    // store chosen office (can be out-of-range); for WFH user may later choose WFH which will set selectedOffice to null
    selectedOffice = officeId;

    // Update UI selection highlight
    document.querySelectorAll('#officeSelection .office-card').forEach(card => {
        card.classList.remove('selected');
    });

    // Find the clicked card element robustly
    let cardEl = e.target;
    // climb up to the office-card container
    while (cardEl && !cardEl.classList.contains('office-card')) {
        cardEl = cardEl.parentElement;
    }
    if (cardEl) cardEl.classList.add('selected');

    // Show type selection regardless of range — user can pick WFH (which sets selectedOffice = null)
    document.getElementById('typeSelectionSection').classList.remove('hidden');

    // Refresh WFH eligibility text/button (limit-based)
    await updateWFHOption();
}

/* ===== selectType =====
   Accept event explicitly; allow WFH without an office (selectedOffice will be null for WFH).
*/
function selectType(type, e) {
    // If WFH is selected and the WFH option shows disabled (limit reached), prevent selection
    if (type === 'wfh') {
        const wfhOption = document.getElementById('wfhOption');
        if (wfhOption.classList.contains('disabled')) {
            return;
        }
        // For WFH clear selectedOffice (office_id will be null in attendance payload)
        selectedOffice = null;
    }

    selectedType = type;

    // Update UI selection highlight for types
    document.querySelectorAll('#typeSelection .office-card').forEach(card => {
        card.classList.remove('selected');
    });

    // get the clicked card element and mark it selected
    let cardEl = e ? e.target : null;
    if (cardEl) {
        while (cardEl && !cardEl.classList.contains('office-card')) {
            cardEl = cardEl.parentElement;
        }
        if (cardEl) cardEl.classList.add('selected');
    }

    // Show camera section
    if (selectedOfficeInRange) {
        const cam = document.getElementById('cameraSection');
        cam.classList.remove('hidden');
        cam.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
        showNotification('You are not within office range.', 'warning');
    }
}


// Attendance Flow Functions
// ===== Attendance & Camera: CLEAN CONSOLIDATED BLOCK =====

// Globals expected: currentUser, selectedOffice, selectedType, capturedPhotoData, stream, accessibleOffices

/* Entry point when user clicks "Check In" */
async function startAttendanceFlow() {
    if (currentUser && currentUser.role === 'admin') {
        showNotification('Admin accounts do not require check-in/check-out.', 'info');
        return;
    }
    // --- MANDATORY LOCATION GATE ---
    // Use cached dashboard location if it's fresh (< 2 mins) and accurate (<= 200m)
    const isLocationFresh = currentPhotoLocation &&
        currentPhotoLocation.accuracy <= 200 &&
        (Date.now() - (currentPhotoLocation.timestamp || 0) < 120000);

    if (!isLocationFresh) {
        currentPhotoLocation = null; // Only clear if not fresh/accurate
        showNotification('Requesting location access...', 'info');
        try {
            const pos = await new Promise((res, rej) =>
                navigator.geolocation.getCurrentPosition(res, rej, {
                    enableHighAccuracy: true,
                    timeout: 45000,
                    maximumAge: 0
                })
            );
            currentPhotoLocation = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
                timestamp: Date.now()
            };
        } catch (e) {
            showNotification('Location access is required to mark attendance. Please enable GPS/Location and try again.', 'error');
            return; // Block the flow entirely
        }
    }
    // --------------------------------

    showScreen('attendanceScreen');
    if (typeof resetAttendanceFlow === 'function') resetAttendanceFlow();

    accessibleOffices = [];

    // show three choices first
    document.getElementById('typeSelectionSection').classList.remove('hidden');

    // ONLY Surveyors (including temporary tags) can see Client Location card
    const clientOption = document.getElementById('clientOption');
    if (clientOption) {
        if (currentUser && currentUser.department === 'Surveyors') {
            clientOption.classList.remove('hidden');
        } else {
            clientOption.classList.add('hidden');
        }
    }

    const officeBlock = document.getElementById('officeBlock');
    if (officeBlock) officeBlock.style.display = 'none';
    document.getElementById('cameraSection').classList.add('hidden');

    await refreshWFHAvailability();

    // 9 AM - 6 PM Restriction (Except Surveyors and Admins) - Aligned to Synchronized IST
    if (currentUser && currentUser.department !== 'Surveyors' && currentUser.role !== 'admin') {
        const istDate = getCurrentISTDate();

        const hour = istDate.getHours();
        const minute = istDate.getMinutes();
        const currentTimeInMinutes = hour * 60 + minute;

        const startWindow = 9 * 60; // 9:00 AM
        const endWindow = 18 * 60;  // 6:00 PM

        if (currentTimeInMinutes < startWindow || currentTimeInMinutes >= endWindow) {
            showNotification('Non-surveyors can only check in between 9:00 AM and 6:00 PM of the current day.', 'warning');
            showScreen('dashboardScreen');
            return;
        }
    }
}

// Check location permission and disable checkInCard if denied
async function checkLocationPermission() {
    const card = document.getElementById('checkInCard');
    if (!card) return;

    if (!navigator.geolocation) {
        // Geolocation not supported
        card.style.opacity = '0.5';
        card.style.cursor = 'not-allowed';
        card.title = 'Location not supported on this device';
        card.onclick = (e) => {
            e.preventDefault();
            showNotification('Location is not supported on this device.', 'error');
        };
        return;
    }

    // Use Permissions API if available for a non-blocking check
    if (navigator.permissions) {
        try {
            const result = await navigator.permissions.query({ name: 'geolocation' });
            if (result.state === 'denied') {
                _disableCheckInCard(card);
            }
            // Listen for changes (user grants/revokes mid-session)
            result.onchange = () => {
                if (result.state === 'denied') {
                    _disableCheckInCard(card);
                } else {
                    _enableCheckInCard(card);
                    _startDashboardLocationWatch(); // resume watch when re-granted
                }
            };
            // Pre-fetch location in background so check-in camera has it instantly
            if (result.state !== 'denied') {
                _startDashboardLocationWatch();
            }
        } catch (e) {
            // Permissions API not available — try starting watch anyway
            _startDashboardLocationWatch();
        }
    } else {
        // No Permissions API — start background watch directly
        _startDashboardLocationWatch();
    }
}

/**
 * Starts a persistent background watchPosition from the dashboard.
 * This silently keeps currentPhotoLocation up-to-date so the camera
 * check-in screen already has a GPS fix and never shows "Waiting for GPS..."
 */
function _startDashboardLocationWatch() {
    if (!navigator.geolocation) return;
    // Only start one background watch at a time
    if (window.dashboardGeoWatchId) return;

    window.dashboardGeoWatchId = navigator.geolocation.watchPosition(
        (pos) => {
            currentPhotoLocation = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
                timestamp: pos.timestamp
            };
            const checkInCard = document.getElementById('checkInCard');
            if (checkInCard && typeof _enableCheckInCard === 'function') {
                _enableCheckInCard(checkInCard);
            }
        },
        (err) => {
            // Suppress repeating warning if we already have a previous cached location
            if (err.code === 3 && currentPhotoLocation) return;
            console.warn('[Dashboard GPS] Background watch error:', err.message);
        },
        { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
    );
    console.log('[Dashboard GPS] Background location watch started.');
}

function _disableCheckInCard(card) {
    card.style.opacity = '0.5';
    card.style.cursor = 'not-allowed';
    card.title = 'Enable location access to mark attendance';
    card.setAttribute('data-location-blocked', 'true');
    // Replace onclick with a warning
    card.onclick = (e) => {
        e.preventDefault();
        showNotification('Location access is required. Please enable GPS/Location in your browser settings.', 'error');
    };
}

function _enableCheckInCard(card) {
    card.style.opacity = '';
    card.style.cursor = '';
    card.title = '';
    card.removeAttribute('data-location-blocked');
    card.onclick = () => startAttendanceFlow();
}

/* ---------------- WFH availability: no more "stuck checking" ---------------- */

async function refreshWFHAvailability() {
    const wfhOption = document.getElementById('wfhOption');
    const wfhStatus = document.getElementById('wfhStatus');
    const requestBtn = document.getElementById('wfhRequestBtn');

    // Always start from a determinate UI state
    wfhStatus.textContent = 'Checking availability...';
    wfhStatus.style.color = 'var(--gray-600)';
    wfhOption.classList.remove('disabled');
    if (requestBtn) requestBtn.style.display = 'none';

    // ---------- 1) Get offices (for geofence check) ----------
    let offices = [];
    try {
        const res = await apiCall('offices', 'GET', { active: 1, department: currentUser.department });
        offices = (res && res.success && Array.isArray(res.offices)) ? res.offices : [];
    } catch (e) {
        // ignore; we'll proceed with unknown geofence
    }

    // ---------- 2) Check geofence with a timeout (never hang) ----------
    let inAnyOffice = false;    // default
    let geoChecked = false;

    if (navigator.geolocation && offices.length > 0) {
        try {
            const pos = await new Promise((resolve, reject) => {
                let settled = false;
                const guard = setTimeout(() => { if (!settled) { settled = true; reject(new Error('timeout')); } }, 5000);
                navigator.geolocation.getCurrentPosition(
                    (p) => { if (!settled) { settled = true; clearTimeout(guard); resolve(p); } },
                    (e) => { if (!settled) { settled = true; clearTimeout(guard); reject(e); } },
                    { enableHighAccuracy: true, timeout: 4500, maximumAge: 0 }
                );
            });
            const { latitude, longitude } = pos.coords;
            for (const o of offices) {
                const d = calculateDistance(latitude, longitude, parseFloat(o.latitude), parseFloat(o.longitude));
                if (d <= (o.radius_meters || 0)) { inAnyOffice = true; break; }
            }
            geoChecked = true;
        } catch {
            geoChecked = false; // user denied or timeout → treat as unknown but do not block
        }
    }

    // Apply geofence result now (so UI updates even if server call fails)
    if (geoChecked && inAnyOffice) {
        // inside office → WFH disabled regardless of monthly limit
        wfhOption.classList.add('disabled');
        wfhStatus.textContent = 'WFH not allowed while at office';
        wfhStatus.style.color = 'var(--error-color)';
        if (requestBtn) requestBtn.style.display = 'none';
        return; // we can stop here (limit doesn't matter when inside office)
    } else if (!geoChecked) {
        // location unknown → allow WFH but label appropriately
        wfhOption.classList.remove('disabled');
        wfhStatus.textContent = 'Availability unknown (no location)';
        wfhStatus.style.color = 'var(--warning-color)';
    } else {
        // outside any office → tentatively available, refine with server limit next
        wfhOption.classList.remove('disabled');
        wfhStatus.textContent = 'Checking monthly limit...';
        wfhStatus.style.color = 'var(--gray-600)';
    }

    // ---------- 3) Remove Pre-Approval Requirement ----------
    try {
        const today = getCurrentDateTime().date;
        const r = await apiCall('wfh-eligibility', 'GET', { employee_id: currentUser.id, date: today });

        // New logic: Pre-approval is NO LONGER required! WFH is validated post-checkout.
        wfhStatus.textContent = 'Post-Approval Required';
        wfhStatus.style.color = 'var(--success-color)';
        wfhOption.classList.remove('disabled');
        if (requestBtn) requestBtn.style.display = 'none';

    } catch (e) {
        console.error("WFH check failed", e);
        // Fallback: still enable but label unknown
        wfhStatus.textContent = 'Status unknown - Proceed';
        wfhOption.classList.remove('disabled');
    }
}

/* Tapping the WFH card rechecks availability (and can reveal the Request button immediately) */
function onWFHCardClick(e) {
    e && e.stopPropagation && e.stopPropagation();
    // If it looks disabled already (inside geofence), show a message and do nothing.
    const wfhOption = document.getElementById('wfhOption');
    if (wfhOption.classList.contains('disabled')) {
        showNotification('WFH not available right now.', 'warning');
        return;
    }
    // Refresh once more (fast) so the Request button can appear if quota just reached.
    refreshWFHAvailability().then(() => {
        // If still enabled after refresh, proceed to select type and open camera.
        const disabled = document.getElementById('wfhOption').classList.contains('disabled');
        if (!disabled) selectType('wfh', e);
    });
}

/* Request WFH fallback (API first, mailto fallback) */
async function requestWFHExtension(ev) {
    ev && ev.stopPropagation && ev.stopPropagation();
    const note = prompt('Add a short note for Admin/HR (optional):', '');
    if (note === null) return;

    showLoading("Sending WFH request...");
    try {
        const res = await apiCall('wfh-request', 'POST', {
            employee_id: currentUser.id,
            date: getCurrentDateTime().date,
            reason: note
        });
        if (res && res.success) {
            showNotification('WFH request sent to Admin/HR', 'success');
            hideLoading();
            return;
        }
    } catch { }
    hideLoading();

    // No API? Fall back to email:
    const mailto = `mailto:HR@hanu.ai.com?subject= WFH Request &body=${encodeURIComponent(
        `Employee: ${currentUser.name} (#${currentUser.id})%0D%0ADate: ${getCurrentDateTime().date}%0D%0AReason: ${note}`
    )}`;
    window.location.href = mailto;
    showNotification('Opening your mail app to send the request.');
}


/* When user taps WFH / Office / Client */
async function selectType(type, e) {
    // block if WFH disabled (inside geofence)
    if (type === 'wfh' && document.getElementById('wfhOption').classList.contains('disabled')) {
        showNotification('You are within an office geofence. WFH is not allowed.', 'warning');
        return;
    }
    selectedType = type;

    // highlight the chosen card
    document.querySelectorAll('#typeSelection .office-card').forEach(c => c.classList.remove('selected'));
    if (e && e.target) {
        let el = e.target;
        while (el && !el.classList.contains('office-card')) el = el.parentElement;
        if (el) el.classList.add('selected');
    }

    if (type === 'office') {
        // Show notification about location requirement
        showNotification('Checking location for office attendance...', 'info');

        document.getElementById('officeBlock').style.display = 'grid';

        // Auto-request location permission if needed
        if (navigator.permissions && navigator.permissions.query) {
            try {
                const status = await navigator.permissions.query({ name: 'geolocation' });
                if (status.state === 'prompt') {
                    showNotification('Please allow location access to mark office attendance', 'warning');
                } else if (status.state === 'denied') {
                    showNotification('Location access is blocked. Please enable it in your browser settings.', 'error');
                }
            } catch (e) {
                console.log('Permission query not supported', e);
            }
        }

        await loadOfficeSelection();
        document.getElementById('cameraSection').classList.add('hidden');
    } else {
        // WFH / Client -> no office list
        selectedOffice = null;
        document.getElementById('officeBlock').style.display = 'none';
        document.getElementById('cameraSection').classList.remove('hidden');
    }
}

/* Build office cards (called only after user picks Office Work) */
async function loadOfficeSelection() {
    const container = document.getElementById('officeSelection');
    container.innerHTML = '<div class="text-center" style="padding:16px;">Loading offices…</div>';

    // Always refetch – do not rely on cached accessibleOffices
    const res = await apiCall('offices', 'GET', {
        active: 1,
        department: currentUser.department
    });
    accessibleOffices = (res && res.success) ? (res.offices || []) : [];

    if (accessibleOffices.length === 0) {
        container.innerHTML = '<p style="color:var(--gray-600)">No offices found.</p>';
        return;
    }

    // Check geolocation support
    if (!navigator.geolocation) {
        showNotification('Geolocation is not supported by your browser', 'error');
        renderOfficeCardsWithoutLocation();
        return;
    }

    // Check permission state
    if (navigator.permissions && navigator.permissions.query) {
        try {
            const st = await navigator.permissions.query({ name: 'geolocation' });

            if (st.state === 'denied') {
                showNotification('Location permission denied. Please enable it in browser settings.', 'error');
                renderOfficeCardsWithoutLocation();
                return;
            }

            if (st.state === 'prompt') {
                // Show a prominent button to request permission
                container.innerHTML = `
                    <div style="background: #fef3c7; border: 2px solid #f59e0b; border-radius: 12px; padding: 20px; margin-bottom: 16px; text-align: center;">
                        <div style="font-size: 2rem; margin-bottom: 8px;">📍</div>
                        <h4 style="margin: 0 0 8px; color: #92400e;">Location Access Needed</h4>
                        <p style="margin: 0 0 16px; color: #78350f; font-size: 0.9rem;">To mark office attendance, we need to verify you're at the office location.</p>
                        <button class="btn btn-primary" id="officeGeoBtn" style="padding: 12px 24px; font-size: 1rem;">
                            📍 Enable Location Access
                        </button>
                    </div>
                    <div id="officeCardsPlaceholder"></div>
                `;

                const btn = document.getElementById('officeGeoBtn');
                if (btn) {
                    btn.onclick = async () => {
                        btn.textContent = 'Requesting permission...';
                        btn.disabled = true;
                        await requestLocationOnce();
                        // Reload to get actual location
                        loadOfficeSelection();
                    };
                }

                // Still show office cards but without distance info
                renderOfficeCardsWithoutLocation(document.getElementById('officeCardsPlaceholder'));
                return;
            }
        } catch (e) {
            console.log('Permission API not available', e);
        }
    }

    // REUSE: Check if a fresh high-accuracy dashboard location exists
    const now = Date.now();
    if (currentPhotoLocation && currentPhotoLocation.accuracy <= 200 && (now - currentPhotoLocation.timestamp) < 120000) {
        console.log('REUSE: Using cached dashboard location for office selection.');
        renderOfficeCards(currentPhotoLocation.lat, currentPhotoLocation.lng);
        return;
    }

    // Try to get current position
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            // Update cache for other parts of the flow
            currentPhotoLocation = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy || 999,
                timestamp: Date.now()
            };
            showNotification('Location detected successfully', 'success');
            renderOfficeCards(pos.coords.latitude, pos.coords.longitude);
        },
        (error) => {
            console.error('Geolocation error:', error);
            let errorMsg = 'Unable to get your location. ';
            if (error.code === 1) {
                errorMsg = 'Location permission denied. Please enable it in your browser settings.';
            } else if (error.code === 2) {
                errorMsg = 'Location unavailable. Please check your device settings.';
            } else if (error.code === 3) {
                errorMsg = 'Location request timed out. Please try again.';
            }
            showNotification(errorMsg, 'error');
            renderOfficeCardsWithoutLocation();
        },
        {
            enableHighAccuracy: true,
            timeout: 10000, // Slightly increased to 10s as a fallback
            maximumAge: 0
        }
    );
}

function renderOfficeCards(userLat, userLng) {
    const container = document.getElementById('officeSelection');
    container.innerHTML = '';

    for (const o of accessibleOffices) {
        const d = calculateDistance(userLat, userLng, parseFloat(o.latitude), parseFloat(o.longitude));
        const inRange = d <= (o.radius_meters || 0);

        const card = document.createElement('div');
        card.className = 'office-card' + (inRange ? '' : ' disabled');
        card.innerHTML = `
            <span class="action-card-icon">🏢</span>
            <h3>${o.name}</h3>
            <p>${o.address || ''}</p>
            <div class="location-status ${inRange ? 'in-range' : 'out-of-range'}">
                ${inRange ? 'In Range' : 'Out of Range'} (${Math.round(d)}m)
            </div>
        `;
        card.onclick = inRange
            ? (ev) => selectOffice(ev, o.id)
            : () => showNotification('You are not within this office geofence', 'warning');

        container.appendChild(card);
    }
}

function renderOfficeCardsWithoutLocation(containerElement) {
    const container = containerElement || document.getElementById('officeSelection');
    container.innerHTML = '';

    // Add helpful info banner if showing in main container
    if (!containerElement) {
        const helpBanner = document.createElement('div');
        helpBanner.style.cssText = 'background: #fee2e2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px; margin-bottom: 12px; font-size: 0.9rem; color: #991b1b;';
        helpBanner.innerHTML = `
            <strong>⚠️ Location check unavailable</strong><br>
            <span style="font-size: 0.85rem;">You can still select an office, but distance verification is disabled. Please enable location access for full functionality.</span>
        `;
        container.appendChild(helpBanner);
    }

    for (const o of accessibleOffices) {
        const card = document.createElement('div');
        card.className = 'office-card';
        card.innerHTML = `
            <span class="action-card-icon">🏢</span>
            <h3>${o.name}</h3>
            <p>${o.address || ''}</p>
            <div class="location-status checking">Distance check disabled</div>
        `;
        card.onclick = (ev) => selectOffice(ev, o.id);
        container.appendChild(card);
    }
}

function selectOffice(e, officeId) {
    selectedOffice = officeId;
    document.querySelectorAll('#officeSelection .office-card').forEach(c => c.classList.remove('selected'));
    let el = e.target;
    while (el && !el.classList.contains('office-card')) el = el.parentElement;
    if (el) el.classList.add('selected');

    // after choosing an office, show camera
    document.getElementById('cameraSection').classList.remove('hidden');
}

/* Camera (robust) */
async function startCamera() {
    const video = document.getElementById('video');
    const placeholder = document.getElementById('cameraPlaceholder');
    const startBtn = document.getElementById('startCameraBtn');
    const captureBtn = document.getElementById('captureBtn');
    const retakeBtn = document.getElementById('retakeBtn');
    const img = document.getElementById('capturedPhoto');

    if (!video) return;

    // Check camera permission before attempting to access
    if (navigator.permissions && navigator.permissions.query) {
        try {
            const permissionStatus = await navigator.permissions.query({ name: 'camera' });

            if (permissionStatus.state === 'denied') {
                showCameraPermissionModal();
                return;
            }
        } catch (e) {
            console.log('Permission API not available', e);
        }
    }

    // Location for photo overlay: reuse the dashboard background watch.
    // The dashboard already started watchPosition via _startDashboardLocationWatch(),
    // so currentPhotoLocation is likely already populated — no new watch needed.
    // If the dashboard watch isn't running (e.g. permission was granted late),
    // start it now so the camera poll loop below will get data quickly.
    if (navigator.geolocation) {
        if (!window.dashboardGeoWatchId) {
            // Dashboard watch not yet running — kick it off now
            _startDashboardLocationWatch();
        }
        // Also keep a per-camera watch as a safety net in case accuracy improves
        if (window.geoWatchId) navigator.geolocation.clearWatch(window.geoWatchId);
        window.geoWatchId = navigator.geolocation.watchPosition(
            (pos) => {
                // Only update if this reading is fresher/more accurate
                if (!currentPhotoLocation || pos.coords.accuracy <= currentPhotoLocation.accuracy) {
                    currentPhotoLocation = {
                        lat: pos.coords.latitude,
                        lng: pos.coords.longitude,
                        accuracy: pos.coords.accuracy,
                        timestamp: pos.timestamp
                    };
                }
            },
            (err) => {
                // Only warn if it's not a temporary timeout or if we lack location entirely
                if (err.code === 3 && currentPhotoLocation) return;
                console.warn('Camera location watch error:', err.message);
            },
            { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
        );
    }

    try {
        // open stream only once
        if (!stream) {
            stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }

        video.srcObject = stream;
        await video.play();

        // show live video, hide placeholder & previous photo
        video.style.display = 'block';

        // Show accuracy overlay — show instantly if we already have a GPS fix from the dashboard
        const accElement = document.getElementById('cameraAccuracy') || document.createElement('div');
        accElement.id = 'cameraAccuracy';
        accElement.style = 'position:absolute; top:10px; left:10px; background:rgba(0,0,0,0.5); color:white; padding:5px; border-radius:4px; font-size:12px; z-index:10;';

        if (currentPhotoLocation) {
            // Location already cached from dashboard — display immediately
            const acc = Math.round(currentPhotoLocation.accuracy);
            accElement.innerText = `GPS Accuracy: ±${acc}m`;
            accElement.style.backgroundColor = acc > 200 ? 'rgba(255,0,0,0.6)' : 'rgba(0,128,0,0.6)';
        } else {
            accElement.innerText = 'Locating...';
        }

        const camContainer = document.querySelector('.camera-box') || video.parentElement;
        if (camContainer && !document.getElementById('cameraAccuracy')) {
            camContainer.style.position = 'relative'; // Ensure positioning context
            camContainer.appendChild(accElement);
        }

        // Poll for accuracy updates to show user
        if (window.accInterval) clearInterval(window.accInterval);
        window.accInterval = setInterval(() => {
            const el = document.getElementById('cameraAccuracy');
            const captureBtn = document.getElementById('captureBtn');
            if (el && currentPhotoLocation) {
                const acc = Math.round(currentPhotoLocation.accuracy);
                const isAccurate = acc <= 200;

                if (isAccurate) {
                    el.innerText = `GPS Accuracy: ±${acc}m (Good)`;
                    el.style.backgroundColor = 'rgba(0,128,0,0.7)';
                    if (captureBtn) {
                        captureBtn.disabled = false;
                        captureBtn.title = "";
                    }
                } else {
                    el.innerText = `GPS Accuracy: ±${acc}m — Wait for GPS...`;
                    el.style.backgroundColor = 'rgba(255,0,0,0.7)';
                    if (captureBtn) {
                        captureBtn.disabled = true;
                        captureBtn.title = "Waiting for high-accuracy GPS signal (±200m)";
                    }
                }
            } else if (el) {
                el.innerText = 'Acquiring GPS Signal... Wait for GPS...';
                el.style.backgroundColor = 'rgba(255,165,0,0.7)';
                if (captureBtn) {
                    captureBtn.disabled = true;
                }
            }
        }, 1000);
        placeholder.style.display = 'none';
        img.style.display = 'none';

        // buttons state
        startBtn.style.display = 'none';
        captureBtn.style.display = 'inline-block';
        retakeBtn.style.display = 'none';

        // Start real-time tracking
        startFaceTracking();

    } catch (e) {
        console.error('startCamera error', e);

        // Show custom modal instead of alert
        if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
            showCameraPermissionModal();
        } else if (e.name === 'NotFoundError') {
            showNotification('No camera found on this device', 'error');
        } else if (e.name === 'NotReadableError') {
            showNotification('Camera is already in use by another application', 'error');
        } else {
            showNotification('Unable to access camera. Please check your settings.', 'error');
        }
    }
}

// Helper: Lon/Lat to Tile numbers
function lon2tile(lon, zoom) { return (Math.floor((lon + 180) / 360 * Math.pow(2, zoom))); }
function lat2tile(lat, zoom) { return (Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom))); }

async function capturePhoto() {
    // 0. Immediate Cleanup to prevent async race conditions
    stopFaceTracking();
    if (window.accInterval) {
        clearInterval(window.accInterval);
        window.accInterval = null;
    }

    const video = document.getElementById('video');
    const canvas = document.getElementById('photoCanvas');
    const img = document.getElementById('capturedPhoto');
    const placeholder = document.getElementById('cameraPlaceholder');

    const captureBtn = document.getElementById('captureBtn');
    const retakeBtn = document.getElementById('retakeBtn');
    const markBtn = document.getElementById('markBtn');

    // Safety checks
    if (!video || !canvas || !img) {
        console.warn('capturePhoto: required elements not found');
        return;
    }

    // Prepare canvas
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    canvas.width = width;
    canvas.height = height;

    // Draw the frame from video onto canvas (No longer mirroring the capture so text stays readable and it looks like a standard photo)
    const ctx = canvas.getContext('2d');
    ctx.save();
    // (Removed mirroring logic here to provide a 'standard' rather than 'mirrored' photo)
    ctx.drawImage(video, 0, 0, width, height);
    ctx.restore();

    // --- OVERLAY LOGIC (GPS Map Camera Style) ---
    // 1. Prepare Data
    const now = getCurrentISTDate();

    // Hardcoded IST display to prevent device time leaks
    const dayName = now.toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' });
    const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Kolkata' }).replace(/\//g, '/');
    const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

    const fullDateStr = `${dayName}, ${dateStr} ${timeStr} GMT +05:30`;

    let lat = 0, lng = 0;
    let shortAddress = "Location Not Found";
    let fullAddress = "Address unavailable";
    let accuracy = 0;

    if (currentPhotoLocation) {
        lat = currentPhotoLocation.lat;
        lng = currentPhotoLocation.lng;
        accuracy = currentPhotoLocation.accuracy;

        try {
            // Primary: Using Google Maps Geocoder (loaded in dashboard)
            if (typeof google !== 'undefined' && google.maps && google.maps.Geocoder) {
                const geocoder = new google.maps.Geocoder();
                const response = await new Promise((resolve) => {
                    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
                        resolve({ results, status });
                    });
                });

                if (response.status === "OK" && response.results[0]) {
                    const result = response.results[0];
                    fullAddress = result.formatted_address;

                    // Extract shortAddress (City, State, Country) from Google's address components
                    const comps = result.address_components;
                    const city = comps.find(c => c.types.includes("locality"))?.long_name || 
                                 comps.find(c => c.types.includes("administrative_area_level_3"))?.long_name || 
                                 comps.find(c => c.types.includes("administrative_area_level_2"))?.long_name || "";
                    const state = comps.find(c => c.types.includes("administrative_area_level_1"))?.long_name || "";
                    const country = comps.find(c => c.types.includes("country"))?.long_name || "";
                    
                    shortAddress = [city, state, country].filter(Boolean).join(", ");
                } else {
                    throw new Error("Google Geocoder status: " + response.status);
                }
            } else {
                // Background Fallback: OSM Nominatim if Google JS SDK is missing or failing
                const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 2000);
                const req = await fetch(url, { signal: controller.signal });
                clearTimeout(timeoutId);

                if (req.ok) {
                    const data = await req.json();
                    const addr = data.address || {};
                    const city = addr.city || addr.town || addr.village || addr.county || "";
                    const state = addr.state || "";
                    const country = addr.country || "";
                    shortAddress = [city, state, country].filter(Boolean).join(", ");
                    fullAddress = data.display_name || "";
                }
            }
        } catch (e) {
            console.warn("Reverse geocoding failed, using coordinates:", e);
            shortAddress = `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`;
        }
    }

    // 2. Draw Layout
    const overlayHeight = height * 0.28;
    const overlayY = height - overlayHeight;

    // Semi-transparent black background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, overlayY, width, overlayHeight);

    // Padding
    const p = 15;

    // -- Left: Real Map View --
    const mapSize = overlayHeight - (p * 2);
    const mapX = p;
    const mapY = overlayY + p;

     // --- FINAL PRECISE MAP LOGIC ---
    let mapDrawn = false;
    const zoom = 15;
    const cleanLat = lat.toFixed(6);
    const cleanLng = lng.toFixed(6);

    // 1. Attempt Google Static Maps ONLY if not previously blocked
    if (lat !== 0 && lng !== 0 && !window.GOOGLE_STATIC_MAPS_FAILED) {
        try {
            const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${cleanLat},${cleanLng}&zoom=${zoom}&size=256x256&markers=color:red%7C${cleanLat},${cleanLng}&key=${MAPS_API_KEY}`;
            const mapImg = new Image();
            mapImg.crossOrigin = "Anonymous";

            await new Promise((resolve) => {
                mapImg.onload = () => {
                    ctx.drawImage(mapImg, mapX, mapY, mapSize, mapSize);
                    ctx.fillStyle = 'rgba(0,0,0,0.5)';
                    ctx.fillRect(mapX, mapY + mapSize - 12, mapSize, 12);
                    ctx.fillStyle = '#fff';
                    ctx.font = '8px sans-serif';
                    ctx.fillText('Google Maps ©', mapX + 2, mapY + mapSize - 3);
                    mapDrawn = true;
                    resolve();
                };
                mapImg.onerror = () => {
                    // SILENT AUTO-SWITCH: If Google fails once (403/404), mark it as failed and use OSM
                    window.GOOGLE_STATIC_MAPS_FAILED = true;
                    console.warn("Google Maps Service Blocked. Switching to professional OSM fallback.");
                    resolve(); 
                };
                mapImg.src = staticMapUrl;
                setTimeout(resolve, 2000); // 2s timeout safety
            });
        } catch (e) { console.warn("Google Map bypass", e); }
    }

    // 2. High-Quality Professional OSM Fallback (Triggers if Google is blocked)
    if (!mapDrawn && lat !== 0 && lng !== 0) {
        try {
            const tileSize = 256;
            const n = Math.pow(2, zoom);
            const xFrac = (lng + 180) / 360 * n;
            const yFrac = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n;
            const tx = Math.floor(xFrac);
            const ty = Math.floor(yFrac);
            const offsetX = (xFrac - tx) * tileSize;
            const offsetY = (yFrac - ty) * tileSize;

            // This "Positron" style looks identical to a premium Google Map
            const osmUrl = `https://cartodb-basemaps-a.global.ssl.fastly.net/light_all/${zoom}/${tx}/${ty}.png`;
            
            await new Promise((resolve) => {
                const osmImg = new Image();
                osmImg.crossOrigin = "Anonymous";
                osmImg.onload = () => {
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = mapSize; tempCanvas.height = mapSize;
                    const tCtx = tempCanvas.getContext('2d');
                    tCtx.drawImage(osmImg, offsetX - (mapSize / 2), offsetY - (mapSize / 2), mapSize, mapSize, 0, 0, mapSize, mapSize);
                    ctx.drawImage(tempCanvas, mapX, mapY);
                    
                    // Marker Design
                    ctx.fillStyle = '#ef4444';
                    ctx.beginPath(); ctx.arc(mapX + mapSize/2, mapY + mapSize/2, 6, 0, Math.PI * 2); ctx.fill();
                    ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.stroke();

                    // Branding
                    ctx.fillStyle = 'rgba(0,0,0,0.5)';
                    ctx.fillRect(mapX, mapY + mapSize - 12, mapSize, 12);
                    ctx.fillStyle = '#fff'; ctx.font = '8px sans-serif';
                    ctx.fillText('Map Data © OpenStreetMap', mapX + 2, mapY + mapSize - 3);
                    mapDrawn = true;
                    resolve();
                };
                osmImg.onerror = () => resolve();
                osmImg.src = osmUrl;
            });
        } catch (e) { console.error("Total map failure", e); }
    }


    // Fallback: This is the high-quality centered OSM logic you have now
    if (!mapDrawn && lat !== 0 && lng !== 0) {
        try {
            const osmZoom = 15;
            const tileSize = 256;
            const n = Math.pow(2, osmZoom);
            const xFrac = (lng + 180) / 360 * n;
            const yFrac = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n;
            const tx = Math.floor(xFrac);
            const ty = Math.floor(yFrac);
            const offsetX = (xFrac - tx) * tileSize;
            const offsetY = (yFrac - ty) * tileSize;

            // Using professional CartoDB Positron theme for a premium "Google-like" look
            const osmUrl = `https://cartodb-basemaps-a.global.ssl.fastly.net/light_all/${osmZoom}/${tx}/${ty}.png`;
            
            await new Promise((resolve) => {
                const osmImg = new Image();
                osmImg.crossOrigin = "Anonymous";
                osmImg.onload = () => {
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = mapSize;
                    tempCanvas.height = mapSize;
                    const tCtx = tempCanvas.getContext('2d');
                    
                    tCtx.drawImage(osmImg, offsetX - (mapSize / 2), offsetY - (mapSize / 2), mapSize, mapSize, 0, 0, mapSize, mapSize);
                    ctx.drawImage(tempCanvas, mapX, mapY);
                    
                    // Manual Center Marker
                    ctx.fillStyle = '#ef4444'; // Red
                    ctx.beginPath();
                    ctx.arc(mapX + mapSize/2, mapY + mapSize/2, 5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = 'white';
                    ctx.lineWidth = 2;
                    ctx.stroke();

                    ctx.fillStyle = 'rgba(0,0,0,0.4)';
                    ctx.fillRect(mapX, mapY + mapSize - 12, mapSize, 12);
                    ctx.fillStyle = '#fff';
                    ctx.font = '8px sans-serif';
                    ctx.fillText('Map Data: OSM', mapX + 2, mapY + mapSize - 3);
                    
                    mapDrawn = true;
                    resolve();
                };
                osmImg.onerror = () => resolve();
                osmImg.src = osmUrl;
            });
        } catch (e) {
            console.error("OSM Fallback error", e);
        }
    }



    if (!mapDrawn) {
        // Fallback: Grey Box if map fails or no location
        ctx.fillStyle = '#e0e0e0';
        ctx.fillRect(mapX, mapY, mapSize, mapSize);
        ctx.strokeStyle = '#bdbdbd';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(mapX, mapY); ctx.lineTo(mapX + mapSize, mapY + mapSize);
        ctx.moveTo(mapX + mapSize, mapY); ctx.lineTo(mapX, mapY + mapSize);
        ctx.stroke();
        ctx.fillStyle = '#5f6368';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText('Map Unavail.', mapX + 4, mapY + mapSize - 4);
    }

    // Map Border
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(mapX, mapY, mapSize, mapSize);


    // -- Right: Text Block --
    const textX = mapX + mapSize + p;
    const textYStart = mapY + 5;
    const maxWidth = width - textX - p;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#ffffff';

    // Line 1: Short Address
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(shortAddress || "Location Unknown", textX, textYStart, maxWidth);

    // Line 2: Full Address
    ctx.font = '12px sans-serif';
    ctx.fillText(fullAddress.substring(0, 65) + (fullAddress.length > 65 ? '...' : ''), textX, textYStart + 22, maxWidth);

    // Line 3: Lat / Long / Accuracy
    ctx.font = '12px sans-serif';
    ctx.fillText(`Lat ${lat.toFixed(6)}° Long ${lng.toFixed(6)}° (±${Math.round(accuracy)}m)`, textX, textYStart + 42, maxWidth);

    // Line 4: Date/Time
    ctx.font = '12px sans-serif';
    ctx.fillText(fullDateStr, textX, textYStart + 60, maxWidth);

    // GPS Map Camera Label
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '10px sans-serif';
    const brandedText = "GPS Map Camera";
    const brandWidth = ctx.measureText(brandedText).width;
    ctx.fillText(brandedText, width - brandWidth - p, overlayY + p);
    // -----------------------


    // Save the captured image for attendance API
    capturedPhotoData = canvas.toDataURL('image/jpeg');
    img.src = capturedPhotoData;

    // Display the captured image
    img.style.display = 'block';
    video.style.display = 'none';
    placeholder.style.display = 'none';

    // Update buttons safely
    if (captureBtn) captureBtn.style.display = 'none';
    if (retakeBtn) retakeBtn.style.display = 'inline-block';

    // Stop tracking (redundant safety call)
    stopFaceTracking();

    // Face Detection Logic
    if (markBtn) markBtn.style.display = 'none'; // Hide by default until face detected

    if (!faceapiLoaded) {
        showNotification('Face detection is still loading or failed. Please try again in a moment.', 'warning');
        return;
    }

    showNotification('Detecting face...', 'info');

    try {
        const detections = await faceapi.detectAllFaces(canvas, new faceapi.TinyFaceDetectorOptions());

        if (detections.length === 0) {
            showNotification('No face detected. Please position yourself clearly and try again.', 'error');
            // Draw a red "X" or just leave it
        } else if (detections.length > 1) {
            showNotification('Multiple faces detected. Please ensure only you are in the frame.', 'error');
        } else {
            showNotification('Face detected successfully!', 'success');
            if (markBtn) markBtn.style.display = 'inline-block';

            // Draw box on canvas for feedback (without score)
            detections.forEach(detection => {
                new faceapi.draw.DrawBox(detection.box, { label: "" }).draw(canvas);
            });
            // Update the preview image with the version containing the box
            img.src = canvas.toDataURL('image/jpeg');
            // Also update the global data used for API
            capturedPhotoData = img.src;
        }
    } catch (e) {
        console.error('Face detection error:', e);
        showNotification('Error during face detection.', 'error');
    }
}


function retakePhoto() {
    // Clear the saved photo
    capturedPhotoData = null;

    const video = document.getElementById('video');
    const img = document.getElementById('capturedPhoto');
    const placeholder = document.getElementById('cameraPlaceholder');

    // Hide captured image
    if (img) {
        img.src = '';
        img.style.display = 'none';
    }

    // Stop any active stream
    if (stream) {
        try {
            stream.getTracks().forEach(t => t.stop());
        } catch (e) { }
        stream = null;
    }

    // Hide video and show placeholder again
    if (video) {
        video.srcObject = null;
        video.style.display = 'none';
    }
    if (placeholder) {
        placeholder.style.display = 'flex';
    }

    // Reset buttons to initial state
    const startBtn = document.getElementById('startCameraBtn');
    const captureBtn = document.getElementById('captureBtn');
    const retakeBtn = document.getElementById('retakeBtn');
    const markBtn = document.getElementById('markBtn');

    if (startBtn) startBtn.style.display = 'inline-block';
    if (captureBtn) captureBtn.style.display = 'none';
    if (retakeBtn) retakeBtn.style.display = 'none';
    if (markBtn) markBtn.style.display = 'none';

    // Stop tracking and pollers
    stopFaceTracking();
    if (window.accInterval) {
        clearInterval(window.accInterval);
        window.accInterval = null;
    }
}

function startFaceTracking() {
    if (!faceapiLoaded) return;

    const video = document.getElementById('video');
    const overlay = document.getElementById('overlayCanvas');
    if (!video || !overlay) return;

    overlay.style.display = 'block';

    // Match overlay canvas size to video display size
    const updateSize = () => {
        overlay.width = video.offsetWidth;
        overlay.height = video.offsetHeight;
    };
    updateSize();

    if (trackingInterval) clearInterval(trackingInterval);

    trackingInterval = setInterval(async () => {
        if (!stream || video.paused || video.ended) return;

        // Perform detection (this can be slow)
        const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions());
        
        // Critical: Check dimensions AFTER await. If video was hidden/stopped during detection,
        // offsetWidth/Height will be 0, which would cause faceapi.resizeResults to crash.
        const width = video.offsetWidth;
        const height = video.offsetHeight;
        if (!width || !height) return;

        const displaySize = { width, height };

        // Resize detections to match display size
        const resizedDetections = faceapi.resizeResults(detections, displaySize);

        // Clear canvas and draw detections (without score)
        const ctx = overlay.getContext('2d');
        ctx.clearRect(0, 0, overlay.width, overlay.height);
        resizedDetections.forEach(detection => {
            new faceapi.draw.DrawBox(detection.box, { label: "" }).draw(overlay);
        });
    }, 200);
}

function stopFaceTracking() {
    if (trackingInterval) {
        clearInterval(trackingInterval);
        trackingInterval = null;
    }
    const overlay = document.getElementById('overlayCanvas');
    if (overlay) {
        overlay.style.display = 'none';
        const ctx = overlay.getContext('2d');
        ctx.clearRect(0, 0, overlay.width, overlay.height);
    }
}


function stopCamera() {
    if (stream && stream.getTracks) {
        stream.getTracks().forEach(t => t.stop());
    }
    stream = null;
    stopFaceTracking();
    if (window.accInterval) {
        clearInterval(window.accInterval);
        window.accInterval = null;
    }

    const video = document.getElementById('video');
    const img = document.getElementById('capturedPhoto');
    const placeholder = document.getElementById('cameraPlaceholder');
    const startBtn = document.getElementById('startCameraBtn');
    const captureBtn = document.getElementById('captureBtn');
    const retakeBtn = document.getElementById('retakeBtn');

    if (video) {
        video.srcObject = null;
        video.style.display = 'none';
    }
    if (img) img.style.display = 'none';
    if (placeholder) placeholder.style.display = 'flex';

    startBtn.style.display = 'inline-block';
    captureBtn.style.display = 'none';
    retakeBtn.style.display = 'none';
}
/* Final submit */
async function markAttendance() {
    if (!selectedType) return showNotification('Please select WFH / Office / Client', 'error');
    if (selectedType === 'office' && !selectedOffice) return showNotification('Please select an office', 'error');
    if (!capturedPhotoData) return showNotification('Please capture a photo', 'error');

    const markBtn = document.getElementById('markBtn');
    const markBtnText = document.getElementById('markBtnText');
    const markSpinner = document.getElementById('markSpinner');
    markBtn.disabled = true; markBtnText.classList.add('hidden'); markSpinner.classList.remove('hidden');

    try {
        const now = getCurrentDateTime();

        // MANDATORY LOCATION CHECK (WFH / Office / Client)
        // We use the high-accuracy location fetched during camera preview.
        // Redundant fetch removed to ensure reuse of dashboard/preview coordinates.
        if (!currentPhotoLocation) {
            showNotification('Location access is mandatory. Please wait for GPS and try again.', 'error');
            return;
        }

        // Accuracy Check — already enforced by the "Capture" button state, but good to have here too.
        if (currentPhotoLocation.accuracy > 200) {
            showNotification(`Location accuracy is too low (±${Math.round(currentPhotoLocation.accuracy)}m). Please wait for a better GPS signal.`, 'error');
            return;
        }

        const loc = { latitude: currentPhotoLocation.lat, longitude: currentPhotoLocation.lng };

        const payload = {
            employee_id: currentUser.id,
            date: now.date,
            check_in: now.time,
            type: selectedType,
            status: selectedType === 'office' ? 'present' : selectedType,
            office_id: selectedType === 'office' ? selectedOffice : null,
            location: loc,
            photo: capturedPhotoData
        };

        const r = await apiCall('mark-attendance', 'POST', payload);
        if (r && r.success) {
            showNotification('Attendance marked successfully');
            if (typeof loadDashboardData === 'function') await loadDashboardData();
            // refresh records if you're on the Records screen
            if (document.getElementById('recordsScreen').classList.contains('active')) {
                await loadAttendanceRecords();
            }
            showScreen('dashboardScreen');
        }
        else if (r && r.error_code === 'ATTENDANCE_BLOCKED') {
            const container = document.getElementById('cameraSection');
            if (container) {
                container.innerHTML = `
                    <div class="text-center" style="padding: 24px; background: #fff3f3; border: 1px solid #ffcdd2; border-radius: 12px;">
                        <span class="material-icons" style="font-size: 48px; color: #d32f2f; margin-bottom: 16px;">block</span>
                        <h3 style="color: #d32f2f; margin-bottom: 8px;">Attendance Blocked</h3>
                        <p style="color: #5f6368; margin-bottom: 16px;">You have checked in but not checked out for 3 consecutive days.</p>
                        <button class="btn btn-primary w-100" onclick="submitUnblockRequest()">Request Admin to Mark Attendance</button>
                    </div>
                `;
            } else {
                showNotification(r.message || 'Attendance blocked due to missed check-outs.', 'error');
            }
        }
        else if (r && r.error_code === 'ATTENDANCE_BLOCKED_PENDING') {
            const container = document.getElementById('cameraSection');
            if (container) {
                container.innerHTML = `
                    <div class="text-center" style="padding: 24px; background: #fff8e1; border: 1px solid #ffecb3; border-radius: 12px;">
                        <span class="material-icons" style="font-size: 48px; color: #f57f17; margin-bottom: 16px;">pending_actions</span>
                        <h3 style="color: #f57f17; margin-bottom: 8px;">Request Pending</h3>
                        <p style="color: #5f6368; margin-bottom: 0;">Your request to unblock attendance is pending Admin approval. Please wait or contact your administrator.</p>
                    </div>
                `;
            } else {
                showNotification(r.message || 'Your unblock request is pending.', 'error');
            }
        }
        else {
            showNotification((r && r.message) || 'Failed to mark attendance', 'error');
        }
    } finally {
        markBtn.disabled = false; markBtnText.classList.remove('hidden'); markSpinner.classList.add('hidden');
    }
}

async function submitUnblockRequest() {
    const btn = document.querySelector('#cameraSection button');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Submitting...';
    }

    try {
        const payload = { employee_id: currentUser.id };
        const res = await apiCall('unblock-attendance', 'POST', payload);

        if (res && res.success) {
            showNotification(res.message);
            // Re-render the pending UI
            const container = document.getElementById('cameraSection');
            if (container) {
                container.innerHTML = `
                    <div class="text-center" style="padding: 24px; background: #fff8e1; border: 1px solid #ffecb3; border-radius: 12px;">
                        <span class="material-icons" style="font-size: 48px; color: #f57f17; margin-bottom: 16px;">pending_actions</span>
                        <h3 style="color: #f57f17; margin-bottom: 8px;">Request Pending</h3>
                        <p style="color: #5f6368; margin-bottom: 0;">Your request to unblock attendance is pending Admin approval. Please wait or contact your administrator.</p>
                    </div>
                `;
            }
        } else {
            showNotification(res.message || 'Failed to submit request', 'error');
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Request Admin to Mark Attendance';
            }
        }
    } catch (e) {
        showNotification('Error submitting request', 'error');
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Request Admin to Mark Attendance';
        }
    }
}

// // (Optional) Keep this shim if something calls updateLocationStatus()
// async function updateLocationStatus() {
//     if (typeof checkAndUpdateLocationStatus === 'function') {
//         return await checkAndUpdateLocationStatus();
//     }
//     return null;
// }

async function populateOfficeDropdowns() {
    try {
        const res = await apiCall('offices', 'GET', { active: 1 });
        const offices = (res && res.success) ? (res.offices || []) : [];

        // Signup page
        const signupOffice = document.getElementById('signupOffice');
        if (signupOffice) {
            signupOffice.innerHTML = '<option value="">Select Office</option>' +
                offices.map(o => `<option value="${o.id}">${o.name}</option>`).join('');
        }

        // Admin → Add New User
        const newUserPrimaryOffice = document.getElementById('newUserPrimaryOffice');
        if (newUserPrimaryOffice) {
            newUserPrimaryOffice.innerHTML = '<option value="">Select Office</option>' +
                offices.map(o => `<option value="${o.id}">${o.name}</option>`).join('');
        }

        // Profile → Primary Office
        const profilePrimaryOffice = document.getElementById('profilePrimaryOffice');
        if (profilePrimaryOffice) {
            profilePrimaryOffice.innerHTML = '<option value="">Select Office</option>' +
                offices.map(o => `<option value="${o.id}">${o.name}</option>`).join('');
        }
    } catch (e) {
        console.error('Failed to load offices for dropdowns', e);
    }
}


//----------------------------------------------------------------------
// Check-out Functions
async function showCheckOut() {
    try {
        const result = await apiCall('today-attendance', 'GET', {
            employee_id: currentUser.id
        });

        if (!result || !result.success || !result.record) {
            showNotification('No check-in record found for today', 'error');
            return;
        }

        const record = result.record;
        if (!record.check_in_time || !record.date) {
            showNotification('No valid check-in time for today', 'error');
            return;
        }

        const checkInTime = new Date(`${record.date}T${record.check_in_time}`);
        const now = getCurrentISTDate();
        const workHours = (now - checkInTime) / (1000 * 60 * 60);

        // Save context for confirmCheckOut()
        currentCheckOutContext = { record, workHours };

        const totalMins = Math.max(0, Math.round(workHours * 60));
        const hh = Math.floor(totalMins / 60);
        const mm = totalMins % 60;

        // Populate modal
        const detailsDiv = document.getElementById('checkOutDetails');
        detailsDiv.innerHTML = `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; background: #f8fafc; padding: 16px; border-radius: 12px; border: 1px solid #e2e8f0;">
                <div><span style="color: #64748b; font-size: 0.8rem; text-transform: uppercase; font-weight: 700;">Check In</span><br><strong>${record.check_in_time}</strong></div>
                <div><span style="color: #64748b; font-size: 0.8rem; text-transform: uppercase; font-weight: 700;">Current</span><br><strong>${getCurrentDateTime().time}</strong></div>
                <div><span style="color: #64748b; font-size: 0.8rem; text-transform: uppercase; font-weight: 700;">Work Goal</span><br><strong>9h 00m</strong></div>
                <div><span style="color: #64748b; font-size: 0.8rem; text-transform: uppercase; font-weight: 700;">Total Worked</span><br><strong style="color: var(--primary-color);">${hh}h ${mm}m</strong></div>
            </div>
            <div style="margin-bottom: 12px; font-size: 0.9rem;"><strong>Office:</strong> ${record.office_name || 'N/A'}</div>
        `;

        const tooEarlyWarning = document.getElementById('tooEarlyWarning');
        const halfDayWarning = document.getElementById('halfDayWarning');
        const confirmBtn = document.getElementById('confirmCheckOutBtn');

        // Logic check for warnings and checkout ability
        if (tooEarlyWarning && halfDayWarning && confirmBtn) {
            if (workHours < 4.5) {
                tooEarlyWarning.classList.remove('hidden');
                halfDayWarning.classList.add('hidden');
                confirmBtn.disabled = true;
                confirmBtn.style.opacity = '0.5';
                confirmBtn.style.cursor = 'not-allowed';
            } else if (workHours < 9.0) {
                tooEarlyWarning.classList.add('hidden');
                halfDayWarning.classList.remove('hidden');
                confirmBtn.disabled = false;
                confirmBtn.style.opacity = '1';
                confirmBtn.style.cursor = 'pointer';
            } else {
                tooEarlyWarning.classList.add('hidden');
                halfDayWarning.classList.add('hidden');
                confirmBtn.disabled = false;
                confirmBtn.style.opacity = '1';
                confirmBtn.style.cursor = 'pointer';
            }
        }

        openModal('checkOutModal');
    } catch (error) {
        showNotification('Error loading check-in information', 'error');
        console.error('Error:', error);
    }
}


// Helper: calculate hours between check-in and check-out ("HH:MM:SS" strings)
function calculateWorkedHours(checkInTime, checkOutTime) {
    const [inH, inM, inS = 0] = checkInTime.split(':').map(Number);
    const [outH, outM, outS = 0] = checkOutTime.split(':').map(Number);

    const inDate = getCurrentISTDate();
    inDate.setHours(inH, inM, inS, 0);

    const outDate = getCurrentISTDate();
    outDate.setHours(outH, outM, outS, 0);

    const diffMs = outDate - inDate;
    const diffHours = diffMs / (1000 * 60 * 60);
    return Math.round(diffHours * 100) / 100; // 2 decimals
}

async function confirmCheckOut() {
    const confirmBtn = document.getElementById('confirmCheckOutBtn');
    const checkOutBtnText = document.getElementById('checkOutBtnText');
    const checkOutSpinner = document.getElementById('checkOutSpinner');

    confirmBtn.disabled = true;
    checkOutBtnText.classList.add('hidden');
    checkOutSpinner.classList.remove('hidden');

    try {
        // Make sure we have today's record from showCheckOut()
        if (!currentCheckOutContext || !currentCheckOutContext.record) {
            showNotification('No check-in record found for today.', 'error');
            return;
        }

        const { record, workHours } = currentCheckOutContext;
        const currentTime = getCurrentDateTime();

        // Safety: block if somehow still < 0.5 hours
        if (workHours < 0.5) {
            showNotification(
                'You cannot check out before completing 0.5 hours of work.',
                'error'
            );
            return;
        }

        // 2️⃣ Less than 9 hours → warning + confirmation
        if (workHours < 9.0) {
            const proceed = await showConfirm(
                `You have worked ${workHours.toFixed(2)} hours. ` +
                'You have worked less than 9.0 hours. This will be marked as a half day in your monthly records.',
                'Half Day Warning',
                '⏳'
            );
            if (!proceed) {
                // Restore UI if they cancel
                confirmBtn.disabled = false;
                checkOutBtnText.classList.remove('hidden');
                checkOutSpinner.classList.add('hidden');
                return; // user cancelled
            }
        }

        // 3️⃣ GEOFENCE GATE — Mandatory for office-type attendance
        // Allows check-out from ANY valid office, not just the check-in office.
        const attendanceType = (record.type || '').toLowerCase();
        const isOfficeType = attendanceType === 'office' || attendanceType === '';
        let location = null;

        if (isOfficeType && record.office_id) {
            showNotification('Verifying your location...', 'info');
            let position = null;
            try {
                position = await new Promise((resolve, reject) =>
                    navigator.geolocation.getCurrentPosition(resolve, reject, {
                        enableHighAccuracy: true,
                        timeout: 50000,
                        maximumAge: 0
                    })
                );
            } catch (geoErr) {
                showNotification(
                    'Location access is required to check out. Please enable GPS and try again.',
                    'error'
                );
                return;
            }

            location = {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude
            };

            // ── Multi-office check: try the check-in office first, then all others ──
            // Fetch all active offices
            let allOffices = [];
            try {
                const officeRes = await apiCall('offices', 'GET');
                if (officeRes && officeRes.success && Array.isArray(officeRes.offices)) {
                    allOffices = officeRes.offices;
                }
            } catch (_) {}

            // Always ensure the check-in office is in the list to check
            const checkedOfficeIds = new Set(allOffices.map(o => o.id));
            if (!checkedOfficeIds.has(record.office_id)) {
                allOffices.unshift({ id: record.office_id }); // fallback if not in list
            }

            let inRangeOffice = null;
            let closestDistance = Infinity;
            let closestOfficeInfo = null;

            for (const office of allOffices) {
                const geoResult = await apiCall('check-location', 'POST', {
                    latitude: location.latitude,
                    longitude: location.longitude,
                    office_id: office.id
                });

                if (!geoResult || !geoResult.success) continue;

                if (geoResult.in_range) {
                    inRangeOffice = { ...office, ...geoResult };
                    break; // found a valid office — stop checking
                }

                // Track the closest office for a better error message
                if (geoResult.distance < closestDistance) {
                    closestDistance = geoResult.distance;
                    closestOfficeInfo = geoResult;
                }
            }

            if (!inRangeOffice) {
                const distM = Math.round(closestDistance);
                const radius = closestOfficeInfo?.office_location?.radius_meters ?? closestOfficeInfo?.radius_meters ?? '?';
                showNotification(
                    `⛔ You are not within range of any office (closest: ${distM}m away, allowed radius: ${radius}m). Move closer to check out.`,
                    'error'
                );
                return;
            }

            // If they checked out from a different office, note it
            if (inRangeOffice.id !== record.office_id) {
                showNotification(
                    `✅ Location verified at ${inRangeOffice.name || 'another office'}.`,
                    'info'
                );
            }

        } else if (navigator.geolocation) {
            // Non-office: still grab location softly for the record, but don't block
            try {
                const pos = await new Promise((resolve, reject) =>
                    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
                );
                location = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
            } catch (_) { /* non-blocking for WFH/client */ }
        }


        const result = await apiCall('check-out', 'POST', {
            employee_id: currentUser.id,
            date: currentTime.date,          // you can also use record.date
            check_out: currentTime.time,
            location
        });

        if (!result || result.success !== true) {
            console.error('Checkout API raw response:', result && result.raw);
            showNotification(
                (result && result.message) || 'Failed to record check-out',
                'error'
            );
            return;
        }

        let message = 'Check-out recorded successfully!';
        if (result.is_half_day && typeof result.work_hours === 'number') {
            message += ` (Marked as half day - ${result.work_hours.toFixed(1)} hours)`;
        }
        showNotification(message, 'success');

        closeModal('checkOutModal');
        await loadDashboardData();
        if (document.getElementById('recordsScreen')?.style.display === 'block') {
            await loadAttendanceRecords();
        }
    } catch (err) {
        console.error('Error recording check-out:', err);
        showNotification('Error recording check-out', 'error');
    } finally {
        confirmBtn.disabled = false;
        checkOutBtnText.classList.remove('hidden');
        checkOutSpinner.classList.add('hidden');
    }
}


// To allow admins/Mentors to view specific employee records
let overrideRecordsEmployeeId = null;
let overrideRecordsEmployeeName = null;

function viewEmployeeRecords(empId, empName) {
    overrideRecordsEmployeeId = empId;
    overrideRecordsEmployeeName = empName;
    document.querySelector('#recordsScreen .header-title').textContent = `Attendance Records: ${empName}`;
    window._keepOverrideFilter = true;
    showScreen('recordsScreen');
}

async function loadAttendanceRecords(isMore = false, searchTerm = '') {
    try {
        const recordsContent = document.getElementById('recordsContent');

        if (!isMore) {
            attendanceDaysOffset = 0;
            allAttendanceRecords = [];
            if (!searchTerm) {
                recordsContent.innerHTML = `
                    <div class="text-center" style="padding: 40px;">
                        <div class="loading-spinner" style="margin: 0 auto 16px; width: 24px; height: 24px;"></div>
                        <p>Loading attendance records.</p>
                    </div>
                `;
            }
        } else {
            const btn = document.getElementById('loadMoreAttendanceBtn');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<div class="loading-spinner" style="width:16px; height:16px; margin:0 auto;"></div>';
            }
        }

        const isAdminOrMentor = currentUser.role === 'admin' || currentUser.role === 'Mentor' || currentUser.has_subordinates;
        // Increase batch size for admin to 5 days for better visibility
        const batchSize = isAdminOrMentor ? 5 : 10;

        const params = {
            days_limit: batchSize,
            days_offset: attendanceDaysOffset,
            search: searchTerm
        };

        // For non-admin, non-Mentor, non-de-facto-Mentor employees, fetch only their last 6 months of data
        if (currentUser.role !== 'admin' && currentUser.role !== 'Mentor' && !currentUser.has_subordinates) {
            params.employee_id = currentUser.id;
            // No strict 6-month limit here if we want true pagination, but we can keep it as a safety
            const today = getCurrentISTDate();
            const sixMonthsAgo = getCurrentISTDate();
            sixMonthsAgo.setMonth(today.getMonth() - 6);
            params.start_date = formatDate(sixMonthsAgo);
            params.end_date = formatDate(today);
        } else if (overrideRecordsEmployeeId) {
            // If an Admin/Mentor clicked "Records" on a specific user
            params.employee_id = overrideRecordsEmployeeId;
        } else if (currentUser.role === 'admin') {
            // Admins see all records by default - don't set employee_id
        } else if (currentUser.role === 'Mentor' || currentUser.has_subordinates) {
            // If Mentor or lead clicked "Records" from main dashboard, show their personal records
            params.employee_id = currentUser.id;
        }

        params.user_id = currentUser.id;
        const result = await apiCall('attendance-records', 'GET', params);

        if (result && result.success && Array.isArray(result.records)) {
            allAttendanceRecords = [...allAttendanceRecords, ...result.records];
            attendanceHasMore = result.has_more;
            renderAttendanceTable(allAttendanceRecords);
            applyAttendanceSearch();
        } else {
            if (!isMore) {
                // Keep the toolbar if it exists, otherwise render it with empty state
                if (!document.getElementById('attendanceSearchInput')) {
                    renderAttendanceTable([]);
                } else {
                    const listContainer = document.getElementById('attendanceListContainer');
                    if (listContainer) listContainer.innerHTML = '<div class="text-center" style="padding: 40px;"><p>No records found.</p></div>';
                }
            } else {
                showNotification('No more records to load', 'info');
                const btn = document.getElementById('loadMoreAttendanceBtn');
                if (btn) btn.remove();
            }
        }
    } catch (error) {
        console.error('Error loading records:', error);
        if (!isMore) {
            document.getElementById('recordsContent').innerHTML = `
                <div class="text-center" style="padding: 40px;">
                    <p style="color: var(--error-color);">Error loading records. Please try again.</p>
                </div>
            `;
        }
    }
}

async function loadMoreAttendanceRecords() {
    const isAdminOrMentor = currentUser.role === 'admin' || currentUser.role === 'Mentor' || currentUser.has_subordinates;
    const batchSize = isAdminOrMentor ? 5 : 10;
    attendanceDaysOffset += batchSize;
    const searchVal = document.getElementById('attendanceSearchInput')?.value || '';
    await loadAttendanceRecords(true, searchVal);
}

// 2) Render table with search toolbar
function renderAttendanceTable(records) {
    const recordsContent = document.getElementById('recordsContent');
    const oldSearchVal = document.getElementById('attendanceSearchInput')?.value || '';

    // Render the toolbar with a dedicated Search button
    recordsContent.innerHTML = `
        <div class="records-toolbar">
            <div class="records-toolbar-left">Attendance Records</div>
            <div class="records-search-group" style="display: flex; gap: 8px; flex: 1; max-width: 600px;">
                <input id="attendanceSearchInput"
                        class="form-control records-search-input"
                        placeholder="Search: name, Mar, 22-04-2026, wfh…"
                        value="${oldSearchVal}"
                        onkeydown="if(event.key === 'Enter') applyAttendanceSearch();"
                        style="flex: 1;">
                <button class="btn btn-primary" onclick="applyAttendanceSearch()" style="border-radius: 12px; padding: 0 20px;">
                    <i class="fas fa-search"></i> Search
                </button>
                <button class="btn btn-secondary" onclick="clearAttendanceSearch()" style="border-radius: 12px; padding: 0 20px; background: var(--gray-100); color: var(--gray-700);">
                    Clear
                </button>
            </div>
        </div>
        <div id="attendanceListContainer"></div>
        ${attendanceHasMore ? `
            <div class="text-center" style="margin-top: 24px; margin-bottom: 40px;">
                <button id="loadMoreAttendanceBtn" class="btn btn-primary" onclick="loadMoreAttendanceRecords()" style="padding: 12px 32px; font-weight: 600; border-radius: 12px; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25);">
                    ${(currentUser.role === 'admin' || currentUser.role === 'Mentor' || currentUser.has_subordinates) ? 'Load Previous Day' : 'Load Previous 10 Days'}
                </button>
            </div>
        ` : ''}
    `;

    const listContainer = document.getElementById('attendanceListContainer');

    if (!records || records.length === 0) {
        listContainer.innerHTML = `
            <div class="text-center" style="padding: 40px;">
                <p style="color: var(--gray-500);">No attendance records found.</p>
            </div>
        `;
        return;
    }

    if (currentUser.role === 'admin' || currentUser.role === 'Mentor' || currentUser.has_subordinates) {
        renderAdminDayWiseView(records, listContainer);
    } else {
        renderUserMonthWiseView(records, listContainer);
    }
}

// Helper function for ADMIN - Day-wise view
function renderAdminDayWiseView(records, containerEl) {
    const recordsContent = containerEl || document.getElementById('recordsContent');

    // Group records by date
    const recordsByDate = {};
    records.forEach(record => {
        const date = record.date || 'Unknown Date';
        if (!recordsByDate[date]) {
            recordsByDate[date] = [];
        }
        recordsByDate[date].push(record);
    });

    // Sort dates in descending order (most recent first)
    const sortedDates = Object.keys(recordsByDate).sort((a, b) => {
        return new Date(b) - new Date(a);
    });

    let tableHeadersHtml = `
        <th>Employee</th>
        <th>Department</th>
        <th>Check In</th>
        <th>Check Out</th>
        <th>Hours</th>
        <th>Type</th>
        <th>Status</th>
        <th>Office</th>
        <th>Photo</th>
    `;
    if (currentUser.role === 'admin') {
        tableHeadersHtml += `<th style="width: 160px">Actions</th>`;
    }

    let html = '<div class="records-by-date">';

    sortedDates.forEach(date => {
        const dateRecords = recordsByDate[date];

        const formattedDate = formatDisplayDate(date);
        const dayOfWeek = new Date(date).toLocaleDateString('en-US', { weekday: 'long' });

        html += `
            <div class="admin-date-header">
                <div class="day-info">
                    <div class="date-main">
                        ${dayOfWeek}, ${formattedDate}
                    </div>
                </div>
            </div>
        
            <div class="table-wrap">
                <table class="records-table">
                    <thead>
                        <tr>
                            ${tableHeadersHtml}
                        </tr>
                    </thead>
                    <tbody>
                        ${dateRecords.map(r => renderAttendanceRow(r)).join('')}
                    </tbody>
                </table>
            </div>
        `;
    });

    html += '</div>';
    recordsContent.innerHTML = html;
}


// Helper function for USER - Month-wise view
function renderUserMonthWiseView(records, containerEl) {
    const recordsContent = containerEl || document.getElementById('recordsContent');

    // Group records by month-year
    const recordsByMonth = {};
    records.forEach(record => {
        if (!record.date) return;

        const date = new Date(record.date);
        const monthKey = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
        const monthName = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

        if (!recordsByMonth[monthKey]) {
            recordsByMonth[monthKey] = {
                monthName: monthName,
                records: []
            };
        }
        recordsByMonth[monthKey].records.push(record);
    });

    // Sort months in descending order (most recent first)
    const sortedMonthKeys = Object.keys(recordsByMonth).sort((a, b) => {
        return b.localeCompare(a);
    });

    let html = '<div class="records-by-month">';

    sortedMonthKeys.forEach(monthKey => {
        const monthData = recordsByMonth[monthKey];
        const monthRecords = monthData.records;
        const monthName = monthData.monthName;

        html += `
            <div class="month-header">
                <div class="month-name">${monthName}</div>
            </div>
            <div class="table-wrap">
                <table class="records-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Check In</th>
                            <th>Check Out</th>
                            <th>Hours</th>
                            <th>Type</th>
                            <th>Status</th>
                            <th>Office</th>
                            <th>Photo</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${monthRecords.map(r => renderUserAttendanceRow(r)).join('')}
                    </tbody>
                </table>
            </div>
        `;
    });

    html += '</div>';
    recordsContent.innerHTML = html;
}
// Search handlers
/**
 * Build a rich set of searchable date strings for a given YYYY-MM-DD date string.
 * Supports: raw ISO, DD-MM-YYYY, DD/MM/YYYY, MM/DD/YYYY, month names (full & short),
 * day-of-week names (full & short), year only, and display formats.
 */
function _buildDateSearchTokens(dateStr) {
    if (!dateStr) return [];
    const dateObj = new Date(dateStr);
    if (isNaN(dateObj)) return [dateStr.toLowerCase()];

    const dd   = String(dateObj.getDate()).padStart(2, '0');
    const mm   = String(dateObj.getMonth() + 1).padStart(2, '0');
    const yyyy = String(dateObj.getFullYear());

    return [
        dateStr.toLowerCase(),                              // 2026-04-22
        `${dd}-${mm}-${yyyy}`,                              // 22-04-2026
        `${dd}/${mm}/${yyyy}`,                              // 22/04/2026
        `${mm}/${dd}/${yyyy}`,                              // 04/22/2026
        `${dd}-${mm}`,                                      // 22-04  (partial)
        `${mm}/${dd}`,                                      // 04/22  (partial)
        yyyy,                                               // 2026
        // Month — full & short (en-US locale)
        dateObj.toLocaleDateString('en-US', { month: 'long'  }).toLowerCase(),  // april
        dateObj.toLocaleDateString('en-US', { month: 'short' }).toLowerCase(),  // apr
        // Day of week — full & short
        dateObj.toLocaleDateString('en-US', { weekday: 'long'  }).toLowerCase(), // wednesday
        dateObj.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase(), // wed
        // Long display: "April 22, 2026"
        dateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).toLowerCase(),
        // Short display: "Apr 22, 2026"
        dateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).toLowerCase(),
    ];
}

let attendanceSearchTimeout = null;
function applyAttendanceSearch() {
    const input = document.getElementById('attendanceSearchInput');
    if (!input) return;

    const term = input.value.trim().toLowerCase();
    
    // Clear any pending timeouts
    if (attendanceSearchTimeout) clearTimeout(attendanceSearchTimeout);

    // 1. Local filtering (instant)
    let filtered = allAttendanceRecords || [];
    if (term) {
        filtered = filtered.filter(r => {
            const name     = (r.employee_name || r.name || '').toLowerCase();
            const username = (r.username || '').toLowerCase();
            const dept     = (r.department || '').toLowerCase();
            const status   = (r.status || '').toLowerCase().replace('_', ' ');
            const type     = (r.type || '').toLowerCase();
            const office   = (r.office_name || '').toLowerCase();
            const dateTokens = _buildDateSearchTokens(r.date);
            const checkIn  = (r.check_in_time  || '').toLowerCase();
            const checkOut = (r.check_out_time || '').toLowerCase();

            return (
                name.includes(term)     ||
                username.includes(term) ||
                dept.includes(term)     ||
                status.includes(term)   ||
                type.includes(term)     ||
                office.includes(term)   ||
                checkIn.includes(term)  ||
                checkOut.includes(term) ||
                dateTokens.some(tok => tok.includes(term))
            );
        });
    }

    // 2. Trigger server-side load if no local matches or if specifically requested by button click
    // We now only do this explicitly on button click or Enter key (handled by the caller)
    // But if lo cal records don't have it, we must fetch.
    if (term && filtered.length === 0) {
        loadAttendanceRecords(false, term);
        return;
    }

    const listContainer = document.getElementById('attendanceListContainer');
    if (!listContainer) return;

    if (!filtered.length) {
        if (!term) {
            listContainer.innerHTML = `
                <div class="text-center" style="padding: 40px;">
                    <p style="color: var(--gray-500);">No records found.</p>
                </div>
            `;
        } else {
            listContainer.innerHTML = `
                <div class="text-center" style="padding: 40px;">
                    <p style="color: var(--gray-500);">No local records matched "${term}". Click Search to check all history.</p>
                </div>
            `;
        }
        return;
    }

    if (currentUser.role === 'admin' || currentUser.role === 'Mentor' || currentUser.has_subordinates) {
        renderAdminDayWiseView(filtered, listContainer);
    } else {
        renderUserMonthWiseView(filtered, listContainer);
    }
}

function clearAttendanceSearch() {
    const input = document.getElementById('attendanceSearchInput');
    if (input) input.value = '';
    loadAttendanceRecords();
}


// Helper function to render a single row for user view
function renderUserAttendanceRow(r) {
    const hoursNum = Number(r.total_hours);
    const totalHours = (!isNaN(hoursNum) && hoursNum > 0)
        ? `${Math.floor(hoursNum)}h ${Math.round((hoursNum % 1) * 60)}m`
        : '-';

    const statusClass = 'status-' + String(r.status || '');
    const statusText = String(r.status || '').replace('_', ' ').toUpperCase();

    const photoCell = r.photo_url
        ? `<img src="${r.photo_url}"
                alt="photo"
                style="width:64px;height:64px;border-radius:12px;object-fit:cover;aspect-ratio:1/1;">`
        : '-';

    // Format date with day name
    let dateDisplay = r.date || '-';
    if (r.date) {
        const dateObj = new Date(r.date);
        const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
        dateDisplay = `${dayName}, ${dateDisplay}`;
    }

    return `<tr>
        <td>${dateDisplay}</td>
        <td>${r.check_in_time || '-'}</td>
        <td>${r.check_out_time || '-'}</td>
        <td>${totalHours}</td>
        <td>${(r.type || '').toUpperCase()}</td>
        <td><span class="status-badge ${statusClass}">${statusText}</span></td>
        <td>${r.office_name || '-'}</td>
        <td>${photoCell}</td>
    </tr>`;
}

// Helper function to render a single row (admin view with actions)
function renderAttendanceRow(r) {
    // Use total_hours_calculated if available, otherwise use total_hours
    const hoursValueRaw = (r.total_hours_calculated !== undefined
        ? r.total_hours_calculated
        : r.total_hours);

    const hoursNum = Number(hoursValueRaw);

    const totalHours = (!isNaN(hoursNum) && hoursNum > 0)
        ? `${Math.floor(hoursNum)}h ${Math.round((hoursNum % 1) * 60)}m`
        : '-';
    const statusClass = 'status-' + String(r.status || '');
    const statusText = String(r.status || '').replace('_', ' ').toUpperCase();

    const photoCell = r.photo_url
        ? `<img src="${r.photo_url}"
                alt="photo"
                style="width:64px;height:64px;border-radius:12px;object-fit:cover;aspect-ratio:1/1;">`
        : '-';

    let actionsHtml = '';
    if (currentUser.role === 'admin') {
        actionsHtml = `
            <button
                class="btn btn-secondary"
                data-id="${r.id}"
                data-status="${r.status || ''}"
                data-employee="${r.employee_name || ''}"
                data-date="${r.date || ''}"
                onclick="openEditAttendance(this)"
            >
                Edit
            </button>
            <button class="btn" style="background:#ef4444;color:#fff" onclick="deleteAttendance(${r.id})">
                Delete
            </button>
        `;
    }

    return `<tr>
        <td>${r.employee_name || ''}</td>
        <td>${r.department || ''}</td>
        <td>${r.check_in_time || '-'}</td>
        <td>${r.check_out_time || '-'}</td>
        <td>${totalHours}</td>
        <td>${(r.type || '').toUpperCase()}</td>
        <td><span class="status-badge ${statusClass}">${statusText}</span></td>
        <td>${r.office_name || '-'}</td>
        <td>${photoCell}</td>
        <td style="white-space:nowrap;">
            ${actionsHtml}
        </td>
    </tr>`;
}


async function deleteAttendance(id) {
    if (!currentUser || currentUser.role !== 'admin') {
        showNotification('Admins only.', 'warning');
        return;
    }
    if (!(await showConfirm('Are you sure you want to delete this attendance record?', 'Delete Record', '🗑️'))) return;

    // Using POST + _method='DELETE' so it works with your router
    const res = await apiCall(`attendance-record/${id}`, 'POST', { _method: 'DELETE' });

    if (res && res.success) {
        showNotification('Attendance record deleted', 'success');
        await loadAttendanceRecords();
    } else {
        showNotification((res && res.message) || 'Failed to delete record', 'error');
    }
}

async function openEditAttendance(buttonEl) {
    if (!currentUser || currentUser.role !== 'admin') {
        showNotification('Admins only.', 'warning');
        return;
    }

    if (!buttonEl || !buttonEl.dataset) return;

    const id = buttonEl.dataset.id;
    const status = buttonEl.dataset.status || 'present';
    const employee = buttonEl.dataset.employee || '';
    const date = buttonEl.dataset.date || '';

    currentEditAttendanceId = id;

    const infoEl = document.getElementById('editAttInfo');
    if (infoEl) {
        infoEl.textContent = `${employee || 'Employee'} – ${date || ''} (Record #${id})`;
    }

    const select = document.getElementById('editAttStatus');
    if (select) {
        select.value = status || 'present';
    }

    const msg = document.getElementById('editAttMsg');
    if (msg) msg.textContent = '';

    openModal('editAttendanceModal');
}

async function submitEditAttendance() {
    if (!currentUser || currentUser.role !== 'admin') {
        showNotification('Admins only.', 'warning');
        return;
    }

    if (!currentEditAttendanceId) {
        showNotification('No record selected to update.', 'error');
        return;
    }

    const select = document.getElementById('editAttStatus');
    if (!select) return;

    const newStatus = select.value;

    const btn = document.getElementById('editAttSaveBtn');
    const textSpan = document.getElementById('editAttSaveText');
    const spinner = document.getElementById('editAttSpinner');

    if (btn && textSpan && spinner) {
        btn.disabled = true;
        textSpan.classList.add('hidden');
        spinner.classList.remove('hidden');
    }

    try {
        const res = await apiCall(`attendance-record/${currentEditAttendanceId}`, 'POST', {
            status: newStatus
        });

        if (res && res.success) {
            showNotification('Attendance updated', 'success');
            closeModal('editAttendanceModal');
            await loadAttendanceRecords();
        } else {
            const msgEl = document.getElementById('editAttMsg');
            if (msgEl) msgEl.textContent = (res && res.message) || 'Failed to update record';
            showNotification('Failed to update record', 'error');
        }
    } catch (e) {
        console.error('submitEditAttendance error', e);
        const msgEl = document.getElementById('editAttMsg');
        if (msgEl) msgEl.textContent = 'Error updating attendance.';
        showNotification('Error updating attendance', 'error');
    } finally {
        if (btn && textSpan && spinner) {
            btn.disabled = false;
            textSpan.classList.remove('hidden');
            spinner.classList.add('hidden');
        }
    }
}




/* 3) Helper: find a usable photo URL from various shapes your API might return.
        Priority:
        - record.photo_url (already provided by backend)
        - check_in_photo / check_out_photo (data URL, http/https, relative path, or raw base64)
*/
function resolvePhotoUrl(r) {
    const candidate =
        r.photo_url ||
        r.check_in_photo ||
        r.check_out_photo ||
        null;

    if (!candidate) return null;

    // If it already looks like a URL or data URL, just use it
    if (/^(https?:|data:|blob:)/i.test(candidate)) return candidate;

    // Raw base64 (no data: prefix) → wrap it
    const looksLikeBase64 = /^[A-Za-z0-9+/=\s]+$/.test(candidate) && candidate.length > 100;
    if (looksLikeBase64) return `data:image/jpeg;base64,${candidate}`;

    // Relative path on your server (e.g., "uploads/img123.jpg")
    // Adjust prefix if your images live elsewhere.
    if (!candidate.startsWith('/')) return `./${candidate}`;

    return candidate; // absolute path starting with /
}



/* Map Global Variables */
let officeMap = null;
let officeMarker = null;
let tempPickerLat = 28.6139;
let tempPickerLng = 77.2090;

/* Admin Search Cache */
let allAdminUsers = [];
let allAdminProfiles = [];

/* Open Admin Panel and ALWAYS pull fresh data from DB */
// === ADMIN: open panel and load everything ===
async function openAdminPanel() {
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'Mentor' && !currentUser.has_subordinates)) {
        showNotification('Admins only.', 'warning');
        return;
    }
    showScreen('adminScreen');

    const promises = [
        refreshAdminOffices(),
        refreshAdminUsers(),
        refreshPrimaryOfficeSelects(),
        refreshMentorDropdown(),
        refreshAdminProfiles()          // 🔹 load extended user details
    ];

    if (currentUser.role !== 'admin' && (currentUser.role === 'Mentor' || currentUser.has_subordinates)) {
        document.getElementById('adminAddOfficeCard')?.classList.add('hidden');
        document.getElementById('adminAddUserCard')?.classList.add('hidden');
        document.getElementById('adminOfficesListCard')?.classList.add('hidden');
        const titleEl = document.querySelector('#adminScreen .header-title');
        if (titleEl) titleEl.textContent = 'Manage Employees';

        // Move adminStatsGrid to adminScreen
        const statsGrid = document.getElementById('adminStatsGrid');
        const adminScreenContainer = document.querySelector('#adminScreen .container');
        const adminGrid = document.querySelector('#adminScreen .admin-grid');
        if (statsGrid && statsGrid.parentNode !== adminScreenContainer) {
            adminScreenContainer.insertBefore(statsGrid, adminGrid);
            statsGrid.style.marginBottom = '24px';
        }
        if (statsGrid) statsGrid.classList.remove('hidden');

        // Mentor needs to fetch these when opening the panel
        promises.push(loadAdminSummary());
        promises.push(loadUpcomingBirthdays());
        promises.push(loadPendingRequests());
        promises.push(loadActiveTasks());

        // Hide Intelligence Hub for Mentors as requested
        document.getElementById('intelligenceHubCard')?.classList.add('hidden');


        // Show specific Admin Panel action buttons for Mentors
        document.getElementById('btnAdminExportAttendance').style.display = 'inline-block';

    } else {
        document.getElementById('adminAddOfficeCard')?.classList.remove('hidden');
        document.getElementById('adminAddUserCard')?.classList.remove('hidden');
        document.getElementById('adminOfficesListCard')?.classList.remove('hidden');
        const titleEl = document.querySelector('#adminScreen .header-title');
        if (titleEl) titleEl.textContent = 'Admin Panel';

        // Show specific Admin Panel action buttons for true admins too
        document.getElementById('btnAdminExportAttendance').style.display = 'inline-block';

        // Ensure Intelligence Hub is visible for true admins
        document.getElementById('intelligenceHubCard')?.classList.remove('hidden');
        document.getElementById('temporaryTagsCard')?.classList.remove('hidden');
    }

    try {
        await Promise.all(promises);
    } catch (e) {
        console.error("Error loading admin data", e);
    }

    accessibleOffices = [];
    adminOfficeEditId = null;
    document.getElementById('addOfficeMsg').textContent = '';
    document.getElementById('addUserMsg').textContent = '';
}

/* Map Picker Modal Functions */
function openMapPicker() {
    const currentLat = parseFloat(document.getElementById('newOfficeLat').value) || 28.6139;
    const currentLng = parseFloat(document.getElementById('newOfficeLng').value) || 77.2090;

    tempPickerLat = currentLat;
    tempPickerLng = currentLng;

    openModal('mapPickerModal');

    // Initialize map if not exists
    if (!officeMap) {
        officeMap = new google.maps.Map(document.getElementById('officeLocationMap'), {
            center: { lat: currentLat, lng: currentLng },
            zoom: 13,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false
        });

        officeMarker = new google.maps.Marker({
            position: { lat: currentLat, lng: currentLng },
            map: officeMap,
            draggable: true
        });

        officeMap.addListener('click', function (e) {
            updatePickerMarker(e.latLng.lat(), e.latLng.lng());
        });

        officeMarker.addListener('dragend', function (e) {
            const pos = officeMarker.getPosition();
            updatePickerMarker(pos.lat(), pos.lng());
        });
    } else {
        officeMap.setCenter({ lat: currentLat, lng: currentLng });
        officeMarker.setPosition({ lat: currentLat, lng: currentLng });
    }
}

function updatePickerMarker(lat, lng) {
    tempPickerLat = lat;
    tempPickerLng = lng;
    if (officeMarker) officeMarker.setLatLng([lat, lng]);
    document.getElementById('mapPickerStatus').textContent = `Selected: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function confirmMapLocation() {
    document.getElementById('newOfficeLat').value = tempPickerLat.toFixed(6);
    document.getElementById('newOfficeLng').value = tempPickerLng.toFixed(6);
    closeModal('mapPickerModal');
}

/* 📡 GPS: Use current device location */
function useCurrentLocation() {
    if (!navigator.geolocation) {
        return showNotification("Geolocation is not supported by your browser", "warning");
    }

    const btn = event.currentTarget;
    const originalContent = btn.innerHTML;
    btn.innerHTML = '<div class="loading-spinner" style="width:20px; height:20px;"></div>';
    btn.disabled = true;

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            updatePickerMarker(lat, lng);
            officeMap.setView([lat, lng], 16);
            btn.innerHTML = originalContent;
            btn.disabled = false;
            showNotification("Location detected", "success");
        },
        (error) => {
            console.error(error);
            btn.innerHTML = originalContent;
            btn.disabled = false;
            showNotification("Could not get location. Please check permissions.", "error");
        },
        { enableHighAccuracy: true, timeout: 45000 }
    );
}

/* 🔍 Search: Find location by name (Geocoding) */
async function searchMapLocation() {
    const query = document.getElementById('mapSearchInput').value.trim();
    if (!query) return;

    if (typeof google === 'undefined') return showNotification("Map service not ready", "error");

    const btn = document.querySelector('button[onclick="searchMapLocation()"]');
    const originalText = btn.textContent;
    btn.textContent = 'Searching...';
    btn.disabled = true;

    try {
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ address: query }, (results, status) => {
            if (status === "OK" && results[0]) {
                const loc = results[0].geometry.location;
                const lat = loc.lat();
                const lng = loc.lng();

                updatePickerMarker(lat, lng);
                officeMap.setCenter(loc);
                officeMap.setZoom(15);

                const cityName = results[0].address_components.find(c => c.types.includes("locality"))?.long_name || results[0].formatted_address.split(',')[0];
                document.getElementById('mapPickerStatus').textContent = `Found: ${cityName}`;
            } else {
                showNotification("Location not found", "warning");
            }
            btn.textContent = originalText;
            btn.disabled = false;
        });
    } catch (error) {
        console.error("Search failed:", error);
        showNotification("Search service unavailable", "error");
        btn.textContent = originalText;
        btn.disabled = false;
    }
}


// Small helper to build query params
function toQuery(obj) {
    return Object.keys(obj).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(obj[k])).join('&');
}


/* ----- Offices (list, add, delete) ----- */

let adminOfficeEditId = null; // null = ADD, number = EDIT

async function refreshAdminOffices() {
    const box = document.getElementById('adminOfficesList');
    box.innerHTML = '<div class="text-center" style="padding:12px;"><div class="loading-spinner" style="margin:0 auto;"></div> Loading offices…</div>';

    const res = await apiCall('offices-all', 'GET', { active: 1 });
    const offices = (res && res.success && Array.isArray(res.offices)) ? res.offices : [];

    document.getElementById('officeCount').textContent = `(${offices.length})`;
    box.innerHTML = renderOfficesTable(offices);
}

function renderOfficesTable(offices) {
    if (!offices.length) return '<p style="color:var(--gray-600)">No offices yet.</p>';

    const rows = offices.map(o => `
        <tr>
            <td>${o.id}</td>
            <td>${o.name || ''}</td>
            <td>${o.address || ''}</td>
            <td>${o.latitude ?? ''}</td>
            <td>${o.longitude ?? ''}</td>
            <td>${o.radius_meters ?? ''}</td>
            <td style="white-space:nowrap;">
                <button class="btn btn-secondary" onclick="startEditOffice(${o.id})">Edit</button>
                <button class="btn" style="background:#ef4444;color:#fff" onclick="deleteOffice(${o.id})">Delete</button>
            </td>
        </tr>
    `).join('');

    return `
        <div style="overflow:auto; max-height:420px;">
            <table class="records-table">
                <thead>
                    <tr>
                        <th style="width:60px">ID</th>
                        <th>Name</th>
                        <th>Address</th>
                        <th>Lat</th>
                        <th>Lng</th>
                        <th>Radius(m)</th>
                        <th style="width:160px">Actions</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

// Submit (add or update)
function numOrNull(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
}

async function submitNewOffice() {
    const msg = document.getElementById('addOfficeMsg');
    msg.textContent = '';

    const id = document.getElementById('newOfficeId').value.trim();
    const name = document.getElementById('newOfficeName').value.trim();
    const address = document.getElementById('newOfficeAddress').value.trim();
    const lat = parseFloat(document.getElementById('newOfficeLat').value);
    const lng = parseFloat(document.getElementById('newOfficeLng').value);
    const radius = parseInt(document.getElementById('newOfficeRadius').value, 10);

    if (!id || !name) return msg.textContent = 'Office Id and name is required';
    if (Number.isNaN(lat) || Number.isNaN(lng) || Number.isNaN(radius)) {
        msg.textContent = 'Latitude, longitude and radius are required and must be numbers';
        return;
    }

    const payload = { id, name, address, latitude: lat, longitude: lng, radius_meters: radius };
    const endpoint = adminOfficeEditId ? `office/${adminOfficeEditId}` : 'office';
    const res = await apiCall(endpoint, 'POST', payload);

    if (res && res.success) {
        showNotification(adminOfficeEditId ? 'Office updated' : 'Office added');
        clearOfficeForm();
        await refreshAdminOffices();
        await refreshPrimaryOfficeSelects();
        await populateOfficeDropdowns();
        accessibleOffices = []; // drop cache so Attendance screen refreshes
    } else {
        msg.textContent = (res && res.message) ? res.message : 'Failed to save office';
    }
}



function clearOfficeForm() {
    adminOfficeEditId = null;
    document.getElementById('newOfficeId').value = '';
    document.getElementById('newOfficeId').disabled = false;
    document.getElementById('newOfficeName').value = '';
    document.getElementById('newOfficeAddress').value = '';
    document.getElementById('newOfficeRadius').value = '100';
    document.getElementById('addOfficeMsg').textContent = '';

    // Reset Lat/Long fields
    document.getElementById('newOfficeLat').value = '';
    document.getElementById('newOfficeLng').value = '';

    adminOfficeEditId = null;
    document.querySelector('button[onclick="submitNewOffice()"]').textContent = '➕ Add Office';
}

async function startEditOffice(id) {
    const res = await apiCall(`office/${id}`, 'GET');
    if (!res || !res.success || !res.office) {
        showNotification('Failed to load office', 'error');
        return;
    }
    const o = res.office;
    adminOfficeEditId = o.id;
    document.getElementById('newOfficeId').value = o.id || ''
    document.getElementById('newOfficeId').disabled = true;
    document.getElementById('newOfficeName').value = o.name || '';
    document.getElementById('newOfficeAddress').value = o.address || '';
    document.getElementById('newOfficeRadius').value = o.radius_meters ?? '';
    document.getElementById('newOfficeLat').value = o.latitude ?? '';
    document.getElementById('newOfficeLng').value = o.longitude ?? '';
    document.getElementById('addOfficeMsg').textContent = 'Editing office #' + o.id;

    document.querySelector('button[onclick="submitNewOffice()"]').textContent = '💾 Update Office';
}

async function deleteOffice(id) {
    if (!(await showConfirm('Delete this office?', 'Delete Office', '🏢'))) return;
    let res = await apiCall(`office/${id}`, 'DELETE');
    if (res && res.success) {
        showNotification('Office deleted');
        await refreshAdminOffices();
        await refreshPrimaryOfficeSelects();
        accessibleOffices = [];
    } else {
        showNotification((res && res.message) || 'Failed to delete office', 'error');
    }
}




/* ----- Users (list, add, delete) ----- */

async function refreshAdminUsers() {
    const tbody = document.getElementById('adminUsersList');
    tbody.innerHTML = `
        <tr><td colspan="9">
            <div class="text-center" style="padding:12px;"><div class="loading-spinner" style="margin:0 auto;"></div> Loading employees…</div>
        </td></tr>`;

    const res = await apiCall('admin-users', 'GET', { user_id: currentUser.id });
    allAdminUsers = (res && res.success && Array.isArray(res.users)) ? res.users : [];

    // Clear search input on refresh
    const searchInput = document.getElementById('adminUsersSearch');
    if (searchInput) searchInput.value = '';

    renderAdminUsers(allAdminUsers);
}

function renderAdminUsers(users) {
    const tbody = document.getElementById('adminUsersList');
    document.getElementById('userCount').textContent = `(${users.length})`;

    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center" style="padding:40px; color:var(--gray-500)">No employees found. Make sure you have subordinates assigned to you.</td></tr>';
        return;
    }

    tbody.innerHTML = users.map(u => {
        let adminActions = '';
        if (currentUser.role === 'admin') {
            adminActions = `
                <button class="btn btn-secondary" onclick="startEditUser(${u.id})">Edit</button>
                <button class="btn" style="background:#ef4444;color:#fff" onclick="deleteUser(${u.id})">Delete</button>
            `;
        }

        // Check for birthday
        let birthdayAction = '';
        if (u.date_of_birth) {
            const dob = u.date_of_birth.split('-');
            const today = getCurrentISTDate();
            if (parseInt(dob[1]) === today.getMonth() + 1 && parseInt(dob[2]) === today.getDate()) {
                birthdayAction = `<button class="btn-wish" onclick="wishHappyBirthday(${u.id}, '${u.name.replace(/'/g, "\\'")}', '${u.gender || 'male'}')">Wish 🎂</button>`;
            }
        }

        const tasksHtml = (u.active_tasks && u.active_tasks.length > 0)
            ? u.active_tasks.map(t => `<div class="task-pill" onclick="event.stopPropagation(); openTaskDetail(${t.id})" style="font-size:11px; background:#f0f9ff; color:#0369a1; padding:2px 8px; border-radius:6px; margin-bottom:4px; border:1px solid #bae6fd; font-weight:500; white-space:normal; line-height:1.2; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.background='#e0f2fe'; this.style.borderColor='#7dd3fc';" onmouseout="this.style.background='#f0f9ff'; this.style.borderColor='#bae6fd';">${t.title}</div>`).join('')
            : `<div onclick="event.stopPropagation(); addNewTask(${u.id})" style="font-size:11px; color:#ef4444; font-weight:600; background:#fef2f2; padding:4px 8px; border-radius:6px; border:1px solid #fee2e2; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.background='#fee2e2'; this.style.borderColor='#fca5a5';" onmouseout="this.style.background='#fef2f2'; this.style.borderColor='#fee2e2;">⚠️ No Active Tasks</div>`;

        return `
            <tr>
                <td>${u.id}</td>
                <td><div style="font-weight:600;">${u.name || ''}</div> ${birthdayAction}</td>
                <td>${u.username || ''}</td>
                <td>${u.phone || ''}</td>
                <td><span class="badge" style="background:#f1f5f9; color:#475569;">${u.department || ''}</span></td>
                <td><span class="badge" style="background:#f8fafc; border:1px solid #e2e8f0;">${u.role || ''}</span></td>
                <td><div style="font-size:12px; color:#64748b;">${u.Mentor_name || '<small class="text-muted">None</small>'}</div></td>
                <td>
                    <span class="status-badge ${u.is_active !== false ? 'status-present' : 'status-absent'}" style="padding: 4px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">
                        ${u.is_active !== false ? 'Active' : 'Inactive'}
                    </span>
                </td>
                <td style="max-width:250px;">${tasksHtml}</td>
                <td style="white-space:nowrap;">
                    <div style="display:flex; gap:6px;">
                        <button class="btn btn-secondary" style="background:#3b82f6;color:#fff; padding:6px 10px; font-size:12px;" onclick="showEmployeePerformanceAnalysis(${u.id})">Stats</button>
                        <button class="btn btn-secondary" style="padding:6px 10px; font-size:12px;" onclick="viewEmployeeRecords(${u.id}, '${u.name}')">Records</button>
                        ${adminActions}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function filterAdminUsers() {
    const query = document.getElementById('adminUsersSearch').value.toLowerCase().trim();
    if (!query) {
        renderAdminUsers(allAdminUsers);
        return;
    }

    const filtered = allAdminUsers.filter(u =>
        (u.name && u.name.toLowerCase().includes(query)) ||
        (u.username && u.username.toLowerCase().includes(query)) ||
        (u.department && u.department.toLowerCase().includes(query)) ||
        (u.id && u.id.toString().includes(query)) ||
        (u.phone && u.phone.includes(query)) ||
        (u.is_active ? 'active' : 'inactive').includes(query)
    );
    renderAdminUsers(filtered);
}

/* Bulk Mentor Assignment */
let bulkMentorEmployees = [];
let bulkMentorPotentials = []; // Admins/Mentors

async function openAssignMentorModal() {
    openModal('assignMentorModal');
    const listEl = document.getElementById('assignMentorList');
    listEl.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:center; padding:40px; color:#64748b;">
            <span class="loading-spinner" style="border-top-color:#1e293b; margin-right:12px;"></span>
            <span style="margin-left:12px;">Fetching employee data...</span>
        </div>
    `;

    try {
        const res = await apiCall('employees-simple', 'GET');
        if (res && res.success && Array.isArray(res.employees)) {
            bulkMentorEmployees = res.employees;
            bulkMentorPotentials = res.employees; // 🔹 Populate ALL employees as potential Mentors
            renderAssignMentorList(bulkMentorEmployees);
        } else {
            listEl.innerHTML = `<div style="padding:40px;text-align:center;color:#991b1b;">Failed to load employees.</div>`;
        }
    } catch (e) {
        console.error('Fetch error', e);
        listEl.innerHTML = `<div style="padding:40px;text-align:center;color:#991b1b;">Error loading data.</div>`;
    }
}

function renderAssignMentorList(employees) {
    const listEl = document.getElementById('assignMentorList');
    if (!listEl) return;

    if (employees.length === 0) {
        listEl.innerHTML = `<div style="padding:40px;text-align:center;color:#64748b;">No employees found matching your search.</div>`;
        return;
    }

    listEl.innerHTML = employees.map(emp => `
        <div class="assign-Mentor-row" style="display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid #f1f5f9; background:white; transition:background 0.2s;">
            <div style="flex:1; min-width:0; margin-right:20px;">
                <div style="font-weight:600; color:#1e293b; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${emp.name}</div>
                <div style="font-size:0.8rem; color:#64748b; text-transform:uppercase; letter-spacing:0.5px;">${emp.role}</div>
            </div>
            
            <div style="flex:2; display:flex; gap:12px; align-items:center;">
                <div class="Mentor-select-container" style="flex:1; position:relative;">
                    <div class="bulk-Mentor-chips" id="chips-${emp.id}" style="display:flex; flex-wrap:wrap; gap:4px; min-height:42px; padding:6px 12px; border:1px solid #e2e8f0; border-radius:8px; cursor:pointer; background:white; align-items:center;" onclick="toggleMentorDropdown(${emp.id})">
                        ${renderMentorChips(emp.Mentor_ids || [])}
                        <span style="margin-left:auto; color:#94a3b8; font-size:10px;">▼</span>
                    </div>
                    <div class="bulk-Mentor-dropdown hidden" id="dropdown-${emp.id}" style="position:absolute; top:100%; left:0; width:100%; max-height:250px; overflow-y:auto; background:white; border:1px solid #e2e8f0; border-radius:8px; box-shadow:0 10px 15px -3px rgba(0,0,0,0.1); z-index:100; margin-top:4px; padding:4px;">
                        <input type="text" class="form-control" placeholder="Search Mentors..." style="height:34px; font-size:0.85rem; margin-bottom:8px; border-radius:6px; padding:0 8px;" oninput="filterMentorOptions(this, ${emp.id})" onclick="event.stopPropagation()">
                        <div class="Mentor-options" id="options-${emp.id}">
                            ${renderMentorOptions(emp.id, emp.Mentor_ids || [])}
                        </div>
                    </div>
                </div>
                <button class="btn btn-primary btn-sm" id="btn-save-${emp.id}" onclick="saveMentorsForEmployee(${emp.id})" style="height:42px; padding:0 16px; border-radius:8px; font-size:14px; min-width:80px;">
                    💾 Save
                </button>
            </div>
        </div>
    `).join('');
}

function renderMentorChips(MentorIds) {
    if (!MentorIds || MentorIds.length === 0) return `<span style="color:#94a3b8; font-size:0.85rem;">No Mentors</span>`;
    return MentorIds.map(id => {
        const mgr = bulkMentorPotentials.find(m => m.id === id);
        if (!mgr) return '';
        return `
            <div style="background:#eff6ff; color:#1e40af; padding:2px 8px; border-radius:4px; font-size:0.75rem; display:flex; align-items:center; gap:4px; border:1px solid #dbeafe; font-weight:500;">
                ${mgr.name}
            </div>
        `;
    }).join('');
}

function renderMentorOptions(empId, currentMentorIds, filter = '') {
    const Mentors = !filter ? bulkMentorPotentials : bulkMentorPotentials.filter(m => m.name.toLowerCase().includes(filter.toLowerCase()));

    if (Mentors.length === 0) return `<div style="padding:10px; text-align:center; color:#94a3b8; font-size:0.85rem;">No Mentors found</div>`;

    return Mentors.map(mgr => {
        const isChecked = currentMentorIds.includes(mgr.id);
        return `
            <div class="Mentor-option" style="display:flex; align-items:center; padding:8px 10px; cursor:pointer; border-radius:6px; transition:background 0.2s;" onclick="toggleMentorSelection(event, ${empId}, ${mgr.id})">
                <input type="checkbox" style="margin-right:10px; width:16px; height:16px; cursor:pointer;" ${isChecked ? 'checked' : ''} onclick="event.stopPropagation(); toggleMentorSelection(event, ${empId}, ${mgr.id})">
                <span style="font-size:0.85rem; color:#334155; user-select:none;">${mgr.name}</span>
            </div>
        `;
    }).join('');
}

function filterAssignMentorList() {
    const query = document.getElementById('assignMentorSearch').value.toLowerCase();
    const filtered = bulkMentorEmployees.filter(emp =>
        emp.name.toLowerCase().includes(query) ||
        emp.role.toLowerCase().includes(query)
    );
    renderAssignMentorList(filtered);
}

function filterMentorOptions(input, empId) {
    const emp = bulkMentorEmployees.find(e => e.id === empId);
    if (!emp) return;
    const optionsEl = document.getElementById(`options-${empId}`);
    if (optionsEl) {
        optionsEl.innerHTML = renderMentorOptions(empId, emp.Mentor_ids || [], input.value);
    }
}

function toggleMentorDropdown(empId) {
    const dropdown = document.getElementById(`dropdown-${empId}`);
    if (!dropdown) return;

    const isHidden = dropdown.classList.contains('hidden');

    // Close other dropdowns
    document.querySelectorAll('.bulk-Mentor-dropdown').forEach(d => d.classList.add('hidden'));

    if (isHidden) {
        dropdown.classList.remove('hidden');
        const searchInput = dropdown.querySelector('input');
        if (searchInput) {
            searchInput.value = '';
            searchInput.focus();
        }
    }
}

// Global click handler to close dropdowns
document.addEventListener('click', (e) => {
    if (!e.target.closest('.Mentor-select-container')) {
        document.querySelectorAll('.bulk-Mentor-dropdown').forEach(d => d.classList.add('hidden'));
    }
});

function toggleMentorSelection(event, empId, MentorId) {
    event.stopPropagation();
    const emp = bulkMentorEmployees.find(e => e.id === empId);
    if (!emp) return;

    if (!emp.Mentor_ids) emp.Mentor_ids = [];

    if (emp.Mentor_ids.includes(MentorId)) {
        emp.Mentor_ids = emp.Mentor_ids.filter(id => id !== MentorId);
    } else {
        emp.Mentor_ids.push(MentorId);
    }

    // Update chips
    const chipsEl = document.getElementById(`chips-${empId}`);
    if (chipsEl) {
        chipsEl.innerHTML = renderMentorChips(emp.Mentor_ids) + '<span style="margin-left:auto; color:#94a3b8; font-size:10px;">▼</span>';
    }

    // Update options list (to sync checkboxes)
    const optionsEl = document.getElementById(`options-${empId}`);
    if (optionsEl) {
        const searchInput = document.getElementById(`dropdown-${empId}`).querySelector('input');
        optionsEl.innerHTML = renderMentorOptions(empId, emp.Mentor_ids, searchInput ? searchInput.value : '');
    }
}

async function saveMentorsForEmployee(empId) {
    const emp = bulkMentorEmployees.find(e => e.id === empId);
    if (!emp) return;

    const btn = document.getElementById(`btn-save-${empId}`);
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span class="loading-spinner" style="width:14px; height:14px; border-width:2px; border-top-color:white;"></span>`;
    }

    try {
        const res = await apiCall(`admin-user/${empId}`, 'POST', {
            Mentor_ids: emp.Mentor_ids.length > 0 ? emp.Mentor_ids : ['none']
        });

        if (res && res.success) {
            showNotification(`Updated Mentors for ${emp.name}`, 'success');
            refreshAdminUsers(); // Update background tables
        } else {
            showNotification(res.message || 'Update failed', 'error');
        }
    } catch (e) {
        console.error('Save error', e);
        showNotification('An error occurred while saving', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `💾 Save`;
        }
    }
}

async function refreshMentorDropdown() {
    const sel = document.getElementById('newUserReportingMentor');
    if (!sel) return;
    try {
        const res = await apiCall('employees-simple', 'GET');
        if (res && res.success && Array.isArray(res.employees)) {
            // Filter for admins and Mentors
            const potentials = res.employees.filter(emp => emp.role === 'admin' || emp.role === 'Mentor');
            sel.innerHTML = '<option value="none">No Mentor</option>' +
                potentials.map(emp => `<option value="${emp.id}">${emp.name} (${emp.role})</option>`).join('');
        }
    } catch (e) {
        console.error('Failed to refresh Mentor dropdown', e);
    }
}

// Populate Primary Office dropdowns (signup + admin add user)
// index.html
async function refreshPrimaryOfficeSelects() {
    try {
        const res = await apiCall('offices', 'GET', { active: 1 });
        const offices = (res && res.success && Array.isArray(res.offices)) ? res.offices : [];

        const signupSel = document.getElementById('signupOffice');
        const adminSel = document.getElementById('newUserPrimaryOffice');
        const profileSel = document.getElementById('profilePrimaryOffice');

        const options = '<option value="">Select Office</option>' +
            offices.map(o => `<option value="${o.id}">${o.name}</option>`).join('');

        if (signupSel) signupSel.innerHTML = options;
        if (adminSel) adminSel.innerHTML = options;
        if (profileSel) profileSel.innerHTML = options;
    } catch (e) {
        console.error('Failed to refresh primary office selects', e);
    }
}

async function submitNewUser() {
    const msg = document.getElementById('addUserMsg');
    msg.textContent = '';

    const payload = {
        name: document.getElementById('newUserName').value.trim(),
        username: document.getElementById('newUserUsername').value.trim(),
        phone: document.getElementById('newUserPhone').value.trim(),
        email: document.getElementById('newUserEmail').value.trim(),
        department: document.getElementById('newUserDepartment').value,
        primary_office: document.getElementById('newUserPrimaryOffice').value,
        role: document.getElementById('newUserRole').value,
        mentor_id: document.getElementById('newUserReportingMentor').value,
        total_cl: document.getElementById('newUserTotalCL').value,
        taken_cl: document.getElementById('newUserTakenCL').value,
        is_active: document.getElementById('newUserIsActive').checked,
        date_of_joining: document.getElementById('newUserJoiningDate').value,
    };

    const passwordVal = document.getElementById('newUserPassword').value.trim();

    if (!adminUserEditId) {
        // creating -> password required
        if (!passwordVal) {
            msg.textContent = 'Password is required when creating a new user';
            return;
        }
        payload.password = passwordVal;
    } else {
        // editing -> password optional
        if (passwordVal) payload.password = passwordVal;
    }

    // required fields
    if (!payload.name || !payload.username || !payload.email || !payload.phone ||
        !payload.department || !payload.primary_office) {
        msg.textContent = 'Please fill all required fields';
        return;
    }

    let endpoint = 'register';
    if (adminUserEditId) endpoint = `admin-user/${adminUserEditId}`;

    const res = await apiCall(endpoint, 'POST', payload);

    if (res && res.success) {
        showNotification(adminUserEditId ? 'User updated' : 'User added');
        adminUserEditId = null;
        clearUserForm();
        await refreshAdminUsers();
    } else {
        msg.textContent = (res && res.message) || 'Failed to save user';
    }
}




function clearUserForm() {
    adminUserEditId = null;
    ['newUserName', 'newUserUsername', 'newUserPhone', 'newUserEmail', 'newUserPassword'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    document.getElementById('newUserDepartment').value = '';
    document.getElementById('newUserPrimaryOffice').value = '';
    document.getElementById('newUserRole').value = 'employee';
    document.getElementById('newUserReportingMentor').value = 'none';
    document.getElementById('newUserTotalCL').value = '12';
    document.getElementById('newUserTakenCL').value = '0';
    document.getElementById('newUserJoiningDate').value = '';
    document.getElementById('newUserIsActive').checked = true;
    const activeLabel = document.getElementById('newUserIsActiveLabel');
    if (activeLabel) activeLabel.textContent = 'Active';
    document.getElementById('addUserMsg').textContent = '';
}



async function startEditUser(id) {
    try {
        const res = await apiCall(`admin-user/${id}`, 'GET');
        if (!res || !res.success || !res.user) {
            showNotification('Failed to load user', 'error');
            return;
        }
        const u = res.user;
        adminUserEditId = u.id;

        // Fill the Add New User form so admin can edit inline
        document.getElementById('newUserName').value = u.name || '';
        document.getElementById('newUserUsername').value = u.username || '';
        document.getElementById('newUserPhone').value = u.phone || '';
        document.getElementById('newUserEmail').value = u.email || '';
        document.getElementById('newUserDepartment').value = u.department || '';
        document.getElementById('newUserPrimaryOffice').value = u.primary_office || '';
        document.getElementById('newUserRole').value = u.role || 'employee';
        document.getElementById('newUserReportingMentor').value = u.mentor_id || 'none';
        document.getElementById('newUserTotalCL').value = u.total_cl !== undefined ? u.total_cl : 12;
        document.getElementById('newUserTakenCL').value = u.taken_cl !== undefined ? u.taken_cl : 0;
        document.getElementById('newUserJoiningDate').value = u.date_of_joining || '';
        document.getElementById('newUserIsActive').checked = u.is_active !== false;
        const activeLabel = document.getElementById('newUserIsActiveLabel');
        if (activeLabel) activeLabel.textContent = u.is_active !== false ? 'Active' : 'Inactive';
        document.getElementById('newUserPassword').value = ''; // don't prefill password

        document.getElementById('addUserMsg').textContent = 'Editing user #' + u.id;
        // Scroll admin panel to the Add User card (optional nicety)
        document.getElementById('newUserName').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) {
        console.error('startEditUser error', e);
        showNotification('Error loading user', 'error');
    }
}



async function deleteUser(id) {
    if (!(await showConfirm('Delete this user?', 'Delete User', '👤'))) return;

    // Use apiCall which automatically handles the token
    let res = await apiCall(`admin-user/${id}`, 'DELETE');

    if (!res || res.success !== true) {
        // Fallback: POST with _method=DELETE in body
        res = await apiCall(`admin-user/${id}`, 'POST', { _method: 'DELETE' });
    }

    if (res && res.success) {
        showNotification('User deleted');
        await refreshAdminUsers();
    } else {
        showNotification((res && res.message) || 'Failed to delete user', 'error');
    }
}

function openProfile() {
    if (!currentUser) return;

    // Basic employee fields from employees table
    document.getElementById('profileName').value = currentUser.name || '';
    document.getElementById('profileEmail').value = currentUser.email || '';
    document.getElementById('profilePhone').value = currentUser.phone || '';
    document.getElementById('profileDepartment').value = currentUser.department || '';
    document.getElementById('profilePassword').value = '';

    // Set primary office if available
    if (currentUser.primary_office) {
        document.getElementById('profilePrimaryOffice').value = currentUser.primary_office;
    }

    document.getElementById('profileMsg').textContent = '';
    document.getElementById('profileDocsMsg').textContent = '';

    // reset document checkboxes & disable fields
    if (typeof resetDocCheckboxes === 'function') {
        resetDocCheckboxes();
    }

    showScreen('profileScreen');
    loadEmployeeProfile();
}
function setFieldValue(id, value) {
    const el = document.getElementById(id);
    if (!el) return;

    // Handle invalid MySQL dates
    if (
        el.type === 'date' &&
        (value === '0000-00-00' || value === null || value === undefined)
    ) {
        el.value = '';
        return;
    }

    el.value = value ?? '';
}


function getFieldValue(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
}


async function loadEmployeeProfile() {
    try {
        const res = await apiCall('employee-profile', 'GET', { employee_id: currentUser.id });
        if (!res || !res.success || !res.profile) return;

        const p = res.profile;
        setFieldValue('profilePersonalEmail', p.personal_email);
        setFieldValue('profileDob', p.date_of_birth);
        setFieldValue('profileGender', p.gender);
        setFieldValue('profileMaritalStatus', p.marital_status);
        setFieldValue('profileAlternateNumber', p.alternate_number);
        setFieldValue('profileEmergencyName', p.emergency_contact_name);
        setFieldValue('profileEmergencyPhone', p.emergency_contact_phone);
        setFieldValue('profileHomeAddress', p.home_address);
        setFieldValue('profileCurrentAddress', p.current_address);
        setFieldValue('profileDoj', p.date_of_joining);
        setFieldValue('profileReportingMgr', p.reporting_Mentor);

        setFieldValue('profileSkillSet', p.skill_set);

        // Sync personalization if returned (consistency check)
        if (p.avatar_emoji) {
            currentUser.avatar_emoji = p.avatar_emoji;
            renderAvatar(p.avatar_emoji, document.getElementById('userAvatar'));
        }
        if (p.theme_settings) {
            currentUser.theme_settings = p.theme_settings;
            applyUserTheme(p.theme_settings);
        }
        if (p.total_cl !== undefined) currentUser.total_cl = p.total_cl;
        if (p.taken_cl !== undefined) currentUser.taken_cl = p.taken_cl;
        
        sessionStorage.setItem('attendanceUser', JSON.stringify(currentUser));
        setFieldValue('profileProfessionalTraining', p.professional_training);
        setFieldValue('profileBankAccount', p.bank_account_number);
        setFieldValue('profileBankName', p.bank_name);
        setFieldValue('profileBankIfsc', p.bank_ifsc);
        setFieldValue('profileHighestQualification', p.highest_qualification);
        setFieldValue('profileQualificationNotes', p.qualification_notes);
        setFieldValue('profileFamilyDetails', p.family_details);
        setFieldValue('docAadharNumber', p.aadhar_number);
        setFieldValue('docPanNumber', p.pan_number);

        if (Array.isArray(p.documents)) {
            renderUserDocuments(p.documents);
        }
    } catch (e) {
        console.error('loadEmployeeProfile error', e);
    }
}

async function saveProfile() {
    if (!currentUser) return;

    const btnText = document.getElementById('profileSaveText');
    const spin = document.getElementById('profileSaveSpinner');
    const msg = document.getElementById('profileMsg');

    // ---- UI START ----
    btnText.classList.add('hidden');
    spin.classList.remove('hidden');
    msg.textContent = '';

    try {
        /* =======================
           1️⃣ BASIC USER UPDATE
           ======================= */

        const primaryOfficeValue =
            getFieldValue('profilePrimaryOffice') || currentUser.primary_office;

        const basePayload = {
            name: getFieldValue('profileName'),
            email: getFieldValue('profileEmail'),
            phone: getFieldValue('profilePhone'),
            department: currentUser.department,
            role: currentUser.role,
            is_active: 1,
            primary_office: primaryOfficeValue
        };

        const newPass = getFieldValue('profilePassword');
        if (newPass) {
            if (newPass.length < 6) {
                throw new Error('Password must be at least 6 characters');
            }
            basePayload.password = newPass;
        }

        const res1 = await apiCall(`admin-user/${currentUser.id}`, 'POST', basePayload);
        if (!res1 || !res1.success) {
            throw new Error(res1?.message || 'Failed to update basic profile');
        }

        /* =======================
           2️⃣ EXTENDED PROFILE UPDATE
           ======================= */

        /* =======================
           2️⃣ EXTENDED PROFILE UPDATE (FIXED)
           ======================= */

        const profilePayload = {
            employee_id: currentUser.id,
            personal_email: getFieldValue('profilePersonalEmail'),
            date_of_birth: getFieldValue('profileDob'),
            gender: getFieldValue('profileGender'),
            marital_status: getFieldValue('profileMaritalStatus'),
            alternate_number: getFieldValue('profileAlternateNumber'),
            emergency_contact_name: getFieldValue('profileEmergencyName'),
            emergency_contact_phone: getFieldValue('profileEmergencyPhone'),
            home_address: getFieldValue('profileHomeAddress'),
            current_address: getFieldValue('profileCurrentAddress'),
            date_of_joining: getFieldValue('profileDoj'),
            reporting_mentor: getFieldValue('profileReportingMgr'),
            skill_set: getFieldValue('profileSkillSet'),
            bank_account_number: getFieldValue('profileBankAccount'),
            bank_name: getFieldValue('profileBankName'),
            bank_ifsc: getFieldValue('profileBankIfsc'),
            highest_qualification: getFieldValue('profileHighestQualification'),
            qualification_notes: getFieldValue('profileQualificationNotes'),
            family_details: getFieldValue('profileFamilyDetails'),
            aadhar_number: getFieldValue('docAadharNumber'),
            pan_number: getFieldValue('docPanNumber')
        };

        const res2 = await apiCall('employee-profile', 'POST', profilePayload);

        if (!res2 || !res2.success) {
            throw new Error(res2?.message || 'Failed to update extended profile');
        }


        /* =======================
           3️⃣ LOCAL STATE UPDATE
           ======================= */

        currentUser = {
            ...currentUser,
            name: basePayload.name,
            email: basePayload.email,
            phone: basePayload.phone,
            primary_office: basePayload.primary_office
        };
        sessionStorage.setItem('attendanceUser', JSON.stringify(currentUser));

        showNotification('Profile updated successfully');
        msg.textContent = 'All details saved successfully.';

        // RE-CHECK Profile Completeness
        checkProfileCompleteness();

    } catch (err) {
        console.error('saveProfile error:', err);
        msg.textContent = err.message || 'Error updating profile';
        showNotification(msg.textContent, 'error');

    } finally {
        btnText.classList.remove('hidden');
        spin.classList.add('hidden');
    }
}


function hasAnyDocumentCheckboxSelected() {
    return (
        document.getElementById('chkDocIdentity')?.checked ||
        document.getElementById('chkDocAadhar')?.checked ||
        document.getElementById('chkDocPan')?.checked ||
        document.getElementById('chkDocOtherId')?.checked ||
        document.getElementById('chkQualHighest')?.checked ||
        document.getElementById('chkQualProfessional')?.checked ||
        document.getElementById('chkQualOther')?.checked
    );
}



async function uploadProfileDocuments() {
    if (!currentUser) return;

    const msg = document.getElementById('profileDocsMsg');
    msg.textContent = 'Uploading...';
    msg.style.color = 'var(--gray-600)';

    const usernameBase = (currentUser.username || currentUser.name || ('user' + currentUser.id)).toLowerCase().replace(/\s+/g, '');

    const formData = new FormData();
    formData.append('employee_id', currentUser.id);
    formData.append('username', usernameBase);

    let anySelected = false;
    let hasErrors = false;
    let identitySelected = false;
    // Helper to sanitize doc name for filename
    const sanitizeDocName = (s) => {
        if (!s) return '';
        return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
    };

    const MAX_SIZE = 3 * 1024 * 1024; // 3MB
    const validateFileSize = (file, label) => {
        if (file && file.size > MAX_SIZE) {
            msg.textContent = `${label} exceeds 3MB limit.`;
            msg.style.color = 'var(--error-color)';
            return false;
        }
        return true;
    };
    // Identity Documents
    if (document.getElementById('chkDocIdentity').checked) {

        const photoFile = document.getElementById('userPhotoFile').files[0];
        const signFile = document.getElementById('userSignatureFile').files[0];

        if (!photoFile && !signFile) {
            msg.textContent = 'Please select Photo or Signature.';
            msg.style.color = 'var(--error-color)';
            return;
        }

        if (photoFile) {
            if (!validateFileSize(photoFile, 'User Photo')) return;
            formData.append('user_photo', photoFile);
            anySelected = true;
        }
        if (signFile) {
            if (!validateFileSize(signFile, 'Signature')) return;
            formData.append('user_signature', signFile);
            anySelected = true;
        }
    }
    // Aadhaar
    if (document.getElementById('chkDocAadhar').checked) {
        const number = document.getElementById('docAadharNumber').value.trim();
        const file = document.getElementById('docAadharFile').files[0];

        if (!number || !file) {
            msg.textContent = 'Please enter Aadhaar number and choose Aadhaar file.';
            msg.style.color = 'var(--error-color)';
            hasErrors = true;
            return;
        }

        if (!validateFileSize(file, 'Aadhaar PDF')) return;

        anySelected = true;
        formData.append('doc[aadhar][name]', 'Aadhaar Card');
        formData.append('docAadharNumber', number);
        formData.append('file_aadhar', file);
        formData.append('file_aadhar_filename', `${usernameBase}_aadhar.pdf`);
    }

    // PAN
    if (document.getElementById('chkDocPan').checked) {
        const number = document.getElementById('docPanNumber').value.trim();
        const file = document.getElementById('docPanFile').files[0];

        if (!number || !file) {
            msg.textContent = 'Please enter PAN number and choose PAN file.';
            msg.style.color = 'var(--error-color)';
            hasErrors = true;
            return;
        }

        if (!validateFileSize(file, 'PAN PDF')) return;

        anySelected = true;
        formData.append('doc[pan][name]', 'PAN Card');
        formData.append('docPanNumber', number);
        formData.append('file_pan', file);
        formData.append('file_pan_filename', `${usernameBase}_pan.pdf`);
    }

    // Other ID
    if (document.getElementById('chkDocOtherId').checked) {
        const name = document.getElementById('docOtherIdName').value.trim();
        const number = document.getElementById('docOtherIdNumber').value.trim();
        const file = document.getElementById('docOtherIdFile').files[0];

        if (!name || !file) {
            msg.textContent = 'Please enter other document name and choose its file.';
            msg.style.color = 'var(--error-color)';
            hasErrors = true;
            return;
        }

        anySelected = true;
        const shortName = sanitizeDocName(name);
        formData.append('doc[other_id][name]', name);
        formData.append('doc[other_id][number]', number);
        formData.append('file_other_id', file);
        formData.append('file_other_id_filename', `${usernameBase}_${shortName}.pdf`);
    }

    // Highest Qualification
    if (document.getElementById('chkQualHighest').checked) {
        const name = document.getElementById('qualHighestName').value.trim();
        const number = document.getElementById('qualHighestNumber').value.trim();
        const file = document.getElementById('qualHighestFile').files[0];

        if (!name || !file) {
            msg.textContent = 'Please enter highest qualification name and choose the file.';
            msg.style.color = 'var(--error-color)';
            hasErrors = true;
            return;
        }

        if (!validateFileSize(file, 'Qualification Certificate')) return;

        anySelected = true;
        const shortName = 'highestqualification';
        formData.append('doc[highest_qualification][name]', name);
        formData.append('doc[highest_qualification][number]', number);
        formData.append('file_highest_qualification', file);
        formData.append('file_highest_qualification_filename', `${usernameBase}_${shortName}.pdf`);
    }

    // Professional Certificate
    if (document.getElementById('chkQualProfessional').checked) {
        const name = document.getElementById('qualProfessionalName').value.trim();
        const number = document.getElementById('qualProfessionalNumber').value.trim();
        const file = document.getElementById('qualProfessionalFile').files[0];

        if (!name || !file) {
            msg.textContent = 'Please enter professional certificate name and choose the file.';
            msg.style.color = 'var(--error-color)';
            hasErrors = true;
            return;
        }

        anySelected = true;
        const shortName = 'professionalcert';
        formData.append('doc[professional_certificate][name]', name);
        formData.append('doc[professional_certificate][number]', number);
        formData.append('file_professional_certificate', file);
        formData.append('file_professional_certificate_filename', `${usernameBase}_${shortName}.pdf`);
    }

    // Other Qualification
    if (document.getElementById('chkQualOther').checked) {
        const name = document.getElementById('qualOtherName').value.trim();
        const number = document.getElementById('qualOtherNumber').value.trim();
        const file = document.getElementById('qualOtherFile').files[0];

        if (!name || !file) {
            msg.textContent = 'Please enter other qualification document name and choose the file.';
            msg.style.color = 'var(--error-color)';
            hasErrors = true;
            return;
        }

        anySelected = true;
        const shortName = sanitizeDocName(name);
        formData.append('doc[other_qualification][name]', name);
        formData.append('doc[other_qualification][number]', number);
        formData.append('file_other_qualification', file);
        formData.append('file_other_qualification_filename', `${usernameBase}_${shortName}.pdf`);
    }

    if (!hasAnyDocumentCheckboxSelected()) {
        msg.textContent = 'Please select at least one document checkbox.';
        msg.style.color = 'var(--error-color)';
        return;
    }


    if (hasErrors) {
        return;
    }

    try {
        const url = apiBaseUrl + '/upload-documents';
        const gatedUrl = url + (window.GATED_TOKEN ? `?token=${encodeURIComponent(window.GATED_TOKEN)}` : '');
        const response = await fetch(gatedUrl, {
            method: 'POST',
            headers: {
                'X-Gated-Token': window.GATED_TOKEN || ''
            },
            body: formData
        });

        const result = await response.json().catch(() => null);

        if (result && result.success) {
            msg.textContent = result.message || 'Documents uploaded successfully.';
            msg.style.color = 'var(--success-color)';
            showNotification(result.message || 'Documents uploaded successfully', 'success');

            // Clear file inputs after successful upload
            document.querySelectorAll('input[type="file"]').forEach(input => {
                if (input.files.length > 0) {
                    input.value = '';
                }
            });

            // RE-CHECK Profile Completeness
            checkProfileCompleteness();
        } else {
            const errorMsg = (result && result.message) || 'Failed to upload documents. Please try again.';
            msg.textContent = errorMsg;
            msg.style.color = 'var(--error-color)';
            showNotification(errorMsg, 'error');
        }
    } catch (e) {
        console.error('uploadProfileDocuments error', e);
        msg.textContent = 'Network error. Please check your connection and try again.';
        msg.style.color = 'var(--error-color)';
        showNotification('Network error uploading documents.', 'error');
    }
    loadEmployeeProfile();
}
function renderUserDocuments(docs) {
    const grid = document.getElementById('myDocsGrid');
    const empty = document.getElementById('myDocsEmpty');

    if (!docs || docs.length === 0) {
        empty.style.display = 'block';
        grid.classList.add('hidden');
        return;
    }

    empty.style.display = 'none';
    grid.classList.remove('hidden');
    grid.innerHTML = '';

    docs.forEach(doc => {
        const isImage = doc.doc_type === 'photo' || doc.doc_type === 'signature';

        const preview = isImage
            ? `<img src="${doc.url}" class="doc-preview-img">`
            : `<div class="my-doc-icon">📄</div>`;

        const label =
            doc.doc_type === 'photo' ? 'Profile Photo' :
                doc.doc_type === 'signature' ? 'Signature' :
                    doc.doc_name || doc.file_name;

        const card = document.createElement('div');
        card.className = 'my-doc-card';

        // Secure URL with gated token
        const token = window.GATED_TOKEN || "";
        const secureUrl = doc.url + (token ? (doc.url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token) : '');

        card.innerHTML = `
            <input type="checkbox" class="my-doc-checkbox" value="${doc.id}">
            ${preview}
            <div class="my-doc-name">${label}</div>
            <div class="my-doc-actions">
                <a href="${secureUrl}" target="_blank">View</a>
                <a href="${secureUrl}" download>Download</a>
            </div>
        `;

        grid.appendChild(card);
    });
}

async function deleteSelectedDocuments() {
    const checked = [...document.querySelectorAll('.my-doc-checkbox:checked')]
        .map(c => c.value);

    if (checked.length === 0) {
        showNotification('Select documents to delete', 'warning');
        return;
    }

    if (!(await showConfirm('Delete selected documents?', 'Delete Documents', '🗑️'))) return;

    apiCall('delete-documents', 'POST', {
        document_ids: checked
    }).then(res => {
        if (res.success) {
            loadEmployeeProfile();
            showNotification('Documents deleted', 'success');
        }
    });
}

// Add this function near other export functions
function openExportModal() {
    // Admin only
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'Mentor')) {
        showNotification('Export feature is available for admin users only', 'warning');
        return;
    }

    // Default dates (current month)
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    document.getElementById('exportFromDate').value = formatDate(firstDayOfMonth);
    document.getElementById('exportToDate').value = formatDate(today);
    document.getElementById('exportError').style.display = 'none';

    // 🔹 POPULATE USERS HERE
    populateExportUsersDropdown();

    openModal('exportModal');
}
async function populateExportUsersDropdown() {
    const select = document.getElementById('exportUserSelect');
    if (!select) return;

    // Reset dropdown
    select.innerHTML = '<option value="all">All Employees</option>';

    try {
        const res = await apiCall('admin-users', 'GET', { user_id: currentUser.id });
        if (res && res.success && Array.isArray(res.users)) {
            res.users.forEach(u => {
                const opt = document.createElement('option');
                opt.value = u.id;
                opt.textContent = `${u.username} (${u.name})`;
                select.appendChild(opt);
            });
        }
    } catch (e) {
        console.error('Failed to load users for export dropdown', e);
    }
}


// Replace the entire exportToExcel function with this new version
async function confirmExport() {
    const fromDate = document.getElementById('exportFromDate')?.value;
    const toDate = document.getElementById('exportToDate')?.value;
    const errorDiv = document.getElementById('exportError');

    if (!fromDate || !toDate) {
        if (errorDiv) {
            errorDiv.textContent = 'Please select both dates';
            errorDiv.style.display = 'block';
        }
        return;
    }

    if (new Date(fromDate) > new Date(toDate)) {
        if (errorDiv) {
            errorDiv.textContent = 'From date cannot be after To date';
            errorDiv.style.display = 'block';
        }
        return;
    }

    const btn = document.getElementById('confirmExportBtn');
    const btnText = document.getElementById('exportBtnText');
    const spinner = document.getElementById('exportSpinner');
    const typeSelect = document.getElementById('exportTypeSelect');
    const selectedType = typeSelect ? typeSelect.value : 'all';

    if (btn) btn.disabled = true;
    if (btnText) btnText.classList.add('hidden');
    if (spinner) spinner.classList.remove('hidden');
    if (errorDiv) errorDiv.style.display = 'none';

    // --- SHOW PROGRESS MODAL ---
    const progressModal = document.getElementById('exportProgressModal');
    const progressBar = document.getElementById('exportProgressBar');
    const progressStatus = document.getElementById('exportProgressStatus');
    const progressCount = document.getElementById('exportProgressCount');
    const progressIcon = document.getElementById('exportProgressIcon');
    const progressTitle = document.getElementById('exportProgressTitle');

    if (progressModal) {
        progressBar.style.width = '0%';
        progressStatus.innerText = 'Fetching attendance records...';
        progressCount.innerText = '0% complete';
        progressIcon.innerText = '⏳';
        progressTitle.innerText = 'Exporting Attendance';
        openModal('exportProgressModal');
    }

    isExportAllCancelled = false; // Reset cancellation flag

    try {
        const params = {
            start_date: fromDate,
            end_date: toDate
        };

        if (selectedType && selectedType !== 'all') {
            params.type = selectedType;
        }

        params.user_id = currentUser.id;
        const res = await apiCall('attendance-records', 'GET', params);

        if (isExportAllCancelled) return;

        if (!res || !res.success || !Array.isArray(res.records)) {
            throw new Error('Failed to fetch attendance records');
        }

        const records = res.records;
        if (!records.length) {
            throw new Error('No records found for selected criteria');
        }

        if (progressStatus) progressStatus.innerText = 'Building attendance register...';
        if (progressBar) progressBar.style.width = '30%';

        /* ---------------- BUILD REGISTER (OPTIMIZED) ---------------- */

        const dateRange = getDateRange(fromDate, toDate);
        const employeeMap = {};

        records.forEach(r => {
            if (r.role === 'admin') return; // Skip Admin accounts

            if (!employeeMap[r.employee_id]) {
                employeeMap[r.employee_id] = {
                    employee: r.employee_name || r.name || `#${r.employee_id}`,
                    department: r.department || '',
                    type: (r.type || '').toUpperCase(),
                    office: r.office_name || '',
                    date_of_joining: r.date_of_joining,
                    attendance: {}
                };
            }

            const status = String(r.status || '').toLowerCase();
            let code = 'A';

            if (status === 'present') code = 'P';
            else if (status === 'half_day') code = 'HD';
            else if (status === 'wfh') code = 'WFH';
            else if (status === 'client') code = 'CL';
            else if (status === 'leave') code = 'Leave';
            else if (status === 'absent') code = 'A';

            // Detect missing checkout
            const forgotCheckOut = (r.check_in_time && !r.check_out_time);

            employeeMap[r.employee_id].attendance[r.date] = {
                code: forgotCheckOut ? 'A' : code,
                hours: parseFloat(r.total_hours || 0),
                forgotCheckOut: forgotCheckOut
            };
        });

        if (isExportAllCancelled) return;
        if (progressBar) progressBar.style.width = '50%';
        if (progressStatus) progressStatus.innerText = 'Generating Excel sheets...';

        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Attendance Register');

        /* ---------- HEADERS ---------- */

        const headers = [
            { header: 'Employee', key: 'employee', width: 22 },
            { header: 'Department', key: 'department', width: 16 },
            { header: 'Type', key: 'type', width: 10 },
            { header: 'Office', key: 'office', width: 20 }
        ];

        // Pre-calculate weekend labels and header keys
        const weekendMap = {};
        dateRange.forEach(d => {
            const dateObj = new Date(d);
            const day = dateObj.getDay();
            if (day === 0) weekendMap[d] = 'Sunday';
            else if (day === 6) weekendMap[d] = 'Saturday';

            headers.push({
                header: d.split('-').reverse().slice(0, 2).join('-'),
                key: d,
                width: 8
            });
        });

        ws.columns = headers;

        /* ---------- ROWS (CHUNIKED FOR PERFORMANCE) ---------- */

        const defaultStatus = (selectedType && selectedType !== 'all') ? '-' : 'A';
        const employeesList = Object.values(employeeMap);
        const totalEmployees = employeesList.length;

        // Visual styles map to avoid recreation
        const styles = {
            'P': { fill: 'FFC6EFCE', font: 'FF006100' },
            'HD': { fill: 'FFFFEB9C', font: 'FF9C6500' },
            'A': { fill: 'FFFFC7CE', font: 'FF9C0006' },
            'WFH': { fill: 'FFE4CCFF', font: 'FF330066' },
            'CL': { fill: 'FFDDEEFF', font: 'FF003399' },
            'Leave': { fill: 'FFFFD9E1', font: 'FF9C004C' }
        };

        for (let idx = 0; idx < totalEmployees; idx++) {
            if (isExportAllCancelled) break;
            const emp = employeesList[idx];

            const rowData = {
                employee: emp.employee,
                department: emp.department,
                type: emp.type,
                office: emp.office
            };

            // 1. Build Row Data
            dateRange.forEach(d => {
                const att = emp.attendance[d];
                let val = att ? att.code : (weekendMap[d] || defaultStatus);

                // If date is before Joining Date, show as '-' (Not Hired)
                if (emp.date_of_joining && d < emp.date_of_joining) {
                    val = '-';
                } else if (val === 'A' && weekendMap[d]) {
                    // Override weekday A with weekend label if applicable
                    val = weekendMap[d];
                }
                rowData[d] = val;
            });

            const row = ws.addRow(rowData);

            // 2. Apply Styles in Single Pass
            dateRange.forEach((d, i) => {
                const cell = row.getCell(5 + i);
                cell.alignment = { vertical: 'middle', horizontal: 'center' };

                const val = rowData[d];
                const att = emp.attendance[d];

                let s = styles[val];

                // Performance-based override for presence
                if (att && (val === 'P' || val === 'HD')) {
                    if (att.hours >= 8.5) s = styles['P'];
                    else if (att.hours >= 8) s = styles['HD'];
                }

                if (s) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: s.fill } };
                    cell.font = { color: { argb: s.font } };
                }

                // Forgot Check-out bold border
                if (att && att.forgotCheckOut) {
                    cell.border = {
                        top: { style: 'medium' },
                        left: { style: 'medium' },
                        bottom: { style: 'medium' },
                        right: { style: 'medium' }
                    };
                }
            });

            // Update progress and yield thread every 50 employees for much faster execution
            if (idx % 50 === 0 || idx === totalEmployees - 1) {
                const rowProgress = 50 + Math.round((idx / totalEmployees) * 40);
                if (progressBar) progressBar.style.width = `${rowProgress}%`;
                if (progressCount) progressCount.innerText = `${rowProgress}% complete`;
                // Non-blocking delay
                await new Promise(resolve => requestAnimationFrame(resolve));
            }
        }

        if (isExportAllCancelled) return;

        /* ---------- FORMATTING ---------- */
        ws.getRow(1).font = { bold: true };
        ws.views = [{ state: 'frozen', xSplit: 4, ySplit: 1 }];
        ws.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: 1, column: headers.length }
        };

        if (progressBar) progressBar.style.width = '95%';
        if (progressStatus) progressStatus.innerText = 'Finalizing file...';
        if (progressIcon) progressIcon.innerText = '📂';

        /* ---------- DOWNLOAD ---------- */

        const buffer = await wb.xlsx.writeBuffer();
        const filename = `attendance_register_${fromDate}_to_${toDate}.xlsx`;

        // SUCCESS UI
        if (progressBar) progressBar.style.width = '100%';
        if (progressStatus) progressStatus.innerText = 'Download started!';
        if (progressIcon) progressIcon.innerText = '✅';
        if (progressTitle) progressTitle.innerText = 'Export Ready';
        if (progressCount) progressCount.innerText = '100% complete';

        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);

        setTimeout(() => {
            if (progressModal) closeModal('exportProgressModal');
            showNotification('Attendance register exported successfully');
            closeModal('exportModal');
        }, 1500);

    } catch (e) {
        console.error(e);
        if (progressModal) closeModal('exportProgressModal');
        if (errorDiv) {
            errorDiv.textContent = e.message;
            errorDiv.style.display = 'block';
        }
        showNotification(e.message, 'error');
    } finally {
        if (btn) btn.disabled = false;
        if (btnText) btnText.classList.remove('hidden');
        if (spinner) spinner.classList.add('hidden');
    }
}


async function refreshAdminProfiles() {
    const box = document.getElementById('adminProfilesList');
    if (!box) return;

    box.innerHTML = `
        <div class="text-center" style="padding:12px;">
            <div class="loading-spinner" style="margin:0 auto;"></div> Loading user details…
        </div>`;

    const res = await apiCall('admin-profiles', 'GET', { user_id: currentUser.id });
    allAdminProfiles = (res && res.success && Array.isArray(res.profiles)) ? res.profiles.filter(p => p.role !== 'admin') : [];

    // Clear search input on refresh
    const searchInput = document.getElementById('adminProfilesSearch');
    if (searchInput) searchInput.value = '';

    box.innerHTML = renderProfilesTable(allAdminProfiles);
}

function filterAdminProfiles() {
    const query = document.getElementById('adminProfilesSearch').value.toLowerCase().trim();
    const box = document.getElementById('adminProfilesList');

    if (!query) {
        box.innerHTML = renderProfilesTable(allAdminProfiles);
        return;
    }

    const filtered = allAdminProfiles.filter(p =>
        (p.name && p.name.toLowerCase().includes(query)) ||
        (p.username && p.username.toLowerCase().includes(query)) ||
        (p.department && p.department.toLowerCase().includes(query)) ||
        (p.personal_email && p.personal_email.toLowerCase().includes(query)) ||
        (p.id && p.id.toString().includes(query)) ||
        (p.reporting_Mentor && p.reporting_Mentor.toLowerCase().includes(query))
    );
    box.innerHTML = renderProfilesTable(filtered);
}

function renderProfilesTable(profiles) {
    if (!profiles.length) {
        return '<p style="color:var(--gray-600)">No user profiles found.</p>';
    }

    const rows = profiles.map(p => {
        const missingDocs = (p.docs_count ?? 0) < 5;
        const missingFields = !p.name || !p.personal_email || !p.gender || !p.date_of_birth || !p.date_of_joining;

        const isIncomplete = missingDocs || missingFields;
        const rowClass = isIncomplete ? 'class="row-warning-incomplete"' : '';

        let reason = [];
        if (missingDocs) reason.push(`Missing documents (${p.docs_count}/5)`);
        if (missingFields) reason.push('Missing profile details');
        const titleAttr = isIncomplete ? `title="${reason.join(' & ')}"` : '';

        return `
        <tr ${rowClass} ${titleAttr}>
            <td>${p.id}</td>
            <td>${p.username || ''}</td>
            <td>${p.name || ''}</td>
            <td>${p.department || ''}</td>
            <td>${p.personal_email || ''}</td>
            <td>${p.gender || ''}</td>
            <td>${p.date_of_birth || ''}</td>
            <td>${p.date_of_joining || ''}</td>
            <td>${p.reporting_Mentor || ''}</td>

            <td style="white-space:nowrap;">
                <button class="btn btn-secondary" onclick="exportSingleProfileExcel(${p.id})">
                    Save Excel
                </button>
                <button class="btn btn-primary" onclick="openDocsPopup(${p.id}, '${p.username}')">
                     Get Docs
                </button>
            </td>
        </tr>
    `}).join('');

    return `
        <div style="overflow:auto; max-height:420px;">
            <table class="records-table">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Username</th>
                        <th>Name</th>
                        <th>Department</th>
                        <th>Personal Email</th>
                        <th>Gender</th>
                        <th>DOB</th>
                        <th>DOJ</th>
                        <th>Reporting Mentor</th>
                        <th>Export</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}
let currentDocsUserId = null;
let currentDocs = [];

async function openDocsPopup(userId, username) {
    currentDocsUserId = userId;
    currentDocsUsername = username;

    const res = await apiCall(
        `admin-user-docs-list/${userId}`,
        'GET'
    );

    if (!res || !res.success || !res.documents || res.documents.length === 0) {
        showNotification('No documents found', 'warning');
        return;
    }

    renderDocsModal(username, res.documents);
    showDocsModal();
}

function renderDocsModal(username, docs) {
    const list = document.getElementById('docsList');
    list.innerHTML = '';

    document.getElementById('docsModalTitle').innerText =
        `Documents of ${username}`;

    docs.forEach(doc => {
        const row = document.createElement('div');
        row.className = 'doc-row';

        const token = window.GATED_TOKEN || "";
        const secureUrl = doc.url + (token ? (doc.url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token) : '');

        row.innerHTML = `
            <label class="doc-item">
                <input type="checkbox" class="doc-check" value="${doc.id}">
                <span class="doc-name">${doc.doc_name}</span>
                <span class="doc-file">(${doc.file_name})</span>
            </label>
            <a class="doc-view" href="${secureUrl}" target="_blank">View</a>
        `;

        list.appendChild(row);
    });
}
function showDocsModal() {
    const modal = document.getElementById('docsModal');
    modal.classList.add('show');
}

function closeDocsModal() {
    const modal = document.getElementById('docsModal');
    modal.classList.remove('show');
}


async function downloadUserDocs(userId) {
    currentDocsUserId = userId;

    const res = await apiCall(`admin-user-docs-list/${userId}`, 'GET');

    if (!res || !res.success || !res.documents.length) {
        showNotification('No documents found', 'warning');
        return;
    }

    renderDocsModal(userId, res.documents); // userId used as fallback for username in this case
}

function downloadSelectedDocs() {
    if (!currentDocsUserId) return;

    const checked = Array.from(
        document.querySelectorAll('.doc-check:checked')
    );

    if (checked.length === 0) {
        showNotification('Please select at least one document', 'warning');
        return;
    }

    // Download ZIP (all docs for user)
    const token = window.GATED_TOKEN || "";
    window.location.href = apiBaseUrl + '/admin-user-docs/' + currentDocsUserId + (token ? '?token=' + encodeURIComponent(token) : '');

    closeDocsModal();
}



async function adminDeleteProfile(id) {
    if (!(await showConfirm('Delete extended profile details for this user?', 'Delete Profile', '👤'))) return;

    const res = await apiCall(`admin-profile/${id}`, 'DELETE');

    if (res && res.success) {
        showNotification('Profile deleted', 'success');
        await refreshAdminProfiles();
    } else {
        showNotification((res && res.message) || 'Failed to delete profile', 'error');
    }
}

async function adminEditProfile(id) {
    // Simple approach: load profile and open user-facing profile screen pre-filled
    try {
        const res = await apiCall(`admin-profile/${id}`, 'GET', {});
        if (!res || !res.success || !res.profile) {
            showNotification('Failed to load profile', 'error');
            return;
        }
        const p = res.profile;

        // Temporarily treat this as "currentUser" for editing (you can refine this later)
        currentUser = {
            ...currentUser,
            id: p.employee_id || p.id,
            name: p.name,
            username: p.username,
            email: p.official_email || p.email,
            phone: p.official_phone || p.phone,
            department: p.department || currentUser.department,
            role: currentUser.role // keep admin role
        };
        sessionStorage.setItem('attendanceUser', JSON.stringify(currentUser));

        openProfile();
        showNotification('Editing profile of ' + (p.name || 'User'));
    } catch (e) {
        console.error('adminEditProfile error', e);
        showNotification('Error loading profile', 'error');
    }
}

function exportProfilesToCsv() {
    const box = document.getElementById('adminProfilesList');
    const table = box.querySelector('table');
    if (!table) {
        showNotification('Nothing to export', 'warning');
        return;
    }

    let csv = [];
    const rows = table.querySelectorAll('tr');
    rows.forEach(row => {
        const cols = Array.from(row.querySelectorAll('th,td')).map(c =>
            '"' + (c.innerText || '').replace(/"/g, '""') + '"'
        );
        csv.push(cols.join(','));
    });

    const blob = new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'employee_profiles.csv';
    a.click();
    URL.revokeObjectURL(url);
}
async function exportSingleProfileExcel(employeeId) {
    try {
        const res = await apiCall(`admin-profile/${employeeId}`, 'GET', {});
        if (!res || !res.success || !res.profile) {
            showNotification('Failed to load profile for export', 'error');
            return;
        }

        const p = res.profile;

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Profile');

        const rows = [
            ['Employee ID', p.employee_id || p.id || ''],
            ['Username', p.username || ''],
            ['Full Name', p.name || ''],
            ['Official Email', p.official_email || p.email || ''],
            ['Personal Email', p.personal_email || ''],
            ['Department', p.department || ''],
            ['Mobile', p.official_phone || p.phone || ''],
            ['Gender', p.gender || ''],
            ['Date of Birth', p.date_of_birth || ''],
            ['Marital Status', p.marital_status || ''],
            ['Alternate Number', p.alternate_number || ''],
            ['Emergency Contact Name', p.emergency_contact_name || ''],
            ['Emergency Contact Phone', p.emergency_contact_phone || ''],
            ['Home Address', p.home_address || ''],
            ['Current Address', p.current_address || ''],
            ['Date of Joining', p.date_of_joining || ''],
            ['Reporting Mentor', p.reporting_Mentor || ''],
            ['Skill Set', p.skill_set || ''],
            ['Professional Training', p.professional_training || ''],
            ['Aadhaar Number', p.aadhar_number || ''],
            ['PAN Number', p.pan_number || ''],
            ['Bank Account Number', p.bank_account_number || ''],
            ['Bank Name', p.bank_name || ''],
            ['IFSC Code', p.bank_ifsc || ''],
            ['Highest Qualification', p.highest_qualification || ''],
            ['Qualification Notes', p.qualification_notes || ''],
            ['Family Details', p.family_details || '']
        ];

        rows.forEach(r => {
            const row = sheet.addRow(r);

            // Wrap text & align
            row.eachCell(cell => {
                cell.alignment = {
                    vertical: 'top',
                    horizontal: 'left',
                    wrapText: true
                };
            });

            row.height = 22;
        });
        // AUTO-FIT COLUMN WIDTH
        sheet.columns.forEach((column, index) => {
            // Column A (labels) — fixed width
            if (index === 0) {
                column.width = 25; // FORCE label width
                return;
            }

            // Other columns — auto-fit
            let maxLength = 12;

            column.eachCell({ includeEmpty: true }, cell => {
                const val = cell.value ? cell.value.toString() : '';
                maxLength = Math.max(maxLength, val.length);
            });

            // Cap width so Excel doesn't go crazy
            column.width = Math.min(maxLength + 2, 45);
        });

        // Make left column (labels) bold
        sheet.getColumn(1).font = { bold: true };

        // Add borders
        sheet.eachRow(row => {
            row.eachCell(cell => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
            });
        });


        const filename = (p.username || p.name || 'user') + '_profile.xlsx';

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);

        showNotification('Profile Excel downloaded');
    } catch (e) {
        console.error('exportSingleProfileExcel error', e);
        showNotification('Error exporting profile', 'error');
    }
}
function cancelExportAll() {
    isExportAllCancelled = true;
    showNotification('Export cancelled', 'warning');
    closeModal('exportProgressModal');
}

async function exportAllProfilesExcel() {
    try {
        if (!currentUser) {
            showNotification('You must be logged in to export profiles', 'warning');
            return;
        }

        // --- SHOW PROGRESS MODAL ---
        const progressModal = document.getElementById('exportProgressModal');
        const progressBar = document.getElementById('exportProgressBar');
        const progressStatus = document.getElementById('exportProgressStatus');
        const progressCount = document.getElementById('exportProgressCount');
        const progressIcon = document.getElementById('exportProgressIcon');
        const progressTitle = document.getElementById('exportProgressTitle');

        if (progressModal) {
            progressBar.style.width = '0%';
            progressStatus.innerText = 'Fetching profile list...';
            progressCount.innerText = 'Initializing...';
            progressIcon.innerText = '⏳';
            progressTitle.innerText = 'Generating Export';
            openModal('exportProgressModal');
        }

        // 1) get the list of users (IDs + usernames, etc.)
        const res = await apiCall('admin-profiles', 'GET', { user_id: currentUser.id });
        const profiles = (res && res.success && Array.isArray(res.profiles)) ? res.profiles : [];

        if (!profiles.length) {
            if (progressModal) closeModal('exportProgressModal');
            showNotification('No user profiles to export', 'warning');
            return;
        }

        const total = profiles.length;
        if (progressCount) progressCount.innerText = `0 / ${total} Profiles`;

        const workbook = new ExcelJS.Workbook();
        const usedSheetNames = new Set();
        isExportAllCancelled = false; // Reset flag at start

        // 2) for each user, fetch full profile via admin-profile/{id}
        let processed = 0;
        for (const summary of profiles) {
            if (summary.role === 'admin') continue;

            if (isExportAllCancelled) {
                console.log('Export cancelled by user.');
                return;
            }
            processed++;
            const id = summary.id;
            let p = summary;

            // Update Progress UI
            if (progressStatus) progressStatus.innerText = `Processing: ${p.username || p.name || 'User #' + id}`;
            if (progressBar) progressBar.style.width = `${Math.round((processed / total) * 100)}%`;
            if (progressCount) progressCount.innerText = `${processed} / ${total} Profiles`;

            try {
                const detailRes = await apiCall(`admin-profile/${id}`, 'GET', {});
                if (detailRes && detailRes.success && detailRes.profile) {
                    p = detailRes.profile;
                }
            } catch (e) {
                console.warn('Failed to load full profile for', id, e);
            }

            let baseName = (p.username || p.name || ('User' + id))
                .replace(/[\\\/\*\?\:\[\]]/g, '_')
                .substring(0, 25);

            if (!baseName) baseName = 'User';

            let sheetName = baseName;
            let counter = 1;
            while (Array.from(usedSheetNames).some(n => n.toLowerCase() === sheetName.toLowerCase())) {
                sheetName = (baseName.substring(0, 25) + '_' + counter);
                counter++;
            }
            usedSheetNames.add(sheetName);

            const sheet = workbook.addWorksheet(sheetName);

            const rows = [
                ['Employee ID', p.employee_id || p.id || ''],
                ['Username', p.username || ''],
                ['Full Name', p.name || ''],
                ['Official Email', p.official_email || p.email || ''],
                ['Personal Email', p.personal_email || ''],
                ['Department', p.department || ''],
                ['Mobile', p.official_phone || p.phone || ''],
                ['Gender', p.gender || ''],
                ['Date of Birth', p.date_of_birth || ''],
                ['Marital Status', p.marital_status || ''],
                ['Alternate Number', p.alternate_number || ''],
                ['Emergency Contact Name', p.emergency_contact_name || ''],
                ['Emergency Contact Phone', p.emergency_contact_phone || ''],
                ['Home Address', p.home_address || ''],
                ['Current Address', p.current_address || ''],
                ['Date of Joining', p.date_of_joining || ''],
                ['Reporting Mentor', p.reporting_Mentor || ''],
                ['Skill Set', p.skill_set || ''],
                ['Professional Training', p.professional_training || ''],
                ['Aadhaar Number', p.aadhar_number || ''],
                ['PAN Number', p.pan_number || ''],
                ['Bank Account Number', p.bank_account_number || ''],
                ['Bank Name', p.bank_name || ''],
                ['IFSC Code', p.bank_ifsc || ''],
                ['Highest Qualification', p.highest_qualification || ''],
                ['Qualification Notes', p.qualification_notes || ''],
                ['Family Details', p.family_details || '']
            ];

            rows.forEach(r => {
                const row = sheet.addRow(r);
                row.eachCell(cell => {
                    cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
                });
                row.height = 22;
            });

            sheet.columns.forEach((column, index) => {
                if (index === 0) {
                    column.width = 25;
                    return;
                }
                let maxLength = 12;
                column.eachCell({ includeEmpty: true }, cell => {
                    const val = cell.value ? cell.value.toString() : '';
                    maxLength = Math.max(maxLength, val.length);
                });
                column.width = Math.min(maxLength + 2, 45);
            });

            sheet.getColumn(1).font = { bold: true };
            sheet.eachRow(row => {
                row.eachCell(cell => {
                    cell.border = {
                        top: { style: 'thin' },
                        left: { style: 'thin' },
                        bottom: { style: 'thin' },
                        right: { style: 'thin' }
                    };
                });
            });
        }

        if (progressStatus) progressStatus.innerText = 'Finalizing Excel file...';
        if (progressIcon) progressIcon.innerText = '📂';

        // 3) download workbook
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });

        // Update Success UI before closing
        if (progressStatus) progressStatus.innerText = 'Download started!';
        if (progressIcon) progressIcon.innerText = '✅';
        if (progressTitle) progressTitle.innerText = 'Export Ready';

        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'all_user_profiles.xlsx';
        link.click();
        URL.revokeObjectURL(link.href);

        // Keep modal for a brief moment to show success
        setTimeout(() => {
            if (progressModal) closeModal('exportProgressModal');
            showNotification('All user profiles Excel downloaded');
        }, 1500);

    } catch (e) {
        console.error('exportAllProfilesExcel error', e);
        if (document.getElementById('exportProgressModal')) closeModal('exportProgressModal');
        const msg = (e && e.message) || 'Error exporting all profiles';
        showNotification(msg, 'error');
    }
}

// --- Interactive Calendar Requests ---

function toggleRequestPeriod() {
    const type = document.getElementById('requestType').value;
    const group = document.getElementById('requestPeriodGroup');
    if (group) {
        if (type === 'half_day') {
            group.classList.remove('hidden');
        } else {
            group.classList.add('hidden');
        }
    }
}

function openRequestModal(dateStr) {
    const input = document.getElementById('requestActionDate');
    const display = document.getElementById('requestActionDateDisplay');

    if (input) input.value = dateStr;

    if (display) {
        const dateObj = new Date(dateStr);
        display.textContent = dateObj.toLocaleDateString('default', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });
    }

    // Reset form
    const typeSelect = document.getElementById('requestType');
    if (typeSelect) {
        typeSelect.value = 'wfh';
        toggleRequestPeriod(); // Ensure correct state

        // Async check to hide Optional Holiday if user reached limit for the year (Jan-Dec)
        (async () => {
            try {
                if (!currentUser) return;
                const curYear = new Date().getFullYear();
                const statsRes = await apiCall('monthly-stats', 'GET', { 
                    employee_id: currentUser.id,
                    year: curYear,
                    month: new Date().getMonth() + 1
                });

                let optionalCount = 0;
                if (statsRes && statsRes.success && statsRes.stats) {
                    optionalCount = statsRes.stats.optional_holidays || 0;
                }

                const existingOpt = Array.from(typeSelect.options).find(opt => opt.value === 'optional_holiday');
                if (optionalCount >= 2) {
                    if (existingOpt) {
                        existingOpt.remove();
                    }
                } else {
                    if (!existingOpt) {
                        const opt = document.createElement('option');
                        opt.value = 'optional_holiday';
                        opt.textContent = 'Optional Holiday';
                        typeSelect.appendChild(opt);
                    }
                }
            } catch (e) {
                console.error("Failed to check optional holidays for dropdown:", e);
            }
        })();
    }

    const reasonInput = document.getElementById('requestReason');
    if (reasonInput) {
        reasonInput.value = '';
    }

    openModal('requestActionModal');
}

async function submitRequest() {
    const dateStr = document.getElementById('requestActionDate').value;
    const type = document.getElementById('requestType').value;
    const period = document.getElementById('requestPeriod') ? document.getElementById('requestPeriod').value : null;
    const reason = document.getElementById('requestReason').value;
    const btn = document.querySelector('#requestActionModal .btn-primary');

    if (!reason || reason.trim() === '') {
        showNotification('Please provide a reason', 'error');
        return;
    }

    showLoading("Submitting request...");
    try {
        if (btn) {
            btn.disabled = true;
            const originalText = btn.textContent;
            btn.textContent = 'Submitting...';
        }

        // Consolidated endpoint for all calendar requests
        let endpoint = 'leave-request';
        let body = {
            employee_id: currentUser ? currentUser.id : null,
            date: dateStr,
            type: type,
            reason: reason,
            period: (type === 'half_day') ? period : null
        };

        // Multi-date support
        if (isMultiSelectMode && selectedCalendarDates.length > 0 && dateStr === 'multiple') {
            body.dates = selectedCalendarDates;
            delete body.date;
        }

        const res = await apiCall(endpoint, 'POST', body);

        if (res && res.success) {
            showNotification(res.message || 'Request submitted successfully');
            closeModal('requestActionModal');

            // Reset multi-select state after success
            if (isMultiSelectMode && selectedCalendarDates.length > 0) {
                selectedCalendarDates = [];
                isMultiSelectMode = false;
                const toggle = document.getElementById('multiSelectToggle');
                if (toggle) toggle.checked = false;
                updateMultiSelectUI();
            }

            // Refresh calendar
            openAttendanceCalendar();
        } else {
            showNotification(res.message || 'Failed to submit request', 'error');
        }

    } catch (e) {
        console.error('submitRequest error', e);
        showNotification('Error submitting request', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Submit Request';
        }
        hideLoading();
    }
}


/* Mini Calendar Widget Logic (Async with Employee Data) */
async function generateMiniCalendar() {
    const container = document.getElementById("miniCalendarContainer");
    if (!container) return;

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    // Fetch attendance data and holidays for this month
    let statusMap = {};
    let holidayMap = {};
    if (currentUser) {
        try {
            // Format dates for API: YYYY-MM-DD
            const startDate = new Date(year, month, 1);
            const endDate = new Date(year, month + 1, 0);

            const [recordsRes, holidaysRes] = await Promise.all([
                apiCall("attendance-records", "GET", {
                    employee_id: currentUser.id,
                    start_date: formatDate(startDate),
                    end_date: formatDate(endDate)
                }),
                apiCall("holidays", "GET", {
                    year: year,
                    user_id: currentUser.id
                })
            ]);

            if (recordsRes && recordsRes.success && Array.isArray(recordsRes.data)) {
                recordsRes.data.forEach(record => {
                    statusMap[record.date] = record.status;
                });
            }

            if (holidaysRes && holidaysRes.success && Array.isArray(holidaysRes.holidays)) {
                holidaysRes.holidays.forEach(h => {
                    // Only show mandatory or user-selected optional holidays, but EXCLUDE working days
                    if ((!h.is_optional || h.user_selected) && !h.is_working_day) {
                        holidayMap[h.date] = h.name;
                    }
                });
            }
        } catch (e) {
            console.error("MiniCalendar data fetch error", e);
        }
    }


    const monthNames = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];

    // Header
    const headerHtml = `
        <div class="mini-cal-header">
            <span>${monthNames[month]} ${year}</span>
        </div>
    `;

    // Grid
    let gridHtml = "<div class=\"mini-cal-grid\">";

    // Day Names (S M T W T F S)
    const days = ["S", "M", "T", "W", "T", "F", "S"];
    days.forEach(d => {
        gridHtml += `<div class="mini-cal-day-name">${d}</div>`;
    });

    // Days
    const firstDay = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const today = now.getDate();

    // Empty cells
    for (let i = 0; i < firstDay; i++) {
        gridHtml += `<div class="mini-cal-day empty"></div>`;
    }

    // Days
    for (let i = 1; i <= totalDays; i++) {
        const isToday = (i === today);

        // Format date key YYYY-MM-DD for map lookup
        const dayStr = i.toString().padStart(2, "0");
        const monthStr = (month + 1).toString().padStart(2, "0");
        const dateKey = `${year}-${monthStr}-${dayStr}`;

        const status = statusMap[dateKey];
        const holidayName = holidayMap[dateKey];
        let statusClass = "";
        let titleText = holidayName ? `Holiday: ${holidayName}` : (status || "");

        if (holidayName) {
            // Holiday priority: if they worked, show status, but maybe different color?
            // User requested: renaming mandatory to holiday and showing on calendar.
            if (!status || status === "absent") statusClass = "status-holiday";
            else if (status) {
                if (status === "present") statusClass = "status-present";
                else if (status === "wfh") statusClass = "status-wfh";
                else if (status === "leave") statusClass = "status-leave";
                else if (status === "half_day") statusClass = "status-half-day";
            }
        } else if (status) {
            if (status === "present") statusClass = "status-present";
            else if (status === "wfh") statusClass = "status-wfh";
            else if (status === "absent") statusClass = "status-absent";
            else if (status === "leave") statusClass = "status-leave";
            else if (status === "half_day") statusClass = "status-half-day";
        }

        gridHtml += `<div class="mini-cal-day ${isToday ? "today" : ""} ${statusClass}" title="${titleText}">${i}</div>`;

    }

    gridHtml += "</div>";

    container.innerHTML = headerHtml + gridHtml;
}

// Initialize Mini Calendar
document.addEventListener("DOMContentLoaded", () => {
    generateMiniCalendar();
});

// Fallback execution
generateMiniCalendar();

function selectRequest(requestId) {
    if (!window.currentRequests) return;
    const req = window.currentRequests.find(r => r.id === requestId);
    if (!req) return;

    const detailContainer = document.getElementById('requestDetailContainer');
    if (!detailContainer) return;

    let typeLabel = req.type;
    if (req.type === 'wfh') typeLabel = 'Work from Home';
    else if (req.type === 'full_day') typeLabel = 'Full Day Leave';
    else if (req.type === 'half_day') typeLabel = 'Half Day Leave';

    const initials = req.employee_name ? req.employee_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : '??';

    // Highlight Active Card
    document.querySelectorAll('.req-card-tech').forEach(c => c.classList.remove('active'));
    const activeCard = document.getElementById(`req-card-${requestId}`);
    if (activeCard) activeCard.classList.add('active');

    detailContainer.innerHTML = `
        <div style="animation: slideInRight 0.4s cubic-bezier(0.165, 0.84, 0.44, 1) forwards; background: white; border: 1px solid #e2e8f0; border-radius: 20px; padding: 24px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.05); height: 100%; display: flex; flex-direction: column;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 24px;">
                <div style="display:flex; align-items:center; gap:16px;">
                    <div class="req-avatar-tech" style="width: 56px; height: 56px; border-radius: 16px; margin: 0; background: #eff6ff; color: #2563eb; display: flex; align-items: center; justify-content: center; font-weight: 700;">${initials}</div>
                    <div style="display:flex; flex-direction:column;">
                        <h4 style="margin:0; font-size:1.1rem; font-weight:800;">${req.employee_name}</h4>
                        <span style="font-size:0.8rem; color:#64748b;">@${req.username || 'user'}</span>
                    </div>
                </div>
                <button onclick="closeRequestDetail()" style="background:transparent; border:none; color:#94a3b8; cursor:pointer; font-size:1.2rem; transition: color 0.2s;">✕</button>
            </div>
            
            <div style="display:flex; flex-direction:column; gap:16px; flex: 1;">
                 <div style="background: #f8fafc; padding: 16px; border-radius: 16px;">
                    <span style="font-size: 0.75rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 8px;">Request Type</span>
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="req-badge ${req.type === 'wfh' ? 'badge-tech-wfh' : (req.type === 'unblock_attendance' ? 'badge-tech-blocked' : 'badge-tech-leave')}" style="padding: 8px 16px; border-radius: 10px; font-size: 0.9rem; font-weight: 700;">${typeLabel}</span>
                        ${req.status !== 'pending' ? `
                            <div style="text-align:right;">
                                <span class="premium-badge" style="background: ${req.status === 'approved' ? '#dcfce7' : '#fee2e2'}; color: ${req.status === 'approved' ? '#166534' : '#991b1b'}; border-radius: 8px; padding: 6px 14px; font-weight: 700; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.05em; display:inline-block; margin-bottom:4px;">${req.status}</span>
                                ${req.reviewed_by_name ? `<div style="font-size:0.7rem; color:#94a3b8; font-weight:600;">By ${req.is_Mentor ? 'Mentor: ' : ''}${req.reviewed_by_name}</div>` : ''}
                            </div>
                        ` : ''}
                    </div>
                </div>

                <div style="background: #f8fafc; padding: 16px; border-radius: 16px;">
                    <span style="font-size: 0.75rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 8px;">Selected Date</span>
                    <div style="display:flex; align-items:center; gap:8px; font-weight:700; color:#1e293b;">
                        <span style="font-size:1.2rem;">📅</span> ${req.date}
                    </div>
                </div>

                ${req.task_info ? `
                    <div style="background: #f0fdf4; padding: 16px; border-radius: 16px; border: 1px solid #bbf7d0;">
                        <span style="font-size: 0.75rem; font-weight: 700; color: #166534; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 8px;">Task Verification</span>
                        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 8px;">
                            <span style="font-size: 0.9rem; font-weight: 700; color: #1e293b;">${req.task_info.summary}</span>
                            <span style="font-size: 0.9rem; font-weight: 800; color: ${req.task_info.percent === 100 ? '#10b981' : '#f59e0b'};">${req.task_info.percent}%</span>
                        </div>
                        <div style="height: 8px; background: #dcfce7; border-radius: 10px; overflow: hidden;">
                            <div style="height: 100%; width: ${req.task_info.percent}%; background: ${req.task_info.percent === 100 ? '#10b981' : '#f59e0b'}; transition: width 0.3s ease;"></div>
                        </div>
                        <p style="font-size: 0.75rem; color: #166534; margin-top: 8px; font-weight: 500;">Review task completion before approval</p>
                    </div>
                ` : ''}

                ${req.reason ? `
                    <div style="background: #f8fafc; padding: 16px; border-radius: 16px;">
                        <span style="font-size: 0.75rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 8px;">Employee Reason</span>
                        <p style="margin:0; font-size:0.95rem; line-height:1.6; color:#334155; font-style: italic;">"${req.reason}"</p>
                    </div>
                ` : ''}
            </div>

            <div style="margin-top:24px; display:flex; gap:12px;">
                <button class="btn-tech btn-tech-approve" onclick="approveRequest(${req.id}, '${req.type}')" style="flex:1; height: 52px; border-radius: 16px; font-weight: 700; font-size: 1rem; display: flex; align-items: center; justify-content: center; gap: 8px;">
                    <span>✓</span> Approve
                </button>
                <button class="btn-tech btn-tech-reject" onclick="rejectRequest(${req.id}, '${req.type}')" style="flex:1; height: 52px; border-radius: 16px; font-weight: 700; font-size: 1rem; display: flex; align-items: center; justify-content: center; gap: 8px;">
                    <span>✕</span> Reject
                </button>
            </div>
        </div>
    `;
}


// Custom Rejection Modal Logic
function openRejectionModal(requestId) {
    return new Promise((resolve) => {
        const modal = document.getElementById('rejectionModal');
        const input = document.getElementById('rejectionReasonInput');
        const cancelBtn = document.getElementById('rejectionCancelBtn');
        const okBtn = document.getElementById('rejectionOkBtn');

        if (!modal || !input) {
            console.error('Rejection modal elements missing');
            resolve(null);
            return;
        }

        // Reset
        input.value = '';
        modal.classList.add('active');
        input.focus();

        const close = (val) => {
            modal.classList.remove('active');
            // Remove listeners to prevent memory leaks or duplicate triggers
            cancelBtn.removeEventListener('click', onCancel);
            okBtn.removeEventListener('click', onOk);
            input.removeEventListener('keydown', onKey);
            resolve(val);
        };

        const onCancel = () => close(null);
        const onOk = () => close(input.value.trim());
        const onKey = (e) => {
            if (e.key === 'Enter') onOk();
            if (e.key === 'Escape') onCancel();
        };

        cancelBtn.addEventListener('click', onCancel);
        okBtn.addEventListener('click', onOk);
        input.addEventListener('keydown', onKey);
    });
}

function closeRequestDetail() {
    const detailContainer = document.getElementById('requestDetailContainer');
    if (detailContainer) {
        detailContainer.innerHTML = `
            <div style="height: 100%; border: 2px dashed #e2e8f0; border-radius: 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px; text-align: center; color: #94a3b8;">
                <span style="font-size: 3rem; margin-bottom: 16px;">🔍</span>
                <p style="font-weight: 600; margin: 0; color: #64748b;">Select a request</p>
                <p style="font-size: 0.85rem; margin-top: 4px;">Click any card to review details</p>
            </div>
        `;
    }
    // Remove active state
    document.querySelectorAll('.req-card-tech').forEach(c => c.classList.remove('active'));
}


// ========== Intelligence Hub (Moved to predictive_card.js) ==========




function checkDueTomorrowReminders() {
    if (!myTasks || !myTasks.length) return;

    // Check if we already notified this session to avoid spam
    if (sessionStorage.getItem('due_reminders_shown')) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const urgentTasks = myTasks.filter(t => {
        if (!t.due_date || t.status === 'completed') return false;
        const due = new Date(t.due_date);
        due.setHours(0, 0, 0, 0);
        const diffTime = due - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays === 1;
    });

    if (urgentTasks.length > 0) {
        const msg = urgentTasks.length === 1 ?
            `"${urgentTasks[0].title}" is due tomorrow!` :
            `You have ${urgentTasks.length} tasks due tomorrow.`;

        showNotification(msg, 'warning');
        sessionStorage.setItem('due_reminders_shown', 'true');
    }
}

/* Multi-Select & Teams Logic */
let selectedEmployeeIds = [];
let selectedTeamMemberIds = [];
let selectedOverseerIds = []; // Added for overseer selection

// Multi-select for tasks
function toggleMultiSelect() {
    const dropdown = document.getElementById('multiSelectDropdown');
    dropdown.classList.toggle('show');
}

function toggleOverseerSelect() {
    const dropdown = document.getElementById('overseerDropdown');
    dropdown.classList.toggle('show');
}

function toggleTeamMemberSelect() {
    const dropdown = document.getElementById('teamMemberDropdown');
    dropdown.classList.toggle('show');
}

// Close dropdowns on outside click
window.onclick = function (event) {
    if (!event.target.closest('.multi-select-container')) {
        const dropdowns = document.getElementsByClassName('multi-select-dropdown');
        for (let i = 0; i < dropdowns.length; i++) {
            dropdowns[i].classList.remove('show');
        }
    }
}

function filterMultiSelect(val) {
    const query = val.toLowerCase();
    const options = document.querySelectorAll('#multiSelectOptionsList .multi-select-item');
    options.forEach(opt => {
        const text = opt.innerText.toLowerCase();
        opt.style.display = text.includes(query) ? 'flex' : 'none';
    });
}

function filterTeamMemberSelect(val) {
    const query = val.toLowerCase();
    const options = document.querySelectorAll('#teamMemberOptionsList .multi-select-item');
    options.forEach(opt => {
        const text = opt.innerText.toLowerCase();
        opt.style.display = text.includes(query) ? 'flex' : 'none';
    });
}

function filterOverseerSelect(val) {
    const query = val.toLowerCase();
    const options = document.querySelectorAll('#overseerOptionsList .multi-select-item');
    options.forEach(opt => {
        const text = opt.innerText.toLowerCase();
        opt.style.display = text.includes(query) ? 'flex' : 'none';
    });
}

function updateSelectedTags(containerId, ids, allEmployees, hiddenInputId, displayLabelId) {
    const display = document.getElementById(containerId);
    if (!ids.length) {
        display.innerHTML = '<span class="text-muted" style="font-size:0.9rem;">Select Employees...</span>';
    } else {
        display.innerHTML = ids.map(id => {
            const emp = allEmployees.find(e => e.id == id);
            return `
                <div class="selected-tag">
                    ${emp ? emp.name : id}
                    <span class="tag-remove" onclick="event.stopPropagation(); removeEmployeeTag('${containerId}', ${id})">×</span>
                </div>
            `;
        }).join('');
    }
    document.getElementById(hiddenInputId).value = JSON.stringify(ids);

    // Update checkboxes in dropdown
    let listId = 'multiSelectOptionsList';
    if (containerId === 'teamMemberDisplay') listId = 'teamMemberOptionsList';
    if (containerId === 'overseerDisplay') listId = 'overseerOptionsList';
    updateCheckboxesInDropdown(listId, ids);
}

function updateCheckboxesInDropdown(listId, ids) {
    const checkboxes = document.querySelectorAll(`#${listId} input[type="checkbox"]`);
    checkboxes.forEach(cb => {
        cb.checked = ids.includes(parseInt(cb.value));
    });
}

function removeEmployeeTag(containerId, id) {
    if (containerId === 'multiSelectDisplay') {
        selectedEmployeeIds = selectedEmployeeIds.filter(x => x != id);
        updateSelectedTags('multiSelectDisplay', selectedEmployeeIds, window.allEmployeesSimple || [], 'taskAssigneeIds');
    } else if (containerId === 'overseerDisplay') {
        selectedOverseerIds = selectedOverseerIds.filter(x => x != id);
        updateSelectedTags('overseerDisplay', selectedOverseerIds, window.allEmployeesSimple || [], 'taskOverseerIds');
    } else {
        selectedTeamMemberIds = selectedTeamMemberIds.filter(x => x != id);
        updateSelectedTags('teamMemberDisplay', selectedTeamMemberIds, window.allEmployeesSimple || [], 'newTeamMemberIds');
    }
}

function selectEmployee(id, type = 'assignee') {
    id = parseInt(id);
    if (type === 'team') {
        if (selectedTeamMemberIds.includes(id)) {
            selectedTeamMemberIds = selectedTeamMemberIds.filter(x => x != id);
        } else {
            selectedTeamMemberIds.push(id);
        }
        updateSelectedTags('teamMemberDisplay', selectedTeamMemberIds, window.allEmployeesSimple || [], 'newTeamMemberIds');
    } else if (type === 'overseer') {
        if (selectedOverseerIds.includes(id)) {
            selectedOverseerIds = selectedOverseerIds.filter(x => x != id);
        } else {
            selectedOverseerIds.push(id);
        }
        updateSelectedTags('overseerDisplay', selectedOverseerIds, window.allEmployeesSimple || [], 'taskOverseerIds');
    } else {
        if (selectedEmployeeIds.includes(id)) {
            selectedEmployeeIds = selectedEmployeeIds.filter(x => x != id);
        } else {
            selectedEmployeeIds.push(id);
        }
        updateSelectedTags('multiSelectDisplay', selectedEmployeeIds, window.allEmployeesSimple || [], 'taskAssigneeIds');
    }
}

async function loadTeams() {
    const select = document.getElementById('teamSelector');
    if (!select) return;

    try {
        const res = await apiCall('get-teams', 'GET', { Mentor_id: currentUser.id });
        if (res && res.success && Array.isArray(res.teams)) {
            window.allTeams = res.teams;
            select.innerHTML = '<option value="">Select Team...</option>' +
                res.teams.map(t => `<option value="${t.id}">${t.name} (${t.members.length} members)</option>`).join('');
        }
    } catch (e) {
        console.error('Error loading teams:', e);
    }
}

function applyTeamSelection() {
    const teamId = document.getElementById('teamSelector').value;
    const infoBox = document.getElementById('teamInfoBox');
    const editBtn = document.getElementById('editTeamBtn');

    if (!teamId) {
        if (infoBox) infoBox.style.display = 'none';
        if (editBtn) editBtn.disabled = true;
        return;
    }

    if (!window.allTeams) return;

    const team = window.allTeams.find(t => t.id == teamId);
    if (team) {
        if (editBtn) editBtn.disabled = false;

        // Show Info Box
        if (infoBox) {
            infoBox.style.display = 'block';
            document.getElementById('teamMemberCountLabel').innerText = `${team.members.length} Members`;
            document.getElementById('teamMemberNamesList').innerText = team.members.map(m => m.name).join(', ');
        }

        // Add all team members to selection (don't duplicate)
        if (team.members) {
            team.members.forEach(member => {
                if (!selectedEmployeeIds.includes(member.id)) {
                    selectedEmployeeIds.push(member.id);
                }
            });
            updateSelectedTags('multiSelectDisplay', selectedEmployeeIds, window.allEmployeesSimple || [], 'taskAssigneeIds');
        }
    }
}

function openEditTeamModal() {
    const teamId = document.getElementById('teamSelector').value;
    if (!teamId || !window.allTeams) return;

    const team = window.allTeams.find(t => t.id == teamId);
    if (!team) return;

    // Set Header and hidden ID
    document.getElementById('teamModalTitle').innerText = 'Edit Team';
    document.getElementById('editingTeamId').value = team.id;
    document.getElementById('newTeamName').value = team.name;

    // Show delete button
    const deleteBtn = document.getElementById('deleteTeamBtn');
    if (deleteBtn) deleteBtn.classList.remove('hidden');

    // Set members
    selectedTeamMemberIds = team.members.map(m => m.id);
    updateSelectedTags('teamMemberDisplay', selectedTeamMemberIds, window.allEmployeesSimple || [], 'newTeamMemberIds');

    // Update Button Text
    const saveBtn = document.getElementById('saveTeamBtn');
    if (saveBtn) saveBtn.innerText = 'Update Team';

    populateEmployeeListInDropdown('teamMemberOptionsList', true);
    openModal('createTeamModal');
}

function openCreateTeamModal() {
    document.getElementById('teamModalTitle').innerText = 'Create New Team';
    document.getElementById('editingTeamId').value = '';

    // Hide delete button
    const deleteBtn = document.getElementById('deleteTeamBtn');
    if (deleteBtn) deleteBtn.classList.add('hidden');

    // Update Button Text
    const saveBtn = document.getElementById('saveTeamBtn');
    if (saveBtn) saveBtn.innerText = 'Create Team';

    selectedTeamMemberIds = [];
    document.getElementById('newTeamName').value = '';
    updateSelectedTags('teamMemberDisplay', [], window.allEmployeesSimple || [], 'newTeamMemberIds');
    populateEmployeeListInDropdown('teamMemberOptionsList', true);
    openModal('createTeamModal');
}

async function saveNewTeam() {
    const name = document.getElementById('newTeamName').value.trim();
    const editingId = document.getElementById('editingTeamId').value;

    if (!name) {
        showNotification('Please enter a team name', 'error');
        return;
    }

    if (selectedTeamMemberIds.length === 0) {
        showNotification('Please select at least one member', 'error');
        return;
    }

    try {
        const endpoint = editingId ? 'update-team' : 'create-team';
        const payload = {
            name: name,
            Mentor_id: currentUser.id,
            members: selectedTeamMemberIds
        };
        if (editingId) payload.team_id = editingId;

        const res = await apiCall(endpoint, 'POST', payload);

        if (res && res.success) {
            showNotification(editingId ? 'Team updated successfully' : 'Team created successfully');
            closeModal('createTeamModal');
            await loadTeams();

            // If updated, refresh the current modal info
            if (editingId) applyTeamSelection();
        } else {
            showNotification(res.message || 'Failed to save team', 'error');
        }
    } catch (e) {
        console.error('Error saving team:', e);
        showNotification('Error saving team', 'error');
    }
}

async function deleteTeam() {
    const teamId = document.getElementById('editingTeamId').value;
    if (!teamId) return;

    if (!confirm('Are you sure you want to delete this team?')) return;

    try {
        const res = await apiCall('delete-team', 'POST', { team_id: teamId });
        if (res && res.success) {
            showNotification('Team deleted successfully');
            closeModal('createTeamModal');
            // Reset task modal selection
            document.getElementById('teamSelector').value = '';
            applyTeamSelection();
            await loadTeams();
        } else {
            showNotification(res.message || 'Failed to delete team', 'error');
        }
    } catch (e) {
        console.error('Error deleting team:', e);
        showNotification('Error deleting team', 'error');
    }
}

function populateEmployeeListInDropdown(listId, type = 'assignee') {
    const list = document.getElementById(listId);
    if (!list || !window.allEmployeesSimple) return;

    list.innerHTML = window.allEmployeesSimple.map(emp => `
        <div class="multi-select-item" onclick="selectEmployee(${emp.id}, '${type}')">
            <input type="checkbox" value="${emp.id}" onclick="event.stopPropagation(); selectEmployee(${emp.id}, '${type}')">
            <span>${emp.name} (${emp.role})</span>
        </div>
    `).join('');

    // Update checkboxes based on current selection
    let ids = selectedEmployeeIds;
    if (type === 'team') ids = selectedTeamMemberIds;
    if (type === 'overseer') ids = selectedOverseerIds;
    updateCheckboxesInDropdown(listId, ids);
}

function populateOverseerListInDropdown(listId) {
    populateEmployeeListInDropdown(listId, 'overseer');
}

// Map Modal Functions
window.openMapModal = function () {
    const modal = document.getElementById('mapModal');
    const record = window.currentAttendanceRecord;

    if (!modal || !record) return;

    modal.classList.add('active');

    // Initialize map if not exists or resize
    setTimeout(() => {
        if (!window.fullScreenMap) {
            window.fullScreenMap = new google.maps.Map(document.getElementById('fullMap'), {
                center: { lat: 20.5937, lng: 78.9629 },
                zoom: 4,
                mapTypeControl: true,
                streetViewControl: true,
                fullscreenControl: true
            });
        }

        const map = window.fullScreenMap;
        const markers = [];
        const bounds = new google.maps.LatLngBounds();

        const getMarkerIcon = (gender) => {
            let markerImage = '/static/images/marker-user.jpeg';
            if (gender === 'male') markerImage = '/static/images/marker-user.png';
            else if (gender === 'female') markerImage = '/static/images/marker-female.png';

            return {
                url: markerImage,
                scaledSize: new google.maps.Size(40, 40),
                anchor: new google.maps.Point(20, 20)
            };
        };

        // 1. Check-In Location
        if (record.check_in_location) {
            try {
                const loc = typeof record.check_in_location === 'string' ? JSON.parse(record.check_in_location) : record.check_in_location;
                const lat = loc.latitude || loc.lat;
                const lon = loc.longitude || loc.lon || loc.lng;
                if (lat && lon) {
                    const timeStr = record.check_in_time ? new Date(`1970-01-01T${record.check_in_time}`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                    const pos = { lat, lng: lon };
                    const marker = new google.maps.Marker({
                        position: pos,
                        map: map,
                        icon: getMarkerIcon(record.gender),
                        title: `Check In: ${timeStr}`
                    });
                    const info = new google.maps.InfoWindow({ content: `<b>Check In</b><br>${timeStr}` });
                    marker.addListener('click', () => info.open(map, marker));
                    markers.push(marker);
                    bounds.extend(pos);
                }
            } catch (e) { }
        }

        // 2. Check Out Location
        if (record.check_out_location) {
            try {
                const loc = typeof record.check_out_location === 'string' ? JSON.parse(record.check_out_location) : record.check_out_location;
                const lat = loc.latitude || loc.lat;
                const lon = loc.longitude || loc.lon || loc.lng;
                if (lat && lon) {
                    const timeStr = record.check_out_time ? new Date(`1970-01-01T${record.check_out_time}`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                    const pos = { lat, lng: lon };
                    const marker = new google.maps.Marker({
                        position: pos,
                        map: map,
                        icon: getMarkerIcon(record.gender),
                        title: `Check Out: ${timeStr}`
                    });
                    const info = new google.maps.InfoWindow({ content: `<b>Check Out</b><br>${timeStr}` });
                    marker.addListener('click', () => info.open(map, marker));
                    markers.push(marker);
                    bounds.extend(pos);
                }
            } catch (e) { }
        }

        if (markers.length > 0) {
            map.fitBounds(bounds);
        } else {
            map.setCenter({ lat: 20.5937, lng: 78.9629 });
            map.setZoom(4);
        }

    }, 100);
};

window.closeMapModal = function () {
    const modal = document.getElementById('mapModal');
    if (modal) modal.classList.remove('active');
};



/* ==========================================================================
   BIRTHDAY CELEBRATION LOGIC
   ========================================================================== */

async function checkBirthday() {
    if (!currentUser) return;

    // If birth date or gender is missing, try to fetch the profile to get it
    if (!currentUser.date_of_birth || currentUser.gender === undefined) {
        try {
            const res = await apiCall('employee-profile', 'GET', { employee_id: currentUser.id });
            if (res && res.success && res.profile) {
                currentUser.date_of_birth = res.profile.date_of_birth || currentUser.date_of_birth;
                currentUser.gender = res.profile.gender || null;
                sessionStorage.setItem('attendanceUser', JSON.stringify(currentUser));
            } else if (!currentUser.date_of_birth) {
                console.log("Birthday Mode: No DOB found in profile.");
                return;
            }
        } catch (e) {
            console.error("Error fetching profile for birthday check:", e);
            return;
        }
    }

    try {
        const dobStr = currentUser.date_of_birth; // YYYY-MM-DD
        if (!dobStr) return; // Skip if DOB not set
        const parts = dobStr.split('-');
        if (parts.length < 3) return;

        const dobMonth = parseInt(parts[1]) - 1; // 0-indexed
        const dobDay = parseInt(parts[2]);

        const today = new Date();
        const currentMonth = today.getMonth();
        const currentDate = today.getDate();

        console.log(`Birthday Check: User DOB = ${dobStr} (Month: ${dobMonth}, Day: ${dobDay}) vs Today (Month: ${currentMonth}, Day: ${currentDate})`);

        if (dobMonth === currentMonth && dobDay === currentDate) {
            console.log("🎉 Happy Birthday, " + currentUser.name + "! Activating Celebration Mode...");
            startBirthdayCelebration();
        }
    } catch (e) {
        console.error("Error checking birthday:", e);
    }
}

function startBirthdayCelebration() {
    const gender = (currentUser && currentUser.gender) ? currentUser.gender.toLowerCase() : 'other';
    let modeClass = 'birthday-mode-female';

    if (gender === 'male') {
        modeClass = 'birthday-mode-male';
    }

    document.documentElement.classList.add(modeClass);
    document.body.classList.add(modeClass);
    document.body.classList.add('birthday-mode-active');

    // SOCIAL TRIGGER: Poll notifications to trigger animation for recipient if wishes exist
    loadNotifications();
}

/**
 * SOCIAL FEATURE: Triggers flower petals and graffiti with rainbow premium sequence
 */
async function showBirthdayWishFX(message = "HAPPY BIRTHDAY!", gender = 'male') {
    const container = document.getElementById('birthdayFXContainer');
    if (!container) return;

    // 1. Create Overlay
    const overlay = document.createElement('div');
    overlay.className = 'birthday-graffiti-overlay';
    if (gender === 'female') overlay.classList.add('feminine');
    overlay.innerHTML = `
        <div class="graffiti-text"></div>
    `;
    container.appendChild(overlay);

    // CURATED PREMIUM PALETTES (Cream/Burgundy base + alternatives)
    const stickerPalettes = [
        { main: '#f5f1e3', shadow: '#8b0000' }, // Classic Vintage (Original)
        { main: '#e3f5f1', shadow: '#004d40' }, // Retro Mint & Forest
        { main: '#f5e3f1', shadow: '#4a148c' }, // Pastel Lavender & Royal Purple
        { main: '#fff9c4', shadow: '#e65100' }, // Sunshine Yellow & Deep Orange
        { main: '#e1f5fe', shadow: '#01579b' }, // Ice Blue & Navy
        { main: '#f1f8e9', shadow: '#33691e' }  // Sage Green & Dark Olive
    ];
    const selectedPalette = stickerPalettes[Math.floor(Math.random() * stickerPalettes.length)];

    // Prepare message containers for 2-line sticker layout
    const textTarget = overlay.querySelector('.graffiti-text');
    textTarget.style.flexDirection = 'column';
    textTarget.style.setProperty('--sticker-main', selectedPalette.main);
    textTarget.style.setProperty('--sticker-shadow', selectedPalette.shadow);

    const [namePart, ...wishParts] = message.split(':');
    const wishText = wishParts.join(':').trim() || "Wishing you a very Happy Birthday!";
    const fullLine1 = (namePart + (wishParts.length ? ":" : "")).trim();
    const fullLine2 = (wishText + " 🎂");

    const line1 = document.createElement('div');
    line1.className = 'graffiti-line name-line';
    const line2 = document.createElement('div');
    line2.className = 'graffiti-line wish-line';
    textTarget.appendChild(line1);
    textTarget.appendChild(line2);

    let charIndex = 0;

    // Helper to add characters to a line
    const addChars = (text, targetLine) => {
        Array.from(text).forEach(char => {
            const span = document.createElement('span');
            span.textContent = char === ' ' ? '\u00A0' : char;
            targetLine.appendChild(span);

            setTimeout(() => {
                span.classList.add('typed');
            }, 400 + (charIndex * 60)); // Faster 60ms per char for longer text
            charIndex++;
        });
    };

    addChars(fullLine1, line1);
    addChars(fullLine2, line2);

    const typingDuration = 400 + (charIndex * 60);

    // Initial sequence (instant text appearance)
    setTimeout(() => overlay.classList.add('active'), 100);

    // 2. Smooth Impact & Social FX (Triggered near text completion)
    setTimeout(() => {
        overlay.classList.add('shake');
        createSparkles(overlay, gender === 'female' ? 'feminine' : true);
        createFlowerPetals(gender === 'female' ? 'feminine' : true);
        setTimeout(() => overlay.classList.remove('shake'), 400);
    }, Math.max(1000, typingDuration - 400));

    // 3. Smooth Cleanup
    setTimeout(() => {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 1000);
    }, typingDuration + 1500);
}

function createSparkles(parent, theme = false) {
    const cyberColors = ['#00fff2', '#ff00ff', '#2d00ff', '#00f2ff', '#ff00d4'];
    const feminineColors = ['#ff9a9e', '#fecfef', '#feada6', '#ffc3a0', '#ff0080'];

    const isRainbow = theme === true;
    const isFeminine = theme === 'feminine';

    const colors = isFeminine ? feminineColors : (isRainbow ? cyberColors : ['#ffd700']);

    for (let i = 0; i < 30; i++) {
        const s = document.createElement('div');
        s.className = 'sparkle';
        s.style.left = '50%';
        s.style.top = '50%';

        const color = colors[Math.floor(Math.random() * colors.length)];
        s.style.color = color;
        s.style.backgroundColor = color;

        const angle = Math.random() * Math.PI * 2;
        const velocity = Math.random() * 150 + 100;
        const vx = Math.cos(angle) * velocity;
        const vy = Math.sin(angle) * velocity;

        parent.appendChild(s);

        s.animate([
            { transform: 'translate(-50%, -50%) scale(1.5)', opacity: 1 },
            { transform: `translate(calc(-50% + ${vx}px), calc(-50% + ${vy}px)) scale(0)`, opacity: 0 }
        ], {
            duration: 1200,
            easing: 'cubic-bezier(0.1, 0.8, 0.2, 1)'
        }).onfinish = () => s.remove();
    }
}

function createFlowerPetals(theme = false) {
    const container = document.getElementById('birthdayFXContainer');
    if (!container) return;

    const petalCount = 120;
    const cyberColors = ['#00fff2', '#ff00ff', '#2d00ff', '#00f2ff', '#ff00d4'];
    const feminineColors = ['#ff9a9e', '#fecfef', '#feada6', '#ffc3a0', '#fff0f5'];
    const neutralColors = ['#ffffff', '#fffdd0', '#f2e7d5', '#faf9f6'];

    const isRainbow = theme === true;
    const isFeminine = theme === 'feminine';

    const colors = isFeminine ? feminineColors : (isRainbow ? cyberColors : neutralColors);

    for (let i = 0; i < petalCount; i++) {
        setTimeout(() => {
            const petal = document.createElement('div');
            petal.className = 'petal';

            petal.style.left = Math.random() * 100 + 'vw';
            petal.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            petal.style.width = (Math.random() * 15 + 10) + 'px';
            petal.style.height = (Math.random() * 8 + 7) + 'px';
            petal.style.opacity = Math.random() * 0.8 + 0.2;

            // Soft floral fall for feminine, rapid for cyber
            let duration;
            if (isFeminine) {
                duration = Math.random() * 2 + 3; // 3-5s (elegant)
                petal.style.borderRadius = '50% 0 50% 50%'; // Leafy shape
            } else {
                duration = Math.random() * 0.5 + 0.8;
            }

            const delay = Math.random() * 0.2;
            petal.style.animationDuration = `${duration}s, 0.5s`;
            petal.style.animationDelay = `0s, ${delay}s`;

            container.appendChild(petal);
            setTimeout(() => petal.remove(), duration * 1000);
        }, i * (isFeminine ? 20 : 10));
    }
}

/**
 * Action to "Wish" an employee
 */
async function wishHappyBirthday(employeeId, employeeName, gender = 'male') {
    // Capture the name of the person wishing (current user)
    const wisherName = currentUser ? currentUser.name || currentUser.username : "Someone";

    // Construct the personalized message
    const message = `${wisherName} wishes you a very Happy Birthday`;

    // 1. Show FX locally for immediate feedback to sender
    showBirthdayWishFX(message, gender);

    // 2. Send actual wish notification to backend
    try {
        await apiCall('send-wish', 'POST', {
            sender_id: currentUser.id,
            receiver_id: employeeId,
            message: message
        });
        showNotification(`Best wishes sent to ${employeeName}! 🎉`, 'success');
    } catch (e) {
        console.error("Failed to send social wish:", e);
    }
}



/* Temporary Tags Management */

async function openTemporaryTagsModal() {
    openModal('temporaryTagsModal');
    await Promise.all([
        populateTempTagEmployeeDropdown(),
        loadTemporaryTags()
    ]);
}

let allTempTagEmployees = [];

async function populateTempTagEmployeeDropdown() {
    const select = document.getElementById('tempTagEmployee');
    if (!select) return;

    const res = await apiCall('admin-users', 'GET');
    allTempTagEmployees = (res && res.success && Array.isArray(res.users)) ? res.users : [];

    renderTempTagEmployeeOptions(allTempTagEmployees);
}

function renderTempTagEmployeeOptions(employees) {
    const select = document.getElementById('tempTagEmployee');
    if (!select) return;

    select.innerHTML = employees.map(e => `<option value="${e.id}">${e.username} (${e.name})</option>`).join('');
}

function filterTempTagEmployees() {
    const query = document.getElementById('tempTagSearchInput').value.toLowerCase();
    const filtered = allTempTagEmployees.filter(e =>
        e.username.toLowerCase().includes(query) ||
        e.name.toLowerCase().includes(query)
    );
    renderTempTagEmployeeOptions(filtered);
}

async function loadTemporaryTags() {
    const list = document.getElementById('temporaryTagsList');
    if (!list) return;

    list.innerHTML = '<tr><td colspan="6" class="text-center">Loading tags...</td></tr>';

    const res = await apiCall('temporary-tags', 'GET');
    const tags = (res && res.success && Array.isArray(res.tags)) ? res.tags : [];

    if (tags.length === 0) {
        list.innerHTML = '<tr><td colspan="6" class="text-center">No temporary tags found.</td></tr>';
        return;
    }

    list.innerHTML = tags.map(t => `
        <tr>
            <td>${t.employee_username}</td>
            <td>${t.department}</td>
            <td>${t.role}</td>
            <td>${t.start_date}</td>
            <td>${t.end_date}</td>
            <td>
                <button class="btn btn-subtle" onclick="deleteTemporaryTag(${t.id})" style="color: #ef4444;">Delete</button>
            </td>
        </tr>
    `).join('');
}

async function submitTemporaryTag() {
    const employeeId = document.getElementById('tempTagEmployee').value;
    const department = document.getElementById('tempTagDept').value;
    const role = document.getElementById('tempTagRole').value;
    const startDate = document.getElementById('tempTagStart').value;
    const endDate = document.getElementById('tempTagEnd').value;

    if (!employeeId || !department || !role || !startDate || !endDate) {
        showNotification('Please fill all fields', 'warning');
        return;
    }

    const res = await apiCall('temporary-tags', 'POST', {
        employee_id: employeeId,
        department: department,
        role: role,
        start_date: startDate,
        end_date: endDate
    });

    if (res && res.success) {
        showNotification('Temporary tag added successfully');
        await loadTemporaryTags();
        // Clear dates
        document.getElementById('tempTagStart').value = '';
        document.getElementById('tempTagEnd').value = '';
    } else {
        const errorMsg = res.message || (res.raw ? `Server Error: ${res.status}` : 'Failed to add tag');
        showNotification(errorMsg, 'error');
        if (res.raw) console.error("Server Error Details:", res.raw);
    }
}

async function deleteTemporaryTag(id) {
    if (!confirm('Are you sure you want to delete this temporary tag?')) return;

    const res = await apiCall('temporary-tags', 'DELETE', { id: id });

    if (res && res.success) {
        showNotification('Temporary tag deleted');
        await loadTemporaryTags();
    } else {
        showNotification('Failed to delete tag', 'error');
    }
}

/* Dashboard Personalization / Appearance */

function applyUserTheme(settings) {
    if (!settings) return;
    const root = document.documentElement;

    if (settings.primaryColor) {
        root.style.setProperty('--primary-color', settings.primaryColor);
        // Derived darker variants for gradients
        const dark = shadeColor(settings.primaryColor, -20);
        const darker = shadeColor(settings.primaryColor, -40);

        root.style.setProperty('--primary-dark', dark);
        root.style.setProperty('--primary-darker', darker);

        // Update background gradient
        root.style.setProperty('--gradient-start', settings.primaryColor);
        root.style.setProperty('--gradient-end', darker);
    }

    if (settings.gradientColors) {
        root.style.setProperty('--corner-tl', settings.gradientColors.tl);
        root.style.setProperty('--corner-tr', settings.gradientColors.tr);
        root.style.setProperty('--corner-bl', settings.gradientColors.bl);
        root.style.setProperty('--corner-br', settings.gradientColors.br);
        // Ensure gradient end follows for base/fallback
        root.style.setProperty('--gradient-end', settings.gradientColors.br);
    }

    if (settings.darkMode) {
        document.body.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
    }
}

// Helper to darken/lighten hex colors
function shadeColor(color, percent) {
    let R = parseInt(color.substring(1, 3), 16);
    let G = parseInt(color.substring(3, 5), 16);
    let B = parseInt(color.substring(5, 7), 16);

    R = parseInt(R * (100 + percent) / 100);
    G = parseInt(G * (100 + percent) / 100);
    B = parseInt(B * (100 + percent) / 100);

    R = (R < 255) ? R : 255;
    G = (G < 255) ? G : 255;
    B = (B < 255) ? B : 255;

    R = Math.round(R);
    G = Math.round(G);
    B = Math.round(B);

    const RR = ((R.toString(16).length == 1) ? "0" + R.toString(16) : R.toString(16));
    const GG = ((G.toString(16).length == 1) ? "0" + G.toString(16) : G.toString(16));
    const BB = ((B.toString(16).length == 1) ? "0" + B.toString(16) : B.toString(16));

    return "#" + RR + GG + BB;
}

// Render avatar (handles string emoji or URL)
async function renderAvatar(avatarStr, container) {
    if (!container) return;

    // 3D Avatar (GLB) URL
    if (avatarStr && avatarStr.includes('.glb')) {
        render3DAvatar(avatarStr, container, { width: container.clientWidth || 32, height: container.clientHeight || 32, interactive: false });
        return;
    }

    // Fallback to Image or Emoji
    if (avatarStr && (avatarStr.startsWith('http') || avatarStr.startsWith('/') || avatarStr.includes('avatars/'))) {
        const isHeader = container.id === 'userAvatar';
        const isPerfModal = container.id === 'perfModalAvatar';
        const size = isPerfModal ? '80px' : (isHeader ? '24px' : '100px');
        const zoom = (currentUser.theme_settings && currentUser.theme_settings.avatarZoom) || 1.0;
        const transform = `scale(${0.85 * zoom})`;

        let src = avatarStr;
        if (!src.startsWith('http') && !src.startsWith('/') && !src.startsWith('data:')) {
            src = '/media/' + src;
        }

        container.innerHTML = `<img src="${src}" style="width:${size}; height:${size}; vertical-align:middle; border-radius:50%; display:inline-block; border:1px solid rgba(255,255,255,0.2); object-fit:cover; transform: ${transform};">`;
    } else {
        const zoom = (currentUser.theme_settings && currentUser.theme_settings.avatarZoom) || 1.0;
        const textBg = (currentUser.theme_settings && currentUser.theme_settings.avatarTextBg) || '#3b82f6';

        if (avatarStr && avatarStr.length > 0 && avatarStr.length <= 3 && !isEmoji(avatarStr)) {
            container.style.background = textBg;
            container.style.color = '#fff';
            container.style.display = 'inline-flex';
            container.style.alignItems = 'center';
            container.style.justifyContent = 'center';
            container.style.fontWeight = 'bold';
            container.style.fontSize = avatarStr.length > 1 ? '14px' : '18px';
            container.innerText = avatarStr.toUpperCase();
        } else {
            container.style.background = 'transparent';
            container.innerHTML = `<span style="display:inline-block; transform: scale(${zoom});">${avatarStr || "👤"}</span>`;
        }
    }
}

let selectedEmoji = "👤";
let selectedColor = "#2563eb";
let selectedDarkMode = false;

async function openAppearanceModal() {
    openModal('appearanceModal');
    // Initial state from currentUser
    selectedEmoji = currentUser.avatar_emoji || "👤";
    selectedColor = (currentUser.theme_settings && currentUser.theme_settings.primaryColor) || "#2563eb";
    selectedDarkMode = (currentUser.theme_settings && currentUser.theme_settings.darkMode) || false;

    // Load advanced gradient colors
    if (currentUser.theme_settings && currentUser.theme_settings.gradientColors) {
        gradientColors = { ...currentUser.theme_settings.gradientColors };
    } else {
        // Fallback to default primary based gradient
        const darker = shadeColor(selectedColor, -40);
        gradientColors = {
            tl: selectedColor,
            tr: selectedColor,
            bl: darker,
            br: darker
        };
    }

    const dmToggle = document.getElementById('darkModeToggle');
    if (dmToggle) dmToggle.checked = selectedDarkMode;

    const avatarInput = document.getElementById('customAvatarInput');
    if (avatarInput) {
        avatarInput.value = (selectedEmoji !== "👤" && !selectedEmoji.startsWith('http')) ? selectedEmoji : "";
    }

    updateAppearancePreview();

    // Initialize Advanced Gradient UI
    // initHexColorGrid(); // Replaced by Advanced Color Picker
    refreshGradientPreview();
    setActiveCorner('tl');
}

/* Advanced Gradient Logic */
let activeCorner = 'tl';
let gradientColors = { tl: '#2563eb', tr: '#2563eb', bl: '#1e40af', br: '#1e40af' };

class AdvancedColorPicker {
    constructor(containerId, initialColor, onColorChange) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;
        this.onColorChange = onColorChange;
        this.color = initialColor || '#2563eb';
        this.h = 227;
        this.s = 100;
        this.v = 100;
        this.init();
    }

    init() {
        this.render();
        this.attachEvents();
        this.updateFromHex(this.color);
    }

    render() {
        this.container.innerHTML = `
            <div class="acp-wrapper">
                <div class="acp-spectrum" id="acpSpectrum">
                    <div class="acp-sat-white"></div>
                    <div class="acp-sat-black"></div>
                    <div class="acp-cursor" id="acpCursor"></div>
                </div>
                <div class="acp-controls">
                    <div class="acp-hue-slider">
                        <input type="range" min="0" max="360" value="${this.h}" class="acp-range" id="acpHue">
                    </div>
                    <div class="acp-inputs">
                        <div class="acp-hex-input">
                            <input type="text" id="acpHex" value="${this.color.toUpperCase()}" spellcheck="false">
                            <span class="acp-label">HEX</span>
                        </div>
                        <div class="acp-swatch" id="acpSwatch"></div>
                    </div>
                </div>
                <div class="acp-palettes">
                    <span class="acp-palette-label">SAVED PALETTES</span>
                    <div class="acp-palette-grid" id="acpPalettes">
                        <div class="acp-palette-item" style="background:#2563eb;"></div>
                        <div class="acp-palette-item" style="background:#7c3aed;"></div>
                        <div class="acp-palette-item" style="background:#10b981;"></div>
                        <div class="acp-palette-item" style="background:#f59e0b;"></div>
                        <div class="acp-palette-item" style="background:#ef4444;"></div>
                        <div class="acp-palette-item" style="background:#ec4899;"></div>
                        <div class="acp-palette-item" style="background:#1e293b;"></div>
                        <div class="acp-palette-item" style="background:#f8fafc;"></div>
                    </div>
                </div>
            </div>
        `;
    }

    attachEvents() {
        const spectrum = this.container.querySelector('#acpSpectrum');
        const hueSlider = this.container.querySelector('#acpHue');
        const hexInput = this.container.querySelector('#acpHex');
        const palettes = this.container.querySelector('#acpPalettes');

        spectrum.addEventListener('mousedown', e => this.handleSpectrumMove(e));
        hueSlider.addEventListener('input', e => {
            this.h = parseInt(e.target.value);
            this.update();
        });
        hexInput.addEventListener('change', e => {
            this.updateFromHex(e.target.value);
        });

        palettes.querySelectorAll('.acp-palette-item').forEach(item => {
            item.onclick = () => {
                const color = item.style.backgroundColor;
                const hex = this.rgbToHex(color);
                this.updateFromHex(hex);
            };
        });
    }

    handleSpectrumMove(e) {
        const move = e => {
            const rect = this.container.querySelector('#acpSpectrum').getBoundingClientRect();
            let x = e.clientX - rect.left;
            let y = e.clientY - rect.top;
            x = Math.max(0, Math.min(x, rect.width));
            y = Math.max(0, Math.min(y, rect.height));

            this.s = (x / rect.width) * 100;
            this.v = 100 - (y / rect.height) * 100;
            this.update();
        };

        const stop = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', stop);
        };

        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', stop);
        move(e);
    }

    update() {
        const hex = this.hsvToHex(this.h, this.s, this.v);
        this.color = hex;

        const spectrum = this.container.querySelector('#acpSpectrum');
        const swatch = this.container.querySelector('#acpSwatch');
        const hexInput = this.container.querySelector('#acpHex');
        const cursor = this.container.querySelector('#acpCursor');

        spectrum.style.backgroundColor = `hsl(${this.h}, 100%, 50%)`;
        swatch.style.backgroundColor = hex;
        hexInput.value = hex.toUpperCase();

        const rect = spectrum.getBoundingClientRect();
        cursor.style.left = `${this.s}%`;
        cursor.style.top = `${100 - this.v}%`;

        if (this.onColorChange) this.onColorChange(hex);
    }

    updateFromHex(hex) {
        if (!/^#([0-9A-F]{3}){1,2}$/i.test(hex)) return;
        this.color = hex;
        const hsv = this.hexToHsv(hex);
        this.h = hsv.h;
        this.s = hsv.s;
        this.v = hsv.v;

        const hueSlider = this.container.querySelector('#acpHue');
        if (hueSlider) hueSlider.value = this.h;

        this.update();
    }

    hsvToHex(h, s, v) {
        v /= 100;
        const s_val = s / 100;
        let r, g, b;
        const i = Math.floor(h / 60) % 6;
        const f = h / 60 - i;
        const p = v * (1 - s_val);
        const q = v * (1 - f * s_val);
        const t = v * (1 - (1 - f) * s_val);
        switch (i) {
            case 0: r = v; g = t; b = p; break;
            case 1: r = q; g = v; b = p; break;
            case 2: r = p; g = v; b = t; break;
            case 3: r = p; g = q; b = v; break;
            case 4: r = t; g = p; b = v; break;
            case 5: r = v; g = p; b = q; break;
        }
        const toHex = x => Math.round(x * 255).toString(16).padStart(2, '0');
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }

    hexToHsv(hex) {
        let r = parseInt(hex.slice(1, 3), 16) / 255;
        let g = parseInt(hex.slice(3, 5), 16) / 255;
        let b = parseInt(hex.slice(5, 7), 16) / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, v = max;
        const d = max - min;
        s = max === 0 ? 0 : d / max;
        if (max === min) h = 0;
        else {
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        return { h: h * 360, s: s * 100, v: v * 100 };
    }

    rgbToHex(rgb) {
        if (rgb.startsWith('#')) return rgb;
        const match = rgb.match(/\d+/g);
        if (!match) return '#000000';
        const toHex = x => parseInt(x).toString(16).padStart(2, '0');
        return `#${toHex(match[0])}${toHex(match[1])}${toHex(match[2])}`;
    }
}

let advancedColorPicker = null;

function initAdvancedColorPicker() {
    if (!advancedColorPicker) {
        advancedColorPicker = new AdvancedColorPicker('advancedColorPickerContainer', gradientColors[activeCorner], (color) => {
            updateCornerColor(color);
        });
    } else {
        advancedColorPicker.updateFromHex(gradientColors[activeCorner]);
    }
}

function toggleAdvancedColorPicker(show) {
    const popup = document.getElementById('advancedColorPickerPopup');
    if (!popup) return;

    if (show === undefined) show = !popup.classList.contains('active');

    if (show) {
        popup.classList.add('active');
        initAdvancedColorPicker();
    } else {
        popup.classList.remove('active');
    }
}

function setActiveCorner(corner) {
    activeCorner = corner;
    document.querySelectorAll('.corner-btn-premium').forEach(btn => {
        btn.classList.toggle('active', btn.classList.contains(corner));
    });
    // Update color picker if it's open
    if (advancedColorPicker) {
        advancedColorPicker.updateFromHex(gradientColors[activeCorner]);
    }
}

function updateCornerColor(color) {
    gradientColors[activeCorner] = color;
    refreshGradientPreview();
    // Apply immediately to body for real-time feel
    document.documentElement.style.setProperty(`--corner-${activeCorner}`, color);
    selectedColor = color; // Also update primary for compatibility
}

function refreshGradientPreview() {
    const preview = document.getElementById('gradientPreviewSmall');
    if (!preview) return;
    preview.style.background = `
        radial-gradient(at 0% 0%, ${gradientColors.tl} 0%, transparent 80%),
        radial-gradient(at 100% 0%, ${gradientColors.tr} 0%, transparent 80%),
        radial-gradient(at 0% 100%, ${gradientColors.bl} 0%, transparent 80%),
        radial-gradient(at 100% 100%, ${gradientColors.br} 0%, transparent 80%),
        ${gradientColors.br}
    `;
}

function updateAppearancePreview() {
    const preview = document.getElementById('prefAvatarPreview');
    if (!preview) return;

    // Clear preview
    preview.innerHTML = '';

    // 3D Avatar config takes precedence
    const cfg3d = currentUser && currentUser.avatar3d_config;
    if (cfg3d) {
        // Render saved DiceBear avatar as mini preview
        renderSavedAvatar(preview, cfg3d);
    } else if (currentUser && currentUser.avatar_url && !currentUser.avatar_url.includes('glb')) {
        // Render Custom Photo
        const zoom = (currentUser.theme_settings && currentUser.theme_settings.avatarZoom) || 1.0;
        const offX = (currentUser.theme_settings && currentUser.theme_settings.avatarOffsetX) || 0;
        const offY = (currentUser.theme_settings && currentUser.theme_settings.avatarOffsetY) || 0;

        let src = currentUser.avatar_url;
        if (!src.startsWith('http') && !src.startsWith('/') && !src.startsWith('data:')) {
            src = '/media/' + src;
        }

        preview.innerHTML = `<img src="${src}" style="width:100%; height:100%; border-radius:50%; object-fit:cover; transform: scale(${zoom}) translate(${offX}px, ${offY}px);">`;
    } else {
        const zoom = (currentUser.theme_settings && currentUser.theme_settings.avatarZoom) || 1.0;
        preview.innerHTML = `<span style="font-size: 64px; display:inline-block; transform: scale(${zoom});">${selectedEmoji || '👤'}</span>`;
    }

    // Update the emoji avatar button
    const btn = document.getElementById('customAvatarBtn');
    if (btn) {
        if (selectedEmoji && selectedEmoji !== '👤') {
            btn.textContent = selectedEmoji;
            btn.style.fontSize = '';
        } else {
            btn.textContent = '😀';
            btn.style.fontSize = '';
        }
    }

    // Update the 3D avatar button (Temporarily disabled as per user request)
    /*
    const btn3d = document.getElementById('create3DAvatarBtn');
    if (btn3d) {
        btn3d.innerHTML = cfg3d ? '✅' : '👤';
        btn3d.style.fontSize = cfg3d ? '28px' : '32px';
    }
    */
}


async function renderAvatarPreview(container) {
    if (!container) return;
    container.innerHTML = '<div class="loading-spinner"></div>';

    const layerSequence = [
        { cat: 'head', id: avatarState.headShape, color: null },
        { cat: 'skin', id: avatarState.skinTone, color: avatarState.skinColor },
        { cat: 'ears', id: avatarState.earsStyle, color: avatarState.skinColor },
        { cat: 'eyes', id: avatarState.eyesStyle, color: avatarState.eyesColor },
        { cat: 'brows', id: avatarState.browsStyle, color: avatarState.browsColor },
        { cat: 'nose', id: avatarState.noseStyle, color: null },
        { cat: 'mouth', id: avatarState.mouthStyle, color: avatarState.mouthColor },
        { cat: 'hairstyle', id: avatarState.hairStyle, color: avatarState.hairColor },
        { cat: 'facial_hair', id: avatarState.facialHair, color: avatarState.facialHairColor },
        { cat: 'eyewear', id: avatarState.eyewear, color: avatarState.eyewearColor },
        { cat: 'headwear', id: avatarState.headwear, color: avatarState.headwearColor },
        { cat: 'clothing', id: avatarState.clothing, color: avatarState.clothingColor }
    ];

    try {
        const layersPromise = layerSequence.map((layer, index) => {
            if (!layer.id || layer.id === 'none') return Promise.resolve('');
            return renderLayer(layer.cat, layer.id, layer.color, index + 1);
        });

        const renderedLayers = await Promise.all(layersPromise);
        container.innerHTML = renderedLayers.join('');
    } catch (err) {
        console.error("Error rendering preview:", err);
    }
}

function updateCustomAvatar(val) {
    selectedEmoji = val.trim() || "👤";
    updateAppearancePreview();
}

function toggleDarkModePreview() {
    const toggle = document.getElementById('darkModeToggle');
    if (toggle) {
        selectedDarkMode = toggle.checked;
        if (selectedDarkMode) {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
        }
    }
}

async function saveAppearanceSettings() {
    const msg = document.getElementById('appearanceMsg');
    msg.textContent = 'Saving preferences...';
    msg.style.color = '#64748b';

    try {
        const themeSettings = {
            ...currentUser.theme_settings,
            primaryColor: selectedColor,
            darkMode: selectedDarkMode,
            gradientColors: gradientColors
        };

        // Always sync avatar config to ensure it's cleared if deleted
        themeSettings.avatar_config = currentUser.avatar3d_config || null;

        const payload = {
            employee_id: currentUser.id,
            avatar_emoji: currentUser.avatar_emoji || selectedEmoji,
            theme_settings: themeSettings
        };

        // If we have a 3D avatar URL (legacy/GLB), include it
        if (currentUser.avatar_url) {
            payload.avatar_url = currentUser.avatar_url;
        }

        const res = await apiCall('employee-profile', 'POST', payload);

        if (res && res.success) {
            msg.textContent = 'Settings saved! 🎉';
            msg.style.color = '#10b981';

            // Update local user object
            currentUser.avatar_emoji = payload.avatar_emoji;
            currentUser.theme_settings = themeSettings;
            sessionStorage.setItem('attendanceUser', JSON.stringify(currentUser));

            // Apply changes immediately
            updateHeaderAvatar();
            applyUserTheme(themeSettings);

            setTimeout(() => closeModal('appearanceModal'), 1000);
        } else {
            msg.textContent = res.message || 'Failed to save settings';
            msg.style.color = '#ef4444';
        }
    } catch (e) {
        console.error("Save appearance error:", e);
        msg.textContent = 'An error occurred';
        msg.style.color = '#ef4444';
    }
}

function updateHeaderAvatar() {
    const avatarEl = document.getElementById('userAvatar');
    if (!avatarEl) return;

    // Clear
    avatarEl.innerHTML = '';

    const cfg3d = currentUser.avatar3d_config || (currentUser.theme_settings && currentUser.theme_settings.avatar_config);

    if (currentUser.avatar_url && !currentUser.avatar_url.includes('glb')) {
        // Custom Photo Avatar
        const img = document.createElement('img');
        let src = currentUser.avatar_url;
        if (!src.startsWith('http') && !src.startsWith('/') && !src.startsWith('data:')) {
            src = '/media/' + src;
        }
        img.src = src;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.borderRadius = '50%';

        const zoom = (currentUser.theme_settings && currentUser.theme_settings.avatarZoom) || 1.0;
        const offX = (currentUser.theme_settings && currentUser.theme_settings.avatarOffsetX) || 0;
        const offY = (currentUser.theme_settings && currentUser.theme_settings.avatarOffsetY) || 0;
        img.style.transform = `scale(${zoom}) translate(${offX}px, ${offY}px)`;

        avatarEl.style.overflow = 'hidden';
        avatarEl.appendChild(img);
    } else if (cfg3d) {
        // Render 3D Portrait in header
        renderSavedAvatar(avatarEl, cfg3d);
    } else if (currentUser.avatar_url) {
        // Legacy GLB support
        render3DAvatar(currentUser.avatar_url, avatarEl, { width: 40, height: 40, interactive: false });
    } else {
        const textBg = (currentUser.theme_settings && currentUser.theme_settings.avatarTextBg) || '#3b82f6';
        const emoji = currentUser.avatar_emoji || '👤';

        if (emoji.length > 0 && emoji.length <= 3 && !isEmoji(emoji)) {
            // Text Avatar Rendering
            avatarEl.style.background = textBg;
            avatarEl.style.color = '#fff';
            avatarEl.style.display = 'inline-flex';
            avatarEl.style.alignItems = 'center';
            avatarEl.style.justifyContent = 'center';
            avatarEl.style.fontWeight = 'bold';
            avatarEl.style.fontSize = emoji.length > 1 ? '14px' : '18px';
            avatarEl.innerText = emoji.toUpperCase();
        } else {
            avatarEl.style.background = 'transparent';
            avatarEl.innerHTML = emoji;
        }
    }
}

// Helper to check if string is a simple emoji (rough check)
function isEmoji(str) {
    const emojiRegex = /\p{Extended_Pictographic}/u;
    return emojiRegex.test(str);
}

/* ==================== APPLE-STYLE EMOJI PICKER ==================== */
const EMOJI_CATEGORIES = [
    {
        id: 'recent',
        name: 'Recent',
        icon: '🕒',
        emojis: ['👤', '👨‍💻', '👩‍💻', '🚀', '🌟']
    },
    {
        id: 'memoji',
        name: 'Memoji',
        icon: '👱‍♂️',
        emojis: [
            '/static/images/marker-user.png',
            '/static/images/marker-female.png',
            '👱🏻‍♂️', '👱🏼‍♀️', '👨🏽‍🦱', '👩🏾‍🦱', '👨🏿‍🦲', '🐭', '🐙', '🐮',
            '🦒', '🦈', '🦉', '🐗', '🐵', '🤖',
            '🐱', '🐶', '👽', '🦊', '💩', '🐷',
            '🐼', '🐰', '🐔', '🦄', '🦁', '🐲',
            '💀', '🐻', '🐯', '🐨', '🦖', '👻'
        ],
        hasCreateBtn: false
    },
    {
        id: 'smileys',
        name: 'Smileys',
        icon: '😀',
        emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '🥲', '☺️', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥸', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👹', '👺', '🤡', '💩', '👻', '💀', '👽', '👾', '🤖', '🎃', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾']
    },
    {
        id: 'animals',
        name: 'Animals',
        icon: '🐻',
        emojis: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐻‍❄️', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🐤', '🐣', '🐥', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🪱', '🐛', '🦋', '🐌', '🐞', '🐜', '🪰', '🪲', '🪳', '🦟', '🦗', '🕷', '🕸', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🦭', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧', '🦣', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🦬', '🐃', '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🦮', '🐕‍🦺', '🐈', '🐈‍⬛', '🪶', '🐓', '🦃', '🦤', '🦚', '🦜', '🦢', '🦩', '🕊', '🐇', '🦝', '🦨', '🦡', '🦫', '🦦', '🦥', '🐁', '🐀', '🐿', '🦔', '🐾', '🐉', '🐲', '🌵', '🎄', '🌲', '🌳', '🌴', '🪵', '🌱', '🌿', '☘️', '🍀', '🎍', '🪴', '🎋', '🍃', '🍂', '🍁', '🍄', '🐚', '🪨', '🌾', '💐', '🌷', '🌹', '🥀', '🌺', '🌸', '🌼', '🌻', '🌞', '🌝', '🌛', '🌜', '🌚', '🌕', '🌖', '🌗', '🌘', '🌑', '🌒', '🌓', '🌔', '🌙', '🌎', '🌍', '🌏', '🪐', '💫', '⭐️', '🌟', '✨', '⚡️', '☄️', '💥', '🔥', '🌪', '🌈', '☀️', '🌤', '⛅️', '🌥', '☁️', '🌦', '🌧', '⛈', '🌩', '🌨', '❄️', '☃️', '⛄️', '🌬', '💨', '💧', '💦', '☔️', '☂️', '🌊', '🌫']
    },
    {
        id: 'food',
        name: 'Food',
        icon: '🍔',
        emojis: ['🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶', '🫑', '🌽', '🥕', '🫒', '🧄', '🧅', '🥔', '🍠', '🥐', '🥯', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', '🧈', '🥞', '🧇', '🥓', '🥩', '🍗', '🍖', '🌭', '🍔', '🍟', '🍕', '🫓', '🥪', '🥙', '🧆', '🌮', '🌯', '🫔', '🥗', '🥘', '🫕', '🥫', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🦪', '🍤', '🍙', '🍚', '🍘', '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨', '🍦', '🥧', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '🌰', '🥜', '🍯', '🥛', '🍼', '🫖', '☕️', '🍵', '🧃', '🥤', '🧋', '🍶', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧉', '🍾', '🧊', '🥄', '🍴', '🍽', '🥣', '🥡', '🥢', '🧂']
    },
    {
        id: 'activities',
        name: 'Activity',
        icon: '⚽',
        emojis: ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸', '🥌', '🎿', '⛷', '🏂', '🪂', '🏋️', '🤼', '🤸', '⛹️', '🤺', '🤾', '🏌️', '🏇', '🧘', '🏄', '🏊', '🤽', '🚣', '🧗', '🚵', '🚴', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖', '🏵', '🎗', '🎫', '🎟', '🎪', '🤹', '🎭', '🩰', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🪘', '🎷', '🎺', '🪗', '🎸', '🪕', '🎻', '🎲', '♟', '🎯', '🎳', '🎮', '🎰', '🧩']
    }
];

let currentEmojiCategory = 'smileys';
let currentSegment = 'emoji';
let avatarSelectedSegment = 'emoji'; // emoji, photo, text
let avatarSelectedPhoto = null;
let avatarTextBg = '#3b82f6';

function openEmojiPicker() {
    closeModal('appearanceModal');
    openModal('emojiPickerModal');

    // Reset to defaults or load current
    avatarSelectedSegment = 'emoji';
    if (currentUser.avatar_url && !currentUser.avatar_url.includes('glb')) {
        avatarSelectedSegment = 'photo';
    } else if (currentUser.avatar_emoji && currentUser.avatar_emoji.length <= 2 && !isEmoji(currentUser.avatar_emoji)) {
        avatarSelectedSegment = 'text';
    }

    // Load existing settings
    if (currentUser.theme_settings) {
        if (currentUser.theme_settings.avatarTextBg) {
            avatarTextBg = currentUser.theme_settings.avatarTextBg;
        }
        if (currentUser.theme_settings.avatarZoom) {
            const slider = document.getElementById('emojiZoomSlider');
            if (slider) {
                slider.value = (currentUser.theme_settings.avatarZoom - 0.5) * 100;
            }
        }
    }

    selectAvatarSegment(avatarSelectedSegment);
}

function selectAvatarSegment(type) {
    avatarSelectedSegment = type;
    currentSegment = type; // Keep legacy variable in sync if used by renderers

    // Update buttons
    const btns = document.querySelectorAll('#emojiSegmentedControl button');
    btns.forEach(b => {
        const btnText = b.innerText.trim().toLowerCase();
        b.classList.remove('segment-active');
        if (btnText === type.toLowerCase()) b.classList.add('segment-active');
    });

    // Toggle sections
    document.getElementById('emojiGrid').classList.add('hidden');
    document.getElementById('emojiSidebar').classList.add('hidden');
    document.getElementById('photoAvatarSection').classList.add('hidden');
    document.getElementById('textAvatarSection').classList.add('hidden');

    if (type === 'emoji') {
        document.getElementById('emojiGrid').classList.remove('hidden');
        document.getElementById('emojiSidebar').classList.remove('hidden');

        // Render content
        renderEmojiSidebar();
        renderEmojiCategory(currentEmojiCategory || 'smileys');
        updateEmojiSidebarPreview(selectedEmoji || '👤');
    } else if (type === 'photo') {
        document.getElementById('photoAvatarSection').classList.remove('hidden');
        // If already has a photo, show it in preview
        if (currentUser.avatar_url && !currentUser.avatar_url.includes('glb')) {
            updateAvatarPreviewCircle(currentUser.avatar_url, true);
        } else {
            updateAvatarPreviewCircle('👤', false);
        }
    } else if (type === 'text') {
        document.getElementById('textAvatarSection').classList.remove('hidden');
        if (currentUser.avatar_emoji && !isEmoji(currentUser.avatar_emoji)) {
            document.getElementById('avatarTextInput').value = currentUser.avatar_emoji;
        }
        updateTextAvatarPreview();
    }
}

function updateAvatarPreviewCircle(content, isUrl = false) {
    const circle = document.getElementById('emojiPreviewCircle');
    if (!circle) return;

    circle.innerHTML = '';
    circle.style.position = 'relative';
    circle.style.overflow = 'hidden';

    if (isUrl) {
        const img = document.createElement('img');
        if (content.startsWith('data:')) {
            img.src = content;
        } else {
            let src = content;
            if (!src.startsWith('http') && !src.startsWith('/')) {
                src = '/media/' + src;
            }
            img.src = src;
        }
        img.id = 'innerEmojiPreview';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.cursor = 'move';
        img.style.position = 'absolute';
        img.style.left = '0';
        img.style.top = '0';
        img.draggable = false;

        // Apply existing zoom/offset if any
        const zoom = (currentUser.theme_settings && currentUser.theme_settings.avatarZoom) || 1.0;
        const offX = (currentUser.theme_settings && currentUser.theme_settings.avatarOffsetX) || 0;
        const offY = (currentUser.theme_settings && currentUser.theme_settings.avatarOffsetY) || 0;

        img.style.transform = `scale(${zoom}) translate(${offX}px, ${offY}px)`;

        // Pannable Logic
        let isDragging = false;
        let startX, startY;
        let currentX = offX, currentY = offY;

        const applyTransform = () => {
            const zoomVal = 0.5 + (document.getElementById('emojiZoomSlider').value / 100);
            // Translate first, then scale, to ensure pan is relative to image size
            img.style.transform = `translate(${currentX}px, ${currentY}px) scale(${zoomVal})`;
        };

        const onMouseMove = (e) => {
            if (!isDragging) return;
            // Adjust drag sensitivity based on zoom to feel more natural
            const zoomVal = 0.5 + (document.getElementById('emojiZoomSlider').value / 100);
            currentX = (e.clientX - startX);
            currentY = (e.clientY - startY);

            applyTransform();

            if (!currentUser.theme_settings) currentUser.theme_settings = {};
            currentUser.theme_settings.avatarOffsetX = currentX;
            currentUser.theme_settings.avatarOffsetY = currentY;
        };

        const onMouseUp = () => {
            isDragging = false;
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        img.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX - currentX;
            startY = e.clientY - currentY;
            circle.style.cursor = 'grabbing';
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });

        circle.appendChild(img);
    } else {
        circle.innerText = content;
        circle.style.display = 'flex';
        circle.style.alignItems = 'center';
        circle.style.justifyContent = 'center';
    }
}

/* Photo Upload Logic */
function previewAvatarPhoto(input) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        if (file.size > 2 * 1024 * 1024) {
            alert('Photo size exceeds 2MB limit');
            return;
        }

        avatarSelectedPhoto = file;
        const reader = new FileReader();
        reader.onload = function (e) {
            updateAvatarPreviewCircle(e.target.result, true);
        };
        reader.readAsDataURL(file);
    }
}

async function uploadAvatarPhoto() {
    if (!avatarSelectedPhoto) return true; // Nothing to upload, move on

    const formData = new FormData();
    formData.append('employee_id', currentUser.id);
    formData.append('photo', avatarSelectedPhoto);

    try {
        const res = await fetch('/api/upload-avatar', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (data.success) {
            currentUser.avatar_url = data.avatar_url;
            currentUser.avatar_emoji = '👤';
            delete currentUser.avatar3d_config;
            if (currentUser.theme_settings) delete currentUser.theme_settings.avatar_config;
            return true;
        } else {
            alert(data.message || 'Upload failed');
            return false;
        }
    } catch (e) {
        console.error("Photo upload error:", e);
        alert('Connection error during upload');
        return false;
    }
}

/* Text Avatar Logic */
function updateTextAvatarPreview() {
    const text = document.getElementById('avatarTextInput').value || 'Aa';
    const circle = document.getElementById('emojiPreviewCircle');
    if (!circle) return;

    circle.innerHTML = '';
    circle.style.display = 'flex';
    circle.style.alignItems = 'center';
    circle.style.justifyContent = 'center';
    circle.style.background = avatarTextBg;
    circle.style.color = '#fff';
    circle.style.fontSize = text.length > 1 ? '30px' : '50px';
    circle.style.fontWeight = 'bold';
    circle.innerText = text.toUpperCase();
}

function setTextAvatarBg(color) {
    avatarTextBg = color;
    updateTextAvatarPreview();
}

async function confirmEmojiSelection() {
    const saveBtn = document.querySelector('#emojiPickerModal .btn-primary');
    const originalText = saveBtn.innerText;
    saveBtn.innerText = 'Saving...';
    saveBtn.disabled = true;

    try {
        if (avatarSelectedSegment === 'photo') {
            const success = await uploadAvatarPhoto();
            if (!success) throw new Error('Upload failed');
        } else if (avatarSelectedSegment === 'text') {
            const text = document.getElementById('avatarTextInput').value.trim();
            if (!text) {
                alert('Please enter some text');
                throw new Error('Empty text');
            }
            currentUser.avatar_emoji = text;
            currentUser.avatar_url = null;
            currentUser.avatar3d_config = null;
            if (!currentUser.theme_settings) currentUser.theme_settings = {};
            currentUser.theme_settings.avatarTextBg = avatarTextBg;
        } else {
            // Regular Emoji
            currentUser.avatar_url = null;
            currentUser.avatar3d_config = null;
            if (!currentUser.theme_settings) currentUser.theme_settings = {};
            // selectedEmoji is set by selectEmoji() globally
            currentUser.avatar_emoji = selectedEmoji || '👤';
        }

        // Sync global selectedEmoji to match current segment's choice
        selectedEmoji = currentUser.avatar_emoji;

        // Capture zoom factor from slider
        const slider = document.getElementById('emojiZoomSlider');
        if (slider) {
            if (!currentUser.theme_settings) currentUser.theme_settings = {};
            currentUser.theme_settings.avatarZoom = 0.5 + (slider.value / 100);
        }

        // Re-save overall profile to sync metadata
        await saveAppearanceSettings();

        closeModal('emojiPickerModal');
        openModal('appearanceModal');
    } catch (e) {
        console.error("Confirm selection error:", e);
    } finally {
        saveBtn.innerText = originalText;
        saveBtn.disabled = false;
    }
}

/* ==================== CARTOON AVATAR GENERATOR (DiceBear API) ==================== */
let current3DConfig = null;
let avatar3DRenderer = null; // kept for backward compat

// Style categories shown in the sidebar
const AVATAR_STYLE_GROUPS = [
    { id: 'adventurer', label: '✨ 3D Disney', icon: '🧑' },
    { id: 'lorelei', label: '🎨 Pixar', icon: '👩' },
    { id: 'notionists', label: '✏️ Sketch', icon: '🖊️' },
    { id: 'big-smile', label: '😁 Expressive', icon: '😄' },
    { id: 'fun-emoji', label: '🎭 Movie', icon: '🎭' },
    { id: 'avataaars', label: '👕 Casual', icon: '👤' },
];

let avatarCurrentStyle = AVATAR_STYLE_GROUPS[0].id;
let avatarCurrentSeeds = []; // 20 random seeds shown in the grid

function openCreateMemoji() {
    openModal('createMemojiModal');
    _buildAvatarPickerUI();
}

function closeCreateMemoji() {
    closeModal('createMemojiModal');
}

function _buildAvatarPickerUI() {
    _renderAvatarStyleSidebar();
    _generateAvatarSeeds();
    _renderAvatarGrid();
}

function _renderAvatarStyleSidebar() {
    const sidebar = document.getElementById('avatarStyleSidebar');
    if (!sidebar) return;
    sidebar.innerHTML = AVATAR_STYLE_GROUPS.map(g => `
        <div class="emoji-cat${g.id === avatarCurrentStyle ? ' active' : ''}"
             onclick="selectAvatarStyle('${g.id}')"
             title="${g.label}"
             style="font-size:20px; cursor:pointer;">
            ${g.icon}
        </div>`).join('');

    // Update segmented control
    const ctrl = document.getElementById('avatarSegmentedControl');
    if (ctrl) {
        ctrl.innerHTML = AVATAR_STYLE_GROUPS.map(g => `
            <button class="${g.id === avatarCurrentStyle ? 'segment-active' : ''}"
                    onclick="selectAvatarStyle('${g.id}')">
                ${g.label}
            </button>`).join('');
    }
}

function _generateAvatarSeeds() {
    avatarCurrentSeeds = Array.from({ length: 20 }, () =>
        Math.random().toString(36).slice(2) + Date.now().toString(36)
    );
}

function _renderAvatarGrid() {
    const grid = document.getElementById('avatarGrid');
    if (!grid) return;
    grid.innerHTML = '';

    avatarCurrentSeeds.forEach((seed, idx) => {
        const card = document.createElement('div');
        card.style.cssText = `cursor:pointer; border-radius:50%; overflow:hidden; aspect-ratio:1;
            border: 3px solid transparent; transition: border-color 0.2s, transform 0.2s;`;
        card.onclick = () => _selectAvatarCard(card, seed, avatarCurrentStyle);

        // Load the DiceBear avatar image
        const params = new URLSearchParams({
            seed,
            size: 200, // Higher resolution
            radius: 50,
            backgroundType: 'gradientLinear',
            backgroundColor: 'b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf,f8fafc,e2e8f0', // Expanded palette
            backgroundRotation: Math.floor(Math.random() * 360)
        });
        const src = `https://api.dicebear.com/9.x/${avatarCurrentStyle}/svg?${params.toString()}`;

        const img = new Image();
        img.src = src;
        img.style.cssText = 'width:100%; height:100%; object-fit:cover; display:block;';
        img.onerror = () => { card.innerHTML = '👤'; card.style.fontSize = '32px'; card.style.textAlign = 'center'; };
        card.appendChild(img);

        // Auto-select first card
        if (idx === 0) {
            setTimeout(() => _selectAvatarCard(card, seed, avatarCurrentStyle), 300);
        }

        grid.appendChild(card);
    });
}

function _selectAvatarCard(card, seed, style) {
    // Deselect all
    document.querySelectorAll('#avatarGrid > div').forEach(c => {
        c.style.borderColor = 'transparent';
        c.style.transform = 'scale(1)';
    });

    // Select this card
    card.style.borderColor = 'var(--primary-color, #3b82f6)';
    card.style.transform = 'scale(1.06)';

    // Update config
    current3DConfig = { style, seed, type: 'dicebear' };

    // Update preview circle
    const preview = document.getElementById('avatarPreviewCircle');
    if (preview) _renderDiceBearAvatar(preview, style, seed);
}

function selectAvatarStyle(styleId) {
    avatarCurrentStyle = styleId;
    _renderAvatarStyleSidebar();
    _generateAvatarSeeds();
    _renderAvatarGrid();
}

function generateRandom3DAvatar() {
    // Re-shuffle and regenerate the grid with same style
    _generateAvatarSeeds();
    _renderAvatarGrid();
}

function _renderDiceBearAvatar(container, style, seed) {
    const W = container.clientWidth || 280;
    const H = container.clientHeight || 280;

    // Build DiceBear v9 SVG URL with optional params for richness
    const params = new URLSearchParams({
        seed,
        size: Math.max(W, H) * 2, // Double resolution for crispness
        radius: 0,
        backgroundType: 'gradientLinear',
        backgroundColor: 'f8fafc,e2e8f0,f1f5f9,f0f9ff,f5f3ff', // Studio-quality clean backgrounds
        backgroundRotation: 45
    });
    const url = `https://api.dicebear.com/9.x/${style}/svg?${params.toString()}`;

    // Show loading spinner with premium backdrop
    container.innerHTML = `
        <div class="premium-avatar-wrapper" style="width:${W}px;height:${H}px;position:relative;border-radius:50%;overflow:hidden;background:#f8fafc;">
            <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.03);">
                <div class="loading-spinner"></div>
            </div>
        </div>`;

    // Load via img to handle SVG cross-origin cleanly
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.style.cssText = `width:100%;height:100%;object-fit:cover;display:block;position:relative;z-index:1;`;

    img.onload = () => {
        const wrapper = container.querySelector('.premium-avatar-wrapper');
        if (!wrapper) {
            container.innerHTML = '';
            container.appendChild(img);
            return;
        }

        // Clear loading spinner
        wrapper.innerHTML = '';
        wrapper.appendChild(img);

        // Add Glossy Overlay
        const gloss = document.createElement('div');
        gloss.style.cssText = `
            position:absolute; top:0; left:0; right:0; bottom:0;
            background: radial-gradient(circle at 30% 20%, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0) 50%);
            pointer-events:none; z-index:2;
        `;
        wrapper.appendChild(gloss);

        // Add Multi-stage shadow for depth
        wrapper.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1), inset 0 0 0 1px rgba(255,255,255,0.1)';
        wrapper.style.transition = 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';

        wrapper.onmouseover = () => {
            wrapper.style.transform = 'scale(1.04) translateY(-4px)';
            wrapper.style.boxShadow = '0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.1)';
        };
        wrapper.onmouseleave = () => {
            wrapper.style.transform = 'scale(1) translateY(0)';
            wrapper.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)';
        };
    };
    img.onerror = () => {
        if (style !== 'adventurer') {
            _renderDiceBearAvatar(container, 'adventurer', seed);
        } else {
            container.innerHTML = '<span style="font-size:80px;">👤</span>';
        }
    };
    img.src = url;
}

// Render an avatar from a saved config (for preview)
function renderSavedAvatar(container, cfg) {
    if (!container || !cfg) return;
    if (cfg.type === 'dicebear') {
        _renderDiceBearAvatar(container, cfg.style, cfg.seed);
    }
}

async function saveGenerated3DAvatar() {
    if (!current3DConfig) return;

    try {
        const res = await apiCall('memoji', 'POST', {
            user_id: currentUser.id,
            avatar_config: current3DConfig
        });

        if (res && res.success) {
            showToast('Avatar saved! 🎉');
            currentUser.avatar3d_config = current3DConfig;
            currentUser.avatar_url = null;
            sessionStorage.setItem('attendanceUser', JSON.stringify(currentUser));
            updateAppearancePreview();
            closeCreateMemoji();
            openAppearanceModal();
        } else {
            showToast('Failed to save avatar', 'error');
        }
    } catch (e) {
        console.error('Error saving avatar:', e);
        showToast('Error saving avatar', 'error');
    }
}


function selectSegment(segment) {
    currentSegment = segment;

    // Update active segmented button
    const container = document.querySelector('.emoji-segmented-control');
    if (container) {
        container.innerHTML = `
            <button class="${segment === 'memoji' ? 'segment-active' : ''}" onclick="selectSegment('memoji')">Memoji</button>
            <button class="${segment === 'emoji' ? 'segment-active' : ''}" onclick="selectSegment('emoji')">Emoji</button>
        `;
    }

    // Select default category for segment
    if (segment === 'memoji') {
        selectEmojiCategory('memoji');
    } else {
        selectEmojiCategory('smileys');
    }
}

function closeEmojiPicker() {
    closeModal('emojiPickerModal');
    openAppearanceModal();
}

function renderEmojiSidebar() {
    const sidebar = document.getElementById('emojiSidebar');
    if (!sidebar) return;

    // Show all categories in the Emoji segment now
    let visibleCategories = EMOJI_CATEGORIES;

    sidebar.innerHTML = visibleCategories.map(cat => `
        <button class="emoji-category-btn ${cat.id === currentEmojiCategory ? 'active' : ''}" onclick="selectEmojiCategory('${cat.id}')">
            <span class="cat-icon">${cat.icon}</span>
            <span>${cat.name}</span>
        </button>
    `).join('');
}

function selectEmojiCategory(categoryId) {
    currentEmojiCategory = categoryId;
    renderEmojiSidebar();
    renderEmojiCategory(categoryId);
}

function renderEmojiCategory(categoryId) {
    const grid = document.getElementById('emojiGrid');
    if (!grid) return;

    const category = EMOJI_CATEGORIES.find(c => c.id === categoryId);
    if (!category) return;

    let html = `
        <div class="emoji-grid-section">
            <h4>${category.name}</h4>
            <div class="emoji-grid">
    `;

    if (category.hasCreateBtn) {
        html += `
        <div class="emoji-item create-memoji-btn" onclick="openCreateMemoji()" style="background: rgba(255,255,255,0.1); font-size: 32px; color: #ffffff;">
            +
        </div>
        `;
    }

    html += category.emojis.map(emoji => {
        const isImage = emoji.startsWith('/') || emoji.startsWith('http');
        const displayContent = isImage
            ? `<img src="${emoji}" style="width: 100%; height: 100%; object-fit: contain; transform: scale(0.8);">`
            : emoji;

        return `
        <div class="emoji-item ${selectedEmoji === emoji ? 'selected' : ''}" onclick="selectEmoji('${emoji}')">
            ${displayContent}
        </div>
        `;
    }).join('');

    html += `
            </div>
        </div>
    `;

    grid.innerHTML = html;
}

function selectEmoji(emoji) {
    selectedEmoji = emoji;
    renderEmojiCategory(currentEmojiCategory);
    updateEmojiSidebarPreview(emoji);
}

function updateEmojiSidebarPreview(emoji) {
    const previewContainer = document.getElementById('emojiPreviewCircle');
    if (!previewContainer) return;

    const isImage = emoji && (emoji.startsWith('/') || emoji.startsWith('http'));
    if (isImage) {
        previewContainer.innerHTML = `<img src="${emoji}" id="innerEmojiPreview" alt="Avatar Preview" style="width: 100%; height: 100%; object-fit: contain; transform: scale(0.85); transition: transform 0.1s;">`;
    } else {
        previewContainer.innerHTML = `<span id="innerEmojiPreview" style="font-size: 80px; transition: transform 0.1s; display: inline-block;">${emoji || '👤'}</span>`;
    }

    // Set slider initial state based on saved zoom
    const slider = document.getElementById('emojiZoomSlider');
    if (slider) {
        const savedZoom = (currentUser.theme_settings && currentUser.theme_settings.avatarZoom) || 1.0;
        // zoomFactor = 0.5 + (value / 100)  =>  value = (zoomFactor - 0.5) * 100
        slider.value = (savedZoom - 0.5) * 100;

        // Trigger initial scale
        setTimeout(() => {
            const inner = document.getElementById('innerEmojiPreview');
            if (inner) {
                const transform = inner.tagName === 'IMG' ? `scale(${0.85 * savedZoom})` : `scale(${savedZoom})`;
                inner.style.transform = transform;
            }
        }, 0);
    }
}

// Attach zoom slider event
document.addEventListener('DOMContentLoaded', () => {
    const slider = document.getElementById('emojiZoomSlider');
    if (slider) {
        slider.addEventListener('input', (e) => {
            const inner = document.getElementById('innerEmojiPreview');
            if (inner) {
                const zoomFactor = 0.5 + (e.target.value / 100);

                if (inner.tagName === 'IMG') {
                    const offX = (currentUser.theme_settings && currentUser.theme_settings.avatarOffsetX) || 0;
                    const offY = (currentUser.theme_settings && currentUser.theme_settings.avatarOffsetY) || 0;
                    inner.style.transform = `translate(${offX}px, ${offY}px) scale(${zoomFactor})`;
                } else {
                    inner.style.transform = `scale(${zoomFactor})`;
                }
            }
        });
    }
});



// ==================== DASHBOARD EDIT MODE & LAYOUT ENGINE ====================

let isEditMode = false;
let originalLayoutSnapshot = null;
let draggedWidget = null;

// Intercept clicks during Edit Mode to disable card actions
document.addEventListener('click', function (e) {
    if (typeof isEditMode !== 'undefined' && isEditMode) {
        // Check if we clicked a dashboard card (stat-card or action-card)
        const card = e.target.closest('.stat-card, .action-card');
        if (card) {
            // Check if we clicked on resize controls, which should remain interactive
            const isResizeControl = e.target.closest('.widget-resize-controls, .resize-btn');

            if (!isResizeControl) {
                // If it's a click anywhere else inside the card during Edit Mode, block it
                e.preventDefault();
                e.stopPropagation();
            }
        }
    }
}, true); // Use capture phase to intercept before HTML onclick/bubble listeners

// Initialize Widget Sizes on Load
function initWidgetSizes() {
    if (currentUser && currentUser.theme_settings && currentUser.theme_settings.widgetLayouts) {
        const layouts = currentUser.theme_settings.widgetLayouts;

        // Apply Sizes
        for (const [id, config] of Object.entries(layouts)) {
            const widget = document.getElementById(id);
            if (widget && config.size) {
                // Remove existing size classes
                widget.classList.remove('widget-sm', 'widget-md', 'widget-lg', 'widget-xl');
                widget.classList.add(`widget-${config.size}`);

                // Update active button state if in DOM
                const buttons = widget.querySelectorAll('.resize-btn');
                buttons.forEach(btn => {
                    btn.classList.toggle('active', btn.getAttribute('onclick').includes(`'${config.size}'`));
                });
            }
        }

        // Apply Ordering based on container
        applyWidgetOrder('employeeStatsGrid', layouts);
        applyWidgetOrder('adminStatsGrid', layouts);
        applyWidgetOrder('actionsGrid', layouts);
    }
}

function applyWidgetOrder(containerId, layouts) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const widgets = Array.from(container.children);

    // Sort array based on saved order index
    widgets.sort((a, b) => {
        const orderA = (layouts[a.id] && layouts[a.id].order !== undefined) ? layouts[a.id].order : 999;
        const orderB = (layouts[b.id] && layouts[b.id].order !== undefined) ? layouts[b.id].order : 999;
        return orderA - orderB;
    });

    // Reattach in new order
    widgets.forEach(widget => container.appendChild(widget));
}


function toggleEditMode() {
    isEditMode = !isEditMode;
    const body = document.body;
    const btn = document.getElementById('editDashboardBtn');

    if (isEditMode) {
        // Enter Edit Mode
        body.classList.add('edit-mode-active');
        btn.innerHTML = 'Cancel Edit';
        btn.style.background = 'rgba(239, 68, 68, 0.1)';
        btn.style.color = '#ef4444';
        btn.style.borderColor = '#ef4444';

        // Take Snapshot to allow cancellation
        takeLayoutSnapshot();

        // Enable Dragging
        enableWidgetDragging('employeeStatsGrid');
        enableWidgetDragging('adminStatsGrid');
        enableWidgetDragging('actionsGrid');

        // Show resize controls
        document.querySelectorAll('.stat-card, .action-card').forEach(w => w.classList.add('editing'));

        showNotification("Edit Mode active. Drag widgets to reorder and use bottom handles to resize.", "info");

    } else {
        // Exit Edit Mode (Cancel)
        cancelLayoutChanges();
    }
}

function takeLayoutSnapshot() {
    originalLayoutSnapshot = {};
    const extractState = (containerId) => {
        const container = document.getElementById(containerId);
        if (!container) return;
        Array.from(container.children).forEach((widget, index) => {
            if (widget.id) {
                let size = 'sm';
                if (widget.classList.contains('widget-md')) size = 'md';
                if (widget.classList.contains('widget-lg')) size = 'lg';
                if (widget.classList.contains('widget-xl')) size = 'xl';

                originalLayoutSnapshot[widget.id] = { order: index, size: size, element: widget };
            }
        });
    }
    extractState('employeeStatsGrid');
    extractState('adminStatsGrid');
    extractState('actionsGrid');
}

function cancelLayoutChanges() {
    if (!isEditMode) return;

    // Revert to snapshot
    if (originalLayoutSnapshot) {
        for (const [id, config] of Object.entries(originalLayoutSnapshot)) {
            const widget = document.getElementById(id);
            if (widget) {
                widget.classList.remove('widget-sm', 'widget-md', 'widget-lg', 'widget-xl');
                widget.classList.add(`widget-${config.size}`);
            }
        }

        applyWidgetOrder('employeeStatsGrid', originalLayoutSnapshot);
        applyWidgetOrder('adminStatsGrid', originalLayoutSnapshot);
        applyWidgetOrder('actionsGrid', originalLayoutSnapshot);
    }

    exitEditModeUI();
}

function exitEditModeUI() {
    isEditMode = false;
    document.body.classList.remove('edit-mode-active');

    const btn = document.getElementById('editDashboardBtn');
    if (btn) {
        btn.innerHTML = '✏️ Edit Layout';
        btn.style.background = 'rgba(var(--primary-rgb), 0.1)';
        btn.style.color = 'var(--primary-color)';
        btn.style.borderColor = 'var(--primary-color)';
    }

    disableWidgetDragging('employeeStatsGrid');
    disableWidgetDragging('adminStatsGrid');
    disableWidgetDragging('actionsGrid');

    // Hide resize controls
    document.querySelectorAll('.stat-card, .action-card').forEach(w => w.classList.remove('editing'));
}

function resizeWidget(widgetId, sizeClass) {
    if (!isEditMode) return;

    const widget = document.getElementById(widgetId);
    if (!widget) return;

    // Reset classes
    widget.classList.remove('widget-sm', 'widget-md', 'widget-lg', 'widget-xl');
    widget.classList.add(`widget-${sizeClass}`);

    // Update active button state visually
    const buttons = widget.querySelectorAll('.resize-btn');
    buttons.forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('onclick').includes(`'${sizeClass}'`)) {
            btn.classList.add('active');
        }
    });
}

// Drag functionality
function enableWidgetDragging(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const widgets = container.children;
    for (let widget of widgets) {
        if (widget.id && (widget.classList.contains('stat-card') || widget.classList.contains('action-card'))) {
            widget.setAttribute('draggable', 'true');

            widget.addEventListener('dragstart', handleDragStart);
            widget.addEventListener('dragover', handleDragOver);
            widget.addEventListener('dragenter', handleDragEnter);
            widget.addEventListener('dragleave', handleDragLeave);
            widget.addEventListener('drop', handleDrop);
            widget.addEventListener('dragend', handleDragEnd);
        }
    }
}

function disableWidgetDragging(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const widgets = container.children;
    for (let widget of widgets) {
        if (widget.id && (widget.classList.contains('stat-card') || widget.classList.contains('action-card'))) {
            widget.setAttribute('draggable', 'false');

            widget.removeEventListener('dragstart', handleDragStart);
            widget.removeEventListener('dragover', handleDragOver);
            widget.removeEventListener('dragenter', handleDragEnter);
            widget.removeEventListener('dragleave', handleDragLeave);
            widget.removeEventListener('drop', handleDrop);
            widget.removeEventListener('dragend', handleDragEnd);
        }
    }
}

function handleDragStart(e) {
    if (!isEditMode) {
        e.preventDefault();
        return;
    }
    draggedWidget = this;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.id);
    this.classList.add('dragging');
}

function handleDragOver(e) {
    if (e.preventDefault) {
        e.preventDefault(); // Necessary. Allows us to drop.
    }
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDragEnter(e) {
    if (this !== draggedWidget && (this.classList.contains('stat-card') || this.classList.contains('action-card'))) {
        this.classList.add('over');
    }
}

function handleDragLeave(e) {
    this.classList.remove('over');
}

function handleDrop(e) {
    if (e.stopPropagation) {
        e.stopPropagation(); // stops the browser from redirecting.
    }

    if (draggedWidget !== this && (this.classList.contains('stat-card') || this.classList.contains('action-card'))) {
        // Swap elements based on mouse position relative to center
        const bounding = this.getBoundingClientRect();
        const offset = bounding.y + (bounding.height / 2);

        const container = this.parentNode;

        // If dropping on bottom half, insert after. Else before.
        if (e.clientY > offset) {
            if (this.nextSibling) {
                container.insertBefore(draggedWidget, this.nextSibling);
            } else {
                container.appendChild(draggedWidget);
            }
        } else {
            container.insertBefore(draggedWidget, this);
        }
    }

    return false;
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
    const container = this.parentNode;
    if (container) {
        const widgets = container.children;
        for (let widget of widgets) {
            widget.classList.remove('over');
        }
    }
}

async function saveDashboardLayout() {
    if (!currentUser) return;

    const currentLayouts = {};

    // Read Current DOM State
    const extractCurrentState = (containerId) => {
        const container = document.getElementById(containerId);
        if (!container) return;
        Array.from(container.children).forEach((widget, index) => {
            if (widget.id) {
                let size = 'sm';
                if (widget.classList.contains('widget-md')) size = 'md';
                if (widget.classList.contains('widget-lg')) size = 'lg';
                if (widget.classList.contains('widget-xl')) size = 'xl';

                currentLayouts[widget.id] = { order: index, size: size };
            }
        });
    }

    extractCurrentState('employeeStatsGrid');
    extractCurrentState('adminStatsGrid');
    extractCurrentState('actionsGrid');

    // Update theme settings object
    if (!currentUser.theme_settings) currentUser.theme_settings = {};
    // Deep copy to ensure we're not just referencing
    currentUser.theme_settings.widgetLayouts = JSON.parse(JSON.stringify(currentLayouts));

    try {
        const btn = document.querySelector('.edit-actions-bar .btn-primary');
        if (btn) {
            btn.innerHTML = 'Saving...';
            btn.disabled = true;
        }

        const payload = {
            employee_id: currentUser.id,
            theme_settings: currentUser.theme_settings
        };
        const response = await apiCall('employee-profile', 'PATCH', payload);

        if (!response || !response.success) throw new Error('Failed to save layout');

        // Sync local sessionStorage so reload picks up new theme settings
        sessionStorage.setItem('attendanceUser', JSON.stringify(currentUser));

        showNotification("Dashboard Layout Saved!", "success");
        exitEditModeUI();

    } catch (error) {
        console.error('Save configuration error:', error);
        showNotification("Error saving layout", "error");
    } finally {
        const btn = document.querySelector('.edit-actions-bar .btn-primary');
        if (btn) {
            btn.innerHTML = 'Save Layout';
            btn.disabled = false;
        }
    }
}

// --- Mentor Status Banner Loading ---
async function loadMentorStatus() {
    if (!currentUser || currentUser.role === 'admin') return;

    try {
        const response = await apiCall('mentor-status', 'GET', { employee_id: currentUser.id });
        if (response.success && response.mentors && response.mentors.length > 0) {
            const section = document.getElementById('mentorStatusSection');
            const container = document.getElementById('mentorStatusContainer');
            if (section && container) {
                section.style.display = 'block';
                let html = '';
                response.mentors.forEach(mentor => {
                    const statusClass = `status-${mentor.status.toLowerCase()}`;

                    let avatarHtml = '';
                    if (mentor.avatar.startsWith('http') || mentor.avatar.startsWith('/')) {
                        avatarHtml = `<img src="${mentor.avatar}" alt="${mentor.name}">`;
                    } else {
                        avatarHtml = `<span style="background:${mentor.bg}; width:100%; height:100%; display:flex; align-items:center; justify-content:center;">${mentor.avatar}</span>`;
                    }

                    const isMentorAdmin = mentor.role === 'admin';
                    
                    html += `
                        <div class="mentor-status-card">
                            <div class="mentor-avatar">${avatarHtml}</div>
                            <div class="mentor-details">
                                <span style="font-size: 0.85rem; color: var(--gray-500); text-transform: uppercase; font-weight: 800; margin-right: 6px;">Your Mentor:</span>
                                <span class="mentor-name">${mentor.name}</span>
                                ${isMentorAdmin ? '' : `<span class="mentor-status-badge ${statusClass}">${mentor.status}</span>`}
                            </div>
                        </div>
                    `;
                });
                container.innerHTML = html;
            }
        }
    } catch (e) {
        console.error("Failed to load mentor status:", e);
    }
}

// ========== Office Management Functions ==========

/**
 * Fetches office data from the API and populates the primary office select elements.
 * Targeted IDs: signupOffice, profilePrimaryOffice
 */
async function refreshPrimaryOfficeSelects() {
    try {
        const result = await apiCall('offices', 'GET');
        if (result.success && result.offices) {
            const signupSelect = document.getElementById('signupOffice');
            const profileSelect = document.getElementById('profilePrimaryOffice');

            const optionsHtml = '<option value="">Select Office</option>' +
                result.offices.map(o => `<option value="${o.id}">${o.name}</option>`).join('');

            if (signupSelect) signupSelect.innerHTML = optionsHtml;
            if (profileSelect) profileSelect.innerHTML = optionsHtml;

            // Re-select value if profile is loaded
            if (currentUser && currentUser.primary_office_id && profileSelect) {
                profileSelect.value = currentUser.primary_office_id;
            }
        }
    } catch (error) {
        console.error('Failed to refresh office selects:', error);
    }
}

/**
 * Safely removes a manually created modal and restores background scroll
 * if no other modals are active.
 */
function safeRemoveModal(modalEl) {
    if (!modalEl) return;
    modalEl.remove();
    updateScrollLock();
}

/**
 * Centrally manages background scroll locking and layout shift compensation.
 */
function updateScrollLock() {
    const activeModals = document.querySelectorAll('.modal.active').length;
    const loader = document.getElementById('globalLoader');
    const isLoading = loader && loader.classList.contains('active');
    
    if (activeModals > 0 || isLoading) {
        if (!document.body.classList.contains('modal-open')) {
            const scrollWidth = window.innerWidth - document.documentElement.clientWidth;
            document.documentElement.style.setProperty('--scrollbar-width', `${scrollWidth}px`);
            document.body.classList.add('modal-open');
        }
    } else {
        // Small delay to ensure transitions finish
        setTimeout(() => {
            if (document.querySelectorAll('.modal.active').length === 0 && 
                (!document.getElementById('globalLoader') || !document.getElementById('globalLoader').classList.contains('active'))) {
                document.body.classList.remove('modal-open');
                document.documentElement.style.removeProperty('--scrollbar-width');
                // Cleanup legacy inline styles
                document.body.style.overflow = '';
                document.documentElement.style.overflow = '';
            }
        }, 50);
    }
}

/**
 * Task Due Date Quick Edit UI
 */
function showDateEditor(taskId, currentDate) {
    const editor = document.getElementById('dateEditorContainer');
    const input = document.getElementById('newDueDateInput');
    if (editor && input) {
        input.value = currentDate;
        editor.classList.remove('hidden');
    }
}

function toggleDateEditor(show) {
    const editor = document.getElementById('dateEditorContainer');
    if (editor) {
        if (show) editor.classList.remove('hidden');
        else editor.classList.add('hidden');
    }
}

async function saveNewDueDate(taskId) {
    const newDate = document.getElementById('newDueDateInput').value;
    if (!newDate) {
        showNotification('Please select a valid date', 'warning');
        return;
    }

    showLoading("Updating deadline...");
    try {
        const res = await apiCall(`tasks/${taskId}`, 'POST', {
            due_date: newDate,
            user_id: currentUser.id
        });

        if (res && res.success) {
            showNotification('Deadline updated successfully');
            toggleDateEditor(false);
            // Refresh and re-open detail to show updated history
            await Promise.all([refreshTasks(), refreshMyTasks()]);
            await openTaskDetail(taskId);
        } else {
            showNotification(res.message || 'Failed to update date', 'error');
        }
    } catch (e) {
        console.error(e);
        showNotification('An error occurred', 'error');
    } finally {
        hideLoading();
    }
}
/**
 * Shows a modal with the list of dates leaves were taken
 */
function showLeaveDatesModal(mode = 'overview') {
    let dates = [];
    let titlePrefix = "Leaves Taken";
    let periodName = "";

    if (mode === 'dashboard') {
        dates = dashboardLeaveDates;
        periodName = getCurrentISTDate().toLocaleDateString('en-US', { month: 'long' });
    } else if (mode === 'yearly') {
        dates = yearlyLeaveDates;
        periodName = viewingOverviewYear || getCurrentISTDate().getFullYear();
        titlePrefix = "Yearly Leaves";
    } else {
        dates = currentLeaveDates;
        periodName = new Date(viewingOverviewYear, viewingOverviewMonth - 1).toLocaleDateString('en-US', { month: 'long' });
    }

    if (!dates || dates.length === 0) {
        showNotification(`No leaves taken in ${periodName}`, 'info');
        return;
    }

    // Calculate total count (Half counts as 0.5)
    const totalCount = dates.reduce((acc, item) => acc + (item.type === 'full_day' ? 1.0 : 0.5), 0);

    const content = `
        <div class="names-list-container" style="padding: 24px;">
            <button class="modal-close-btn" onclick="safeRemoveModal(this.closest('.modal'))">✕</button>
            <div style="margin-bottom: 20px; border-bottom: 2px solid #f1f5f9; padding-bottom: 12px;">
                <h3 style="margin: 0; font-size: 1.25rem; color: #1e293b; display: flex; align-items: center; gap: 12px;">
                    <span style="background: #fef2f2; padding: 8px; border-radius: 12px;">🏖️</span>
                    ${titlePrefix} - ${periodName}
                </h3>
                <p style="margin: 6px 0 0; color: #64748b; font-size: 0.85rem; font-weight: 600;">
                    ${totalCount} day${totalCount === 1 ? '' : 's'} total
                </p>
            </div>
            <div class="names-scroll-area" style="max-height: 400px; overflow-y: auto;">
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${dates.sort((a,b) => new Date(a.date) - new Date(b.date)).map((item, idx) => {
                        const d = new Date(item.date);
                        const dayName = d.toLocaleDateString('en-US', { weekday: 'long' });
                        const formattedDate = formatDateDMY(item.date);
                        const isHalf = item.type === 'half_day';
                        return `
                            <div class="name-item" style="background: #f8fafc; padding: 14px 18px; border-radius: 14px; border: 1px solid #e2e8f0; font-weight: 700; color: #334155; font-size: 0.95rem; display: flex; align-items: center; justify-content: space-between; transition: all 0.2s ease;">
                                <div style="display: flex; align-items: center; gap: 12px;">
                                    <span style="color: #94a3b8; font-size: 0.75rem;">${idx + 1}.</span>
                                    <div style="display: flex; flex-direction: column;">
                                        <span>${formattedDate}</span>
                                        <span style="font-size: 0.7rem; color: #94a3b8; font-weight: 500;">${dayName}</span>
                                    </div>
                                </div>
                                <span style="font-size: 0.72rem; ${isHalf ? 'color: #f59e0b; background: #fffbeb;' : 'color: #6366f1; background: #eef2ff;'} padding: 4px 10px; border-radius: 20px; font-weight: 800;">
                                    ${isHalf ? '0.5 - HALF DAY' : '1.0 - FULL DAY'}
                                </span>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>
    `;

    const modal = document.createElement('div');
    modal.className = 'modal sub-modal-active';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.zIndex = '13000'; // Higher than status overview modal

    modal.innerHTML = `
        <div class="modal-content" style="max-width: 440px; width: 90%; padding: 0; border-radius: 28px; border: none; box-shadow: 0 40px 80px -15px rgba(0,0,0,0.5); animation: modalPop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);">
            ${content}
        </div>
    `;

    document.body.appendChild(modal);

    requestAnimationFrame(() => {
        modal.classList.add('active');
        updateScrollLock();
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) safeRemoveModal(modal);
    });
}
