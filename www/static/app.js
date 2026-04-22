// Kanban App — Dynamic Columns + Full Feature Set

// ===== STATE =====
let tasks = [];
let columns = [];
let currentTaskId = null;
let currentColumnId = null; // for column edit modal
let selectedTags = [];      // tags selected in the modal
let currentBoard = null;    // { id, name } or null for unsaved board
let boards = [];

// Built-in tags
const BUILT_IN_TAGS = [
    { name: 'Bug', slug: 'bug', color: '#ef4444' },
    { name: 'Feature', slug: 'feature', color: '#22c55e' },
    { name: 'Urgent', slug: 'urgent', color: '#eab308' },
    { name: 'Design', slug: 'design', color: '#a855f7' },
    { name: 'Docs', slug: 'docs', color: '#3b82f6' },
];
let customTags = JSON.parse(localStorage.getItem('kanbanCustomTags') || '[]');

// Custom alert/confirm modal state
let customAlertCallback = null;

// Task-level presence data: { taskId: [user1, user2, ...] }
let taskPresenceMap = {};

// Drag state
const DRAG_THRESHOLD = 5; // pixels before drag activates (distinguishes click from drag)
const dragState = { active: false, taskId: null, ghostEl: null, offsetX: 0, offsetY: 0, sourceColumnId: null, startX: 0, startY: 0, moved: false, dragStarted: false, sourceCard: null };

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async function () {
    initTheme();
    await initApp();

    // Clean up connections when leaving the page
    window.addEventListener('beforeunload', function() {
        disconnectFromBoardEvents();
        stopPresenceTracking();
    });

    const taskForm = document.getElementById('taskForm');
    if (taskForm) taskForm.addEventListener('submit', saveTask);
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.addEventListener('input', renderBoard);
    // Column color preview
    const colorInput = document.getElementById('columnColor');
    if (colorInput) colorInput.addEventListener('input', function () {
        document.getElementById('columnColorPreview').style.background = this.value;
    });
});

async function initApp() {
    // Check authentication first
    const auth = await checkAuth();
    if (!auth) {
        window.location.href = '/auth.html';
        return;
    }

    await loadCurrentUser();

    // Check for pending invitations
    await checkForPendingInvitations();
    await loadBoardsList();
    // Load last used board or default
    const lastBoardId = localStorage.getItem('kanbanLastBoard');
    if (lastBoardId) {
        const board = boards.find(b => b.id == lastBoardId);
        if (board) {
            currentBoard = { id: board.id, name: board.name };
        }
    }
    await loadColumns();
    await loadTasks();
    renderBoard();
    updateTaskCount();
    updateBoardTitle();
    updateUserDisplay();

    // Connect to real-time updates
    connectToBoardEvents();
}

// Check if user is authenticated
async function checkAuth() {
    try {
        const response = await fetch('/api/auth/me');
        const data = await response.json();
        return data.success;
    } catch (error) {
        return false;
    }
}

// ===== USER PROFILE & SETTINGS =====
let currentUser = null;

async function loadCurrentUser() {
    try {
        const response = await fetch('/api/auth/me');
        const data = await response.json();
        if (data.success) {
            currentUser = data.data;
            updateUserDisplay();
        }
    } catch (error) {
        console.error('Failed to load user:', error);
    }
}

function updateUserDisplay() {
    if (!currentUser) return;

    const initial = currentUser.username.charAt(0).toUpperCase();
    const userInitial = document.getElementById('userInitial');
    const menuUsername = document.getElementById('menuUsername');
    const menuEmail = document.getElementById('menuEmail');
    const profileAvatar = document.getElementById('profileAvatar');
    const profileName = document.getElementById('profileName');
    const profileEmail = document.getElementById('profileEmail');
    const profileDisplayName = document.getElementById('profileDisplayName');

    if (userInitial) userInitial.textContent = initial;
    if (menuUsername) menuUsername.textContent = currentUser.username;
    if (menuEmail) menuEmail.textContent = currentUser.email;
    if (profileAvatar) profileAvatar.textContent = initial;
    if (profileName) profileName.textContent = currentUser.username;
    if (profileEmail) profileEmail.textContent = currentUser.email;
    if (profileDisplayName) profileDisplayName.value = currentUser.username;
}

// User Menu Dropdown
function toggleUserMenu() {
    const menu = document.getElementById('userMenu');
    if (menu) {
        menu.classList.toggle('hidden');
    }
}

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
    const container = document.getElementById('userMenuContainer');
    const menu = document.getElementById('userMenu');
    if (container && menu && !container.contains(e.target) && !menu.classList.contains('hidden')) {
        menu.classList.add('hidden');
    }
});

// Profile Modal
function openProfileModal() {
    toggleUserMenu(); // Close dropdown
    const modal = document.getElementById('profileModal');
    if (modal) {
        modal.classList.remove('hidden');
    }
}

function closeProfileModal() {
    const modal = document.getElementById('profileModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

async function saveProfile() {
    const displayName = document.getElementById('profileDisplayName').value.trim();
    const bio = document.getElementById('profileBio').value;

    if (!displayName) {
        showToast('Display name is required', 'error');
        return;
    }

    try {
        const response = await fetch('/api/auth/profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ display_name: displayName, bio: bio })
        });
        const result = await response.json();
        if (result.success) {
            // Update local user data
            if (currentUser) {
                currentUser.username = result.data.username;
            }
            updateUserDisplay();
            showToast('Profile updated successfully', 'success');
            closeProfileModal();
        } else {
            showToast(result.error || 'Failed to update profile', 'error');
        }
    } catch (error) {
        console.error('Error updating profile:', error);
        showToast('Error updating profile', 'error');
    }
}

// Settings Modal
function openSettingsModal() {
    toggleUserMenu(); // Close dropdown
    const modal = document.getElementById('settingsModal');
    if (modal) {
        modal.classList.remove('hidden');
    }
}

function closeSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

async function changePassword() {
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (!currentPassword || !newPassword || !confirmPassword) {
        showToast('Please fill in all password fields', 'error');
        return;
    }

    if (newPassword.length < 8) {
        showToast('New password must be at least 8 characters', 'error');
        return;
    }

    if (newPassword !== confirmPassword) {
        showToast('Passwords do not match', 'error');
        return;
    }

    // TODO: Implement password change API
    showToast('Password update coming soon', 'success');

    // Clear fields
    document.getElementById('currentPassword').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
}

// Logout function
function logout() {
    // Stop all background connections immediately
    disconnectFromBoardEvents();
    stopPresenceTracking();

    // Use sendBeacon for reliable logout without blocking
    try {
        navigator.sendBeacon('/api/auth/logout', '');
    } catch (e) {
        console.error('Beacon failed:', e);
    }

    // Immediate redirect - don't wait for anything
    // Use replace to prevent back-button returning to logged-in state
    window.location.replace('/auth.html');
}

// ===== DATA LOADING =====
async function loadTasks() {
    try {
        const url = currentBoard ? '/api/tasks.php?board_id=' + currentBoard.id : '/api/tasks.php';
        const response = await fetch(url);
        const result = await response.json();
        if (result.success) {
            tasks = (result.data || []).map(t => ({
                ...t,
                tags: typeof t.tags === 'string' ? JSON.parse(t.tags || '[]') : (t.tags || [])
            }));
        }
    } catch (error) { console.error('Error loading tasks:', error); }
}

async function loadColumns() {
    try {
        const url = currentBoard ? '/api/columns.php?board_id=' + currentBoard.id : '/api/columns.php';
        const response = await fetch(url);
        const result = await response.json();
        if (result.success) {
            columns = (result.data || []).sort((a, b) => (a.position || 0) - (b.position || 0));
        }
    } catch (error) { console.error('Error loading columns:', error); }
}

// ===== RENDERING =====
function renderBoard() {
    const searchInput = document.getElementById('searchInput');
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
    const container = document.getElementById('boardContainer');
    if (!container) return;
    container.innerHTML = '';

    columns.forEach(column => {
        const colTasks = tasks.filter(t => {
            if (t.status != column.id && t.status !== String(column.id)) return false;
            if (!searchTerm) return true;
            return (t.title || '').toLowerCase().includes(searchTerm) ||
                   ((t.description || '').replace(/<[^>]*>/g, '')).toLowerCase().includes(searchTerm);
        });
        colTasks.sort((a, b) => ((a.position || 0) - (b.position || 0)) || (new Date(b.created_at || 0) - new Date(a.created_at || 0)));

        const wrapper = document.createElement('div');
        wrapper.className = 'flex-shrink-0 w-80 snap-start';
        wrapper.dataset.columnId = column.id;

        const colDiv = document.createElement('div');
        colDiv.className = 'bg-slate-900/50 rounded-xl border border-slate-800 backdrop-blur-sm';

        // Header
        const header = document.createElement('div');
        header.className = 'column-header p-4 border-b border-slate-800 flex items-center justify-between cursor-grab active:cursor-grabbing';
        header.innerHTML = `
            <div class="flex items-center gap-2 flex-1 min-w-0">
                <div class="w-3 h-3 rounded-full flex-shrink-0" style="background:${column.color || '#4361ee'}"></div>
                <h2 class="font-semibold text-gray-200 truncate cursor-pointer hover:text-blue-400 transition-colors" title="Click to edit" onclick="openColumnModal(${column.id})">${escapeHtml(column.name)}</h2>
                <span class="bg-slate-800 text-gray-400 text-xs px-2 py-0.5 rounded-full flex-shrink-0" id="count-${column.id}">${colTasks.length}</span>
            </div>
            <div class="flex items-center gap-1">
                <button onclick="openAddModal(${column.id})" class="text-gray-500 hover:text-blue-400 transition-colors" title="Add task">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
                </button>
            </div>
        `;
        colDiv.appendChild(header);

        // Task container
        const taskContainer = document.createElement('div');
        taskContainer.className = 'task-container p-3 min-h-[200px] space-y-3';
        taskContainer.id = 'column-' + column.id;
        taskContainer.dataset.columnId = column.id;

        if (colTasks.length === 0) {
            if (searchTerm) {
                taskContainer.innerHTML = `<div class="empty-column"><div class="empty-column-icon"><svg class="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg></div><p style="color:#64748b" class="text-sm">No matching tasks</p></div>`;
            } else {
                taskContainer.innerHTML = `<div class="empty-column"><div class="empty-column-icon"><svg class="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg></div><p style="color:#64748b" class="text-sm">No tasks yet</p><a class="text-xs cursor-pointer" style="color:#3b82f6" onclick="openAddModal(${column.id})">Add your first task</a></div>`;
            }
        } else {
            colTasks.forEach(task => taskContainer.appendChild(createTaskCard(task)));
        }

        colDiv.appendChild(taskContainer);
        wrapper.appendChild(colDiv);
        container.appendChild(wrapper);
    });

    // Add column button
    const addColWrapper = document.createElement('div');
    addColWrapper.className = 'flex-shrink-0 w-80 snap-start';
    addColWrapper.innerHTML = `
        <button onclick="openColumnModal()" class="w-full h-full min-h-[200px] border-2 border-dashed border-slate-700 rounded-xl flex flex-col items-center justify-center text-gray-500 hover:text-blue-400 hover:border-blue-500 transition-all group">
            <svg class="w-8 h-8 mb-2 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            <span class="text-sm font-medium">Add Column</span>
        </button>
    `;
    container.appendChild(addColWrapper);

    // Setup drag and drop for task cards
    setupDragAndDrop();
    setupColumnDragAndDrop();
}

function createTaskCard(task) {
    // Normalize task to ensure tags is always an array
    task = normalizeTask(task);

    const card = document.createElement('div');
    card.className = 'task-card bg-slate-800 border border-slate-700 rounded-lg p-4 cursor-grab hover:border-slate-600 transition-all relative';
    card.dataset.taskId = task.id;

    // Apply column color as left border
    const columnColor = task.status_color || '#4361ee';
    card.style.borderLeftWidth = '3px';
    card.style.borderLeftColor = columnColor;

    const priorityColors = { low: 'bg-gray-600', medium: 'bg-blue-600', high: 'bg-orange-500', urgent: 'bg-red-600' };
    const priorityColor = priorityColors[task.priority] || priorityColors.medium;

    const descPreview = task.description ? task.description
        .replace(/<\/(p|li|h[1-6]|div|blockquote|tr|br\s*\/?)>/gi, ' ')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 100) + (task.description.replace(/<[^>]*>/g, '').length > 100 ? '...' : '') : '';

    // Tags HTML
    let tagsHtml = '';
    if (task.tags && task.tags.length > 0) {
        tagsHtml = '<div class="flex flex-wrap gap-1 mb-2">' +
            task.tags.map(tag => {
                const tagDef = BUILT_IN_TAGS.find(t => t.slug === tag);
                const allTags = [...BUILT_IN_TAGS, ...customTags];
                const customDef = customTags.find(t => t.slug === tag);
                const color = tagDef ? tagDef.color : (customDef ? customDef.color : '#6b7280');
                const name = tagDef ? tagDef.name : (customDef ? customDef.name : tag);
                return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium" style="background:${color}20;color:${color}">${escapeHtml(name)}</span>`;
            }).join('') + '</div>';
    }

    // Due date HTML
    let dueDateHtml = '';
    if (task.due_date) {
        const dd = formatDueDate(task.due_date);
        const overdueClass = dd.isOverdue ? 'text-red-400 font-bold' : 'text-gray-500';
        const icon = dd.isOverdue
            ? '<svg class="w-3 h-3 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>'
            : '<svg class="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
        dueDateHtml = `<span class="${overdueClass} flex items-center gap-1 text-xs">${icon}${dd.text}</span>`;
    }

    card.innerHTML = `
        <div class="flex items-start justify-between mb-1">
            <div class="drag-handle cursor-grab active:cursor-grabbing p-0.5 -ml-1 -mt-0.5 opacity-50 hover:opacity-100 transition-opacity">
                <svg class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>
            </div>
            <div class="flex items-center gap-1">
                <span class="w-2 h-2 rounded-full ${priorityColor}"></span>
            </div>
        </div>
        <h3 class="font-medium text-gray-200 text-sm mb-1 truncate" title="${escapeHtml(task.title)}">${escapeHtml(task.title.length > 45 ? task.title.substring(0, 42) + '...' : task.title)}</h3>
        ${descPreview ? `<p class="text-gray-400 text-xs mb-2 line-clamp-2">${escapeHtml(descPreview)}</p>` : ''}
        ${tagsHtml}
        <div class="flex items-center justify-between text-xs text-gray-500 mt-2">
            <span class="flex items-center gap-1">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                ${formatDate(task.created_at)}
            </span>
            ${dueDateHtml}
        </div>
    `;

    // Add presence avatars if other users are viewing this task
    const presenceHtml = renderPresenceAvatars(task.id);
    if (presenceHtml) {
        card.insertAdjacentHTML('beforeend', presenceHtml);
    }

    return card;
}

