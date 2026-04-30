/**
 * Task Manager V2 - Enhanced Logic
 */

const TaskManagerV2 = {
    activeTab: 'todo',
    searchQuery: '',
    currentTask: null,
    newFiles: [],
    allEmployees: [], // Cache for searchable lists
    selectedAssignees: [], // IDs of selected assignees for new task

    init() {
        console.log("TaskManagerV2 Initialized");
        this.setupEventListeners();
    },

    setupEventListeners() {
        // Tab switching
        document.querySelectorAll('.tm-v2-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const tabId = e.currentTarget.getAttribute('data-tab');
                this.switchTab(tabId);
            });
        });

        // Search
        const searchInput = document.getElementById('tmV2Search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchQuery = e.target.value.toLowerCase();
                this.render();
            });
        }
    },

    async open() {
        document.getElementById('taskManagerV2Modal').classList.add('active');
        if (typeof updateScrollLock === 'function') updateScrollLock();
        
        // Ensure the active tab is properly initialized
        this.switchTab(this.activeTab);
        
        // Refresh to get latest data
        this.refresh(); 
    },

    close() {
        document.getElementById('taskManagerV2Modal').classList.remove('active');
        if (typeof updateScrollLock === 'function') updateScrollLock();
    },

    switchTab(tabId) {
        this.activeTab = tabId;
        document.querySelectorAll('.tm-v2-tab').forEach(t => t.classList.toggle('active', t.getAttribute('data-tab') === tabId));
        document.querySelectorAll('.tm-v2-panel').forEach(p => p.classList.toggle('active', p.id === `tmV2Panel-${tabId}`));
        this.render();
    },

    render() {
        const loader = document.getElementById('tmV2Loader');
        if (!this.tasks) {
            if (loader) loader.style.display = 'flex';
            return;
        }
        if (loader) {
            loader.style.display = 'none';
            loader.classList.add('hidden'); // Extra safety
        }

        const todoTasks = this.tasks.filter(t => t.status === 'todo');
        const inProgressTasks = this.tasks.filter(t => t.status === 'in_progress');
        const completedTasks = this.tasks.filter(t => t.status === 'completed');

        document.getElementById('tmV2Count-todo').textContent = todoTasks.length;
        document.getElementById('tmV2Count-inProgress').textContent = inProgressTasks.length;
        document.getElementById('tmV2Count-completed').textContent = completedTasks.length;

        const currentTasks = this.activeTab === 'todo' ? todoTasks : 
                             (this.activeTab === 'inProgress' ? inProgressTasks : completedTasks);

        const filteredTasks = currentTasks.filter(t => {
            const q = this.searchQuery.toLowerCase();
            if (!q) return true;
            const matchText = t.title.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q);
            const matchUser = (t.assignees || []).some(a => a.name.toLowerCase().includes(q));
            const matchDate = (t.due_date && t.due_date.includes(q)) || (t.created_at && t.created_at.includes(q));
            return matchText || matchUser || matchDate;
        });

        const priorityOrder = { 'high': 1, 'p1': 1, 'medium': 2, 'p2': 2, 'low': 3, 'p3': 3, 'p4': 4 };
        const sortedTasks = [...filteredTasks].sort((a, b) => {
            if (this.activeTab === 'completed') {
                const dateA = new Date(a.updated_at || a.created_at);
                const dateB = new Date(b.updated_at || b.created_at);
                return dateB - dateA; // Newest first
            } else {
                const pA = priorityOrder[(a.priority || 'P3').toLowerCase()] || 99;
                const pB = priorityOrder[(b.priority || 'P3').toLowerCase()] || 99;
                return pA - pB; // Urgency first
            }
        });

        const container = document.getElementById(`tmV2Grid-${this.activeTab}`);
        if (!container) return;

        if (sortedTasks.length === 0) {
            container.innerHTML = `<div class="tm-v2-empty"><div class="tm-v2-empty-icon">📂</div><h3>No tasks found</h3></div>`;
            return;
        }

        container.innerHTML = sortedTasks.map(task => this.createTaskCard(task)).join('');
    },

    createTaskCard(task) {
        const priority = (task.priority || 'P3').toLowerCase();
        const steps = task.steps || [];
        const completedSteps = steps.filter(s => s.is_completed).length;
        const progress = steps.length > 0 ? Math.round((completedSteps / steps.length) * 100) : 0;
        
        const assignees = task.assignees || [];
        const avatars = assignees.slice(0, 3).map(a => `
            <div class="tm-v2-avatar" title="${a.name}">${a.name.charAt(0).toUpperCase()}</div>
        `).join('') + (assignees.length > 3 ? `<div class="tm-v2-avatar">+${assignees.length - 3}</div>` : '');

        const assigneeNames = assignees.map(a => `<span class="tm-v2-card-assignee-name">${a.name}</span>`).join(', ');

        const createdDate = task.created_at ? this.formatDateTime(task.created_at) : 'N/A';
        const dueDateObj = task.due_date ? new Date(task.due_date) : null;
        const isOverdue = dueDateObj && dueDateObj < new Date() && task.status !== 'completed';
        const dueDate = task.due_date ? dueDateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : 'No date';

        // Action Buttons - ADMIN CANNOT CHANGE STATUS
        let actionBtn = '';
        const user = window.currentUser || currentUser;
        const isAssignee = assignees.some(a => a.id === user.id);
        const isAdmin = user.role === 'admin'; // Specific check for admin role

        if (isAssignee && !isAdmin) { // Only assignees who aren't acting as admins can move tasks
            if (task.status === 'todo') {
                actionBtn = `<button class="tm-v2-card-action start" onclick="event.stopPropagation(); TaskManagerV2.updateStatus(${task.id}, 'in_progress')">In Progress</button>`;
            } else if (task.status === 'in_progress') {
                actionBtn = `<button class="tm-v2-card-action complete" onclick="event.stopPropagation(); TaskManagerV2.updateStatus(${task.id}, 'completed')">Complete</button>`;
            }
        }

        return `
            <div class="tm-v2-card ${isOverdue ? 'overdue' : ''}" onclick="TaskManagerV2.openDetail(${task.id})">
                <div class="tm-v2-card-header">
                    <div style="display:flex; gap: 8px; align-items:center;">
                        <span class="tm-v2-priority ${priority}">${priority.toUpperCase()}</span>
                    </div>
                    <div class="tm-v2-meta-item" style="font-size: 0.7rem;">Created: ${createdDate}</div>
                </div>
                
                <h3 class="tm-v2-card-title">${task.title}</h3>
                <p class="tm-v2-card-desc">${task.description || 'No description provided.'}</p>
                
                ${steps.length > 0 ? `
                <div class="tm-v2-progress-wrapper">
                    <div style="display:flex; justify-content:space-between; margin-bottom: 6px; font-size: 0.75rem; font-weight: 700;">
                        <span style="color: var(--tm-text-light)">Progress</span>
                        <span style="color: var(--tm-primary)">${progress}%</span>
                    </div>
                    <div class="tm-v2-progress"><div class="tm-v2-progress-fill" style="width: ${progress}%"></div></div>
                </div>
                ` : ''}

                <div class="tm-v2-card-footer">
                    <div class="tm-v2-meta-wrap">
                        <div class="tm-v2-meta-item date"><span>📅</span> ${dueDate}</div>
                        ${task.comments_count ? `<div class="tm-v2-meta-item"><span>💬</span> ${task.comments_count}</div>` : ''}
                    </div>
                    <div style="display:flex; align-items:center; gap: 12px;">
                        ${actionBtn}
                        <div class="tm-v2-avatar-group">${avatars}</div>
                    </div>
                </div>
            </div>
        `;
    },

    async openDetail(taskId) {
        showLoading("Opening Task Detail...");
        try {
            const res = await apiCall(`tasks/${taskId}`, 'GET');
            if (res && res.success) {
                this.currentTask = res.task;
                this.populateDetailModal(res.task);
                document.getElementById('taskDetailV2Modal').classList.add('active');
            }
        } catch (e) {
            console.error("Detail Load Error:", e);
        } finally {
            hideLoading();
        }
    },

    closeDetail() {
        document.getElementById('taskDetailV2Modal').classList.remove('active');
        this.currentTask = null;
    },

    populateDetailModal(task) {
        this.currentTask = task;
        document.getElementById('detailV2Title').textContent = task.title;
        document.getElementById('detailV2Desc').textContent = task.description || 'No description.';
        
        const priorityEl = document.getElementById('detailV2Priority');
        const prio = (task.priority || 'P3').toUpperCase();
        priorityEl.textContent = prio;
        priorityEl.className = `tm-v2-priority ${prio.toLowerCase()}`;

        document.getElementById('detailV2DueDate').textContent = task.due_date ? new Date(task.due_date).toLocaleDateString() : 'N/A';
        document.getElementById('detailV2CreatedAt').textContent = this.formatDateTime(task.created_at);

        // Progress
        const steps = task.steps || [];
        const completedSteps = steps.filter(s => s.is_completed).length;
        const progress = steps.length > 0 ? Math.round((completedSteps / steps.length) * 100) : 0;
        const progressText = document.getElementById('detailV2ProgressText');
        const progressFill = document.getElementById('detailV2ProgressFill');
        if (progressText) progressText.textContent = `${progress}%`;
        if (progressFill) progressFill.style.width = `${progress}%`;

        // Action Buttons
        const actionsContainer = document.getElementById('detailV2Actions');
        if (actionsContainer) {
            let btns = '';
            const user = window.currentUser || currentUser;
            const isAssignee = (task.assignees || []).some(a => a.id === user.id);
            const isAdmin = user.role === 'admin';
            const isMentor = task.mentor && task.mentor.id === user.id;

            if (task.status !== 'completed' || isAdmin) {
                btns += `<button class="btn btn-secondary btn-sm" onclick="TaskManagerV2.openEditTaskModal()"><i class="fas fa-edit"></i> Edit</button> `;
            }

            if (isAssignee && !isAdmin) { // Admin can only track
                if (task.status === 'todo') {
                    btns += `<button class="btn btn-primary btn-sm" onclick="TaskManagerV2.updateStatus(${task.id}, 'in_progress')">In Progress</button>`;
                } else if (task.status === 'in_progress') {
                    btns += `
                        <button class="btn btn-sm tm-v2-btn-todo" onclick="TaskManagerV2.updateStatus(${task.id}, 'todo')" title="Move back to To Do">↩ To Do</button>
                        <button class="btn btn-success btn-sm" onclick="TaskManagerV2.updateStatus(${task.id}, 'completed')">Complete</button>
                    `;
                }
            }
            actionsContainer.innerHTML = btns;
        }

        // Steps
        const stepsContainer = document.getElementById('detailV2Steps');
        stepsContainer.innerHTML = (task.steps || []).map(s => `
            <div class="tm-v2-step-item">
                <input type="checkbox" class="tm-v2-step-check" ${s.is_completed ? 'checked' : ''} onchange="TaskManagerV2.toggleStep(${task.id}, ${s.id}, this.checked)">
                <span class="tm-v2-step-text ${s.is_completed ? 'completed' : ''}">${s.text || s.title}</span>
            </div>
        `).join('') || '<p class="text-muted">No steps defined.</p>';

        // Comments
        const commentsContainer = document.getElementById('detailV2Comments');
        commentsContainer.innerHTML = (task.comments || []).map(c => `
            <div class="tm-v2-comment-item">
                <div class="tm-v2-comment-meta"><strong>${c.author_name || c.user_name}</strong> • ${this.formatDateTime(c.created_at)}</div>
                <div class="tm-v2-comment-text">${c.content || c.text}</div>
            </div>
        `).join('') || '<p class="text-muted">No comments yet.</p>';

        // History
        const historyContainer = document.getElementById('detailV2History');
        historyContainer.innerHTML = (task.history || []).map(h => `
            <div class="tm-v2-history-item">
                <span class="tm-v2-history-time">${this.formatDateTime(h.at || h.timestamp)}</span>
                <strong>${h.by || h.user_name}</strong> changed <em>${h.field}</em>: 
                <span class="tm-v2-history-val">${h.old || 'None'}</span> → 
                <span class="tm-v2-history-val">${h.new || 'None'}</span>
            </div>
        `).join('') || '<p class="text-muted">No history logs.</p>';

        // Overseer
        const overseerContainer = document.getElementById('detailV2Overseer');
        if (overseerContainer) {
            if (task.overseer_id && task.overseer_name) {
                overseerContainer.innerHTML = `
                    <div class="tm-v2-detail-assignee-item">
                        <div class="tm-v2-avatar" title="${task.overseer_name}">${task.overseer_name.charAt(0).toUpperCase()}</div>
                        <span class="tm-v2-detail-assignee-name">${task.overseer_name}</span>
                    </div>
                `;
            } else if (task.overseer) {
                // If it's an object
                const o = task.overseer;
                overseerContainer.innerHTML = `
                    <div class="tm-v2-detail-assignee-item">
                        <div class="tm-v2-avatar" title="${o.name}">${o.name.charAt(0).toUpperCase()}</div>
                        <span class="tm-v2-detail-assignee-name">${o.name}</span>
                    </div>
                `;
            } else {
                overseerContainer.innerHTML = '<p class="text-muted">None</p>';
            }
        }

        // Assignees
        const assigneesContainer = document.getElementById('detailV2Assignees');
        assigneesContainer.innerHTML = (task.assignees || []).map(a => `
            <div class="tm-v2-detail-assignee-item">
                <div class="tm-v2-avatar" title="${a.name}">${a.name.charAt(0).toUpperCase()}</div>
                <span class="tm-v2-detail-assignee-name">${a.name}</span>
            </div>
        `).join('') || '<p class="text-muted">Unassigned</p>';

        // Attachments
        this.renderAttachments(task.attachments || []);
    },

    renderAttachments(attachments) {
        const container = document.getElementById('detailV2Attachments');
        container.innerHTML = attachments.map(a => `
            <div class="tm-v2-attachment-card" onclick="window.open('${a.url}', '_blank')">
                <div class="tm-v2-attach-icon">📎</div>
                <div class="tm-v2-attach-name">${a.name}</div>
            </div>
        `).join('') || '<p class="text-muted">No attachments.</p>';
    },

    async openNewTaskModal(assigneeId = null) {
        this.selectedAssignees = assigneeId ? [parseInt(assigneeId)] : [];
        
        // Fetch employees if not cached
        if (this.allEmployees.length === 0) {
            const res = await apiCall('employees-simple', 'GET');
            if (res && res.success) {
                this.allEmployees = res.employees;
            }
        }

        // Populate Overseer Select
        const overseerSelect = document.getElementById('newTaskV2Overseer');
        if (overseerSelect.options.length <= 1) { // Only if not populated (1 is the default option)
            this.allEmployees.forEach(emp => {
                const opt = document.createElement('option');
                opt.value = emp.id;
                opt.textContent = emp.name;
                overseerSelect.appendChild(opt);
            });
        }

        // Render searchable Assignee List
        this.renderAssigneeList();
        this.updateAssigneeCount();

        document.getElementById('newTaskV2HeaderTitle').innerHTML = '<i class="fas fa-plus-circle"></i> Create New Task';
        document.getElementById('newTaskV2Id').value = '';
        document.getElementById('newTaskV2Modal').classList.add('active');
    },

    async openEditTaskModal() {
        if (!this.currentTask) return;
        const task = this.currentTask;

        this.selectedAssignees = (task.assignees || []).map(a => Number(a.id));
        
        // Fetch employees if not cached
        if (this.allEmployees.length === 0) {
            const res = await apiCall('employees-simple', 'GET');
            if (res && res.success) {
                this.allEmployees = res.employees;
            }
        }

        const overseerSelect = document.getElementById('newTaskV2Overseer');
        if (overseerSelect.options.length <= 1) {
            this.allEmployees.forEach(emp => {
                const opt = document.createElement('option');
                opt.value = emp.id;
                opt.textContent = emp.name;
                overseerSelect.appendChild(opt);
            });
        }

        document.getElementById('newTaskV2HeaderTitle').innerHTML = '<i class="fas fa-edit"></i> Edit Task';
        document.getElementById('newTaskV2Id').value = task.id;
        document.getElementById('newTaskV2Title').value = task.title;
        document.getElementById('newTaskV2Desc').value = task.description || '';
        document.getElementById('newTaskV2Priority').value = (task.priority || 'p3').toLowerCase();
        document.getElementById('newTaskV2DueDate').value = task.due_date || '';
        document.getElementById('newTaskV2StartDate').value = task.start_date || '';
        if (task.mentor) {
            document.getElementById('newTaskV2Overseer').value = task.mentor.id;
        }

        this.renderAssigneeList();
        this.updateAssigneeCount();
        
        this.closeDetail();
        document.getElementById('newTaskV2Modal').classList.add('active');
    },

    renderAssigneeList(filter = '') {
        const container = document.getElementById('newTaskV2AssigneeList');
        if (!container) return;

        const q = filter.toLowerCase();
        let list = this.allEmployees;
        
        if (q) {
            list = list.filter(emp => emp.name.toLowerCase().includes(q));
        }

        // Reorder: Selected items first
        list.sort((a, b) => {
            const aSel = this.selectedAssignees.includes(a.id);
            const bSel = this.selectedAssignees.includes(b.id);
            if (aSel && !bSel) return -1;
            if (!aSel && bSel) return 1;
            return 0;
        });

        container.innerHTML = list.map(emp => {
            const isSelected = this.selectedAssignees.includes(emp.id);
            return `
                <div class="tm-v2-list-item ${isSelected ? 'selected' : ''}" onclick="TaskManagerV2.toggleAssigneeSelection(${emp.id})">
                    <input type="checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); TaskManagerV2.toggleAssigneeSelection(${emp.id})">
                    <span class="tm-v2-list-item-name">${emp.name}</span>
                </div>
            `;
        }).join('');
    },

    toggleAssigneeSelection(empId) {
        const idx = this.selectedAssignees.indexOf(empId);
        if (idx > -1) {
            this.selectedAssignees.splice(idx, 1);
        } else {
            this.selectedAssignees.push(empId);
            // Auto-scroll list to top when selected
            const container = document.getElementById('newTaskV2AssigneeList');
            if (container) container.scrollTop = 0;

            // Auto-fill mentor section if the employee has mentors
            const emp = this.allEmployees.find(e => e.id == empId);
            if (emp && emp.mentor_ids && emp.mentor_ids.length > 0) {
                const overseerSelect = document.getElementById('newTaskV2Overseer');
                if (overseerSelect) {
                    Array.from(overseerSelect.options).forEach(opt => {
                        if (emp.mentor_ids.includes(Number(opt.value))) {
                            opt.selected = true;
                        }
                    });
                }
            }
        }
        
        this.renderAssigneeList(document.getElementById('newTaskV2AssigneeSearch').value);
        this.updateAssigneeCount();
    },

    filterAssignees(q) {
        this.renderAssigneeList(q);
    },

    updateAssigneeCount() {
        const badge = document.getElementById('newTaskV2AssigneeCount');
        if (badge) badge.textContent = this.selectedAssignees.length;
    },

    closeNewTask() {
        document.getElementById('newTaskV2Modal').classList.remove('active');
        document.getElementById('newTaskV2Form').reset();
        document.getElementById('newTaskV2Id').value = '';
        document.getElementById('newTaskV2HeaderTitle').innerHTML = '<i class="fas fa-plus-circle"></i> Create New Task';
        this.newFiles = [];
        this.selectedAssignees = [];
        document.getElementById('newTaskV2AssigneeSearch').value = '';
        document.getElementById('newTaskV2AttachmentsList').innerHTML = '';
        if (typeof updateScrollLock === 'function') updateScrollLock();
    },

    previewNewTaskFiles(e) {
        const files = Array.from(e.target.files);
        this.newFiles = this.newFiles.concat(files);
        const list = document.getElementById('newTaskV2AttachmentsList');
        list.innerHTML = this.newFiles.map((f, i) => `<div>📎 ${f.name} <span onclick="TaskManagerV2.removeNewFile(${i})" style="cursor:pointer; color:red;">✕</span></div>`).join('');
    },

    removeNewFile(idx) {
        this.newFiles.splice(idx, 1);
        const list = document.getElementById('newTaskV2AttachmentsList');
        list.innerHTML = this.newFiles.map((f, i) => `<div>📎 ${f.name} <span onclick="TaskManagerV2.removeNewFile(${i})" style="cursor:pointer; color:red;">✕</span></div>`).join('');
    },

    async saveNewTask(e) {
        e.preventDefault();
        
        const title = document.getElementById('newTaskV2Title').value;
        const priority = document.getElementById('newTaskV2Priority').value;
        const selectedAssignees = this.selectedAssignees;
        const editId = document.getElementById('newTaskV2Id').value;
        
        // Priority Duplicacy Check
        if (this.tasks) {
            for (const empId of selectedAssignees) {
                const hasDuplicate = this.tasks.some(t => 
                    t.id != editId &&
                    t.status !== 'completed' && 
                    t.priority.toLowerCase() === priority.toLowerCase() &&
                    (t.assignees || []).some(a => a.id == empId)
                );
                if (hasDuplicate) {
                    const emp = this.allEmployees.find(e => e.id == empId);
                    showNotification(`${emp ? emp.name : 'Employee'} already has an active ${priority.toUpperCase()} task.`, "warning");
                    return;
                }
            }
        }

        showLoading("Saving Task...");
        try {
            const formData = new FormData();
            const user = window.currentUser || currentUser;
            
            formData.append('title', title);
            formData.append('description', document.getElementById('newTaskV2Desc').value);
            formData.append('priority', priority);
            formData.append('due_date', document.getElementById('newTaskV2DueDate').value);
            formData.append('user_id', user.id); // For editing permissions
            
            const startDate = document.getElementById('newTaskV2StartDate').value;
            if (startDate) formData.append('started_at', startDate); // For backwards compat
            if (startDate) formData.append('start_date', startDate);

            const overseerSelect = document.getElementById('newTaskV2Overseer');
            if (overseerSelect) {
                const selectedOverseers = Array.from(overseerSelect.selectedOptions).map(opt => opt.value).filter(v => v);
                if (selectedOverseers.length > 0) {
                    formData.append('overseer_ids', JSON.stringify(selectedOverseers));
                    formData.append('overseer_id', selectedOverseers[0]); // fallback
                    formData.append('mentor_id', selectedOverseers[0]);   // fallback
                }
            }

            formData.append('assignees', JSON.stringify(selectedAssignees));
            if (!editId) {
                this.newFiles.forEach(f => formData.append('attachments', f));
            }

            const endpoint = editId ? `/api/tasks/${editId}?token=${window.GATED_TOKEN}` : `/api/tasks?token=${window.GATED_TOKEN}`;
            const method = editId ? 'PATCH' : 'POST';

            // Wait, fetch doesn't fully support FormData with PATCH/PUT in all Django backends if not properly parsed.
            // Let's use json if we are patching without files. 
            let bodyData = formData;
            let headers = {};
            
            if (editId) {
                const jsonObj = {};
                formData.forEach((value, key) => {
                    if(key === 'assignees') {
                        jsonObj[key] = JSON.parse(value);
                    } else {
                        jsonObj[key] = value;
                    }
                });
                bodyData = JSON.stringify(jsonObj);
                headers = {'Content-Type': 'application/json'};
            }

            const res = await fetch(endpoint, {
                method: method,
                headers: headers,
                body: bodyData
            });
            const data = await res.json();
            if (data.success) {
                showNotification(editId ? "Task updated successfully" : "Task created successfully", "success");
                this.closeNewTask();
                this.refresh();
            } else {
                showNotification(data.message || "Failed to save task", "error");
            }
        } catch (err) {
            console.error(err);
        } finally {
            hideLoading();
        }
    },

    formatDateTime(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    },

    async toggleStep(taskId, stepId, isCompleted) {
        try {
            const res = await apiCall(`bulk-update-tasks`, 'POST', {
                task_ids: [taskId],
                updates: { steps_toggle: [{ id: stepId, is_completed: isCompleted }] },
                user_id: (window.currentUser || currentUser).id
            });
            if (res.success) {
                showNotification("Step updated", "success");
                this.openDetail(taskId);
            }
        } catch (err) {
            console.error(err);
        }
    },

    async updateStatus(taskId, newStatus) {
        showLoading("Updating Status...");
        try {
            const res = await apiCall(`bulk-update-tasks`, 'POST', {
                task_ids: [taskId],
                updates: { status: newStatus },
                user_id: (window.currentUser || currentUser).id
            });
            if (res.success) {
                showNotification(`Task moved to ${newStatus.replace('_', ' ')}`, "success");
                this.refresh();
                if (this.currentTask && this.currentTask.id === taskId) {
                    this.openDetail(taskId);
                }
            }
        } catch (err) {
            console.error(err);
        } finally {
            hideLoading();
        }
    },

    async refresh() {
        const user = window.currentUser || (typeof currentUser !== 'undefined' ? currentUser : null);
        const empId = user ? user.id : '';
        const scope = (user && (user.role === 'admin' || user.role === 'Mentor' || user.has_subordinates)) ? 'team' : 'my';
        
        const loader = document.getElementById('tmV2Loader');
        if (loader && !this.tasks) loader.style.display = 'flex';

        const res = await apiCall(`tasks?employee_id=${empId}&scope=${scope}`, 'GET');
        if (res && res.success) {
            this.tasks = res.tasks;
            this.render();
        }
        
        if (loader) {
            loader.style.display = 'none';
            loader.classList.add('hidden');
        }
    },

    exportTasks() {
        document.getElementById('exportTasksFromDate').value = '';
        document.getElementById('exportTasksToDate').value = '';
        document.getElementById('exportTasksModal').classList.add('active');
    },

    closeExportTasks() {
        document.getElementById('exportTasksModal').classList.remove('active');
    },

    confirmExportTasks() {
        const fromDate = document.getElementById('exportTasksFromDate').value;
        const toDate = document.getElementById('exportTasksToDate').value;

        if (!fromDate || !toDate) {
            showNotification('Please select both From and To dates', 'error');
            return;
        }

        if (new Date(fromDate) > new Date(toDate)) {
            showNotification('From date cannot be after To date', 'error');
            return;
        }

        showLoading("Generating CSV...");
        try {
            const filteredTasks = (this.tasks || []).filter(task => {
                const createdDateStr = task.created_at ? task.created_at.split('T')[0] : '';
                return createdDateStr >= fromDate && createdDateStr <= toDate;
            });

            if (filteredTasks.length === 0) {
                showNotification('No tasks found for selected date range', 'warning');
                hideLoading();
                return;
            }

            // CSV Header
            const headers = ['Task ID', 'Title', 'Description', 'Priority', 'Status', 'Start Date', 'Due Date', 'Created At', 'Created By', 'Assignees'];
            let csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n";

            filteredTasks.forEach(t => {
                const assignees = (t.assignees || []).map(a => a.name).join('; ');
                const creator = t.created_by ? t.created_by.name : '';
                const desc = (t.description || '').replace(/"/g, '""').replace(/\n/g, ' '); // escape quotes and newlines
                const title = (t.title || '').replace(/"/g, '""').replace(/\n/g, ' ');
                
                const row = [
                    t.id,
                    `"${title}"`,
                    `"${desc}"`,
                    t.priority,
                    t.status,
                    t.start_date || '',
                    t.due_date || '',
                    t.created_at ? new Date(t.created_at).toLocaleDateString() : '',
                    `"${creator}"`,
                    `"${assignees}"`
                ];
                csvContent += row.join(",") + "\n";
            });

            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `tasks_export_${fromDate}_to_${toDate}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            this.closeExportTasks();
            showNotification("Tasks exported successfully", "success");
        } catch (err) {
            console.error(err);
            showNotification("Export failed", "error");
        } finally {
            hideLoading();
        }
    },

    async submitComment() {
        const input = document.getElementById('detailV2CommentInput');
        const text = input.value.trim();
        if (!text || !this.currentTask) return;

        showLoading("Posting comment...");
        try {
            const res = await apiCall('task-comment', 'POST', {
                task_id: this.currentTask.id,
                content: text,
                user_id: (window.currentUser || currentUser).id
            });
            if (res.success) {
                input.value = '';
                this.openDetail(this.currentTask.id);
            }
        } catch (err) {
            console.error(err);
        } finally {
            hideLoading();
        }
    },

    async addStepPrompt() {
        const stepText = prompt("Enter step description:");
        if (!stepText || !this.currentTask) return;

        showLoading("Adding step...");
        try {
            const res = await apiCall(`bulk-update-tasks`, 'POST', {
                task_ids: [this.currentTask.id],
                updates: { add_step: stepText },
                user_id: (window.currentUser || currentUser).id
            });
            if (res.success) {
                this.openDetail(this.currentTask.id);
            }
        } catch (err) {
            console.error(err);
        } finally {
            hideLoading();
        }
    }
};

// Global initializer
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => TaskManagerV2.init());
} else {
    TaskManagerV2.init();
}

window.TaskManagerV2 = TaskManagerV2;
