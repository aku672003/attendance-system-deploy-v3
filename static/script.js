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

            // If they are logged in, we skip the gatekeeper logic below
            // because they already "passed" the gatekeeper to get the session.
        } catch (e) {
            sessionStorage.removeItem('attendanceUser');
        }
    } else {
        // Since the server-side @require_valid_token decorator handles the initial request,
        // we only reach this point if a valid token was provided.
        // The user is not yet logged in, so they stay on the login screen.
    }

    // Load face detection models
    loadFaceDetectionModels();

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
    el.classList.add('active');
    document.body.style.overflow = 'hidden';
}

async function syncServerTime() {
    try {
        const start = Date.now();
        const response = await fetch(`${apiBaseUrl}/server-time`);
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
    document.body.style.overflow = '';

    // Refresh dashboard stats when closing requests/calendar modals
    // This ensures that if a request was made/approved, the dashboard counters update.
    if (id === 'myRequestsModal' || id === 'requestsModal' || id === 'calendarModal') {
        if (typeof loadWFHEligibility === 'function') {
            loadWFHEligibility();
        }
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
    if (screenId === 'adminScreen' && (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'manager'))) {
        showNotification('Admins only.', 'warning');
        screenId = 'dashboardScreen';
        return;
    }

    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');

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

// Geolocation permission help UI
function showGeoPermissionHelp(containerEl) {
    const el = containerEl || document.getElementById('locationDistance');
    if (!el) return;
    el.innerHTML = `
        <div class="geo-help" style="font-size:13px;color:var(--gray-700);line-height:1.4;">
            Location is blocked by your browser for this site.<br>
            <div style="margin-top:6px;">
                - Chrome: Click the lock icon near the address bar → Site settings → Location: Allow → Reload.<br>
                - Safari (macOS): Safari → Settings → Websites → Location → Allow for this site → Reload.<br>
                - Ensure you use http://localhost or HTTPS (required for geolocation).
            </div>
            <div style="margin-top:8px;display:flex;gap:8px;">
                <button class="btn btn-primary" id="geoTryEnableBtn">Enable Location</button>
                <button class="btn btn-secondary" id="geoReloadBtn">Reload</button>
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
            () => resolve(true),
            () => resolve(false),
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
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

    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
        return dateString;
    }

    // Just "December 4, 2025"
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
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

            // Sync server time FIRST — must happen before any time-sensitive operations
            await syncServerTime();

            // Set calendar to synchronized IST date
            const istNow = getCurrentISTDate();
            currentCalendarMonth = istNow.getMonth();
            currentCalendarYear = istNow.getFullYear();

            showNotification('Login successful!');
            showScreen('dashboardScreen');

            try {
                await loadDashboardData();
                await populateOfficeDropdowns(); // Ensure this exists or catch if it doesn't
            } catch (err) {
                console.error("Critical error loading dashboard data:", err);
                showNotification("Dashboard loaded with some errors", "warning");
            }

            updateDashboardVisibility();
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

    // Reload the current page. This preserves the gated token in the URL
    // if it's present, ensuring the user stays on the gated login screen.
    window.location.reload();
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

    container.innerHTML = notifications.map(notif => `
        <div class="notification-item" data-id="${notif.id}" onclick="handleNotificationClick('${notif.type}', '${notif.id}')">
            <div class="notification-item-icon">${notif.icon}</div>
            <div class="notification-item-content">
                <div class="notification-item-message">${notif.message}</div>
                <div class="notification-item-time">${notif.time}</div>
            </div>
        </div>
    `).join('');
}

async function handleNotificationClick(type, id) {
    if (type === 'wish') {
        // Mark this specific wish as read
        await apiCall('mark-notifications-read', 'POST', {
            user_id: currentUser.id,
            notification_id: id
        });
        loadNotifications();
        showNotification('Wish marked as read', 'success');
    } else if (type === 'birthday') {
        openBirthdayCalendar();
    } else if (type === 'task') {
        if (currentUser.role === 'admin' || currentUser.role === 'manager') {
            openTaskManager();
        } else {
            openMyTasks();
        }
    } else if (type === 'request') {
        openRequestsModal();
    }

    // Auto-close notification dropdown
    const list = document.getElementById('notificationList');
    if (list) {
        list.style.display = 'none';
        list.classList.add('hidden');
        const icon = document.getElementById('toggleIcon');
        if (icon) icon.textContent = '▼';
    }
}

function updateNotificationBadge(count) {
    const badge = document.getElementById('notificationBadge');
    if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? 'inline-block' : 'none';

        // Add wiggle animation if new notifications
        if (count > 0) {
            const icon = document.querySelector('.notification-icon');
            if (icon) {
                icon.animate([
                    { transform: 'rotate(0deg)' },
                    { transform: 'rotate(-10deg)' },
                    { transform: 'rotate(10deg)' },
                    { transform: 'rotate(0deg)' }
                ], {
                    duration: 500,
                    iterations: 2
                });
            }
        }
    }
}

function toggleNotifications() {
    const list = document.getElementById('notificationList');
    const icon = document.getElementById('toggleIcon');
    if (!list) return;

    const isHidden = list.style.display === 'none' || list.classList.contains('hidden');

    if (isHidden) {
        list.style.display = 'block';
        list.classList.remove('hidden');
        if (icon) icon.textContent = '▲';
    } else {
        list.style.display = 'none';
        list.classList.add('hidden');
        if (icon) icon.textContent = '▼';
    }
}

async function markAllAsRead() {
    try {
        await apiCall('mark-notifications-read', 'POST', { user_id: currentUser.id });
        updateNotificationBadge(0);
        const list = document.getElementById('notificationList');
        if (list) {
            list.style.display = 'none';
            list.classList.add('hidden');
        }
        const icon = document.getElementById('toggleIcon');
        if (icon) icon.textContent = '▼';

        showNotification('All notifications marked as read', 'success');
        loadNotifications(); // Refresh list
    } catch (e) {
        console.error('Failed to mark notifications as read', e);
    }
}


async function loadDashboardData() {
    if (!currentUser) return;

    document.getElementById('userName').textContent = currentUser.name;

    // Load notifications for all users
    loadNotifications();

    if (currentUser.role === 'admin') {
        // Admin sees admin stats grid and admin-specific cards
        document.getElementById('employeeStatsGrid').classList.add('hidden');
        document.getElementById('adminStatsGrid').classList.remove('hidden');
        document.getElementById('checkInCard').classList.add('hidden'); // Hide check-in for admin
        document.getElementById('checkOutCard').classList.add('hidden'); // Hide check-out for admin
        document.getElementById('adminCard').classList.remove('hidden');
        document.getElementById('exportCard').classList.remove('hidden');
        document.getElementById('profileCard').classList.add('hidden');
        document.getElementById('myTasksCard')?.classList.remove('hidden');
        document.getElementById('myStatsCard')?.classList.remove('hidden');
        document.getElementById('temporaryTagsCard')?.classList.remove('hidden');
        document.getElementById('trainModelCard')?.classList.remove('hidden');
        document.getElementById('manageEmployeesCard')?.classList.add('hidden');
        document.getElementById('adminExportNote')?.classList.remove('hidden');

        // Load admin dashboard data
        await Promise.all([
            loadAdminSummary(),
            loadUpcomingBirthdays(),
            loadPendingRequests(),
            loadActiveTasks(),
            loadIntelligenceHubData()
        ]);
    } else {
        // Employee sees employee stats grid and employee-specific cards
        document.getElementById('adminStatsGrid').classList.add('hidden');
        document.getElementById('employeeStatsGrid').classList.remove('hidden');
        document.getElementById('profileCard').classList.remove('hidden');
        document.getElementById('adminCard').classList.add('hidden');
        document.getElementById('exportCard').classList.add('hidden');
        document.getElementById('trainModelCard')?.classList.add('hidden');
        document.getElementById('adminExportNote')?.classList.add('hidden');
        document.getElementById('myStatsCard')?.classList.remove('hidden');

        if (currentUser.role === 'manager') {
            document.getElementById('manageEmployeesCard')?.classList.remove('hidden');
        } else {
            document.getElementById('manageEmployeesCard')?.classList.add('hidden');
        }

        // Initialize Intelligence Hub Visibility
        const intelligenceHubCard = document.getElementById('intelligenceHubCard');
        if (intelligenceHubCard) {
            intelligenceHubCard.classList.remove('hidden');

            // Explicitly show all buttons for admin
            document.getElementById('btnViewAnalysis') && (document.getElementById('btnViewAnalysis').style.display = '');
            document.getElementById('btnSearchPersonnel') && (document.getElementById('btnSearchPersonnel').style.display = '');
            document.getElementById('btnMyStats') && (document.getElementById('btnMyStats').style.display = '');
        }

        // 1. Run location check first and get its status
        let isUserInRange = false;
        try {
            const locationStatus = await updateLocationStatus(false);
            isUserInRange = locationStatus ? locationStatus.inRange : false;
        } catch (e) {
            console.error("Error updating location status:", e);
        }

        // Check location permission and gate the Check In card
        checkLocationPermission();

        // 2. Now run other checks, passing the location status
        try { await loadTodayAttendance(isUserInRange); } catch (e) { console.error(e); }
        try { await loadMonthlyStats(); } catch (e) { console.error(e); }
        try { await loadWFHEligibility(); } catch (e) { console.error(e); }
        try { await loadIntelligenceHubData(); } catch (e) { console.error(e); }

        // Check profile completeness for non-admin users
        if (currentUser.role !== 'admin') {
            try { await checkProfileCompleteness(); } catch (e) { console.error(e); }
        }
    }
    // Check if it is the user's Birthday!
    try {
        await checkBirthday();
    } catch (e) {
        console.error("Critical error in birthday check:", e);
    }
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
            document.getElementById('totalEmployees').textContent = res.total_employees || 0;
            document.getElementById('presentToday').textContent = `${res.present_today || 0} present today`;
            document.getElementById('surveyorsPresent').textContent = `${res.surveyors_present || 0} surveyors present`;
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
async function showEmployeeSummary() {
    try {
        const res = await apiCall('admin-summary', 'GET', { user_id: currentUser.id });
        if (res && res.success) {
            const summary = res;

            // Create premium modal content
            const content = `
                <div class="summary-modal-container">
                    <button class="modal-close-btn" onclick="this.closest('.modal').remove()">✕</button>
                    
                    <div class="summary-header">
                        <h3>📊 Daily Overview</h3>
                        <span style="font-size:0.9rem; color:var(--gray-500);">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
                    </div>

                    <div class="summary-hero">
                        <span class="hero-label">Total Workforce</span>
                        <span class="hero-value">${summary.total_employees || 0}</span>
                        <div style="font-size:0.9rem; opacity:0.8; margin-top:8px;">Active Employees</div>
                    </div>

                    <div class="summary-grid">
                        <div class="summary-card">
                            <div class="summary-icon icon-present">🟢</div>
                            <div class="summary-data">
                                <span class="value">${summary.present_today || 0}</span>
                                <span class="label">Present Today</span>
                            </div>
                        </div>

                        <div class="summary-card">
                            <div class="summary-icon icon-absent">🔴</div>
                            <div class="summary-data">
                                <span class="value">${summary.absent_today || 0}</span>
                                <span class="label">Absent</span>
                            </div>
                        </div>

                        <div class="summary-card">
                            <div class="summary-icon icon-wfh">🏠</div>
                            <div class="summary-data">
                                <span class="value">${summary.wfh_today || 0}</span>
                                <span class="label">Work From Home</span>
                            </div>
                        </div>

                        <div class="summary-card">
                            <div class="summary-icon icon-leave">🏖️</div>
                            <div class="summary-data">
                                <span class="value">${summary.on_leave || 0}</span>
                                <span class="label">On Leave</span>
                            </div>
                        </div>
                        
                         <div class="summary-card" style="grid-column: span 2;">
                            <div class="summary-icon icon-survey">📋</div>
                            <div class="summary-data">
                                <span class="value">${summary.surveyors_present || 0}</span>
                                <span class="label">Surveyors in Field</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // Create modal wrapper
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.style.display = 'flex'; // Ensure flex centering
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 600px; padding: 0; overflow: hidden; border-radius: 20px;">
                    ${content}
                </div>
            `;

            document.body.appendChild(modal);

            // Trigger animation
            requestAnimationFrame(() => {
                modal.classList.add('active');
            });

            // Close on outside click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.remove();
            });

        }
    } catch (error) {
        console.error('Error showing employee summary:', error);
        showNotification('Error loading employee summary', 'error');
    }
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
    target.setHours(0, 0, 0, 0);

    // Set year to current year for calculation to ignore birth year
    // Actually API returns current year occurrence usually, but let's be safe if it's full birthdate
    // The API seems to return 'date' field as 'YYYY-MM-DD' for the birthday IN THAT YEAR requested.
    // So simple diff is enough.

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

        const classes = [
            'fc-day',
            dayData.hasBirthday ? 'has-birthday' : '',
            isToday ? 'today' : '',
            isSunday ? 'sunday' : ''
        ].filter(Boolean).join(' ');

        // If multiple birthdays, show a small counter, otherwise just the day number
        const count = dayData.birthdays.length;
        const indicator = count > 1 ? `<span style="font-size:0.65rem; position:absolute; bottom:8px; background:#ec4899; color:white; width:16px; height:16px; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 4px rgba(236, 72, 153, 0.3);">${count}</span>` : '';

        // Add hover events only if there are birthdays
        const hoverAttrs = dayData.hasBirthday ?
            `onmouseenter="showBirthdayTooltip(event, ${day})"` : '';

        // Note: keeping onclick to show details in panel if they click, but tooltip handles hover
        html += `
            <div class="${classes}" ${hoverAttrs} onmouseleave="hideBirthdayTooltip()">
                <span class="day-number">${day}</span>
                ${indicator}
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

async function openRequestsModal() {
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

            let html = `
                <div class="premium-calendar-wrap">
                    <!-- Premium Header -->
                    <div class="premium-header">
                        <div class="header-title">
                            <span style="font-size: 1.8rem;">📥</span>
                            <div style="display:flex; flex-direction:column;">
                                <span style="font-size: 1.4rem; font-weight: 800; color: #1e293b;">Pending Requests</span>
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

        const typeClass = req.type === 'wfh' ? 'tech-wfh' : 'tech-leave';
        const badgeClass = req.type === 'wfh' ? 'badge-tech-wfh' : 'badge-tech-leave';
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
                            </div>
                        </div>
                        <div class="req-actions-tech">
                            ${req.status === 'pending' ? `
                                <button class="btn-tech btn-tech-approve" onclick="approveRequest(${req.id}, '${req.type}')" title="Approve" style="width: 48px; height: 48px; border-radius: 14px;">✓</button>
                                <button class="btn-tech btn-tech-reject" onclick="rejectRequest(${req.id}, '${req.type}')" title="Reject" style="width: 48px; height: 48px; border-radius: 14px;">✕</button>
                            ` : `
                                <span class="premium-badge" style="background: ${req.status === 'approved' ? '#dcfce7' : '#fee2e2'}; color: ${req.status === 'approved' ? '#166534' : '#991b1b'}; border-radius: 8px; padding: 6px 14px; font-weight: 700; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.05em;">${req.status}</span>
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
        titleEl.textContent = mode === 'history' ? 'Request History' : 'Pending Requests';
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
        }

        return matchesSearch && matchesType;
    });

    list.innerHTML = renderRequestCards(filtered);
}

async function openTaskManager() {
    await refreshTasks();

    // Hide Add Task button for non-admins
    const addTaskBtn = document.querySelector('#taskManagerModal .modal-actions .btn-primary');
    if (addTaskBtn) {
        if (typeof currentUser !== 'undefined' && currentUser && currentUser.role !== 'admin' && currentUser.role !== 'manager') {
            addTaskBtn.style.display = 'none';
        } else {
            addTaskBtn.style.display = 'inline-block';
        }
    }

    openModal('taskManagerModal');
}

// Task Management Functions
let tasks = [];

async function refreshTasks() {
    try {
        // Always pass employee_id so backend can verify role (Admin vs Employee)
        const empId = typeof currentUser !== 'undefined' && currentUser ? currentUser.id : '';
        const queryParams = `?employee_id=${empId}`;
        const res = await apiCall(`tasks${queryParams}`, 'GET');
        if (res && res.success && Array.isArray(res.tasks)) {
            tasks = res.tasks;
            renderTaskBoard();
        }
    } catch (error) {
        console.error('Error loading tasks:', error);
        showNotification('Error loading tasks', 'error');
    }
}




