/**
 * input: props + API 数据 + 本地状态
 * output: 功能/页面组件（React 组件）
 * pos: 客户端视图层：拼装业务交互（变更需同步更新本头注释与所属目录 README）
 */

"use no memo";

import { useInfiniteQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { getAlbumAssets } from '../api/client';
import { GRID_COLUMNS, ROW_HEIGHT_PX } from '../utils/gridLayout';
import { fileNameFromPath, preferredTopLabel } from '../utils/mediaLabel';
import { AssetThumbCard } from './AssetThumbCard';

function isEditableTarget(el) {
  if (!el) return false;
  const tag = String(el.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return !!el.isContentEditable;
}

export function AlbumAssetsGrid({ albumId, onAssetClick, viewerOpen, onViewerNavChange }) {
  "use no memo";
  const parentRef = useRef(null);
  const pendingIndexRef = useRef(null);
  const [cursorIndex, setCursorIndex] = useState(null);
  const [cursorHash, setCursorHash] = useState(null);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['albumAssets', albumId],
    queryFn: ({ pageParam = 1 }) => getAlbumAssets(albumId, pageParam, 50),
    getNextPageParam: (lastPage, pages) => {
      if (pages.length * 50 < lastPage.pagination.total) return pages.length + 1;
      return undefined;
    },
    enabled: !!albumId,
  });

  const allRows = data ? data.pages.flatMap((d) => d.data) : [];

  const COLUMNS = GRID_COLUMNS;
  const count = Math.ceil(allRows.length / COLUMNS);

  const rowVirtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 5,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    const [lastItem] = [...virtualItems].reverse();
    if (!lastItem) return;
    if (lastItem.index >= count - 1 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, fetchNextPage, allRows.length, isFetchingNextPage, count, rowVirtualizer, virtualItems]);

  const selectIndex = (nextIndex, { scroll = true } = {}) => {
    const idx = Number(nextIndex);
    if (!Number.isFinite(idx)) return;
    if (idx < 0) return;
    if (idx >= allRows.length) return;
    const asset = allRows[idx];
    if (!asset?.hash) return;

    setCursorIndex(idx);
    setCursorHash(asset.hash);
    onAssetClick?.(asset);

    if (scroll) {
      try {
        rowVirtualizer.scrollToIndex(Math.floor(idx / COLUMNS), { align: 'center' });
      } catch {
        // ignore
      }
    }
  };

  // Expose viewer prev/next navigation to parent (so AssetViewer can navigate in albums tab).
  useEffect(() => {
    if (typeof onViewerNavChange !== 'function') return;
    if (!albumId) return;
    if (!Number.isFinite(cursorIndex)) {
      onViewerNavChange({ onPrev: undefined, onNext: undefined });
      return;
    }

    const canPrev = cursorIndex > 0;
    const canNext = cursorIndex + 1 < allRows.length || hasNextPage;

    onViewerNavChange({
      onPrev: canPrev ? () => selectIndex(cursorIndex - 1) : undefined,
      onNext: canNext
        ? () => {
            const next = cursorIndex + 1;
            if (next < allRows.length) {
              selectIndex(next);
              return;
            }
            if (hasNextPage && !isFetchingNextPage) {
              pendingIndexRef.current = next;
              fetchNextPage();
            }
          }
        : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumId, cursorIndex, allRows.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Establish an initial cursor target when opening an album grid (so keyboard feels consistent).
  useEffect(() => {
    if (!albumId) return;
    if (viewerOpen) return;
    if (!allRows.length) return;
    if (cursorIndex != null) return;
    selectIndex(0, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumId, allRows.length, viewerOpen]);

  // If keyboard asks to move beyond loaded range, load more and apply when available.
  useEffect(() => {
    const pending = pendingIndexRef.current;
    if (!Number.isFinite(pending)) return;
    if (pending < allRows.length) {
      pendingIndexRef.current = null;
      selectIndex(pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows.length]);

  useEffect(() => {
    if (!albumId) return;
    if (viewerOpen) return;
    if (!Number.isFinite(cursorIndex)) return;

    const onKeyDown = (e) => {
      if (e.defaultPrevented) return;
      if (viewerOpen) return;
      if (isEditableTarget(document.activeElement)) return;

      const key = e.key;
      if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown') return;
      e.preventDefault();

      let delta = 0;
      if (key === 'ArrowLeft') delta = -1;
      if (key === 'ArrowRight') delta = 1;
      if (key === 'ArrowUp') delta = -COLUMNS;
      if (key === 'ArrowDown') delta = COLUMNS;

      const cur = cursorIndex;
      let next = cur + delta;
      if (next < 0) next = 0;

      // If we have more pages, allow navigation into the future by triggering fetch.
      if (next >= allRows.length) {
        if (hasNextPage && !isFetchingNextPage) {
          pendingIndexRef.current = next;
          fetchNextPage();
        }
        return;
      }
      if (next === cur) return;
      selectIndex(next);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [albumId, viewerOpen, cursorIndex, allRows.length, hasNextPage, isFetchingNextPage, fetchNextPage]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={parentRef} className="h-full w-full overflow-auto bg-gray-100 p-4">
      <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const startIndex = virtualRow.index * COLUMNS;
          const items = allRows.slice(startIndex, startIndex + COLUMNS);

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
              {items.map((asset, idx) => {
                const globalIndex = startIndex + idx;
                const cursorFocused = !!cursorHash && asset?.hash === cursorHash;
                return (
                <div
                  key={asset.hash}
                  className={clsx('flex-1')}
                >
                  <AssetThumbCard
                    hash={asset.hash}
                    thumbVersion={asset.thumb_updated_at || asset.updated_at || 0}
                    topLabel={preferredTopLabel({ ext: asset.sample_ext, path: asset.sample_path, mime: asset.mime_type })}
                    placeholderBottomText={asset.sample_path || asset.hash}
                    dateText={asset.taken_at ? new Date(asset.taken_at).toLocaleDateString() : null}
                    dimmed={!!asset.missing}
                    cursorFocused={cursorFocused}
                    onClick={() => {
                      setCursorIndex(globalIndex);
                      setCursorHash(asset.hash);
                      onAssetClick?.(asset);
                    }}
                    bottomPrimary={fileNameFromPath(asset.sample_path) || asset.hash}
                    bottomSecondary={asset.sample_path || null}
                    bottomSecondaryTitle={asset.sample_path || ''}
                    badges={[
                      asset.status === 'trash'
                        ? { key: 'trash', text: '已删除', className: 'top-2 right-2 bg-red-50 text-red-700 border border-red-200' }
                        : null,
                      Number(asset.file_count) > 1
                        ? {
                            key: 'dups',
                            text: `重复×${Number(asset.file_count)}`,
                            className: 'bottom-2 right-2 bg-orange-50 text-orange-700 border border-orange-200',
                          }
                        : null,
                    ]}
                  />
                </div>
              );
              })}
              {Array.from({ length: COLUMNS - items.length }).map((_, i) => (
                <div key={`empty-${i}`} className="flex-1" />
              ))}
            </div>
          );
        })}
      </div>
      {isFetchingNextPage ? <div className="text-center p-4 text-sm text-gray-600">加载更多…</div> : null}
    </div>
  );
}


