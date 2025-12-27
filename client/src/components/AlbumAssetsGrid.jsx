import { useInfiniteQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import clsx from 'clsx';
import React, { useEffect, useRef } from 'react';
import { getAlbumAssets } from '../api/client';
import { ThumbPlaceholder } from './ThumbPlaceholder';

function topLabelFromMime(mime) {
  if (!mime) return 'FILE';
  if (mime.startsWith('image/')) return 'IMG';
  if (mime.startsWith('video/')) return 'VID';
  const parts = mime.split('/');
  return (parts[1] || parts[0] || 'FILE').toUpperCase().slice(0, 8);
}

export function AlbumAssetsGrid({ albumId, onAssetClick }) {
  "use no memo";
  const parentRef = useRef(null);

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
              {items.map((asset) => (
                <div
                  key={asset.hash}
                  className={clsx(
                    'flex-1 relative bg-white shadow rounded overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500',
                    asset.status === 'trash' && 'opacity-50 grayscale'
                  )}
                  onClick={() => onAssetClick?.(asset)}
                >
                  <div className="relative w-full h-40 bg-gray-100">
                    <div className="absolute inset-0">
                      <ThumbPlaceholder
                        topLabel={topLabelFromMime(asset.mime_type)}
                        bottomText={asset.hash}
                        dateText={asset.taken_at ? new Date(asset.taken_at).toLocaleDateString() : null}
                      />
                    </div>
                    <img
                      src={`http://localhost:3001/api/assets/${asset.hash}/thumb?v=${asset.thumb_updated_at || asset.updated_at || 0}`}
                      alt={asset.hash}
                      className="relative z-10 w-full h-40 object-cover"
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  </div>
                  <div className="p-2 text-xs truncate">
                    {asset.taken_at ? new Date(asset.taken_at).toLocaleDateString() : '—'}
                  </div>
                </div>
              ))}
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


