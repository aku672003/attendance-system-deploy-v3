// Global Variables
let currentUser = null;
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
// API Configuration
const apiBaseUrl = "/api";

// Initialize Application
document.addEventListener('DOMContentLoaded', function () {
    console.log('MySQL Attendance System Initializing...');
    refreshPrimaryOfficeSelects();
    // Check for stored user session
    const storedUser = localStorage.getItem('attendanceUser');
    if (storedUser) {
        try {
            currentUser = JSON.parse(storedUser);
            showScreen('dashboardScreen');
            loadDashboardData();
            updateDashboardVisibility();
        } catch (e) {
            localStorage.removeItem('attendanceUser');
        }
    }
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

function closeModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('active');
    document.body.style.overflow = '';
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
}

function showScreen(screenId) {
    // Prevent non-admins from opening adminScreen
    if (screenId === 'adminScreen' && (!currentUser || currentUser.role !== 'admin')) {
        showNotification('Admins only.', 'warning');
        screenId = 'dashboardScreen';
        return;
    }

    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');

    if (screenId === 'recordsScreen') {
        loadAttendanceRecords();
    } else if (screenId === 'attendanceScreen') {
        // avoid reference error if you removed resetAttendanceFlow
        if (typeof resetAttendanceFlow === 'function') resetAttendanceFlow();
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
    const now = new Date();
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
        if (qs) url += '?' + qs;
    }

    const opts = { method, headers: {} };
    opts.cache = 'no-store';
    opts.headers['Cache-Control'] = 'no-cache';

    if (method !== 'GET' && data !== null) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(data);
    }

    const res = await fetch(url, opts);
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { success: false, raw: text, status: res.status }; }
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
            localStorage.setItem('attendanceUser', JSON.stringify(currentUser));

            showNotification('Login successful!');
            showScreen('dashboardScreen');
            await loadDashboardData();
            await loadDashboardData();
            await populateOfficeDropdowns();
            updateDashboardVisibility();
        } else {
            showNotification(result.message || 'Login failed', 'error');
        }
    } finally {
        // Reset button state
        loginBtn.disabled = false;
        loginBtnText.classList.remove('hidden');
        loginSpinner.classList.add('hidden');
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
    localStorage.removeItem('attendanceUser');
    showNotification('Logged out successfully');
    showScreen('loginScreen');
}

// Dashboard Functions
async function loadDashboardData() {
    if (!currentUser) return;

    document.getElementById('userName').textContent = currentUser.name;

    if (currentUser.role === 'admin') {
        // Admin sees admin stats grid and admin-specific cards
        document.getElementById('employeeStatsGrid').classList.add('hidden');
        document.getElementById('adminStatsGrid').classList.remove('hidden');
        document.getElementById('checkInCard').classList.add('hidden'); // Hide check-in for admin
        document.getElementById('checkOutCard').classList.add('hidden'); // Hide check-out for admin
        document.getElementById('adminCard').classList.remove('hidden');
        document.getElementById('exportCard').classList.remove('hidden');
        document.getElementById('profileCard').classList.add('hidden');
        document.getElementById('adminExportNote')?.classList.remove('hidden');

        // Load admin dashboard data
        await Promise.all([
            loadAdminSummary(),
            loadUpcomingBirthdays(),
            loadPendingRequests(),
            loadActiveTasks()
        ]);
    } else {
        // Employee sees employee stats grid and employee-specific cards
        document.getElementById('adminStatsGrid').classList.add('hidden');
        document.getElementById('employeeStatsGrid').classList.remove('hidden');
        document.getElementById('profileCard').classList.remove('hidden');
        document.getElementById('adminCard').classList.add('hidden');
        document.getElementById('exportCard').classList.add('hidden');
        document.getElementById('adminExportNote')?.classList.add('hidden');

        // 1. Run location check first and get its status
        const locationStatus = await updateLocationStatus();
        const isUserInRange = locationStatus ? locationStatus.inRange : false;

        // 2. Now run other checks, passing the location status
        await Promise.all([
            loadTodayAttendance(isUserInRange),
            loadMonthlyStats(),
            loadWFHEligibility()
        ]);
    }
}

// Admin Dashboard Functions
async function loadAdminSummary() {
    try {
        const res = await apiCall('admin-summary', 'GET');
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
        const res = await apiCall('pending-requests', 'GET');
        if (res && res.success) {
            document.getElementById('pendingRequests').textContent = res.count || 0;
        }
    } catch (error) {
        console.error('Error loading pending requests:', error);
    }
}