function renderTaskBoard() {
    const todoList = document.getElementById('todoList');
    const inProgressList = document.getElementById('inProgressList');
    const completedList = document.getElementById('completedList');

    const todoTasks = tasks.filter(t => t.status === 'todo');
    const inProgressTasks = tasks.filter(t => t.status === 'in_progress');
    const completedTasks = tasks.filter(t => t.status === 'completed');

    document.getElementById('todoCount').textContent = todoTasks.length;
    document.getElementById('inProgressCount').textContent = inProgressTasks.length;
    document.getElementById('completedCount').textContent = completedTasks.length;

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

            // Multi-Assignee Avatar Group
            const assignees = task.assignees || [];
            const avatarGroup = assignees.slice(0, 3).map((a, i) => `
                <span class="premium-user-avatar" style="width:28px; height:28px; font-size:11px; background: linear-gradient(135deg, #f8fafc, #f1f5f9); border: 1px solid #e2e8f0; color: #475569; margin-left: ${i > 0 ? '-10px' : '0'}; z-index: ${5 - i};" title="${a.name}">${a.name.charAt(0).toUpperCase()}</span>
            `).join('') + (assignees.length > 3 ? `<span class="premium-user-avatar" style="width:28px; height:28px; font-size:10px; background: #e2e8f0; border: 1px solid #cbd5e1; color: #475569; margin-left: -10px; z-index: 1;">+${assignees.length - 3}</span>` : '');

            const assigneeNames = assignees.map(a => a.name).join(', ') || 'Unassigned';

            return `
                <div class="premium-task-card ${dueClass}" id="task-${task.id}" draggable="true" ondragstart="drag(event)" onclick="openTaskDetail(${task.id})" style="animation: slideInUp 0.4s cubic-bezier(0.165, 0.84, 0.44, 1) forwards; animation-delay: ${idx * 50}ms; opacity:1; cursor:pointer;">
                    <div class="premium-card-header">
                        <span class="premium-priority-badge ${priorityClass}" style="border-radius: 6px; padding: 4px 10px;">${task.priority || 'Medium'}</span>
                        ${dueBadge}
                        <div style="display:flex; gap:8px;">
                            ${typeof currentUser !== 'undefined' && currentUser && (currentUser.role === 'admin' || currentUser.role === 'manager') ? `
                            <button class="btn-icon-sm" onclick="event.stopPropagation(); editTask(${task.id})" style="background:#f1f5f9; border:none; color:#64748b; cursor:pointer; width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; transition:all 0.2s;" title="Edit">✎</button>
                            <button class="btn-icon-sm" onclick="event.stopPropagation(); deleteTask(${task.id})" style="background:#fef2f2; border:none; color:#ef4444; cursor:pointer; width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; transition:all 0.2s;" title="Delete">🗑</button>
                            ` : ''}
                        </div>
                    </div>
                    
                    <h5 class="premium-task-title" style="margin: 0; font-size: 1.1rem; line-height: 1.5;">${task.title}</h5>
                    <p style="font-size:0.9rem; color:#64748b; margin: 0; line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${task.description || ''}</p>
                    
                    <div class="premium-task-meta" style="margin-top: 4px; padding-top: 12px; border-top: 1px solid #f1f5f9;">
                        <div style="display:flex; align-items:center; flex-grow: 1;">
                            <div style="display:flex;">${avatarGroup}</div>
                            <span style="font-size:0.85rem; color:#475569; font-weight: 500; margin-left: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px;">${assigneeNames}</span>
                        </div>
                        ${task.manager_name ? `
                        <div style="display:flex; align-items:center; gap:6px; margin-top: 4px;">
                            <span style="font-size:0.75rem; color:#64748b; font-weight: 600; background:#f1f5f9; padding:2px 8px; border-radius:4px;">👁 Overseer: ${task.manager_name}</span>
                        </div>
                        ` : ''}
                        <div style="display:flex; flex-direction:column; align-items:flex-end;">
                            <span style="font-size:0.8rem; color:#94a3b8; font-weight: 600; display: flex; align-items: center; gap: 4px;">
                                <span style="font-size: 1rem;">📅</span> ${task.due_date ? new Date(task.due_date).toLocaleDateString() : 'No date'}
                            </span>
                            ${task.comments && task.comments.length > 0 ? `
                                <span style="font-size:0.75rem; color:#3b82f6; font-weight: 600; margin-top: 4px;">💬 ${task.comments.length} comments</span>
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
    await refreshMyTasks();
    openModal('myTasksModal');
}

