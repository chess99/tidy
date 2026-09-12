import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Trash2, Check, Loader2, RefreshCw, ZoomIn, Copy, Images } from 'lucide-react';
import { useState } from 'react';
import { apiUrl, applyDuplicateActions, getDuplicateGroups, dismissDuplicateGroup, resetDuplicateReviews } from '../api/client';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';

function bytes(value) {
  if (!Number.isFinite(Number(value))) return '—';
  let size = Number(value), unit = 0;
  while (size >= 1024 && unit < 3) { size /= 1024; unit++; }
  return `${size.toFixed(unit ? 1 : 0)} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}

function Preview({ item, large = false }) {
  const [failed, setFailed] = useState(false);
  return failed || !item.hash ? (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500"><Images size={18} />预览不可用</div>
  ) : (
    <img src={apiUrl(`/assets/${item.hash}/preview?max=${large ? 2048 : 1280}&q=85`)}
      alt={item.file_name} className="h-full w-full object-contain" loading="lazy" onError={() => setFailed(true)} />
  );
}

function ReviewGroup({ group, busy, onApply, onDismiss, removed, setRemoved }) {
  const [preview, setPreview] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const items = group.items;
  const kept = items.filter((i) => !removed.includes(i.file_id));
  const selected = items.filter((i) => removed.includes(i.file_id));
  const toggle = (id) => setRemoved((current) => current.includes(id) ? current.filter((i) => i !== id) : [...current, id]);
  const recommended = items.find((i) => i.file_id === group.suggested_keep_file_id);
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
      <div className="flex items-center gap-3">
        <span className={`rounded-md px-2 py-1 text-xs font-medium ${group.kind === 'hash' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-800'}`}>
          {group.kind === 'hash' ? '完全重复' : '画面相似'}
        </span><span className="text-sm text-slate-500">{items.length} 个文件</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {recommended && <Button variant="outline" size="sm" disabled={busy} onClick={() => setRemoved(items.filter((i) => i.file_id !== recommended.file_id).map((i) => i.file_id))}>仅保留推荐项</Button>}
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRemoved([])}>重置选择</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={onDismiss}><Check size={15} className="mr-1" />全部保留，不再提示</Button>
      </div>
    </div>
    <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
      <div className={`mx-auto grid items-start gap-5 ${items.length === 2 ? 'max-w-6xl grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'}`}>
        {items.map((item, index) => {
          const removing = removed.includes(item.file_id);
          return <article key={item.file_id} className={`overflow-hidden rounded-xl border bg-white shadow-sm ${removing ? 'border-red-400 ring-1 ring-red-100' : 'border-slate-200'}`}>
            <div className="flex min-h-11 items-center justify-between gap-2 border-b px-4 py-2 text-xs">
              <span className="tabular-nums text-slate-400">{String(index + 1).padStart(2, '0')}</span>
              <span className={removing ? 'font-medium text-red-600' : 'text-slate-600'}>{removing ? '待移入回收站' : '保留'}</span>
              {item.file_id === recommended?.file_id ? <span className="rounded bg-blue-50 px-2 py-1 text-blue-700">推荐保留</span> : <span />}
            </div>
            <button className="relative block h-[clamp(140px,calc(100dvh-590px),320px)] w-full bg-slate-100" onClick={() => setPreview(item)} aria-label={`放大 ${item.file_name}`}>
              <Preview item={item} /><span className="absolute bottom-3 right-3 rounded-lg bg-white/90 p-2 text-slate-700 shadow-sm"><ZoomIn size={17} /></span>
            </button>
            <div className="space-y-2 p-3">
              <div className="break-all text-sm font-semibold text-slate-900">{item.file_name}</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums text-slate-700">
                <span>{item.width && item.height ? `${item.width} × ${item.height}` : '尺寸未知'}</span><span>{bytes(item.size)}</span>
                <span className="text-slate-500">{item.file_name?.split('.').pop()?.toUpperCase()}</span>
              </div>
              <p className="text-xs text-slate-500">{item.asset_captured_at ? new Date(item.asset_captured_at).toLocaleString('zh-CN', { hour12: false }) : '拍摄时间未知'}</p>
              <p className="break-all text-xs leading-5 text-slate-500" title={item.path}>{item.path}</p>
              {item.organized_to && <p className="text-xs text-blue-700">已归档 · {item.organized_to}</p>}
              <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm ${removing ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 text-slate-600'}`}>
                <input type="checkbox" checked={removing} disabled={busy} onChange={() => toggle(item.file_id)} className="h-4 w-4 accent-red-600" />移入回收站
              </label>
            </div>
          </article>;
        })}
      </div>
    </div>
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-white px-6 py-4">
      <div className="text-sm text-slate-600" aria-live="polite">
        保留 <span className="font-semibold text-slate-900">{kept.length}</span> 个<span className="mx-3 text-slate-300">/</span>
        移入回收站 <span className="font-semibold text-slate-900">{selected.length}</span> 个
        {selected.length > 0 && <span className="ml-3 text-slate-400">{bytes(selected.reduce((sum, i) => sum + (i.size || 0), 0))}</span>}
        {!kept.length && <span className="ml-3 text-red-600">请至少保留一份</span>}
      </div>
      <Button disabled={busy || !selected.length || !kept.length} onClick={() => setConfirm(true)}>
        {busy ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Trash2 size={16} className="mr-2" />}处理这一组
      </Button>
    </div>
    <Dialog open={!!preview} onOpenChange={(open) => { if (!open) setPreview(null); }}>
      <DialogContent className="max-w-6xl">
        <DialogTitle className="pr-8 break-all">{preview?.file_name}</DialogTitle>
        <DialogDescription>{preview ? `${preview.width || '—'} × ${preview.height || '—'} · ${bytes(preview.size)}` : ''}</DialogDescription>
        <div className="h-[70vh] min-h-0 bg-slate-100">{preview && <Preview key={preview.file_id} item={preview} large />}</div>
      </DialogContent>
    </Dialog>
    <Dialog open={confirm} onOpenChange={setConfirm}>
      <DialogContent>
        <DialogTitle>将 {selected.length} 个文件移入回收站？</DialogTitle>
        <DialogDescription>保留 {kept.length} 个文件。选中的文件将移至配置的回收目录。</DialogDescription>
        <ul className="max-h-48 overflow-auto text-sm text-slate-600">{selected.map((i) => <li key={i.file_id} className="break-all py-1">{i.file_name}</li>)}</ul>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setConfirm(false)}>取消</Button>
          <Button onClick={() => { setConfirm(false); onApply({ groupId: group.id, keepFileIds: kept.map((i) => i.file_id), deleteFileIds: removed }); }}>移入回收站</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}

