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

2. **Start Server**

   ```bash
   cd server
   npm run dev
   # Runs on http://localhost:3001
   ```

3. **Start Client**

   ```bash
   cd client
   npm run dev
   # Runs on http://localhost:5173
   ```

4. **Usage**
   - Open the web interface.
   - Enter a directory path (absolute path on server machine) to scan.
   - Click "Scan". Check server console for progress.
   - Browse photos. Click to view details.
   - Mark photos as "Trash" or "Keep".
   - Click "Sync" to apply changes (moves trash files to `server/data/trash`).

## Database

Data is stored in `server/data/tidy.db`. Thumbnails in `server/data/thumbnails`.
