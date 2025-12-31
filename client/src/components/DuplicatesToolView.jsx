/**
 * input: props + API（duplicates）+ 本地状态
 * output: “检查重复项”工具页（分组处理重复项）
 * pos: 客户端视图层：实用工具入口之一（变更需同步更新本头注释与所属目录 README）
 */

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Eye, Loader2, Trash2 } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { apiUrl, applyDuplicateActions, getDuplicateGroups, getAsset } from '../api/client';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

function fmtBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
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
    return new Date(v).toLocaleDateString();
  } catch {
    return '—';
  }
}

function fmtTime(ms) {
  const v = Number(ms);
  if (!Number.isFinite(v) || v <= 0) return '—';
  try {
    return new Date(v).toLocaleTimeString();
  } catch {
    return '—';
  }
}

function pickDisplayMs(item) {
  return item?.asset_taken_at ?? item?.mtime_ms ?? null;
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function groupByHash(items) {
  const map = new Map();
  for (const it of items || []) {
    const h = it?.hash ? String(it.hash) : null;
    if (!h) continue;
    if (!map.has(h)) map.set(h, []);
    map.get(h).push(it);
  }
  return map;
}

export function DuplicatesToolView({ onAssetClick }) {
  "use no memo";
  const qc = useQueryClient();
  const [kind, setKind] = useState('phash'); // phash | hash
  const [threshold, setThreshold] = useState(10);

  const query = useInfiniteQuery({
    queryKey: ['duplicates', { kind, threshold }],
    queryFn: ({ pageParam }) => getDuplicateGroups({ kind, threshold, limit: 12, cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    staleTime: 5000,
  });

  const groups = useMemo(() => {
    const list = query.data ? query.data.pages.flatMap((p) => p.groups || []) : [];
    return list;
  }, [query.data]);

  // Selection state: keepSet per group id (file_id kept)
  const [keepByGroup, setKeepByGroup] = useState(() => new Map());

  const defaultKeepSet = (items, suggestedKeepFileId) => {
    const list = Array.isArray(items) ? items : [];
    const suggested = suggestedKeepFileId != null ? Number(suggestedKeepFileId) : null;
    const fallback = list[0]?.file_id != null ? Number(list[0].file_id) : null;
    const keep = Number.isFinite(suggested) ? suggested : fallback;
    return keep != null ? new Set([keep]) : new Set();
  };

  const getKeepSet = (gid, items, suggestedKeepFileId) => {
    const key = String(gid);
    return keepByGroup.get(key) || defaultKeepSet(items, suggestedKeepFileId);
  };

  const applyMutation = useMutation({
    mutationFn: ({ keepFileIds, deleteFileIds }) => applyDuplicateActions({ keepFileIds, deleteFileIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['duplicates'] });
      qc.invalidateQueries({ queryKey: ['files'] });
      qc.invalidateQueries({ queryKey: ['assets'] });
      qc.invalidateQueries({ queryKey: ['albums'] });
    },
  });

  const setGroupKeepOnly = (gid, fileId) => {
    setKeepByGroup((prev) => {
      const next = new Map(prev);
      next.set(String(gid), new Set([Number(fileId)]));
      return next;
    });
  };

  const toggleKeep = (gid, fileId, items, suggestedKeepFileId) => {
    const id = Number(fileId);
    if (!Number.isFinite(id)) return;
    setKeepByGroup((prev) => {
      const next = new Map(prev);
      const key = String(gid);
      const base = next.get(key) || defaultKeepSet(items, suggestedKeepFileId);
      const set = new Set(base);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      // Ensure at least one kept if possible
      if (set.size === 0) set.add(id);
      next.set(key, set);
      return next;
    });
  };

  const toggleHashAll = (gid, hash, items, suggestedKeepFileId) => {
    const h = String(hash || '');
    if (!h) return;
    const ids = items.filter((it) => String(it?.hash || '') === h).map((it) => Number(it.file_id)).filter(Number.isFinite);
    if (!ids.length) return;

    setKeepByGroup((prev) => {
      const next = new Map(prev);
      const key = String(gid);
      const base = next.get(key) || defaultKeepSet(items, suggestedKeepFileId);
      const set = new Set(base);
      const allKept = ids.every((id) => set.has(id));
      if (allKept) {
        // Mark all as delete => remove from keep set
        ids.forEach((id) => set.delete(id));
      } else {
        // Keep all
        ids.forEach((id) => set.add(id));
      }
      // Ensure at least one kept overall
      if (set.size === 0 && ids.length) set.add(ids[0]);
      next.set(key, set);
      return next;
    });
  };

  const applyGroup = async (g) => {
    const gid = String(g.id);
    const items = Array.isArray(g.items) ? g.items : [];
    const keepSet = getKeepSet(gid, items, g.suggested_keep_file_id);
    const keepFileIds = [];
    const deleteFileIds = [];
    for (const it of items) {
      const fid = Number(it.file_id);
      if (!Number.isFinite(fid)) continue;
      if (keepSet.has(fid)) keepFileIds.push(fid);
      else deleteFileIds.push(fid);
    }
    await applyMutation.mutateAsync({ keepFileIds, deleteFileIds });
    // Remove applied group locally to keep UI responsive.
    setKeepByGroup((prev) => {
      const next = new Map(prev);
      next.delete(gid);
      return next;
    });
  };

  const canLoadMore = !!query.hasNextPage && !query.isFetchingNextPage;

  return (
    <div className="h-full w-full overflow-auto bg-gray-100 p-4">
      <div className="max-w-6xl space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xl font-bold text-gray-900">检查重复项</div>
            <div className="text-sm text-gray-600 mt-1">
              以物理文件为主操作：默认保留 1 个，其它删除副本；当同一 hash 的所有实例都被选中删除时，将升级为删除该 asset（保留最后一份到回收站）。
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <Select value={kind} onValueChange={(v) => setKind(v)}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="模式" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="phash">相似度</SelectItem>
                <SelectItem value="hash">同 hash</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2 rounded-md border bg-white px-3 py-2">
              <div className="text-xs text-gray-600">阈值</div>
              <input
                type="range"
                min={0}
                max={32}
                value={threshold}
                disabled={kind !== 'phash'}
                onChange={(e) => setThreshold(Number(e.target.value) || 0)}
              />
              <div className="text-xs font-semibold tabular-nums text-gray-900 w-6 text-right">{threshold}</div>
            </div>
          </div>
        </div>

        {query.isLoading ? (
          <div className="rounded-lg border bg-white p-4 text-sm text-gray-700 flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载中…
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-lg border bg-white p-4 text-sm text-gray-700">
            暂无重复项（或 pHash 仍在补算中）。
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => {
              const gid = String(g.id);
              const items = Array.isArray(g.items) ? g.items : [];
              const keepSet = getKeepSet(gid, items, g.suggested_keep_file_id);
              const byHash = groupByHash(items);
              const hashKeys = uniq(Array.from(byHash.keys()));

              return (
                <div key={gid} className="rounded-xl border bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gray-900">
                        组 {gid} <span className="ml-2 text-xs text-gray-500">({items.length} 项)</span>
                        {kind === 'phash' ? (
                          <span className="ml-2 text-xs text-gray-500">pHash ≤ {Number(g.threshold ?? threshold)}</span>
                        ) : null}
                      </div>
                      {hashKeys.length ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {hashKeys.slice(0, 12).map((h) => {
                            const ids = (byHash.get(h) || []).map((it) => Number(it.file_id)).filter(Number.isFinite);
                            const allKept = ids.length ? ids.every((id) => keepSet.has(id)) : false;
                            const allDeleted = ids.length ? ids.every((id) => !keepSet.has(id)) : false;
                            const state = allKept ? 'keep' : (allDeleted ? 'delete' : 'mixed');
                            return (
                              <button
                                key={h}
                                type="button"
                                onClick={() => toggleHashAll(gid, h, items, g.suggested_keep_file_id)}
                                className={`text-[11px] px-2 py-1 rounded border font-mono ${
                                  state === 'keep'
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : state === 'delete'
                                      ? 'bg-red-50 text-red-700 border-red-200'
                                      : 'bg-gray-50 text-gray-700 border-gray-200'
                                }`}
                                title="点击：切换该 hash 的全选/全不选"
                              >
                                {h.slice(0, 8)}… {state === 'keep' ? '保留' : (state === 'delete' ? '删除' : '混合')}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>

                    <div className="shrink-0 flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          // keep all
                          const ids = items.map((it) => Number(it.file_id)).filter(Number.isFinite);
                          setKeepByGroup((prev) => {
                            const next = new Map(prev);
                            next.set(gid, new Set(ids));
                            return next;
                          });
                        }}
                      >
                        <Check className="mr-2 h-4 w-4" />
                        全部保留
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const suggested = g.suggested_keep_file_id != null ? Number(g.suggested_keep_file_id) : null;
                          const fallback = items[0]?.file_id != null ? Number(items[0].file_id) : null;
                          const keep = Number.isFinite(suggested) ? suggested : fallback;
                          if (keep == null) return;
                          setGroupKeepOnly(gid, keep);
                        }}
                        title="仅保留推荐项，其它删除副本"
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        仅保留推荐
                      </Button>
                      <Button
                        disabled={applyMutation.isPending}
                        onClick={() => applyGroup(g)}
                        title="应用当前选择"
                      >
                        {applyMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                        应用
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4 overflow-x-auto">
                    <div className="flex gap-3 min-w-max">
                      {items.map((it) => {
                        const fid = Number(it.file_id);
                        const keep = keepSet.has(fid);
                        const ms = pickDisplayMs(it);
                        const previewHash = it?.hash ? String(it.hash) : null;
                        const canPreview = !!previewHash;
                        return (
                          <button
                            key={fid}
                            type="button"
                            className={`w-72 shrink-0 rounded-xl border overflow-hidden text-left transition ${
                              keep ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'
                            }`}
                            onClick={() => toggleKeep(gid, fid, items, g.suggested_keep_file_id)}
                            title={keep ? '点击：标记为删除副本' : '点击：标记为保留'}
                          >
                            <div className="relative h-44 bg-gray-100">
                              {canPreview ? (
                                <>
                                  <img
                                    src={apiUrl(`/assets/${previewHash}/preview?max=720&q=80`)}
                                    className="absolute inset-0 h-full w-full object-cover"
                                    alt=""
                                    loading="lazy"
                                  />
                                  <button
                                    type="button"
                                    className="absolute top-2 left-2 z-20 rounded-md bg-white/90 border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-800"
                                    onClick={async (e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      if (!previewHash) return;
                                      const full = await getAsset(previewHash);
                                      onAssetClick?.(full);
                                    }}
                                    title="放大查看（复用查看器）"
                                  >
                                    <span className="inline-flex items-center gap-1">
                                      <Eye className="h-3 w-3" />
                                      查看
                                    </span>
                                  </button>
                                </>
                              ) : (
                                <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500">—</div>
                              )}

                              <div className={`absolute top-2 right-2 z-20 px-2 py-1 rounded-md text-[11px] font-semibold border ${
                                keep ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-red-600 text-white border-red-600'
                              }`}>
                                {keep ? '保留' : '删除'}
                              </div>
                            </div>

                            <div className="p-3 space-y-1 text-[12px] text-gray-800">
                              <div className="font-semibold truncate" title={it.file_name || ''}>{it.file_name || '—'}</div>
                              <div className="font-mono text-[11px] text-gray-600 break-all line-clamp-2" title={it.path || ''}>
                                {it.path || '—'}
                              </div>
                              <div className="text-[11px] text-gray-600 flex items-center justify-between gap-2">
                                <div>{fmtBytes(it.size)}</div>
                                <div>{it.width && it.height ? `${it.width}×${it.height}` : '—'}</div>
                              </div>
                              <div className="text-[11px] text-gray-600 flex items-center justify-between gap-2">
                                <div>{fmtDate(ms)}</div>
                                <div className="tabular-nums">{fmtTime(ms)}</div>
                              </div>
                              <div className="text-[11px] text-gray-600 flex items-center justify-between gap-2">
                                <div>{(it.lat != null && it.lon != null) ? '有定位' : '—'}</div>
                                <div className="truncate">{it.organized_to || '—'}</div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="flex items-center justify-center">
              <Button variant="outline" disabled={!canLoadMore} onClick={() => query.fetchNextPage()}>
                {query.isFetchingNextPage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                加载更多
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