function updateTaskCount() {
    const total = tasks.length;
    const el = document.getElementById('taskCount');
    if (el) el.textContent = total + ' task' + (total !== 1 ? 's' : '');

    columns.forEach(col => {
        const count = tasks.filter(t => t.status == col.id || t.status === String(col.id)).length;
        const countEl = document.getElementById('count-' + col.id);
        if (countEl) countEl.textContent = count;
    });
}

// ===== DRAG AND DROP (Custom Mouse Events) =====
function setupDragAndDrop() {
    document.querySelectorAll('.task-card').forEach(card => {
        card.addEventListener('mousedown', onDragStart);
        // Also add click handler for cards that aren't dragged
        card.addEventListener('click', onCardClick);
    });
}

function onCardClick(e) {
    // Don't trigger on drag handle or interactive elements
    if (e.target.closest('.drag-handle, button, a, input, select, textarea')) return;

    const card = e.target.closest('.task-card');
    if (!card) return;

    const taskId = parseInt(card.dataset.taskId);
    if (!taskId) return;

    // Only open if we didn't just finish a drag
    if (!dragState.dragStarted && !dragState.active) {
        openPreviewModal(taskId);
    }
}

function onDragStart(e) {
    // Don't start drag on buttons or interactive elements
    if (e.target.closest('button, a, input, select, textarea')) return;

    const card = e.target.closest('.task-card');
    if (!card) return;

    const taskId = parseInt(card.dataset.taskId);
    const task = tasks.find(t => t.id == taskId);
    if (!task) return;

    dragState.taskId = taskId;
    dragState.sourceColumnId = task.status;
    dragState.startX = e.clientX;
    dragState.startY = e.clientY;
    dragState.moved = false;
    dragState.dragStarted = false;
    dragState.sourceCard = card;
    dragState.offsetX = 0;
    dragState.offsetY = 0;

    e.preventDefault();
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
}

function onDragMove(e) {
    if (!dragState.taskId) return;

    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;

    // Check if we've passed the drag threshold
    if (!dragState.dragStarted) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;

        // Drag threshold passed — activate drag
        dragState.dragStarted = true;
        dragState.active = true;
        dragState.moved = true;

        const card = dragState.sourceCard;
        if (!card) return;

        const rect = card.getBoundingClientRect();
        dragState.offsetX = e.clientX - rect.left;
        dragState.offsetY = e.clientY - rect.top;

        // Create simple ghost element (don't clone to avoid CSS conflicts)
        const ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.style.width = rect.width + 'px';
        ghost.style.left = rect.left + 'px';
        ghost.style.top = rect.top + 'px';
        ghost.style.position = 'fixed';
        ghost.style.pointerEvents = 'none';
        ghost.style.zIndex = '1000';
        ghost.style.transform = 'rotate(3deg) scale(1.05)';
        ghost.style.opacity = '0.92';
        ghost.style.boxShadow = '0 20px 40px -5px rgba(0,0,0,0.4)';
        ghost.style.background = '#1e293b';
        ghost.style.border = '1px solid #475569';
        ghost.style.borderRadius = '0.5rem';
        ghost.style.padding = '1rem';

        // Copy title
        const title = card.querySelector('h3');
        if (title) {
            ghost.innerHTML = `<h3 class="font-medium text-gray-200 text-sm truncate">${title.textContent}</h3>`;
        }
        document.body.appendChild(ghost);
        dragState.ghostEl = ghost;

        card.style.opacity = '0.3';

        document.body.style.cursor = 'grabbing';
    }

    if (!dragState.ghostEl) return;

    dragState.ghostEl.style.left = (e.clientX - dragState.offsetX) + 'px';
    dragState.ghostEl.style.top = (e.clientY - dragState.offsetY) + 'px';

    // Highlight target column
    document.querySelectorAll('.task-container[data-column-id]').forEach(el => el.classList.remove('drag-over'));

    const elementUnder = document.elementFromPoint(e.clientX, e.clientY);
    if (!elementUnder) return;
    const columnEl = elementUnder.closest('[data-column-id]');
    if (columnEl) columnEl.classList.add('drag-over');

    // Insert placeholder at drop position
    removePlaceholders();
    if (columnEl) {
        const cards = Array.from(columnEl.querySelectorAll('.task-card:not([style*="opacity: 0.3"])'));
        let insertBefore = null;
        for (const c of cards) {
            const rect = c.getBoundingClientRect();
            if (e.clientY < rect.top + rect.height / 2) {
                insertBefore = c;
                break;
            }
        }
        const placeholder = document.createElement('div');
        placeholder.className = 'drag-placeholder';
        if (insertBefore) {
            columnEl.insertBefore(placeholder, insertBefore);
        } else {
            columnEl.appendChild(placeholder);
        }
    }
}

async function onDragEnd(e) {
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);

    document.body.style.cursor = '';

    // If drag never started, treat as click
    if (!dragState.dragStarted) {
        if (dragState.taskId) {
            openPreviewModal(dragState.taskId);
        }
        dragState.taskId = null;
        dragState.sourceCard = null;
        return;
    }

    // Reset source card opacity
    const sourceCard = dragState.sourceCard;
    if (sourceCard) sourceCard.style.opacity = '';

    // Remove ghost
    if (dragState.ghostEl) {
        dragState.ghostEl.remove();
        dragState.ghostEl = null;
    }
    removePlaceholders();
    document.querySelectorAll('[data-column-id]').forEach(el => el.classList.remove('drag-over'));

    // Find target column
    const elementUnder = document.elementFromPoint(e.clientX, e.clientY);
    let targetColumnEl = null;
    if (elementUnder) targetColumnEl = elementUnder.closest('.task-container[data-column-id]');

    if (targetColumnEl) {
        const targetColumnId = parseInt(targetColumnEl.dataset.columnId);
        const taskId = dragState.taskId;

        if (dragState.sourceColumnId == targetColumnId) {
            // Same column — reorder
            await handleReorder(e, taskId, targetColumnId, targetColumnEl);
        } else {
            // Different column — move
            await updateTaskStatus(taskId, targetColumnId);
        }
    }

    // Animate dropped card
    if (sourceCard) {
        sourceCard.classList.add('animate-drop-bounce');
        setTimeout(() => sourceCard.classList.remove('animate-drop-bounce'), 300);
    }

    dragState.active = false;
    dragState.taskId = null;
    dragState.sourceColumnId = null;
    dragState.moved = false;
    dragState.dragStarted = false;
    dragState.sourceCard = null;
}

function removePlaceholders() {
    document.querySelectorAll('.drag-placeholder').forEach(p => p.remove());
}

// Column drag and drop
const colDragState = { active: false, columnId: null, ghostEl: null, offsetX: 0, offsetY: 0, startX: 0, startY: 0, moved: false, dragStarted: false, sourceEl: null };

function setupColumnDragAndDrop() {
    const container = document.getElementById('boardContainer');
    if (!container) return;

    container.querySelectorAll('.column-header').forEach(header => {
        header.addEventListener('mousedown', onColumnDragStart);
    });
}

function onColumnDragStart(e) {
    // Don't start drag on buttons
    if (e.target.closest('button')) return;

    const wrapper = e.target.closest('[data-column-id]');
    if (!wrapper) return;

    const columnId = parseInt(wrapper.dataset.columnId);
    const col = columns.find(c => c.id == columnId);
    if (!col) return;

    e.preventDefault();

    colDragState.columnId = columnId;
    colDragState.startX = e.clientX;
    colDragState.startY = e.clientY;
    colDragState.moved = false;
    colDragState.dragStarted = false;
    colDragState.sourceEl = wrapper;

    document.addEventListener('mousemove', onColumnDragMove);
    document.addEventListener('mouseup', onColumnDragEnd);
}

function onColumnDragMove(e) {
    if (!colDragState.columnId) return;

    const dx = e.clientX - colDragState.startX;
    const dy = e.clientY - colDragState.startY;

    if (!colDragState.dragStarted) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        colDragState.dragStarted = true;
        colDragState.moved = true;

        const el = colDragState.sourceEl;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        colDragState.offsetX = e.clientX - rect.left;
        colDragState.offsetY = e.clientY - rect.top;

        // Create simple ghost element
        const ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.style.width = rect.width + 'px';
        ghost.style.left = rect.left + 'px';
        ghost.style.top = rect.top + 'px';
        ghost.style.position = 'fixed';
        ghost.style.pointerEvents = 'none';
        ghost.style.zIndex = '1000';
        ghost.style.transform = 'rotate(2deg) scale(1.02)';
        ghost.style.opacity = '0.9';
        ghost.style.boxShadow = '0 20px 40px -5px rgba(0,0,0,0.4)';
        ghost.style.background = '#1e293b';
        ghost.style.border = '1px solid #475569';
        ghost.style.borderRadius = '0.75rem';
        ghost.innerHTML = `<div class="p-4 text-gray-200 font-medium">${el.querySelector('h3')?.textContent || 'Column'}</div>`;
        document.body.appendChild(ghost);
        colDragState.ghostEl = ghost;

        el.style.opacity = '0.3';
        document.body.style.cursor = 'grabbing';
    }

    if (!colDragState.ghostEl) return;

    colDragState.ghostEl.style.left = (e.clientX - colDragState.offsetX) + 'px';
    colDragState.ghostEl.style.top = (e.clientY - colDragState.offsetY) + 'px';

    // Highlight drop target
    document.querySelectorAll('.col-drop-before, .col-drop-after').forEach(el => el.classList.remove('col-drop-before', 'col-drop-after'));

    const elementUnder = document.elementFromPoint(e.clientX, e.clientY);
    if (!elementUnder) return;
    const targetWrapper = elementUnder.closest('[data-column-id]');
    if (targetWrapper && parseInt(targetWrapper.dataset.columnId) !== colDragState.columnId) {
        const tRect = targetWrapper.getBoundingClientRect();
        if (e.clientX < tRect.left + tRect.width / 2) {
            targetWrapper.classList.add('col-drop-before');
        } else {
            targetWrapper.classList.add('col-drop-after');
        }
    }
}

