import React, { useRef, useEffect, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useInfiniteQuery } from '@tanstack/react-query';
import { getAssets } from '../api/client';
import clsx from 'clsx';

export function VirtualGrid({ onAssetClick }) {
  const parentRef = useRef(null);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['assets'],
    queryFn: ({ pageParam = 1 }) => getAssets(pageParam, 50),
    getNextPageParam: (lastPage, pages) => {
      if (pages.length * 50 < lastPage.pagination.total) {
        return pages.length + 1;
      }
      return undefined;
    },
  });

  const allRows = data ? data.pages.flatMap((d) => d.data) : [];

  // 4 columns
  const COLUMNS = 4;
  const count = Math.ceil(allRows.length / COLUMNS);

  const rowVirtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200, // Approximate row height
    overscan: 5,
  });

  useEffect(() => {
    const [lastItem] = [...rowVirtualizer.getVirtualItems()].reverse();
    if (!lastItem) return;

    if (
      lastItem.index >= count - 1 &&
      hasNextPage &&
      !isFetchingNextPage
    ) {
      fetchNextPage();
    }
  }, [
    hasNextPage,
    fetchNextPage,
    allRows.length,
    isFetchingNextPage,
    rowVirtualizer.getVirtualItems(),
  ]);

  return (
    <div
      ref={parentRef}
      className="h-full w-full overflow-auto bg-gray-100 p-4"
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
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
              {items.map((asset) => (
                <div 
                  key={asset.hash} 
                  className={clsx(
                    "flex-1 relative bg-white shadow rounded overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500",
                    asset.status === 'trash' && "opacity-50 grayscale"
                  )}
                  onClick={() => onAssetClick(asset)}
                >
                  <img
                    src={`http://localhost:3001/api/assets/${asset.hash}/thumb`}
                    alt={asset.hash}
                    className="w-full h-40 object-cover"
                    loading="lazy"
                  />
                  <div className="p-2 text-xs truncate">
                    {new Date(asset.taken_at).toLocaleDateString()}
                  </div>
                </div>
              ))}
              {/* Fill empty space if last row has fewer items */}
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

