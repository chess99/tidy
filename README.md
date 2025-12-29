# Tidy Photo Organizer

A tool to scan, organize, and deduplicate photos using Content-Addressable Storage principles.

## Features

- **Scan**: Recursively scans directories, computes hashes, and extracts metadata.
- **Deduplicate**: Identifies duplicates by content (hash), regardless of filename.
- **Resurrection Proof**: Deleted assets stay marked as "trash" in the DB, so if you re-import them, they are automatically flagged.
- **Virtual Grid**: Browses thousands of photos efficiently.

## Architecture

- **Server**: Node.js + Express + SQLite + Sharp (Image Processing).
- **Client**: React + Vite + TailwindCSS + TanStack Query.

## 文档

- `docs/README.md`

## Setup & Run

### Prerequisites

- Node.js (v18+)

### Steps

1. **Install Dependencies**

   ```bash
   # Server
   cd server
   npm install

   # Client
   cd ../client
   npm install
   ```

2. **(Face Search) Install native TFJS + setup models**

   Face detection uses `@tensorflow/tfjs-node` and requires model files under `server/models/`.
   These model files are **NOT committed to git**.

   ```bash
   cd server
   # If your network needs a proxy, use: HTTPS_PROXY=http://127.0.0.1:7897 npm i
   npm install
   npm run models:setup
   ```

3. **Start Server**

   ```bash
   cd server
   npm run dev
   # Runs on http://localhost:3001
   ```

4. **Start Client**

   ```bash
   cd client
   npm run dev
   # Runs on http://localhost:5173
   ```

5. **Usage**
   - Open the web interface.
   - Go to **“配置&扫描”**:
     - Add an **absolute path** as a scan root and set it active.
     - Click **“开始扫描（当前目录）”**.
   - Browse photos. Click to view details.
   - Mark photos as "Trash" or "Keep".
   - Click "Sync" to apply changes (moves trash files to `server/data/trash`).

## Database

Data is stored in `server/data/tidy.db`. Thumbnails in `server/data/thumbnails`.

## Config (cross-platform)

The server reads base paths from env/defaults, and scan roots from a persisted JSON file:

- `WORK_ROOT`: default scan root fallback (default: `~/Pictures`)
- `DATA_DIR`: server-local data dir (default: `server/data`)
- `DB_PATH`: default: `${DATA_DIR}/tidy.db`
- `THUMB_DIR`: default: `${DATA_DIR}/thumbnails`
- `config.json`: `${DATA_DIR}/config.json`
  - `scanRoots: string[]`
  - `activeScanRoot: string | null`

## Clear records for a directory (DB only)

In **“配置&扫描”** you can clear DB records for a directory prefix:

- It deletes rows in SQLite (`files` and related orphan `assets`/links), **does not delete disk files**.
- Use **dry-run** first to see the estimated counts.