async function onColumnDragEnd(e) {
    document.removeEventListener('mousemove', onColumnDragMove);
    document.removeEventListener('mouseup', onColumnDragEnd);
    document.body.style.cursor = '';

    if (!colDragState.dragStarted) {
        colDragState.columnId = null;
        colDragState.sourceEl = null;
        return;
    }

    // Reset source
    if (colDragState.sourceEl) colDragState.sourceEl.style.opacity = '';
    if (colDragState.ghostEl) { colDragState.ghostEl.remove(); colDragState.ghostEl = null; }
    document.querySelectorAll('.col-drop-before, .col-drop-after').forEach(el => el.classList.remove('col-drop-before', 'col-drop-after'));

    // Find drop target
    const elementUnder = document.elementFromPoint(e.clientX, e.clientY);
    let targetWrapper = null;
    if (elementUnder) targetWrapper = elementUnder.closest('[data-column-id]');

    if (targetWrapper && parseInt(targetWrapper.dataset.columnId) !== colDragState.columnId) {
        const targetColId = parseInt(targetWrapper.dataset.columnId);
        const tRect = targetWrapper.getBoundingClientRect();
        const insertBefore = e.clientX < tRect.left + tRect.width / 2;

        // Optimistic: reorder columns locally and re-render
        const draggedCol = columns.find(c => c.id == colDragState.columnId);
        if (draggedCol) {
            const targetCol = columns.find(c => c.id == targetColId);
            if (targetCol) {
                // Remove dragged column from array
                const newCols = columns.filter(c => c.id !== colDragState.columnId);
                let targetIdx = newCols.findIndex(c => c.id === targetColId);
                if (!insertBefore) targetIdx++;
                newCols.splice(targetIdx, 0, draggedCol);
                // Reassign positions
                for (let i = 0; i < newCols.length; i++) {
                    newCols[i].position = i + 1;
                }
                columns = newCols;
                renderBoard();

                // Persist in background
                for (let i = 0; i < newCols.length; i++) {
                    fetch('/api/columns/' + newCols[i].id + '/move', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ position: i + 1 })
                    }).catch(() => {});
                }
            }
        }
    }

    colDragState.columnId = null;
    colDragState.sourceEl = null;
    colDragState.moved = false;
    colDragState.dragStarted = false;
}

// ===== TASK OPERATIONS =====
async function handleReorder(e, taskId, columnId, columnEl) {
    const statusId = columnId;
    const columnTasks = tasks.filter(t => t.status == statusId || t.status === String(statusId))
        .sort((a, b) => (a.position || 0) - (b.position || 0));

    const draggedTask = columnTasks.find(t => t.id == taskId);
    if (!draggedTask) { return; }

    const filtered = columnTasks.filter(t => t.id != taskId);
    let dropIndex = filtered.length;
    const remainingCards = columnEl.querySelectorAll('.task-card');
    let cardIdx = 0;
    for (let i = 0; i < filtered.length; i++) {
        while (cardIdx < remainingCards.length) {
            const rect = remainingCards[cardIdx].getBoundingClientRect();
            const cardTaskId = parseInt(remainingCards[cardIdx].dataset.taskId);
            if (cardTaskId == taskId) { cardIdx++; continue; }
            if (e.clientY < rect.top + rect.height / 2) {
                dropIndex = i;
                break;
            }
            cardIdx++;
            break;
        }
        if (dropIndex !== filtered.length) break;
    }
    filtered.splice(dropIndex, 0, draggedTask);

    // Optimistic: update local state and re-render immediately
    for (let i = 0; i < filtered.length; i++) {
        const task = tasks.find(t => t.id == filtered[i].id);
        if (task) task.position = i;
    }
    renderBoard();

    // Persist positions in background
    const updates = [];
    for (let i = 0; i < filtered.length; i++) {
        updates.push(fetch('/api/tasks/' + filtered[i].id + '/position', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ position: i })
        }).catch(() => {}));
    }
    await Promise.all(updates);
}

async function updateTaskStatus(taskId, newStatus) {
    // Optimistic: update local state and re-render immediately
    const task = tasks.find(t => t.id == taskId);
    if (task) {
        task.status = newStatus;
        // Assign position at end of new column
        const newColTasks = tasks.filter(t => t.status == newStatus || t.status === String(newStatus));
        task.position = Math.max(0, ...newColTasks.map(t => t.position || 0)) + 1;
        renderBoard();
        updateTaskCount();
    }

    try {
        const response = await fetch('/api/tasks/' + taskId, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        const result = await response.json();
        if (result.success) {
            // Broadcast via WebSocket
            broadcastTaskUpdate('task_move', {
                task_id: taskId,
                new_status: newStatus
            });

            // Sync server data back quietly
            const serverTask = result.data;
            const idx = tasks.findIndex(t => t.id == taskId);
            if (idx >= 0 && serverTask) {
                tasks[idx] = { ...tasks[idx], ...serverTask, tags: typeof serverTask.tags === 'string' ? JSON.parse(serverTask.tags || '[]') : (serverTask.tags || []) };
            }
            renderBoard();
        } else {
            showToast('Error moving task', 'error');
            await loadTasks();
            renderBoard();
        }
    } catch (error) {
        console.error('Error updating task status:', error);
        await loadTasks();
        renderBoard();
    }
}

async function updateTaskPosition(taskId, position) {
    try {
        await fetch('/api/tasks/' + taskId + '/position', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ position })
        });
    } catch (error) { console.error('Error updating position:', error); }
}

// ===== TASK MODAL =====
function populateStatusSelect(selectedStatus) {
    const select = document.getElementById('taskStatus');
    if (!select) return;
    select.innerHTML = '';
    columns.forEach(col => {
        const opt = document.createElement('option');
        opt.value = col.id;
        opt.textContent = col.name;
        if (selectedStatus && (col.id == selectedStatus || col.id === parseInt(selectedStatus))) opt.selected = true;
        select.appendChild(opt);
    });
}

async function openPreviewModal(taskId) {
    let task = tasks.find(t => t.id == taskId);
    if (!task) return;
    currentTaskId = taskId;

    // Normalize task to ensure tags is always an array
    task = normalizeTask(task);

    // Load activity log
    await loadTaskActivities(taskId);

    const col = columns.find(c => c.id == task.status);
    const priorityColors = { low: '#6b7280', medium: '#3b82f6', high: '#f59e0b', urgent: '#ef4444' };
    const priorityLabels = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };

    // Build tags HTML
    let tagsHtml = '';
    if (task.tags && task.tags.length > 0) {
        tagsHtml = task.tags.map(tag => {
            const builtIn = BUILT_IN_TAGS.find(t => t.slug === tag);
            const color = builtIn ? builtIn.color : '#6366f1';
            const label = builtIn ? builtIn.name : tag;
            return `<span class="inline-block text-xs font-medium px-2.5 py-1 rounded-full mr-1.5 mb-1.5" style="background:${color}22;color:${color};border:1px solid ${color}44">${label}</span>`;
        }).join('');
    }

    // Due date
    let dueHtml = '';
    if (task.due_date) {
        const d = new Date(task.due_date);
        const isOverdue = d < new Date();
        const formatted = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        dueHtml = `<div class="flex items-center gap-2 text-sm ${isOverdue ? 'text-red-400' : 'text-gray-400'}">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
            ${formatted}${isOverdue ? ' <span class="text-red-400 font-medium">(Overdue)</span>' : ''}
        </div>`;
    }

    document.getElementById('previewContent').innerHTML = `
        <div class="flex items-start justify-between mb-4">
            <h2 class="text-xl font-bold text-white flex-1 pr-4">${task.title}</h2>
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium" style="background:${priorityColors[task.priority] || '#3b82f6'}22;color:${priorityColors[task.priority] || '#3b82f6'}">
                <span class="w-2 h-2 rounded-full" style="background:${priorityColors[task.priority] || '#3b82f6'}"></span>
                ${priorityLabels[task.priority] || task.priority}
            </span>
        </div>

        ${col ? `<div class="flex items-center gap-2 mb-3">
            <span class="w-3 h-3 rounded-full" style="background:${col.color}"></span>
            <span class="text-sm text-gray-400">${col.name}</span>
        </div>` : ''}

        ${task.description && task.description !== '<p><br></p>' ? `<div class="ql-snow mb-4 p-3 rounded-lg" style="background:var(--bg-input);border:1px solid var(--border-color)">
            <div class="ql-editor text-gray-300 text-sm leading-relaxed" style="padding:0">${task.description}</div>
        </div>` : ''}

        ${tagsHtml ? `<div class="mb-4">${tagsHtml}</div>` : ''}

        ${dueHtml}

        <div class="text-xs text-gray-500 mt-4 pt-3 border-t" style="border-color:var(--border-color)">
            Created ${task.created_at ? new Date(task.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A'}
        </div>
    `;

    document.getElementById('previewModal').classList.remove('hidden');
    document.getElementById('previewModal').classList.add('flex');

    // Update presence to show we're viewing this task
    updateUserPresence(taskId, 'viewing');
}

function closePreviewModal() {
    document.getElementById('previewModal').classList.add('hidden');
    document.getElementById('previewModal').classList.remove('flex');
    currentTaskId = null;

    // Clear presence when closing modal
    updateUserPresence(null, null);
}

function editFromPreview() {
    const taskId = currentTaskId;
    closePreviewModal();
    openEditModal(taskId);
}

function deleteFromPreview() {
    const taskId = currentTaskId;
    if (!taskId) return;
    closePreviewModal();
    deleteTask(taskId);
}

function openAddModal(columnId) {
    currentTaskId = null;
    document.getElementById('taskId').value = '';
    document.getElementById('taskTitle').value = '';
    document.getElementById('taskDescription').value = '';
    document.getElementById('taskPriority').value = 'medium';
    document.getElementById('taskDueDate').value = '';
    document.getElementById('modalTitle').textContent = 'Add New Task';
    populateStatusSelect(columnId || (columns[0] && columns[0].id));
    selectedTags = [];
    renderTagDropdown();

    const deleteBtn = document.getElementById('deleteBtn');
    if (deleteBtn) deleteBtn.classList.add('hidden');
    if (typeof quillEditor !== 'undefined' && quillEditor) quillEditor.setContents([]);
    document.getElementById('taskModal').classList.remove('hidden');
    document.getElementById('taskModal').classList.add('flex');
    document.getElementById('taskTitle').focus();

    // Update presence - creating new task (not attached to specific task yet)
    updateUserPresence(null, 'creating');
}

function openEditModal(taskId) {
    const task = tasks.find(t => t.id == taskId);
    if (!task) return;
    currentTaskId = taskId;
    document.getElementById('taskId').value = taskId;
    document.getElementById('taskTitle').value = task.title || '';
    document.getElementById('taskDescription').value = task.description || '';
    document.getElementById('taskPriority').value = task.priority || 'medium';
    document.getElementById('modalTitle').textContent = 'Edit Task';
    populateStatusSelect(task.status);
    selectedTags = Array.isArray(task.tags) ? [...task.tags] : [];
    renderTagDropdown();

    // Due date
    if (task.due_date) {
        const d = new Date(task.due_date);
        const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        document.getElementById('taskDueDate').value = local;
    } else {
        document.getElementById('taskDueDate').value = '';
    }

    const deleteBtn = document.getElementById('deleteBtn');
    if (deleteBtn) deleteBtn.classList.remove('hidden');
    // Clear editor first, then paste content
    if (typeof quillEditor !== 'undefined' && quillEditor) {
        quillEditor.setContents([]);
        if (task.description && task.description !== '<p><br></p>') {
            quillEditor.clipboard.dangerouslyPasteHTML(task.description);
        }
    }
    document.getElementById('taskModal').classList.remove('hidden');
    document.getElementById('taskModal').classList.add('flex');

    // Update presence to show we're editing this task
    updateUserPresence(taskId, 'editing');
}

function closeModal() {
    document.getElementById('taskModal').classList.add('hidden');
    document.getElementById('taskModal').classList.remove('flex');
    currentTaskId = null;

    // Clear presence when closing modal
    updateUserPresence(null, null);
}

async function saveTask(e) {
    if (e) e.preventDefault();
    const taskId = document.getElementById('taskId').value;
    const title = document.getElementById('taskTitle').value.trim();
    const status = parseInt(document.getElementById('taskStatus').value);
    const priority = document.getElementById('taskPriority').value;
    const dueDate = document.getElementById('taskDueDate').value || null;
    let description = '';
    if (typeof quillEditor !== 'undefined' && quillEditor) {
        const html = quillEditor.root.innerHTML;
        // Quill always wraps in <p>; treat empty/default as empty string
        if (html && html !== '<p><br></p>') {
            description = html;
        }
    } else {
        description = document.getElementById('taskDescription').value;
    }
    if (!title) { showCustomAlert('Title is required', 'Validation Error', 'warning'); return; }

    const taskData = { title, description, status, priority, tags: selectedTags, due_date: dueDate, board_id: currentBoard ? currentBoard.id : null };
    const url = taskId ? '/api/tasks/' + taskId : '/api/tasks.php';
    const method = taskId ? 'PUT' : 'POST';

    try {
        const response = await fetch(url, {
            method, headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(taskData)
        });
        const result = await response.json();
        if (result.success) {
            closeModal();

            // Broadcast via WebSocket
            const eventType = taskId ? 'task_update' : 'task_create';
            broadcastTaskUpdate(eventType, {
                task_id: taskId || result.data.id,
                task: result.data
            });

            await loadTasks();
            renderBoard();
            showToast('Task saved', 'success');
        } else {
            showCustomAlert(result.error || 'Unknown error', 'Error', 'error');
        }
    } catch (error) {
        console.error('Error saving task:', error);
        showCustomAlert('Error saving task: ' + error.message, 'Error', 'error');
    }
}

