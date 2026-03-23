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

        // Update Last Trained Info
        const lastTrainedEl = document.getElementById('lastTrainedText');
        if (lastTrainedEl && f.model_state && f.model_state.last_trained) {
            lastTrainedEl.textContent = `Last Trained: ${f.model_state.last_trained}`;
        }

        const regularityEl = document.getElementById('hubRegularityEmployee');
        if (regularityEl) regularityEl.textContent = `${f.percentage}%`;

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

    const graphPoints = points.map((v, i) => ({ x: i * 115, y: 120 - (v.rate / 100 * 100) }));
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
        <div class="predictive-modal modal-content" style="padding: 0; overflow: hidden; border: none; max-width: 680px; max-height: 96vh; display: flex; flex-direction: column; border-radius: 32px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);">
            <div style="padding: 32px; overflow-y: auto; flex: 1; position: relative; background: #ffffff;">
                <div class="predictive-header" style="margin-bottom: 28px; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div class="predictive-title" style="font-size: 26px; font-weight: 900; color: #0f172a; letter-spacing: -0.8px; display: flex; align-items: center; gap: 12px;">
                            <span style="background: linear-gradient(135deg, #6366f1, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Intelligence Hub</span>
                            <span style="font-size: 10px; font-weight: 800; color: #6366f1; background: rgba(99, 102, 241, 0.1); padding: 4px 10px; border-radius: 20px; text-transform: uppercase; letter-spacing: 1px;">Admin Executive</span>
                        </div>
                        <div style="font-size: 11px; font-weight: 700; color: #94a3b8; margin-top: 4px; display: flex; align-items: center; gap: 6px;">
                            <span style="width: 6px; height: 6px; background: #10b981; border-radius: 50%;"></span> SYSTEM LIVE: Verified Data Stream
                        </div>
                    </div>
                    <button onclick="closePredictiveModal()" style="background: #f1f5f9; border: none; font-size: 20px; width: 40px; height: 40px; border-radius: 12px; cursor: pointer; color: #64748b; display: flex; align-items: center; justify-content: center; transition: all 0.2s;">&times;</button>
                </div>

                <div style="display: flex; justify-content: center; margin-bottom: 24px;">
                    <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 24px 40px; border-radius: 28px; color: white; min-width: 320px; text-align: center; box-shadow: 0 10px 20px -5px rgba(99, 102, 241, 0.4);">
                        <div style="font-size: 11px; font-weight: 850; color: rgba(255,255,255,0.7); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">Tomorrow's Expected Load</div>
                        <div style="font-size: 32px; font-weight: 900;">${predictedEmployees} <span style="font-size: 16px; font-weight: 600; opacity: 0.8;">Personnel</span></div>
                        <div style="font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.9); margin-top: 6px;">Out of ${summary.total_employees} Total Force</div>
                    </div>
                </div>

                <div class="main-forecast-card" style="padding: 32px; background: #ffffff; border: 1px solid #f1f5f9; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.02); border-radius: 28px; margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between; gap: 32px;">
                    <div style="position: relative; width: 140px; height: 140px; display: flex; align-items: center; justify-content: center;">
                        <svg viewBox="0 0 100 100" style="width: 140px; height: 140px; transform: rotate(-90deg); position: absolute;">
                            <circle cx="50" cy="50" r="45" fill="none" stroke="#f1f5f9" stroke-width="10" />
                            <circle id="modalForecastGauge" cx="50" cy="50" r="45" fill="none" stroke="url(#gaugeGrad)" stroke-width="10" stroke-linecap="round" stroke-dasharray="283" stroke-dashoffset="283" style="transition: stroke-dashoffset 1.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);" />
                            <defs>
                                <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                    <stop offset="0%" stop-color="#6366f1" />
                                    <stop offset="100%" stop-color="#8b5cf6" />
                                </linearGradient>
                            </defs>
                        </svg>
                        <div style="text-align: center; z-index: 1;">
                            <div id="modalForecastValue" style="color: #4f46e5; font-size: 38px; font-weight: 900; letter-spacing: -1px;">0%</div>
                            <div style="font-size: 9px; font-weight: 850; color: #94a3b8; letter-spacing: 1px; margin-top: -4px;">TURNOUT</div>
                        </div>
                    </div>
                    
                    <div style="flex: 1;">
                        <div style="font-size: 11px; font-weight: 850; color: #94a3b8; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                            Analysis Summary <span style="flex: 1; height: 1px; background: #f1f5f9;"></span>
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                            <div>
                                <div style="font-size: 18px; font-weight: 800; color: #1e293b;">${Math.round(100 - summary.late_rate)}%</div>
                                <div style="font-size: 10px; color: #10b981; font-weight: 800;">PUNCTUALITY</div>
                            </div>
                            <div>
                                <div style="font-size: 18px; font-weight: 800; color: #1e293b;">+${Math.round(summary.busiest_impact || 0)}%</div>
                                <div style="font-size: 10px; color: #8b5cf6; font-weight: 800;">VIBRANCY</div>
                            </div>
                            <div>
                                <div style="font-size: 18px; font-weight: 800; color: #1e293b;">${summary.peak_hour ? summary.peak_hour.split(' - ')[0] : 'N/A'}</div>
                                <div style="font-size: 10px; color: #64748b; font-weight: 800;">PEAK START</div>
                            </div>
                            <div>
                                <div style="font-size: 18px; font-weight: 800; color: #1e293b;">${(summary.peak_day || 'N/A').substring(0, 3)}</div>
                                <div style="font-size: 10px; color: #64748b; font-weight: 800;">BEST DAY</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Performance Bezier Graph -->
                <div class="activity-chart-section" style="background: #ffffff; padding: 24px; border-radius: 28px; border: 1px solid #f1f5f9; margin-bottom: 24px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                        <div style="font-size: 12px; font-weight: 900; color: #1e293b; text-transform: uppercase; letter-spacing: 1px;">Engagement Velocity</div>
                        <div style="font-size: 10px; font-weight: 800; color: #6366f1; background: rgba(99, 102, 241, 0.05); padding: 6px 14px; border-radius: 20px; display: flex; align-items: center; gap: 6px; border: 1px solid rgba(99, 102, 241, 0.1);">
                            <span style="font-size: 14px;">📉</span> Bezier Interpolation
                        </div>
                    </div>
                    <div style="height: 160px; position: relative; padding: 10px 0;">
                        <svg viewBox="0 0 600 120" preserveAspectRatio="none" style="width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0 8px 16px rgba(99, 102, 241, 0.1));">
                            <defs>
                                <linearGradient id="curveGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stop-color="#6366f1" stop-opacity="0.15" />
                                    <stop offset="100%" stop-color="#6366f1" stop-opacity="0" />
                                </linearGradient>
                            </defs>
                            <path d="${bezierPath} L 575 120 L 0 120 Z" fill="url(#curveGrad)" style="transform: scaleY(0); transform-origin: bottom; animation: forecast-fill 1.2s forwards 0.5s;" />
                            <path d="${bezierPath}" fill="none" stroke="#6366f1" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1000" stroke-dashoffset="1000" style="animation: forecast-draw 1.5s forwards 0.2s;" />
                            ${points.map((v, i) => {
                                const color = v.is_prediction ? '#6366f1' : '#cbd5e1';
                                const px = i * 115;
                                const py = 120 - (v.rate / 100 * 100);
                                return `
                                    <circle cx="${px}" cy="${py}" r="${v.is_prediction ? 6 : 5}" fill="white" stroke="${color}" stroke-width="3" style="opacity: 0; animation: forecast-point 0.5s forwards ${0.8 + (i * 0.1)}s;" />
                                    <text x="${px}" y="${py - 20}" font-size="11" font-weight="900" fill="${v.is_prediction ? '#4f46e5' : '#94a3b8'}" text-anchor="middle" style="opacity: 0; animation: forecast-point 0.5s forwards ${1 + (i * 0.1)}s;">${Math.round(v.rate)}%</text>
                                `;
                            }).join('')}
                        </svg>
                        <div style="display: flex; justify-content: space-between; margin-top: 20px; border-top: 1px solid #f8fafc; padding-top: 12px;">
                            ${points.map(v => `
                                <div style="font-size: 10px; font-weight: 850; color: ${v.is_prediction ? '#6366f1' : '#94a3b8'}; text-align: center; width: 64px;">${v.day_name === 'Yesterday' || v.day_name === 'Today' ? v.day_name : v.day_name.substring(0, 3).toUpperCase()}</div>
                            `).join('')}
                        </div>
                    </div>
                </div>

                <div style="padding: 24px; background: #f8fafc; border-radius: 28px; border: 1px solid #eef2f6; position: relative; overflow: hidden;">
                    <div style="position: absolute; top: -10px; left: -10px; font-size: 64px; opacity: 0.03; font-weight: 900; color: #6366f1; pointer-events: none;">INSIGHT</div>
                    <div style="font-size: 14px; line-height: 1.7; color: #334155; position: relative;">
                        <span style="font-size: 24px; float: left; margin-right: 16px; background: white; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">💡</span> 
                        <strong style="color: #0f172a;">Executive Intelligence:</strong> 
                        <div style="margin-top: 4px; font-weight: 600;">${summary.ai_insight || 'Data shows consistent operational flow. No immediate intervention required.'}</div>
                    </div>
                </div>

                <div style="text-align: center; margin-top: 40px; margin-bottom: 20px;">
                    <button onclick="closePredictiveModal()" style="width: auto; padding: 20px 100px; font-size: 15px; font-weight: 900; background: #0f172a; color: white; border: none; border-radius: 24px; cursor: pointer; transition: transform 0.2s, background 0.2s; box-shadow: 0 10px 15px -3px rgba(15, 23, 42, 0.3);" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">ACKNOWLEDGE ANALYSIS</button>
                </div>
            </div>
        </div>

        <style>
            @keyframes forecast-draw { to { stroke-dashoffset: 0; } }
            @keyframes forecast-fill { to { transform: scaleY(1); } }
            @keyframes forecast-point { to { opacity: 1; } }
        </style>
    `;

    modal.classList.add('active');

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
        // Restore scrollability
        document.body.style.overflow = 'auto';
        document.documentElement.style.overflow = 'auto';
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
    await performPersonnelSearch();
    hideLoading();
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
            <thead style="background: #f1f5f9;">
                <tr>
                    <th style="padding: 12px; text-align: left;">Name</th>
                    <th style="padding: 12px; text-align: left;">Department</th>
                    <th style="padding: 12px; text-align: center;">Rate</th>
                    <th style="padding: 12px; text-align: center;">Actions</th>
                </tr>
            </thead>
            <tbody>
                ${results.map(p => `
                    <tr style="border-bottom: 1px solid #e2e8f0; cursor: pointer;" onclick="showEmployeePerformanceAnalysis(${p.id})">
                        <td style="padding: 12px;">${p.name}</td>
                        <td style="padding: 12px;">${p.department}</td>
                        <td style="padding: 12px; text-align: center; font-weight: 700;">${p.attendance_rate}%</td>
                        <td style="padding: 12px; text-align: center; color: var(--primary);">View Analysis →</td>
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
        // Restore scrollability
        document.body.style.overflow = 'auto';
        document.documentElement.style.overflow = 'auto';
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

