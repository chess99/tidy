import { useInfiniteQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import clsx from 'clsx';
import React, { useEffect, useRef } from 'react';
import { getFiles } from '../api/client';
import { ThumbPlaceholder } from './ThumbPlaceholder';

export function FilesGrid({ onFileClick }) {
  const parentRef = useRef(null);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['files'],
    queryFn: ({ pageParam = 1 }) => getFiles(pageParam, 50),
    getNextPageParam: (lastPage, pages) => {
      if (pages.length * 50 < lastPage.pagination.total) return pages.length + 1;
      return undefined;
    },
  });

  const allRows = data ? data.pages.flatMap((d) => d.data) : [];

  const COLUMNS = 4;
  const count = Math.ceil(allRows.length / COLUMNS);

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

    if (lastItem.index >= count - 1 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, fetchNextPage, allRows.length, isFetchingNextPage, count, rowVirtualizer, virtualItems]);

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
              className="flex gap-4"
            >
              {items.map((file) => {
                const name = file.file_name || file.path;
                const dateText = file.display_time ? new Date(file.display_time).toLocaleDateString() : null;
                const hasHash = !!file.hash;
                const thumbV = file.asset_thumb_updated_at || file.asset_updated_at || 0;

                return (
                  <div
                    key={file.id}
                    className={clsx(
                      'flex-1 relative bg-white shadow rounded overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500',
                      file.missing ? 'opacity-50 grayscale' : null
                    )}
                    onClick={() => onFileClick?.(file)}
                  >
                    <div className="relative w-full h-40 bg-gray-100">
                      <div className="absolute inset-0">
                        <ThumbPlaceholder
                          topLabel={(file.ext || '').replace('.', '').toUpperCase() || 'FILE'}
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
                      {!hasHash ? (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">
                          哈希中
                        </span>
                      ) : null}
                    </div>
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

      {isFetchingNextPage && <div className="text-center p-4">Loading more...</div>}
    </div>
  );
}