async function refreshMyTasks() {
    try {
        const empId = typeof currentUser !== 'undefined' && currentUser ? currentUser.id : '';
        console.log('DEBUG: refreshing my tasks for empId:', empId, 'currentUser:', window.currentUser);
        const res = await apiCall(`tasks?employee_id=${empId}`, 'GET');
        console.log('DEBUG: my tasks response:', res);
        if (res && res.success && Array.isArray(res.tasks)) {
            myTasks = res.tasks;
            renderMyTaskBoard();
            checkDueTomorrowReminders();
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

    const todoTasks = myTasks.filter(t => t.status === 'todo');
    const inProgressTasks = myTasks.filter(t => t.status === 'in_progress');
    const completedTasks = myTasks.filter(t => t.status === 'completed');

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
                    <div class="premium-card-header" style="margin-bottom: 0;">
                        <span class="premium-priority-badge ${priorityClass}" style="border-radius: 6px; padding: 4px 10px;">${task.priority || 'Medium'}</span>
                        ${dueBadge}
                        ${task.comments && task.comments.length > 0 ? `
                            <span style="font-size:0.75rem; color:#3b82f6; font-weight: 600;">💬 ${task.comments.length}</span>
                        ` : ''}
                    </div>
                    
                    <h5 class="premium-task-title" style="margin: 0; font-size: 1.1rem; line-height: 1.5;">${task.title}</h5>
                    <p style="font-size:0.9rem; color:#64748b; margin: 0; line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${task.description || ''}</p>
                    
                    <div class="premium-task-meta" style="margin-top: 4px; padding-top: 12px; border-top: 1px solid #f1f5f9;">
                        <span style="font-size:0.85rem; color:#94a3b8; font-weight: 600; display: flex; align-items: center; gap: 4px;">
                            <span style="font-size: 1rem;">📅</span> ${task.due_date ? new Date(task.due_date).toLocaleDateString() : 'No date'}
                        </span>
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

    const taskManagerCard = document.getElementById('taskManagerCard');
    const myTasksCard = document.getElementById('myTasksCard');
    const myStatsCard = document.getElementById('myStatsCard');
    const hubMyStatsBtn = document.getElementById('hubMyStatsBtn');
    const adminStatsGrid = document.getElementById('adminStatsGrid');
    const employeeStatsGrid = document.getElementById('employeeStatsGrid');

    if (currentUser.role === 'admin') {
        // Show Task Manager (Admin), Hide My Tasks
        if (taskManagerCard) taskManagerCard.classList.remove('hidden');
        if (myTasksCard) myTasksCard.classList.add('hidden');

        // Admin doesn't need personal "My Stats" on their main dashboard
        if (myStatsCard) myStatsCard.classList.add('hidden');
        if (hubMyStatsBtn) hubMyStatsBtn.classList.add('hidden');

        // Ensure Admin Stats Grid is visible for Admin
        if (adminStatsGrid) adminStatsGrid.classList.remove('hidden');
        if (employeeStatsGrid) employeeStatsGrid.classList.add('hidden');
    } else {
        // Hide Task Manager (Admin), Show My Tasks (Employee/Manager)
        if (taskManagerCard) taskManagerCard.classList.add('hidden');
        if (myTasksCard) myTasksCard.classList.remove('hidden');
        if (myStatsCard) myStatsCard.classList.remove('hidden');
        if (hubMyStatsBtn) hubMyStatsBtn.classList.remove('hidden');

        // Ensure Employee Stats Grid is visible for Employee/Manager
        if (adminStatsGrid) adminStatsGrid.classList.add('hidden');
        if (employeeStatsGrid) employeeStatsGrid.classList.remove('hidden');
    }
}

// Legacy function removed as it is merged into renderTaskBoard logic above

function addNewTask() {
    // Reset form
    document.getElementById('taskTitle').value = '';
    document.getElementById('taskDescription').value = '';
    document.getElementById('taskPriority').value = 'medium';
    document.getElementById('taskDueDate').value = '';

    // Multi-Select Reset
    selectedEmployeeIds = [];
    updateSelectedTags('multiSelectDisplay', [], window.allEmployeesSimple || [], 'taskAssigneeIds');

    if (document.getElementById('teamSelector')) document.getElementById('teamSelector').value = '';
    if (document.getElementById('taskManager')) document.getElementById('taskManager').value = 'none';

    // Reset button text and state
    document.getElementById('saveTaskText').textContent = 'Save Task';
    window.currentEditingTaskId = null;

    // Populate assignee dropdown & teams
    populateTaskAssigneeDropdown();
    loadTeams();

    openModal('addTaskModal');
}

/**
 * Populate Edit Task Modal
 */
async function editTask(taskId) {
    if (!tasks || !Array.isArray(tasks)) {
        showNotification('Task data not loaded', 'error');
        return;
    }

    const task = tasks.find(t => t.id === taskId);
    if (!task) {
        showNotification('Task not found', 'error');
        return;
    }

    // Change title and button text
    document.getElementById('saveTaskText').textContent = 'Update Task';
    window.currentEditingTaskId = taskId;

    // Populate form
    document.getElementById('taskTitle').value = task.title;
    document.getElementById('taskDescription').value = task.description || '';

    // Map priority if needed
    const priority = (task.priority || 'medium').toLowerCase();
    document.getElementById('taskPriority').value = priority;

    document.getElementById('taskDueDate').value = task.due_date || '';

    // For assignee multi-select
    await populateTaskAssigneeDropdown();
    selectedEmployeeIds = task.assignees ? task.assignees.map(a => a.id) : [];
    updateSelectedTags('multiSelectDisplay', selectedEmployeeIds, window.allEmployeesSimple || [], 'taskAssigneeIds');

    if (document.getElementById('taskManager')) {
        document.getElementById('taskManager').value = task.manager_id || 'none';
    }

    openModal('addTaskModal');
}

async function populateTaskAssigneeDropdown() {
    try {
        const res = await apiCall('employees-simple', 'GET');
        if (res && res.success && Array.isArray(res.employees)) {
            window.allEmployeesSimple = res.employees; // Store for lookup

            // Populate Multi-Select Options
            populateEmployeeListInDropdown('multiSelectOptionsList', false);

            const managerSelect = document.getElementById('taskManager');
            if (managerSelect) {
                // Allow selecting any employee as a manager/overseer
                managerSelect.innerHTML = '<option value="none">Optional: Select Manager...</option>' +
                    res.employees.map(emp => `<option value="${emp.id}">${emp.name} (${emp.role})</option>`).join('');
            }
        }
    } catch (error) {
        console.error('Error loading users for task assignment:', error);
    }
}

// Auto-select manager when assignee changes
document.addEventListener('change', (e) => {
    if (e.target.id === 'taskAssignee') {
        const empId = parseInt(e.target.value);
        if (!empId || !window.allEmployeesSimple) return;

        const emp = window.allEmployeesSimple.find(x => x.id === empId);
        if (emp && emp.manager_id) {
            const managerSelect = document.getElementById('taskManager');
            if (managerSelect) {
                managerSelect.value = emp.manager_id;
            }
        }
    }
});

async function saveNewTask() {
    const title = document.getElementById('taskTitle').value.trim();
    const description = document.getElementById('taskDescription').value.trim();
    const priority = document.getElementById('taskPriority').value;
    const dueDate = document.getElementById('taskDueDate').value;

    if (!title) {
        showNotification('Task title is required', 'error');
        return;
    }

    if (!window.currentEditingTaskId && selectedEmployeeIds.length === 0) {
        showNotification('Please select at least one employee', 'error');
        return;
    }

    const btn = document.getElementById('saveTaskBtn');
    const btnText = document.getElementById('saveTaskText');
    const spinner = document.getElementById('saveTaskSpinner');

    btn.disabled = true;
    btnText.classList.add('hidden');
    spinner.classList.remove('hidden');

    try {
        const url = window.currentEditingTaskId ? `tasks/${window.currentEditingTaskId}` : 'tasks/create';
        const method = 'POST'; // Backend uses POST for both creation and update

        const payload = {
            title,
            description,
            priority,
            due_date: dueDate || null,
            assignees: selectedEmployeeIds,
            manager_id: document.getElementById('taskManager') ? document.getElementById('taskManager').value : null,
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
        btn.disabled = false;
        btnText.classList.remove('hidden');
        spinner.classList.add('hidden');
    }
}

let currentSelectedTaskId = null;

async function openTaskDetail(taskId) {
    const task = [...tasks, ...myTasks].find(t => t.id === taskId);
    if (!task) return;

    currentSelectedTaskId = taskId;
    document.getElementById('detailTaskTitle').textContent = task.title;
    document.getElementById('detailTaskDescription').textContent = task.description || 'No description provided.';

    const assignees = task.assignees || [];
    const assigneeNames = assignees.map(a => a.name).join(', ') || 'Unassigned';

    document.getElementById('detailTaskMeta').innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.1rem;">👥</span>
                <span style="font-weight: 600; color: #1e293b;">${assigneeNames}</span>
            </div>
            <div style="display: flex; gap: 12px; font-size: 0.85rem; color: #64748b;">
                ${task.manager_name ? `<span>👁 Overseer: ${task.manager_name}</span>` : ''}
                <span>🚩 ${task.priority}</span>
                <span>📅 ${task.due_date ? new Date(task.due_date).toLocaleDateString() : 'No date'}</span>
            </div>
        </div>
    `;

    // Handle Team Progress (Static list of assignees for shared task)
    const teamSection = document.getElementById('teamOverviewSection');
    const teamList = document.getElementById('teamMembersList');

    if (assignees.length > 1) {
        teamSection.classList.remove('hidden');
        teamList.innerHTML = assignees.map(m => {
            const isMe = typeof currentUser !== 'undefined' && currentUser && m.id === currentUser.id;
            return `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: white; border-radius: 12px; border: 1px solid #e0f2fe;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div style="width: 32px; height: 32px; background: #e0f2fe; color: #0369a1; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.8rem;">
                            ${m.name.charAt(0)}
                        </div>
                        <span style="font-size: 0.95rem; font-weight: 500; color: #1e293b;">${m.name} ${isMe ? '<span style="color:#64748b; font-size:0.75rem;">(You)</span>' : ''}</span>
                    </div>
                    <span style="background: #eff6ff; color: #3b82f6; font-size: 0.75rem; font-weight: 700; padding: 4px 10px; border-radius: 20px; text-transform: uppercase;">
                        Assignee
                    </span>
                </div>
            `;
        }).join('');
    } else {
        teamSection.classList.add('hidden');
    }

    renderTaskComments(task.comments || []);
    document.getElementById('newTaskComment').value = '';

    openModal('taskDetailModal');
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
                <span style="font-size: 0.75rem; color: #94a3b8;">${new Date(c.created_at).toLocaleString()}</span>
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
    const content = document.getElementById('newTaskComment').value.trim();
    if (!content || !currentSelectedTaskId) return;

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

    try {
        const payload = {
            _method: 'DELETE',
            user_id: typeof currentUser !== 'undefined' && currentUser ? currentUser.id : null
        };
        const res = await apiCall(`tasks/${taskId}`, 'POST', payload);
        if (res && res.success) {
            showNotification('Task deleted');
            await refreshTasks();
            await loadActiveTasks(); // Update dashboard count
        } else {
            showNotification('Failed to delete task: ' + (res?.message || 'Unauthorized'), 'error');
        }
    } catch (error) {
        console.error('Error deleting task:', error);
        showNotification('Error deleting task', 'error');
    }
}

async function approveRequest(requestId, type) {
    try {
        const endpoint = type === 'wfh' ? 'wfh-request-approve' : 'leave-request-approve';
        const res = await apiCall(endpoint, 'POST', { request_id: requestId });

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
    }
}

async function rejectRequest(requestId, type) {
    const reason = await openRejectionModal(requestId);
    if (reason === null) return; // User cancelled

    try {
        const endpoint = type === 'wfh' ? 'wfh-request-approve' : 'leave-request-approve';
        // For rejection, we use the approve endpoint but with status='rejected'
        const res = await apiCall(endpoint, 'POST', {
            request_id: requestId,
            status: 'rejected',
            admin_response: reason
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
    }
}

/* ==================== MY REQUESTS POPUP ==================== */

/* ==================== MY REQUESTS POPUP (STATUS OVERVIEW) ==================== */

function openMyRequests() {
    openModal('myRequestsModal');
    loadStatusOverview();
}

async function loadStatusOverview() {
    if (!currentUser) return;

    // Reset View
    const ovContainer = document.querySelector('.overview-container');
    const histView = document.getElementById('historyView');
    if (ovContainer) ovContainer.classList.remove('hidden');
    if (histView) histView.classList.add('hidden');

    // 1. Set Date
    const today = getCurrentISTDate();
    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateStr = today.toLocaleDateString('en-IN', { ...dateOptions, timeZone: 'Asia/Kolkata' });
    const modalDate = document.getElementById('modalDate');
    if (modalDate) modalDate.textContent = dateStr;

    // 2. Fetch Monthly Stats
    try {
        const result = await apiCall('monthly-stats', 'GET', {
            employee_id: currentUser.id
        });

        if (result && result.success && result.stats) {
            const stats = result.stats;

            // Populate Hero Card
            const totalDaysEl = document.getElementById('ovTotalDays');
            // Backend returns: office_days, wfh_days, half_days, client_days
            const officeCount = stats.office_days || 0;
            const wfhCount = stats.wfh_days || 0;
            const halfCount = stats.half_days || 0;

            // Total Days calculation
            const total = officeCount + wfhCount + halfCount;
            if (totalDaysEl) totalDaysEl.textContent = stats.total_working_days || total;

            // Populate Grid
            const officeEl = document.getElementById('ovOffice');
            const wfhEl = document.getElementById('ovWFH');
            const halfDayEl = document.getElementById('ovHalfDay');
            const leavesEl = document.getElementById('ovLeaves');

            if (officeEl) officeEl.textContent = officeCount;
            if (wfhEl) wfhEl.textContent = wfhCount;
            if (halfDayEl) halfDayEl.textContent = halfCount;

            // Leaves are fetched from profile separately, but if present in stats use them, else ignored here (handle in profile fetch if needed)
            if (leavesEl) leavesEl.textContent = stats.leave_days || 0;

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

                        <div style="flex-shrink: 0;">
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

async function openAttendanceCalendar() {
    if (!currentUser) {
        showNotification('Please login first', 'error');
        return;
    }

    const now = getCurrentISTDate();
    currentCalendarMonth = now.getMonth();
    currentCalendarYear = now.getFullYear();
    await buildAttendanceCalendar(currentCalendarYear, currentCalendarMonth);
    openModal('calendarModal');
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
    const grid = document.getElementById('calendarGrid');
    const label = document.getElementById('calendarMonthLabel');
    if (!grid || !label) return;

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

    // Fetch attendance records and requests in parallel
    const [attendanceRes, requestsRes] = await Promise.all([
        apiCall('attendance-records', 'GET', { employee_id: currentUser.id }),
        apiCall('my-requests', 'GET', { employee_id: currentUser.id })
    ]);

    const allRecords = (attendanceRes && attendanceRes.success && Array.isArray(attendanceRes.records)) ? attendanceRes.records : [];
    const allRequests = (requestsRes && requestsRes.success && Array.isArray(requestsRes.requests)) ? requestsRes.requests : [];

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

    const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Empty cells before first day
    for (let i = 0; i < firstDay; i++) {
        const empty = document.createElement('div');
        empty.className = 'calendar-day';
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

        // Add tooltip details for past dates/records


        // Add tooltip details for past dates/records
        if (record) {
            let tooltipLines = [];
            if (record.check_in_time) tooltipLines.push(`In: ${record.check_in_time}`);
            if (record.check_out_time) tooltipLines.push(`Out: ${record.check_out_time}`);

            if (record.total_hours) {
                const h = Number(record.total_hours);
                if (!isNaN(h) && h > 0) {
                    tooltipLines.push(`Hrs: ${Math.floor(h)}h ${Math.round((h % 1) * 60)}m`);
                }
            }
            if (tooltipLines.length > 0) {
                // Remove native title
                cell.removeAttribute('title');
                const tooltipText = tooltipLines.join('\n');
                cell.onmouseenter = (e) => showCalendarTooltip(e, tooltipText);
                cell.onmousemove = (e) => showCalendarTooltip(e, tooltipText); // Follow mouse
                cell.onmouseleave = () => hideCalendarTooltip();
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
            cell.title = "Click to Request Leave/WFH";

            // Restore selection state if re-rendering (e.g. month change)
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            if (selectedCalendarDates.includes(dateStr)) {
                cell.classList.add('selected');
            }
        }

        cell.className = cls;
        cell.textContent = day;
        grid.appendChild(cell);
    }
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
            window.currentAttendanceRecord = record;

            // Helper to format time (HH:MM AM/PM)
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
                html += `<div id="statusMiniMap" onclick="openMapModal()" style="height: 180px; width: 100%; margin-top: 12px; border-radius: 8px; z-index: 1; cursor: pointer; position: relative;">
                            <div style="position: absolute; bottom: 8px; right: 8px; background: rgba(255,255,255,0.9); padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; box-shadow: 0 2px 4px rgba(0,0,0,0.1); z-index: 1000;">View Full Map ⤢</div>
                         </div>`;
                html += `</div>`;
                timingElement.innerHTML = html;

                // Initialize Mini Map
                setTimeout(() => {
                    if (window.statusMap) {
                        window.statusMap.off();
                        window.statusMap.remove();
                        window.statusMap = null;
                    }

                    const mapEl = document.getElementById('statusMiniMap');
                    if (mapEl && typeof L !== 'undefined') {
                        const map = L.map('statusMiniMap', {
                            zoomControl: false,
                            attributionControl: false,
                            dragging: false,
                            scrollWheelZoom: false,
                            doubleClickZoom: false,
                            boxZoom: false
                        });
                        window.statusMap = map;

                        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                            maxZoom: 19,
                        }).addTo(map);

                        const markers = [];

                        const createEmojiIcon = (emoji) => {
                            const gender = (record.gender || 'other').toLowerCase();
                            let markerImage = '/static/images/marker-user.jpeg';

                            if (gender === 'male') {
                                markerImage = '/static/images/marker-user.png';
                            } else if (gender === 'female') {
                                markerImage = '/static/images/marker-female.png';
                            }

                            return L.divIcon({
                                className: 'custom-emoji-marker',
                                html: `<img src="${markerImage}" style="width: 100%; height: 100%; object-fit: contain;">`,
                                iconSize: [40, 40],
                                iconAnchor: [20, 20],
                                popupAnchor: [0, -28]
                            });
                        };

                        // 1. Check-In Location
                        if (record.check_in_location) {
                            try {
                                const loc = typeof record.check_in_location === 'string' ? JSON.parse(record.check_in_location) : record.check_in_location;
                                const lat = loc.latitude || loc.lat;
                                const lon = loc.longitude || loc.lon || loc.lng;
                                if (lat && lon) {
                                    const timeStr = record.check_in_time ? new Date(`1970-01-01T${record.check_in_time}`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                                    const marker = L.marker([lat, lon], { icon: createEmojiIcon('🧍') }).addTo(map).bindPopup(`Check In: ${timeStr}`);
                                    markers.push(marker);
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
                                    const marker = L.marker([lat, lon], { icon: createEmojiIcon('👋') }).addTo(map).bindPopup(`Check Out: ${timeStr}`);
                                    markers.push(marker);
                                }
                            } catch (e) { console.error('Error parsing check_out location', e); }
                        }

                        if (markers.length > 0) {
                            const group = new L.featureGroup(markers);
                            if (map) map.fitBounds(group.getBounds(), { padding: [20, 20] });
                        } else {
                            if (map) map.setView([20.5937, 78.9629], 4);
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

        const monthlyDaysElement = document.getElementById('monthlyDays');
        if (monthlyDaysElement && result.success && result.stats) {
            monthlyDaysElement.textContent = result.stats.total_days || 0;
        }
    } catch (error) {
        console.error('Error loading monthly stats:', error);
    }
}

async function loadWFHEligibility() {
    try {
        const result = await apiCall('wfh-eligibility', 'GET', {
            employee_id: currentUser.id,
            date: getCurrentDateTime().date
        });

        const statWFH = document.getElementById('statWFH');
        const statLeaves = document.getElementById('statLeaves');
        const wfhRing = document.getElementById('wfhRing');
        const leavesRing = document.getElementById('leavesRing');

        if (result) {
            const currentCount = result.current_count || 0;
            const maxWfhLimit = 2; // Monthly WFH limit

            // Fetch approved leave requests for current month
            const now = getCurrentISTDate();
            const year = now.getFullYear();
            const month = now.getMonth() + 1;

            const leaveRequestsResult = await apiCall('my-requests', 'GET', {
                employee_id: currentUser.id
            });

            console.log('DEBUG: Leave requests result:', leaveRequestsResult);

            let leavesUsed = 0;
            if (leaveRequestsResult && leaveRequestsResult.success && leaveRequestsResult.requests) {
                console.log('DEBUG: All requests:', leaveRequestsResult.requests);

                // Use safe date parser to avoid UTC shifts (same as calendar logic)
                const parseDate = (s) => {
                    const parts = s.split('-');
                    return new Date(parts[0], parts[1] - 1, parts[2]);
                };

                const filteredLeaves = leaveRequestsResult.requests.filter(req => {
                    console.log('DEBUG: Checking request:', req);
                    if (req.type !== 'full_day' || req.status !== 'approved') {
                        console.log('DEBUG: Rejected - type or status mismatch', { type: req.type, status: req.status });
                        return false;
                    }
                    const reqDate = parseDate(req.start_date);
                    const matches = reqDate.getFullYear() === year && (reqDate.getMonth() + 1) === month;
                    console.log(`DEBUG: Date check - reqDate: ${reqDate}, year: ${year}, month: ${month}, matches: ${matches}`);
                    return matches;
                });
                console.log('DEBUG: Filtered leaves for current month:', filteredLeaves);
                leavesUsed = filteredLeaves.length;
            }

            const maxLeaveLimit = 1; // Monthly leave limit

            // Update WFH
            if (statWFH) {
                statWFH.textContent = `${currentCount}/${maxWfhLimit}`;
                statWFH.style.color = currentCount >= maxWfhLimit ? '#ef4444' : '#10b981';

                // Animate Ring (Circumference ~ 201)
                if (wfhRing) {
                    const wfhPercent = Math.min((currentCount / maxWfhLimit), 1);
                    const wfhOffset = 201 - (wfhPercent * 201);
                    wfhRing.style.strokeDashoffset = wfhOffset;
                }
            }

            // Update Leaves
            if (statLeaves) {
                statLeaves.textContent = `${leavesUsed}/${maxLeaveLimit}`;
                statLeaves.style.color = leavesUsed >= maxLeaveLimit ? '#ef4444' : '#10b981';

                // Animate Ring (Circumference ~ 201)
                if (leavesRing) {
                    const leavesPercent = Math.min((leavesUsed / maxLeaveLimit), 1);
                    const leavesOffset = 201 - (leavesPercent * 201);
                    leavesRing.style.strokeDashoffset = leavesOffset;
                }
            }
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


// Computes "Location Status" on the dashboard and updates the UI
async function checkAndUpdateLocationStatus(updateAttendance = true) {
    const statusEl = document.getElementById('locationStatus');
    const distEl = document.getElementById('locationDistance');

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

    // 3) Try to get position with good timeouts
    try {
        const pos = await new Promise((resolve, reject) => {
            let settled = false;
            const guard = setTimeout(() => { if (!settled) { settled = true; reject(Object.assign(new Error('timeout'), { code: 3 })); } }, 8000);
            navigator.geolocation.getCurrentPosition(
                (p) => { if (!settled) { settled = true; clearTimeout(guard); resolve(p); } },
                (err) => { if (!settled) { settled = true; clearTimeout(guard); reject(err); } },
                { enableHighAccuracy: true, timeout: 7000, maximumAge: 60000 }
            );
        });

        const { latitude: lat, longitude: lng } = pos.coords;

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
            if (updateAttendance) { isUserGeoInRange = false; updateCheckOutButtonState(); }
            return { inRange: false }; // <-- MODIFIED (logically required)
        }

        const inRange = nearest.d <= (nearest.office.radius_meters || 0);
        statusEl.textContent = inRange ? 'In Office Range' : 'Out of Range';
        statusEl.className = 'stat-card-value ' + (inRange ? 'success' : 'warning');
        distEl.textContent = `${nearest.office.name} • ${Math.round(nearest.d)} m`;
        if (updateAttendance) { isUserGeoInRange = inRange; updateCheckOutButtonState(); }
        return { inRange: inRange }; // <-- MODIFIED

    } catch (err) {
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
        return { inRange: false }; // <-- MODIFIED
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
    // --- MANDATORY LOCATION GATE ---
    // Before showing the attendance screen, ensure location is accessible.
    if (!currentPhotoLocation) {
        showNotification('Requesting location access...', 'info');
        try {
            const pos = await new Promise((res, rej) =>
                navigator.geolocation.getCurrentPosition(res, rej, {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 0
                })
            );
            currentPhotoLocation = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy
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
                }
            };
        } catch (e) { /* Permissions API not available, skip */ }
    }
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
                    { enableHighAccuracy: false, timeout: 4500, maximumAge: 60000 }
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

    // ---------- 3) Check for APPROVED WFH request ----------
    try {
        const today = getCurrentDateTime().date;
        const r = await apiCall('wfh-eligibility', 'GET', { employee_id: currentUser.id, date: today });

        // New logic: Only enable if there is an approved request
        if (r && r.has_approved_request === true) {
            // Authorized
            wfhStatus.textContent = 'Approved for today';
            wfhStatus.style.color = 'var(--success-color)';
            wfhOption.classList.remove('disabled');
            if (requestBtn) requestBtn.style.display = 'none';
        } else {
            // Not authorized
            wfhStatus.textContent = 'Approval required';
            wfhStatus.style.color = 'var(--warning-color)';
            wfhOption.classList.add('disabled');
            // Hide the request button here as requests should be made via the calendar/requests modal
            if (requestBtn) requestBtn.style.display = 'none';
        }

    } catch (e) {
        console.error("WFH check failed", e);
        // Fallback: disable to be safe
        wfhStatus.textContent = 'Status unknown';
        wfhOption.classList.add('disabled');
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

    try {
        const res = await apiCall('wfh-request', 'POST', {
            employee_id: currentUser.id,
            date: getCurrentDateTime().date,
            reason: note
        });
        if (res && res.success) {
            showNotification('WFH request sent to Admin/HR', 'success');
            return;
        }
    } catch { }

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

    // Try to get current position
    navigator.geolocation.getCurrentPosition(
        (pos) => {
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
            timeout: 8000,
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

    // Start fetching location for photo overlay (High Accuracy & Watch)
    if (navigator.geolocation) {
        // Clear any existing watch
        if (window.geoWatchId) navigator.geolocation.clearWatch(window.geoWatchId);

        window.geoWatchId = navigator.geolocation.watchPosition(
            (pos) => {
                currentPhotoLocation = {
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    accuracy: pos.coords.accuracy
                };
            },
            (err) => {
                console.warn('Location watch failed', err);
                // Don't nullify immediately if we had a fix, unless it's critical
            },
            {
                enableHighAccuracy: true, // Request best possible results (GPS)
                timeout: 10000,
                maximumAge: 0
            }
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

        // Show accuracy toast/warning if needed
        const accElement = document.getElementById('cameraAccuracy') || document.createElement('div');
        accElement.id = 'cameraAccuracy';
        accElement.style = 'position:absolute; top:10px; left:10px; background:rgba(0,0,0,0.5); color:white; padding:5px; border-radius:4px; font-size:12px; z-index:10;';
        accElement.innerText = 'Waiting for GPS...';

        const camContainer = document.querySelector('.camera-box') || video.parentElement;
        if (camContainer && !document.getElementById('cameraAccuracy')) {
            camContainer.style.position = 'relative'; // Ensure positioning context
            camContainer.appendChild(accElement);
        }

        // Poll for accuracy updates to show user
        window.accInterval = setInterval(() => {
            const el = document.getElementById('cameraAccuracy');
            if (el && currentPhotoLocation) {
                const acc = Math.round(currentPhotoLocation.accuracy);
                el.innerText = `GPS Accuracy: ±${acc}m`;
                el.style.backgroundColor = acc > 200 ? 'rgba(255,0,0,0.6)' : 'rgba(0,128,0,0.6)';
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

    // Draw the frame from video onto canvas (mirrored)
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
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
            // Using OSM Nominatim for reverse geocoding
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
        } catch (e) {
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

    // Try to draw real OSM tile
    let mapDrawn = false;
    if (lat !== 0 && lng !== 0) {
        try {
            const zoom = 15;
            const xtile = lon2tile(lng, zoom);
            const ytile = lat2tile(lat, zoom);
            const tileUrl = `https://tile.openstreetmap.org/${zoom}/${xtile}/${ytile}.png`;

            const mapImg = new Image();
            mapImg.crossOrigin = "Anonymous"; // Crucial for toDataURL
            mapImg.src = tileUrl;

            await new Promise((resolve) => {
                mapImg.onload = () => {
                    // Draw tile: this isn't perfectly centered but gives "exact map view" of the area
                    ctx.drawImage(mapImg, mapX, mapY, mapSize, mapSize);

                    // Draw Red Pin centered on the map box (approximate for the tile)
                    const pinX = mapX + mapSize / 2;
                    const pinY = mapY + mapSize / 2 - 5;
                    ctx.fillStyle = '#ea4335';
                    ctx.beginPath();
                    ctx.arc(pinX, pinY, 5, 0, Math.PI * 2);
                    ctx.fill();

                    // "OpenStreetMap" label
                    ctx.fillStyle = 'rgba(0,0,0,0.5)';
                    ctx.fillRect(mapX, mapY + mapSize - 12, mapSize, 12);
                    ctx.fillStyle = '#fff';
                    ctx.font = '8px sans-serif';
                    ctx.fillText('OSM', mapX + 2, mapY + mapSize - 3);

                    mapDrawn = true;
                    resolve();
                };
                mapImg.onerror = resolve; // Fallback if fails
            });
        } catch (e) {
            console.warn("Map tile load failed", e);
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

    // Stop tracking
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

    // Stop tracking
    stopFaceTracking();
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

        const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions());
        const displaySize = { width: video.offsetWidth, height: video.offsetHeight };

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
        // We use the high-accuracy location fetched during camera preview
        if (!currentPhotoLocation) {
            // Try to force one last fetch if missing (fallback)
            try {
                const pos = await new Promise((res, rej) =>
                    navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 5000 })
                );
                currentPhotoLocation = {
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    accuracy: pos.coords.accuracy
                };
            } catch (e) {
                showNotification('Location access is mandatory. Please enable GPS and try again.', 'error');
                return; // Stop submission
            }
        }

        // Accuracy Check (e.g., must be better than 1000m to be useful, ideally <100m)
        // User complained about accuracy, so we enforce a reasonable limit.
        // 200m is a safe upper bound for "being at the office/home" vs "in the neighborhood".
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
        else {
            showNotification((r && r.message) || 'Failed to mark attendance', 'error');
        }
    } finally {
        markBtn.disabled = false; markBtnText.classList.remove('hidden'); markSpinner.classList.add('hidden');
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

        // 1️⃣ Before 4.5 hours → do NOT allow check-out at all
        if (workHours < 4.5) {
            showNotification(
                'You cannot check out before completing 4.5 hours of work.',
                'error'
            );
            return;
        }

        // Save context for confirmCheckOut()
        currentCheckOutContext = { record, workHours };

        const totalMins = Math.max(0, Math.round(workHours * 60));
        const hh = Math.floor(totalMins / 60);
        const mm = totalMins % 60;

        // Populate modal
        const detailsDiv = document.getElementById('checkOutDetails');
        detailsDiv.innerHTML = `
            <div style="margin-bottom: 12px;"><strong>Office:</strong> ${record.office_name || 'N/A'}</div>
            <div style="margin-bottom: 12px;"><strong>Check In:</strong> ${record.check_in_time}</div>
            <div style="margin-bottom: 12px;"><strong>Current Time:</strong> ${getCurrentDateTime().time}</div>
            <div style="margin-bottom: 12px;"><strong>Work Hours:</strong> ${hh}h ${mm}m</div>
        `;

        const halfDayWarning = document.getElementById('halfDayWarning');
        if (workHours < 8) {
            halfDayWarning.classList.remove('hidden');
        } else {
            halfDayWarning.classList.add('hidden');
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

        // Safety: block if somehow still < 4.5 hours
        if (workHours < 4.5) {
            showNotification(
                'You cannot check out before completing 4.5 hours of work.',
                'error'
            );
            return;
        }

        // 2️⃣ Between 4.5 and 8 hours → warning + confirmation
        if (workHours < 8) {
            const proceed = await showConfirm(
                `You have worked ${workHours.toFixed(2)} hours. ` +
                'You have worked less than 8 hours. This will be marked as a half day.',
                'Half Day Warning',
                '⏳'
            );
            if (!proceed) {
                return; // user cancelled
            }
        }

        // Try to get location, but don't block checkout if it fails
        let location = null;
        if (navigator.geolocation) {
            try {
                const position = await new Promise((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
                });
                location = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude
                };
            } catch (geoErr) {
                console.warn('Checkout without location (non-blocking):', geoErr);
            }
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


// To allow admins/managers to view specific employee records
let overrideRecordsEmployeeId = null;
let overrideRecordsEmployeeName = null;

function viewEmployeeRecords(empId, empName) {
    overrideRecordsEmployeeId = empId;
    overrideRecordsEmployeeName = empName;
    document.querySelector('#recordsScreen .header-title').textContent = `Attendance Records: ${empName}`;
    window._keepOverrideFilter = true;
    showScreen('recordsScreen');
}

async function loadAttendanceRecords(isMore = false) {
    try {
        const recordsContent = document.getElementById('recordsContent');

        if (!isMore) {
            attendanceDaysOffset = 0;
            allAttendanceRecords = [];
            recordsContent.innerHTML = `
                <div class="text-center" style="padding: 40px;">
                    <div class="loading-spinner" style="margin: 0 auto 16px; width: 24px; height: 24px;"></div>
                    <p>Loading attendance records.</p>
                </div>
            `;
        } else {
            const btn = document.getElementById('loadMoreAttendanceBtn');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<div class="loading-spinner" style="width:16px; height:16px; margin:0 auto;"></div>';
            }
        }

        const params = {
            days_limit: 1,
            days_offset: attendanceDaysOffset
        };

        // For non-admin users (employees), fetch last 6 months of data
        if (currentUser.role !== 'admin' && currentUser.role !== 'manager') {
            params.employee_id = currentUser.id;
            // No strict 6-month limit here if we want true pagination, but we can keep it as a safety
            const today = getCurrentISTDate();
            const sixMonthsAgo = getCurrentISTDate();
            sixMonthsAgo.setMonth(today.getMonth() - 6);
            params.start_date = formatDate(sixMonthsAgo);
            params.end_date = formatDate(today);
        } else if (overrideRecordsEmployeeId) {
            // If an Admin/Manager clicked "Records" on a specific user
            params.employee_id = overrideRecordsEmployeeId;
        } else if (currentUser.role === 'manager') {
            // If manager clicked "Records" from main dashboard, show their personal records
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
                recordsContent.innerHTML = '<div class="text-center" style="padding: 40px;"><p>No records found.</p></div>';
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
    attendanceDaysOffset++;
    await loadAttendanceRecords(true);
}

// 2) Render table with search toolbar
function renderAttendanceTable(records) {
    const recordsContent = document.getElementById('recordsContent');
    const oldSearchVal = document.getElementById('attendanceSearchInput')?.value || '';

    if (!records || records.length === 0) {
        recordsContent.innerHTML = `
            <div class="text-center" style="padding: 40px;">
                <p style="color: var(--gray-500);">No attendance records found.</p>
            </div>
        `;
        return;
    }

    recordsContent.innerHTML = `
        <div class="records-toolbar">
            <div class="records-toolbar-left">Attendance Records</div>
            <input id="attendanceSearchInput"
                    class="form-control records-search-input"
                    placeholder="Search by name / username / date"
                    value="${oldSearchVal}"
                    onkeyup="if (event.key === 'Enter') applyAttendanceSearch();">
            <button class="btn btn-secondary" onclick="applyAttendanceSearch()">Search</button>
            <button class="btn" onclick="clearAttendanceSearch()">Clear</button>
        </div>
        <div id="attendanceListContainer"></div>
        ${attendanceHasMore ? `
            <div class="text-center" style="margin-top: 24px; margin-bottom: 40px;">
                <button id="loadMoreAttendanceBtn" class="btn btn-primary" onclick="loadMoreAttendanceRecords()" style="padding: 12px 32px; font-weight: 600; border-radius: 12px; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25);">
                    Load Previous Day
                </button>
            </div>
        ` : ''}
    `;

    const listContainer = document.getElementById('attendanceListContainer');

    if (currentUser.role === 'admin' || currentUser.role === 'manager') {
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
function applyAttendanceSearch() {
    const input = document.getElementById('attendanceSearchInput');
    if (!input) return;

    const term = input.value.trim().toLowerCase();
    let filtered = allAttendanceRecords || [];

    if (term) {
        filtered = filtered.filter(r => {
            const name = (r.employee_name || r.name || '').toLowerCase();
            const username = (r.username || '').toLowerCase();
            const dateRaw = (r.date || '').toLowerCase();

            // Add display date formatted
            const dateObj = new Date(r.date);
            const dateDisplay = dateObj.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            }).toLowerCase();

            return (
                name.includes(term) ||
                username.includes(term) ||
                dateRaw.includes(term) ||
                dateDisplay.includes(term)
            );
        });

    }

    const listContainer = document.getElementById('attendanceListContainer');
    if (!listContainer) return;

    if (!filtered.length) {
        listContainer.innerHTML = `
            <div class="text-center" style="padding: 40px;">
                <p style="color: var(--gray-500);">No records matched your search.</p>
            </div>
        `;
        return;
    }

    if (currentUser.role === 'admin' || currentUser.role === 'manager') {
        renderAdminDayWiseView(filtered, listContainer);
    } else {
        renderUserMonthWiseView(filtered, listContainer);
    }
}

function clearAttendanceSearch() {
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
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'manager')) {
        showNotification('Admins only.', 'warning');
        return;
    }
    showScreen('adminScreen');

    const promises = [
        refreshAdminOffices(),
        refreshAdminUsers(),
        refreshPrimaryOfficeSelects(),
        refreshManagerDropdown(),
        refreshAdminProfiles()          // 🔹 load extended user details
    ];

    if (currentUser.role === 'manager') {
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

        // Manager needs to fetch these when opening the panel
        promises.push(loadAdminSummary());
        promises.push(loadUpcomingBirthdays());
        promises.push(loadPendingRequests());
        promises.push(loadActiveTasks());

        // Hide Intelligence Hub for managers as requested
        document.getElementById('intelligenceHubCard')?.classList.add('hidden');


        // Show specific Admin Panel action buttons for managers
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
        officeMap = L.map('officeLocationMap').setView([currentLat, currentLng], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(officeMap);

        officeMarker = L.marker([currentLat, currentLng], { draggable: true }).addTo(officeMap);

        officeMap.on('click', function (e) {
            updatePickerMarker(e.latlng.lat, e.latlng.lng);
        });

        officeMarker.on('dragend', function (e) {
            const pos = officeMarker.getLatLng();
            updatePickerMarker(pos.lat, pos.lng);
        });
    } else {
        officeMap.setView([currentLat, currentLng], 13);
        officeMarker.setLatLng([currentLat, currentLng]);
        // Fix Leaflet sizing in modal
        setTimeout(() => officeMap.invalidateSize(), 200);
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
        { enableHighAccuracy: true, timeout: 5000 }
    );
}

/* 🔍 Search: Find location by name (Geocoding) */
async function searchMapLocation() {
    const query = document.getElementById('mapSearchInput').value.trim();
    if (!query) return;

    const btn = document.querySelector('button[onclick="searchMapLocation()"]');
    const originalText = btn.textContent;
    btn.textContent = 'Searching...';
    btn.disabled = true;

    try {
        // Using OpenStreetMap Nominatim API (Free)
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
        const data = await response.json();

        if (data && data.length > 0) {
            const result = data[0];
            const lat = parseFloat(result.lat);
            const lng = parseFloat(result.lon);

            updatePickerMarker(lat, lng);
            officeMap.setView([lat, lng], 15);

            document.getElementById('mapPickerStatus').textContent = `Found: ${result.display_name.split(',')[0]}`;
        } else {
            showNotification("Location not found", "warning");
        }
    } catch (error) {
        console.error("Search failed:", error);
        showNotification("Search service unavailable", "error");
    } finally {
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
    let res = await fetch(`${apiBaseUrl}/office/${id}`, { method: 'DELETE' })
        .then(r => r.json()).catch(() => null);
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
        <tr><td colspan="7">
            <div class="text-center" style="padding:12px;"><div class="loading-spinner" style="margin:0 auto;"></div> Loading users…</div>
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
        tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding:20px; color:var(--gray-500)">No matching users found.</td></tr>';
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

        return `
            <tr>
                <td>${u.id}</td>
                <td>${u.name || ''} ${birthdayAction}</td>
                <td>${u.username || ''}</td>
                <td>${u.phone || ''}</td>
                <td>${u.department || ''}</td>
                <td>${u.role || ''}</td>
                <td>${u.manager_name || '<small class="text-muted">None</small>'}</td>
                <td style="white-space:nowrap;">
                    <button class="btn btn-secondary" style="background:#3b82f6;color:#fff" onclick="showEmployeePerformanceAnalysis(${u.id})">Stats</button>
                    <button class="btn btn-secondary" onclick="viewEmployeeRecords(${u.id}, '${u.name}')">Records</button>
                    ${adminActions}
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
        (u.phone && u.phone.includes(query))
    );
    renderAdminUsers(filtered);
}

async function refreshManagerDropdown() {
    const sel = document.getElementById('newUserReportingManager');
    if (!sel) return;
    try {
        const res = await apiCall('employees-simple', 'GET');
        if (res && res.success && Array.isArray(res.employees)) {
            // Filter for admins and managers
            const potentials = res.employees.filter(emp => emp.role === 'admin' || emp.role === 'manager');
            sel.innerHTML = '<option value="none">No Manager</option>' +
                potentials.map(emp => `<option value="${emp.id}">${emp.name} (${emp.role})</option>`).join('');
        }
    } catch (e) {
        console.error('Failed to refresh manager dropdown', e);
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
        manager_id: document.getElementById('newUserReportingManager').value,
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
    document.getElementById('newUserReportingManager').value = 'none';
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
        document.getElementById('newUserReportingManager').value = u.manager_id || 'none';
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

    // Try real DELETE
    let res = await fetch(`${apiBaseUrl}/admin-user/${id}`, { method: 'DELETE' })
        .then(r => r.json()).catch(() => null);

    if (!res || res.success !== true) {
        // Fallback: POST with _method=DELETE in body
        res = await fetch(`${apiBaseUrl}/admin-user/${id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ _method: 'DELETE' })
        }).then(r => r.json()).catch(() => null);
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
        setFieldValue('profileReportingMgr', p.reporting_manager);

        setFieldValue('profileSkillSet', p.skill_set);
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
            reporting_manager: getFieldValue('profileReportingMgr'),
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
            formData.append('user_photo', photoFile);
            anySelected = true;
        }
        if (signFile) {
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
        const response = await fetch(url, {
            method: 'POST',
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

        card.innerHTML = `
            <input type="checkbox" class="my-doc-checkbox" value="${doc.id}">
            ${preview}
            <div class="my-doc-name">${label}</div>
            <div class="my-doc-actions">
                <a href="${doc.url}" target="_blank">View</a>
                <a href="${doc.url}" download>Download</a>
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
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'manager')) {
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
        errorDiv.textContent = 'Please select both dates';
        errorDiv.style.display = 'block';
        return;
    }

    if (new Date(fromDate) > new Date(toDate)) {
        errorDiv.textContent = 'From date cannot be after To date';
        errorDiv.style.display = 'block';
        return;
    }

    const btn = document.getElementById('confirmExportBtn');
    const btnText = document.getElementById('exportBtnText');
    const spinner = document.getElementById('exportSpinner');
    const typeSelect = document.getElementById('exportTypeSelect');
    const selectedType = typeSelect ? typeSelect.value : 'all';

    btn.disabled = true;
    btnText.classList.add('hidden');
    spinner.classList.remove('hidden');
    errorDiv.style.display = 'none';

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

        if (!res || !res.success || !Array.isArray(res.records)) {
            throw new Error('Failed to fetch attendance records');
        }

        const records = res.records;
        if (!records.length) {
            throw new Error('No records found for selected criteria');
        }

        /* ---------------- BUILD REGISTER ---------------- */

        const dateRange = getDateRange(fromDate, toDate);
        const employeeMap = {};

        records.forEach(r => {
            if (!employeeMap[r.employee_id]) {
                employeeMap[r.employee_id] = {
                    employee: r.employee_name || r.name || `#${r.employee_id}`,
                    department: r.department || '',
                    type: (r.type || '').toUpperCase(),
                    office: r.office_name || '',
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

            employeeMap[r.employee_id].attendance[r.date] = code;

        });

        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Attendance Register');

        /* ---------- HEADERS ---------- */

        const headers = [
            { header: 'Employee', key: 'employee', width: 22 },
            { header: 'Department', key: 'department', width: 16 },
            { header: 'Type', key: 'type', width: 10 },
            { header: 'Office', key: 'office', width: 20 }
        ];

        dateRange.forEach(d => {
            headers.push({
                header: d.split('-').reverse().slice(0, 2).join('-'),
                key: d,
                width: 8
            });
        });

        ws.columns = headers;

        /* ---------- ROWS ---------- */

        // If filtering by type, default missing days to '-' instead of 'A' (Absent)
        // Because if I filter for WFH, a non-WFH day is not necessarily absent from work, just absent from list.
        const defaultStatus = (selectedType && selectedType !== 'all') ? '-' : 'A';

        Object.values(employeeMap).forEach(emp => {
            const rowData = {
                employee: emp.employee,
                department: emp.department,
                type: emp.type,
                office: emp.office
            };

            dateRange.forEach(d => {
                let cellValue = emp.attendance[d];

                // If no record found OR if record is 'A' (Absent), check for weekend override
                if (!cellValue || cellValue === 'A') {
                    const dateObj = new Date(d);
                    const day = dateObj.getDay(); // 0=Sun, 6=Sat

                    // Mark weekends with full name if no record OR if 'A'
                    if (day === 0) {
                        cellValue = 'Sunday';
                    } else if (day === 6) {
                        cellValue = 'Saturday';
                    } else if (!cellValue) {
                        cellValue = defaultStatus;
                    }
                }

                rowData[d] = cellValue;
            });

            const row = ws.addRow(rowData);

            // Center align all data cells
            dateRange.forEach((d, idx) => {
                const colIndex = 5 + idx;
                const cell = row.getCell(colIndex);
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
            });
        });


        /* ---------- FORMATTING ---------- */

        // Only Bold Headers, NO Background Color
        ws.getRow(1).font = { bold: true };

        ws.views = [{ state: 'frozen', xSplit: 4, ySplit: 1 }];
        ws.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: 1, column: headers.length }
        };

        /* ---------- DOWNLOAD ---------- */

        const buffer = await wb.xlsx.writeBuffer();
        const filename = `attendance_register_${fromDate}_to_${toDate}.xlsx`;

        saveAs(
            new Blob([buffer], { type: 'application/octet-stream' }),
            filename
        );

        showNotification('Attendance register exported successfully');
        closeModal('exportModal');

    } catch (e) {
        console.error(e);
        errorDiv.textContent = e.message;
        errorDiv.style.display = 'block';
        showNotification(e.message, 'error');
    } finally {
        btn.disabled = false;
        btnText.classList.remove('hidden');
        spinner.classList.add('hidden');
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
    allAdminProfiles = (res && res.success && Array.isArray(res.profiles)) ? res.profiles : [];

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
        (p.reporting_manager && p.reporting_manager.toLowerCase().includes(query))
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
            <td>${p.reporting_manager || ''}</td>

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
                        <th>Reporting Manager</th>
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

        row.innerHTML = `
            <label class="doc-item">
                <input type="checkbox" class="doc-check" value="${doc.id}">
                <span class="doc-name">${doc.doc_name}</span>
                <span class="doc-file">(${doc.file_name})</span>
            </label>
            <a class="doc-view" href="${doc.file_path}" target="_blank">View</a>
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

    renderDocsPopup(res.documents);
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
    window.location.href =
        apiBaseUrl + '/admin-user-docs/' + currentDocsUserId;

    closeDocsModal();
}



async function adminDeleteProfile(id) {
    if (!(await showConfirm('Delete extended profile details for this user?', 'Delete Profile', '👤'))) return;

    const res = await fetch(`${apiBaseUrl}/admin-profile/${id}`, {
        method: 'DELETE'
    }).then(r => r.json()).catch(() => null);

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
            ['Reporting Manager', p.reporting_manager || ''],
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
async function exportAllProfilesExcel() {
    try {
        if (!currentUser) {
            showNotification('You must be logged in to export profiles', 'warning');
            return;
        }
        // 1) get the list of users (IDs + usernames, etc.)
        const res = await apiCall('admin-profiles', 'GET', { user_id: currentUser.id });
        const profiles = (res && res.success && Array.isArray(res.profiles)) ? res.profiles : [];

        if (!profiles.length) {
            showNotification('No user profiles to export', 'warning');
            return;
        }

        const workbook = new ExcelJS.Workbook();

        // 2) for each user, fetch full profile via admin-profile/{id}
        for (const summary of profiles) {
            const id = summary.id;
            let p = summary;

            try {
                const detailRes = await apiCall(`admin-profile/${id}`, 'GET', {});
                if (detailRes && detailRes.success && detailRes.profile) {
                    p = detailRes.profile;
                }
            } catch (e) {
                console.warn('Failed to load full profile for', id, e);
                // fallback: use summary only
            }

            const sheetName = (p.username || p.name || ('User' + id)).substring(0, 25) || 'User';
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
                ['Reporting Manager', p.reporting_manager || ''],
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
        }
        // 3) download workbook
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'all_user_profiles.xlsx';
        link.click();
        URL.revokeObjectURL(link.href);

        showNotification('All user profiles Excel downloaded');
    } catch (e) {
        console.error('exportAllProfilesExcel error', e);
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
    }
    toggleRequestPeriod(); // Ensure correct state

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
    }
}


/* Mini Calendar Widget Logic (Async with Employee Data) */
async function generateMiniCalendar() {
    const container = document.getElementById("miniCalendarContainer");
    if (!container) return;

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    // Fetch attendance data for this month
    let statusMap = {};
    if (currentUser) {
        try {
            // Format dates for API: YYYY-MM-DD
            const startDate = new Date(year, month, 1);
            const endDate = new Date(year, month + 1, 0);

            const records = await apiCall("attendance-records", "GET", {
                employee_id: currentUser.id,
                start_date: formatDate(startDate),
                end_date: formatDate(endDate)
            });

            if (records && records.success && Array.isArray(records.data)) {
                records.data.forEach(record => {
                    // record.date is YYYY-MM-DD. record.status is "present", "absent", "wfh", etc.
                    statusMap[record.date] = record.status;
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
        let statusClass = "";

        if (status) {
            if (status === "present") statusClass = "status-present";
            else if (status === "wfh") statusClass = "status-wfh";
            else if (status === "absent") statusClass = "status-absent";
            else if (status === "leave") statusClass = "status-leave";
            else if (status === "half_day") statusClass = "status-half-day";
        }

        gridHtml += `<div class="mini-cal-day ${isToday ? "today" : ""} ${statusClass}" title="${status || ""}">${i}</div>`;
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
                    <span class="req-badge ${req.type === 'wfh' ? 'badge-tech-wfh' : 'badge-tech-leave'}" style="padding: 8px 16px; border-radius: 10px; font-size: 0.9rem; font-weight: 700;">${typeLabel}</span>
                </div>

                <div style="background: #f8fafc; padding: 16px; border-radius: 16px;">
                    <span style="font-size: 0.75rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 8px;">Selected Date</span>
                    <div style="display:flex; align-items:center; gap:8px; font-weight:700; color:#1e293b;">
                        <span style="font-size:1.2rem;">📅</span> ${req.date}
                    </div>
                </div>

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

// ========== Attendance Predictions Functions ==========

async function openPredictionsModal() {
    const modal = document.getElementById('predictionsModal');
    const loadingState = document.getElementById('predictionsLoadingState');
    const content = document.getElementById('predictionsContent');

    modal.classList.add('active');
    loadingState.style.display = 'block';
    content.style.display = 'none';

    try {
        const result = await apiCall('attendance-predictions', 'GET', { employee_id: currentUser.id });

        if (result.success) {
            renderPredictionsTable(result.predictions);
            loadingState.style.display = 'none';
            content.style.display = 'block';
        } else {
            showToast(result.message || 'Failed to load predictions', 'error');
            closePredictionsModal();
        }
    } catch (error) {
        console.error('Error loading predictions:', error);
        showToast('Failed to load predictions', 'error');
        closePredictionsModal();
    }
}

function closePredictionsModal() {
    const modal = document.getElementById('predictionsModal');
    modal.classList.remove('active');
}

function renderPredictionsTable(predictions) {
    const tbody = document.getElementById('predictionsTableBody');
    tbody.innerHTML = '';

    if (!predictions || predictions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--gray-500);">No employee data available</td></tr>';
        return;
    }

    predictions.forEach(pred => {
        const row = document.createElement('tr');
        row.style.borderBottom = '1px solid var(--gray-200)';

        // Employee Name
        const nameCell = document.createElement('td');
        nameCell.style.padding = '16px 12px';
        nameCell.innerHTML = `
            <div style="font-weight: 600;">${pred.employee_name}</div>
            <div style="font-size: 12px; color: var(--gray-500);">${pred.employee_email}</div>
        `;
        row.appendChild(nameCell);

        // Previous 7 Days
        const prevCell = document.createElement('td');
        prevCell.style.padding = '16px 12px';
        prevCell.style.textAlign = 'center';
        const prevRecord = pred.previous_record;
        prevCell.innerHTML = `
            <div style="font-size: 20px; font-weight: 700; color: var(--primary);">${prevRecord.present_days}/${prevRecord.total_days}</div>
            <div style="font-size: 11px; color: var(--gray-500); margin-top: 4px;">
                ${prevRecord.attendance_rate}% attendance
            </div>
        `;
        row.appendChild(prevCell);

        // Current Status
        const currentCell = document.createElement('td');
        currentCell.style.padding = '16px 12px';
        currentCell.style.textAlign = 'center';
        const currentStatus = pred.current_status;
        const statusColor = currentStatus.is_active ? 'var(--success)' : 'var(--gray-400)';
        const statusIcon = currentStatus.is_active ? '✓' : '○';
        currentCell.innerHTML = `
            <div style="font-size: 24px; color: ${statusColor};">${statusIcon}</div>
            <div style="font-size: 11px; color: var(--gray-600); margin-top: 4px; text-transform: capitalize;">
                ${currentStatus.today_status.replace('_', ' ')}
            </div>
        `;
        row.appendChild(currentCell);

        // Next 7 Days Predictions
        const nextCell = document.createElement('td');
        nextCell.style.padding = '16px 12px';
        nextCell.style.textAlign = 'center';
        const predictedDays = pred.predicted_record.filter(p => p.prediction === 'present' || p.prediction === 'wfh').length;
        nextCell.innerHTML = `
            <div style="font-size: 20px; font-weight: 700; color: var(--accent);">${predictedDays}/7</div>
            <div style="font-size: 11px; color: var(--gray-500); margin-top: 4px;">
                days predicted present
            </div>
        `;
        row.appendChild(nextCell);

        // Work Status
        const workStatusCell = document.createElement('td');
        workStatusCell.style.padding = '16px 12px';
        workStatusCell.style.textAlign = 'center';
        const isActive = pred.work_status === 'Active';
        workStatusCell.innerHTML = `
            <span style="
                display: inline-block;
                padding: 6px 12px;
                border-radius: 12px;
                font-size: 12px;
                font-weight: 600;
                background: ${isActive ? 'var(--success-light)' : 'var(--gray-200)'};
                color: ${isActive ? 'var(--success)' : 'var(--gray-600)'};
            ">${pred.work_status}</span>
        `;
        row.appendChild(workStatusCell);

        // Accuracy Rate
        const accuracyCell = document.createElement('td');
        accuracyCell.style.padding = '16px 12px';
        accuracyCell.style.textAlign = 'center';
        const accuracyColor = pred.accuracy_rate >= 80 ? 'var(--success)' : pred.accuracy_rate >= 60 ? 'var(--warning)' : 'var(--error)';
        accuracyCell.innerHTML = `
            <div style="font-size: 18px; font-weight: 700; color: ${accuracyColor};">${pred.accuracy_rate}%</div>
            <div style="font-size: 11px; color: var(--gray-500); margin-top: 4px;">
                prediction accuracy
            </div>
        `;
        row.appendChild(accuracyCell);

        // Performance Score
        const perfCell = document.createElement('td');
        perfCell.style.padding = '16px 12px';
        perfCell.style.textAlign = 'center';
        const perfColor = pred.performance_score >= 80 ? 'var(--success)' : pred.performance_score >= 60 ? 'var(--warning)' : 'var(--error)';
        perfCell.innerHTML = `
            <div style="position: relative; width: 60px; height: 60px; margin: 0 auto;">
                <svg width="60" height="60" style="transform: rotate(-90deg);">
                    <circle cx="30" cy="30" r="25" fill="none" stroke="var(--gray-200)" stroke-width="6"></circle>
                    <circle cx="30" cy="30" r="25" fill="none" stroke="${perfColor}" stroke-width="6"
                        stroke-dasharray="${2 * Math.PI * 25}"
                        stroke-dashoffset="${2 * Math.PI * 25 * (1 - pred.performance_score / 100)}"
                        stroke-linecap="round"></circle>
                </svg>
                <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 14px; font-weight: 700; color: ${perfColor};">
                    ${Math.round(pred.performance_score)}%
                </div>
            </div>
        `;
        row.appendChild(perfCell);

        tbody.appendChild(row);
    });
}

// Intelligence Hub and Predictions card visibility are now handled in loadDashboardData
// End of predictive results section


// ========== Intelligence Hub Functions ==========

let intelligenceHubData = null;
let intelligenceHubRefreshInterval = null;

async function loadIntelligenceHubData() {
    try {
        const result = await apiCall('intelligence-hub-forecast', 'GET', {});

        if (result.success && result.forecast) {
            intelligenceHubData = result.forecast;
            updateIntelligenceHubUI(result); // Pass whole result so data.forecast works

            // Auto-refresh every 5 minutes
            if (intelligenceHubRefreshInterval) {
                clearInterval(intelligenceHubRefreshInterval);
            }
            intelligenceHubRefreshInterval = setInterval(loadIntelligenceHubData, 5 * 60 * 1000);
        }
    } catch (error) {
        console.error('Failed to load Intelligence Hub data:', error);
    }
}

// Update card UI
function updateIntelligenceHubUI(data) {
    const card = document.getElementById('intelligenceHubCard');
    if (!card) return;

    const forecastEl = document.getElementById('hubForecast');
    const confidenceEl = document.getElementById('hubConfidence');
    const subtitleEl = document.getElementById('hubSubtitle');
    const trendBadge = document.getElementById('hubTrendBadge');

    if (data.forecast) {
        const f = data.forecast;
        if (forecastEl) forecastEl.textContent = `${f.percentage}%`;
        if (confidenceEl) confidenceEl.textContent = `${f.confidence}%`;
        if (subtitleEl) subtitleEl.textContent = f.subtitle || `${f.day_name}'s Forecast`;

        if (trendBadge) {
            const trend = (f.trend || 'stable').toLowerCase();
            trendBadge.textContent = trend.toUpperCase();
            trendBadge.className = `intelligence-hub-trend-badge ${trend}`;
        }

        // Update Last Trained Info
        const lastTrainedEl = document.getElementById('lastTrainedText');
        if (lastTrainedEl && f.model_state && f.model_state.last_trained) {
            lastTrainedEl.textContent = `Last Trained: ${f.model_state.last_trained}`;
        }
    }
}