async function loadActiveTasks() {
    try {
        const res = await apiCall('active-tasks', 'GET');
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
        const res = await apiCall('admin-summary', 'GET');
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

    const monthToSend = window.currentBirthdayMonth + 1;
    const yearToSend = window.currentBirthdayYear;

    try {
        const res = await apiCall(`upcoming-birthdays?month=${monthToSend}&year=${yearToSend}`, 'GET');
        if (res && res.success) {
            const birthdays = res.birthdays || [];
            const currentDate = new Date();
            const currentMonth = currentDate.getMonth();
            const currentYear = currentDate.getFullYear();

            const total = birthdays.length;
            const upcoming = birthdays.filter(b => new Date(b.date_of_birth) >= currentDate).length;

            const calendarData = createBirthdayCalendarData(birthdays, currentYear, currentMonth);
            const dateStr = new Date(currentYear, currentMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

            content.innerHTML = `
                <div class="premium-calendar-wrap">
                    <!-- Premium Header -->
                    <div class="premium-header">
                        <div class="header-title">
                            📅 <span>${dateStr}</span>
                        </div>
                        <div style="display:flex; gap:12px;">
                            <button class="btn-premium" onclick="changeBirthdayMonth(-1)">Previous</button>
                            <button class="btn-premium btn-premium-primary" onclick="jumpToToday()">Today</button>
                            <button class="btn-premium" onclick="changeBirthdayMonth(1)">Next</button>
                            <button class="btn-premium btn-premium-danger" onclick="closeModal('birthdayCalendarModal')">Close</button>
                        </div>
                    </div>

                    <div class="calendar-main-split">
                        <!-- Left: Clean Calendar -->
                        <div class="clean-calendar-panel">
                            <div class="clean-calendar">
                                ${createBirthdayCalendarHTML(calendarData, currentYear, currentMonth)}
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
                            <input type="text" class="premium-search" placeholder="Search birthdays..." onkeyup="filterPremiumList(this.value)">

                            <!-- List -->
                            <div class="premium-list" id="premiumListContainer">
                                ${createPremiumListHTML(birthdays)}
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // Store state
            window.currentBirthdayMonth = currentMonth;
            window.currentBirthdayYear = currentYear;
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

// Helpers for Futuristic Calendar
function createPremiumListHTML(birthdays) {
    if (!birthdays || birthdays.length === 0) {
        return '<p class="text-center" style="margin-top:20px; color:#94a3b8; font-size:0.9rem;">No birthdays found.</p>';
    }

    return birthdays.map((b, idx) => {
        const dateObj = new Date(b.date_of_birth);
        const zodiac = getZodiacSign(dateObj.getDate(), dateObj.getMonth() + 1);
        const daysLeft = getDaysLeft(dateObj);

        let timeLeftHtml = '';
        if (daysLeft === 0) timeLeftHtml = '<span style="color:#10b981; font-weight:700;">Today</span>';
        else if (daysLeft > 0) timeLeftHtml = `<span style="color:#64748b;">in ${daysLeft} days</span>`;
        else timeLeftHtml = '<span style="color:#94a3b8;">passed</span>';

        return `
            <div class="premium-list-item" onclick="showTransmissionEffect('${b.name}')" style="animation: slideInLeft 0.3s forwards; animation-delay: ${idx * 50}ms; opacity:0; transform:translateX(-10px);">
                <div class="premium-avatar">${b.name.charAt(0)}</div>
                <div class="premium-info">
                    <h5>${b.name}</h5>
                    <div class="premium-meta">
                        <span>${timeLeftHtml}</span>
                        <span>•</span>
                        <span class="premium-badge">${zodiac}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function filterPremiumList(query) {
    const list = document.getElementById('premiumListContainer');
    const items = list.getElementsByClassName('premium-list-item');
    const term = query.toLowerCase();

    Array.from(items).forEach(item => {
        const name = item.querySelector('h5').textContent.toLowerCase();
        if (name.includes(term)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none'; // changed from flex/none to utilize animation handling better if needed, but display none is fine
        }
    });
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
        const isToday = new Date().getDate() === day &&
            new Date().getMonth() === month &&
            new Date().getFullYear() === year;

        const isSunday = dateObj.getDay() === 0;

        const classes = [
            'fc-day',
            dayData.hasBirthday ? 'has-birthday' : '',
            isToday ? 'today' : '',
            isSunday ? 'sunday' : ''
        ].filter(Boolean).join(' ');

        // If multiple birthdays, show a small counter, otherwise just the day number
        const count = dayData.birthdays.length;
        const indicator = count > 1 ? `<span style="font-size:0.6rem; position:absolute; bottom:4px;">${count}</span>` : '';

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
        const res = await apiCall('pending-requests', 'GET');
        if (res && res.success && Array.isArray(res.requests)) {
            const requests = res.requests;
            window.currentRequests = requests; // Store for filtering

            const total = requests.length;
            const wfhCount = requests.filter(r => r.type === 'Work from Home').length;
            const leaveCount = requests.filter(r => r.type === 'Leave').length;

            let html = `
                <div class="requests-modal-container">
                    <!-- Dashboard Header -->
                    <div class="requests-dashboard-header">
                        <div class="requests-title-row">
                             <h3>🚀 Request Command Center</h3>
                             <button class="modal-close-btn" onclick="closeModal('requestsModal')">✕</button>
                        </div>
                        
                        <!-- Stats Row -->
                        <div class="requests-stats-row">
                            <div class="stat-chip stat-total">
                                <div class="stat-chip-icon">📊</div>
                                <div class="stat-chip-info">
                                    <span class="stat-chip-value">${total}</span>
                                    <span class="stat-chip-label">Total Pending</span>
                                </div>
                            </div>
                            <div class="stat-chip stat-wfh">
                                <div class="stat-chip-icon">🏠</div>
                                <div class="stat-chip-info">
                                    <span class="stat-chip-value">${wfhCount}</span>
                                    <span class="stat-chip-label">WFH Requests</span>
                                </div>
                            </div>
                            <div class="stat-chip stat-leave">
                                <div class="stat-chip-icon">🏖️</div>
                                <div class="stat-chip-info">
                                    <span class="stat-chip-value">${leaveCount}</span>
                                    <span class="stat-chip-label">Leave Requests</span>
                                </div>
                            </div>
                        </div>

                        <!-- Toolbar -->
                        <div class="requests-toolbar">
                            <div class="tech-search">
                                <span class="tech-search-icon">🔍</span>
                                <input type="text" placeholder="Search employee..." onkeyup="filterRequests(this.value)">
                            </div>
                            <div class="filter-tabs">
                                <div class="filter-tab active" onclick="filterRequestsByType('all', this)">All</div>
                                <div class="filter-tab" onclick="filterRequestsByType('Work from Home', this)">WFH</div>
                                <div class="filter-tab" onclick="filterRequestsByType('Leave', this)">Leave</div>
                            </div>
                        </div>
                    </div>

                    <!-- List Container -->
                    <div class="requests-futuristic-list" id="requestsListContainer">
                        ${renderRequestCards(requests)}
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
        return `
            <div class="empty-requests">
                <div class="empty-icon">✨</div>
                <h4>All Clear!</h4>
                <p>No pending requests found.</p>
            </div>
        `;
    }

    return requests.map((req, index) => {
        const typeClass = req.type === 'Work from Home' ? 'tech-wfh' : 'tech-leave';
        const badgeClass = req.type === 'Work from Home' ? 'badge-tech-wfh' : 'badge-tech-leave';
        const initials = req.employee_name ? req.employee_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : '??';

        // Staggered animation
        const delay = index * 50;

        return `
            <div class="req-card-tech ${typeClass}" style="animation: slideInUp 0.3s forwards; animation-delay: ${delay}ms; opacity: 0;">
                <div class="req-avatar-tech">${initials}</div>
                <div class="req-content-tech">
                    <div class="req-header-tech">
                        <h4 class="req-name-tech">${req.employee_name}</h4>
                        <div class="req-actions-tech">
                            <button class="btn-tech btn-tech-approve" onclick="approveRequest(${req.id}, '${req.type}')" title="Approve">✓</button>
                            <button class="btn-tech btn-tech-reject" onclick="rejectRequest(${req.id}, '${req.type}')" title="Reject">✕</button>
                        </div>
                    </div>
                    <div class="req-badges-tech">
                        <span class="req-badge ${badgeClass}">${req.type}</span>
                        <span style="font-size:0.8rem; color:var(--gray-500); font-weight:600;">📅 ${req.date}</span>
                    </div>
                    ${req.reason ? `<p style="margin:4px 0 0; color:var(--gray-600); font-size:0.9rem;">"${req.reason}"</p>` : ''}
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
    tabElement.classList.add('active');

    applyRequestFilters();
}

function applyRequestFilters() {
    const list = document.getElementById('requestsListContainer');
    if (!window.currentRequests) return;

    const query = window.requestSearchQuery || '';
    const type = window.requestFilterType || 'all';

    const filtered = window.currentRequests.filter(req => {
        const matchesSearch = req.employee_name.toLowerCase().includes(query) || req.username.toLowerCase().includes(query);
        const matchesType = type === 'all' || req.type === type;
        return matchesSearch && matchesType;
    });

    list.innerHTML = renderRequestCards(filtered);
}

async function openTaskManager() {
    await refreshTasks();

    // Hide Add Task button for non-admins
    const addTaskBtn = document.querySelector('#taskManagerModal .modal-actions .btn-primary');
    if (addTaskBtn) {
        if (window.currentUser && window.currentUser.role !== 'admin') {
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
        const empId = window.currentUser ? window.currentUser.id : '';
        const res = await apiCall(`tasks?employee_id=${empId}`, 'GET');
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
            const avatar = task.assigned_to_name ? task.assigned_to_name.charAt(0).toUpperCase() : '?';
            const priorityClass = task.priority === 'High' ? 'priority-high' :
                (task.priority === 'Medium' ? 'priority-medium' : 'priority-low');

            return `
                <div class="premium-task-card" id="task-${task.id}" draggable="true" ondragstart="drag(event)" style="animation: slideInUp 0.3s forwards; animation-delay: ${idx * 50}ms; opacity:1;">
                    <div class="premium-card-header">
                        <span class="premium-priority-badge ${priorityClass}">${task.priority || 'Medium'}</span>
                        <div style="display:flex; gap:4px;">
                            ${window.currentUser && window.currentUser.role === 'admin' ? `
                            <button class="btn-icon-sm" onclick="editTask(${task.id})" style="background:none; border:none; color:#94a3b8; cursor:pointer;" title="Edit">✎</button>
                            <button class="btn-icon-sm" onclick="deleteTask(${task.id})" style="background:none; border:none; color:#ef4444; cursor:pointer;" title="Delete">🗑</button>
                            ` : ''}
                        </div>
                    </div>
                    
                    <h5 class="premium-task-title" style="margin-bottom:8px;">${task.title}</h5>
                    <p style="font-size:0.85rem; color:#64748b; margin-bottom:12px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${task.description || ''}</p>
                    
                    <div class="premium-task-meta">
                        <div style="display:flex; align-items:center; gap:6px;">
                            <span class="premium-user-avatar" style="width:24px; height:24px; font-size:10px;">${avatar}</span>
                            <span style="font-size:0.8rem; color:#64748b;">${task.assigned_to_name || 'Unassigned'}</span>
                        </div>
                        <span style="font-size:0.75rem; color:#94a3b8;">${task.due_date ? new Date(task.due_date).toLocaleDateString() : ''}</span>
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
        const empId = window.currentUser ? window.currentUser.id : '';
        console.log('DEBUG: refreshing my tasks for empId:', empId, 'currentUser:', window.currentUser);
        const res = await apiCall(`tasks?employee_id=${empId}`, 'GET');
        console.log('DEBUG: my tasks response:', res);
        if (res && res.success && Array.isArray(res.tasks)) {
            myTasks = res.tasks;
            renderMyTaskBoard();
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

            return `
                <div class="premium-task-card" id="mytask-${task.id}" style="animation: slideInUp 0.3s forwards; animation-delay: ${idx * 50}ms; opacity:1;">
                    <div class="premium-card-header">
                        <span class="premium-priority-badge ${priorityClass}">${task.priority || 'Medium'}</span>
                    </div>
                    
                    <h5 class="premium-task-title" style="margin-bottom:8px;">${task.title}</h5>
                    <p style="font-size:0.85rem; color:#64748b; margin-bottom:12px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${task.description || ''}</p>
                    
                    <div class="premium-task-meta">
                        <span style="font-size:0.75rem;">📅 ${task.due_date ? new Date(task.due_date).toLocaleDateString() : 'No Date'}</span>
                    </div>

                    <div style="margin-top:12px; display:flex; gap:8px; justify-content:flex-end;">
                        ${task.status !== 'todo' ? `<button onclick="moveTask(${task.id}, 'todo', true)" style="font-size:0.7rem; padding:2px 6px; border:1px solid #e2e8f0; border-radius:4px; background:white; color:#64748b; cursor:pointer;">← Todo</button>` : ''}
                        ${task.status !== 'in_progress' ? `<button onclick="moveTask(${task.id}, 'in_progress', true)" style="font-size:0.7rem; padding:2px 6px; border:1px solid #e2e8f0; border-radius:4px; background:white; color:#3b82f6; cursor:pointer;">In Prog</button>` : ''}
                        ${task.status !== 'completed' ? `<button onclick="moveTask(${task.id}, 'completed', true)" style="font-size:0.7rem; padding:2px 6px; border:1px solid #e2e8f0; border-radius:4px; background:white; color:#10b981; cursor:pointer;">Done ✓</button>` : ''}
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
    const adminStatsGrid = document.getElementById('adminStatsGrid');
    const employeeStatsGrid = document.getElementById('employeeStatsGrid');

    if (currentUser.role === 'admin') {
        // Show Task Manager (Admin), Hide My Tasks (Employee)
        if (taskManagerCard) taskManagerCard.classList.remove('hidden');
        if (myTasksCard) myTasksCard.classList.add('hidden');

        // Ensure Admin Stats Grid is visible
        if (adminStatsGrid) adminStatsGrid.classList.remove('hidden');
        if (employeeStatsGrid) employeeStatsGrid.classList.add('hidden');
    } else {
        // Hide Task Manager (Admin), Show My Tasks (Employee)
        if (taskManagerCard) taskManagerCard.classList.add('hidden');
        if (myTasksCard) myTasksCard.classList.remove('hidden');

        // Ensure Employee Stats Grid is visible
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
    document.getElementById('taskAssignee').value = '';

    // Populate assignee dropdown
    populateTaskAssigneeDropdown();

    openModal('addTaskModal');
}

async function populateTaskAssigneeDropdown() {
    const select = document.getElementById('taskAssignee');
    try {
        const res = await apiCall('employees-simple', 'GET');
        if (res && res.success && Array.isArray(res.employees)) {
            select.innerHTML = '<option value="">Select Employee...</option>' +
                res.employees.map(emp => `<option value="${emp.id}">${emp.name} (${emp.role})</option>`).join('');
        }
    } catch (error) {
        console.error('Error loading users for task assignment:', error);
    }
}

async function saveNewTask() {
    const title = document.getElementById('taskTitle').value.trim();
    const description = document.getElementById('taskDescription').value.trim();
    const priority = document.getElementById('taskPriority').value;
    const dueDate = document.getElementById('taskDueDate').value;
    const assigneeId = document.getElementById('taskAssignee').value;

    if (!title) {
        showNotification('Task title is required', 'error');
        return;
    }

    const btn = document.getElementById('saveTaskBtn');
    const btnText = document.getElementById('saveTaskText');
    const spinner = document.getElementById('saveTaskSpinner');

    btn.disabled = true;
    btnText.classList.add('hidden');
    spinner.classList.remove('hidden');

    try {
        const res = await apiCall('tasks', 'POST', {
            title,
            description,
            priority,
            due_date: dueDate || null,
            assigned_to: assigneeId || null
        });

        if (res && res.success) {
            showNotification('Task created successfully');
            closeModal('addTaskModal');
            await refreshTasks();
            await loadActiveTasks(); // Update dashboard count
        } else {
            showNotification(res?.message || 'Failed to create task', 'error');
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

async function moveTask(taskId, newStatus, isMyTask = false) {
    try {
        const payload = {
            status: newStatus,
            user_id: window.currentUser ? window.currentUser.id : null
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
    if (!confirm('Are you sure you want to delete this task?')) return;

    try {
        const payload = {
            _method: 'DELETE',
            user_id: window.currentUser ? window.currentUser.id : null
        };
        const res = await apiCall(`tasks / ${taskId} `, 'POST', payload);
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
    const reason = prompt('Reason for rejection (optional):');
    if (reason === null) return; // User cancelled

    try {
        const endpoint = type === 'wfh' ? 'wfh-request-reject' : 'leave-request-reject';
        const res = await apiCall(endpoint, 'POST', {
            request_id: requestId,
            reason: reason
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

async function openAttendanceCalendar() {
    if (!currentUser) {
        showNotification('Please login first', 'error');
        return;
    }

    const now = new Date();
    await buildAttendanceCalendar(now.getFullYear(), now.getMonth());
    openModal('calendarModal');
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

    // Fetch all records for this user (we'll filter by month on client side)
    const res = await apiCall('attendance-records', 'GET', {
        employee_id: currentUser.id
    });

    const allRecords = (res && res.success && Array.isArray(res.records)) ? res.records : [];
    const byDay = {};

    allRecords.forEach(r => {
        if (!r.date) return;
        const d = new Date(r.date);
        if (d.getFullYear() === year && d.getMonth() === month) {
            byDay[d.getDate()] = r.status || null;
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
    for (let day = 1; day <= daysInMonth; day++) {
        const cell = document.createElement('div');
        const status = byDay[day];

        let cls = 'calendar-day';
        if (status === 'present') cls += ' cal-present';
        else if (status === 'client') cls += ' cal-client';
        else if (status === 'absent') cls += ' cal-absent';
        else if (status === 'wfh') cls += ' cal-wfh';
        else if (status === 'half_day') cls += ' cal-half';

        cell.className = cls;
        cell.textContent = day;
        grid.appendChild(cell);
    }
}

async function loadTodayAttendance(isUserInRange = false) {
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

            if (record.check_out_time) {
                statusElement.textContent = 'Completed';
                statusElement.className = 'stat-card-value success';
                timingElement.textContent = `${record.check_in_time} - ${record.check_out_time} `;
                checkInCard.classList.add('hidden');
                checkOutCard.classList.add('hidden');
            } else {
                statusElement.textContent = 'Checked In';
                statusElement.className = 'stat-card-value success';
                timingElement.textContent = `Since ${record.check_in_time} `;
                checkInCard.classList.add('hidden');
                checkOutCard.classList.remove('hidden');

                // --- NEW GEO-FENCE LOGIC ---
                if (record.type === 'office' && !isUserInRange) {
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
                // --- END NEW LOGIC ---
            }
        } else {
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

async function loadMonthlyStats() {
    try {
        const result = await apiCall('monthly-stats', 'GET', {
            employee_id: currentUser.id
        });

        const monthlyDaysElement = document.getElementById('monthlyDays');
        if (result.success && result.stats) {
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

        const wfhCountElement = document.getElementById('wfhCount');
        if (result) {
            const currentCount = result.current_count || 0;
            const maxLimit = 1; // CHANGED: Force 1 per month

            wfhCountElement.textContent = `${currentCount}/${maxLimit}`;

            if (currentCount >= maxLimit) {
                wfhCountElement.className = 'stat-card-value warning';
            } else {
                wfhCountElement.className = 'stat-card-value success';
            }
        }
    } catch (error) {
        console.error('Error loading WFH eligibility:', error);
    }
}

async function updateLocationStatus() {
    if (typeof checkAndUpdateLocationStatus === 'function') {
        return await checkAndUpdateLocationStatus();
    }
    return null;
}


// Computes "Location Status" on the dashboard and updates the UI
async function checkAndUpdateLocationStatus() {
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
            return { inRange: false }; // <-- MODIFIED (logically required)
        }

        const inRange = nearest.d <= (nearest.office.radius_meters || 0);
        statusEl.textContent = inRange ? 'In Office Range' : 'Out of Range';
        statusEl.className = 'stat-card-value ' + (inRange ? 'success' : 'warning');
        distEl.textContent = `${nearest.office.name} • ${Math.round(nearest.d)} m`;
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
    showScreen('attendanceScreen');
    if (typeof resetAttendanceFlow === 'function') resetAttendanceFlow();

    accessibleOffices = [];

    // show three choices first
    document.getElementById('typeSelectionSection').classList.remove('hidden');
    const officeBlock = document.getElementById('officeBlock');
    if (officeBlock) officeBlock.style.display = 'none';
    document.getElementById('cameraSection').classList.add('hidden');

    await refreshWFHAvailability();
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

    // ---------- 3) Check monthly WFH limit from server ----------
    try {
        const today = getCurrentDateTime().date;
        const r = await apiCall('wfh-eligibility', 'GET', { employee_id: currentUser.id, date: today });

        // Expected shape: { current_count, max_limit, can_request }
        if (r && typeof r.current_count === 'number' && typeof r.max_limit !== 'undefined') {
            // CHANGED: Set max_limit to 1 per month
            const maxLimit = 1; // Force 1 per month

            if (r.current_count >= maxLimit || r.can_request === false) {
                // limit reached → show request button
                wfhStatus.textContent = `Limit reached (${r.current_count}/${maxLimit})`;
                wfhStatus.style.color = 'var(--error-color)';
                if (!wfhOption.classList.contains('disabled')) wfhOption.classList.add('disabled'); // keep it disabled
                if (requestBtn) requestBtn.style.display = 'inline-flex';
                return;
            } else {
                // still has quota
                wfhStatus.textContent = `Available (${r.current_count}/${maxLimit})`;
                wfhStatus.style.color = 'var(--success-color)';
                if (requestBtn) requestBtn.style.display = 'none';
                return;
            }
        }

        // If server didn't return expected shape, fall back to available
        wfhStatus.textContent = 'Available';
        wfhStatus.style.color = 'var(--success-color)';
    } catch {
        // Server error → keep it available, don't hang
        wfhStatus.textContent = 'Available (limit unknown)';
        wfhStatus.style.color = 'var(--success-color)';
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
function selectType(type, e) {
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
        document.getElementById('officeBlock').style.display = 'grid';
        loadOfficeSelection();
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

    if (navigator.permissions && navigator.permissions.query) {
        try {
            const st = await navigator.permissions.query({ name: 'geolocation' });
            if (st.state === 'denied') {
                renderOfficeCardsWithoutLocation();
                return;
            }
            if (st.state === 'prompt') {
                const container = document.getElementById('officeSelection');
                container.insertAdjacentHTML('afterbegin', `<div style="margin:6px 0;"><button class="btn btn-primary" id="officeGeoBtn">Enable Location</button></div>`);
                const btn = document.getElementById('officeGeoBtn');
                if (btn) btn.onclick = async () => {
                    await requestLocationOnce();
                    loadOfficeSelection();
                };
            }
        } catch { }
    }

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => renderOfficeCards(pos.coords.latitude, pos.coords.longitude),
            () => renderOfficeCardsWithoutLocation(),
            { timeout: 6000 }
        );
    } else {
        renderOfficeCardsWithoutLocation();
    }
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

function renderOfficeCardsWithoutLocation() {
    const container = document.getElementById('officeSelection');
    container.innerHTML = '';
    for (const o of accessibleOffices) {
        const card = document.createElement('div');
        card.className = 'office-card';
        card.innerHTML = `
            <span class="action-card-icon">🏢</span>
            <h3>${o.name}</h3>
            <p>${o.address || ''}</p>
            <div class="location-status checking">Location check unavailable</div>
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

    try {
        // open stream only once
        if (!stream) {
            stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }

        video.srcObject = stream;
        await video.play();

        // show live video, hide placeholder & previous photo
        video.style.display = 'block';
        placeholder.style.display = 'none';
        img.style.display = 'none';

        // buttons state
        startBtn.style.display = 'none';
        captureBtn.style.display = 'inline-block';
        retakeBtn.style.display = 'none';

    } catch (e) {
        console.error('startCamera error', e);
        alert('Unable to access camera. Please allow camera permission.');
    }
}

function capturePhoto() {
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

    // Draw the frame from video onto canvas
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, width, height);

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

    if (markBtn) {
        markBtn.style.display = 'inline-block';
    } else {
        console.warn('markBtn not found — check id="markBtn" in your HTML');
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
}


function stopCamera() {
    if (stream && stream.getTracks) {
        stream.getTracks().forEach(t => t.stop());
    }
    stream = null;

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

        // Optional location for Office/Client
        let loc = null;
        if ((selectedType === 'office' || selectedType === 'client') && navigator.geolocation) {
            try {
                const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000 }));
                loc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
            } catch { }
        }

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
        const now = new Date();
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

    const inDate = new Date();
    inDate.setHours(inH, inM, inS, 0);

    const outDate = new Date();
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
            const proceed = confirm(
                `You have worked ${workHours.toFixed(2)} hours.\n` +
                'You have worked less than 8 hours. This will be marked as a half day.\n\n' +
                'Do you still want to check out?'
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




async function loadAttendanceRecords() {
    try {
        const recordsContent = document.getElementById('recordsContent');

        recordsContent.innerHTML = `
            <div class="text-center" style="padding: 40px;">
                <div class="loading-spinner" style="margin: 0 auto 16px; width: 24px; height: 24px;"></div>
                <p>Loading attendance records.</p>
            </div>
        `;

        const params = {};

        // For non-admin users (employees), fetch last 6 months of data
        if (currentUser.role !== 'admin') {
            params.employee_id = currentUser.id;

            const today = new Date();
            const sixMonthsAgo = new Date();
            sixMonthsAgo.setMonth(today.getMonth() - 6);

            params.start_date = formatDate(sixMonthsAgo);
            params.end_date = formatDate(today);
        }

        // Admin → all records
        const result = await apiCall('attendance-records', 'GET', params);

        const rows = (result && result.success && Array.isArray(result.records)) ? result.records : [];
        allAttendanceRecords = rows;

        renderAttendanceTable(rows);
    } catch (error) {
        console.error('Error loading records:', error);
        document.getElementById('recordsContent').innerHTML = `
            <div class="text-center" style="padding: 40px;">
                <p style="color: var(--error-color);">Error loading records. Please try again.</p>
            </div>
        `;
    }
}

// 2) Render table with search toolbar
function renderAttendanceTable(records) {
    const recordsContent = document.getElementById('recordsContent');

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
                    onkeyup="if (event.key === 'Enter') applyAttendanceSearch();">
            <button class="btn btn-secondary" onclick="applyAttendanceSearch()">Search</button>
            <button class="btn" onclick="clearAttendanceSearch()">Clear</button>
        </div>
        <div id="attendanceListContainer"></div>
    `;

    const listContainer = document.getElementById('attendanceListContainer');

    if (currentUser.role === 'admin') {
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
                            <th>Employee</th>
                            <th>Department</th>
                            <th>Check In</th>
                            <th>Check Out</th>
                            <th>Hours</th>
                            <th>Type</th>
                            <th>Status</th>
                            <th>Office</th>
                            <th>Photo</th>
                            <th style="width: 160px">Actions</th>
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

    if (currentUser.role === 'admin') {
        renderAdminDayWiseView(filtered, listContainer);
    } else {
        renderUserMonthWiseView(filtered, listContainer);
    }
}

function clearAttendanceSearch() {
    const input = document.getElementById('attendanceSearchInput');
    if (input) input.value = '';

    const listContainer = document.getElementById('attendanceListContainer');
    if (!listContainer || !allAttendanceRecords.length) return;

    if (currentUser.role === 'admin') {
        renderAdminDayWiseView(allAttendanceRecords, listContainer);
    } else {
        renderUserMonthWiseView(allAttendanceRecords, listContainer);
    }
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
        </td>
    </tr>`;
}


async function deleteAttendance(id) {
    if (!currentUser || currentUser.role !== 'admin') {
        showNotification('Admins only.', 'warning');
        return;
    }
    if (!confirm('Are you sure you want to delete this attendance record?')) return;

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



/* Open Admin Panel and ALWAYS pull fresh data from DB */
// === ADMIN: open panel and load everything ===
async function openAdminPanel() {
    if (!currentUser || currentUser.role !== 'admin') {
        showNotification('Admins only.', 'warning');
        return;
    }
    showScreen('adminScreen');

    await Promise.all([
        refreshAdminOffices(),
        refreshAdminUsers(),
        refreshPrimaryOfficeSelects(),
        refreshAdminProfiles()          // 🔹 load extended user details
    ]);

    accessibleOffices = [];
    adminOfficeEditId = null;
    document.getElementById('addOfficeMsg').textContent = '';
    document.getElementById('addUserMsg').textContent = '';
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
    document.getElementById('newOfficeLat').value = '';
    document.getElementById('newOfficeLng').value = '';
    document.getElementById('newOfficeRadius').value = '';
    document.getElementById('addOfficeMsg').textContent = '';
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
    document.getElementById('newOfficeLat').value = o.latitude ?? '';
    document.getElementById('newOfficeLng').value = o.longitude ?? '';
    document.getElementById('newOfficeRadius').value = o.radius_meters ?? '';
    document.getElementById('addOfficeMsg').textContent = 'Editing office #' + o.id;
}

async function deleteOffice(id) {
    if (!confirm('Delete this office?')) return;
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

    const res = await apiCall('admin-users', 'GET');
    const users = (res && res.success && Array.isArray(res.users)) ? res.users : [];

    document.getElementById('userCount').textContent = `(${users.length})`;
    tbody.innerHTML = users.map(u => `
        <tr>
            <td>${u.id}</td>
            <td>${u.name || ''}</td>
            <td>${u.username || ''}</td>
            <td>${u.phone || ''}</td>
            <td>${u.department || ''}</td>
            <td>${u.role || ''}</td>
            <td style="white-space:nowrap;">
                <button class="btn btn-secondary" onclick="startEditUser(${u.id})">Edit</button>
                <button class="btn" style="background:#ef4444;color:#fff" onclick="deleteUser(${u.id})">Delete</button>
            </td>
        </tr>
    `).join('');
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
    if (!confirm('Delete this user?')) return;

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
        localStorage.setItem('attendanceUser', JSON.stringify(currentUser));

        showNotification('Profile updated successfully');
        msg.textContent = 'All details saved successfully.';

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
        formData.append('doc[aadhar][number]', number);
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
        formData.append('doc[pan][number]', number);
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

function deleteSelectedDocuments() {
    const checked = [...document.querySelectorAll('.my-doc-checkbox:checked')]
        .map(c => c.value);

    if (checked.length === 0) {
        showNotification('Select documents to delete', 'warning');
        return;
    }

    if (!confirm('Delete selected documents?')) return;

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
    if (!currentUser || currentUser.role !== 'admin') {
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
        const res = await apiCall('admin-users', 'GET');
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

    btn.disabled = true;
    btnText.classList.add('hidden');
    spinner.classList.remove('hidden');
    errorDiv.style.display = 'none';

    try {
        const res = await apiCall('attendance-records', 'GET', {
            start_date: fromDate,
            end_date: toDate
        });

        if (!res || !res.success || !Array.isArray(res.records)) {
            throw new Error('Failed to fetch attendance records');
        }

        const records = res.records;
        if (!records.length) {
            throw new Error('No records found');
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

            employeeMap[r.employee_id].attendance[r.date] =
                status === 'present' ? 'P' :
                    status === 'half_day' ? 'HD' :
                        'A';

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

        Object.values(employeeMap).forEach(emp => {
            const rowData = {
                employee: emp.employee,
                department: emp.department,
                type: emp.type,
                office: emp.office
            };

            dateRange.forEach(d => {
                rowData[d] = emp.attendance[d] || 'A';
            });

            const row = ws.addRow(rowData);

            // 🎨 Apply attendance cell styling
            dateRange.forEach((d, idx) => {
                const colIndex = 5 + idx; // first 4 columns are fixed
                const cell = row.getCell(colIndex);
                const status = cell.value;

                if (ATTENDANCE_CELL_STYLES[status]) {
                    const style = ATTENDANCE_CELL_STYLES[status];
                    cell.fill = style.fill;
                    cell.font = style.font;
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                }
            });
        });


        /* ---------- FORMATTING ---------- */

        ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        ws.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF2563EB' }
        };

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

    const res = await apiCall('admin-profiles', 'GET', {});
    const profiles = (res && res.success && Array.isArray(res.profiles)) ? res.profiles : [];

    box.innerHTML = renderProfilesTable(profiles);
}

function renderProfilesTable(profiles) {
    if (!profiles.length) {
        return '<p style="color:var(--gray-600)">No user profiles found.</p>';
    }

    const rows = profiles.map(p => `
        <tr>
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
    `).join('');

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
    if (!confirm('Delete extended profile details for this user?')) return;

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
        localStorage.setItem('attendanceUser', JSON.stringify(currentUser));

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
        // 1) get the list of users (IDs + usernames, etc.)
        const res = await apiCall('admin-profiles', 'GET', {});
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
        showNotification('Error exporting all profiles', 'error');
    }
}
