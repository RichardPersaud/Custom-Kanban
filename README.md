# KanbanFlow

A full-featured kanban board application built with PHP, MariaDB, and vanilla JavaScript. Runs entirely in Docker.

## Features

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

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Web Server | Nginx (Alpine) |
| Backend | PHP 8.2 FPM with PDO MySQL |
| Database | MariaDB 10.11 |
| Frontend | Vanilla JS, Tailwind CSS (CDN), Quill Editor |
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

## Project Structure

```
.
├── Dockerfile              # PHP 8.2 FPM with pdo_mysql
├── docker-compose.yml      # Nginx + PHP + MariaDB
├── nginx.conf              # FastCGI routing for API endpoints
├── www/
│   ├── index.html          # Main app with theme CSS
│   ├── static/
│   │   └── app.js          # All frontend logic
│   └── api/
│       ├── config.php      # Shared config, helpers, DB connection
│       ├── db-migrate.php  # Database schema migration
│       ├── boards.php      # Board CRUD API
│       ├── columns.php     # Column CRUD + move API
│       └── tasks.php       # Task CRUD + move/position API
```

## Configuration

The app runs on port **3001** by default. To change it, update the port mapping in `docker-compose.yml`:

```yaml
ports:
  - "YOUR_PORT:80"
```

Database credentials are set via environment variables in `docker-compose.yml` under the `db` service.

## License

MIT