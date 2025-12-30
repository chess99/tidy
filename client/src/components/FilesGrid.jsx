import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import clsx from 'clsx';
import { Check, ChevronsUpDown } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { apiUrl, createAlbum, getAlbums, getFiles, getFilesBatch, getFilesDateIndex, organizeAssets, updateAssetsStatusBatch } from '../api/client';
import { GRID_COLUMNS, ROW_HEIGHT_PX } from '../utils/gridLayout';
import { AssetThumbCard } from './AssetThumbCard';
import { SelectedDrawer } from './SelectedDrawer';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './ui/command';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

export const FilesGrid = forwardRef(function FilesGrid({ onFileClick, queryOpts, cursorFileId, onMetaChange, brushHint }, ref) {
  "use no memo";
  const parentRef = useRef(null);
  const overlayRef = useRef(null);
  const qc = useQueryClient();
  const LIMIT = 50;
  const COLUMNS = GRID_COLUMNS;
  const SELECT_ALL_LIMIT = 500;

  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const selectedIdsRef = useRef(selectedIds);
  const [showSelected, setShowSelected] = useState(false);
  const [showSelectAllTooLarge, setShowSelectAllTooLarge] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addAlbumId, setAddAlbumId] = useState('');
  const [newAlbumName, setNewAlbumName] = useState('');
  const [albumQuery, setAlbumQuery] = useState('');
  const [albumOpen, setAlbumOpen] = useState(false);

  // Query options are owned by parent (left sidebar). Keep a stable object for query keys.
  const filesQueryOpts = useMemo(() => {
    const o = { ...(queryOpts || {}) };
    if (!o.filter) o.filter = 'all';
    return o;
  }, [queryOpts]);

  const filter = filesQueryOpts.filter || 'all';

  // Always fetch page 1 to learn total and confirm applied filter.
  const page1 = useQuery({
    queryKey: ['files', filesQueryOpts, 1],
    queryFn: () => getFiles(1, LIMIT, filesQueryOpts),
  });

  const total = page1.data?.pagination?.total ?? 0;
  const appliedFilter = page1.data?.applied?.filter ?? null;
  const rowCount = total > 0 ? Math.ceil(total / COLUMNS) : 0;

  const rowVirtualizer = useVirtualizer({
    count: rowCount || 0,
    getScrollElement: () => parentRef.current,
    // Keep a stable row height; we show two lines of path text under the thumbnail.
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 5,
  });

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex: (globalIndex) => {
        if (!Number.isFinite(globalIndex)) return;
        const rowIndex = Math.floor(globalIndex / COLUMNS);
        rowVirtualizer.scrollToIndex(rowIndex, { align: 'center' });
      },
      getIsSelected: (fileId) => {
        const id = Number(fileId);
        if (!Number.isFinite(id)) return false;
        return !!selectedIdsRef.current?.has?.(id);
      },
      setSelected: (fileId, nextBool) => {
        const id = Number(fileId);
        if (!Number.isFinite(id)) return;
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (nextBool) next.add(id);
          else next.delete(id);
          return next;
        });
      },
      toggleSelected: (fileId) => {
        const id = Number(fileId);
        if (!Number.isFinite(id)) return;
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      },
    }),
    [rowVirtualizer, COLUMNS]
  );

  useEffect(() => {
    onMetaChange?.({ total, columns: COLUMNS, limit: LIMIT });
  }, [onMetaChange, total, COLUMNS, LIMIT]);

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
    queryKey: ['filesDateIndex', filesQueryOpts, 'month'],
    queryFn: () => getFilesDateIndex(filter, 'month', filesQueryOpts),
    staleTime: 10 * 60_000,
  });

  const albumsQuery = useQuery({
    queryKey: ['albums'],
    queryFn: () => getAlbums(),
    staleTime: 30_000,
  });

  const filteredAlbums = useMemo(() => {
    const list = albumsQuery.data?.data || [];
    const q = albumQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((a) => String(a?.name || '').toLowerCase().includes(q));
  }, [albumsQuery.data, albumQuery]);

  const selectedAlbum = useMemo(() => {
    if (!addAlbumId) return null;
    const list = albumsQuery.data?.data || [];
    return list.find((a) => String(a.id) === String(addAlbumId)) || null;
  }, [albumsQuery.data, addAlbumId]);

  const organizeMutation = useMutation({
    mutationFn: (payload) => organizeAssets(payload),
    onSuccess: () => {
      try {
        setSelectedIds(new Set());
        setShowAdd(false);
        setAddAlbumId('');
        setNewAlbumName('');
      } catch {
        // ignore
      }
      qc.invalidateQueries({ queryKey: ['files'] });
      qc.invalidateQueries({ queryKey: ['albums'] });
      qc.invalidateQueries({ queryKey: ['assets'] });
    },
  });

  const createAlbumMutation = useMutation({
    mutationFn: (name) => createAlbum(name),
    onSuccess: (res) => {
      const id = res?.data?.id;
      if (id != null) setAddAlbumId(String(id));
      qc.invalidateQueries({ queryKey: ['albums'] });
    },
  });

  const batchTrashMutation = useMutation({
    mutationFn: ({ hashes }) => updateAssetsStatusBatch(hashes, 'trash'),
    onSuccess: () => {
      try {
        setSelectedIds(new Set());
      } catch {
        // ignore
      }
      qc.invalidateQueries({ queryKey: ['files'] });
      qc.invalidateQueries({ queryKey: ['assets'] });
    },
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

    const totalPages = Math.max(1, Math.ceil(total / LIMIT));
    const minRow = r.minRow ?? 0;
    const maxRow = r.maxRow ?? 0;
    const startItem = Math.max(0, minRow * COLUMNS);
    const endItem = Math.min(total - 1, (maxRow + 1) * COLUMNS - 1);

    const p1 = Math.floor(startItem / LIMIT) + 1;
    const p2 = Math.floor(endItem / LIMIT) + 1;

    const pages = [];
    const pageOverscan = scrolling ? 0 : 1;
    const lo = Math.max(1, p1 - pageOverscan);
    const hi = Math.min(totalPages, p2 + pageOverscan);
    for (let p = lo; p <= hi; p++) pages.push(p);
    return Array.from(new Set(pages));
  }, [total, range, rangeNow, COLUMNS, LIMIT, scrolling]);

  const pageQueries = useQueries({
    queries: neededPages.map((p) => ({
      queryKey: ['files', filesQueryOpts, p],
      queryFn: () => getFiles(p, LIMIT, filesQueryOpts),
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

  const selectedCount = selectedIds.size;
  const selectedIdsArr = useMemo(() => Array.from(selectedIds), [selectedIds]);
  const selectedIdsKey = useMemo(() => selectedIdsArr.slice().sort((a, b) => a - b).join(','), [selectedIdsArr]);

  const selectedFiles = useQuery({
    queryKey: ['filesSelected', selectedIdsKey],
    queryFn: () => getFilesBatch(selectedIdsArr),
    enabled: selectedCount > 0,
    staleTime: 5_000,
  });

  const selectedHashes = useMemo(() => {
    const rows = selectedFiles.data?.data || [];
    const set = new Set();
    for (const r of rows) {
      if (r?.hash) set.add(r.hash);
    }
    return Array.from(set);
  }, [selectedFiles.data]);

  const canOrganize = selectedHashes.length > 0 && !organizeMutation.isPending;

  const canSelectAll = total > 0 && total <= SELECT_ALL_LIMIT;

  const fetchAllFilteredIds = async () => {
    if (!total) return [];
    const pages = Math.ceil(total / LIMIT);
    const ids = [];
    for (let p = 1; p <= pages; p++) {
      const res = await qc.fetchQuery({
        queryKey: ['files', filesQueryOpts, p],
        queryFn: () => getFiles(p, LIMIT, filesQueryOpts),
        staleTime: 30_000,
      });
      for (const row of res?.data || []) ids.push(row.id);
      if (ids.length >= total) break;
    }
    return ids.slice(0, total);
  };

  const onSelectAll = async () => {
    if (!total) return;
    if (!canSelectAll) {
      setShowSelectAllTooLarge(true);
      return;
    }
    const ids = await fetchAllFilteredIds();
    setSelectedIds(new Set(ids));
  };

  const onInvertAll = async () => {
    if (!total) return;
    if (!canSelectAll) {
      setShowSelectAllTooLarge(true);
      return;
    }
    const ids = await fetchAllFilteredIds();
    setSelectedIds((prev) => {
      const next = new Set();
      for (const id of ids) {
        if (!prev.has(id)) next.add(id);
      }
      return next;
    });
  };

  const onClearSelection = () => setSelectedIds(new Set());

  const submitOrganize = async () => {
    if (!canOrganize) return;
    const albumIdNum = addAlbumId ? Number(addAlbumId) : null;
    if (albumIdNum && Number.isFinite(albumIdNum)) {
      organizeMutation.mutate({ hashes: selectedHashes, albumId: albumIdNum });
      return;
    }
    const name = String(newAlbumName || '').trim();
    if (!name) return;
    organizeMutation.mutate({ hashes: selectedHashes, albumName: name });
  };

  return (
    <div ref={parentRef} className="h-full w-full overflow-auto bg-gray-100 p-4">
      <div className="sticky top-2 z-40 pointer-events-none">
        <div ref={overlayRef} className="relative inline-flex items-start gap-2 pointer-events-auto">
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

          {brushHint ? (
            <div
              className={clsx(
                'absolute left-0 top-full mt-2 px-3 py-2 rounded-lg border shadow-sm backdrop-blur pointer-events-none',
                'text-xs font-semibold',
                brushHint.targetSelected
                  ? 'bg-emerald-50/90 text-emerald-700 border-emerald-200'
                  : 'bg-orange-50/90 text-orange-700 border-orange-200'
              )}
            >
              刷子模式：{brushHint.targetSelected ? '批量选中' : '批量取消'}（按住 B + 方向键）
            </div>
          ) : null}

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
              className="flex gap-4 items-start"
            >
              {items.map((file, idx) => {
                const globalIndex = startIndex + idx;
                // Don't render placeholders beyond the known total; keep layout stable without fake FILE tiles.
                if (globalIndex >= total) {
                  return <div key={`empty-${virtualRow.index}-${idx}`} className="flex-1" />;
                }
                const isPlaceholder = !file;
                const name = isPlaceholder ? '—' : (file.file_name || file.path);
                const dateText = !isPlaceholder && file.display_time ? new Date(file.display_time).toLocaleDateString() : null;
                const thumbV = file ? (file.asset_thumb_updated_at || file.asset_updated_at || 0) : 0;
                const isSelected = !isPlaceholder && selectedIds.has(file.id);
                const organizedTo = !isPlaceholder ? (file.organized_to || null) : null;
                const dupCount = !isPlaceholder ? (Number(file.dup_count) || 0) : 0;
                const isVideo = !isPlaceholder && String(file.asset_mime_type || file.mime_guess || '').toLowerCase().startsWith('video/');
                const overrideImageUrl = isVideo && file?.hash ? apiUrl(`/assets/${file.hash}/poster?w=640&q=4`) : null;
                const cursorFocused = !isPlaceholder && Number.isFinite(cursorFileId) && Number(file?.id) === Number(cursorFileId);

                return (
                  <AssetThumbCard
                    key={file?.id || `ph-${virtualRow.index}-${idx}`}
                    isPlaceholder={isPlaceholder}
                    hash={file?.hash}
                    thumbVersion={thumbV}
                    imageUrl={overrideImageUrl}
                    topLabel={isPlaceholder ? 'FILE' : ((file.ext || '').replace('.', '').toUpperCase() || 'FILE')}
                    placeholderBottomText={name}
                    dateText={dateText}
                    dimmed={!!file?.missing}
                    selected={isSelected}
                    cursorFocused={cursorFocused}
                    onClick={() => onFileClick?.(file, globalIndex)}
                    onToggleSelected={
                      isPlaceholder
                        ? undefined
                        : () => {
                            // If user is interacting with this card, also move cursor focus here
                            // (so keyboard navigation continues from the last-touched item).
                            onFileClick?.(file, globalIndex);
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(file.id)) next.delete(file.id);
                              else next.add(file.id);
                              return next;
                            });
                          }
                    }
                    badges={[
                      !isPlaceholder && organizedTo
                        ? {
                            key: 'organized',
                            text: '已整理',
                            className: 'top-2 right-2 bg-green-50 text-green-700 border border-green-200',
                          }
                        : null,
                      !isPlaceholder && dupCount > 1
                        ? {
                            key: 'dups',
                            text: `重复×${dupCount}`,
                            className: 'bottom-2 right-2 bg-orange-50 text-orange-700 border border-orange-200',
                          }
                        : null,
                    ]}
                    bottomPrimary={file?.file_name || '—'}
                    bottomContent={
                      !isPlaceholder ? (
                        organizedTo ? (
                          <div className="text-[11px] leading-4">
                            <div className="text-green-700 truncate" title={organizedTo}>→ {organizedTo}</div>
                            <div className="text-gray-600 truncate" title={file.path}>{file.path}</div>
                          </div>
                        ) : (
                          <div
                            className="text-[11px] text-gray-600 leading-4"
                            title={file.path}
                            style={{
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {file.path}
                          </div>
                        )
                      ) : null
                    }
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      {/* no infinite paging footer; viewport-driven page queries handle loading */}

      {/* Selection action bar (persistent) */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 pointer-events-auto">
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/95 border border-gray-200 shadow-lg backdrop-blur">
            <div className="text-xs text-gray-500 tabular-nums">
              筛选结果 {total}
            </div>

            <div className="w-px h-6 bg-gray-200" />

            {/* Selection ops */}
            <button
              type="button"
              className="px-3 py-2 rounded-lg bg-white text-gray-800 border border-gray-200 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
              onClick={onSelectAll}
              disabled={!total}
              title={canSelectAll ? '全选当前筛选结果' : `结果过多（>${SELECT_ALL_LIMIT}）请进一步筛选`}
            >
              全选
            </button>
            <button
              type="button"
              className="px-3 py-2 rounded-lg bg-white text-gray-800 border border-gray-200 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
              onClick={onInvertAll}
              disabled={!total}
              title={canSelectAll ? '反选当前筛选结果' : `结果过多（>${SELECT_ALL_LIMIT}）请进一步筛选`}
            >
              反选
            </button>
            <button
              type="button"
              className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
              onClick={onClearSelection}
              disabled={!selectedCount}
              title={!selectedCount ? '暂无选中' : '清空所有选中'}
            >
              清空选择
            </button>

            <div className="w-px h-6 bg-gray-200" />

            {/* Review */}
            <button
              type="button"
              className="px-3 py-2 rounded-lg bg-gray-100 text-gray-800 text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
              onClick={() => setShowSelected(true)}
              disabled={!selectedCount}
              title={!selectedCount ? '暂无选中' : '查看已选中项'}
            >
              已选中 <span className="font-semibold tabular-nums">{selectedCount}</span>
            </button>

            <div className="w-px h-6 bg-gray-200" />

            <button
              type="button"
              className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              onClick={() => setShowAdd(true)}
              disabled={!selectedHashes.length}
              title={!selectedHashes.length ? '所选文件尚未完成哈希，暂不可整理' : '添加到文件夹'}
            >
              添加到…
            </button>
            <button
              type="button"
              className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              disabled={!selectedHashes.length || batchTrashMutation.isPending}
              onClick={() => {
                if (!selectedHashes.length) return;
                const ok = window.confirm(`确定将所选内容移入工具 Trash 吗？\n同一 hash 的所有物理副本都会被移动。`);
                if (!ok) return;
                batchTrashMutation.mutate({ hashes: selectedHashes });
              }}
              title={!selectedHashes.length ? '所选文件尚未完成哈希，暂不可删除' : '批量删除(入Trash)'}
            >
              删除
            </button>
        </div>
      </div>

      <SelectedDrawer
        open={showSelected}
        onOpenChange={setShowSelected}
        selectedIds={selectedIdsArr}
        onClear={onClearSelection}
        onRemoveId={(id) =>
          setSelectedIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          })
        }
        onItemClick={(file) => {
          setShowSelected(false);
          onFileClick?.(file);
        }}
      />

      <Dialog open={showSelectAllTooLarge} onOpenChange={setShowSelectAllTooLarge}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>结果过多，无法一键全选</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground leading-6">
            当前筛选结果共有 <span className="font-semibold tabular-nums">{total}</span> 项，超过全选上限
            <span className="font-semibold tabular-nums"> {SELECT_ALL_LIMIT}</span>。
            <div className="mt-2">建议进一步收窄筛选（例如增加后缀/日期/路径），再执行全选。</div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add-to dialog */}
      {showAdd ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onMouseDown={() => setShowAdd(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl bg-white shadow-xl border border-gray-200"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="font-semibold text-gray-900">添加到文件夹</div>
              <button
                type="button"
                className="text-sm text-gray-500 hover:text-gray-900"
                onClick={() => setShowAdd(false)}
              >
                关闭
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="text-xs text-gray-500">
                将按内容哈希归档：同一 hash 只保留一份，其余副本将移动到工具 Trash。
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium text-gray-800">选择已有文件夹</div>
                <Popover open={albumOpen} onOpenChange={setAlbumOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="w-full flex items-center justify-between border rounded px-3 py-2 text-sm bg-white hover:bg-gray-50"
                      title="输入关键词过滤并选择"
                    >
                      <span className="truncate">
                        {selectedAlbum ? `${selectedAlbum.name} (${selectedAlbum.count || 0})` : '（不选）'}
                      </span>
                      <ChevronsUpDown className="h-4 w-4 opacity-60" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[420px] p-0" align="start">
                    <Command>
                      <CommandInput
                        value={albumQuery}
                        onValueChange={setAlbumQuery}
                        placeholder="输入名称关键词过滤…"
                      />
                      <CommandList>
                        <CommandEmpty>无匹配文件夹</CommandEmpty>
                        <CommandGroup>
                          <CommandItem
                            value="(none)"
                            onSelect={() => {
                              setAddAlbumId('');
                              setAlbumOpen(false);
                              setAlbumQuery('');
                            }}
                          >
                            <Check className={clsx("h-4 w-4", !addAlbumId ? "opacity-100" : "opacity-0")} />
                            （不选）
                          </CommandItem>
                          {filteredAlbums.map((al) => (
                            <CommandItem
                              key={al.id}
                              value={al.name}
                              onSelect={() => {
                                setAddAlbumId(String(al.id));
                                setAlbumOpen(false);
                              }}
                            >
                              <Check className={clsx("h-4 w-4", String(addAlbumId) === String(al.id) ? "opacity-100" : "opacity-0")} />
                              <span className="truncate">{al.name}</span>
                              <span className="ml-auto text-xs text-gray-500 tabular-nums">{al.count || 0}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium text-gray-800">或新建文件夹</div>
                <div className="flex gap-2">
                  <input
                    value={newAlbumName}
                    onChange={(e) => setNewAlbumName(e.target.value)}
                    className="flex-1 border rounded px-3 py-2 text-sm"
                    placeholder="例如：20251213-Trip"
                  />
                  <button
                    type="button"
                    className="px-3 py-2 rounded bg-gray-100 text-gray-700 text-sm hover:bg-gray-200 disabled:opacity-50"
                    disabled={!newAlbumName.trim() || createAlbumMutation.isPending}
                    onClick={() => createAlbumMutation.mutate(newAlbumName.trim())}
                    title="先创建，方便选择"
                  >
                    创建
                  </button>
                </div>
              </div>

              {organizeMutation.isPending ? (
                <div className="text-sm text-blue-600">整理中…</div>
              ) : null}
              {organizeMutation.isError ? (
                <div className="text-sm text-red-600">整理失败，请查看服务端日志</div>
              ) : null}

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="px-3 py-2 rounded bg-gray-100 text-gray-700 text-sm hover:bg-gray-200"
                  onClick={() => setShowAdd(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="px-4 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                  disabled={!canOrganize || (!addAlbumId && !newAlbumName.trim())}
                  onClick={submitOrganize}
                >
                  确认添加
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
});


