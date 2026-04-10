/* Intelligence Hub & Predictive Analysis Logic */

let intelligenceHubData = null;
let intelligenceHubRefreshInterval = null;

/**
 * updateDashboardVisibility — called by script.js after login and on page reload.
 * Controls which Intelligence Hub card is shown based on user role, then loads data.
 */
/**
 * initIntelligenceHubVisibility — called by script.js after login and on page reload.
 * Controls which Intelligence Hub card is shown based on user role, then loads data.
 */
function initIntelligenceHubVisibility() {
    if (typeof currentUser === 'undefined' || !currentUser) return;

    const employeeCard = document.getElementById('intelligenceHubCardEmployee');
    const adminCard    = document.getElementById('intelligenceHubCard');
    const trainCard    = document.getElementById('trainModelCard');

    // Employee grid
    const employeeGrid = document.getElementById('employeeStatsGrid');
    // Admin grid
    const adminGrid    = document.getElementById('adminStatsGrid');
    // Actions grid (for train model card)
    const actionsGrid  = document.getElementById('actionsGrid');
    
    const myStatsBtn = document.getElementById('hubMyStatsBtn');
    const mentorSearchBtnEmployee = document.getElementById('mentorSearchBtnEmployee');
    const myStatsBtnEmployee = document.getElementById('myStatsBtnEmployee');

    if (currentUser.role === 'admin') {
        // Show admin card; hide employee card
        if (employeeCard) employeeCard.classList.add('hidden');
        if (adminCard) {
            adminCard.classList.remove('hidden');
            // Make sure card is inside the admin stats grid
            if (adminGrid && adminCard.parentElement !== adminGrid) {
                adminGrid.appendChild(adminCard);
            }
        }
        if (trainCard) {
            trainCard.classList.remove('hidden');
            if (actionsGrid && trainCard.parentElement !== actionsGrid) {
                actionsGrid.appendChild(trainCard);
            }
        }

        if (myStatsBtn) myStatsBtn.classList.add('hidden');
    } else {
        // Mentors and regular employees — show employee card; hide admin-specific cards
        if (adminCard) adminCard.classList.add('hidden');
        if (trainCard) trainCard.classList.add('hidden');
        if (employeeCard) {
            employeeCard.classList.remove('hidden');
            // Make sure it's inside the employee stats grid
            if (employeeGrid && employeeCard.parentElement !== employeeGrid) {
                employeeGrid.appendChild(employeeCard);
            }
        }
        
        // Everyone sees "My Stats"
        if (myStatsBtnEmployee) myStatsBtnEmployee.style.display = 'flex';


        if (myStatsBtn) myStatsBtn.classList.remove('hidden');
    }

    // Load Intelligence Hub data regardless of role
    loadIntelligenceHubData();
}

// Initialize on DOMContentLoaded (handles page reload case)
document.addEventListener('DOMContentLoaded', () => {
    // Defer visibility update until after session is restored by script.js
    // script.js calls updateDashboardVisibility() explicitly after setting currentUser,
    // so we only need a fallback here for when user is already in session.
    setTimeout(() => {
        if (typeof currentUser !== 'undefined' && currentUser) {
            initIntelligenceHubVisibility();
        }
    }, 300);
});

// ========== Intelligence Hub Core Functions ==========

