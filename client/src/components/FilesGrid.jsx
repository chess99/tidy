import { useQueries, useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import clsx from 'clsx';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getFiles, getFilesDateIndex } from '../api/client';
import { ThumbPlaceholder } from './ThumbPlaceholder';

export function FilesGrid({ onFileClick, filter = 'all' }) {
  "use no memo";
  const parentRef = useRef(null);
  const overlayRef = useRef(null);
  const LIMIT = 50;
  const COLUMNS = 4;

  // Always fetch page 1 to learn total and confirm applied filter.
  const page1 = useQuery({
    queryKey: ['files', filter, 1],
    queryFn: () => getFiles(1, LIMIT, { filter }),
  });

  const total = page1.data?.pagination?.total ?? 0;
  const appliedFilter = page1.data?.applied?.filter ?? null;
  const rowCount = total > 0 ? Math.ceil(total / COLUMNS) : 0;

  const rowVirtualizer = useVirtualizer({
    count: rowCount || 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200,
    overscan: 5,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const rangeNow = useMemo(() => {
    if (!virtualRows.length) return null;
    return {
      minRow: virtualRows[0].index,
      maxRow: virtualRows[virtualRows.length - 1].index,
    };
  }, [virtualRows]);
  const [range, setRange] = useState(null);
  const throttleLastRef = useRef(0);
  const throttleTimerRef = useRef(null);
  const throttlePendingRef = useRef(null);
  const topIndex = useMemo(() => {
    if (!total || virtualRows.length === 0) return 0;
    return Math.min(total, (virtualRows[0].index * COLUMNS) + 1);
  }, [total, virtualRows, COLUMNS]);

  const [scrolling, setScrolling] = useState(false);
  const [stickyDateDay, setStickyDateDay] = useState('—');
  const [showJump, setShowJump] = useState(false);

  const monthIndex = useQuery({
    queryKey: ['filesDateIndex', filter, 'month'],
    queryFn: () => getFilesDateIndex(filter, 'month'),
    staleTime: 10 * 60_000,
  });

  const monthPoints = useMemo(() => monthIndex.data?.points || [], [monthIndex.data]);

  const monthFromIndex = useMemo(() => {
    if (!monthPoints.length || !topIndex) return null;
    const idx0 = topIndex - 1; // 0-based

    // points are in list order; `start` is increasing. We want the greatest start <= idx0.
    let lo = 0;
    let hi = monthPoints.length - 1;
    let ans = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const s = monthPoints[mid].start;
      if (s <= idx0) {
        ans = monthPoints[mid];
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    // Fallback: if everything is > idx0 (shouldn't happen), pick last.
    return ans?.key || monthPoints[monthPoints.length - 1]?.key || null;
  }, [monthPoints, topIndex]);

  // Overlay date rule:
  // - if day is known from loaded data -> show day (YYYY-MM-DD)
  // - otherwise fallback to month index (YYYY-MM)
  const overlayDateText = stickyDateDay !== '—' ? stickyDateDay : (monthFromIndex || '—');

  // Close month jump popover on outside click / escape.
  useEffect(() => {
    if (!showJump) return;
    const onDown = (e) => {
      if (!overlayRef.current) return;
      if (!overlayRef.current.contains(e.target)) setShowJump(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setShowJump(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [showJump]);

  // Throttle viewport range updates while scrolling to avoid spamming queries during scrollbar drag.
  useEffect(() => {
    if (!rangeNow) return;
    throttlePendingRef.current = rangeNow;

    // When not actively scrolling, update immediately to keep things responsive.
    if (!scrolling) {
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      throttleLastRef.current = Date.now();
      setRange(rangeNow);
      return;
    }

    const THROTTLE_MS = 120;
    const now = Date.now();
    const since = now - throttleLastRef.current;

    if (since >= THROTTLE_MS) {
      throttleLastRef.current = now;
      setRange(rangeNow);
      return;
    }

    if (!throttleTimerRef.current) {
      throttleTimerRef.current = setTimeout(() => {
        throttleTimerRef.current = null;
        throttleLastRef.current = Date.now();
        setRange(throttlePendingRef.current);
      }, THROTTLE_MS - since);
    }
  }, [rangeNow, scrolling]);

  // Determine which pages are needed to fill the viewport (random access).
  const neededPages = useMemo(() => {
    const r = range || rangeNow;
    if (!total || !r) return [1];

    const minRow = r.minRow ?? 0;
    const maxRow = r.maxRow ?? 0;
    const startItem = Math.max(0, minRow * COLUMNS);
    const endItem = Math.min(total - 1, (maxRow + 1) * COLUMNS - 1);

    const p1 = Math.floor(startItem / LIMIT) + 1;
    const p2 = Math.floor(endItem / LIMIT) + 1;

    const pages = [];
    const pageOverscan = scrolling ? 0 : 1;
    for (let p = Math.max(1, p1 - pageOverscan); p <= p2 + pageOverscan; p++) pages.push(p);
    return Array.from(new Set(pages));
  }, [total, range, rangeNow, COLUMNS, LIMIT, scrolling]);

  const pageQueries = useQueries({
    queries: neededPages.map((p) => ({
      queryKey: ['files', filter, p],
      queryFn: () => getFiles(p, LIMIT, { filter }),
      enabled: !!total && p >= 1,
      staleTime: 30_000,
    })),
  });

  const pageDataByPage = useMemo(() => {
    const m = new Map();
    // Include page1 even if not in neededPages yet.
    if (page1.data?.data) m.set(1, page1.data.data);
    for (let i = 0; i < neededPages.length; i++) {
      const p = neededPages[i];
      const q = pageQueries[i];
      if (q?.data?.data) m.set(p, q.data.data);
    }
    return m;
  }, [page1.data, pageQueries, neededPages]);

  const getItemAt = (globalIndex) => {
    if (!total || globalIndex < 0 || globalIndex >= total) return null;
    const page = Math.floor(globalIndex / LIMIT) + 1;
    const idx = globalIndex % LIMIT;
    const arr = pageDataByPage.get(page);
    return arr?.[idx] || null;
  };

  const anyLoadingViewport = useMemo(() => {
    if (page1.isLoading) return true;
    return pageQueries.some((q) => q.isFetching || q.isLoading);
  }, [page1.isLoading, pageQueries]);

  // loadedCount/loadedPct intentionally removed: jump-loading is viewport-driven and doesn't need a global progress bar.

  // Update sticky date based on top-most loaded item in the viewport.
  useEffect(() => {
    if (!total || virtualRows.length === 0) return;
    const minRow = virtualRows[0]?.index ?? 0;
    const startItem = Math.max(0, minRow * COLUMNS);
    const endItem = Math.min(total - 1, startItem + LIMIT); // search a bit downward

    for (let i = startItem; i <= endItem; i++) {
      const it = getItemAt(i);
      if (it?.display_time) {
        const d = new Date(it.display_time);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        setStickyDateDay(`${y}-${m}-${day}`);
        return;
      }
    }
    setStickyDateDay('—');
  }, [total, virtualRows, pageDataByPage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Detect active scrolling (used to throttle query recalculation while dragging).
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    let t = null;
    const onScroll = () => {
      setScrolling(true);
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        setScrolling(false);
      }, 250);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (t) clearTimeout(t);
    };
  }, []);

  const filterLabel = useMemo(() => {
    if (filter === 'media') return '全部图片/视频';
    if (filter === 'camera') return '相机照片/视频';
    return '全部文件';
  }, [filter]);

  return (
    <div ref={parentRef} className="h-full w-full overflow-auto bg-gray-100 p-4">
      <div className="sticky top-2 z-40 pointer-events-none">
        <div ref={overlayRef} className="relative inline-block pointer-events-auto">
          <button
            type="button"
            onClick={() => setShowJump((v) => !v)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/90 border border-gray-200 shadow-sm backdrop-blur hover:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            title="点击跳转到某月"
          >
            <div className="text-sm font-semibold text-gray-900 tabular-nums w-[92px]">{overlayDateText || '—'}</div>
            <div className="text-xs text-gray-600">
              {filterLabel}
              {appliedFilter && appliedFilter !== filter ? (
                <span className="ml-2 text-red-600">(服务端: {String(appliedFilter)})</span>
              ) : null}
            </div>
            {total ? <div className="text-xs text-gray-700 tabular-nums">{topIndex} / {total}</div> : null}
            <div
              className={clsx(
                'w-2 h-2 rounded-full border border-blue-300 transition-opacity',
                (scrolling || anyLoadingViewport || monthIndex.isFetching) ? 'bg-blue-500 opacity-100 animate-pulse' : 'bg-blue-500 opacity-0'
              )}
            />
          </button>

          {showJump ? (
            <div
              className="absolute left-0 mt-2 w-56 max-h-80 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-3 py-2 text-xs text-gray-500 border-b border-gray-100">
                选择月份跳转
              </div>
              {monthIndex.isLoading ? (
                <div className="px-3 py-3 text-sm text-gray-600">加载中…</div>
              ) : monthPoints.length ? (
                <div className="py-1">
                  {monthPoints.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between"
                      onClick={() => {
                        const targetRow = Math.floor((p.start || 0) / COLUMNS);
                        rowVirtualizer.scrollToIndex(targetRow, { align: 'start' });
                        setShowJump(false);
                      }}
                    >
                      <span className="tabular-nums">{p.key}</span>
                      <span className="text-xs text-gray-400 tabular-nums">#{p.start}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="px-3 py-3 text-sm text-gray-600">暂无数据</div>
              )}
            </div>
          ) : null}
        </div>
      </div>
      <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const startIndex = virtualRow.index * COLUMNS;
          const items = Array.from({ length: COLUMNS }).map((_, i) => getItemAt(startIndex + i));

          return (
            <div
              key={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className="flex gap-4"
            >
              {items.map((file, idx) => {
                const isPlaceholder = !file;
                const name = isPlaceholder ? '—' : (file.file_name || file.path);
                const dateText = !isPlaceholder && file.display_time ? new Date(file.display_time).toLocaleDateString() : null;
                const hasHash = !!file?.hash;
                const thumbV = file ? (file.asset_thumb_updated_at || file.asset_updated_at || 0) : 0;

                return (
                  <div
                    key={file?.id || `ph-${virtualRow.index}-${idx}`}
                    className={clsx(
                      'flex-1 relative bg-white shadow rounded overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500',
                      isPlaceholder ? 'cursor-default hover:ring-0 opacity-80' : null,
                      file?.missing ? 'opacity-50 grayscale' : null
                    )}
                    onClick={() => (isPlaceholder ? null : onFileClick?.(file))}
                  >
                    <div className="relative w-full h-40 bg-gray-100">
                      <div className="absolute inset-0">
                        <ThumbPlaceholder
                          topLabel={isPlaceholder ? 'FILE' : ((file.ext || '').replace('.', '').toUpperCase() || 'FILE')}
                          bottomText={name}
                          dateText={dateText}
                        />
                      </div>
                      {hasHash ? (
                        <img
                          src={`http://localhost:3001/api/assets/${file.hash}/thumb?v=${thumbV}`}
                          alt={file.hash}
                          className="relative z-10 w-full h-40 object-cover"
                          loading="lazy"
                          onError={(e) => {
                            // Hide broken thumb and fall back to placeholder.
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      ) : null}
                    </div>

                    <div className="p-2 text-xs truncate flex items-center justify-between gap-2">
                      <span className="truncate">{dateText || '—'}</span>
                      {!isPlaceholder && !hasHash ? (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">
                          哈希中
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* no infinite paging footer; viewport-driven page queries handle loading */}
    </div>
  );
}


