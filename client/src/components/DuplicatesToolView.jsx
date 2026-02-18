/**
 * input: props + API（duplicates）+ 本地状态
 * output: "检查重复项"工具页（单组聚焦、左右对比、键盘驱动）
 * pos: 客户端视图层：实用工具入口之一（变更需同步更新本头注释与所属目录 README）
 */

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Trash2, Check, Loader2, AlertCircle, Images } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl, applyDuplicateActions, getDuplicateGroups } from '../api/client';
import { Button } from './ui/button';
import { Badge } from './ui/badge';

function fmtBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let x = v;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function fmtDate(ms) {
  const v = Number(ms);
  if (!Number.isFinite(v) || v <= 0) return '—';
  try {
    return new Date(v).toLocaleDateString('zh-CN');
  } catch {
    return '—';
  }
}

export function DuplicatesToolView({ onAssetClick }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState('phash'); // 'phash' | 'hash'
  const [threshold, setThreshold] = useState(10);
  const [groupIndex, setGroupIndex] = useState(0);
  const containerRef = useRef(null);

  // Load all groups at once (similar to immich)
  const { data, isLoading, isError, error } = useInfiniteQuery({
    queryKey: ['duplicates', { kind, threshold }],
    queryFn: ({ pageParam }) => getDuplicateGroups({ kind, threshold, limit: 100, cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    staleTime: 5000,
  });

  const groups = useMemo(() => {
    return data?.pages.flatMap((p) => p.groups || []) || [];
  }, [data]);

  const currentGroup = groups[groupIndex] || null;

  // Selection state: map of file_id -> 'keep' | 'trash'
  const [selections, setSelections] = useState({});

  // Initialize selections when group changes
  useEffect(() => {
    if (!currentGroup) return;
    const items = currentGroup.items || [];
    const suggested = currentGroup.suggested_keep_file_id;
    const init = {};
    items.forEach((item) => {
      const fid = Number(item.file_id);
      // Suggested keep is 'keep', others default to 'trash'
      init[fid] = fid === suggested ? 'keep' : 'trash';
    });
    setSelections(init);
  }, [currentGroup?.id]);

  const applyMutation = useMutation({
    mutationFn: ({ keepFileIds, deleteFileIds }) => applyDuplicateActions({ keepFileIds, deleteFileIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['duplicates'] });
      qc.invalidateQueries({ queryKey: ['files'] });
      qc.invalidateQueries({ queryKey: ['assets'] });
      // Move to next group after successful apply
      if (groupIndex < groups.length - 1) {
        setGroupIndex((i) => i + 1);
      }
    },
  });

  const goPrev = () => setGroupIndex((i) => Math.max(0, i - 1));
  const goNext = () => setGroupIndex((i) => Math.min(groups.length - 1, i + 1));

  const toggleItem = (fileId) => {
    setSelections((prev) => {
      const current = prev[fileId];
      return { ...prev, [fileId]: current === 'keep' ? 'trash' : 'keep' };
    });
  };

  const setAll = (action) => {
    if (!currentGroup) return;
    const next = {};
    currentGroup.items.forEach((item) => {
      next[Number(item.file_id)] = action;
    });
    setSelections(next);
  };

  const applyCurrent = () => {
    if (!currentGroup) return;
    const keepFileIds = [];
    const deleteFileIds = [];
    currentGroup.items.forEach((item) => {
      const fid = Number(item.file_id);
      if (selections[fid] === 'keep') keepFileIds.push(fid);
      else deleteFileIds.push(fid);
    });
    // Ensure at least one kept
    if (keepFileIds.length === 0 && currentGroup.items.length > 0) {
      keepFileIds.push(Number(currentGroup.items[0].file_id));
      deleteFileIds.shift();
    }
    applyMutation.mutate({ keepFileIds, deleteFileIds });
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          goPrev();
          break;
        case 'ArrowRight':
          e.preventDefault();
          goNext();
          break;
        case 'k':
        case 'K':
          e.preventDefault();
          // Keep the first selected or first item
          if (currentGroup?.items[0]) {
            const fid = Number(currentGroup.items[0].file_id);
            setSelections((prev) => ({ ...prev, [fid]: 'keep' }));
          }
          break;
        case 't':
        case 'T':
          e.preventDefault();
          // Trash the second item if exists
          if (currentGroup?.items[1]) {
            const fid = Number(currentGroup.items[1].file_id);
            setSelections((prev) => ({ ...prev, [fid]: 'trash' }));
          }
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          applyCurrent();
          break;
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9': {
          const idx = parseInt(e.key, 10) - 1;
          if (currentGroup?.items[idx]) {
            const fid = Number(currentGroup.items[idx].file_id);
            toggleItem(fid);
          }
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentGroup, groupIndex, groups.length, selections]);

  if (isLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-blue-600" />
          <div className="text-gray-600">加载重复项...</div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-gray-50">
        <div className="text-center text-red-600">
          <AlertCircle className="h-8 w-8 mx-auto mb-4" />
          <div>加载失败: {error?.message || 'Unknown error'}</div>
        </div>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Images className="h-12 w-12 mx-auto mb-4 text-gray-400" />
          <div className="text-gray-600">暂无重复项</div>
          <div className="text-sm text-gray-400 mt-2">{kind === 'phash' ? '尝试调整 pHash 阈值' : '所有文件都是唯一的'}</div>
        </div>
      </div>
    );
  }

  const items = currentGroup?.items || [];
  const progress = `${groupIndex + 1} / ${groups.length}`;

  return (
    <div ref={containerRef} className="h-full w-full bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-gray-900">检查重复项</h1>
          <Badge variant="secondary" className="text-sm">
            {progress}
          </Badge>
          {kind === 'phash' && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span>阈值:</span>
              <input
                type="range"
                min={0}
                max={32}
                value={threshold}
                onChange={(e) => {
                  setThreshold(Number(e.target.value));
                  setGroupIndex(0);
                }}
                className="w-24"
              />
              <span className="w-6 text-right">{threshold}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setGroupIndex(0);
            }}
            className="px-3 py-2 rounded border text-sm bg-white"
          >
            <option value="phash">相似图片 (pHash)</option>
            <option value="hash">完全重复 (Hash)</option>
          </select>

          <div className="w-px h-6 bg-gray-200 mx-2" />

          <Button variant="outline" size="sm" onClick={() => setAll('keep')}>
            <Check className="h-4 w-4 mr-1" />
            全部保留
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAll('trash')}>
            <Trash2 className="h-4 w-4 mr-1" />
            全部删除
          </Button>

          <div className="w-px h-6 bg-gray-200 mx-2" />

          <Button
            onClick={applyCurrent}
            disabled={applyMutation.isPending || !currentGroup}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {applyMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Check className="h-4 w-4 mr-1" />
            )}
            应用
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center p-6 overflow-hidden">
        <div className="flex items-center gap-4 w-full max-w-7xl">
          {/* Prev Button */}
          <button
            onClick={goPrev}
            disabled={groupIndex === 0}
            className="p-3 rounded-full bg-white shadow-md hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>

          {/* Cards */}
          <div className="flex-1 grid grid-cols-2 gap-6 h-[calc(100vh-220px)] min-h-[400px]">
            {items.map((item, idx) => {
              const fid = Number(item.file_id);
              const status = selections[fid] || 'trash';
              const isKeep = status === 'keep';

              return (
                <div
                  key={fid}
                  className={`relative bg-white rounded-xl shadow-sm border-2 overflow-hidden cursor-pointer transition-all ${
                    isKeep ? 'border-green-500 ring-2 ring-green-100' : 'border-red-300'
                  }`}
                  onClick={() => toggleItem(fid)}
                >
                  {/* Header */}
                  <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-3 bg-gradient-to-b from-black/50 to-transparent">
                    <Badge className={isKeep ? 'bg-green-500' : 'bg-red-500'}>
                      {isKeep ? '保留' : '删除'}
                    </Badge>
                    <Badge variant="secondary" className="bg-white/90">
                      #{idx + 1}
                    </Badge>
                  </div>

                  {/* Image */}
                  <div className="h-1/2 bg-gray-100 relative">
                    {item.hash ? (
                      <img
                        src={apiUrl(`/assets/${item.hash}/preview?max=1280&q=80`)}
                        className="w-full h-full object-contain"
                        alt=""
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400">
                        无预览
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-4 space-y-2 h-1/2 overflow-auto">
                    <div className="font-medium text-gray-900 truncate" title={item.file_name}>
                      {item.file_name || '—'}
                    </div>

                    <div className="text-sm text-gray-600 space-y-1">
                      <div className="truncate" title={item.path}>
                        路径: {item.path || '—'}
                      </div>

                      <div className="flex gap-4">
                        <span>大小: {fmtBytes(item.size)}</span>
                        {item.width && item.height && (
                          <span>尺寸: {item.width}×{item.height}</span>
                        )}
                      </div>

                      <div>修改: {fmtDate(item.mtime_ms)}</div>

                      {item.asset_taken_at && (
                        <div>拍摄: {fmtDate(item.asset_taken_at)}</div>
                      )}

                      {item.lat != null && item.lon != null && (
                        <div>位置: {item.lat.toFixed(4)}, {item.lon.toFixed(4)}</div>
                      )}

                      {item.organized_to && (
                        <div className="text-green-600">已归档: {item.organized_to}</div>
                      )}
                    </div>

                    {/* Toggle Button */}
                    <div className="pt-2">
                      <Button
                        size="sm"
                        variant={isKeep ? 'default' : 'outline'}
                        className={`w-full ${isKeep ? 'bg-green-600 hover:bg-green-700' : 'text-red-600 border-red-300 hover:bg-red-50'}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleItem(fid);
                        }}
                      >
                        {isKeep ? (
                          <>
                            <Check className="h-4 w-4 mr-1" /> 保留
                          </>
                        ) : (
                          <>
                            <Trash2 className="h-4 w-4 mr-1" /> 删除
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Next Button */}
          <button
            onClick={goNext}
            disabled={groupIndex >= groups.length - 1}
            className="p-3 rounded-full bg-white shadow-md hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </div>
      </div>

      {/* Footer - Keyboard Shortcuts */}
      <div className="bg-white border-t px-6 py-3 text-xs text-gray-500 flex items-center justify-center gap-6 shrink-0">
        <span>快捷键:</span>
        <span>← → 切换组</span>
        <span>1-9 切换状态</span>
        <span>Enter/Space 应用</span>
        <span>K 保留首个</span>
        <span>T 删除次个</span>
      </div>
    </div>
  );
}
