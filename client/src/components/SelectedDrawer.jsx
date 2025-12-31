/**
 * input: props + API 数据 + 本地状态
 * output: 功能/页面组件（React 组件）
 * pos: 客户端视图层：拼装业务交互（变更需同步更新本头注释与所属目录 README）
 */

import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { getFilesBatch } from '../api/client';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';

export function SelectedDrawer({ open, onOpenChange, selectedIds = [], onRemoveId, onClear, onItemClick }) {
  const [q, setQ] = useState('');

  const idsKey = useMemo(() => selectedIds.slice().sort((a, b) => a - b).join(','), [selectedIds]);

  const batch = useQuery({
    queryKey: ['filesSelectedBatch', idsKey],
    queryFn: async () => {
      if (!selectedIds.length) return { data: [] };
      // server supports up to 500 ids; our select-all is capped anyway.
      return await getFilesBatch(selectedIds);
    },
    enabled: open && selectedIds.length > 0,
    staleTime: 5_000,
  });

  const filtered = useMemo(() => {
    const rows = batch.data?.data || [];
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => {
      const name = (r.file_name || '').toLowerCase();
      const p = (r.path || '').toLowerCase();
      return name.includes(s) || p.includes(s);
    });
  }, [batch.data, q]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-2xl max-h-[70vh] overflow-hidden p-0">
        <DialogHeader className="p-4 border-b">
          <div className="flex items-center gap-3">
            <DialogTitle>已选中（{selectedIds.length}）</DialogTitle>
            <Button variant="ghost" size="sm" onClick={onClear} disabled={!selectedIds.length} title="清空选择">
              清空选择
            </Button>
          </div>
          <div className="mt-3">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索：文件名 / 路径" />
          </div>
        </DialogHeader>

        <div className="p-4 overflow-auto max-h-[calc(70vh-96px)]">
          {batch.isLoading ? (
            <div className="text-sm text-muted-foreground">加载中…</div>
          ) : filtered.length ? (
            <div className="space-y-2">
              {filtered.map((r) => (
                <div key={r.id} className="border rounded-md p-2 bg-white">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      className="text-left min-w-0 flex-1"
                      onClick={() => onItemClick?.(r)}
                      title={r.path}
                    >
                      <div className="text-sm text-gray-900 truncate">{r.file_name || '—'}</div>
                      <div className="text-xs text-gray-500 truncate">{r.path}</div>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title="移除"
                      onClick={() => onRemoveId?.(r.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">暂无选中项</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}