async function deleteTask(taskId) {
    if (!taskId) taskId = currentTaskId;
    if (!taskId) return;
    showCustomConfirm('Delete this task?', 'Confirm Delete', async (confirmed) => {
        if (!confirmed) return;
        try {
            const response = await fetch('/api/tasks/' + taskId, { method: 'DELETE' });
            const result = await response.json();
            if (result.success) {
                closeModal();

                // Broadcast via WebSocket
                broadcastTaskUpdate('task_delete', { task_id: taskId });

                await loadTasks();
                renderBoard();
                showToast('Task deleted', 'success');
            } else {
                showCustomAlert(result.error || 'Unknown error', 'Error', 'error');
            }
        } catch (error) {
            console.error('Error deleting task:', error);
            showCustomAlert('Error deleting task: ' + error.message, 'Error', 'error');
        }
    }, 'Delete', 'Cancel', 'danger');
}

function deleteCurrentTask() { deleteTask(currentTaskId); }

// ===== COLUMN MODAL =====
function openColumnModal(columnId) {
    currentColumnId = columnId || null;
    const deleteBtn = document.getElementById('deleteColumnBtn');
    if (columnId) {
        const col = columns.find(c => c.id == columnId);
        if (!col) return;
        document.getElementById('columnModalTitle').textContent = 'Edit Column';
        document.getElementById('columnName').value = col.name;
        document.getElementById('columnColor').value = col.color || '#4361ee';
        document.getElementById('columnColorPreview').style.background = col.color || '#4361ee';
        if (deleteBtn) deleteBtn.classList.remove('hidden');
    } else {
        document.getElementById('columnModalTitle').textContent = 'Add Column';
        document.getElementById('columnName').value = '';
        document.getElementById('columnColor').value = '#4361ee';
        document.getElementById('columnColorPreview').style.background = '#4361ee';
        if (deleteBtn) deleteBtn.classList.add('hidden');
    }
    document.getElementById('columnModal').classList.remove('hidden');
    document.getElementById('columnModal').classList.add('flex');
    document.getElementById('columnName').focus();
}

function closeColumnModal() {
    document.getElementById('columnModal').classList.add('hidden');
    document.getElementById('columnModal').classList.remove('flex');
    currentColumnId = null;
}

async function saveColumn() {
    const name = document.getElementById('columnName').value.trim();
    const color = document.getElementById('columnColor').value;
    if (!name) { showCustomAlert('Column name is required', 'Validation Error', 'warning'); return; }

    try {
        if (currentColumnId) {
            const response = await fetch('/api/columns/' + currentColumnId, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, color })
            });
            const result = await response.json();
            if (!result.success) { showCustomAlert(result.error || 'Unknown error', 'Error', 'error'); return; }
        } else {
            const pos = columns.length > 0 ? Math.max(...columns.map(c => c.position || 0)) + 1 : 1;
            const response = await fetch('/api/columns.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, color, position: pos, board_id: currentBoard ? currentBoard.id : null })
            });
            const result = await response.json();
            if (!result.success) { showCustomAlert(result.error || 'Unknown error', 'Error', 'error'); return; }
        }
        closeColumnModal();
        await loadColumns();
        renderBoard();
        showToast(currentColumnId ? 'Column updated' : 'Column added', 'success');
    } catch (error) {
        console.error('Error saving column:', error);
        showCustomAlert('Error saving column: ' + error.message, 'Error', 'error');
    }
}

async function deleteCurrentColumn() {
    if (!currentColumnId) return;
    const col = columns.find(c => c.id == currentColumnId);
    if (!col) return;
    const taskCount = tasks.filter(t => t.status == currentColumnId || t.status === String(currentColumnId)).length;
    const msg = taskCount > 0
        ? `Delete "${col.name}" and its ${taskCount} task${taskCount > 1 ? 's' : ''}? This cannot be undone.`
        : `Delete "${col.name}"? This cannot be undone.`;
    showCustomConfirm(msg, 'Confirm Delete', async (confirmed) => {
        if (!confirmed) return;
        try {
            const response = await fetch('/api/columns/' + currentColumnId, { method: 'DELETE' });
            const result = await response.json();
            if (result.success) {
                closeColumnModal();
                await loadColumns();
                await loadTasks();
                renderBoard();
                showToast('Column deleted', 'success');
            } else {
                showCustomAlert(result.error || 'Unknown error', 'Error', 'error');
            }
        } catch (error) {
            console.error('Error deleting column:', error);
            showCustomAlert('Error deleting column: ' + error.message, 'Error', 'error');
        }
    }, 'Delete', 'Cancel', 'danger');
}

// ===== TAG DROPDOWN =====
function toggleTagDropdown() {
    const menu = document.getElementById('tagDropdownMenu');
    menu.classList.toggle('hidden');
    if (!menu.classList.contains('hidden')) renderTagDropdown();
}

function renderTagDropdown() {
    const menu = document.getElementById('tagDropdownMenu');
    if (!menu) return;
    const allTags = [...BUILT_IN_TAGS, ...customTags];
    menu.innerHTML = allTags.map(tag => {
        const checked = selectedTags.includes(tag.slug) ? 'checked' : '';
        return `<label class="flex items-center gap-2 px-4 py-2 hover:bg-slate-700 cursor-pointer">
            <input type="checkbox" ${checked} onchange="toggleTag('${tag.slug}')" class="rounded">
            <span class="w-3 h-3 rounded-full flex-shrink-0" style="background:${tag.color}"></span>
            <span class="text-sm text-gray-200">${escapeHtml(tag.name)}</span>
        </label>`;
    }).join('') +
        `<div class="border-t border-slate-700 mt-1 pt-1 px-4 py-2">
            <div class="flex gap-2">
                <input type="text" id="customTagInput" placeholder="Custom tag..." class="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-gray-200 focus:outline-none focus:border-blue-500">
                <button onclick="addCustomTag()" class="bg-blue-600 hover:bg-blue-700 text-white text-xs px-2 py-1 rounded">Add</button>
            </div>
        </div>`;
    updateTagDropdownLabel();
}

function toggleTag(slug) {
    if (selectedTags.includes(slug)) {
        selectedTags = selectedTags.filter(t => t !== slug);
    } else {
        selectedTags.push(slug);
    }
    renderTagDropdown();
}

function addCustomTag() {
    const input = document.getElementById('customTagInput');
    if (!input) return;
    const name = input.value.trim();
    if (!name) return;
    const slug = 'custom-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!selectedTags.includes(slug)) selectedTags.push(slug);
    if (!customTags.find(t => t.slug === slug)) {
        customTags.push({ name, slug, color: '#6b7280' });
        localStorage.setItem('kanbanCustomTags', JSON.stringify(customTags));
    }
    renderTagDropdown();
}

function updateTagDropdownLabel() {
    const label = document.getElementById('tagDropdownLabel');
    if (!label) return;
    if (selectedTags.length === 0) {
        label.textContent = 'Select tags...';
        label.className = 'text-gray-500';
    } else {
        const names = selectedTags.map(s => {
            const t = BUILT_IN_TAGS.find(b => b.slug === s) || customTags.find(c => c.slug === s);
            return t ? t.name : s;
        });
        label.textContent = names.join(', ');
        label.className = 'text-gray-200';
    }
}

// Close tag dropdown when clicking outside
document.addEventListener('click', function (e) {
    const dropdown = document.getElementById('tagDropdown');
    const menu = document.getElementById('tagDropdownMenu');
    if (dropdown && menu && !dropdown.contains(e.target) && !menu.contains(e.target)) {
        menu.classList.add('hidden');
    }
});

// ===== UTILITY FUNCTIONS =====
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Normalize task data to ensure tags are always an array
 */
function normalizeTask(task) {
    if (!task) return task;

    // Normalize tags to always be an array
    if (typeof task.tags === 'string') {
        try {
            task.tags = JSON.parse(task.tags);
        } catch (e) {
            task.tags = [];
        }
    }
    if (!Array.isArray(task.tags)) {
        task.tags = [];
    }

    // Ensure status is a string for consistent comparison
    if (task.status !== undefined) {
        task.status = String(task.status);
    }

    return task;
}

function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return minutes + 'm ago';
    if (hours < 24) return hours + 'h ago';
    if (days < 7) return days + 'd ago';
    return date.toLocaleDateString();
}

function formatDueDate(dateStr) {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    const now = new Date();
    return {
        text: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        isOverdue: date < now
    };
}

function showToast(message, type) {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    const toastIcon = document.getElementById('toastIcon');
    if (!toast || !toastMessage) return;
    toastMessage.textContent = message;
    if (type === 'success') {
        toastIcon.innerHTML = '<svg class="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>';
    } else {
        toastIcon.innerHTML = '<svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>';
    }
    toast.classList.remove('translate-y-20', 'opacity-0');
    setTimeout(() => { toast.classList.add('translate-y-20', 'opacity-0'); }, 3000);
}

// ===== THEME TOGGLE =====
function initTheme() {
    const saved = localStorage.getItem('kanban-theme') || 'dark';
    applyTheme(saved);
}

function applyTheme(theme) {
    document.documentElement.classList.toggle('light-mode', theme === 'light');
    document.documentElement.classList.toggle('dark-mode', theme === 'dark');
    document.body.classList.toggle('light-mode', theme === 'light');
    const sunIcon = document.getElementById('themeIconSun');
    const moonIcon = document.getElementById('themeIconMoon');
    if (sunIcon) sunIcon.classList.toggle('hidden', theme === 'dark');
    if (moonIcon) moonIcon.classList.toggle('hidden', theme === 'light');
    updateQuillTheme(theme);
}

function toggleTheme() {
    const isLight = document.documentElement.classList.contains('light-mode');
    const newTheme = isLight ? 'dark' : 'light';
    localStorage.setItem('kanban-theme', newTheme);
    applyTheme(newTheme);
    renderBoard(); // re-render cards with theme-appropriate styles
}

function updateQuillTheme(theme) {
    const editor = document.querySelector('.ql-editor');
    const toolbar = document.querySelector('.ql-toolbar');
    if (editor) {
        editor.style.background = theme === 'dark' ? '#1e293b' : '#f8fafc';
        editor.style.color = theme === 'dark' ? '#f1f5f9' : '#0f172a';
    }
    if (toolbar) {
        toolbar.style.background = theme === 'dark' ? '#1e293b' : '#f8fafc';
        toolbar.style.borderColor = theme === 'dark' ? '#334155' : '#e2e8f0';
    }
}

async function refreshBoard() {
    await loadBoardsList();
    await loadColumns();
    await loadTasks();
    renderBoard();
    updateTaskCount();
    showToast('Board refreshed', 'success');
}

function clearDone() {
    const doneColumn = columns.find(c => c.name && c.name.toLowerCase().includes('done'));
    const doneStatus = doneColumn ? doneColumn.id : (columns.length > 0 ? columns[columns.length - 1].id : null);
    if (!doneStatus) return;
    const doneTasks = tasks.filter(t => t.status == doneStatus || t.status === String(doneStatus));
    if (doneTasks.length === 0) { showToast('No completed tasks to clear', 'info'); return; }
    showCustomConfirm('Clear all ' + doneTasks.length + ' completed tasks?', 'Confirm Clear', (confirmed) => {
        if (!confirmed) return;
        Promise.all(doneTasks.map(t => deleteTask(t.id))).then(async () => {
            await loadTasks();
            renderBoard();
        });
    }, 'Clear', 'Cancel', 'warning');
}

// ===== BOARD MANAGEMENT =====
async function loadBoardsList() {
    try {
        const response = await fetch('/api/boards.php');
        const result = await response.json();
        if (result.success) {
            boards = result.data || [];
        }
    } catch (error) { console.error('Error loading boards:', error); }
}

function updateBoardTitle() {
    const title = document.getElementById('boardTitle');
    if (title) {
        title.textContent = currentBoard ? currentBoard.name : 'Project Board';
    }
}

async function renameBoardTitle() {
    if (!currentBoard) { showToast('Create or load a board first', 'error'); return; }
    const newName = prompt('Board name:', currentBoard.name);
    if (!newName || newName === currentBoard.name) return;
    try {
        const response = await fetch('/api/boards/' + currentBoard.id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName })
        });
        const result = await response.json();
        if (result.success) {
            currentBoard.name = newName;
            updateBoardTitle();
            await loadBoardsList();
            showToast('Board renamed', 'success');
        } else {
            showToast(result.error || 'Error renaming board', 'error');
        }
    } catch (error) {
        console.error('Error renaming board:', error);
        showToast('Error renaming board', 'error');
    }
}

