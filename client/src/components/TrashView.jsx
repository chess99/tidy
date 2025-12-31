/**
 * input: props + API（assets?status=trash）+ 本地状态
 * output: 回收站视图（分页/虚拟化列表 + 点击查看详情）
 * pos: 客户端视图层：用于展示被删除内容（变更需同步更新本头注释与所属目录 README）
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl, getAsset, getAssets } from '../api/client';
import { AssetThumbCard } from './AssetThumbCard';

function formatDate(ms) {
  if (!Number.isFinite(Number(ms))) return '—';
  try {
    return new Date(Number(ms)).toLocaleDateString();
  } catch {
    return '—';
  }
}

export function TrashView({ onAssetClick }) {
  "use no memo";
  const parentRef = useRef(null);
  const [loadingHash, setLoadingHash] = useState(null);

  const query = useInfiniteQuery({
    queryKey: ['assets', { status: 'trash' }],
    queryFn: ({ pageParam = 1 }) => getAssets(pageParam, 50, { status: 'trash' }),
    getNextPageParam: (lastPage, pages) => {
      const total = lastPage?.pagination?.total ?? 0;
      if (pages.length * 50 < total) return pages.length + 1;
      return undefined;
    },
  });

  const all = useMemo(() => (query.data ? query.data.pages.flatMap((p) => p.data || []) : []), [query.data]);
  const hasNextPage = !!query.hasNextPage;
  const isFetchingNextPage = !!query.isFetchingNextPage;
  const fetchNextPage = query.fetchNextPage;

  const COLUMNS = 4;
  const rowCount = Math.ceil(all.length / COLUMNS);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 220,
    overscan: 6,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    const [lastItem] = [...virtualItems].reverse();
    if (!lastItem) return;
    if (lastItem.index >= rowCount - 1 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [virtualItems, rowCount, hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div ref={parentRef} className="h-full w-full overflow-auto bg-gray-100 p-4">
      <div className="text-sm text-gray-600 mb-3">
        回收站（仅展示被标记为 trash 的内容；磁盘留底在工具目录 <span className="font-mono text-xs">_Tidy/_Trash</span>）
      </div>

      {query.isLoading ? (
        <div className="text-sm text-gray-600">加载中…</div>
      ) : all.length === 0 ? (
        <div className="text-sm text-gray-600">回收站为空。</div>
      ) : (
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const start = virtualRow.index * COLUMNS;
            const items = all.slice(start, start + COLUMNS);
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
                {items.map((asset) => {
                  const hash = asset?.hash;
                  const disabled = !hash || loadingHash === hash;
                  return (
                    <AssetThumbCard
                      key={hash}
                      hash={hash}
                      thumbVersion={asset?.thumb_updated_at || asset?.updated_at || 0}
                      topLabel="TRASH"
                      placeholderBottomText={hash || '—'}
                      dateText={formatDate(asset?.taken_at)}
                      dimmed={false}
                      bottomPrimary={hash || '—'}
                      bottomSecondary={asset?.target_path || '—'}
                      bottomSecondaryTitle={asset?.target_path || ''}
                      badges={[
                        {
                          key: 'trash',
                          text: '已删除',
                          className: 'top-2 right-2 bg-red-50 text-red-700 border border-red-200',
                        },
                      ]}
                      bottomContent={
                        <div className="text-[11px] text-gray-600 leading-4">
                          {asset?.target_path ? (
                            <a
                              className="underline underline-offset-2"
                              href={apiUrl(`/assets/${hash}/raw`)}
                              onClick={(e) => e.stopPropagation()}
                              title="下载/打开原文件"
                            >
                              打开文件
                            </a>
                          ) : (
                            '—'
                          )}
                        </div>
                      }
                      onClick={async () => {
                        if (disabled) return;
                        setLoadingHash(hash);
                        try {
                          const full = await getAsset(hash);
                          onAssetClick?.(full);
                        } finally {
                          setLoadingHash(null);
                        }
                      }}
                    />
                  );
                })}
                {Array.from({ length: COLUMNS - items.length }).map((_, i) => (
                  <div key={`empty-${i}`} className="flex-1" />
                ))}
              </div>
            );
          })}
        </div>
      )}

      {query.isFetchingNextPage ? <div className="text-center p-4 text-sm text-gray-600">加载更多…</div> : null}
    </div>
  );
}