export function DuplicatesToolView() {
  const qc = useQueryClient();
  const [kind, setKind] = useState('all');
  const [activeId, setActiveId] = useState(null);
  const [message, setMessage] = useState('');
  const [drafts, setDrafts] = useState({});
  const query = useQuery({ queryKey: ['duplicates'], queryFn: getDuplicateGroups, staleTime: 60000, refetchOnWindowFocus: false });
  const all = query.data?.groups || [];
  const groups = all.filter((g) => kind === 'all' || g.kind === kind);
  const index = Math.max(0, groups.findIndex((g) => g.id === activeId));
  const group = groups[index];
  const mutation = useMutation({
    mutationFn: async ({ action, ...payload }) => {
      if (action === 'dismiss') return dismissDuplicateGroup(payload.groupId);
      if (action === 'reset') return resetDuplicateReviews();
      const result = await applyDuplicateActions(payload);
      if (result.errors) throw new Error(result.messages?.join('；') || '部分文件处理失败，请刷新后重试。');
      return result;
    },
    onSuccess: (_, variables) => {
      setMessage('');
      if (variables.action !== 'reset') {
        const next = groups[index + 1] || groups[index - 1];
        setActiveId(next?.id || null);
        qc.setQueryData(['duplicates'], (old) => old ? { ...old, groups: old.groups.filter((g) => g.id !== variables.groupId) } : old);
      }
      for (const key of ['duplicates', 'files', 'assets', 'trash']) qc.invalidateQueries({ queryKey: [key] });
    },
    onError: (error) => {
      setMessage(error.response?.data?.error || error.message);
      for (const key of ['duplicates', 'files', 'assets', 'trash']) qc.invalidateQueries({ queryKey: [key] });
    },
  });
  const busy = mutation.isPending;
  const coverage = query.data?.coverage;
  return <section className="flex h-full min-h-0 w-full flex-col bg-slate-50">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b bg-white px-6 py-4">
      <div className="flex items-center gap-3"><Copy className="text-slate-500" size={20} /><h1 className="text-lg font-semibold">重复项</h1><span className="text-sm text-slate-400">{all.length} 组待审核</span></div>
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" disabled={busy || query.isFetching} onClick={() => query.refetch()} aria-label="刷新重复项"><RefreshCw size={16} className={query.isFetching ? 'animate-spin' : ''} /></Button>
        <span className="min-w-16 text-center text-sm tabular-nums text-slate-500">{group ? `${index + 1} / ${groups.length}` : '0 / 0'}</span>
        <Button variant="outline" size="icon" disabled={busy || index === 0} onClick={() => setActiveId(groups[index - 1].id)} aria-label="上一组"><ChevronLeft size={18} /></Button>
        <Button variant="outline" size="icon" disabled={busy || !group || index >= groups.length - 1} onClick={() => setActiveId(groups[index + 1].id)} aria-label="下一组"><ChevronRight size={18} /></Button>
      </div>
    </header>
    <nav className="flex shrink-0 gap-1 border-b bg-white px-6" aria-label="重复项类型">
      {[['all', '全部'], ['hash', '完全重复'], ['similar', '画面相似']].map(([value, label]) => <button key={value} disabled={busy} aria-pressed={kind === value}
        onClick={() => { setKind(value); setActiveId(null); }} className={`border-b-2 px-4 py-3 text-sm ${kind === value ? 'border-blue-600 font-medium text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-900'}`}>
        {label} <span className="ml-1 text-xs">{value === 'all' ? all.length : all.filter((g) => g.kind === value).length}</span>
      </button>)}
    </nav>
    {(message || query.isError) && <div role="alert" className="flex items-center justify-between gap-3 border-b border-red-100 bg-red-50 px-6 py-3 text-sm text-red-700">
      {message || query.error?.message || '加载失败'}<Button variant="outline" size="sm" onClick={() => { setMessage(''); query.refetch(); }}>重试</Button>
    </div>}
    {query.isPending ? <div role="status" className="flex flex-1 items-center justify-center gap-3 text-sm text-slate-500"><Loader2 className="animate-spin" size={20} />正在核对重复项…</div>
      : group ? <ReviewGroup key={group.id} group={group} busy={busy} removed={drafts[group.id] || []}
          setRemoved={(next) => setDrafts((current) => ({ ...current, [group.id]: typeof next === 'function' ? next(current[group.id] || []) : next }))}
          onApply={(payload) => mutation.mutate(payload)} onDismiss={() => mutation.mutate({ action: 'dismiss', groupId: group.id })} />
        : <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"><Check size={36} className="text-slate-300" /><p className="font-medium text-slate-700">暂无待审核项</p><p className="text-sm text-slate-500">没有发现符合当前检测条件的候选</p></div>}
    {coverage && <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-6 py-2 text-xs text-slate-500">
      <span>已检查 {coverage.images} 张图片{coverage.pending > 0 ? ` · ${coverage.pending} 张元数据未就绪` : ''}{coverage.unreadable > 0 ? ` · ${coverage.unreadable} 张预览未就绪` : ''}{coverage.companions > 0 ? ` · 已排除 ${coverage.companions} 对 RAW/JPG` : ''}</span>
      {query.data.dismissed > 0 && <button className="text-blue-700 hover:underline" disabled={busy} onClick={() => mutation.mutate({ action: 'reset' })}>重新检查已保留组</button>}
    </div>}
  </section>;
}