async function openBoardsSidebar() {
    // Refresh boards list to get current memberships
    await loadBoardsList();
    renderBoardsList();
    document.getElementById('boardsSidebar').style.transform = 'translateX(0)';
    document.getElementById('boardsOverlay').classList.remove('hidden');
}

function closeBoardsSidebar() {
    document.getElementById('boardsSidebar').style.transform = 'translateX(100%)';
    document.getElementById('boardsOverlay').classList.add('hidden');
}

function renderBoardsList() {
    const list = document.getElementById('boardsList');
    if (!list) return;
    if (boards.length === 0) {
        list.innerHTML = '<p class="text-gray-500 text-sm">No saved boards yet.</p>';
        return;
    }
    list.innerHTML = boards.map(board => {
        const isActive = currentBoard && currentBoard.id == board.id;
        const isOwner = board.user_role === 'owner';
        return `<div class="flex items-center justify-between p-3 rounded-lg ${isActive ? 'bg-blue-600/20 border border-blue-500' : 'bg-slate-800 hover:bg-slate-700'} cursor-pointer transition-colors" onclick="loadBoard(${board.id})">
            <div>
                <div class="text-sm font-medium ${isActive ? 'text-blue-300' : 'text-gray-200'}">${escapeHtml(board.name)}</div>
                <div class="text-xs text-gray-500">${board.column_count || 0} columns · ${board.task_count || 0} tasks</div>
            </div>
            ${isOwner ? `<button onclick="event.stopPropagation(); deleteBoard(${board.id})" class="text-gray-500 hover:text-red-400 p-1" title="Delete board">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>` : ''}
        </div>`;
    }).join('');
}

async function loadBoard(boardId) {

    const doLoad = async () => {
        const board = boards.find(b => b.id == boardId);
        if (!board) return;
        currentBoard = { id: board.id, name: board.name };
        localStorage.setItem('kanbanLastBoard', board.id);
        // Load columns and tasks for this board
        const boardParam = `?board_id=${board.id}`;
        try {
            const colRes = await fetch('/api/columns.php' + boardParam);
            const colResult = await colRes.json();
            columns = colResult.success ? (colResult.data || []).sort((a, b) => (a.position || 0) - (b.position || 0)) : [];
            const taskRes = await fetch('/api/tasks.php' + boardParam);
            const taskResult = await taskRes.json();
            tasks = taskResult.success ? (taskResult.data || []).map(t => ({ ...t, tags: typeof t.tags === 'string' ? JSON.parse(t.tags || '[]') : (t.tags || []) })) : [];
        } catch (error) { console.error('Error loading board:', error); }
        closeBoardsSidebar();
        renderBoard();
        updateTaskCount();
        updateBoardTitle();
        showToast('Loaded: ' + board.name, 'success');

        // Join WebSocket room for this board
        joinBoard(board.id);
    };

    if (currentBoard) {
        showCustomConfirm('Load this board? Unsaved changes will be lost.', 'Confirm Load', async (confirmed) => {
            if (!confirmed) return;
            await doLoad();
        }, 'Load', 'Cancel', 'warning');
    } else {
        await doLoad();
    }
}

async function newBoard() {
    const doCreate = async () => {
        const name = prompt('Board name:', 'My Board');
        if (!name) return;
        try {
        const response = await fetch('/api/boards.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        const result = await response.json();
        if (result.success) {
            currentBoard = { id: result.data.id, name: result.data.name };
            localStorage.setItem('kanbanLastBoard', result.data.id);
            // Create default columns for the new board
            const defaultCols = [
                { name: 'To Do', color: '#6b7280', position: 1 },
                { name: 'In Progress', color: '#3b82f6', position: 2 },
                { name: 'Review', color: '#eab308', position: 3 },
                { name: 'Done', color: '#22c55e', position: 4 }
            ];
            for (const col of defaultCols) {
                await fetch('/api/columns.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...col, board_id: result.data.id })
                });
            }
            await loadColumns();
            await loadTasks();
            renderBoard();
            updateTaskCount();
            updateBoardTitle();
            await loadBoardsList();
            closeBoardsSidebar();
            showToast('Created: ' + name, 'success');
        } else {
            showToast(result.error || 'Error creating board', 'error');
        }
    } catch (error) { console.error('Error creating board:', error); showToast('Error creating board', 'error'); }
    };

    if (currentBoard || tasks.length > 0) {
        showCustomConfirm('Create a new board? Current data will remain on the server.', 'Confirm New Board', async (confirmed) => {
            if (!confirmed) return;
            await doCreate();
        }, 'Create', 'Cancel', 'info');
    } else {
        await doCreate();
    }
}

async function saveCurrentBoard() {
    if (currentBoard) {
        const newName = prompt('Board name:', currentBoard.name);
        if (newName && newName !== currentBoard.name) {
            try {
                const response = await fetch('/api/boards/' + currentBoard.id, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: newName })
                });
                const result = await response.json();
                if (result.success) {
                    currentBoard.name = newName;
                    updateBoardTitle();
                    await loadBoardsList();
                    showToast('Board renamed', 'success');
                } else {
                    showToast(result.error || 'Error renaming board', 'error');
                }
            } catch (error) { console.error('Error renaming board:', error); showToast('Error renaming board', 'error'); }
        } else if (newName !== null) {
            showToast('Board saved', 'success');
        }
    } else {
        // No board yet — create one
        const name = prompt('Save as board:', 'My Board');
        if (!name) return;
        try {
            const response = await fetch('/api/boards.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            const result = await response.json();
            if (result.success) {
                currentBoard = { id: result.data.id, name: result.data.name };
                localStorage.setItem('kanbanLastBoard', result.data.id);
                // Assign existing columns to this board
                for (const col of columns) {
                    await fetch('/api/columns/' + col.id, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ board_id: result.data.id })
                    });
                }
                // Assign existing tasks to this board
                for (const task of tasks) {
                    await fetch('/api/tasks/' + task.id, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ board_id: result.data.id })
                    });
                }
                await loadBoardsList();
                updateBoardTitle();
                showToast('Board saved: ' + name, 'success');
            }
        } catch (error) { console.error('Error saving board:', error); }
    }
}

async function deleteBoard(boardId) {
    showCustomConfirm('Delete this board and all its columns and tasks?', 'Confirm Delete', async (confirmed) => {
        if (!confirmed) return;
        try {
            await fetch('/api/boards/' + boardId, { method: 'DELETE' });
            if (currentBoard && currentBoard.id == boardId) {
                currentBoard = null;
                localStorage.removeItem('kanbanLastBoard');
                await loadColumns();
                await loadTasks();
                renderBoard();
                updateTaskCount();
                updateBoardTitle();
            }
            await loadBoardsList();
            renderBoardsList();
            showToast('Board deleted', 'success');
        } catch (error) { console.error('Error deleting board:', error); }
    }, 'Delete', 'Cancel', 'danger');
}

// ===== IMPORT / EXPORT =====
function exportBoard() {
    const data = {
        boardName: currentBoard ? currentBoard.name : 'Untitled Board',
        exportedAt: new Date().toISOString(),
        columns: columns.map(c => ({ id: c.id, name: c.name, color: c.color, position: c.position })),
        tasks: tasks.map(t => ({
            id: t.id, title: t.title, description: t.description, status: t.status,
            priority: t.priority, position: t.position, tags: t.tags, due_date: t.due_date, created_at: t.created_at
        }))
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (data.boardName.replace(/[^a-zA-Z0-9]/g, '_') || 'kanban_board') + '.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Board exported', 'success');
}

function triggerImport() {
    document.getElementById('importFileInput').click();
}

async function importBoard(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data.columns || !Array.isArray(data.columns)) { showToast('Invalid file: must have columns array', 'error'); return; }
        if (!data.tasks || !Array.isArray(data.tasks)) { showToast('Invalid file: must have tasks array', 'error'); return; }
        for (const task of data.tasks) {
            if (!task.title) { showToast('Invalid file: tasks must have title', 'error'); return; }
        }
        showCustomConfirm(`Import "${data.boardName || 'Untitled'}"? This will add columns and tasks to the current board.`, 'Confirm Import', async (confirmed) => {
            if (!confirmed) { event.target.value = ''; return; }
            // Create columns (mapping old IDs to new)
        const columnIdMap = {};
        for (const col of data.columns) {
            const response = await fetch('/api/columns.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: col.name, color: col.color || '#4361ee', position: col.position, board_id: currentBoard ? currentBoard.id : undefined })
            });
            const result = await response.json();
            if (result.success && result.data) columnIdMap[col.id] = result.data.id;
        }
        // Create tasks
        for (const task of data.tasks) {
            await fetch('/api/tasks.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: task.title,
                    description: task.description || '',
                    status: columnIdMap[task.status] || task.status,
                    priority: task.priority || 'medium',
                    tags: task.tags || [],
                    due_date: task.due_date || null,
                    board_id: currentBoard ? currentBoard.id : undefined
                })
            });
        }
            await loadColumns();
            await loadTasks();
            renderBoard();
            updateTaskCount();
            showToast('Board imported successfully', 'success');
            event.target.value = '';
        }, 'Import', 'Cancel', 'info');
    } catch (error) {
        console.error('Import error:', error);
        showToast('Import failed: ' + error.message, 'error');
        event.target.value = '';
    }
}

// ===== BOARD MEMBERS =====
let currentMembers = [];
let pendingInvitations = [];
let currentInviteToken = null;
let currentInviteBoardId = null;

function openMembersModal() {
    if (!currentBoard) {
        showToast('No board selected', 'error');
        return;
    }
    loadBoardMembers();
    document.getElementById('membersModal').classList.remove('hidden');
    document.getElementById('membersModal').classList.add('flex');
}

function closeMembersModal() {
    document.getElementById('membersModal').classList.add('hidden');
    document.getElementById('membersModal').classList.remove('flex');
}

async function loadBoardMembers() {
    if (!currentBoard) return;
    try {
        const response = await fetch(`/api/boards/${currentBoard.id}/members`);
        const result = await response.json();
        if (result.success) {
            currentMembers = result.data.members || [];
            pendingInvitations = result.data.pending_invitations || [];
            renderMembersList();
            updateInviteSectionVisibility();
        }
    } catch (error) {
        console.error('Error loading members:', error);
    }
}

function renderMembersList() {
    const list = document.getElementById('membersList');
    const currentUserRole = getCurrentUserBoardRole();

    let html = '';

    // Current members
    currentMembers.forEach(member => {
        const isCurrentUser = member.user_id == currentUser?.id;
        const roleBadge = getRoleBadge(member.role);
        const canRemove = (currentUserRole === 'owner' && member.role !== 'owner') ||
                         (currentUserRole === 'admin' && member.role === 'member') ||
                         isCurrentUser;
        const canChangeRole = currentUserRole === 'owner' && member.role !== 'owner';

        html += `
            <div class="flex items-center justify-between p-3 bg-slate-800 rounded-lg">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full bg-gradient-to-br from-green-400 to-blue-500 flex items-center justify-center text-white text-xs font-bold">
                        ${member.username.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <div class="text-sm font-medium text-white">
                            ${escapeHtml(member.username)} ${isCurrentUser ? '(You)' : ''}
                        </div>
                        <div class="text-xs text-gray-500">${escapeHtml(member.email)}</div>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    ${canChangeRole && !isCurrentUser ? `
                        <select onchange="updateMemberRole(${member.user_id}, this.value)"
                                class="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white">
                            <option value="member" ${member.role === 'member' ? 'selected' : ''}>Member</option>
                            <option value="admin" ${member.role === 'admin' ? 'selected' : ''}>Admin</option>
                        </select>
                    ` : roleBadge}
                    ${canRemove ? `
                        <button onclick="removeMember(${member.user_id})" class="text-gray-500 hover:text-red-400 p-1">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                            </svg>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    });

    // Pending invitations
    const canRevoke = currentUserRole === 'owner' || currentUserRole === 'admin';
    pendingInvitations.forEach(inv => {
        html += `
            <div class="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg border border-dashed border-slate-600">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                        <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                        </svg>
                    </div>
                    <div>
                        <div class="text-sm font-medium text-gray-300">${escapeHtml(inv.email)}</div>
                        <div class="text-xs text-gray-500">Pending invitation · ${inv.role}</div>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <span class="text-xs text-yellow-500 bg-yellow-500/10 px-2 py-1 rounded-full">Pending</span>
                    ${canRevoke ? `
                        <button onclick="revokeInvitation(${inv.id})" class="text-gray-500 hover:text-red-400 p-1" title="Revoke invitation">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                            </svg>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    });

    list.innerHTML = html || '<p class="text-gray-500 text-sm text-center py-4">No members yet</p>';
}

