# KanbanFlow

A full-featured kanban board application with real-time collaboration, built with PHP, MariaDB, and vanilla JavaScript. Runs entirely in Docker.
<img width="1080" height="720" alt="image" src="https://github.com/user-attachments/assets/b940cf81-ef89-4635-b416-f42bf7584f0b" />

## Features

### Core Board Features
- **Multi-Board Support** — Create, rename, switch between, and delete boards with strict data isolation
- **Dynamic Columns** — Add, rename, recolor, delete, and drag-to-reorder columns
- **Drag & Drop** — Drag task cards between columns or reorder within columns with instant optimistic UI updates
- **Rich Text Editor** — Quill-powered descriptions with bold, italic, lists, colors, and more
- **Tags** — Built-in tags (Bug, Feature, Urgent, Design, Docs) plus custom tags
- **Due Dates** — Date/time picker with overdue highlighting
- **Dark/Light Mode** — Toggle with persistent preference
- **Board Import/Export** — Save and load boards as JSON files
- **Preview Modal** — Click a task to preview it, with an Edit button to modify
- **Duplicate Board Names** — Prevented at the API level
- **Board Rename** — Click the board title to rename it

### Real-Time Collaboration
- **Live Collaboration** — Multiple users can work on the same board simultaneously via WebSocket
- **Role-Based Permissions** — Owner, Admin, and Member roles with different access levels
  - **Owner**: Full control (invite, remove, delete board, manage tasks)
  - **Admin**: Can invite members, manage tasks, but cannot delete board
  - **Member**: Can create and edit tasks, cannot manage members
- **Email Invitations** — Invite users by email to collaborate on boards
- **Real-Time Updates** — Task moves, edits, column reordering sync instantly across all connected users
- **Presence Indicators** — See which users are viewing or editing specific tasks via avatar badges
- **Activity Logging** — Track who created, updated, or moved tasks

### UI/UX Enhancements
- **Custom Modals** — Styled alert and confirm dialogs (no native browser dialogs)
- **Ghost Drag Preview** — Visual feedback during drag operations
- **Toast Notifications** — Success/error feedback for actions
- **Responsive Design** — Works on desktop browsers

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Web Server | Nginx (Alpine) |
| Backend | PHP 8.2 FPM with PDO MySQL |
| Database | MariaDB 10.11 |
| Frontend | Vanilla JS, Tailwind CSS (CDN), Quill Editor |
| Real-Time | Custom WebSocket Server (PHP sockets) |
| Runtime | Docker Compose |

## Quick Start

1. Clone the repository:
   ```bash
   git clone https://github.com/RichardPersaud/Custom-Kanban.git
   cd Custom-Kanban
   ```

2. Start the containers:
   ```bash
   docker compose up -d --build
   ```

3. Run the database migration:
   ```bash
   curl http://localhost:3001/api/db-migrate.php
   ```

4. Open the app:
   ```
   http://localhost:3001
   ```

## API Endpoints

### Boards

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/boards` | List all boards |
| POST | `/api/boards` | Create a board |
| PUT | `/api/boards/{id}` | Rename a board |
| DELETE | `/api/boards/{id}` | Delete board and all its columns/tasks |

### Columns

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/columns?board_id={id}` | List columns for a board |
| POST | `/api/columns` | Create a column |
| PUT | `/api/columns/{id}` | Update a column |
| DELETE | `/api/columns/{id}` | Delete column and its tasks |
| POST | `/api/columns/{id}/move` | Move column to a new position |

### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tasks?board_id={id}` | List tasks for a board |
| POST | `/api/tasks` | Create a task |
| PUT | `/api/tasks/{id}` | Update a task |
| DELETE | `/api/tasks/{id}` | Delete a task |
| POST | `/api/tasks/{id}/move` | Move task to a different column |
| POST | `/api/tasks/{id}/position` | Update task position |
| GET | `/api/tasks/{id}/activities` | Get activity log for a task |

### Board Members (Collaboration)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/boards/{id}/members` | List all members and pending invitations |
| POST | `/api/boards/{id}/invite` | Send invitation by email |
| POST | `/api/boards/{id}/accept` | Accept invitation with token |
| PUT | `/api/boards/{id}/members/{user_id}` | Update member role |
| DELETE | `/api/boards/{id}/members/{user_id}` | Remove member |

### Presence (Real-Time)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/presence/heartbeat` | Update user presence (board/task viewing) |
| GET | `/api/presence/board/{id}` | Get active users on a board |

## WebSocket Events

The WebSocket server (`ws://localhost:3001/ws`) handles real-time communication:

**Client → Server:**
- `auth` — Authenticate with user_id
- `join_board` — Subscribe to board updates
- `task_create`, `task_update`, `task_delete`, `task_move` — Task changes
- `column_create`, `column_update`, `column_delete`, `column_moved` — Column changes
- `cursor_position` — Mouse position for live cursors

**Server → Client:**
- `user_joined`, `user_left` — Presence notifications
- `task_created`, `task_updated`, `task_deleted`, `task_moved` — Task sync
- `column_created`, `column_updated`, `column_deleted`, `column_moved` — Column sync
- `cursor_update` — Live cursor positions (hidden when user is viewing a task)

## Project Structure

```
.
├── Dockerfile                  # PHP 8.2 FPM with pdo_mysql
├── docker-compose.yml          # Nginx + PHP + MariaDB + WebSocket
├── nginx.conf                  # FastCGI routing + WebSocket proxy
├── websocket-server.php        # WebSocket server for real-time collaboration
├── www/
│   ├── index.html              # Main app with theme CSS
│   ├── auth.html               # Login/registration page (not in repo)
│   ├── static/
│   │   └── app.js              # All frontend logic
│   └── api/
│       ├── config.php          # Shared config, helpers, DB connection
│       ├── db-migrate.php      # Database schema migration
│       ├── boards.php          # Board CRUD API
│       ├── columns.php         # Column CRUD + move API
│       ├── tasks.php           # Task CRUD + move/position API
│       ├── board-members.php   # Member management & invitations
│       ├── presence.php        # User presence tracking API
│       └── task-activities.php # Activity logging API
```

## Configuration

The app runs on port **3001** by default. To change it, update the port mapping in `docker-compose.yml`:

```yaml
ports:
  - "YOUR_PORT:80"
```

Database credentials are set via environment variables in `docker-compose.yml` under the `db` service.

### Environment Variables (Optional)

Create a `.env` file for optional features:

```bash
# Email (for invitations)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# WebSocket
WS_PORT=8080
WS_SECRET=your-secret-key
```

## Recent Changes

### v2.0 - Real-Time Collaboration
- Added WebSocket server for live updates
- Implemented role-based permissions (Owner/Admin/Member)
- Added email invitations for board collaboration
- Added presence indicators on task cards
- Added activity logging for task changes
- Added real-time column reordering sync
- Replaced native alerts with custom styled modals
- Fixed drag and drop ghost positioning issues
- Added character limit (45) to task titles

### v1.0 - Initial Release
- Multi-board support with data isolation
- Dynamic columns with drag-to-reorder
- Drag & drop task cards
- Rich text descriptions (Quill)
- Tags and due dates
- Dark/light mode
- Board import/export

## License

MIT