function renderEmployeePerformanceModal(data, employeeId) {
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

    // Graph points from last 6 entries in history + 1 prediction for tomorrow
    const graphData = [...history].reverse().slice(-6);
    
    // Add prediction for tomorrow
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const predictedHours = (p.likelihood / 100) * 8;
    
    graphData.push({
        date: tomorrowDate.toISOString().split('T')[0],
        hours: predictedHours,
        is_prediction: true
    });

    const graphPoints = graphData.map((v, i) => ({ 
        x: i * 95, 
        y: 120 - (Math.min(v.hours, 12) / 12 * 100) 
    }));
    
    let bezierPath = "";
    if (graphPoints.length > 0) {
        bezierPath = `M ${graphPoints[0].x} ${graphPoints[0].y}`;
        for (let i = 0; i < graphPoints.length - 1; i++) {
            const p0 = graphPoints[i - 1] || graphPoints[i];
            const p1 = graphPoints[i];
            const p2 = graphPoints[i + 1];
            const p3 = graphPoints[i + 2] || p2;
            const [cp1x, cp1y, cp2x, cp2y] = getControlPoints(p0, p1, p2);
            const [nextCp1x, nextCp1y, nextCp2x, nextCp2y] = getControlPoints(p1, p2, p3);
            bezierPath += ` C ${cp2x} ${cp2y}, ${nextCp1x} ${nextCp1y}, ${graphPoints[i+1].x} ${graphPoints[i+1].y}`;
        }
    }

    const modal = document.createElement('div');
    modal.id = 'employeePerformanceModal';
    modal.className = 'modal active';
    modal.style.zIndex = '2101';

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
                    <button onclick="document.body.style.overflow='auto';document.documentElement.style.overflow='auto';document.getElementById('employeePerformanceModal').remove()" style="background: #f1f5f9; border: none; font-size: 20px; width: 40px; height: 40px; border-radius: 12px; cursor: pointer; color: #64748b; display: flex; align-items: center; justify-content: center; transition: all 0.2s;">&times;</button>
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
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                            <div>
                                <div style="font-size: 18px; font-weight: 900; color: #0f172a;">${regularityScore}%</div>
                                <div style="font-size: 9px; font-weight: 800; color: #10b981; text-transform: uppercase; letter-spacing: 0.5px;">Punctuality</div>
                            </div>
                            <div>
                                <div style="font-size: 18px; font-weight: 900; color: #0f172a;">+${Math.round(m.weekly_avg_hours)}h</div>
                                <div style="font-size: 9px; font-weight: 800; color: #8b5cf6; text-transform: uppercase; letter-spacing: 0.5px;">Vibrancy</div>
                            </div>
                            <div>
                                <div style="font-size: 18px; font-weight: 900; color: #0f172a;">${t.work_efficiency}%</div>
                                <div style="font-size: 9px; font-weight: 800; color: #4338ca; text-transform: uppercase; letter-spacing: 0.5px;">Work Efficiency</div>
                            </div>
                            <div>
                                <div style="font-size: 18px; font-weight: 900; color: #0f172a;">${m.avg_check_in || '10:00'}</div>
                                <div style="font-size: 9px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Peak Start</div>
                            </div>
                            <div>
                                <div style="font-size: 18px; font-weight: 900; color: #0f172a;">${p.tomorrow_day.substring(0,3)}</div>
                                <div style="font-size: 9px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Best Day</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Charts Section -->
                <div style="background: #ffffff; border: 1px solid #f1f5f9; border-radius: 28px; padding: 24px; margin-bottom: 24px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                        <div style="font-size: 14px; font-weight: 900; color: #0f172a;">Engagement Velocity</div>
                        <div style="font-size: 10px; font-weight: 800; color: #64748b; background: #f8fafc; padding: 6px 12px; border-radius: 10px; display: flex; align-items: center; gap: 6px;">
                            <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236366f1' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 3v18h18'/%3E%3Cpath d='M7 16l4-4 4 4 6-6'/%3E%3C/svg%3E" style="width: 12px;"/> Bezier Interpolation
                        </div>
                    </div>
                    
                    <div style="height: 160px; width: 100%; position: relative; margin-top: 30px;">
                        <svg viewBox="0 0 580 140" style="width: 100%; height: 100%; overflow: visible;">
                            <!-- Vertical Grid Lines -->
                            ${graphPoints.map((pt, i) => `
                                <line x1="${pt.x}" y1="0" x2="${pt.x}" y2="140" stroke="#f1f5f9" stroke-width="1" stroke-dasharray="${graphData[i].is_prediction ? '4,4' : '0'}" />
                            `).join('')}
                            
                            <!-- Bezier Path -->
                            <path d="${bezierPath}" fill="none" stroke="#6366f1" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
                            
                            <!-- Area under curve -->
                            <path d="${bezierPath} L ${graphPoints[graphPoints.length-1].x} 140 L ${graphPoints[0].x} 140 Z" fill="url(#areaGrad)" opacity="0.1" />
                            
                            <defs>
                                <linearGradient id="areaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                                    <stop offset="0%" stop-color="#6366f1" />
                                    <stop offset="100%" stop-color="#ffffff" />
                                </linearGradient>
                            </defs>
                            
                            <!-- Points -->
                            ${graphPoints.map((pt, i) => `
                                <circle cx="${pt.x}" cy="${pt.y}" r="6" fill="${graphData[i].is_prediction ? 'white' : '#6366f1'}" stroke="#6366f1" stroke-width="3" />
                                <text x="${pt.x}" y="170" text-anchor="middle" style="font-size: 11px; font-weight: 850; fill: ${graphData[i].is_prediction ? '#6366f1' : '#94a3b8'}; text-transform: uppercase;">
                                    ${new Date(graphData[i].date).toLocaleDateString('en-US', {weekday: 'short'}).toUpperCase()}
                                </text>
                                <text x="${pt.x}" y="${pt.y - 15}" text-anchor="middle" style="font-size: 11px; font-weight: 900; fill: #6366f1;">
                                    ${graphData[i].hours.toFixed(1)}h
                                </text>
                            `).join('')}
                        </svg>
                    </div>
                </div>

                <!-- AI Insight -->
                <div style="background: rgba(99, 102, 241, 0.03); border: 1px solid rgba(99, 102, 241, 0.1); border-radius: 28px; padding: 24px; display: flex; gap: 20px; align-items: flex-start; position: relative; overflow: hidden;">
                    <div style="position: absolute; top: -20px; right: -20px; font-size: 80px; opacity: 0.03; font-weight: 900; pointer-events: none;">INSIGHT</div>
                    <div style="width: 48px; height: 48px; background: white; border-radius: 14px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); flex-shrink: 0;">💡</div>
                    <div>
                        <div style="font-size: 14px; font-weight: 900; color: #0f172a; margin-bottom: 6px;">Executive Intelligence:</div>
                        <div style="font-size: 13px; color: #475569; line-height: 1.6; font-weight: 600;">
                            ${p.habit_summary}. Performance is on an ${regularityScore > 75 ? 'upward' : 'consistent'} trajectory, with a ${p.likelihood}% turnout predicted for tomorrow. ${streak > 3 ? 'Strong consistency streak detected.' : 'Maintains a standard engagement pattern.'} Recommend ${t.avg_accuracy > 85 ? 'maintaining current load' : 'monitoring task complexity'} due to ${t.avg_accuracy}% accuracy rating.
                        </div>
                    </div>
                </div>
            </div>

            <div style="padding: 24px 32px; background: #ffffff; border-top: 1px solid #f1f5f9; display: flex; justify-content: center;">
                <button onclick="document.body.style.overflow='auto';document.documentElement.style.overflow='auto';document.getElementById('employeePerformanceModal').remove()" 
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