function getRoleBadge(role) {
    const colors = {
        owner: 'bg-purple-600/20 text-purple-400',
        admin: 'bg-blue-600/20 text-blue-400',
        member: 'bg-gray-600/20 text-gray-400'
    };
    return `<span class="text-xs px-2 py-1 rounded-full ${colors[role] || colors.member} capitalize">${role}</span>`;
}

function getCurrentUserBoardRole() {
    if (!currentUser || !currentMembers.length) return 'owner'; // Default to owner if not loaded
    const member = currentMembers.find(m => m.user_id == currentUser.id);
    // If user not in members list but owns the board (legacy), they're owner
    if (!member && currentBoard) {
        return 'owner';
    }
    return member?.role || 'member';
}

function updateInviteSectionVisibility() {
    const section = document.getElementById('inviteSection');
    if (!section) return;

    const role = getCurrentUserBoardRole();

    // Show for owner/admin, hide for member
    if (role === 'member') {
        section.classList.add('hidden');
    } else {
        section.classList.remove('hidden');
    }
}

async function sendInvitation() {
    const email = document.getElementById('inviteEmail').value.trim();
    const role = document.getElementById('inviteRole').value;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showToast('Please enter a valid email', 'error');
        return;
    }

    try {
        const response = await fetch(`/api/boards/${currentBoard.id}/invite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, role })
        });
        const result = await response.json();
        if (result.success) {
            showToast('Invitation sent', 'success');
            document.getElementById('inviteEmail').value = '';
            loadBoardMembers();
        } else {
            showToast(result.error || 'Failed to send invitation', 'error');
        }
    } catch (error) {
        console.error('Error sending invitation:', error);
        showToast('Error sending invitation', 'error');
    }
}

async function updateMemberRole(userId, newRole) {
    try {
        const response = await fetch(`/api/boards/${currentBoard.id}/members/${userId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: newRole })
        });
        const result = await response.json();
        if (result.success) {
            showToast('Role updated', 'success');
            loadBoardMembers();
        } else {
            showToast(result.error || 'Failed to update role', 'error');
        }
    } catch (error) {
        console.error('Error updating role:', error);
    }
}

async function removeMember(userId) {
    const member = currentMembers.find(m => m.user_id == userId);
    const isSelf = userId == currentUser?.id;
    const message = isSelf
        ? 'Leave this board?'
        : `Remove ${member?.username} from this board?`;

    showCustomConfirm(message, isSelf ? 'Leave Board' : 'Remove Member', async (confirmed) => {
        if (!confirmed) return;

        try {
        const response = await fetch(`/api/boards/${currentBoard.id}/members/${userId}`, {
            method: 'DELETE'
        });
        const result = await response.json();
        if (result.success) {
            if (isSelf) {
                closeMembersModal();
                showToast('You have left the board', 'success');
                await loadBoardsList();
                // Switch to another board or clear
                if (boards.length > 0) {
                    await loadBoard(boards[0].id);
                } else {
                    currentBoard = null;
                    await initApp();
                }
            } else {
                showToast('Member removed', 'success');
                loadBoardMembers();
            }
        } else {
            showToast(result.error || 'Failed to remove member', 'error');
        }
        } catch (error) {
            console.error('Error removing member:', error);
        }
    }, isSelf ? 'Leave' : 'Remove', 'Cancel', isSelf ? 'warning' : 'danger');
}

async function revokeInvitation(invitationId) {
    showCustomConfirm('Revoke this invitation?', 'Confirm Revoke', async (confirmed) => {
        if (!confirmed) return;

        try {
            const response = await fetch(`/api/boards/${currentBoard.id}/invitations/${invitationId}`, {
                method: 'DELETE'
            });
            const result = await response.json();
            if (result.success) {
                showToast('Invitation revoked', 'success');
                loadBoardMembers();
            } else {
                showToast(result.error || 'Failed to revoke invitation', 'error');
            }
        } catch (error) {
            console.error('Error revoking invitation:', error);
            showToast('Error revoking invitation', 'error');
        }
    }, 'Revoke', 'Cancel', 'warning');
}

/**
 * Try to load a board directly (used when invitation might already be accepted)
 */
async function tryLoadInvitedBoard(boardId) {
    try {
        // Check if user already has access to this board
        const response = await fetch(`/api/boards/${boardId}`);
        const result = await response.json();

        if (result.success && result.data) {
            // User has access, load the board directly
            showToast('You are already a member of this board', 'success');

            // Clear invite params from URL
            if (window.history.replaceState) {
                window.history.replaceState({}, document.title, window.location.pathname);
            }

            // Set as current board and load it
            currentBoard = { id: parseInt(boardId), name: result.data.name };
            currentBoardId = parseInt(boardId);
            localStorage.setItem('kanbanLastBoard', boardId);

            await loadColumns();
            await loadTasks();
            renderBoard();
            updateTaskCount();
            updateBoardTitle();
            connectToBoardEvents();
        } else {
            showToast('Invalid or expired invitation', 'error');
        }
    } catch (error) {
        console.error('Error loading board:', error);
        showToast('Invalid or expired invitation', 'error');
    }
}

// ===== INVITATION ACCEPTANCE =====
function showInvitationModal(token, boardId, boardName) {
    currentInviteToken = token;
    currentInviteBoardId = boardId;
    document.getElementById('inviteBoardName').textContent = boardName || 'a board';
    document.getElementById('inviteAcceptModal').classList.remove('hidden');
    document.getElementById('inviteAcceptModal').classList.add('flex');
}

function closeInviteModal() {
    document.getElementById('inviteAcceptModal').classList.add('hidden');
    document.getElementById('inviteAcceptModal').classList.remove('flex');
    currentInviteToken = null;
    currentInviteBoardId = null;
    // Remove query params from URL
    if (window.history.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}

async function acceptInvitation() {
    if (!currentInviteToken || !currentInviteBoardId) return;

    try {
        const response = await fetch(`/api/boards/${currentInviteBoardId}/accept`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: currentInviteToken })
        });
        const result = await response.json();
        if (result.success) {
            showToast('Invitation accepted! Redirecting to board...', 'success');

            // IMPORTANT: Parse boardId and boardName BEFORE closing modal (which clears the vars)
            const boardId = parseInt(currentInviteBoardId);
            const boardName = document.getElementById('inviteBoardName').textContent;

            // Now close modal and clear state
            closeInviteModal();

            // Clear the invite parameters from URL
            if (window.history.replaceState) {
                window.history.replaceState({}, document.title, window.location.pathname);
            }

            // Reload boards list to include the newly joined board
            await loadBoardsList();

            // Find the board in the updated list
            const board = boards.find(b => b.id == boardId);

            if (board) {
                // Clear currentBoard to bypass confirmation dialog in loadBoard
                currentBoard = null;
                // Use loadBoard to properly load everything
                await loadBoard(boardId);
            } else {
                // Fallback: set manually and load
                currentBoard = { id: boardId, name: boardName };
                localStorage.setItem('kanbanLastBoard', boardId);
                await loadColumns();
                await loadTasks();
                renderBoard();
                updateTaskCount();
                updateBoardTitle();
                connectToBoardEvents();
            }

            showToast(`Welcome to ${boardName}!`, 'success');
        } else {
            showToast(result.error || 'Failed to accept invitation', 'error');
        }
    } catch (error) {
        console.error('Error accepting invitation:', error);
        showToast('Error accepting invitation', 'error');
    }
}

function declineInvitation() {
    closeInviteModal();
    showToast('Invitation declined', 'info');
}

// Check for pending invitations on page load
async function checkForPendingInvitations() {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('invite_token');
    const boardId = urlParams.get('board_id');

    if (token && boardId) {
        // Fetch board name using public invite-info endpoint (no auth required)
        try {
            const response = await fetch(`/api/boards/${boardId}/invite-info?token=${token}`);
            const result = await response.json();
            if (result.success && result.data) {
                showInvitationModal(token, boardId, result.data.board_name);
            } else {
                // Invitation may already be accepted - try loading the board directly
                await tryLoadInvitedBoard(boardId);
            }
        } catch (error) {
            console.error('Error checking invitation:', error);
            // Try loading the board directly anyway
            await tryLoadInvitedBoard(boardId);
        }
    }
}

// ===== REAL-TIME UPDATES (WEBSOCKET) =====
let ws = null;
let wsReconnectDelay = 1000;
let wsMaxReconnectDelay = 30000;
let wsReconnectTimer = null;
let isConnecting = false;
let wsPingInterval = null;

// Start periodic ping to keep connection alive
function startWebSocketPing() {
    if (wsPingInterval) clearInterval(wsPingInterval);
    wsPingInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
        }
    }, 25000); // Ping every 25 seconds
}

function stopWebSocketPing() {
    if (wsPingInterval) {
        clearInterval(wsPingInterval);
        wsPingInterval = null;
    }
}

function connectToBoardEvents() {
    if (!currentBoard || !currentUser) return;
    if (isConnecting) return;
    if (ws && ws.readyState === WebSocket.OPEN) return;

    isConnecting = true;

    // Build WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;

    try {
        ws = new WebSocket(wsUrl);

        ws.onopen = function() {
            isConnecting = false;
            wsReconnectDelay = 1000; // Reset reconnect delay

            // Start ping interval to keep connection alive
            startWebSocketPing();

            // Authenticate
            ws.send(JSON.stringify({
                type: 'auth',
                user_id: currentUser.id,
                session_id: document.cookie.match(/PHPSESSID=[^;]+/)?.[0]?.split('=')[1]
            }));
        };

        ws.onmessage = function(event) {
            try {
                const message = JSON.parse(event.data);
                handleWebSocketMessage(message);
            } catch (e) {
                console.error('WebSocket message parse error:', e);
            }
        };

        ws.onclose = function(event) {
            isConnecting = false;
            ws = null;

            // Schedule reconnect
            scheduleReconnect();
        };

        ws.onerror = function(error) {
            console.error('WebSocket error:', error);
            isConnecting = false;
        };

        ws.onerror = function(error) {
            console.error('WebSocket error:', error);
            isConnecting = false;
        };
    } catch (e) {
        console.error('WebSocket connection failed:', e);
        isConnecting = false;
        scheduleReconnect();
    }
}

function scheduleReconnect() {
    if (wsReconnectTimer) return;

    wsReconnectTimer = setTimeout(() => {
        wsReconnectTimer = null;
        if (currentBoard) {
            connectToBoardEvents();
        }
    }, wsReconnectDelay);

    // Exponential backoff
    wsReconnectDelay = Math.min(wsReconnectDelay * 2, wsMaxReconnectDelay);
}

function disconnectFromBoardEvents() {
    if (wsReconnectTimer) {
        clearTimeout(wsReconnectTimer);
        wsReconnectTimer = null;
    }

    // Stop ping interval
    stopWebSocketPing();

    if (ws) {
        // Leave board if joined
        if (currentBoard && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'leave_board' }));
        }

        ws.close();
        ws = null;
    }

    isConnecting = false;
}

function joinBoard(boardId) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({
        type: 'join_board',
        board_id: boardId
    }));
}

function broadcastTaskUpdate(eventType, data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({
        type: eventType,
        data: data
    }));
}

function handleWebSocketMessage(message) {
    try {
        switch (message.type) {
            case 'auth_success':
                // Join current board
                if (currentBoard) {
                    joinBoard(currentBoard.id);
                }
                break;

            case 'joined_board':
                break;

            case 'board_users':
                updateCollaborativeUsers(message.users);
                break;

            case 'user_joined':
                showToast(`${message.username} joined the board`, 'info');
                break;

            case 'user_left':
                break;

            case 'task_created':
            case 'task_create':
                handleTaskCreated(message.data);
                break;

            case 'task_updated':
            case 'task_update':
                handleTaskUpdated(message.data);
                break;

            case 'task_deleted':
            case 'task_delete':
                handleTaskDeleted(message.data);
                break;

            case 'task_moved':
            case 'task_move':
                handleTaskMoved(message.data);
                break;

            case 'column_created':
            case 'column_create':
                handleColumnCreated(message.data);
                break;

            case 'column_updated':
            case 'column_update':
                handleColumnUpdated(message.data);
                break;

            case 'column_deleted':
            case 'column_delete':
                handleColumnDeleted(message.data);
                break;

            case 'column_moved':
            case 'column_move':
                handleColumnMoved(message.data);
                break;

            case 'cursor_update':
                updateUserCursor(message);
                break;

            case 'removed_from_board':
                handleRemovedFromBoard(message);
                break;

            case 'pong':
                // Server is alive, connection is healthy
                break;

            case 'error':
                console.error('WebSocket error:', message.message);
                break;

            default:
        }
    } catch (err) {
        console.error('Error handling WebSocket message:', err, message);
    }
}

