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

// Drag state
const DRAG_THRESHOLD = 5; // pixels before drag activates (distinguishes click from drag)
const dragState = { active: false, taskId: null, ghostEl: null, offsetX: 0, offsetY: 0, sourceColumnId: null, startX: 0, startY: 0, moved: false, dragStarted: false, sourceCard: null };

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async function () {
    initTheme();
    await initApp();
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
    const card = document.createElement('div');
    card.className = 'task-card bg-slate-800 border border-slate-700 rounded-lg p-4 cursor-grab hover:border-slate-600 transition-all';
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
        <h3 class="font-medium text-gray-200 text-sm mb-1">${escapeHtml(task.title)}</h3>
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
    });
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
        dragState.moved = true;

        const card = dragState.sourceCard;
        if (!card) return;

        const rect = card.getBoundingClientRect();
        dragState.offsetX = e.clientX - rect.left;
        dragState.offsetY = e.clientY - rect.top;

        // Create ghost
        const ghost = card.cloneNode(true);
        ghost.classList.add('drag-ghost');
        ghost.style.width = rect.width + 'px';
        ghost.style.left = (e.clientX - dragState.offsetX) + 'px';
        ghost.style.top = (e.clientY - dragState.offsetY) + 'px';
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

        // Create ghost
        const ghost = el.cloneNode(true);
        ghost.classList.add('drag-ghost');
        ghost.style.width = rect.width + 'px';
        ghost.style.left = (e.clientX - colDragState.offsetX) + 'px';
        ghost.style.top = (e.clientY - colDragState.offsetY) + 'px';
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

function openPreviewModal(taskId) {
    const task = tasks.find(t => t.id == taskId);
    if (!task) return;
    currentTaskId = taskId;

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
}

function closePreviewModal() {
    document.getElementById('previewModal').classList.add('hidden');
    document.getElementById('previewModal').classList.remove('flex');
    currentTaskId = null;
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
}

function closeModal() {
    document.getElementById('taskModal').classList.add('hidden');
    document.getElementById('taskModal').classList.remove('flex');
    currentTaskId = null;
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
    if (!title) { alert('Title is required'); return; }

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
            await loadTasks();
            renderBoard();
            showToast('Task saved', 'success');
        } else {
            alert('Error: ' + (result.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error saving task:', error);
        alert('Error saving task: ' + error.message);
    }
}

async function deleteTask(taskId) {
    if (!taskId) taskId = currentTaskId;
    if (!taskId) return;
    if (!confirm('Delete this task?')) return;
    try {
        const response = await fetch('/api/tasks/' + taskId, { method: 'DELETE' });
        const result = await response.json();
        if (result.success) {
            closeModal();
            await loadTasks();
            renderBoard();
            showToast('Task deleted', 'success');
        } else {
            alert('Error: ' + (result.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error deleting task:', error);
        alert('Error deleting task: ' + error.message);
    }
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
    if (!name) { alert('Column name is required'); return; }

    try {
        if (currentColumnId) {
            const response = await fetch('/api/columns/' + currentColumnId, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, color })
            });
            const result = await response.json();
            if (!result.success) { alert('Error: ' + (result.error || 'Unknown')); return; }
        } else {
            const pos = columns.length > 0 ? Math.max(...columns.map(c => c.position || 0)) + 1 : 1;
            const response = await fetch('/api/columns.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, color, position: pos, board_id: currentBoard ? currentBoard.id : null })
            });
            const result = await response.json();
            if (!result.success) { alert('Error: ' + (result.error || 'Unknown')); return; }
        }
        closeColumnModal();
        await loadColumns();
        renderBoard();
        showToast(currentColumnId ? 'Column updated' : 'Column added', 'success');
    } catch (error) {
        console.error('Error saving column:', error);
        alert('Error saving column: ' + error.message);
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
    if (!confirm(msg)) return;
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
            alert('Error: ' + (result.error || 'Unknown'));
        }
    } catch (error) {
        console.error('Error deleting column:', error);
        alert('Error deleting column: ' + error.message);
    }
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
    if (!confirm('Clear all ' + doneTasks.length + ' completed tasks?')) return;
    Promise.all(doneTasks.map(t => deleteTask(t.id))).then(async () => {
        await loadTasks();
        renderBoard();
    });
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

function openBoardsSidebar() {
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
        return `<div class="flex items-center justify-between p-3 rounded-lg ${isActive ? 'bg-blue-600/20 border border-blue-500' : 'bg-slate-800 hover:bg-slate-700'} cursor-pointer transition-colors" onclick="loadBoard(${board.id})">
            <div>
                <div class="text-sm font-medium ${isActive ? 'text-blue-300' : 'text-gray-200'}">${escapeHtml(board.name)}</div>
                <div class="text-xs text-gray-500">${board.column_count || 0} columns · ${board.task_count || 0} tasks</div>
            </div>
            <button onclick="event.stopPropagation(); deleteBoard(${board.id})" class="text-gray-500 hover:text-red-400 p-1" title="Delete board">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
        </div>`;
    }).join('');
}

async function loadBoard(boardId) {
    if (currentBoard && !confirm('Load this board? Unsaved changes will be lost.')) return;
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
}

async function newBoard() {
    if (currentBoard || tasks.length > 0) {
        if (!confirm('Create a new board? Current data will remain on the server.')) return;
    }
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
    if (!confirm('Delete this board and all its columns and tasks?')) return;
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
        if (!confirm(`Import "${data.boardName || 'Untitled'}"? This will add columns and tasks to the current board.`)) { event.target.value = ''; return; }
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
    } catch (error) {
        console.error('Import error:', error);
        showToast('Import failed: ' + error.message, 'error');
    }
    event.target.value = '';
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

console.log('Kanban app loaded with dynamic columns');