# Video Poster FFmpeg UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make video thumbnails/posters work when ffmpeg is installed, and show a platform-appropriate, non-intrusive fallback when it is missing.

**Architecture:** Keep poster generation in `server/src/routes/assets.js`; fix command execution and test the route. Share client fallback copy through a small React helper so grid/detail/viewer use the same platform-aware ffmpeg hint without overlapping preview controls.

**Tech Stack:** Express, Jest/Supertest, React, Tailwind, lucide-react, ffmpeg.

---

### Task 1: Poster Route Regression

**Files:**
- Modify: `server/src/routes/__tests__/file-workflows.test.js`
- Modify: `server/src/routes/assets.js`

- [ ] **Step 1: Write the failing test**
Add a route test that mocks `findSystemCommand('ffmpeg')` to return an executable path and mocks `child_process.execFile` to write the poster output file. Request `GET /api/assets/:hash/poster` for a seeded video asset and expect a `200` JPEG response.

- [ ] **Step 2: Run test to verify it fails**
Run: `cd server && npm test -- --runTestsByPath src/routes/__tests__/file-workflows.test.js --runInBand`
Expected before the fix: FAIL because `execFile` is not defined in `assets.js`.

- [ ] **Step 3: Write minimal implementation**
Import `execFile` from `child_process` in `server/src/routes/assets.js`.

- [ ] **Step 4: Run test to verify it passes**
Run the same Jest command. Expected after the fix: PASS.

### Task 2: Shared FFmpeg Fallback UI

**Files:**
- Create: `client/src/components/VideoPosterFallback.jsx`
- Modify: `client/src/components/AssetDetail.jsx`
- Modify: `client/src/components/AssetViewer.jsx`
- Modify: `client/src/components/AssetThumbCard.jsx`

- [ ] **Step 1: Implement platform-aware hint helper**
Create a compact component that displays a neutral video placeholder and shows Windows/macOS/Linux install commands based on `navigator.platform` when a poster fails.

- [ ] **Step 2: Use the helper in detail and viewer**
For videos, load `/poster` instead of `/preview` in detail preview. Keep the play button and hover action from competing in the same center area; use "播放视频" for video hover text.

- [ ] **Step 3: Use the helper in thumbnail cards**
When a video poster image fails, hide the broken image and let the shared placeholder remain visible with the relevant hint.

### Task 3: Verify and Commit

**Files:**
- All files changed above.

- [ ] **Step 1: Run targeted tests**
Run: `cd server && npm test -- --runTestsByPath src/routes/__tests__/file-workflows.test.js --runInBand`

- [ ] **Step 2: Run client build**
Run: `cd client && npm run build`

- [ ] **Step 3: Stage only this change**
Run: `git add docs/superpowers/plans/2026-07-01-video-poster-ffmpeg-ui.md server/src/routes/__tests__/file-workflows.test.js server/src/routes/assets.js client/src/components/VideoPosterFallback.jsx client/src/components/AssetDetail.jsx client/src/components/AssetViewer.jsx client/src/components/AssetThumbCard.jsx`
Then run `git diff --staged` and confirm it contains only these changes.

- [ ] **Step 4: Commit**
Run: `git commit -m "fix: improve video poster fallback"`
