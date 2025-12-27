import { useQuery } from '@tanstack/react-query';
import React, { useMemo, useState } from 'react';
import { getAlbums } from '../api/client';
import { AlbumAssetsGrid } from './AlbumAssetsGrid';

export function AlbumsView({ onAssetClick }) {
  const [activeAlbum, setActiveAlbum] = useState(null); // {id,name,...} | null

  const albumsQuery = useQuery({
    queryKey: ['albums'],
    queryFn: () => getAlbums(),
    staleTime: 30_000,
  });

  const albums = useMemo(() => albumsQuery.data?.data || [], [albumsQuery.data]);

  if (activeAlbum) {
    return (
      <div className="h-full w-full bg-gray-100">
        <div className="sticky top-0 z-10 bg-white border-b px-4 py-3 flex items-center justify-between">
          <button
            type="button"
            className="text-sm text-blue-600 hover:underline"
            onClick={() => setActiveAlbum(null)}
          >
            ← 返回
          </button>
          <div className="font-semibold text-gray-900 truncate">{activeAlbum.name}</div>
          <div className="text-xs text-gray-500 tabular-nums">{activeAlbum.count || 0}</div>
        </div>
        <AlbumAssetsGrid albumId={activeAlbum.id} onAssetClick={onAssetClick} />
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-auto bg-gray-100 p-4">
      <div className="text-sm text-gray-600 mb-3">
        文件夹/归档（整理后的集合）
      </div>

      {albumsQuery.isLoading ? (
        <div className="text-sm text-gray-600">加载中…</div>
      ) : albums.length ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {albums.map((al) => {
            const cover = al.cover_hash
              ? `http://localhost:3001/api/assets/${al.cover_hash}/thumb?v=1`
              : null;
            return (
              <button
                key={al.id}
                type="button"
                className="text-left bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden hover:ring-2 hover:ring-blue-500"
                onClick={() => setActiveAlbum(al)}
              >
                <div className="w-full h-32 bg-gray-100">
                  {cover ? (
                    <img
                      src={cover}
                      alt={al.name}
                      className="w-full h-32 object-cover"
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : null}
                </div>
                <div className="p-3">
                  <div className="font-semibold text-gray-900 truncate">{al.name}</div>
                  <div className="text-xs text-gray-500 tabular-nums mt-1">{al.count || 0} 项</div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="text-sm text-gray-600">暂无文件夹。去“全部文件”里选择后“添加到…”即可创建。</div>
      )}
    </div>
  );
}


