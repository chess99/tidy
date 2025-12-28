"use no memo";

import { useInfiniteQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import clsx from 'clsx';
import { useEffect, useRef } from 'react';
import { getAlbumAssets } from '../api/client';
import { GRID_COLUMNS, ROW_HEIGHT_PX } from '../utils/gridLayout';
import { fileNameFromPath, preferredTopLabel } from '../utils/mediaLabel';
import { AssetThumbCard } from './AssetThumbCard';

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
              {items.map((asset) => (
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
                    dimmed={asset.status === 'trash'}
                    onClick={() => onAssetClick?.(asset)}
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


