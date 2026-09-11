import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_GRID_COLUMNS } from '../utils/gridLayout';

function isEditableTarget(el) {
  if (!el) return false;
  const tag = String(el.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return !!el.isContentEditable;
}

/**
 * Controller for Files tab:
 * - cursor focus (by file.id)
 * - keyboard navigation (grid semantics)
 * - best-effort resync of cursor index when filters change
 *
 * This keeps App.jsx thin and lets other pages reuse the same navigation patterns later.
 */
export function useFilesGridController({
  active,
  viewerOpen,
  filesQuery,
  limit,
  filesGridRef,
  getFiles,
  getAsset,
  setSelectedAsset,
}) {
  const qc = useQueryClient();
  const [cursorIndex, setCursorIndex] = useState(null);
  const [cursorFileId, setCursorFileId] = useState(null);
  const [cursorTotal, setCursorTotal] = useState(null);
  const [columns, setColumns] = useState(DEFAULT_GRID_COLUMNS);

  const navRequestIdRef = useRef(0);
  const resyncRequestIdRef = useRef(0);
  const lastKnownCursorIndexRef = useRef(null);
  const cursorIndexRef = useRef(cursorIndex);
  const cursorFileIdRef = useRef(cursorFileId);

  const filesQueryKey = useMemo(() => {
    const o = { ...(filesQuery || {}) };
    if (!o.filter) o.filter = 'all';
    return o;
  }, [filesQuery]);

  const getFilesCached = useCallback(async (page, pageSize) => {
    const key = ['files', filesQueryKey, page];
    const cached = qc.getQueryData(key);
    if (cached?.data) return cached;
    return await getFiles(page, pageSize, filesQueryKey);
  }, [filesQueryKey, getFiles, qc]);

  const reset = () => {
    setCursorIndex(null);
    setCursorFileId(null);
    setCursorTotal(null);
    lastKnownCursorIndexRef.current = null;
  };

  const navigateToIndex = useCallback(async (nextIndex, { scroll = true } = {}) => {
    if (!Number.isFinite(nextIndex)) return;
    if (nextIndex < 0) return;
    if (Number.isFinite(cursorTotal) && cursorTotal != null && nextIndex >= cursorTotal) return;

    const requestId = ++navRequestIdRef.current;
    const page = Math.floor(nextIndex / limit) + 1;
    const idx = nextIndex % limit;

    try {
      const res = await getFilesCached(page, limit);
      const file = res?.data?.[idx];
      if (!file?.hash) return;

      const asset = await getAsset(file.hash);
      if (navRequestIdRef.current !== requestId) return;

      setCursorIndex(nextIndex);
      setCursorFileId(file.id);
      setSelectedAsset(asset);
      lastKnownCursorIndexRef.current = nextIndex;

      if (scroll) {
        try {
          filesGridRef.current?.scrollToIndex?.(nextIndex);
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }, [cursorTotal, filesGridRef, getAsset, getFilesCached, limit, setSelectedAsset]);

  useEffect(() => {
    cursorIndexRef.current = cursorIndex;
  }, [cursorIndex]);

  useEffect(() => {
    cursorFileIdRef.current = cursorFileId;
  }, [cursorFileId]);

  // Best-effort resync: when filters change, try to keep cursor index in sync by checking the old page.
  useEffect(() => {
    if (!active) return;
    if (viewerOpen) return;
    const fileId = cursorFileIdRef.current;
    if (!Number.isFinite(fileId)) return;
    const curIndex = cursorIndexRef.current;
    const baseIndex = Number.isFinite(curIndex) ? curIndex : lastKnownCursorIndexRef.current;
    if (!Number.isFinite(baseIndex)) return;

    const requestId = ++resyncRequestIdRef.current;
    const page = Math.floor(baseIndex / limit) + 1;

    (async () => {
      try {
        const res = await getFilesCached(page, limit);
        if (resyncRequestIdRef.current !== requestId) return;
        const arr = res?.data || [];
        const found = arr.findIndex((f) => Number(f?.id) === Number(fileId));
        if (found >= 0) setCursorIndex((page - 1) * limit + found);
        else setCursorIndex(null);
      } catch {
        // ignore
      }
    })();
  }, [active, viewerOpen, filesQueryKey, getFilesCached, limit]);

  // Arrow key navigation.
  useEffect(() => {
    if (!active) return;
    if (viewerOpen) return;
    if (!Number.isFinite(cursorIndex)) return;

    const onKeyDown = (e) => {
      if (e.defaultPrevented) return;
      if (isEditableTarget(document.activeElement)) return;

      const key = e.key;
      if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown') return;
      e.preventDefault();

      let delta = 0;
      if (key === 'ArrowLeft') delta = -1;
      if (key === 'ArrowRight') delta = 1;
      if (key === 'ArrowUp') delta = -columns;
      if (key === 'ArrowDown') delta = columns;

      const cur = cursorIndex;
      let next = cur + delta;
      if (next < 0) next = 0;
      if (Number.isFinite(cursorTotal) && cursorTotal != null) next = Math.min(next, Math.max(0, cursorTotal - 1));
      if (next === cur) return;

      navigateToIndex(next);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, viewerOpen, cursorIndex, cursorTotal, columns]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMetaChange = (meta) => {
    const total = meta?.total;
    if (Number.isFinite(total)) setCursorTotal(total);
    const nextColumns = Number(meta?.columns);
    if (Number.isInteger(nextColumns) && nextColumns > 0) setColumns(nextColumns);
  };

  const onFileClick = async (file, globalIndex) => {
    if (!file?.hash) return;
    if (Number.isFinite(globalIndex)) setCursorIndex(globalIndex);
    setCursorFileId(file.id);
    lastKnownCursorIndexRef.current = Number.isFinite(globalIndex) ? globalIndex : lastKnownCursorIndexRef.current;
    try {
      const asset = await getAsset(file.hash);
      setSelectedAsset(asset);
    } catch {
      // ignore
    }
  };

  const viewerPrev = useMemo(() => {
    if (!active) return undefined;
    if (!Number.isFinite(cursorIndex)) return undefined;
    return () => navigateToIndex(cursorIndex - 1);
  }, [active, cursorIndex, navigateToIndex]);

  const viewerNext = useMemo(() => {
    if (!active) return undefined;
    if (!Number.isFinite(cursorIndex)) return undefined;
    return () => navigateToIndex(cursorIndex + 1);
  }, [active, cursorIndex, navigateToIndex]);

  return {
    cursorIndex,
    cursorFileId,
    cursorTotal,
    onMetaChange,
    onFileClick,
    navigateToIndex,
    viewerPrev,
    viewerNext,
    reset,
  };
}
