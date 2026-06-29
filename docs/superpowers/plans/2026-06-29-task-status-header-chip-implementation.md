# Task Status Header Chip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the lightweight task status from a content-area floating toast into the global header as a compact chip with a details popover.

**Architecture:** Rework `MinimalScanStatus` into a reusable header chip that owns job querying, status aggregation, and popover rendering. Move its render site from the content area to the header right tool group, where it sits before the tools and system-management entries. Add a focused static regression test that prevents the old absolute top-right overlay from returning.

**Tech Stack:** React 19, TanStack Query, Radix Popover wrapper, lucide-react, Tailwind CSS, Node.js test script.

---

### Task 1: Add Regression Test

**Files:**
- Create: `client/scripts/check-task-status-header-chip.mjs`
- Modify: `client/package.json`

- [ ] **Step 1: Write the failing test**

Create a Node.js script that reads `client/src/App.jsx` and `client/src/components/MinimalScanStatus.jsx`, then asserts:

- `MinimalScanStatus` is rendered inside the header before the tools popover.
- It is no longer rendered from the content area.
- The component no longer contains `absolute top-4 right-4`.
- The component uses `Popover` for task details.

- [ ] **Step 2: Wire the script**

Add `"test:task-status-ui": "node scripts/check-task-status-header-chip.mjs"` to `client/package.json`.

- [ ] **Step 3: Verify red**

Run `npm run test:task-status-ui` in `client`.

Expected: FAIL, because the current implementation still renders the task status inside the content area and uses `absolute top-4 right-4`.

### Task 2: Implement Header Chip

**Files:**
- Modify: `client/src/components/MinimalScanStatus.jsx`
- Modify: `client/src/App.jsx`

- [ ] **Step 1: Replace floating UI**

Make `MinimalScanStatus` render a compact button-style chip with Popover details. It should support running, queued, failed, and interrupted states.

- [ ] **Step 2: Move render site**

Place `<MinimalScanStatus />` in the header right tool group before the tools popover and remove the content-area render.

- [ ] **Step 3: Preserve navigation**

Add an optional `onOpenTasks` prop so the popover's “查看任务队列” action switches to system management.

### Task 3: Verify

**Files:**
- Validate: `client/scripts/check-task-status-header-chip.mjs`
- Validate: `client/src/components/MinimalScanStatus.jsx`
- Validate: `client/src/App.jsx`

- [ ] **Step 1: Run focused regression test**

Run `npm run test:task-status-ui` in `client`.

Expected: PASS.

- [ ] **Step 2: Run frontend build**

Run `npm run build` in `client`.

Expected: PASS.

- [ ] **Step 3: Inspect staged diff**

Stage only the implementation and test files, then run `git diff --staged` to confirm no unrelated files are included.

- [ ] **Step 4: Commit**

Commit with `Implement task status header chip`.
