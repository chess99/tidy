import { useInfiniteQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import clsx from 'clsx';
import React, { useEffect, useMemo, useRef } from 'react';
import { getFiles } from '../api/client';
import { ThumbPlaceholder } from './ThumbPlaceholder';

export function FilesGrid({ onFileClick, filter = 'all', view = 'tile' }) {
  "use no memo";
  const parentRef = useRef(null);
  const LIMIT = 50;

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['files', { filter }],
    queryFn: ({ pageParam = 1 }) => getFiles(pageParam, LIMIT, { filter }),
    getNextPageParam: (lastPage, pages) => {
      if (pages.length * LIMIT < lastPage.pagination.total) return pages.length + 1;
      return undefined;
    },
  });

  const allRows = data ? data.pages.flatMap((d) => d.data) : [];
  const total = data?.pages?.[0]?.pagination?.total ?? 0;

  const COLUMNS = 4;
  const count = total > 0 ? Math.ceil(total / COLUMNS) : Math.ceil(allRows.length / COLUMNS);

  const rowVirtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200,
    overscan: 5,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    const [lastItem] = [...virtualItems].reverse();
    if (!lastItem) return;

    if (!total || !hasNextPage || isFetchingNextPage) return;

    // Prefetch until we have data to cover current viewport.
    const wantItemIndex = Math.min(total - 1, (lastItem.index + 1) * COLUMNS - 1);
    const wantPage = Math.floor(wantItemIndex / LIMIT) + 1;
    const havePages = data?.pages?.length || 0;
    if (wantPage > havePages) fetchNextPage();
  }, [total, hasNextPage, fetchNextPage, isFetchingNextPage, count, virtualItems, data?.pages?.length]);

  const loadedPct = useMemo(() => {
    if (!total) return 0;
    return Math.max(0, Math.min(1, allRows.length / total));
  }, [allRows.length, total]);

  return (
    <div ref={parentRef} className="h-full w-full overflow-auto bg-gray-100 p-4">
      {total ? (
        <div className="sticky top-0 z-30 bg-gray-100/90 backdrop-blur border border-gray-200 rounded px-3 py-2 mb-3">
          <div className="flex items-center justify-between text-xs text-gray-700">
            <span>已加载 {allRows.length} / {total}</span>
            {isFetchingNextPage ? <span className="text-gray-500">加载中…</span> : null}
          </div>
          <div className="mt-2 h-1.5 rounded bg-gray-200 overflow-hidden">
            <div className="h-full bg-blue-500" style={{ width: `${Math.round(loadedPct * 100)}%` }} />
          </div>
        </div>
      ) : null}
      <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const startIndex = virtualRow.index * COLUMNS;
          const items = Array.from({ length: COLUMNS }).map((_, i) => allRows[startIndex + i] || null);

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
                const globalIndex = startIndex + idx;
                const isPlaceholder = !file;
                const name = isPlaceholder ? '—' : (file.file_name || file.path);
                const dateText = !isPlaceholder && file.display_time ? new Date(file.display_time).toLocaleDateString() : null;
                const hasHash = !!file?.hash;
                const thumbV = file ? (file.asset_thumb_updated_at || file.asset_updated_at || 0) : 0;
                const prev = globalIndex > 0 ? allRows[globalIndex - 1] : null;
                const prevDateText = prev?.display_time ? new Date(prev.display_time).toLocaleDateString() : null;
                const showDateBadge =
                  view === 'byDateSimple' &&
                  !!dateText &&
                  (globalIndex === 0 || (!!prevDateText && dateText !== prevDateText));

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
                      {showDateBadge ? (
                        <div className="absolute z-20 top-2 left-2 text-[11px] px-2 py-0.5 rounded bg-white/90 border border-gray-200 text-gray-700 shadow-sm">
                          {dateText}
                        </div>
                      ) : null}
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

      {isFetchingNextPage && <div className="text-center p-4">Loading more...</div>}
    </div>
  );
}