function updateCollaborativeUsers(users) {
    // Update UI to show who's on the board
    const presenceIndicator = document.getElementById('activeUsersIndicator');
    if (presenceIndicator) {
        presenceIndicator.textContent = users.length + 1; // +1 for current user
    }
}

function updateUserCursor(message) {
    // Extract data from message (it's the full message object)
    const data = message.data || message;

    // If user is viewing a task, hide/remove the cursor - we show avatars on cards instead
    if (data.task_id != null && data.task_id !== undefined) {
        const existingCursor = document.getElementById(`cursor-${data.user_id}`);
        if (existingCursor) {
            existingCursor.remove();
        }
        return;
    }

    // Update or create cursor indicator for other users (only when not viewing a task)
    let cursor = document.getElementById(`cursor-${data.user_id}`);
    if (!cursor) {
        cursor = document.createElement('div');
        cursor.id = `cursor-${data.user_id}`;
        cursor.className = 'fixed pointer-events-none z-50 transition-all duration-100';
        cursor.innerHTML = `
            <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.45.45 0 0 0 .32-.77L6.18 2.85a.45.45 0 0 0-.68.36Z"/>
            </svg>
            <span class="absolute left-4 top-4 px-2 py-0.5 text-xs rounded bg-blue-500 text-white whitespace-nowrap">
                ${data.username}
            </span>
        `;
        document.body.appendChild(cursor);

        // Remove cursor after inactivity
        setTimeout(() => {
            if (cursor.parentNode) {
                cursor.remove();
            }
        }, 30000);
    }

    cursor.style.left = data.x + 'px';
    cursor.style.top = data.y + 'px';
    cursor.style.color = getUserColor(data.user_id);
}

function getUserColor(userId) {
    const colors = ['#3b82f6', '#ef4444', '#22c55e', '#eab308', '#a855f7', '#f97316'];
    return colors[userId % colors.length];
}

/**
 * Handle when the current user is removed from a board
 * Shows a popup and redirects to the boards list
 */
function handleRemovedFromBoard(message) {
    const boardId = message.board_id;
    const boardName = currentBoard ? currentBoard.name : 'this board';

    // Show removal modal
    showRemovalModal(boardName);
}

/**
 * Show modal informing user they've been removed from a board
 */