async function trainPredictionModel() {
    // Open the new training modal instead of running immediately
    openModal('trainModelModal');

    // Reset modal state
    document.getElementById('trainingProgressBar').style.width = '0%';
    document.getElementById('trainingProgressText').textContent = 'Ready to calibrate model using historical data';
    document.getElementById('btnStartTraining').disabled = false;
    document.getElementById('btnStartTraining').textContent = 'Start Training Session';

    // Switch to logs tab by default
    switchTrainingTab('logs');

    // Reset logs
    const logContainer = document.getElementById('trainingLogs');
    logContainer.innerHTML = '<div class="log-entry" style="color: #9ca3af;">[SYSTEM] Waiting for training sequence to start...</div>';

    // Load history in background
    loadTrainingHistory();
}

function switchTrainingTab(tab) {
    const logsBtn = document.getElementById('tabLogsBtn');
    const historyBtn = document.getElementById('tabHistoryBtn');
    const logsTab = document.getElementById('trainingLogTab');
    const historyTab = document.getElementById('trainingHistoryTab');

    if (tab === 'logs') {
        logsBtn.classList.add('active');
        historyBtn.classList.remove('active');
        logsBtn.style.borderBottomColor = 'var(--primary-color)';
        logsBtn.style.color = 'var(--primary-color)';
        historyBtn.style.borderBottomColor = 'transparent';
        historyBtn.style.color = 'var(--gray-500)';

        logsTab.classList.remove('hidden');
        historyTab.classList.add('hidden');
    } else {
        logsBtn.classList.remove('active');
        historyBtn.classList.add('active');
        logsBtn.style.borderBottomColor = 'transparent';
        logsBtn.style.color = 'var(--gray-500)';
        historyBtn.style.borderBottomColor = 'var(--primary-color)';
        historyBtn.style.color = 'var(--primary-color)';

        logsTab.classList.add('hidden');
        historyTab.classList.remove('hidden');
        loadTrainingHistory();
    }
}

