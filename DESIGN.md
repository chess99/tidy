# Tidy Photo Organizer Design Doc

## 1. System Architecture

The system consists of two main parts managed in a monorepo structure:
- `server/`: A Node.js backend (Express) handling file system operations, scanning, database management, and serving the API.
- `client/`: A React frontend (Vite) providing the user interface for browsing and organizing photos.

### Data Flow
1. **Scanning**: Server scans a root directory -> computes hashes -> updates DB.
2. **Browsing**: Client requests assets -> Server queries DB -> returns JSON + serves thumbnails.
3. **Organizing**: Client sends actions (trash, move) -> Server updates `assets` table (logical state).
4. **Syncing**: Client requests sync -> Server reads `assets` state -> performs physical FS operations (move/delete) -> updates `files` table.

## 2. Database Schema (SQLite)

We use `better-sqlite3`.

### Table: `assets`
Represents a unique logical file content (the "What").
- `hash` (TEXT PRIMARY KEY): MD5/XXHash of the file content.
- `mime_type` (TEXT): e.g., 'image/jpeg', 'video/mp4'.
- `size` (INTEGER): File size in bytes.
- `metadata` (TEXT): JSON string containing EXIF data (width, height, taken_at, etc.).
- `taken_at` (INTEGER): Timestamp (ms) extracted from EXIF or file mtime (indexed for sorting).
- `status` (TEXT): 'inbox' (default), 'sorted' (has a target), 'trash', 'ignored'.
- `rating` (INTEGER): 0-5 (optional future feature).

### Table: `files`
Represents a physical file instance on disk (the "Where").
- `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
- `path` (TEXT UNIQUE): Absolute path to the file.
- `hash` (TEXT): Foreign Key referencing `assets.hash`.
- `scanned_at` (INTEGER): Timestamp of last scan.
- `missing` (INTEGER): 0 or 1 (boolean), 1 if file was not found during last scan.

### Indices
- `idx_assets_taken_at` on `assets(taken_at)`
- `idx_files_hash` on `files(hash)`

## 3. API Endpoints

### Assets
- `GET /api/assets`: List assets with pagination.
  - Query Params: `page`, `limit`, `sort` (date), `filter` (status).
- `GET /api/assets/:hash`: Get details for a specific asset (including list of file paths).
- `PATCH /api/assets/:hash`: Update status (e.g., mark as trash).
  - Body: `{ status: 'trash' | 'sorted' | 'inbox' }`

### Files / Scanning
- `POST /api/scan`: Trigger a scan of the configured root directory.
  - Body: `{ path: string }`
- `GET /api/scan/status`: Get current scan progress.

### Sync / Actions
- `POST /api/sync`: Execute physical file operations based on asset status.
  - Returns: `{ moved: int, deleted: int, errors: [] }`

### Thumbnails
- `GET /api/thumb/:hash`: Serve generated thumbnail for an asset.

## 4. Source of Truth Logic (The "Resurrection" Fix)

1. **Importing**:
   - When a file is scanned, calculate Hash.
   - **IF** Hash exists in `assets`:
     - **IF** `assets.status` is 'trash': Mark this new file instance as "pending deletion" (or just show it as trash in UI).
     - **IF** `assets.status` is 'sorted': We know this is a duplicate of a sorted photo.
   - **IF** Hash does NOT exist: Insert into `assets` with status 'inbox'.
   - Always insert/update `files` table mapping `path` -> `hash`.

2. **Deleting**:
   - User clicks "Delete" on an image.
   - Backend updates `assets` set `status = 'trash'` WHERE `hash = ?`.
   - Physical files are NOT touched yet.

3. **Syncing**:
   - Iterate over `assets` where `status = 'trash'`.
   - Find all `files` linked to these hashes.
   - Move these files to `.Trash` folder or delete them.
   - Update `files` table (remove rows or mark missing).

## 5. Technology Stack
- **Backend**: Node.js, Express, better-sqlite3, sharp (image processing), fluent-ffmpeg (video thumbnails - optional phase 1).
- **Frontend**: React, Vite, TailwindCSS, TanStack Query, react-virtual (for grid).