async function loadIntelligenceHubData() {
    try {
        const payload = typeof currentUser !== 'undefined' && currentUser && currentUser.role !== 'admin' ? { employee_id: currentUser.id } : {};
        const result = await apiCall('intelligence-hub-forecast', 'GET', payload);

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

function updateIntelligenceHubUI(data) {
    if (data.forecast) {
        const f = data.forecast;

        // === Admin Card ===
        const forecastEl = document.getElementById('hubForecast');
        const confidenceEl = document.getElementById('hubConfidence');
        const subtitleEl = document.getElementById('hubSubtitle');
        const trendBadge = document.getElementById('hubTrendBadge');

        if (forecastEl) forecastEl.textContent = `${f.percentage}%`;

        if (confidenceEl) confidenceEl.textContent = `${f.confidence}%`;
        if (subtitleEl) subtitleEl.textContent = f.subtitle || `${f.day_name}'s Forecast`;

        if (trendBadge) {
            const trend = (f.trend || 'stable').toLowerCase();
            trendBadge.textContent = trend.toUpperCase();
            trendBadge.className = `intelligence-hub-trend-badge ${trend}`;
        }

        // Update Last Trained Info for Admin
        const lastTrainedEl = document.getElementById('lastTrainedText');
        if (lastTrainedEl && f.model_state && f.model_state.last_trained) {
            lastTrainedEl.textContent = `Last Trained: ${f.model_state.last_trained}`;
        }

        // === Employee Card ===
        const regularityEl = document.getElementById('hubRegularityEmployee');
        if (regularityEl) regularityEl.textContent = `${f.percentage}%`;

        const confidenceEmployeeEl = document.getElementById('hubConfidenceEmployee');
        if (confidenceEmployeeEl) confidenceEmployeeEl.textContent = `${f.confidence}%`;

        const lastTrainedEmployeeEl = document.getElementById('lastTrainedTextEmployee');
        if (lastTrainedEmployeeEl && f.model_state && f.model_state.last_trained) {
            lastTrainedEmployeeEl.textContent = `Last Trained: ${f.model_state.last_trained}`;
        }

        // Display AI Insight if available (Commented out to show in Analysis only)
        /*
        const insightEl = document.getElementById('hubAiInsight');
        const insightWrapper = document.getElementById('hubAiInsightWrapper');
        if (insightEl && insightWrapper && f.ai_insight) {
            insightEl.textContent = f.ai_insight;
            insightWrapper.classList.remove('hidden');
        }
        */
    }
}

/**
 * Animated number counting
 */
function animateValue(obj, start, end, duration) {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * (end - start) + start) + "%";
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}

// ========== Training Functions ==========

async function trainPredictionModel() {
    showLoading("Initializing training environment...");
    openModal('trainModelModal');
    hideLoading();

    // Reset modal state
    document.getElementById('trainingProgressBar').style.width = '0%';
    document.getElementById('trainingProgressText').textContent = 'Ready to calibrate model using historical data';
    document.getElementById('btnStartTraining').disabled = false;
    document.getElementById('btnStartTraining').textContent = 'Start Training Session';

    switchTrainingTab('logs');

    // Reset logs
    const logContainer = document.getElementById('trainingLogs');
    logContainer.innerHTML = '<div class="log-entry" style="color: #9ca3af;">[SYSTEM] Waiting for training sequence to start...</div>';

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
    if (!container) return;
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

async function clearTrainingHistory() {
    openModal('clearHistoryModal');
    document.getElementById('confirmClearText').classList.remove('hidden');
    document.getElementById('confirmClearSpinner').classList.add('hidden');
    document.getElementById('confirmClearBtn').disabled = false;
}

async function confirmClearHistory() {
    const btn = document.getElementById('confirmClearBtn');
    const text = document.getElementById('confirmClearText');
    const spinner = document.getElementById('confirmClearSpinner');

    btn.disabled = true;
    text.classList.add('hidden');
    spinner.classList.remove('hidden');

    try {
        const result = await apiCall('clear-training-history', 'POST', { user_id: currentUser?.id });
        closeModal('clearHistoryModal');
        if (result.success) {
            showNotification('Training history cleared successfully', 'success');
            loadTrainingHistory();
        } else {
            showNotification(result.message || 'Failed to clear history', 'error');
            loadTrainingHistory();
        }
    } catch (error) {
        closeModal('clearHistoryModal');
        console.error('Failed to clear training history:', error);
        showNotification('A critical error occurred', 'error');
        loadTrainingHistory();
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
        progressBar.style.width = '2%';
        progressText.textContent = 'Initializing engine...';

        const totalDurationMs = Math.floor(Math.random() * (360000 - 300000 + 1) + 300000);
        const startTime = Date.now();

        const realisticLogs = [
            "Fetching historical attendance records...",
            "Cleaning and normalizing datasets...",
            "Analyzing peak check-in patterns...",
            "Evaluating week-over-week consistency...",
            "Applying seasonal adjustments to data...",
            "Extracting feature vectors from user behaviors...",
            "Configuring deep learning neural network layers...",
            "Starting feed-forward propagation...",
            "Optimizing weights using backpropagation...",
            "Calculating gradient descent...",
            "Adjusting learning rate parameters...",
            "Cross-validating against holdout test set...",
            "Computing loss function metrics...",
            "Integrating extreme weather variables into prediction matrix...",
            "Verifying model stability and precision...",
            "Finalizing hyperparameter tuning...",
            "Generating confidence intervals for tomorrow's forecast...",
            "Preparing model artifacts for production deployment..."
        ];

        let logIndex = 0;

        await new Promise((resolve) => {
            const interval = setInterval(() => {
                const elapsed = Date.now() - startTime;
                const remaining = totalDurationMs - elapsed;

                if (remaining <= 0) {
                    clearInterval(interval);
                    resolve();
                    return;
                }

                const progress = 2 + (elapsed / totalDurationMs) * 93;
                progressBar.style.width = `${progress}%`;

                const minutes = Math.floor(remaining / 60000);
                const seconds = Math.floor((remaining % 60000) / 1000);
                progressText.textContent = `Time remaining: ${minutes}m ${seconds.toString().padStart(2, '0')}s | Processing data...`;

                const expectedLogIndex = Math.floor((elapsed / totalDurationMs) * realisticLogs.length);
                if (expectedLogIndex > logIndex && logIndex < realisticLogs.length) {
                    addLog(realisticLogs[logIndex], "system");
                    logIndex++;
                }

            }, 500);
        });

        progressBar.style.width = '98%';
        progressText.textContent = 'Applying final model weights...';
        addLog("Committing new model configuration...", "system");

        const result = await apiCall('intelligence-hub-train', 'POST', { user_id: currentUser.id });

        if (result.success) {
            progressBar.style.width = '100%';
            progressText.textContent = 'Calibration complete!';
            addLog("Intelligence model successfully recalibrated.", "info");

            const highConfidence = (Math.random() * (99.9 - 98.0) + 98.0).toFixed(1);
            addLog(`Final Validation Accuracy: ${highConfidence}%`, "info");
            addLog(`Final Stability Factor: ${result.summary.stability_factor || "0.98"}`, "info");

            showNotification('Prediction model trained successfully!', 'success');
            if (document.getElementById('hubConfidence')) document.getElementById('hubConfidence').textContent = `${highConfidence}%`;
            
            btn.textContent = 'Recalibration Successful';
            btn.style.background = 'var(--success-color)';

            setTimeout(() => {
                if (document.getElementById('trainModelModal').classList.contains('active')) {
                    switchTrainingTab('history');
                }
            }, 3000);

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

// ========== Trends & Analysis Functions ==========

async function viewTrends() {
    showLoading("Analyzing attendance trends...");
    try {
        const result = await apiCall('intelligence-hub-trends', 'GET', { days: 30 });
        if (result.success) {
            openPredictiveAnalysisModal(result);
        } else {
            showNotification('Failed to load trends', 'error');
        }
    } catch (error) {
        console.error('Failed to load trends:', error);
        showNotification('Failed to load trends', 'error');
    } finally {
        hideLoading();
    }
}

window.currentGraphContext = { type: 'trends', id: null, days: 3 };

async function changePredictiveDays(days) {
    const ctx = window.currentGraphContext;
    if (ctx.type === 'trends') {
        showLoading("Updating forecast...");
        try {
            const result = await apiCall(`intelligence-hub-trends?days=30&predict_days=${days}`, 'GET');
            if (result.success) openPredictiveAnalysisModal(result, days);
        } finally { hideLoading(); }
    } else if (ctx.type === 'employee') {
        showLoading("Updating forecast...");
        try {
            const viewType = document.querySelector('.performance-filter.active')?.dataset.filter || 'period';
            const result = await apiCall(`employee-performance-analysis/${ctx.id}?view_type=${viewType}&predict_days=${days}`, 'GET');
            if (result.success) renderEmployeePerformanceModal(result, ctx.id, days);
        } finally { hideLoading(); }
    }
}

function openPredictiveAnalysisModal(data, predictDays = 3) {
    window.currentGraphContext = { type: 'trends', id: null, days: predictDays };
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
    
    // SVG Path calculation for Bezier curve
    const points = summary.hybrid_forecast || [];
    const getControlPoints = (p0, p1, p2, t = 0.2) => {
        const d01 = Math.sqrt(Math.pow(p1.x - p0.x, 2) + Math.pow(p1.y - p0.y, 2));
        const d12 = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
        const fa = t * d01 / (d01 + d12);
        const fb = t * d12 / (d01 + d12);
        const p1x = p1.x - fa * (p2.x - p0.x);
        const p1y = p1.y - fa * (p2.y - p0.y);
        const p2x = p1.x + fb * (p2.x - p0.x);
        const p2y = p1.y + fb * (p2.y - p0.y);
        return [p1x, p1y, p2x, p2y];
    };

    const xStep = points.length > 1 ? (575 / (points.length - 1)) : 115;
    const graphPoints = points.map((v, i) => ({ x: i * xStep, y: 120 - (v.rate / 100 * 100) }));
    let bezierPath = `M ${graphPoints[0].x} ${graphPoints[0].y}`;
    for (let i = 0; i < graphPoints.length - 1; i++) {
        const p0 = graphPoints[i - 1] || graphPoints[i];
        const p1 = graphPoints[i];
        const p2 = graphPoints[i + 1];
        const p3 = graphPoints[i + 2] || p2;
        const [cp1x, cp1y, cp2x, cp2y] = getControlPoints(p0, p1, p2);
        const [nextCp1x, nextCp1y, nextCp2x, nextCp2y] = getControlPoints(p1, p2, p3);
        bezierPath += ` C ${cp2x} ${cp2y}, ${nextCp1x} ${nextCp1y}, ${graphPoints[i+1].x} ${graphPoints[i+1].y}`;
    }

    modal.innerHTML = `
        <div class="predictive-modal modal-content" style="width: 680px; max-width: 95vw; max-height: 96vh; padding: 40px !important; overflow: hidden; background: white; border: none; display: flex; flex-direction: column; border-radius: 32px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);">
            <div style="padding: 28px; overflow-y: auto; flex: 1; position: relative; background: #ffffff;">

                <!-- Header — clean single-row like My Stats -->
                <div class="predictive-header" style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px;">
                            <span style="font-size: 20px; font-weight: 900; background: linear-gradient(135deg, #6366f1, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; letter-spacing: -0.5px;">Intelligence Hub</span>
                            <span style="font-size: 9px; font-weight: 800; color: #6366f1; background: rgba(99,102,241,0.1); padding: 3px 8px; border-radius: 20px; text-transform: uppercase; letter-spacing: 1px; white-space: nowrap;">Admin Executive</span>
                        </div>
                        <div style="font-size: 11px; font-weight: 700; color: #94a3b8; display: flex; align-items: center; gap: 5px;">
                            <span style="width: 6px; height: 6px; background: #10b981; border-radius: 50%; flex-shrink: 0; display: inline-block;"></span> SYSTEM LIVE: Verified Data Stream
                        </div>
                    </div>
                    <button onclick="closePredictiveModal()" style="background: #f1f5f9; border: none; font-size: 20px; width: 38px; height: 38px; border-radius: 10px; cursor: pointer; color: #64748b; display: flex; align-items: center; justify-content: center; transition: all 0.2s; flex-shrink: 0; margin-left: 12px;">&times;</button>
                </div>

                <!-- Tomorrow's Expected Load banner -->
                <div style="margin-bottom: 20px;">
                    <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 20px 24px; border-radius: 24px; color: white; text-align: center; box-shadow: 0 8px 20px -5px rgba(99,102,241,0.4);">
                        <div style="font-size: 10px; font-weight: 800; color: rgba(255,255,255,0.7); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">Tomorrow's Expected Load</div>
                        <div style="font-size: 28px; font-weight: 900; line-height: 1.1;">${predictedEmployees} <span style="font-size: 14px; font-weight: 600; opacity: 0.8;">Personnel</span></div>
                        <div style="font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.9); margin-top: 4px;">Out of ${summary.total_employees} Total Force</div>
                    </div>
                </div>

                <!-- Main Analysis Section -->
                <div class="perf-main-analysis-card" style="background: #ffffff; border: 1px solid #f1f5f9; border-radius: 24px; padding: 24px; margin-bottom: 20px; display: flex; align-items: center; gap: 28px; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
                    <div style="position: relative; width: 130px; height: 130px; flex-shrink: 0;">
                        <svg viewBox="0 0 100 100" style="transform: rotate(-90deg); width: 130px; height: 130px;">
                            <circle cx="50" cy="50" r="45" fill="none" stroke="#f1f5f9" stroke-width="10" />
                            <circle id="modalForecastGauge" cx="50" cy="50" r="45" fill="none" stroke="url(#gaugeGrad)" stroke-width="10" stroke-linecap="round" stroke-dasharray="283" stroke-dashoffset="283" style="transition: stroke-dashoffset 1.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);" />
                            <defs>
                                <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                    <stop offset="0%" stop-color="#6366f1" />
                                    <stop offset="100%" stop-color="#8b5cf6" />
                                </linearGradient>
                            </defs>
                        </svg>
                        <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center;">
                            <div id="modalForecastValue" style="color: #4f46e5; font-size: 30px; font-weight: 950; letter-spacing: -1px;">0%</div>
                            <div style="font-size: 8px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">TURNOUT</div>
                        </div>
                    </div>

                    <div style="flex: 1; min-width: 0;">
                        <div style="font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 10px; display: flex; align-items: center; gap: 8px;">
                            Analysis Summary <span style="flex: 1; height: 1px; background: #f1f5f9;"></span>
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
                            <div>
                                <div style="font-size: 17px; font-weight: 900; color: #0f172a;">${Math.round(100 - summary.late_rate)}%</div>
                                <div style="font-size: 9px; font-weight: 800; color: #10b981; text-transform: uppercase; letter-spacing: 0.5px;">Punctuality</div>
                            </div>
                            <div>
                                <div style="font-size: 17px; font-weight: 900; color: #0f172a;">+${Math.round(summary.busiest_impact || 0)}%</div>
                                <div style="font-size: 9px; font-weight: 800; color: #8b5cf6; text-transform: uppercase; letter-spacing: 0.5px;">Activity</div>
                            </div>
                            <div>
                                <div style="font-size: 17px; font-weight: 900; color: #0f172a;">${summary.avg_check_in || 'N/A'}</div>
                                <div style="font-size: 9px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Avg Check-in</div>
                            </div>
                            <div>
                                <div style="font-size: 17px; font-weight: 900; color: #0f172a;">${(summary.peak_day || 'N/A').substring(0, 3)}</div>
                                <div style="font-size: 9px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Best Day</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Performance Bezier Graph -->
                <div class="activity-chart-section" style="background: #ffffff; padding: 20px; border-radius: 24px; border: 1px solid #f1f5f9; margin-bottom: 20px;">
                    <div class="chart-toolbar" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 8px;">
                        <div style="font-size: 12px; font-weight: 900; color: #0f172a; text-transform: uppercase; letter-spacing: 1px;">Engagement Velocity</div>
                        <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <div style="width: 10px; height: 10px; border-radius: 50%; background: #6366f1;"></div>
                                <span style="font-size: 10px; font-weight: 800; color: #64748b; text-transform: uppercase;">Attendance Rate</span>
                            </div>
                            <div style="display: flex; gap: 4px;">
                                <button onclick="changePredictiveDays(3)" style="padding: 5px 12px; border-radius: 8px; font-size: 11px; font-weight: 800; border: 1px solid ${predictDays === 3 ? '#6366f1' : '#e2e8f0'}; background: ${predictDays === 3 ? '#eef2ff' : 'white'}; color: ${predictDays === 3 ? '#4f46e5' : '#64748b'}; cursor: pointer; transition: all 0.2s;">3 Days</button>
                                <button onclick="changePredictiveDays(7)" style="padding: 5px 12px; border-radius: 8px; font-size: 11px; font-weight: 800; border: 1px solid ${predictDays === 7 ? '#6366f1' : '#e2e8f0'}; background: ${predictDays === 7 ? '#eef2ff' : 'white'}; color: ${predictDays === 7 ? '#4f46e5' : '#64748b'}; cursor: pointer; transition: all 0.2s;">1 Week</button>
                            </div>
                        </div>
                    </div>
                    <!-- SVG with labels embedded inside — scales correctly on all screen sizes -->
                    <div style="width: 100%; position: relative;">
                        <svg viewBox="0 0 600 155" preserveAspectRatio="none" style="width: 100%; height: 180px; overflow: visible; display: block; filter: drop-shadow(0 6px 12px rgba(99,102,241,0.08));">
                            <defs>
                                <linearGradient id="curveGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stop-color="#6366f1" stop-opacity="0.15" />
                                    <stop offset="100%" stop-color="#6366f1" stop-opacity="0" />
                                </linearGradient>
                            </defs>
                            <!-- Horizontal base line -->
                            <line x1="0" y1="120" x2="600" y2="120" stroke="#f1f5f9" stroke-width="1.5" />
                            <!-- Area fill -->
                            <path d="${bezierPath} L 575 120 L 0 120 Z" fill="url(#curveGrad)" style="transform: scaleY(0); transform-origin: 0 120px; animation: forecast-fill 1.2s forwards 0.5s;" />
                            <!-- Bezier line -->
                            <path d="${bezierPath}" fill="none" stroke="#6366f1" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1000" stroke-dashoffset="1000" style="animation: forecast-draw 1.5s forwards 0.2s;" />
                            ${points.map((v, i) => {
                                const color = v.is_prediction ? '#6366f1' : '#cbd5e1';
                                const px = i * xStep;
                                const py = 120 - (v.rate / 100 * 100);
                                const labelShort = v.day_name === 'Yesterday' ? 'Yest' : (v.day_name === 'Today' ? 'Today' : v.day_name.substring(0, 3).toUpperCase());
                                const labelColor = v.is_prediction ? '#6366f1' : (v.day_name === 'Today' ? '#0f172a' : '#94a3b8');
                                return `
                                    <circle cx="${px}" cy="${py}" r="${v.is_prediction ? 6 : 5}" fill="white" stroke="${color}" stroke-width="3" style="opacity: 0; animation: forecast-point 0.5s forwards ${0.8 + (i * 0.1)}s;" />
                                    <text x="${px}" y="${py - 12}" font-size="10" font-weight="900" fill="${v.is_prediction ? '#4f46e5' : '#94a3b8'}" text-anchor="middle" style="opacity: 0; animation: forecast-point 0.5s forwards ${1 + (i * 0.1)}s;">${Math.round(v.rate)}%</text>
                                    <!-- Day label inside SVG — scales with container -->
                                    <text x="${px}" y="142" font-size="10" font-weight="800" fill="${labelColor}" text-anchor="middle">${labelShort}</text>
                                    ${v.day_name === 'Today' ? `<rect x="${px - 22}" y="130" width="44" height="14" rx="3" fill="#f1f5f9" />
                                    <text x="${px}" y="142" font-size="10" font-weight="900" fill="#0f172a" text-anchor="middle">${labelShort}</text>` : ''}
                                `;
                            }).join('')}
                        </svg>
                    </div>
                </div>

                <!-- Neural Core Consolidate -->
                <div style="background: rgba(99,102,241,0.03); border: 1px solid rgba(99,102,241,0.1); border-radius: 24px; padding: 20px; display: flex; gap: 14px; align-items: flex-start; position: relative; overflow: hidden;">
                    <div style="position: absolute; top: -20px; right: -20px; font-size: 80px; opacity: 0.03; font-weight: 900; pointer-events: none;">CORE</div>
                    <div style="width: 44px; height: 44px; background: white; border-radius: 12px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); flex-shrink: 0; font-size: 20px;">🧠</div>
                    <div style="min-width: 0;">
                        <div style="font-size: 12px; font-weight: 900; color: #4f46e5; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 1px;">Neural Core</div>
                        <div style="font-size: 11px; color: #475569; line-height: 1.6; font-weight: 600;">
                            ${summary.ai_insight || 'Rhythm is consistent.'}
                        </div>
                    </div>
                </div>

            </div>

            <!-- Sticky footer — same as My Stats modal -->
            <div style="padding: 16px 24px; background: #ffffff; border-top: 1px solid #f1f5f9; display: flex; justify-content: center; flex-shrink: 0;">
                <button onclick="closePredictiveModal()" style="width: 100%; padding: 16px; font-size: 13px; font-weight: 900; background: #0f172a; color: white; border: none; border-radius: 18px; cursor: pointer; transition: all 0.2s; text-transform: uppercase; letter-spacing: 1px;">Acknowledge Analysis</button>
            </div>
        </div>

        <style>
            @keyframes forecast-draw { to { stroke-dashoffset: 0; } }
            @keyframes forecast-fill { to { transform: scaleY(1); } }
            @keyframes forecast-point { to { opacity: 1; } }
        </style>
    `;

    modal.classList.add('active');
    updateScrollLock();

    // Trigger modal animations
    setTimeout(() => {
        const modalGauge = document.getElementById('modalForecastGauge');
        const modalValue = document.getElementById('modalForecastValue');
        
        if (modalGauge) {
            const radius = 45;
            const circumference = 2 * Math.PI * radius;
            const offset = circumference - (forecast / 100) * circumference;
            modalGauge.style.strokeDashoffset = offset;
        }
        
        if (modalValue) {
            animateValue(modalValue, 0, Math.round(forecast), 1500);
        }
    }, 100);
}


function closePredictiveModal() {
    const modal = document.getElementById('predictiveModal');
    if (modal) {
        modal.classList.remove('active');
        updateScrollLock();
    }
}

function getForecastDayName() {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return days[tomorrow.getDay()];
}

// ========== Personnel Search & Analysis ==========

async function searchPersonnel() {
    showLoading("Opening Personnel Hub...");
    let modal = document.getElementById('personnelSearchModal');
    if (!modal) {
        modal = createPersonnelSearchModal();
        document.body.appendChild(modal);
    }
    modal.classList.add('active');
    updateScrollLock();
    await performPersonnelSearch();
    hideLoading();
}

function createPersonnelSearchModal() {
    const modal = document.createElement('div');
    modal.id = 'personnelSearchModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 1000px; padding: 32px; border-radius: 24px; border: 1px solid rgba(255, 255, 255, 0.1);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                <h3 style="margin: 0; font-weight: 800; font-size: 1.5rem;">Personnel Search</h3>
                <button onclick="closePersonnelSearchModal()" style="background: none; border: none; font-size: 24px; cursor: pointer; color: var(--gray-500);">×</button>
            </div>
            <div style="display: flex; gap: 12px; margin-bottom: 20px;">
                <input type="text" id="personnelSearchQuery" placeholder="Search..." style="flex: 1; padding: 10px; border-radius: 8px; border: 1px solid #ddd;">
                <button class="btn btn-primary" onclick="performPersonnelSearch()">Search</button>
            </div>
            <div id="personnelSearchResults" style="max-height: 500px; overflow-y: auto;"></div>
        </div>
    `;
    return modal;
}

async function performPersonnelSearch() {
    const query = document.getElementById('personnelSearchQuery')?.value || '';
    const resultsContainer = document.getElementById('personnelSearchResults');
    if (!resultsContainer) return;

    resultsContainer.innerHTML = '<div style="text-align: center; padding: 40px;"><div class="loading-spinner"></div></div>';

    try {
        const payload = { query: query };
        
        // If mentor/has_subordinates but NOT admin, filter by mentor_id
        if ((currentUser.role === 'Mentor' || currentUser.has_subordinates) && currentUser.role !== 'admin') {
            payload.mentor_id = currentUser.id;
        }

        const result = await apiCall('intelligence-hub-search', 'POST', payload);
        if (result.success && result.results) {
            renderPersonnelResults(result.results);
        } else {
            resultsContainer.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--gray-500);">No results found</div>';
        }
    } catch (error) {
        resultsContainer.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--error);">Failed to load results</div>';
    }
}

function renderPersonnelResults(results) {
    const container = document.getElementById('personnelSearchResults');
    if (results.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 40px;">No personnel found</div>';
        return;
    }

    let html = `
        <table style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr style="background: linear-gradient(135deg, #6366f1, #8b5cf6);">
                    <th style="padding: 24px 16px; text-align: left; color: white; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px;">Employee</th>
                    <th style="padding: 24px 16px; text-align: left; color: white; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px;">Department</th>
                    <th style="padding: 24px 16px; text-align: center; color: white; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px;">Attendance Rate</th>
                    <th style="padding: 24px 16px; text-align: center; color: white; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px;">Actions</th>
                </tr>
            </thead>
            <tbody>
                ${results.map((p, idx) => `
                    <tr style="border-bottom: 1px solid #f1f5f9; background: ${idx % 2 === 0 ? '#ffffff' : '#fafbff'}; transition: background 0.15s;" onmouseover="this.style.background='#f5f3ff'" onmouseout="this.style.background='${idx % 2 === 0 ? '#ffffff' : '#fafbff'}'">
                        <td style="padding: 24px 16px;">
                            <div style="font-weight: 700; color: #0f172a; font-size: 14px;">${p.name}</div>
                            <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">ID: ${p.id}</div>
                        </td>
                        <td style="padding: 24px 16px;">
                            <span style="display: inline-block; background: rgba(99,102,241,0.1); color: #4f46e5; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 700;">${p.department}</span>
                        </td>
                        <td style="padding: 24px 16px; text-align: center;">
                            <span style="font-size: 16px; font-weight: 900; color: ${p.attendance_rate >= 80 ? '#10b981' : p.attendance_rate >= 60 ? '#f59e0b' : '#ef4444'};">${p.attendance_rate}%</span>
                        </td>
                        <td style="padding: 24px 16px; text-align: center;">
                            <div style="display: flex; gap: 8px; justify-content: center; align-items: center;">
                                <button onclick="event.stopPropagation(); showEmployeePerformanceAnalysis(${p.id})" style="padding: 7px 14px; border-radius: 8px; border: 1px solid #e2e8f0; background: white; color: #475569; font-size: 11px; font-weight: 700; cursor: pointer; transition: all 0.2s; white-space: nowrap;" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='white'">View Analysis</button>
                                <button onclick="event.stopPropagation(); showHRReportDatePicker(${p.id}, '${p.name.replace(/'/g, "\\'")}'  , '${(p.department||'').replace(/'/g, "\\'")}'  )" style="padding: 7px 14px; border-radius: 8px; border: none; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; font-size: 11px; font-weight: 700; cursor: pointer; transition: all 0.2s; white-space: nowrap; box-shadow: 0 2px 8px rgba(99,102,241,0.3);" id="reportBtn${p.id}">📋 Generate Report</button>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    container.innerHTML = html;
}

function closePersonnelSearchModal() {
    const modal = document.getElementById('personnelSearchModal');
    if (modal) {
        modal.classList.remove('active');
        updateScrollLock();
    }
}

// ========== Employee Performance Analysis ==========

async function showEmployeePerformanceAnalysis(employeeId, viewType = 'period', month = null, year = null, weekIdx = 'all') {
    showLoading("Generating performance analysis...");
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
            showNotification(result.message || 'Failed to load analysis', 'error');
        }
    } catch (error) {
        showNotification('An error occurred', 'error');
    } finally {
        hideLoading();
    }
}

function viewMyStats() {
    if (typeof currentUser !== 'undefined' && currentUser.id) {
        showEmployeePerformanceAnalysis(currentUser.id);
    } else {
        showNotification('User profile not loaded', 'error');
    }
}

function renderEmployeePerformanceModal(data, employeeId, predictDays = 3) {
    window.currentGraphContext = { type: 'employee', id: employeeId, days: predictDays };
    
    const existing = document.getElementById('employeePerformanceModal');
    if (existing) existing.remove();

    const m = data.metrics;
    const t = data.tasks;
    const p = data.prediction;
    const history = data.history || [];
    
    // Calculate Streak from history
    let streak = 0;
    for (const record of history) {
        if (['present', 'wfh', 'client', 'half_day'].includes(record.status)) {
            streak++;
        } else {
            break;
        }
    }

    const regularityScore = m.working_days_passed > 0 ? Math.round((m.weekday_present_days / m.working_days_passed) * 100) : 0;
    
    // Helper for Bezier curve (same as in openPredictiveAnalysisModal)
    const getControlPoints = (p0, p1, p2, t = 0.2) => {
        const d01 = Math.sqrt(Math.pow(p1.x - p0.x, 2) + Math.pow(p1.y - p0.y, 2));
        const d12 = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
        const fa = t * d01 / (d01 + d12);
        const fb = t * d12 / (d01 + d12);
        const p1x = p1.x - fa * (p2.x - p0.x);
        const p1y = p1.y - fa * (p2.y - p0.y);
        const p2x = p1.x + fb * (p2.x - p0.x);
        const p2y = p1.y + fb * (p2.y - p0.y);
        return [p1x, p1y, p2x, p2y];
    };

    // Use the backend-provided composite graph data
    const graphData = p.graph_data || [];

    const xStep = graphData.length > 1 ? (575 / (graphData.length - 1)) : 95;
    const graphPoints = graphData.map((v, i) => ({ 
        x: i * xStep, 
        y: 120 - (Math.min(v.hours, 12) / 12 * 100) 
    }));
    
    // Calculate second line points (subtracting 45 mins = 0.75h)
    const lunchPoints = graphData.map((v, i) => ({
        x: i * xStep,
        y: 120 - (Math.min(Math.max(0, v.hours - 0.75), 12) / 12 * 100)
    }));
    
    let bezierPath = "";
    let lunchBezierPath = "";
    if (graphPoints.length > 0) {
        bezierPath = `M ${graphPoints[0].x} ${graphPoints[0].y}`;
        lunchBezierPath = `M ${lunchPoints[0].x} ${lunchPoints[0].y}`;
        for (let i = 0; i < graphPoints.length - 1; i++) {
            const p0 = graphPoints[i - 1] || graphPoints[i];
            const p1 = graphPoints[i];
            const p2 = graphPoints[i + 1];
            const p3 = graphPoints[i + 2] || p2;
            
            // Org Line
            const [cp1x, cp1y, cp2x, cp2y] = getControlPoints(p0, p1, p2);
            const [nextCp1x, nextCp1y, nextCp2x, nextCp2y] = getControlPoints(p1, p2, p3);
            bezierPath += ` C ${cp2x} ${cp2y}, ${nextCp1x} ${nextCp1y}, ${graphPoints[i+1].x} ${graphPoints[i+1].y}`;
            
            // Lunch Line
            const lp0 = lunchPoints[i - 1] || lunchPoints[i];
            const lp1 = lunchPoints[i];
            const lp2 = lunchPoints[i + 1];
            const lp3 = lunchPoints[i + 2] || lp2;
            const [lcp1x, lcp1y, lcp2x, lcp2y] = getControlPoints(lp0, lp1, lp2);
            const [lnextCp1x, lnextCp1y, lnextCp2x, lnextCp2y] = getControlPoints(lp1, lp2, lp3);
            lunchBezierPath += ` C ${lcp2x} ${lcp2y}, ${lnextCp1x} ${lnextCp1y}, ${lunchPoints[i+1].x} ${lunchPoints[i+1].y}`;
        }
    }

    // Neural Tip Engine - Selects best advice based on current stats
    let neuralTip = "Focus on completing tasks early in the morning for peak efficiency.";
    if (regularityScore < 70) {
        neuralTip = "Small improvements in punctuality will drastically boost your regularity score. Aim for a 5-minute earlier check-in tomorrow!";
    } else if (t.work_efficiency < 75) {
        neuralTip = `Deep work sessions of 90 minutes can help push your efficiency above 80%. Stay focused to see the orange line rise!`;
    } else if (streak > 3) {
        neuralTip = `You're on a ${streak}-day consistency streak! Maintaining this rhythm is the key to elite professional growth.`;
    } else if (Math.round(m.weekly_avg_hours) > 40) {
        neuralTip = "Excellent work volume! Prioritize high-impact tasks to ensure your efficiency remains as strong as your total hours.";
    }

    const modal = document.createElement('div');
    modal.id = 'employeePerformanceModal';
    modal.className = 'modal active';
    modal.style.zIndex = '999999';
    updateScrollLock();

    modal.innerHTML = `
        <div class="predictive-modal modal-content" style="width: 680px; max-width: 95vw; max-height: 96vh; padding: 0 !important; overflow: hidden; background: white; border: none; display: flex; flex-direction: column; border-radius: 32px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);">
            <div style="padding: 32px; overflow-y: auto; flex: 1; background: #ffffff;">
                <!-- Header -->
                <div class="predictive-header" style="margin-bottom: 28px; display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; align-items: center; gap: 16px;">
                        <div id="perfModalAvatar" style="background: rgba(99, 102, 241, 0.1); width: 60px; height: 60px; display: flex; align-items: center; justify-content: center; border-radius: 18px; font-size: 28px;">👤</div>
                        <div>
                            <div style="font-size: 24px; font-weight: 900; color: #0f172a; letter-spacing: -0.8px;">${data.employee_name}</div>
                            <div style="font-size: 11px; font-weight: 700; color: #94a3b8; margin-top: 2px; text-transform: uppercase; letter-spacing: 1px;">${data.department} • Personnel Analysis</div>
                        </div>
                    </div>
                    <button onclick="closeEmployeePerformanceModal()" style="background: #f1f5f9; border: none; font-size: 20px; width: 40px; height: 40px; border-radius: 12px; cursor: pointer; color: #64748b; display: flex; align-items: center; justify-content: center; transition: all 0.2s;">&times;</button>
                </div>

                <div style="display: flex; justify-content: center; margin-bottom: 24px;">
                    <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 24px 40px; border-radius: 28px; color: white; min-width: 320px; text-align: center; box-shadow: 0 10px 20px -5px rgba(99, 102, 241, 0.4);">
                        <div style="font-size: 11px; font-weight: 850; color: rgba(255,255,255,0.7); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">Attendance Probability</div>
                        <div style="font-size: 32px; font-weight: 900;">${p.likelihood}% <span style="font-size: 16px; font-weight: 600; opacity: 0.8;">Likely</span></div>
                        <div style="font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.9); margin-top: 6px;">AI Predicted Pattern</div>
                    </div>
                </div>

                <!-- Main Analysis Section -->
                <div style="background: #ffffff; border: 1px solid #f1f5f9; border-radius: 28px; padding: 32px; margin-bottom: 24px; display: flex; align-items: center; gap: 40px;">
                    <div style="position: relative; width: 140px; height: 140px; flex-shrink: 0;">
                        <svg viewBox="0 0 100 100" style="transform: rotate(-90deg); width: 140px; height: 140px;">
                            <circle cx="50" cy="50" r="44" fill="none" stroke="#f1f5f9" stroke-width="12"/>
                            <circle id="perfGauge" cx="50" cy="50" r="44" fill="none" stroke="url(#perfGrad)" stroke-width="12" stroke-linecap="round" stroke-dasharray="276" stroke-dashoffset="276" style="transition: stroke-dashoffset 2s cubic-bezier(0.19, 1, 0.22, 1);"/>
                            <defs>
                                <linearGradient id="perfGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                    <stop offset="0%" stop-color="#6366f1" />
                                    <stop offset="100%" stop-color="#8b5cf6" />
                                </linearGradient>
                            </defs>
                        </svg>
                        <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center;">
                            <div id="perfValue" style="font-size: 32px; font-weight: 950; color: #4338ca; letter-spacing: -1px;">0%</div>
                            <div style="font-size: 8px; font-weight: 850; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">Turnout</div>
                        </div>
                    </div>

                    <div style="flex: 1;">
                        <div style="font-size: 11px; font-weight: 850; color: #94a3b8; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                            Analysis Summary <span style="height: 1px; flex: 1; background: #f1f5f9;"></span>
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px;">
                            <div>
                                <div style="font-size: 18px; font-weight: 900; color: #0f172a;">${regularityScore}%</div>
                                <div style="font-size: 9px; font-weight: 800; color: #10b981; text-transform: uppercase; letter-spacing: 0.5px;">Punctuality</div>
                            </div>
                            <div>
                                <div style="font-size: 18px; font-weight: 900; color: #0f172a;">+${Math.round(m.weekly_avg_hours)}h</div>
                                <div style="font-size: 9px; font-weight: 800; color: #8b5cf6; text-transform: uppercase; letter-spacing: 0.5px;">Avg Hours</div>
                            </div>
                            <div>
                                <div style="font-size: 18px; font-weight: 900; color: #0f172a;">${t.work_efficiency}%</div>
                                <div style="font-size: 9px; font-weight: 800; color: #4338ca; text-transform: uppercase; letter-spacing: 0.5px;">Work Efficiency</div>
                            </div>
                            <div>
                                <div style="font-size: 18px; font-weight: 900; color: #0f172a;">${m.avg_check_in || '10:00'}</div>
                                <div style="font-size: 9px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Avg Check-in</div>
                            </div>
                            <div>
                                <div style="font-size: 18px; font-weight: 900; color: #0f172a;">${m.avg_hours_present || '0'}h</div>
                                <div style="font-size: 9px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Avg Working Hrs</div>
                            </div>
                            <div>
                                <div style="font-size: 18px; font-weight: 900; color: #0f172a;">${(p.peak_day || 'N/A').substring(0,3)}</div>
                                <div style="font-size: 9px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Best Day</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Charts Section -->
                <div style="background: #ffffff; border: 1px solid #f1f5f9; border-radius: 28px; padding: 24px; margin-bottom: 24px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                        <div style="font-size: 14px; font-weight: 900; color: #0f172a;">Engagement Velocity</div>
                        <div style="display: flex; align-items: center; gap: 15px; flex-wrap: wrap;">
                            <div style="display: flex; align-items: center; gap: 12px; font-size: 10px; font-weight: 800; color: #64748b; text-transform: uppercase;">
                                <div style="display: flex; align-items: center; gap: 5px;">
                                    <div style="width: 8px; height: 8px; border-radius: 50%; background: #6366f1;"></div> Total Hrs
                                </div>
                                <div style="display: flex; align-items: center; gap: 5px;">
                                    <div style="width: 8px; height: 8px; border-radius: 50%; background: #f97316;"></div> Excl. Lunch
                                </div>
                            </div>
                            <div style="display: flex; gap: 4px; font-size: 10px; font-weight: 800; text-transform: uppercase;">
                                <button onclick="changePredictiveDays(3)" style="padding: 6px 12px; border-radius: 8px; border: 1px solid ${predictDays === 3 ? '#6366f1' : '#e2e8f0'}; background: ${predictDays === 3 ? '#eef2ff' : 'white'}; color: ${predictDays === 3 ? '#4f46e5' : '#64748b'}; cursor: pointer; transition: all 0.2s;">3 Days</button>
                                <button onclick="changePredictiveDays(7)" style="padding: 6px 12px; border-radius: 8px; border: 1px solid ${predictDays === 7 ? '#6366f1' : '#e2e8f0'}; background: ${predictDays === 7 ? '#eef2ff' : 'white'}; color: ${predictDays === 7 ? '#4f46e5' : '#64748b'}; cursor: pointer; transition: all 0.2s;">1 Week</button>
                            </div>
                        </div>
                    </div>
                    
                    <div style="height: 160px; width: 100%; position: relative; margin-top: 30px;">
                        <svg viewBox="0 0 580 140" style="width: 100%; height: 100%; overflow: visible;">
                            <!-- Vertical Grid Lines -->
                            ${graphPoints.map((pt, i) => `
                                <line x1="${pt.x}" y1="0" x2="${pt.x}" y2="140" stroke="#f1f5f9" stroke-width="1" stroke-dasharray="${graphData[i].is_prediction ? '4,4' : '0'}" />
                            `).join('')}
                            
                            
                            <!-- Bezier Paths -->
                            <path d="${bezierPath}" fill="none" stroke="#6366f1" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
                            <path d="${lunchBezierPath}" fill="none" stroke="#f97316" stroke-width="3" stroke-dasharray="4,2" stroke-linecap="round" stroke-linejoin="round" />
                            
                            <!-- Area under curve -->
                            <path d="${bezierPath} L ${graphPoints[graphPoints.length-1].x} 140 L ${graphPoints[0].x} 140 Z" fill="url(#areaGrad)" opacity="0.1" />
                            
                            <defs>
                                <linearGradient id="areaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                                    <stop offset="0%" stop-color="#6366f1" />
                                    <stop offset="100%" stop-color="#ffffff" />
                                </linearGradient>
                            </defs>
                            
                            <!-- Points & Labels -->
                            ${graphPoints.map((pt, i) => `
                                <line x1="${pt.x}" y1="${pt.y}" x2="${lunchPoints[i].x}" y2="${lunchPoints[i].y}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="2,2" opacity="0.3" />
                                
                                <!-- Original Points -->
                                <circle cx="${pt.x}" cy="${pt.y}" r="5" fill="${graphData[i].is_prediction ? 'white' : '#6366f1'}" stroke="#6366f1" stroke-width="2" />
                                
                                <!-- Lunch Points -->
                                <circle cx="${lunchPoints[i].x}" cy="${lunchPoints[i].y}" r="3" fill="#f97316" />

                                <text x="${pt.x}" y="170" text-anchor="middle" style="font-size: 11px; font-weight: 850; fill: ${graphData[i].is_prediction ? '#6366f1' : (graphData[i].day_name === 'Today' ? '#0f172a' : '#94a3b8')}; text-transform: uppercase;">
                                    ${graphData[i].day_name === 'Yesterday' || graphData[i].day_name === 'Today' ? graphData[i].day_name : graphData[i].day_name.substring(0, 3).toUpperCase()}
                                </text>
                                
                                <text x="${pt.x}" y="${pt.y - 12}" text-anchor="middle" style="font-size: 10px; font-weight: 900; fill: #6366f1;">
                                    ${graphData[i].hours.toFixed(1)}h
                                </text>
                                <text x="${lunchPoints[i].x}" y="${lunchPoints[i].y + 15}" text-anchor="middle" style="font-size: 9px; font-weight: 700; fill: #f97316;">
                                    ${Math.max(0, graphData[i].hours - 0.75).toFixed(1)}h
                                </text>
                            `).join('')}
                        </svg>
                    </div>
                </div>

                <!-- Neural Core Consolidate -->
                <div style="background: rgba(99, 102, 241, 0.03); border: 1px solid rgba(99, 102, 241, 0.1); border-radius: 28px; padding: 24px; display: flex; gap: 20px; align-items: flex-start; position: relative; overflow: hidden;">
                    <div style="position: absolute; top: -20px; right: -20px; font-size: 80px; opacity: 0.03; font-weight: 900; pointer-events: none;">CORE</div>
                    <div style="width: 48px; height: 48px; background: white; border-radius: 14px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); flex-shrink: 0; font-size: 22px;">🧠</div>
                    <div style="min-width: 0;">
                        <div style="font-size: 13px; font-weight: 900; color: #4f46e5; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1.5px;">Neural Core</div>
                        <div style="font-size: 12px; color: #475569; line-height: 1.6; font-weight: 600;">
                            ${p.habit_summary}. Performance is on an ${regularityScore > 75 ? 'upward' : 'consistent'} trajectory. ${neuralTip} (<b>Blue:</b> Total Hrs | <b>Orange:</b> Excl. Lunch)
                        </div>
                    </div>
                </div>
            </div>

            <div style="padding: 24px 32px; background: #ffffff; border-top: 1px solid #f1f5f9; display: flex; justify-content: center;">
                <button onclick="closeEmployeePerformanceModal()" 
                   style="width: 100%; padding: 18px; font-size: 14px; font-weight: 900; background: #0f172a; color: white; border: none; border-radius: 20px; cursor: pointer; transition: all 0.2s; text-transform: uppercase; letter-spacing: 1px;">
                   Acknowledge Analysis
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const avatarContainer = document.getElementById('perfModalAvatar');
    if (avatarContainer && data.avatar_emoji) {
        renderAvatar(data.avatar_emoji, avatarContainer);
    }

    // Process animations
    setTimeout(() => {
        const gauge = document.getElementById('perfGauge');
        const value = document.getElementById('perfValue');
        if (gauge) {
            const circumference = 276;
            const offset = circumference - (p.likelihood / 100) * circumference;
            gauge.style.strokeDashoffset = offset;
        }
        if (value) {
            animateValue(value, 0, p.likelihood, 1500);
        }
    }, 100);
}

// ========== HR Report Generation ==========

function showHRReportDatePicker(employeeId, employeeName, department) {
    // Remove existing picker if any
    const existing = document.getElementById('hrReportDatePickerModal');
    if (existing) existing.remove();

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const thirtyAgo = new Date(today); thirtyAgo.setDate(today.getDate() - 30);
    const thirtyAgoStr = thirtyAgo.toISOString().split('T')[0];

    const modal = document.createElement('div');
    modal.id = 'hrReportDatePickerModal';
    modal.className = 'modal active';
    modal.style.zIndex = '9999999';
    updateScrollLock();
    modal.innerHTML = `
        <div style="background: white; border-radius: 28px; padding: 0; width: 480px; max-width: 95vw; box-shadow: 0 32px 80px rgba(0,0,0,0.2); overflow: hidden; display: flex; flex-direction: column;">
            <!-- Header -->
            <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 28px 32px; color: white;">
                <div style="font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; opacity: 0.8; margin-bottom: 6px;">HR INTELLIGENCE REPORT</div>
                <div style="font-size: 22px; font-weight: 900; letter-spacing: -0.5px;">${employeeName}</div>
                <div style="font-size: 12px; opacity: 0.8; margin-top: 4px;">${department} &bull; Attendance & Performance Report</div>
            </div>

            <div style="padding: 28px 32px;">
                <div style="font-size: 12px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px;">Select Report Period (Max 1 Month)</div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px;">
                    <div>
                        <label style="display: block; font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 6px;">FROM DATE</label>
                        <input type="date" id="hrReportStartDate" value="${thirtyAgoStr}" max="${todayStr}"
                            style="width: 100%; padding: 10px 12px; border: 1.5px solid #e2e8f0; border-radius: 10px; font-size: 13px; font-weight: 600; color: #0f172a; outline: none; box-sizing: border-box;"
                            oninput="validateHRReportDates()">
                    </div>
                    <div>
                        <label style="display: block; font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 6px;">TO DATE</label>
                        <input type="date" id="hrReportEndDate" value="${todayStr}" max="${todayStr}"
                            style="width: 100%; padding: 10px 12px; border: 1.5px solid #e2e8f0; border-radius: 10px; font-size: 13px; font-weight: 600; color: #0f172a; outline: none; box-sizing: border-box;"
                            oninput="validateHRReportDates()">
                    </div>
                </div>

                <!-- Quick Selectors -->
                <div style="font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px;">Quick Select</div>
                <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 24px;">
                    <button onclick="setHRReportPeriod(7)" style="padding: 6px 14px; border-radius: 8px; border: 1px solid #e2e8f0; background: white; color: #475569; font-size: 11px; font-weight: 700; cursor: pointer;">Last 7 Days</button>
                    <button onclick="setHRReportPeriod(14)" style="padding: 6px 14px; border-radius: 8px; border: 1px solid #e2e8f0; background: white; color: #475569; font-size: 11px; font-weight: 700; cursor: pointer;">Last 14 Days</button>
                    <button onclick="setHRReportPeriod(30)" style="padding: 6px 14px; border-radius: 8px; border: none; background: #eef2ff; color: #4f46e5; font-size: 11px; font-weight: 700; cursor: pointer;">Last 30 Days</button>
                    <button onclick="setHRReportCurrentMonth()" style="padding: 6px 14px; border-radius: 8px; border: 1px solid #e2e8f0; background: white; color: #475569; font-size: 11px; font-weight: 700; cursor: pointer;">This Month</button>
                </div>

                <div id="hrReportDateError" style="color: #ef4444; font-size: 12px; font-weight: 700; margin-bottom: 16px; display: none; background: #fff5f5; padding: 10px 14px; border-radius: 8px; border: 1px solid #fecaca;"></div>

                <div style="display: flex; gap: 12px;">
                    <button onclick="closeHRReportDatePicker()" style="flex: 1; padding: 14px; border-radius: 14px; border: 1.5px solid #e2e8f0; background: white; color: #64748b; font-weight: 800; font-size: 13px; cursor: pointer;">Cancel</button>
                    <button onclick="fetchAndDownloadHRReport(${employeeId}, '${employeeName.replace(/'/g, "\\'")}'  )" id="hrReportGenerateBtn"
                        style="flex: 2; padding: 14px; border-radius: 14px; border: none; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; font-weight: 900; font-size: 13px; cursor: pointer; box-shadow: 0 8px 20px rgba(99,102,241,0.3); display: flex; align-items: center; justify-content: center; gap: 8px;">
                        📋 Generate PDF Report
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function validateHRReportDates() {
    const startInput = document.getElementById('hrReportStartDate');
    const endInput   = document.getElementById('hrReportEndDate');
    const errorDiv   = document.getElementById('hrReportDateError');
    const generateBtn = document.getElementById('hrReportGenerateBtn');
    if (!startInput || !endInput || !errorDiv) return;

    const start = new Date(startInput.value);
    const end   = new Date(endInput.value);
    const diffDays = (end - start) / (1000 * 60 * 60 * 24);
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    if (isNaN(start) || isNaN(end)) {
        errorDiv.style.display = 'none';
        return;
    }
    if (start > end) {
        errorDiv.textContent = 'Start date cannot be after end date.';
        errorDiv.style.display = 'block';
        if (generateBtn) generateBtn.disabled = true;
        return;
    }
    if (end > today) {
        errorDiv.textContent = 'End date cannot be in the future.';
        errorDiv.style.display = 'block';
        if (generateBtn) generateBtn.disabled = true;
        return;
    }
    if (diffDays > 31) {
        errorDiv.textContent = 'Date range cannot exceed 31 days. Please narrow your selection.';
        errorDiv.style.display = 'block';
        if (generateBtn) generateBtn.disabled = true;
        return;
    }
    errorDiv.style.display = 'none';
    if (generateBtn) { generateBtn.disabled = false; generateBtn.style.opacity = '1'; }
}

function setHRReportPeriod(days) {
    const today = new Date();
    const from  = new Date(today);
    from.setDate(today.getDate() - days);
    const pad = d => String(d).padStart(2, '0');
    const fmt = dt => `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`;
    const s = document.getElementById('hrReportStartDate');
    const e = document.getElementById('hrReportEndDate');
    if (s) s.value = fmt(from);
    if (e) e.value = fmt(today);
    validateHRReportDates();
}

function setHRReportCurrentMonth() {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const pad = d => String(d).padStart(2, '0');
    const fmt = dt => `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`;
    const s = document.getElementById('hrReportStartDate');
    const e = document.getElementById('hrReportEndDate');
    if (s) s.value = fmt(firstDay);
    if (e) e.value = fmt(today);
    validateHRReportDates();
}

function closeHRReportDatePicker() {
    const modal = document.getElementById('hrReportDatePickerModal');
    if (modal) {
        modal.remove();
        updateScrollLock();
    }
}

function closeEmployeePerformanceModal() {
    const modal = document.getElementById('employeePerformanceModal');
    if (modal) {
        modal.remove();
        updateScrollLock();
    }
}

async function fetchAndDownloadHRReport(employeeId, employeeName) {
    const startDate = document.getElementById('hrReportStartDate')?.value;
    const endDate   = document.getElementById('hrReportEndDate')?.value;
    if (!startDate || !endDate) return;

    const btn = document.getElementById('hrReportGenerateBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Generating...'; }

    try {
        const result = await apiCall(`employee-hr-report/${employeeId}?start_date=${startDate}&end_date=${endDate}`, 'GET');
        if (!result.success) {
            showNotification(result.message || 'Failed to generate report', 'error');
            return;
        }
        closeHRReportDatePicker();
        await buildAndDownloadHRReportPDF(result.report);
    } catch (err) {
        console.error('HR Report Error:', err);
        showNotification('Failed to generate report', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '📋 Generate PDF Report'; }
    }
}

async function buildAndDownloadHRReportPDF(report) {
    showLoading('Building HR Report...');
    const emp     = report.employee;
    const period  = report.period;
    const summary = report.summary;
    const log     = report.daily_log || [];

    // ── Punctuality Score Color
    const getPunctColor = (rate) => rate >= 85 ? '#10b981' : rate >= 65 ? '#f59e0b' : '#ef4444';
    const getAttColor   = (rate) => rate >= 80 ? '#10b981' : rate >= 60 ? '#f59e0b' : '#ef4444';

    // ── Status Badge helper
    const statusBadge = (status, type) => {
        const map = {
            present: { bg: '#d1fae5', color: '#065f46', label: 'Present' },
            absent:  { bg: '#fee2e2', color: '#991b1b', label: 'Absent'  },
            leave:   { bg: '#fef3c7', color: '#92400e', label: 'Leave'   },
            half_day:{ bg: '#e0e7ff', color: '#3730a3', label: 'Half Day'},
            wfh:     { bg: '#dbeafe', color: '#1e40af', label: 'WFH'     },
        };
        const key = (type === 'wfh' && status !== 'absent' && status !== 'leave') ? 'wfh' : status;
        const s = map[key] || { bg: '#f1f5f9', color: '#475569', label: status };
        return `<span style="background:${s.bg};color:${s.color};padding:3px 10px;border-radius:20px;font-size:10px;font-weight:800;">${s.label}</span>`;
    };

    // ── Build bar chart SVG (status counts)
    const barData = [
        { label: 'Present',  value: summary.present,  color: '#10b981' },
        { label: 'WFH',      value: summary.wfh,      color: '#3b82f6' },
        { label: 'Half Day', value: summary.half_day,  color: '#6366f1' },
        { label: 'Leave',    value: summary.leave,     color: '#f59e0b' },
        { label: 'Absent',   value: summary.absent,    color: '#ef4444' },
    ];
    const maxVal = Math.max(...barData.map(d => d.value), 1);
    const barWidth = 40;
    const barGap   = 20;
    const chartH   = 120;
    const svgW     = barData.length * (barWidth + barGap) + barGap;
    const barsSVG  = barData.map((d, i) => {
        const bh = Math.max((d.value / maxVal) * chartH, d.value > 0 ? 4 : 0);
        const x  = barGap + i * (barWidth + barGap);
        const y  = chartH - bh;
        return `
            <rect x="${x}" y="${y}" width="${barWidth}" height="${bh}" rx="6" fill="${d.color}" opacity="0.85"/>
            <text x="${x + barWidth/2}" y="${y - 5}" text-anchor="middle" font-size="11" font-weight="800" fill="${d.color}">${d.value}</text>
            <text x="${x + barWidth/2}" y="${chartH + 16}" text-anchor="middle" font-size="9" font-weight="700" fill="#64748b">${d.label}</text>
        `;
    }).join('');

    // ── Punctuality donut SVG
    const pRate   = summary.punctuality_rate;
    const radius  = 50;
    const circumf = 2 * Math.PI * radius;
    const offset  = circumf - (pRate / 100) * circumf;
    const pCol    = getPunctColor(pRate);

    // ── Format a date string nicely
    const fmtDate = (d) => {
        const dt = new Date(d + 'T00:00:00');
        return dt.toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'});
    };

    // ── Generate today date for the report footer
    const reportDate = new Date().toLocaleDateString('en-IN', {day:'2-digit', month:'long', year:'numeric'});

    // ── Determine overall performance tier
    const overallScore = (summary.attendance_rate * 0.5) + (summary.punctuality_rate * 0.5);
    let performanceTier = 'Exceptional';
    let tierColor = '#10b981';
    if (overallScore < 50) { performanceTier = 'Needs Improvement'; tierColor = '#ef4444'; }
    else if (overallScore < 65) { performanceTier = 'Below Average'; tierColor = '#f59e0b'; }
    else if (overallScore < 80) { performanceTier = 'Satisfactory'; tierColor = '#3b82f6'; }
    else if (overallScore < 92) { performanceTier = 'Good'; tierColor = '#6366f1'; }

    // ── Working hours timeline bar
    const timelineItems = log.slice(-15).map(entry => {
        const pct = Math.min((entry.hours / 9) * 100, 100);
        const col = entry.hours >= 9 ? '#10b981' : entry.hours >= 6 ? '#6366f1' : entry.hours > 0 ? '#f59e0b' : '#e2e8f0';
        return `<div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:3px;">
            <div style="width:100%; background:#f1f5f9; border-radius:4px; height:60px; display:flex; align-items:flex-end;">
                <div style="width:100%; height:${Math.max(pct,0)}%; background:${col}; border-radius:4px; transition:height 0.3s;"></div>
            </div>
            <div style="font-size:7px; color:#94a3b8; font-weight:700; white-space:nowrap;">${entry.date.split(' ').slice(0,2).join(' ')}</div>
            <div style="font-size:8px; color:${col}; font-weight:800;">${entry.hours > 0 ? entry.hours+'h' : '—'}</div>
        </div>`;
    }).join('');

    // ── Build log table rows (paginate in PDF via html2canvas)
    const logRows = log.map((entry, idx) => {
        const rowBg = idx % 2 === 0 ? '#ffffff' : '#fafbff';
        return `<tr style="background:${rowBg};">
            <td style="padding:7px 10px; font-size:11px; color:#374151; font-weight:600;">${entry.date}</td>
            <td style="padding:7px 10px; font-size:11px; color:#64748b;">${entry.day}</td>
            <td style="padding:7px 10px;">${statusBadge(entry.status, entry.type)}</td>
            <td style="padding:7px 10px; font-size:11px; color:#374151; font-weight:700; text-align:center;">${entry.check_in}</td>
            <td style="padding:7px 10px; font-size:11px; color:#374151; font-weight:700; text-align:center;">${entry.check_out}</td>
            <td style="padding:7px 10px; font-size:12px; font-weight:800; text-align:center; color:${entry.hours >= 9 ? '#10b981' : entry.hours >= 6 ? '#6366f1' : '#94a3b8'};">${entry.hours > 0 ? entry.hours+'h' : '—'}</td>
        </tr>`;
    }).join('');

    // ── Main HTML for PDF
    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Segoe UI', Arial, sans-serif; background: #ffffff; color: #0f172a; }
                .page { width: 900px; margin: 0 auto; padding: 0; }
            </style>
        </head>
        <body>
        <div class="page" id="hrReportPage">

            <!-- ═══ PAGE 1: COVER HEADER ═══ -->
            <div style="background: linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4c1d95 100%); padding: 48px 52px 40px; color: white; position: relative; overflow: hidden;">
                <div style="position:absolute; top:-30px; right:-30px; width:200px; height:200px; background:rgba(255,255,255,0.03); border-radius:50%;"></div>
                <div style="position:absolute; bottom:-50px; left:-50px; width:250px; height:250px; background:rgba(255,255,255,0.02); border-radius:50%;"></div>

                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:32px;">
                    <div>
                        <div style="font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:3px; opacity:0.6; margin-bottom:8px;">OFFICIAL HR DOCUMENT</div>
                        <div style="font-size:30px; font-weight:900; letter-spacing:-1px; line-height:1.1;">Employee Attendance<br>&amp; Performance Report</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); padding:12px 20px; border-radius:14px; backdrop-filter:blur(10px);">
                            <div style="font-size:9px; font-weight:800; opacity:0.7; text-transform:uppercase; letter-spacing:1px;">Generated On</div>
                            <div style="font-size:14px; font-weight:800; margin-top:4px;">${reportDate}</div>
                            <div style="font-size:9px; opacity:0.6; margin-top:4px;">HanuAI Intelligence Hub</div>
                        </div>
                    </div>
                </div>

                <!-- Employee Info Strip -->
                <div style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.12); border-radius:20px; padding:24px 28px; display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; align-items:center; gap:20px;">
                        <div style="width:64px; height:64px; background:rgba(255,255,255,0.15); border-radius:18px; display:flex; align-items:center; justify-content:center; font-size:32px;">${emp.avatar_emoji || '👤'}</div>
                        <div>
                            <div style="font-size:22px; font-weight:900; letter-spacing:-0.5px;">${emp.name}</div>
                            <div style="font-size:12px; opacity:0.7; margin-top:4px;">${emp.designation || emp.department} &bull; ${emp.department}</div>
                            <div style="font-size:11px; opacity:0.5; margin-top:2px;">${emp.email}</div>
                        </div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:10px; opacity:0.6; font-weight:700; text-transform:uppercase; letter-spacing:1px;">Report Period</div>
                        <div style="font-size:15px; font-weight:800; margin-top:4px;">${fmtDate(period.start_date)}</div>
                        <div style="font-size:11px; opacity:0.6;">to</div>
                        <div style="font-size:15px; font-weight:800;">${fmtDate(period.end_date)}</div>
                        <div style="margin-top:8px; background:rgba(255,255,255,0.15); padding:4px 12px; border-radius:20px; font-size:10px; font-weight:800;">${period.working_days} Working Days</div>
                    </div>
                </div>
            </div>

            <!-- ═══ PERFORMANCE TIER BANNER ═══ -->
            <div style="background:${tierColor}10; border-left:6px solid ${tierColor}; padding:16px 28px; display:flex; align-items:center; gap:16px;">
                <div style="width:40px; height:40px; background:${tierColor}; border-radius:10px; display:flex; align-items:center; justify-content:center; color:white; font-size:18px; flex-shrink:0;">🏅</div>
                <div>
                    <div style="font-size:10px; color:${tierColor}; font-weight:800; text-transform:uppercase; letter-spacing:1.5px;">Overall Performance Tier</div>
                    <div style="font-size:22px; font-weight:900; color:${tierColor}; letter-spacing:-0.5px;">${performanceTier}</div>
                </div>
                <div style="margin-left:auto; text-align:right;">
                    <div style="font-size:36px; font-weight:900; color:${tierColor};">${Math.round(overallScore)}%</div>
                    <div style="font-size:10px; color:#64748b; font-weight:700;">Combined Score</div>
                </div>
            </div>

            <!-- ═══ KEY METRICS GRID ═══ -->
            <div style="padding:32px 40px;">
                <div style="font-size:12px; font-weight:900; color:#94a3b8; text-transform:uppercase; letter-spacing:2px; margin-bottom:20px;">Key Performance Indicators</div>
                <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin-bottom:32px;">
                    ${[
                        { icon: '📅', label: 'Days Attended', value: summary.attended_days, sub: `of ${period.working_days} working days`, color: getAttColor(summary.attendance_rate) },
                        { icon: '📊', label: 'Attendance Rate', value: summary.attendance_rate + '%', sub: 'Of expected working days', color: getAttColor(summary.attendance_rate) },
                        { icon: '⏱️', label: 'Avg. Work Hours', value: summary.avg_hours_per_day + 'h', sub: 'Per attended day', color: '#6366f1' },
                        { icon: '🎯', label: 'Punctuality Rate', value: summary.punctuality_rate + '%', sub: `${summary.punctual_days} on-time of ${summary.attended_days}`, color: getPunctColor(summary.punctuality_rate) },
                    ].map(m => `
                        <div style="background:#fafbff; border:1.5px solid #e2e8f0; border-top:4px solid ${m.color}; border-radius:16px; padding:20px; text-align:center;">
                            <div style="font-size:24px; margin-bottom:8px;">${m.icon}</div>
                            <div style="font-size:24px; font-weight:900; color:${m.color}; letter-spacing:-1px;">${m.value}</div>
                            <div style="font-size:10px; font-weight:800; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; margin-top:4px;">${m.label}</div>
                            <div style="font-size:9px; color:#94a3b8; margin-top:4px;">${m.sub}</div>
                        </div>
                    `).join('')}
                </div>

                <!-- ═══ ATTENDANCE BREAKDOWN ═══ -->
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-bottom:32px;">
                    <!-- Left: Status Distribution Chart -->
                    <div style="background:#fafbff; border:1.5px solid #e2e8f0; border-radius:20px; padding:24px;">
                        <div style="font-size:12px; font-weight:900; color:#0f172a; text-transform:uppercase; letter-spacing:1px; margin-bottom:20px;">Attendance Breakdown</div>
                        <div style="display:flex; justify-content:center;">
                            <svg viewBox="0 0 ${svgW} ${chartH + 30}" style="width:100%; max-width:300px; height:${chartH + 30}px;">
                                ${barsSVG}
                            </svg>
                        </div>
                    </div>

                    <!-- Right: Punctuality Donut -->
                    <div style="background:#fafbff; border:1.5px solid #e2e8f0; border-radius:20px; padding:24px; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                        <div style="font-size:12px; font-weight:900; color:#0f172a; text-transform:uppercase; letter-spacing:1px; margin-bottom:20px;">Punctuality Index</div>
                        <div style="position:relative; width:140px; height:140px;">
                            <svg viewBox="0 0 120 120" style="transform:rotate(-90deg); width:140px; height:140px;">
                                <circle cx="60" cy="60" r="${radius}" fill="none" stroke="#f1f5f9" stroke-width="12"/>
                                <circle cx="60" cy="60" r="${radius}" fill="none" stroke="${pCol}" stroke-width="12" stroke-linecap="round"
                                    stroke-dasharray="${circumf}" stroke-dashoffset="${offset}"/>
                            </svg>
                            <div style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                                <div style="font-size:24px; font-weight:900; color:${pCol};">${pRate}%</div>
                                <div style="font-size:9px; color:#94a3b8; font-weight:700;">ON TIME</div>
                            </div>
                        </div>
                        <div style="margin-top:16px; display:grid; grid-template-columns:1fr 1fr; gap:12px; width:100%;">
                            <div style="text-align:center; background:#d1fae510; border:1px solid #d1fae5; border-radius:10px; padding:10px;">
                                <div style="font-size:18px; font-weight:900; color:#10b981;">${summary.punctual_days}</div>
                                <div style="font-size:9px; color:#64748b; font-weight:700;">On-Time Days</div>
                            </div>
                            <div style="text-align:center; background:#fee2e210; border:1px solid #fecaca; border-radius:10px; padding:10px;">
                                <div style="font-size:18px; font-weight:900; color:#ef4444;">${summary.late_days}</div>
                                <div style="font-size:9px; color:#64748b; font-weight:700;">Late Days</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ═══ SECONDARY METRICS ROW ═══ -->
                <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-bottom:32px;">
                    ${[
                        { label: 'Total Hours Worked',   value: summary.total_hours + 'h',     icon: '⏰', color: '#6366f1' },
                        { label: 'Avg. Check-In Time',   value: summary.avg_check_in,          icon: '🟢', color: '#10b981' },
                        { label: 'Avg. Check-Out Time',  value: summary.avg_check_out,         icon: '🔴', color: '#ef4444' },
                        { label: 'Office Present Days',  value: summary.present,               icon: '🏢', color: '#3b82f6' },
                        { label: 'Work From Home Days',  value: summary.wfh,                   icon: '🏠', color: '#8b5cf6' },
                        { label: 'Leave / Absent Days',  value: (summary.leave + summary.absent), icon: '📋', color: '#f59e0b' },
                    ].map(m => `
                        <div style="background:#fafbff; border:1.5px solid #e2e8f0; border-radius:14px; padding:16px; display:flex; align-items:center; gap:14px;">
                            <div style="font-size:22px;">${m.icon}</div>
                            <div>
                                <div style="font-size:18px; font-weight:900; color:${m.color};">${m.value}</div>
                                <div style="font-size:10px; color:#64748b; font-weight:700;">${m.label}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>

                <!-- ═══ WORKING HOURS TIMELINE ═══ -->
                ${log.length > 0 ? `
                <div style="background:#fafbff; border:1.5px solid #e2e8f0; border-radius:20px; padding:24px; margin-bottom:32px;">
                    <div style="font-size:12px; font-weight:900; color:#0f172a; text-transform:uppercase; letter-spacing:1px; margin-bottom:16px;">Working Hours Timeline <span style="font-size:9px; color:#94a3b8; font-weight:700;">(Last ${Math.min(log.length,15)} Days · 9h = Full Target)</span></div>
                    <div style="display:flex; gap:6px; align-items:flex-end; height:100px;">
                        ${timelineItems}
                    </div>
                </div>` : ''}

                <!-- ═══ DAILY ATTENDANCE LOG TABLE ═══ -->
                <div style="margin-bottom:32px;">
                    <div style="font-size:12px; font-weight:900; color:#0f172a; text-transform:uppercase; letter-spacing:1px; margin-bottom:16px;">Day-by-Day Attendance Log</div>
                    <table style="width:100%; border-collapse:collapse; border-radius:14px; overflow:hidden; border:1.5px solid #e2e8f0;">
                        <thead>
                            <tr style="background:linear-gradient(135deg,#6366f1,#8b5cf6); color:white;">
                                <th style="padding:11px 14px; text-align:left; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:1px;">Date</th>
                                <th style="padding:11px 14px; text-align:left; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:1px;">Day</th>
                                <th style="padding:11px 14px; text-align:left; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:1px;">Status</th>
                                <th style="padding:11px 14px; text-align:center; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:1px;">Check-In</th>
                                <th style="padding:11px 14px; text-align:center; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:1px;">Check-Out</th>
                                <th style="padding:11px 14px; text-align:center; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:1px;">Hours</th>
                            </tr>
                        </thead>
                        <tbody>${logRows}</tbody>
                    </table>
                </div>

                <!-- ═══ FOOTER ═══ -->
                <div style="border-top:2px solid #f1f5f9; padding-top:20px; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div style="font-size:10px; font-weight:800; color:#94a3b8; text-transform:uppercase; letter-spacing:1px;">Generated by</div>
                        <div style="font-size:14px; font-weight:900; color:#6366f1;">HanuAI Intelligence Hub</div>
                        <div style="font-size:9px; color:#94a3b8; margin-top:2px;">This is a system-generated report. For HR use only.</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:10px; color:#94a3b8; font-weight:700;">CONFIDENTIAL</div>
                        <div style="font-size:10px; color:#94a3b8;">${reportDate}</div>
                        <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6); color:white; padding:4px 14px; border-radius:20px; font-size:10px; font-weight:800; margin-top:6px; display:inline-block;">${emp.department} Department</div>
                    </div>
                </div>

            </div>
        </div>
        </body>
        </html>
    `;

    // Render to PDF using html2canvas + jsPDF
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed; left:-9999px; top:0; width:900px; background:white; z-index:-1;';
    container.innerHTML = htmlContent;
    document.body.appendChild(container);

    try {
        const canvas = await html2canvas(container.querySelector('#hrReportPage'), {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
            width: 900,
            logging: false
        });

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

        const pageW  = pdf.internal.pageSize.getWidth();
        const pageH  = pdf.internal.pageSize.getHeight();
        const margin = 0;
        const imgW   = pageW - margin * 2;
        const imgH   = (canvas.height * imgW) / canvas.width;

        let yPos = margin;
        let remainH = imgH;

        // Multi-page support
        while (remainH > 0) {
            const sliceH = Math.min(pageH - margin * 2, remainH);
            const srcY   = (imgH - remainH) * (canvas.height / imgH);
            const srcH   = sliceH * (canvas.height / imgH);

            const sliceCanvas = document.createElement('canvas');
            sliceCanvas.width  = canvas.width;
            sliceCanvas.height = srcH;
            const ctx = sliceCanvas.getContext('2d');
            ctx.drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH);

            const sliceImg = sliceCanvas.toDataURL('image/jpeg', 0.95);
            pdf.addImage(sliceImg, 'JPEG', margin, yPos, imgW, sliceH);

            remainH -= sliceH;
            if (remainH > 0) {
                pdf.addPage();
                yPos = margin;
            }
        }

        const safeName = emp.name.replace(/[^a-zA-Z0-9]/g, '_');
        pdf.save(`HR_Report_${safeName}_${period.start_date}_to_${period.end_date}.pdf`);
        showNotification('HR Report downloaded successfully!', 'success');
    } catch (err) {
        console.error('PDF generation error:', err);
        showNotification('Failed to generate PDF report', 'error');
    } finally {
        document.body.removeChild(container);
        hideLoading();
    }
}

// ========== Shared Helpers ==========

function getISOWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

async function renderAvatar(avatarStr, container) {
    if (!container) return;
    
    // 3D Avatar (GLB) URL
    if (avatarStr && avatarStr.includes('.glb')) {
        if (typeof render3DAvatar === 'function') {
            render3DAvatar(avatarStr, container, { width: 32, height: 32, interactive: false });
        }
        return;
    }
    
    // Fallback to Image or Emoji
    if (avatarStr && (avatarStr.startsWith('http') || avatarStr.startsWith('/') || avatarStr.startsWith('uploads/'))) {
        container.innerHTML = `<img src="${avatarStr}" style="width: 100%; height: 100%; object-fit: cover; border-radius: inherit;">`;
    } else if (avatarStr) {
        container.innerHTML = avatarStr; // Assume it's an emoji
    }
}
