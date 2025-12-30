import { useEffect, useMemo, useRef, useState } from 'react';

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
 * - brush mode (hold B): toggle once + paint a fixed target selection state across traversed indices
 * - best-effort resync of cursor index when filters change
 *
 * This keeps App.jsx thin and lets other pages reuse the same navigation patterns later.
 */
export function useFilesGridController({
  active,
  viewerOpen,
  filesQuery,
  columns,
  limit,
  filesGridRef,
  getFiles,
  getAsset,
  setSelectedAsset,
}) {
  const [cursorIndex, setCursorIndex] = useState(null);
  const [cursorFileId, setCursorFileId] = useState(null);
  const [cursorTotal, setCursorTotal] = useState(null);

  const navRequestIdRef = useRef(0);
  const resyncRequestIdRef = useRef(0);
  const lastKnownCursorIndexRef = useRef(null);

  const brushActiveRef = useRef(false);
  const brushTargetSelectedRef = useRef(false);
  const brushAppliedIdsRef = useRef(new Set());
  const brushHintTimerRef = useRef(null);
  const [brushHint, setBrushHint] = useState(null); // { targetSelected: boolean } | null

  const reset = () => {
    setCursorIndex(null);
    setCursorFileId(null);
    setCursorTotal(null);
    lastKnownCursorIndexRef.current = null;

    brushActiveRef.current = false;
    brushAppliedIdsRef.current = new Set();
    setBrushHint(null);
    if (brushHintTimerRef.current) {
      clearTimeout(brushHintTimerRef.current);
      brushHintTimerRef.current = null;
    }
  };

  const applyBrushToFileId = (fileId) => {
    if (!brushActiveRef.current) return;
    const id = Number(fileId);
    if (!Number.isFinite(id)) return;
    if (brushAppliedIdsRef.current.has(id)) return;
    try {
      filesGridRef.current?.setSelected?.(id, !!brushTargetSelectedRef.current);
    } catch {
      // ignore
    }
    brushAppliedIdsRef.current.add(id);
  };

  const applyBrushToIndexPath = async (fromIndex, toIndex, requestId, pageCache) => {
    if (!brushActiveRef.current) return;
    if (!Number.isFinite(fromIndex) || !Number.isFinite(toIndex)) return;
    if (navRequestIdRef.current !== requestId) return;
    if (fromIndex === toIndex) return;

    // Brush all indices crossed by the move, excluding start, including end.
    const lo = Math.min(fromIndex, toIndex) + 1;
    const hi = Math.max(fromIndex, toIndex);
    if (hi < lo) return;

    const indices = [];
    for (let gi = lo; gi <= hi; gi++) {
      if (gi < 0) continue;
      if (Number.isFinite(cursorTotal) && cursorTotal != null && gi >= cursorTotal) continue;
      indices.push(gi);
    }
    if (!indices.length) return;

    const pagesNeeded = Array.from(new Set(indices.map((gi) => Math.floor(gi / limit) + 1)));
    for (const p of pagesNeeded) {
      if (navRequestIdRef.current !== requestId) return;
      if (!pageCache.has(p)) {
        // eslint-disable-next-line no-await-in-loop
        const res = await getFiles(p, limit, filesQuery);
        pageCache.set(p, res);
      }
    }

    for (const gi of indices) {
      if (navRequestIdRef.current !== requestId) return;
      const p = Math.floor(gi / limit) + 1;
      const idx = gi % limit;
      const res = pageCache.get(p);
      const file = res?.data?.[idx];
      if (file?.id != null) applyBrushToFileId(file.id);
    }
  };

  const navigateToIndex = async (nextIndex, { scroll = true, brushFromIndex = null } = {}) => {
    if (!Number.isFinite(nextIndex)) return;
    if (nextIndex < 0) return;
    if (Number.isFinite(cursorTotal) && cursorTotal != null && nextIndex >= cursorTotal) return;

    const requestId = ++navRequestIdRef.current;
    const page = Math.floor(nextIndex / limit) + 1;
    const idx = nextIndex % limit;

    try {
      const res = await getFiles(page, limit, filesQuery);
      const file = res?.data?.[idx];
      if (!file?.hash) return;

      const pageCache = new Map([[page, res]]);
      const asset = await getAsset(file.hash);
      if (navRequestIdRef.current !== requestId) return;

      setCursorIndex(nextIndex);
      setCursorFileId(file.id);
      setSelectedAsset(asset);
      lastKnownCursorIndexRef.current = nextIndex;

      if (Number.isFinite(brushFromIndex)) {
        await applyBrushToIndexPath(brushFromIndex, nextIndex, requestId, pageCache);
      } else {
        applyBrushToFileId(file.id);
      }

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
  };

  // Best-effort resync: when filters change, try to keep cursor index in sync by checking the old page.
  useEffect(() => {
    if (!active) return;
    if (viewerOpen) return;
    if (!Number.isFinite(cursorFileId)) return;
    const baseIndex = Number.isFinite(cursorIndex) ? cursorIndex : lastKnownCursorIndexRef.current;
    if (!Number.isFinite(baseIndex)) return;

    const requestId = ++resyncRequestIdRef.current;
    const page = Math.floor(baseIndex / limit) + 1;

    (async () => {
      try {
        const res = await getFiles(page, limit, filesQuery);
        if (resyncRequestIdRef.current !== requestId) return;
        const arr = res?.data || [];
        const found = arr.findIndex((f) => Number(f?.id) === Number(cursorFileId));
        if (found >= 0) setCursorIndex((page - 1) * limit + found);
        else setCursorIndex(null);
      } catch {
        // ignore
      }
    })();
  }, [active, viewerOpen, filesQuery, cursorFileId, cursorIndex, getFiles, limit]);

  // Brush mode: hold B.
  useEffect(() => {
    if (!active) return;
    if (viewerOpen) return;

    const onKeyDown = (e) => {
      if (e.defaultPrevented) return;
      if (isEditableTarget(document.activeElement)) return;
      if (e.key !== 'b' && e.key !== 'B') return;
      e.preventDefault();
      if (e.repeat) return;

      const fileId = Number(cursorFileId);
      if (!Number.isFinite(fileId)) return;

      const api = filesGridRef.current;
      if (!api?.getIsSelected || !api?.setSelected) return;

      const cur = !!api.getIsSelected(fileId);
      const next = !cur;
      api.setSelected(fileId, next);

      brushActiveRef.current = true;
      brushTargetSelectedRef.current = next;
      brushAppliedIdsRef.current = new Set([fileId]);

      if (brushHintTimerRef.current) {
        clearTimeout(brushHintTimerRef.current);
        brushHintTimerRef.current = null;
      }
      brushHintTimerRef.current = setTimeout(() => {
        brushHintTimerRef.current = null;
        if (!brushActiveRef.current) return;
        setBrushHint({ targetSelected: !!brushTargetSelectedRef.current });
      }, 140);
    };

    const onKeyUp = (e) => {
      if (e.key !== 'b' && e.key !== 'B') return;
      if (!brushActiveRef.current) return;
      brushActiveRef.current = false;
      brushAppliedIdsRef.current = new Set();
      setBrushHint(null);
      if (brushHintTimerRef.current) {
        clearTimeout(brushHintTimerRef.current);
        brushHintTimerRef.current = null;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [active, viewerOpen, cursorFileId, filesGridRef]);

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

      const brushFromIndex = brushActiveRef.current ? cur : null;
      navigateToIndex(next, { brushFromIndex });
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, viewerOpen, cursorIndex, cursorTotal, columns]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMetaChange = (meta) => {
    const total = meta?.total;
    if (Number.isFinite(total)) setCursorTotal(total);
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
  }, [active, cursorIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const viewerNext = useMemo(() => {
    if (!active) return undefined;
    if (!Number.isFinite(cursorIndex)) return undefined;
    return () => navigateToIndex(cursorIndex + 1);
  }, [active, cursorIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    cursorIndex,
    cursorFileId,
    cursorTotal,
    brushHint,
    onMetaChange,
    onFileClick,
    navigateToIndex,
    viewerPrev,
    viewerNext,
    reset,
  };
}