function showRemovalModal(boardName) {
    // Disconnect from WebSocket
    disconnectFromBoardEvents();

    // Create modal
    const modal = document.createElement('div');
    modal.id = 'removal-modal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    modal.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6 transform transition-all">
            <div class="flex items-center justify-center mb-4">
                <div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
                    <svg class="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                    </svg>
                </div>
            </div>
            <h3 class="text-xl font-semibold text-center text-gray-900 mb-2">Removed from Board</h3>
            <p class="text-gray-600 text-center mb-6">
                You have been removed from <strong>${escapeHtml(boardName)}</strong> by the board owner.
            </p>
            <button id="removal-ok-btn" class="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors font-medium">
                Go to My Boards
            </button>
        </div>
    `;

    document.body.appendChild(modal);

    // Handle OK button click
    document.getElementById('removal-ok-btn').addEventListener('click', () => {
        modal.remove();
        redirectToMyBoards();
    });

    // Auto-redirect after 10 seconds
    setTimeout(() => {
        if (document.getElementById('removal-modal')) {
            modal.remove();
            redirectToMyBoards();
        }
    }, 10000);
}

/**
 * Redirect user to their boards list after being removed
 */
async function redirectToMyBoards() {

    // Clear current board and data
    currentBoard = null;
    currentBoardId = null;
    columns = [];
    tasks = [];

    // Stop presence tracking
    stopPresenceTracking();

    // Clear URL params
    history.pushState({}, '', window.location.pathname);

    // Clear the board view immediately
    renderBoard();
    updateBoardTitle();

    // Find the last board the user created (where they are owner)
    try {
        const response = await fetch(`${API_URL}/boards`);
        const data = await response.json();

        if (data.success && data.data && data.data.length > 0) {
            // Find first board where user is owner
            // Note: API returns 'user_role' not 'role'
            const myBoard = data.data.find(b => b.user_role === 'owner' || b.user_id === currentUser.id);

            if (myBoard) {
                // Update the boards array first so loadBoard can find it
                boards = data.data.map(b => ({
                    ...b,
                    role: b.user_role // Normalize for consistency
                }));

                // Load that board
                await loadBoard(myBoard.id);
                showToast('Redirected to your board', 'info');
                return;
            } else {
            }
        } else {
        }
    } catch (err) {
        console.error('Error finding user board:', err);
    }

    // If no owned board found, show the boards list
    // Clear the current board view first
    currentBoard = null;
    currentBoardId = null;
    columns = [];
    tasks = [];
    renderBoard();
    updateBoardTitle();
    openBoardsSidebar();
    showToast('You have been removed from the board', 'info');
}

// Handle real-time events
function handleTaskCreated(eventData) {

    if (!eventData || typeof eventData !== 'object') {
        console.error('handleTaskCreated: invalid eventData', eventData);
        return;
    }

    const { task, task_id } = eventData;
    const newTask = task || eventData; // Handle both formats

    if (!newTask || !newTask.id) {
        console.error('handleTaskCreated: missing task data', eventData);
        return;
    }

    // Check if task already exists (avoid duplicates)
    const existingIndex = tasks.findIndex(t => t.id == newTask.id);
    if (existingIndex === -1) {
        // Normalize the task before adding
        const normalizedTask = normalizeTask(newTask);
        tasks.push(normalizedTask);
        renderBoard();
        updateTaskCount();
        showToast('New task added by another user', 'info');
    } else {
    }
}

function handleTaskUpdated(eventData) {
    const { task_id, task } = eventData;
    if (!task_id) {
        console.error('handleTaskUpdated: missing task_id', eventData);
        return;
    }

    const index = tasks.findIndex(t => t.id == task_id);
    if (index !== -1) {
        // Merge updated fields
        if (task && typeof task === 'object') {
            // Normalize the incoming task data
            const normalizedTask = normalizeTask({ ...task });
            Object.assign(tasks[index], normalizedTask);
            renderBoard();

            // If the task modal is open for this task, refresh it
            if (currentTaskId == task_id) {
                openPreviewModal(task_id);
            }
        } else {
            console.error('handleTaskUpdated: invalid task data', task);
        }
    } else {
    }
}

function handleTaskDeleted(eventData) {

    if (!eventData || typeof eventData !== 'object') {
        console.error('handleTaskDeleted: invalid eventData', eventData);
        return;
    }

    const task_id = eventData.task_id || eventData.id;

    if (!task_id) {
        console.error('handleTaskDeleted: missing task_id', eventData);
        return;
    }

    const index = tasks.findIndex(t => t.id == task_id);
    if (index !== -1) {
        tasks.splice(index, 1);
        renderBoard();
        updateTaskCount();

        // If the task modal is open for this task, close it
        if (currentTaskId == task_id) {
            closeTaskModal();
        }

        showToast('Task deleted by another user', 'info');
    } else {
    }
}

function handleTaskMoved(eventData) {

    if (!eventData || typeof eventData !== 'object') {
        console.error('handleTaskMoved: invalid eventData', eventData);
        return;
    }

    const { task_id, new_status } = eventData;

    if (!task_id) {
        console.error('handleTaskMoved: missing task_id', eventData);
        return;
    }

    if (!new_status) {
        console.error('handleTaskMoved: missing new_status', eventData);
        return;
    }

    const index = tasks.findIndex(t => t.id == task_id);
    if (index !== -1) {
        tasks[index].status = String(new_status); // Ensure string to match column IDs
        renderBoard();

        // If the task modal is open for this task, refresh it
        if (currentTaskId == task_id) {
            openPreviewModal(task_id);
        }

        showToast('Task moved by another user', 'info');
    } else {
    }
}

// ===== COLUMN EVENT HANDLERS =====
function handleColumnCreated(eventData) {
    if (!eventData || !eventData.column) return;

    const newColumn = eventData.column;

    // Check if column already exists
    const existingIndex = columns.findIndex(c => c.id == newColumn.id);
    if (existingIndex === -1) {
        columns.push(newColumn);
        columns.sort((a, b) => (a.position || 0) - (b.position || 0));
        renderBoard();
        showToast('New column added by another user', 'info');
    }
}

function handleColumnUpdated(eventData) {
    if (!eventData || !eventData.column) return;

    const updatedColumn = eventData.column;
    const index = columns.findIndex(c => c.id == updatedColumn.id);

    if (index !== -1) {
        columns[index] = { ...columns[index], ...updatedColumn };
        renderBoard();
        showToast('Column updated by another user', 'info');
    }
}

function handleColumnDeleted(eventData) {
    if (!eventData || !eventData.column_id) return;

    const columnId = eventData.column_id;
    const index = columns.findIndex(c => c.id == columnId);

    if (index !== -1) {
        columns.splice(index, 1);
        // Remove tasks in this column
        tasks = tasks.filter(t => t.status != columnId);
        renderBoard();
        showToast('Column deleted by another user', 'info');
    }
}

function handleColumnMoved(eventData) {
    if (!eventData || !eventData.column_id || !eventData.new_position) return;

    const { column_id, new_position } = eventData;
    const index = columns.findIndex(c => c.id == column_id);

    if (index !== -1) {
        columns[index].position = new_position;
        columns.sort((a, b) => (a.position || 0) - (b.position || 0));
        renderBoard();
        showToast('Column order changed by another user', 'info');
    }
}

// Mouse tracking for collaborative cursors
let lastMouseX = 0;
let lastMouseY = 0;
let cursorThrottleTimer = null;

document.addEventListener('mousemove', function(e) {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    if (!cursorThrottleTimer) {
        cursorThrottleTimer = setTimeout(() => {
            cursorThrottleTimer = null;
            if (ws && ws.readyState === WebSocket.OPEN) {
                // Only send cursor updates if user is NOT viewing a task (task avatars show that)
                const message = {
                    type: 'cursor_position',
                    x: lastMouseX,
                    y: lastMouseY
                };
                // Include task_id so server can decide whether to show cursor or not
                if (lastActiveTaskId) {
                    message.task_id = lastActiveTaskId;
                }
                ws.send(JSON.stringify(message));
            }
        }, 100); // Throttle to 10 updates per second
    }
});

// ===== TASK ACTIVITIES =====
let taskActivities = [];

async function loadTaskActivities(taskId) {
    taskActivities = [];
    const list = document.getElementById('activityList');
    if (!list) return;
    list.innerHTML = '<p class="text-gray-500 text-sm">Loading activity...</p>';

    try {
        const response = await fetch(`/api/tasks/${taskId}/activities`);
        const result = await response.json();
        if (result.success) {
            taskActivities = result.data || [];
            renderTaskActivities();
        }
    } catch (error) {
        console.error('Error loading activities:', error);
        list.innerHTML = '<p class="text-gray-500 text-sm">Failed to load activity</p>';
    }
}

function renderTaskActivities() {
    const list = document.getElementById('activityList');
    if (!list) return;

    if (taskActivities.length === 0) {
        list.innerHTML = '<p class="text-gray-500 text-sm py-2">No activity yet</p>';
        return;
    }

    list.innerHTML = taskActivities.map(activity => {
        const initial = activity.username.charAt(0).toUpperCase();
        const timeAgo = formatTimeAgo(activity.created_at);
        const actionText = getActivityActionText(activity.action, activity.field_name);
        return `
            <div class="flex items-start gap-3 p-2 rounded-lg hover:bg-slate-800/50">
                <div class="w-8 h-8 rounded-full bg-gradient-to-br from-green-400 to-blue-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                    ${initial}
                </div>
                <div class="flex-1 min-w-0">
                    <p class="text-sm text-gray-300">
                        <span class="font-medium">${escapeHtml(activity.username)}</span> ${actionText}
                    </p>
                    <p class="text-xs text-gray-500">${timeAgo}</p>
                </div>
            </div>
        `;
    }).join('');
}

function getActivityActionText(action, fieldName) {
    const actionMap = {
        'created': 'created this task',
        'updated': fieldName ? `updated ${fieldName}` : 'updated this task',
        'deleted': 'deleted this task',
        'moved': 'moved this task',
        'assigned': 'assigned this task'
    };
    return actionMap[action] || action;
}

function toggleActivityPanel() {
    const list = document.getElementById('activityList');
    const icon = document.getElementById('activityToggleIcon');
    if (!list || !icon) return;
    list.classList.toggle('hidden');
    icon.classList.toggle('rotate-180');
}

function formatTimeAgo(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
}

// ===== GLOBAL EXPORTS =====
window.openAddModal = openAddModal;
window.openPreviewModal = openPreviewModal;
window.closePreviewModal = closePreviewModal;
window.editFromPreview = editFromPreview;
window.deleteFromPreview = deleteFromPreview;
window.openEditModal = openEditModal;
window.saveTask = saveTask;
window.deleteTask = deleteTask;
window.deleteCurrentTask = deleteCurrentTask;
window.closeModal = closeModal;
window.refreshBoard = refreshBoard;
window.clearDone = clearDone;
window.openColumnModal = openColumnModal;
window.closeColumnModal = closeColumnModal;
window.saveColumn = saveColumn;
window.deleteCurrentColumn = deleteCurrentColumn;
window.toggleTagDropdown = toggleTagDropdown;
window.toggleTag = toggleTag;
window.addCustomTag = addCustomTag;
window.toggleTheme = toggleTheme;
window.openBoardsSidebar = openBoardsSidebar;
window.closeBoardsSidebar = closeBoardsSidebar;
window.newBoard = newBoard;
window.saveCurrentBoard = saveCurrentBoard;
window.loadBoard = loadBoard;
window.renameBoardTitle = renameBoardTitle;
window.deleteBoard = deleteBoard;
window.exportBoard = exportBoard;
window.triggerImport = triggerImport;
window.importBoard = importBoard;
window.logout = logout;
window.toggleUserMenu = toggleUserMenu;
window.openProfileModal = openProfileModal;
window.closeProfileModal = closeProfileModal;
window.saveProfile = saveProfile;
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.changePassword = changePassword;

// Board Members exports
window.openMembersModal = openMembersModal;
window.closeMembersModal = closeMembersModal;
window.sendInvitation = sendInvitation;
window.updateMemberRole = updateMemberRole;
window.removeMember = removeMember;
window.acceptInvitation = acceptInvitation;
window.declineInvitation = declineInvitation;
window.closeInviteModal = closeInviteModal;
window.toggleActivityPanel = toggleActivityPanel;

// ===== PRESENCE TRACKING =====
let presenceInterval = null;
let activeUsersInterval = null;
let lastActiveTaskId = null;
let lastActiveField = null;

function startPresenceTracking() {
    if (presenceInterval) {
        clearInterval(presenceInterval);
    }
    if (activeUsersInterval) {
        clearInterval(activeUsersInterval);
    }

    // Send initial heartbeat
    sendPresenceHeartbeat();

    // Send heartbeat every 5 seconds (faster presence updates)
    presenceInterval = setInterval(sendPresenceHeartbeat, 5000);

    // Update active users display immediately and every 3 seconds (faster updates)
    updateActiveUsersDisplay();
    activeUsersInterval = setInterval(updateActiveUsersDisplay, 3000);
}

function stopPresenceTracking() {
    if (presenceInterval) {
        clearInterval(presenceInterval);
        presenceInterval = null;
    }
    if (activeUsersInterval) {
        clearInterval(activeUsersInterval);
        activeUsersInterval = null;
    }
}

async function sendPresenceHeartbeat() {
    if (!currentBoard) {
        return;
    }


    try {
        await fetch('/api/presence/heartbeat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                board_id: currentBoard.id,
                task_id: lastActiveTaskId,
                field_name: lastActiveField
            })
        });
    } catch (error) {
    }
}

async function updateActiveUsersDisplay() {
    if (!currentBoard) {
        return;
    }

    try {
        const response = await fetch(`/api/presence/board/${currentBoard.id}`);
        const result = await response.json();
        if (result.success) {
            renderActiveUsers(result.data || []);
        }
    } catch (error) {
        console.error('Error fetching active users:', error);
    }
}

function renderActiveUsers(activeUsers) {

    const indicator = document.getElementById('activeUsersIndicator');
    const avatars = document.getElementById('activeUserAvatars');
    const count = document.getElementById('activeUserCount');

    if (!indicator || !avatars || !count) {
    }

    // Filter out current user
    const otherUsers = activeUsers.filter(u => u.user_id != currentUser?.id);

    // Build task-level presence map for card avatars
    taskPresenceMap = {};
    otherUsers.forEach(user => {
        if (user.task_id) {
            const taskIdStr = String(user.task_id);
            if (!taskPresenceMap[taskIdStr]) {
                taskPresenceMap[taskIdStr] = [];
            }
            taskPresenceMap[taskIdStr].push(user);
        }
    });

    // Debug log

    // Re-render cards to show presence avatars
    updateCardPresenceAvatars();

    if (otherUsers.length === 0) {
        if (indicator) indicator.classList.add('hidden');
        return;
    }

    if (indicator) indicator.classList.remove('hidden');

    // Show up to 3 avatars in header
    const colors = ['bg-green-500', 'bg-blue-500', 'bg-purple-500', 'bg-pink-500', 'bg-yellow-500'];
    if (avatars) {
        avatars.innerHTML = otherUsers.slice(0, 3).map((user, i) => {
            const initial = user.username.charAt(0).toUpperCase();
            const color = colors[i % colors.length];
            const tooltip = user.task_id ? `Editing task` : 'Viewing board';
            return `
                <div class="w-6 h-6 rounded-full ${color} flex items-center justify-center text-white text-xs font-bold border-2 border-slate-900" title="${escapeHtml(user.username)} - ${tooltip}">${initial}</div>
            `;
        }).join('');
    }

    if (count) {
        if (otherUsers.length === 1) {
            count.textContent = '1 online';
        } else {
            count.textContent = `${otherUsers.length} online`;
        }
    }
}

/**
 * Update presence avatars on all cards without full re-render
 */
function updateCardPresenceAvatars() {

    // Skip if a drag is in progress to avoid interfering with drag operations
    if (dragState.active || dragState.ghostEl) {
        return;
    }

    const taskIds = Object.keys(taskPresenceMap);

    if (taskIds.length === 0) {
        // Remove all presence avatars when no presence data
        document.querySelectorAll('.card-presence-avatars').forEach(el => el.remove());
        return;
    }

    taskIds.forEach(taskId => {
        const card = document.querySelector(`.task-card[data-task-id="${taskId}"]`);
        if (card) {
            // Skip cards that are currently being dragged
            if (card.style.opacity === '0.3') {
                return;
            }

            const existingAvatars = card.querySelector('.card-presence-avatars');
            if (existingAvatars) {
                existingAvatars.remove();
            }
            const avatarsHtml = renderPresenceAvatars(taskId);
            if (avatarsHtml) {
                card.insertAdjacentHTML('beforeend', avatarsHtml);
            }
        } else {
        }
    });

    // Remove avatars from cards that no longer have presence
    document.querySelectorAll('.task-card').forEach(card => {
        const taskId = card.dataset.taskId;
        if (!taskPresenceMap[taskId]) {
            const existingAvatars = card.querySelector('.card-presence-avatars');
            if (existingAvatars) {
                existingAvatars.remove();
            }
        }
    });
}

/**
 * Generate HTML for presence avatars on a task card
 */
function renderPresenceAvatars(taskId) {
    const taskIdStr = String(taskId);
    const users = taskPresenceMap[taskIdStr] || [];
    if (users.length === 0) return '';

    const colors = ['bg-green-500', 'bg-blue-500', 'bg-purple-500', 'bg-pink-500', 'bg-yellow-500', 'bg-orange-500'];

    let avatarsHtml = users.slice(0, 3).map((user, i) => {
        const color = colors[user.user_id % colors.length];
        const tooltip = `${escapeHtml(user.username)} - viewing this task`;
        const initial = user.username.charAt(0).toUpperCase();

        return `
            <div class="w-5 h-5 rounded-full ${color} flex items-center justify-center text-white text-[10px] font-bold border-2 border-slate-800"
                 title="${tooltip}">${initial}</div>
        `;
    }).join('');

    // Show +N indicator if more than 3 users
    if (users.length > 3) {
        avatarsHtml += `
            <div class="w-5 h-5 rounded-full bg-slate-600 flex items-center justify-center text-white text-[9px] font-medium border-2 border-slate-800"
                 title="${users.length - 3} more users">+${users.length - 3}</div>
        `;
    }

    return `
        <div class="card-presence-avatars absolute top-2 right-2 flex -space-x-1.5 z-10 pointer-events-none">
            ${avatarsHtml}
        </div>
    `;
}

function updateUserPresence(taskId, fieldName) {
    lastActiveTaskId = taskId;
    lastActiveField = fieldName;
    // Send immediate heartbeat when user focuses on a field
    sendPresenceHeartbeat();
}

// Start presence tracking when board loads
const originalRenderBoard = renderBoard;
renderBoard = function() {
    originalRenderBoard();
    if (currentBoard) {
        startPresenceTracking();
    } else {
        stopPresenceTracking();
    }
};

// ===== CUSTOM ALERT / CONFIRM MODALS =====
/**
 * Show a custom alert modal (replaces native alert)
 * @param {string} message - The message to display
 * @param {string} title - Optional title (defaults to 'Alert')
 * @param {string} type - 'info', 'success', 'warning', 'error' - affects icon color
 */
function showCustomAlert(message, title = 'Alert', type = 'info') {
    const modal = document.getElementById('customAlertModal');
    const content = document.getElementById('customAlertContent');
    const titleEl = document.getElementById('customAlertTitle');
    const messageEl = document.getElementById('customAlertMessage');
    const iconEl = document.getElementById('customAlertIcon');
    const cancelBtn = document.getElementById('customAlertCancelBtn');
    const confirmBtn = document.getElementById('customAlertConfirmBtn');

    // Set content
    titleEl.textContent = title;
    messageEl.textContent = message;

    // Set icon color based on type
    const colors = {
        info: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
        success: { bg: 'bg-green-500/20', text: 'text-green-400' },
        warning: { bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
        error: { bg: 'bg-red-500/20', text: 'text-red-400' }
    };
    const color = colors[type] || colors.info;
    iconEl.className = `flex-shrink-0 w-10 h-10 rounded-full ${color.bg} flex items-center justify-center`;
    iconEl.querySelector('svg').classList.value = `w-5 h-5 ${color.text}`;

    // Hide cancel button for alerts
    cancelBtn.classList.add('hidden');
    confirmBtn.textContent = 'OK';

    // Reset callback
    customAlertCallback = null;

    // Show modal
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    }, 10);
}

/**
 * Show a custom confirm modal (replaces native confirm)
 * @param {string} message - The message to display
 * @param {string} title - Optional title (defaults to 'Confirm')
 * @param {Function} callback - Function called with true (confirm) or false (cancel)
 * @param {string} confirmText - Text for confirm button (defaults to 'OK')
 * @param {string} cancelText - Text for cancel button (defaults to 'Cancel')
 * @param {string} type - 'info', 'warning', 'danger' - affects button styling
 */
function showCustomConfirm(message, title = 'Confirm', callback, confirmText = 'OK', cancelText = 'Cancel', type = 'info') {
    const modal = document.getElementById('customAlertModal');
    const content = document.getElementById('customAlertContent');
    const titleEl = document.getElementById('customAlertTitle');
    const messageEl = document.getElementById('customAlertMessage');
    const iconEl = document.getElementById('customAlertIcon');
    const cancelBtn = document.getElementById('customAlertCancelBtn');
    const confirmBtn = document.getElementById('customAlertConfirmBtn');

    // Set content
    titleEl.textContent = title;
    messageEl.textContent = message;

    // Set icon color based on type
    const colors = {
        info: { bg: 'bg-blue-500/20', text: 'text-blue-400', btn: 'bg-blue-600 hover:bg-blue-700' },
        warning: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', btn: 'bg-yellow-600 hover:bg-yellow-700' },
        danger: { bg: 'bg-red-500/20', text: 'text-red-400', btn: 'bg-red-600 hover:bg-red-700' }
    };
    const color = colors[type] || colors.info;
    iconEl.className = `flex-shrink-0 w-10 h-10 rounded-full ${color.bg} flex items-center justify-center`;
    iconEl.querySelector('svg').classList.value = `w-5 h-5 ${color.text}`;

    // Show cancel button for confirms
    cancelBtn.classList.remove('hidden');
    cancelBtn.textContent = cancelText;
    confirmBtn.textContent = confirmText;
    confirmBtn.className = `px-4 py-2 ${color.btn} text-white rounded-lg text-sm font-medium transition-colors`;

    // Store callback
    customAlertCallback = callback;

    // Show modal
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    }, 10);
}

/**
 * Close the custom alert/confirm modal
 * @param {boolean} result - true for confirm, false for cancel
 */
function closeCustomAlert(result) {
    const modal = document.getElementById('customAlertModal');
    const content = document.getElementById('customAlertContent');

    // Animate out
    content.classList.remove('scale-100', 'opacity-100');
    content.classList.add('scale-95', 'opacity-0');

    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');

        // Call callback if set (for confirms)
        if (customAlertCallback) {
            const cb = customAlertCallback;
            customAlertCallback = null;
            cb(result);
        }
    }, 200);
}

// Close modal on backdrop click
document.addEventListener('DOMContentLoaded', function() {
    const modal = document.getElementById('customAlertModal');
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeCustomAlert(false);
            }
        });
    }
});