async function loadTrainingHistory() {
    const container = document.getElementById('trainingHistoryItems');
    container.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--gray-400); font-size: 13px;">Loading history...</div>';

    try {
        const result = await apiCall('intelligence-hub-training-history', 'GET');
        if (result.success && result.history.length > 0) {
            container.innerHTML = result.history.map(item => `
                <div class="history-item">
                    <div class="history-item-header">
                        <span>Calibration #${item.id}</span>
                        <span>${item.timestamp}</span>
                    </div>
                    <div class="history-item-details">
                        <span>📊 ${item.data_points} points</span>
                        <span>📈 Avg: ${item.average_rate}%</span>
                        <span>🎯 Stability: ${item.stability_factor}</span>
                    </div>
                    <div style="font-size: 10px; color: var(--gray-400); margin-top: 4px;">Trained by: ${item.trained_by_name}</div>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--gray-400); font-size: 13px;">No previous training sessions found</div>';
        }
    } catch (error) {
        container.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--error-color); font-size: 13px;">Failed to load history</div>';
    }
}

async function startTrainingProcess() {
    const btn = document.getElementById('btnStartTraining');
    const progressBar = document.getElementById('trainingProgressBar');
    const progressText = document.getElementById('trainingProgressText');
    const logContainer = document.getElementById('trainingLogs');

    btn.disabled = true;
    btn.textContent = 'Training in Progress...';
    logContainer.innerHTML = '';

    const addLog = (msg, type = 'info') => {
        const div = document.createElement('div');
        div.style.marginBottom = '4px';
        const color = type === 'error' ? '#ef4444' : (type === 'system' ? '#9ca3af' : '#10b981');
        const prefix = type === 'error' ? '✖ ' : (type === 'system' ? '⚙ ' : '✔ ');
        div.innerHTML = `<span style="color: ${color}">${prefix} ${msg}</span>`;
        logContainer.appendChild(div);
        logContainer.scrollTop = logContainer.scrollHeight;
    };

    try {
        addLog("Establishing connection to Intelligence Hub...", "system");
        progressBar.style.width = '10%';
        progressText.textContent = 'Initializing engine...';

        // Short delay for UI feel
        await new Promise(r => setTimeout(r, 800));

        addLog("Requesting batch processing of historical records...", "system");
        progressBar.style.width = '25%';
        progressText.textContent = 'Analyzing historical patterns...';

        const result = await apiCall('intelligence-hub-train', 'POST', {
            user_id: currentUser.id
        });

        if (result.success) {
            // "Stream" the logs returned from backend
            if (result.logs && result.logs.length > 0) {
                for (let i = 0; i < result.logs.length; i++) {
                    const log = result.logs[i];
                    addLog(log.message);

                    // Increment progress bar based on log index
                    const progress = 25 + ((i + 1) / result.logs.length) * 75;
                    progressBar.style.width = `${progress}%`;
                    progressText.textContent = `Processing: ${log.message.substring(0, 30)}...`;

                    // Artificial delay for visual feedback
                    await new Promise(r => setTimeout(r, 400));
                }
            }

            progressBar.style.width = '100%';
            progressText.textContent = 'Calibration complete!';
            addLog("Intelligence model successfully recalibrated.", "info");
            addLog(`Final Stability Factor: ${result.summary.stability_factor}`, "info");

            showNotification('Prediction model trained successfully!', 'success');

            // Reload main dashboard data
            await loadIntelligenceHubData();

            btn.textContent = 'Recalibration Successful';
            btn.style.background = 'var(--success-color)';

            // Auto switch to history after a short delay
            setTimeout(() => {
                if (document.getElementById('trainModelModal').classList.contains('active')) {
                    switchTrainingTab('history');
                }
            }, 2000);

        } else {
            addLog(result.message || "Recalibration failed.", "error");
            progressBar.style.background = 'var(--error-color)';
            progressText.textContent = 'Recalibration failed';
            btn.disabled = false;
            btn.textContent = 'Retry Training Session';
        }
    } catch (error) {
        console.error('Training Error:', error);
        addLog("A critical communication error occurred.", "error");
        progressBar.style.background = 'var(--error-color)';
        showNotification('An error occurred during training', 'error');
        btn.disabled = false;
        btn.textContent = 'Retry Training Session';
    }
}

// ========== Predictive Analysis (Trends) Functions ==========

async function viewTrends() {
    try {
        const result = await apiCall('intelligence-hub-trends', 'GET', { days: 30 });

        if (result.success) {
            openPredictiveAnalysisModal(result);
        } else {
            showNotification('Failed to load performance data', 'error');
        }
    } catch (error) {
        console.error('Failed to load trends:', error);
        showNotification('Failed to load performance data', 'error');
    }
}

function openPredictiveAnalysisModal(data) {
    let modal = document.getElementById('predictiveModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'predictiveModal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }

    const summary = data.summary || {};
    const forecast = summary.forecast || 0;
    const predictedEmployees = Math.round(summary.total_employees * (forecast / 100));
    const dayName = getForecastDayName();

    // Determine trend color and icon
    const isIncreasing = summary.trend === 'UP';
    const trendColor = isIncreasing ? '#10b981' : '#ef4444';
    const trendIcon = isIncreasing ? '📈' : '📉';
    const trendText = isIncreasing ? 'Increasing' : 'Decreasing';

    modal.innerHTML = `
        <div class="predictive-modal modal-content" style="padding: 0; overflow: hidden; border: none; max-width: 650px; max-height: 94vh; display: flex; flex-direction: column; border-radius: 32px;">
            <div style="padding: 32px; overflow-y: auto; flex: 1; position: relative; background: #f8fafc;">
                <div class="predictive-header" style="margin-bottom: 24px;">
                    <div class="predictive-title" style="font-size: 24px; font-weight: 850; color: #1e293b; letter-spacing: -0.5px;">
                        <span style="background: rgba(139, 92, 246, 0.1); padding: 12px; border-radius: 16px; margin-right: 14px;">🔮</span> Intelligence Hub
                    </div>
                    <div class="forecast-day-label" style="font-weight: 700; color: var(--gray-500); margin-left: 62px; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">Forecast for ${summary.tomorrow_day || 'Tomorrow'}</div>
                    <button onclick="closePredictiveModal()" style="background: white; border: 1px solid #e2e8f0; font-size: 24px; width: 44px; height: 44px; border-radius: 22px; cursor: pointer; color: var(--gray-400); position: absolute; top: 28px; right: 32px; display: flex; align-items: center; justify-content: center; transition: all 0.2s; box-shadow: 0 4px 6px rgba(0,0,0,0.05); z-index: 10;">&times;</button>
                </div>

                <div class="main-forecast-card" style="padding: 40px 24px; background: linear-gradient(135deg, white 0%, #f1f5f9 100%); border: 1px solid #eef2f6; box-shadow: 0 15px 30px -10px rgba(0,0,0,0.05); border-radius: 28px; margin-bottom: 24px; position: relative; overflow: hidden; display: flex; align-items: center; justify-content: space-between;">
                    <div style="position: absolute; bottom: -30px; left: -20px; width: 150px; height: 150px; background: var(--primary-color); opacity: 0.04; border-radius: 50%;"></div>
                    <div>
                        <div class="main-forecast-value" style="color: var(--primary-color); text-shadow: 0 8px 16px rgba(37, 99, 235, 0.1); font-size: 64px; line-height: 0.9; font-weight: 900;">${Math.round(forecast)}%</div>
                        <div class="main-forecast-caption" style="color: var(--gray-500); font-weight: 800; letter-spacing: 1.5px; font-size: 11px; margin-top: 14px; display: flex; align-items: center; gap: 8px;">
                            DATA RELIABILITY: ${Math.round(summary.confidence)}%
                            <span style="width: 4px; height: 4px; background: #cbd5e1; border-radius: 2px;"></span>
                            Streak: <span style="color: var(--success-color);">${summary.attendance_streak}d 🔥</span>
                        </div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 16px; font-weight: 700; color: var(--gray-800);">~${predictedEmployees} Active</div>
                        <div style="font-size: 11px; color: var(--gray-400); margin-top: 4px; font-weight: 600;">Total Personnel Pool: ${summary.total_employees}</div>
                        <!-- Sparkline -->
                        <div style="margin-top: 16px; height: 30px;">
                            <svg width="100" height="30" style="overflow: visible;">
                                <path d="M ${(summary.trend_history || []).map((v, i) => `${i * 15} ${30 - (v / 100 * 30)}`).join(' L ')}" fill="none" stroke="var(--primary-color)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
                                <circle cx="${(summary.trend_history?.length - 1) * 15 || 0}" cy="${30 - ((summary.trend_history?.[summary.trend_history?.length - 1] || 0) / 100 * 30)}" r="3" fill="var(--primary-color)" />
                            </svg>
                        </div>
                    </div>
                </div>

                <!-- NEW: Dynamic Analytics Section -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px;">
                    <!-- Arrival Pattern -->
                    <div style="background: white; padding: 20px; border-radius: 24px; border: 1px solid #eef2f6; display: flex; flex-direction: column; justify-content: space-between;">
                        <div style="font-size: 10px; font-weight: 800; color: var(--gray-400); text-transform: uppercase; margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
                            <span>⏱️</span> Arrival Efficiency
                        </div>
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px;">
                            <div>
                                <div style="font-size: 22px; font-weight: 900; color: #1e293b;">${Math.round(100 - summary.late_rate)}%</div>
                                <div style="font-size: 10px; color: var(--success-color); font-weight: 800; white-space: nowrap;">ON-TIME ARRIVAL</div>
                            </div>
                            <div style="text-align: right;">
                                <div style="font-size: 14px; font-weight: 700; color: var(--gray-700);">${summary.peak_hour.split(' - ')[0]}</div>
                                <div style="font-size: 10px; color: var(--gray-400); font-weight: 600; white-space: nowrap;">Peak Start</div>
                            </div>
                        </div>
                        <div style="height: 6px; width: 100%; background: #f1f5f9; border-radius: 3px; overflow: hidden;">
                            <div style="height: 100%; width: ${Math.round(100 - summary.late_rate)}%; background: var(--success-color); border-radius: 3px;"></div>
                        </div>
                    </div>
                    
                    <!-- Busiest Day Impact -->
                    <div style="background: white; padding: 20px; border-radius: 24px; border: 1px solid #eef2f6; display: flex; flex-direction: column; justify-content: space-between;">
                        <div style="font-size: 10px; font-weight: 800; color: var(--gray-400); text-transform: uppercase; margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
                            <span>📈</span> Load Intensity
                        </div>
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px;">
                            <div>
                                <div style="font-size: 22px; font-weight: 900; color: #1e293b;">+${Math.round(summary.busiest_impact)}%</div>
                                <div style="font-size: 10px; color: #8b5cf6; font-weight: 800; white-space: nowrap;">PEAK DAY VARIANCE</div>
                            </div>
                            <div style="text-align: right;">
                                <div style="font-size: 14px; font-weight: 700; color: var(--gray-700);">${summary.peak_day.substring(0, 3)}</div>
                                <div style="font-size: 10px; color: var(--gray-400); font-weight: 600; white-space: nowrap;">Peak Day</div>
                            </div>
                        </div>
                        <div style="height: 6px; width: 100%; background: #f3f0ff; border-radius: 3px; overflow: hidden;">
                            <div style="height: 100%; width: ${Math.min(100, summary.busiest_impact * 2)}%; background: #8b5cf6; border-radius: 3px;"></div>
                        </div>
                    </div>
                </div>

                <!-- Weekly Pattern -->
                <div class="activity-chart-section" style="background: white; padding: 24px; border-radius: 28px; border: 1px solid #eef2f6; margin-bottom: 24px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                        <div style="font-size: 12px; font-weight: 900; color: var(--gray-900); text-transform: uppercase; letter-spacing: 0.5px;">Weekly Participation (Refined)</div>
                        <div style="font-size: 11px; font-weight: 800; color: var(--primary-color); background: rgba(37, 99, 235, 0.05); padding: 5px 12px; border-radius: 10px; display: flex; align-items: center; gap: 6px;">
                            <span style="font-size: 14px;">🌟</span> Peak: ${summary.peak_day}
                        </div>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: flex-end; height: 120px; padding: 0 10px;">
                        ${(summary.weekly_stats || [0, 0, 0, 0, 0]).map((rate, i) => {
        const days = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
        const count = summary.weekly_counts ? Math.round(summary.weekly_counts[i]) : '--';
        const isPeak = days[i].toUpperCase() === (summary.peak_day || '').substring(0, 3).toUpperCase();
        return `
                                <div style="display: flex; flex-direction: column; align-items: center; gap: 12px; flex: 1;">
                                    <div style="width: 40px; height: ${Math.max(rate, 20)}px; background: ${isPeak ? 'var(--primary-color)' : '#e2e8f0'}; border-radius: 10px; position: relative; transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: ${isPeak ? '0 8px 16px rgba(37, 99, 235, 0.2)' : 'none'}" title="${Math.round(rate)}% attendance">
                                        <div style="position: absolute; top: -24px; left: 50%; transform: translateX(-50%); font-size: 12px; font-weight: 900; color: ${isPeak ? 'var(--primary-color)' : 'var(--gray-600)'}; white-space: nowrap;">${count}</div>
                                    </div>
                                    <div style="font-size: 11px; font-weight: 800; color: ${isPeak ? 'var(--gray-900)' : 'var(--gray-400)'};">${days[i]}</div>
                                </div>
                            `;
    }).join('')}
                    </div>
                </div>

                <!-- Department Rankings -->
                <div style="background: white; padding: 24px; border-radius: 28px; border: 1px solid #eef2f6; margin-bottom: 24px;">
                    <div style="font-size: 12px; font-weight: 900; color: var(--gray-900); text-transform: uppercase; margin-bottom: 20px; letter-spacing: 0.5px;">Team Engagement Ranking</div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                        <div>
                            <div style="font-size: 11px; font-weight: 800; color: var(--success-color); margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
                                <span style="font-size: 14px;">🏆</span> TOP PERFORMERS
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 10px;">
                                ${(data.top_departments || []).map(d => `
                                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: rgba(16, 185, 129, 0.04); border: 1px solid rgba(16, 185, 129, 0.08); border-radius: 12px;">
                                        <span style="font-size: 12px; font-weight: 700; color: #064e3b;">${d.name}</span>
                                        <span style="font-size: 12px; font-weight: 900; color: var(--success-color);">${Math.round(d.attendance_rate)}%</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                        <div>
                            <div style="font-size: 11px; font-weight: 800; color: var(--error-color); margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
                                <span style="font-size: 14px;">⚠️</span> UNDER REVIEW
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 10px;">
                                ${(data.bottom_departments && data.bottom_departments.length > 0) ? data.bottom_departments.map(d => `
                                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: rgba(239, 68, 68, 0.04); border: 1px solid rgba(239, 68, 68, 0.08); border-radius: 12px;">
                                        <span style="font-size: 12px; font-weight: 700; color: #7f1d1d;">${d.name}</span>
                                        <span style="font-size: 12px; font-weight: 900; color: var(--error-color);">${Math.round(d.attendance_rate)}%</span>
                                    </div>
                                `).join('') : `<div style="padding: 16px; text-align: center; color: var(--gray-400); font-size: 12px; font-weight: 600; background: #f8fafc; border-radius: 12px;">All teams above threshold</div>`}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Executive Insight & Smart Tips -->
                <div style="padding: 24px; background: linear-gradient(135deg, #f0f7ff 0%, #ffffff 100%); border: 1px dashed rgba(37, 99, 235, 0.2); border-radius: 28px;">
                    <div style="font-size: 14px; line-height: 1.7; color: #334155;">
                        <span style="font-size: 22px; float: left; margin-right: 14px;">📝</span> 
                        <strong>Executive Insight:</strong> The organizational health is stable with a <strong>${summary.attendance_streak}-day</strong> high-attendance streak. Total absenteeism remains low at <strong>${Math.round(100 - summary.overall_attendance_rate)}%</strong>.
                        <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid rgba(37, 99, 235, 0.1); font-size: 13px;">
                            <span style="color: var(--primary-color); font-weight: 800; font-size: 11px; text-transform: uppercase;">💡 SMART ADVICE:</span>
                            <div style="margin-top: 4px; font-weight: 600;">
                                ${summary.late_rate > 15 ?
            `Congestion detected near the <strong>${summary.peak_hour.split(' - ')[0]}</strong> window. Consider shift staggering to improve arrival efficiency.` :
            `Consistent patterns detected. Recommended focus: maintaining department ${data.top_departments?.[0]?.name || 'leadership'} standards across other teams.`}
                            </div>
                        </div>
                    </div>
                </div>

                <div style="text-align: center; margin-top: 36px; padding-bottom: 12px;">
                    <button class="predictive-understood-btn" onclick="closePredictiveModal()" style="width: auto; padding: 18px 80px; font-weight: 900; letter-spacing: 1.5px; background: var(--primary-color); color: white; border: none; border-radius: 20px; cursor: pointer; transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); box-shadow: 0 10px 25px -5px rgba(37, 99, 235, 0.4); text-transform: uppercase; font-size: 13px;">ACKNOWLEDGE INSIGHTS</button>
                </div>
            </div>
        </div>
    `;

    modal.classList.add('active');
}

function getForecastDayName() {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return days[tomorrow.getDay()];
}

function renderActivityBars(trends, nextValue, totalEmployees) {
    if (!trends || trends.length === 0) return '';

    // Get last 7 days of attendance
    const recentTrends = trends.slice(-7);
    const maxVal = totalEmployees || 100;

    let html = '';
    recentTrends.forEach(t => {
        const height = ((t.present_count || 0) / maxVal) * 80; // Scale to 80px max height
        html += `
            <div class="activity-bar-container">
                <div class="activity-bar" style="height: ${Math.max(5, height)}px;">
                    <div class="activity-bar-value">${t.present_count || 0}</div>
                </div>
            </div>
        `;
    });

    // Add NEXT bar (predicted)
    const nextHeight = (nextValue / maxVal) * 80;
    html += `
        <div class="activity-bar-container">
            <div class="activity-bar next-bar" style="height: ${Math.max(5, nextHeight)}px;">
                <div class="activity-bar-value">${nextValue}</div>
            </div>
        </div>
    `;

    return html;
}

function renderActivityDays() {
    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const today = new Date().getDay();
    let html = '';

    for (let i = today - 6; i <= today; i++) {
        const dayIdx = (i + 7) % 7;
        html += `<div class="activity-day">${days[dayIdx]}</div>`;
    }

    html += `<div class="activity-day next-day">NEXT</div>`;
    return html;
}

function closePredictiveModal() {
    const modal = document.getElementById('predictiveModal');
    if (modal) modal.classList.remove('active');
}

function renderDepartmentsTab(data) {
    const departments = data.departments || [];

    if (departments.length === 0) {
        return '<div style="text-align: center; padding: 40px; color: var(--gray-500);">No department data available</div>';
    }

    let html = `
        <table style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr style="background: var(--gray-100); border-bottom: 2px solid var(--gray-300);">
                    <th style="padding: 12px; text-align: left; font-size: 13px; font-weight: 600; color: var(--gray-700);">Department</th>
                    <th style="padding: 12px; text-align: center; font-size: 13px; font-weight: 600; color: var(--gray-700);">Employees</th>
                    <th style="padding: 12px; text-align: center; font-size: 13px; font-weight: 600; color: var(--gray-700);">Attendance Rate</th>
                    <th style="padding: 12px; text-align: center; font-size: 13px; font-weight: 600; color: var(--gray-700);">Present Days</th>
                    <th style="padding: 12px; text-align: center; font-size: 13px; font-weight: 600; color: var(--gray-700);">Performance</th>
                </tr>
            </thead>
            <tbody>
    `;

    departments.forEach((dept, index) => {
        const rateColor = dept.attendance_rate >= 80 ? 'var(--success)' : dept.attendance_rate >= 60 ? 'var(--warning)' : 'var(--error)';
        const barWidth = dept.attendance_rate;

        html += `
            <tr style="border-bottom: 1px solid var(--gray-200);">
                <td style="padding: 12px;">
                    <div style="font-weight: 600; color: var(--gray-900);">${dept.name}</div>
                </td>
                <td style="padding: 12px; text-align: center; color: var(--gray-700);">${dept.employee_count}</td>
                <td style="padding: 12px; text-align: center;">
                    <span style="font-weight: 700; font-size: 18px; color: ${rateColor};">${dept.attendance_rate}%</span>
                </td>
                <td style="padding: 12px; text-align: center; color: var(--gray-700);">${dept.total_present} / ${dept.total_days}</td>
                <td style="padding: 12px;">
                    <div style="background: var(--gray-200); height: 8px; border-radius: 4px; overflow: hidden;">
                        <div style="background: ${rateColor}; height: 100%; width: ${barWidth}%; transition: width 0.3s;"></div>
                    </div>
                </td>
            </tr>
        `;
    });

    html += '</tbody></table>';
    return html;
}

function renderEmployeesTab(data) {
    const employees = data.employees || [];

    if (employees.length === 0) {
        return '<div style="text-align: center; padding: 40px; color: var(--gray-500);">No employee data available</div>';
    }

    let html = `
        <div style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
            <div style="font-size: 14px; color: var(--gray-600);">Showing ${employees.length} employees</div>
            <input type="text" id="employeeSearchInput" placeholder="Search employees..." 
                style="padding: 8px 12px; border: 1px solid var(--gray-300); border-radius: 6px; width: 300px;"
                onkeyup="filterEmployeeTable()">
        </div>
        <div style="max-height: 500px; overflow-y: auto;">
            <table id="employeeDataTable" style="width: 100%; border-collapse: collapse;">
                <thead style="position: sticky; top: 0; background: white; z-index: 5;">
                    <tr style="background: var(--gray-100); border-bottom: 2px solid var(--gray-300);">
                        <th style="padding: 12px; text-align: left; font-size: 12px; font-weight: 600; color: var(--gray-700);">Name</th>
                        <th style="padding: 12px; text-align: left; font-size: 12px; font-weight: 600; color: var(--gray-700);">Department</th>
                        <th style="padding: 12px; text-align: center; font-size: 12px; font-weight: 600; color: var(--gray-700);">Rate</th>
                        <th style="padding: 12px; text-align: center; font-size: 12px; font-weight: 600; color: var(--gray-700);">Present</th>
                        <th style="padding: 12px; text-align: center; font-size: 12px; font-weight: 600; color: var(--gray-700);">Absent</th>
                        <th style="padding: 12px; text-align: center; font-size: 12px; font-weight: 600; color: var(--gray-700);">Leave</th>
                        <th style="padding: 12px; text-align: center; font-size: 12px; font-weight: 600; color: var(--gray-700);">WFH</th>
                    </tr>
                </thead>
                <tbody>
    `;

    employees.forEach(emp => {
        const rateColor = emp.attendance_rate >= 80 ? 'var(--success)' : emp.attendance_rate >= 60 ? 'var(--warning)' : 'var(--error)';

        html += `
            <tr class="employee-row" data-name="${emp.name.toLowerCase()}" data-dept="${emp.department.toLowerCase()}" style="border-bottom: 1px solid var(--gray-200);">
                <td style="padding: 12px;">
                    <div style="font-weight: 600; color: var(--gray-900);">${emp.name}</div>
                </td>
                <td style="padding: 12px; color: var(--gray-700);">${emp.department}</td>
                <td style="padding: 12px; text-align: center;">
                    <span style="font-weight: 700; font-size: 16px; color: ${rateColor};">${emp.attendance_rate}%</span>
                </td>
                <td style="padding: 12px; text-align: center; color: var(--success);">${emp.present_days}</td>
                <td style="padding: 12px; text-align: center; color: var(--error);">${emp.absent_days}</td>
                <td style="padding: 12px; text-align: center; color: var(--warning);">${emp.leave_days}</td>
                <td style="padding: 12px; text-align: center; color: var(--info);">${emp.wfh_days}</td>
            </tr>
        `;
    });

    html += '</tbody></table></div>';
    return html;
}

function filterEmployeeTable() {
    const input = document.getElementById('employeeSearchInput');
    const filter = input.value.toLowerCase();
    const rows = document.querySelectorAll('.employee-row');

    rows.forEach(row => {
        const name = row.getAttribute('data-name');
        const dept = row.getAttribute('data-dept');

        if (name.includes(filter) || dept.includes(filter)) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
}

function renderChartTab() {
    return `
        <div id="trendsChartContainer" style="width: 100%; height: 400px; position: relative;">
            <canvas id="trendsChart"></canvas>
        </div>
        
        <div style="margin-top: 20px; display: flex; gap: 20px; justify-content: center;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 20px; height: 3px; background: #3b82f6;"></div>
                <span style="font-size: 13px; color: var(--gray-600);">Daily Attendance</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 20px; height: 3px; background: #8b5cf6;"></div>
                <span style="font-size: 13px; color: var(--gray-600);">7-Day Moving Average</span>
            </div>
        </div>
    `;
}

function renderTrendsChart(trendsData) {
    const canvas = document.getElementById('trendsChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const container = document.getElementById('trendsChartContainer');

    // Set canvas size
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    const width = canvas.width;
    const height = canvas.height;
    const padding = { top: 30, right: 30, bottom: 50, left: 50 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Extract data
    const dates = trendsData.map(d => d.date);
    const rates = trendsData.map(d => d.attendance_rate);
    const movingAvgs = trendsData.map(d => d.moving_avg);

    const maxRate = Math.max(...rates, ...movingAvgs);
    const minRate = Math.min(...rates, ...movingAvgs);
    const range = maxRate - minRate || 10;

    // Draw grid lines
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;

    for (let i = 0; i <= 5; i++) {
        const y = padding.top + (chartHeight / 5) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(padding.left + chartWidth, y);
        ctx.stroke();

        // Y-axis labels
        const value = maxRate - (range / 5) * i;
        ctx.fillStyle = '#6b7280';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(value.toFixed(1) + '%', padding.left - 10, y + 4);
    }

    // Draw daily attendance line
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.beginPath();

    rates.forEach((rate, i) => {
        const x = padding.left + (chartWidth / (rates.length - 1)) * i;
        const y = padding.top + chartHeight - ((rate - minRate) / range) * chartHeight;

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });
    ctx.stroke();

    // Draw moving average line
    ctx.strokeStyle = '#8b5cf6';
    ctx.lineWidth = 2;
    ctx.beginPath();

    movingAvgs.forEach((avg, i) => {
        const x = padding.left + (chartWidth / (movingAvgs.length - 1)) * i;
        const y = padding.top + chartHeight - ((avg - minRate) / range) * chartHeight;

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });
    ctx.stroke();

    // Draw X-axis labels (show every 5th date)
    ctx.fillStyle = '#6b7280';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';

    dates.forEach((date, i) => {
        if (i % 5 === 0 || i === dates.length - 1) {
            const x = padding.left + (chartWidth / (dates.length - 1)) * i;
            const dateObj = new Date(date);
            const label = (dateObj.getMonth() + 1) + '/' + dateObj.getDate();
            ctx.fillText(label, x, height - padding.bottom + 20);
        }
    });
}

function closeTrendsModal() {
    const modal = document.getElementById('trendsModal');
    if (modal) {
        modal.classList.remove('active');
    }
}

async function searchPersonnel() {
    // Create modal if it doesn't exist
    let modal = document.getElementById('personnelSearchModal');
    if (!modal) {
        modal = createPersonnelSearchModal();
        document.body.appendChild(modal);
    }

    // Show modal
    modal.classList.add('active');

    // Load initial results (all personnel)
    await performPersonnelSearch();
}

function createPersonnelSearchModal() {
    const modal = document.createElement('div');
    modal.id = 'personnelSearchModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 1000px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h3 style="margin: 0;">Personnel Search</h3>
                <button onclick="closePersonnelSearchModal()" style="background: none; border: none; font-size: 24px; cursor: pointer; color: var(--gray-500);">×</button>
            </div>
            
            <div style="display: flex; gap: 12px; margin-bottom: 20px;">
                <input type="text" id="personnelSearchQuery" placeholder="Search by name, username, or email..." 
                    style="flex: 1; padding: 10px 16px; border: 1px solid var(--gray-300); border-radius: 8px; font-size: 14px;"
                    onkeypress="if(event.key === 'Enter') performPersonnelSearch()">
                <select id="personnelSearchDept" style="padding: 10px 16px; border: 1px solid var(--gray-300); border-radius: 8px; font-size: 14px;">
                    <option value="">All Departments</option>
                    <option value="IT">IT</option>
                    <option value="HR">HR</option>
                    <option value="Surveyors">Surveyors</option>
                    <option value="Accounts">Accounts</option>
                    <option value="Growth">Growth</option>
                    <option value="Others">Others</option>
                </select>
                <button class="btn btn-primary" onclick="performPersonnelSearch()">Search</button>
            </div>
            
            <div id="personnelSearchResults" style="max-height: 500px; overflow-y: auto;">
                <div style="text-align: center; padding: 40px; color: var(--gray-500);">
                    <span style="font-size: 48px;">🔍</span>
                    <p>Loading personnel data...</p>
                </div>
            </div>
            
            <div style="text-align: center; margin-top: 20px;">
                <button class="btn btn-secondary" onclick="closePersonnelSearchModal()">Close</button>
            </div>
        </div>
    `;
    return modal;
}

async function performPersonnelSearch() {
    const query = document.getElementById('personnelSearchQuery')?.value || '';
    const department = document.getElementById('personnelSearchDept')?.value || '';
    const resultsContainer = document.getElementById('personnelSearchResults');

    if (!resultsContainer) return;

    resultsContainer.innerHTML = '<div style="text-align: center; padding: 40px;"><div class="loading-spinner"></div></div>';

    try {
        const result = await apiCall('intelligence-hub-search', 'POST', {
            query: query,
            department: department
        });

        if (result.success && result.results) {
            renderPersonnelResults(result.results);
        } else {
            resultsContainer.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--gray-500);">No results found</div>';
        }
    } catch (error) {
        console.error('Failed to search personnel:', error);
        resultsContainer.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--error);">Failed to load results</div>';
    }
}

function renderPersonnelResults(results) {
    const resultsContainer = document.getElementById('personnelSearchResults');
    if (!resultsContainer) return;

    if (results.length === 0) {
        resultsContainer.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--gray-500);">No personnel found</div>';
        return;
    }

    let html = `
        <table style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr style="background: var(--gray-100); border-bottom: 2px solid var(--gray-300);">
                    <th style="padding: 12px; text-align: left; font-size: 12px; font-weight: 600; color: var(--gray-700);">Name</th>
                    <th style="padding: 12px; text-align: left; font-size: 12px; font-weight: 600; color: var(--gray-700);">Department</th>
                    <th style="padding: 12px; text-align: center; font-size: 12px; font-weight: 600; color: var(--gray-700);">30-Day Rate</th>
                    <th style="padding: 12px; text-align: center; font-size: 12px; font-weight: 600; color: var(--gray-700);">Prediction</th>
                    <th style="padding: 12px; text-align: center; font-size: 12px; font-weight: 600; color: var(--gray-700);">Status</th>
                </tr>
            </thead>
            <tbody>
    `;

    results.forEach(person => {
        const rateColor = person.attendance_rate >= 80 ? 'var(--success)' : person.attendance_rate >= 60 ? 'var(--warning)' : 'var(--error)';
        const predColor = person.prediction_score >= 80 ? 'var(--success)' : person.prediction_score >= 60 ? 'var(--warning)' : 'var(--error)';
        const statusColor = person.status === 'Active' ? 'var(--success)' : 'var(--gray-500)';

        html += `
            <tr style="border-bottom: 1px solid var(--gray-200); cursor: pointer; transition: background 0.2s;" 
                onmouseover="this.style.background='var(--primary-50)'" 
                onmouseout="this.style.background='white'"
                onclick="showEmployeePerformanceAnalysis(${person.id})">
                <td style="padding: 12px;">
                    <div style="font-weight: 600; color: var(--gray-900);">${person.name}</div>
                    <div style="font-size: 12px; color: var(--gray-500);">${person.email}</div>
                </td>
                <td style="padding: 12px; color: var(--gray-700);">${person.department}</td>
                <td style="padding: 12px; text-align: center;">
                    <span style="font-weight: 700; font-size: 16px; color: ${rateColor};">${person.attendance_rate}%</span>
                </td>
                <td style="padding: 12px; text-align: center;">
                    <span style="font-weight: 700; font-size: 16px; color: ${predColor};">${person.prediction_score}%</span>
                </td>
                <td style="padding: 12px; text-align: center;">
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
                        <span style="display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; background: ${statusColor}20; color: ${statusColor};">
                            ${person.status}
                        </span>
                        <span style="font-size: 10px; color: var(--primary); font-weight: 600;">View Details →</span>
                    </div>
                </td>
            </tr>
        `;
    });

    html += '</tbody></table>';
    resultsContainer.innerHTML = html;
}

function closePersonnelSearchModal() {
    const modal = document.getElementById('personnelSearchModal');
    if (modal) {
        modal.classList.remove('active');
    }
}

async function showEmployeePerformanceAnalysis(employeeId, viewType = 'period', month = null, year = null, weekIdx = 'all') {
    try {
        let url = `employee-performance-analysis/${employeeId}?view_type=${viewType}`;
        if (viewType === 'month' && month && year) {
            url += `&month=${month}&year=${year}`;
            if (weekIdx) url += `&week_idx=${weekIdx}`;
        }

        const result = await apiCall(url, 'GET');
        if (result.success) {
            renderEmployeePerformanceModal(result, employeeId);
        } else {
            showNotification(result.message || 'Failed to load performance data', 'error');
        }
    } catch (error) {
        console.error('Performance analysis fetch error:', error);
        showNotification('An error occurred while fetching analysis', 'error');
    }
}

window.changeStatsViewMode = function (employeeId) {
    const viewType = document.getElementById('statsViewMode').value;
    const now = new Date();

    const month = document.getElementById('statsMonth')?.value || (now.getMonth() + 1);
    const year = document.getElementById('statsYear')?.value || now.getFullYear();
    const weekIdx = document.getElementById('statsWeekIdx')?.value || 'all';

    showEmployeePerformanceAnalysis(employeeId, viewType, month, year, weekIdx);
};

window.updateStatsFilter = function (employeeId) {
    const viewType = document.getElementById('statsViewMode').value;
    const month = document.getElementById('statsMonth')?.value;
    const year = document.getElementById('statsYear')?.value;
    const weekIdx = document.getElementById('statsWeekIdx')?.value || 'all';
    showEmployeePerformanceAnalysis(employeeId, viewType, month, year, weekIdx);
};

function renderEmployeePerformanceModal(data, employeeId) {
    // Remove existing if any
    const existing = document.getElementById('employeePerformanceModal');
    if (existing) existing.remove();

    const m = data.metrics;
    const t = data.tasks;
    const p = data.prediction;
    const f = data.filter;
    const viewType = f.view_type || 'period';

    // Filter labels
    const currentMonth = f.month || (new Date().getMonth() + 1);
    const currentYear = f.year || new Date().getFullYear();
    const currentWeek = f.week || getISOWeek(new Date());

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const years = [currentYear, currentYear - 1];

    // Generate weeks
    const weeks = [];
    for (let i = 1; i <= 52; i++) weeks.push(i);

    // Handle N/A for accuracy if no completed tasks
    const accuracyValue = (t.completed > 0) ? `${t.avg_accuracy}%` : 'N/A';
    const accuracyColor = (t.completed > 0) ? (t.avg_accuracy >= 80 ? 'var(--success)' : t.avg_accuracy >= 60 ? 'var(--warning)' : 'var(--error)') : 'var(--gray-400)';

    const modal = document.createElement('div');
    modal.id = 'employeePerformanceModal';
    modal.className = 'modal active'; // Use standard modal class
    modal.style.zIndex = '2100'; // Ensure it's above search modal

    modal.innerHTML = `
        <div class="predictive-modal modal-content" style="width: 850px; max-width: 95vw; max-height: 90vh; padding: 0 !important; overflow: hidden; background: white; border: none; display: flex; flex-direction: column;">
            <div class="predictive-header" style="background: #4f46e5; background: linear-gradient(135deg, #4f46e5, #6366f1); color: white; padding: 24px; margin-bottom: 0; border-radius: 0; flex-shrink: 0;">
                <div style="display: flex; justify-content: space-between; align-items: start; width: 100%;">
                    <div style="display: flex; flex-direction: column; gap: 12px;">
                        <div style="display: flex; align-items: center; gap: 16px;">
                            <div style="background: rgba(255,255,255,0.2); width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; border-radius: 12px; font-size: 20px;">
                                👤
                            </div>
                            <div>
                                <h2 style="margin: 0; font-size: 20px; font-weight: 800; color: white !important;">${data.employee_name}</h2>
                                <p style="margin: 2px 0 0; opacity: 0.9; font-size: 13px; font-weight: 500; color: rgba(255,255,255,0.9);">
                                    ${data.department} • ${data.email}
                                </p>
                            </div>
                        </div>
                        
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <select id="statsViewMode" onchange="changeStatsViewMode(${employeeId})" style="background: rgba(255,255,255,0.25); border: 1px solid rgba(255,255,255,0.4); color: white; border-radius: 8px; padding: 6px 12px; font-size: 13px; font-weight: 700; cursor: pointer; outline: none;">
                                <option value="period" ${viewType === 'period' ? 'selected' : ''} style="color: #333">Last 30 Days</option>
                                <option value="month" ${viewType === 'month' ? 'selected' : ''} style="color: #333">Monthly View</option>
                            </select>

                            ${viewType === 'month' ? `
                                <div style="display: flex; gap: 4px;">
                                    <select id="statsMonth" onchange="updateStatsFilter(${employeeId})" style="background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3); color: white; border-radius: 8px; padding: 6px 12px; font-size: 13px; font-weight: 600; cursor: pointer; outline: none;">
                                        ${monthNames.map((name, i) => `<option value="${i + 1}" ${currentMonth === i + 1 ? 'selected' : ''} style="color: #333">${name}</option>`).join('')}
                                    </select>
                                    <select id="statsYear" onchange="updateStatsFilter(${employeeId})" style="background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3); color: white; border-radius: 8px; padding: 6px 12px; font-size: 13px; font-weight: 600; cursor: pointer; outline: none;">
                                        ${years.map(y => `<option value="${y}" ${currentYear === y ? 'selected' : ''} style="color: #333">${y}</option>`).join('')}
                                    </select>
                                    <select id="statsWeekIdx" onchange="updateStatsFilter(${employeeId})" style="background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3); color: white; border-radius: 8px; padding: 6px 12px; font-size: 13px; font-weight: 600; cursor: pointer; outline: none;">
                                        <option value="all" ${f.week_idx === 'all' ? 'selected' : ''} style="color: #333">All Weeks</option>
                                        <option value="1" ${f.week_idx === '1' ? 'selected' : ''} style="color: #333">Week 1 (1-7)</option>
                                        <option value="2" ${f.week_idx === '2' ? 'selected' : ''} style="color: #333">Week 2 (8-14)</option>
                                        <option value="3" ${f.week_idx === '3' ? 'selected' : ''} style="color: #333">Week 3 (15-21)</option>
                                        <option value="4" ${f.week_idx === '4' ? 'selected' : ''} style="color: #333">Week 4 (22-28)</option>
                                        <option value="5" ${f.week_idx === '5' ? 'selected' : ''} style="color: #333">Week 5 (29+)</option>
                                    </select>
                                </div>
                            ` : ''}
                            
                            <span style="font-size: 11px; opacity: 0.8; margin-left: 8px; background: rgba(0,0,0,0.2); padding: 4px 10px; border-radius: 6px; font-weight: 500;">
                                ${f.start_date} to ${f.end_date}
                            </span>
                        </div>
                    </div>
                    <button onclick="document.getElementById('employeePerformanceModal').remove()" 
                        style="background: rgba(255,255,255,0.1); border: none; color: white; width: 36px; height: 36px; border-radius: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.3s;">
                        ✕
                    </button>
                </div>
            </div>

            <div class="stats-modal-body" style="padding: 24px; display: grid; grid-template-columns: 1.2fr 1fr; gap: 24px; background: #f8fafc; overflow-y: auto; flex: 1;">
                <!-- Left Column: Attendance & Habits -->
                <div style="display: flex; flex-direction: column; gap: 24px;">
                    <div class="glass-card" style="padding: 20px; background: white; border-radius: 20px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); border: 1px solid #f1f5f9;">
                        <h3 style="margin: 0 0 16px; font-size: 16px; font-weight: 700; color: var(--gray-900); display: flex; align-items: center; gap: 8px;">
                            📅 Attendance Habits
                        </h3>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                            <div style="background: #f1f5f9; padding: 12px; border-radius: 12px; border-left: 4px solid var(--primary);">
                                <div style="font-size: 11px; color: var(--gray-500); font-weight: 700; text-transform: uppercase; margin-bottom: 4px;">Avg. Check-In</div>
                                <div style="font-size: 22px; font-weight: 800; color: var(--primary);">${m.avg_check_in || '--:--'}</div>
                            </div>
                            <div style="background: #f1f5f9; padding: 12px; border-radius: 12px; border-left: 4px solid #8b5cf6;">
                                <div style="font-size: 11px; color: var(--gray-500); font-weight: 700; text-transform: uppercase; margin-bottom: 4px;">Avg. Check-Out</div>
                                <div style="font-size: 22px; font-weight: 800; color: #8b5cf6;">${m.avg_check_out || '--:--'}</div>
                            </div>
                        </div>
                        <div style="margin-top: 16px; padding: 14px; background: rgba(16, 185, 129, 0.05); border-radius: 12px; display: flex; align-items: center; gap: 12px; border: 1px solid rgba(16, 185, 129, 0.1);">
                            <div style="font-size: 24px;">📈</div>
                            <div>
                                <div style="font-size: 11px; font-weight: 700; color: var(--success); text-transform: uppercase;">Likelihood Tomorrow</div>
                                <div style="font-size: 18px; font-weight: 800; color: var(--gray-900);">${p.likelihood}% <span style="font-size: 12px; font-weight: 500; color: var(--gray-500);">on ${p.tomorrow_day}</span></div>
                            </div>
                        </div>
                    </div>

                    <div class="glass-card" style="padding: 20px; background: white; border-radius: 20px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); border: 1px solid #f1f5f9;">
                        <h3 style="margin: 0 0 16px; font-size: 16px; font-weight: 700; color: var(--gray-900);">⚡ Work Efficiency</h3>
                        <div style="display: flex; flex-direction: column; gap: 16px;">
                            <div>
                                <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 11px; font-weight: 700; text-transform: uppercase;">
                                    <span style="color: #6366f1;">${m.office_ratio}% Office</span>
                                    <span style="color: var(--primary);">${m.wfh_ratio}% WFH</span>
                                </div>
                                <div style="height: 10px; width: 100%; background: #e2e8f0; border-radius: 5px; overflow: hidden; display: flex;">
                                    <div style="height: 100%; width: ${m.office_ratio}%; background: #6366f1; border-radius: 5px 0 0 5px;"></div>
                                    <div style="height: 100%; width: ${m.wfh_ratio}%; background: var(--primary); border-radius: 0 5px 5px 0;"></div>
                                </div>
                            </div>
                            <!-- Standard vs Overtime Bar -->
                            <div>
                                <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 11px; font-weight: 700; text-transform: uppercase;">
                                    <span style="color: var(--gray-600);">${m.reg_ratio}% Standard</span>
                                    <span style="color: #f59e0b;">${m.ot_ratio}% Hard Work</span>
                                </div>
                                <div style="height: 10px; width: 100%; background: #e2e8f0; border-radius: 5px; overflow: hidden; display: flex;">
                                    <div style="height: 100%; width: ${m.reg_ratio}%; background: #94a3b8; border-radius: 5px 0 0 5px;"></div>
                                    <div style="height: 100%; width: ${m.ot_ratio}%; background: #f59e0b; border-radius: 0 5px 5px 0;"></div>
                                </div>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #f8fafc; border-radius: 12px; gap: 8px;">
                                <div style="text-align: center; flex: 1;">
                                    <div style="font-size: 16px; font-weight: 800; color: var(--gray-900);">${m.total_present}</div>
                                    <div style="font-size: 8px; color: var(--gray-500); font-weight: 700; text-transform: uppercase;">Days Present</div>
                                </div>
                                <div style="height: 30px; width: 1px; background: #e2e8f0;"></div>
                                <div style="text-align: center; flex: 1.2;">
                                    <div style="font-size: 16px; font-weight: 800; color: var(--primary);">${m.weekday_avg}h</div>
                                    <div style="font-size: 8px; color: var(--gray-500); font-weight: 700; text-transform: uppercase;">M-F Avg</div>
                                </div>
                                <div style="height: 30px; width: 1px; background: #e2e8f0;"></div>
                                <div style="text-align: center; flex: 1.2;">
                                    <div style="font-size: 16px; font-weight: 800; color: #8b5cf6;">${m.saturday_avg}h</div>
                                    <div style="font-size: 8px; color: var(--gray-500); font-weight: 700; text-transform: uppercase;">Sat-Sun Avg</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Right Column: Task Performance -->
                <div style="display: flex; flex-direction: column; gap: 24px;">
                    <div class="glass-card" style="padding: 24px; background: white; border-radius: 20px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); border: 1px solid #f1f5f9;">
                        <h3 style="margin: 0 0 20px; font-size: 16px; font-weight: 700; color: var(--gray-900); display: flex; align-items: center; gap: 8px;">
                            🎯 Task Performance
                        </h3>
                        
                        <div style="display: flex; justify-content: center; margin-bottom: 24px;">
                            <div style="position: relative; width: 140px; height: 140px;">
                                <svg width="140" height="140" style="transform: rotate(-90deg);">
                                    <circle cx="70" cy="70" r="62" fill="none" stroke="#f1f5f9" stroke-width="14"></circle>
                                    <circle cx="70" cy="70" r="62" fill="none" stroke="var(--primary)" stroke-width="14"
                                        stroke-dasharray="${2 * Math.PI * 62}"
                                        stroke-dashoffset="${2 * Math.PI * 62 * (1 - t.completed / (t.total_assigned || 1))}"
                                        stroke-linecap="round"></circle>
                                </svg>
                                <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center;">
                                    <div style="font-size: 32px; font-weight: 800; color: var(--primary);">${t.completed}</div>
                                    <div style="font-size: 10px; font-weight: 700; color: var(--gray-500); text-transform: uppercase;">Completed</div>
                                </div>
                            </div>
                        </div>

                        <div style="background: linear-gradient(135deg, #f8fafc, #ffffff); border: 1px solid #e2e8f0; padding: 16px; border-radius: 16px; box-shadow: inset 0 2px 4px rgba(0,0,0,0.02); margin-bottom: 12px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <div style="font-size: 11px; color: var(--gray-500); font-weight: 700; text-transform: uppercase; margin-bottom: 2px;">Task Accuracy Score</div>
                                    <div style="font-size: 26px; font-weight: 800; color: ${accuracyColor};">
                                        ${accuracyValue}
                                    </div>
                                </div>
                                <div style="font-size: 32px; background: white; width: 50px; height: 50px; display: flex; align-items: center; justify-content: center; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">🎯</div>
                            </div>
                        </div>

                        <div style="background: #f1f5f9; padding: 12px; border-radius: 12px; border-left: 4px solid var(--primary); display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <div style="font-size: 10px; color: var(--gray-500); font-weight: 700; text-transform: uppercase;">Avg. Task Span</div>
                                <div style="font-size: 18px; font-weight: 800; color: var(--gray-900);">${t.avg_span_hours}h</div>
                            </div>
                            <div style="font-size: 20px;">⏱️</div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-top: 20px;">
                            <div style="background: #f8fafc; padding: 10px 4px; border-radius: 12px; text-align: center; border: 1px solid #f1f5f9;">
                                <div style="font-size: 16px; font-weight: 800; color: var(--primary);">${t.total_assigned}</div>
                                <div style="font-size: 8px; font-weight: 700; color: var(--gray-500); text-transform: uppercase;">Assigned</div>
                            </div>
                            <div style="background: #f8fafc; padding: 10px 4px; border-radius: 12px; text-align: center; border: 1px solid #f1f5f9;">
                                <div style="font-size: 16px; font-weight: 800; color: #6366f1;">${t.in_progress}</div>
                                <div style="font-size: 8px; font-weight: 700; color: var(--gray-500); text-transform: uppercase;">Progress</div>
                            </div>
                            <div style="background: #f8fafc; padding: 10px 4px; border-radius: 12px; text-align: center; border: 1px solid #f1f5f9;">
                                <div style="font-size: 16px; font-weight: 800; color: var(--gray-600);">${t.todo}</div>
                                <div style="font-size: 8px; font-weight: 700; color: var(--gray-500); text-transform: uppercase;">To Do</div>
                            </div>
                        </div>
                    </div>

                    <div style="text-align: center;">
                        <button onclick="document.getElementById('employeePerformanceModal').remove()" 
                            style="padding: 14px 40px; border-radius: 14px; border: none; background: #e2e8f0; color: var(--gray-700); font-weight: 700; cursor: pointer; transition: all 0.3s; font-size: 14px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);"
                            onmouseover="this.style.background='#cbd5e1'"
                            onmouseout="this.style.background='#e2e8f0'">
                            Close Analysis
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

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

function toggleMultiSelect() {
    const dropdown = document.getElementById('multiSelectDropdown');
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
    updateCheckboxesInDropdown(containerId === 'multiSelectDisplay' ? 'multiSelectOptionsList' : 'teamMemberOptionsList', ids);
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
    } else {
        selectedTeamMemberIds = selectedTeamMemberIds.filter(x => x != id);
        updateSelectedTags('teamMemberDisplay', selectedTeamMemberIds, window.allEmployeesSimple || [], 'newTeamMemberIds');
    }
}

function selectEmployee(id, isTeamMember = false) {
    id = parseInt(id);
    if (isTeamMember) {
        if (selectedTeamMemberIds.includes(id)) {
            selectedTeamMemberIds = selectedTeamMemberIds.filter(x => x != id);
        } else {
            selectedTeamMemberIds.push(id);
        }
        updateSelectedTags('teamMemberDisplay', selectedTeamMemberIds, window.allEmployeesSimple || [], 'newTeamMemberIds');
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
        const res = await apiCall('get-teams', 'GET', { manager_id: currentUser.id });
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
            manager_id: currentUser.id,
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

function populateEmployeeListInDropdown(listId, isTeamMember = false) {
    const list = document.getElementById(listId);
    if (!list || !window.allEmployeesSimple) return;

    list.innerHTML = window.allEmployeesSimple.map(emp => `
        <div class="multi-select-item" onclick="selectEmployee(${emp.id}, ${isTeamMember})">
            <input type="checkbox" value="${emp.id}" onclick="event.stopPropagation(); selectEmployee(${emp.id}, ${isTeamMember})">
            <span>${emp.name} (${emp.role})</span>
        </div>
    `).join('');

    // Update checkboxes based on current selection
    updateCheckboxesInDropdown(listId, isTeamMember ? selectedTeamMemberIds : selectedEmployeeIds);
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
            // Base Layers
            const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '© OpenStreetMap'
            });

            const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                maxZoom: 19,
                attribution: '© Esri'
            });

            window.fullScreenMap = L.map('fullMap', {
                center: [20.5937, 78.9629],
                zoom: 4,
                layers: [streets], // Default
                zoomControl: false
            });

            // Add Layer Control
            const baseMaps = {
                "Street": streets,
                "Satellite": satellite
            };
            L.control.layers(baseMaps).addTo(window.fullScreenMap);
            L.control.zoom({ position: 'topleft' }).addTo(window.fullScreenMap);

            // Add Current Location Button
            const locControl = L.Control.extend({
                options: { position: 'topleft' },
                onAdd: function (map) {
                    const btn = L.DomUtil.create('button', 'leaflet-bar leaflet-control leaflet-control-custom');
                    btn.innerHTML = '📍';
                    btn.style.backgroundColor = 'white';
                    btn.style.width = '30px';
                    btn.style.height = '30px';
                    btn.style.cursor = 'pointer';
                    btn.style.border = '2px solid rgba(0,0,0,0.2)';
                    btn.style.borderRadius = '4px';
                    btn.title = "Show My Location";
                    btn.onclick = function (e) {
                        e.stopPropagation();
                        if (navigator.geolocation) {
                            btn.innerHTML = '⌛';
                            navigator.geolocation.getCurrentPosition(pos => {
                                const lat = pos.coords.latitude;
                                const lon = pos.coords.longitude;
                                map.flyTo([lat, lon], 17);

                                // Clear existing location markers/circles
                                if (map._locMarker) map.removeLayer(map._locMarker);
                                if (map._locCircle) map.removeLayer(map._locCircle);

                                // Add accuracy circle
                                map._locCircle = L.circle([lat, lon], {
                                    radius: pos.coords.accuracy || 100,
                                    color: '#3b82f6',
                                    fillColor: '#3b82f6',
                                    fillOpacity: 0.15,
                                    weight: 1
                                }).addTo(map);

                                // Add marker
                                map._locMarker = L.circleMarker([lat, lon], {
                                    radius: 8,
                                    fillColor: "#3b82f6",
                                    color: "#fff",
                                    weight: 2,
                                    opacity: 1,
                                    fillOpacity: 0.8
                                }).addTo(map).bindPopup("You are here").openPopup();

                                btn.innerHTML = '📍';
                            }, () => {
                                alert("Location access denied.");
                                btn.innerHTML = '📍';
                            });
                        } else {
                            alert("Geolocation not supported.");
                        }
                    }
                    return btn;
                }
            });
            window.fullScreenMap.addControl(new locControl());
        }

        // Clear existing layers
        window.fullScreenMap.eachLayer((layer) => {
            if (layer instanceof L.Marker) {
                window.fullScreenMap.removeLayer(layer);
            }
        });

        window.fullScreenMap.invalidateSize();

        // Add Markers (Same logic as mini map)
        const map = window.fullScreenMap;
        const markers = [];
        const gender = (record.gender || 'other').toLowerCase();

        const createEmojiIcon = (emoji) => {
            let markerImage = '/static/images/marker-user.png'; // Default to PNG
            if (gender === 'male') markerImage = '/static/images/marker-user.png';
            else if (gender === 'female') markerImage = '/static/images/marker-female.png';

            return L.divIcon({
                className: 'custom-emoji-marker',
                html: `<img src="${markerImage}" style="width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.3));">`,
                iconSize: [100, 100], // Increased to 100px for full map
                iconAnchor: [50, 50],
                popupAnchor: [0, -55]
            });
        };

        // 1. Check-In
        if (record.check_in_location) {
            try {
                const loc = typeof record.check_in_location === 'string' ? JSON.parse(record.check_in_location) : record.check_in_location;
                const lat = loc.latitude || loc.lat;
                const lon = loc.longitude || loc.lon || loc.lng;
                if (lat && lon) {
                    const timeStr = record.check_in_time ? new Date(`1970-01-01T${record.check_in_time}`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                    const marker = L.marker([lat, lon], { icon: createEmojiIcon('🧍') }).addTo(map).bindPopup(`<b>Check In</b><br>${timeStr}`);
                    markers.push(marker);
                }
            } catch (e) { }
        }

        // 4. Check Out
        if (record.check_out_location) {
            try {
                const loc = typeof record.check_out_location === 'string' ? JSON.parse(record.check_out_location) : record.check_out_location;
                const lat = loc.latitude || loc.lat;
                const lon = loc.longitude || loc.lon || loc.lng;
                if (lat && lon) {
                    const timeStr = record.check_out_time ? new Date(`1970-01-01T${record.check_out_time}`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                    const marker = L.marker([lat, lon], { icon: createEmojiIcon('👋') }).addTo(map).bindPopup(`<b>Check Out</b><br>${timeStr}`);
                    markers.push(marker);
                }
            } catch (e) { }
        }

        if (markers.length > 0) {
            const group = new L.featureGroup(markers);
            map.fitBounds(group.getBounds(), { padding: [50, 50] });
        } else {
            map.setView([20.5937, 78.9629], 4);
        }

    }, 100);
};

window.closeMapModal = function () {
    const modal = document.getElementById('mapModal');
    if (modal) modal.classList.remove('active');
};

// View My Stats Function
function viewMyStats() {
    if (typeof currentUser !== 'undefined' && currentUser.id) {
        showEmployeePerformanceAnalysis(currentUser.id);
    } else {
        // Fallback if currentUser is not global, try to find it from DOM or re-fetch
        // For now, simpler fallback
        const userName = document.getElementById('userName').innerText;
        if (userName !== 'User') {
            // Try to find user ID from other sources if needed, 
            // but currentUser should be there if dashboard is loaded.
            showNotification('Loading your stats...', 'info');
            // If we really can't find ID, we might need to fetch it.
            // But based on previous read, currentUser is used in render logic.
        } else {
            showNotification('User profile not loaded', 'error');
        }
    }
}

function getISOWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

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
