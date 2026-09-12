import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp, Images, Keyboard, Loader2, RefreshCw, Sparkles, Trash2, Columns2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { apiUrl, applyDuplicateActions, getDuplicateGroups, dismissDuplicateGroup, resetDuplicateReviews } from '../api/client';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { DuplicateCompareDialog } from './DuplicateCompareDialog';
import { applyReviewDelta, formatBytes, nextReviewId, previewUrl, reviewShortcut, shortFolder } from '../utils/duplicateReview';
import './duplicates.css';

function Preview({ item, eager }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return <div className="dup-image">
    <img className="dup-thumbnail" src={apiUrl(`/assets/${item.hash}/thumb`)} alt="" draggable={false} loading={eager ? 'eager' : 'lazy'} />
    {!failed && <img className={`dup-full ${loaded ? 'is-loaded' : ''}`} src={previewUrl(item, apiUrl)} alt={item.file_name}
      draggable={false} loading={eager ? 'eager' : 'lazy'} decoding="async" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />}
    {failed && <span className="dup-preview-error"><Images size={14} />高清预览不可用</span>}
  </div>;
}

const shortcuts = [['← / →', '上一组 / 下一组'], ['1–9', '切换对应文件的保留状态'], ['R', '仅保留推荐项'], ['A', '选择全部保留'], ['Space', '并排放大比较'], ['Shift + Enter', '提交当前选择'], ['Esc', '关闭窗口']];

export function DuplicatesToolView() {
  const qc = useQueryClient();
  const [kind, setKind] = useState('all');
  const [activeId, setActiveId] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [details, setDetails] = useState(false);
  const [compare, setCompare] = useState(false);
  const [compareIndex, setCompareIndex] = useState(0);
  const [help, setHelp] = useState(false);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const submitting = useRef(false);
  const strip = useRef(null);
  const query = useQuery({ queryKey: ['duplicates'], queryFn: () => getDuplicateGroups(), staleTime: Infinity, gcTime: 1800000, refetchOnWindowFocus: false });
  const all = query.data?.groups || [];
  const groups = all.filter((g) => kind === 'all' || g.kind === kind);
  const index = Math.max(0, groups.findIndex((g) => g.id === activeId));
  const group = groups[index];
  const items = group?.items || [];
  const removed = drafts[group?.id] || [];
  const selected = items.filter((i) => removed.includes(i.file_id));
  const kept = items.filter((i) => !removed.includes(i.file_id));
  const recommended = group?.suggested_keep_file_id;
  const deltaResult = (result, groupId) => {
    qc.setQueryData(['duplicates'], (old) => applyReviewDelta(old, result));
    setActiveId(nextReviewId(groups, groupId, result));
  };
  const mutation = useMutation({
    mutationFn: async ({ action, ...payload }) => action === 'dismiss' ? dismissDuplicateGroup(payload.groupId) : applyDuplicateActions(payload),
    onSuccess: (result, variables) => {
      deltaResult(result, variables.groupId);
      if (result.errors) {
        setMessage(result.messages?.join('；') || '部分文件未能移除，请检查后重试。');
      } else {
        setMessage('');
        setNotice(variables.action === 'dismiss' ? '已保留这一组' : `已移除 ${variables.deleteFileIds.length} 个文件`);
        if (variables.action === 'dismiss') qc.setQueryData(['duplicates'], old => ({...old,dismissed:(old?.dismissed || 0)+1}));
      }
      for (const key of ['files', 'assets', 'trash']) qc.invalidateQueries({ queryKey: [key] });
    },
    onError: (error, variables) => {
      const response = error.response?.data;
      if (response?.removedGroupIds) deltaResult(response, variables.groupId);
      setMessage(response?.error || error.message);
      for (const key of ['files', 'assets', 'trash']) qc.invalidateQueries({queryKey:[key]});
    },
    onSettled: () => { submitting.current = false; },
  });
  const busy = mutation.isPending || refreshing;
  const setRemoved = (values) => { if (group && !busy) setDrafts(current => ({...current,[group.id]:values})); };
  const toggle = (id) => setRemoved(removed.includes(id) ? removed.filter(i=>i!==id) : [...removed,id]);
  const recommend = () => { if (recommended) setRemoved(items.filter(i=>i.file_id!==recommended).map(i=>i.file_id)); };
  const navigate = (offset) => {
    if (busy || !groups[index + offset]) return;
    setActiveId(groups[index + offset].id);
  };
  const submit = () => {
    if (!group || busy || submitting.current || !kept.length) return;
    submitting.current = true;
    mutation.mutate(selected.length ? {groupId:group.id,keepFileIds:kept.map(i=>i.file_id),deleteFileIds:selected.map(i=>i.file_id)} : {action:'dismiss',groupId:group.id});
  };
  const refresh = async (reset = false) => {
    if (busy) return;
    setRefreshing(true); setMessage('');
    try {
      if (reset) await resetDuplicateReviews();
      const result = await getDuplicateGroups({refresh:!reset});
      qc.setQueryData(['duplicates'], result);
    } catch (error) { setMessage(error.response?.data?.error || error.message); }
    finally { setRefreshing(false); }
  };

  const preloadKey = groups.slice(index + 1, index + 3).flatMap(g=>g.items.slice(0,4)).map(i=>previewUrl(i,apiUrl)).join('\n');
  useEffect(() => {
    const images = preloadKey ? preloadKey.split('\n').map(src=>{ const image=new Image();image.src=src;return image; }) : [];
    return () => { for (const image of images) image.onload = null; };
  }, [preloadKey]);
  useEffect(() => { strip.current?.scrollTo({left:0,top:0}); }, [group?.id]);
  useEffect(() => {
    const onKey = (event) => {
      if (busy || help || compare) return;
      const action = reviewShortcut(event);
      if (action === null) return;
      event.preventDefault();
      if (typeof action === 'number') { if (items[action]) toggle(items[action].file_id); }
      else if (action === 'previous') navigate(-1);
      else if (action === 'next') navigate(1);
      else if (action === 'recommend') recommend();
      else if (action === 'keep') setRemoved([]);
      else if (action === 'compare' && group) { setCompareIndex(0); setCompare(true); }
      else if (action === 'apply') submit();
      else if (action === 'help') setHelp(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pixelsDiffer = new Set(items.map(i=>`${i.width}x${i.height}`)).size > 1;
  const sizesDiffer = new Set(items.map(i=>i.size)).size > 1;
  const datesDiffer = new Set(items.map(i=>i.asset_captured_at)).size > 1;
  return <section className="dup-review" aria-label="重复项审核">
    <header className="dup-header">
      <div className="dup-title"><h1>重复项</h1><span>{query.isPending ? '核对中' : `${all.length.toLocaleString()} 组待审核`}</span></div>
      <div className="dup-tabs" aria-label="重复项类型">
        {[['all','全部'],['hash','完全重复'],['similar','画面相似']].map(([value,label])=><button key={value} aria-pressed={kind===value} disabled={busy}
          onClick={()=>{setKind(value);setActiveId(null);}}>{label}</button>)}
      </div>
      <div className="dup-navigation">
        <Button variant="ghost" size="icon" disabled={busy || query.isFetching} onClick={()=>refresh()} aria-label="重新检测" title="重新检测图库"><RefreshCw className={refreshing || query.isFetching ? 'animate-spin' : ''} /></Button>
        <span className="dup-counter">{group ? `${index+1} / ${groups.length}` : '—'}</span>
        <Button variant="outline" size="icon" disabled={busy || index===0} onClick={()=>navigate(-1)} aria-label="上一组" title="上一组 ←"><ArrowLeft /></Button>
        <Button variant="outline" size="icon" disabled={busy || !group || index===groups.length-1} onClick={()=>navigate(1)} aria-label="下一组" title="下一组 →"><ArrowRight /></Button>
      </div>
    </header>
    {(message || query.isError) && <div className="dup-error" role="alert"><span>{message || query.error?.message}</span><button disabled={busy} onClick={()=>refresh()}>重新检测</button></div>}
    {group && <div className="dup-group-bar">
      <span><span className={`dup-kind ${group.kind==='hash'?'exact':''}`}>{group.kind==='hash'?'完全重复':'画面相似'}</span><span className="dup-muted">{items.length} 个版本</span></span>
      <div><Button size="sm" variant="ghost" onClick={()=>setDetails(!details)}>{details?<ChevronUp />:<ChevronDown />}{details?'收起详情':'更多详情'}</Button>
        <Button size="sm" variant="outline" onClick={()=>{setCompareIndex(0);setCompare(true);}} title="并排比较 Space"><Columns2 />并排比较</Button></div>
    </div>}
    {query.isPending ? <div className="dup-empty" role="status"><Loader2 className="animate-spin" /><span>正在核对图库…</span></div>
      : !group ? <div className="dup-empty"><div className="dup-done">{query.isError?<RefreshCw />:<Check />}</div><h2>{query.isError?'暂时无法加载':'这一轮已检查完'}</h2><span>{query.isError?'请重试加载审核队列':'当前分类没有待审核项'}</span><Button variant="outline" onClick={()=>refresh()} disabled={busy}>重新检测</Button></div>
      : <div className="dup-stage" ref={strip}>
        <div className={`dup-strip ${items.length===2?'is-pair':''}`}>
          {items.map((item,n)=>{
            const removing=removed.includes(item.file_id);
            return <article key={`${group.id}:${item.file_id}`} className={`dup-card ${removing?'is-removed':''}`}>
              <div className="dup-card-top"><kbd>{n+1}</kbd><span>{item.file_id===recommended && <><Sparkles size={12} />推荐保留</>}</span><span className={removing?'dup-red':'dup-green'}>{removing?'待移除':'保留'}</span></div>
              <button className="dup-photo-button" aria-label={`比较第 ${n+1} 张 ${item.file_name}`} onClick={()=>{setCompareIndex(n);setCompare(true);}}><Preview key={item.hash} item={item} eager={n<4} /><span className="dup-magnifier"><Columns2 size={16} /></span></button>
              <div className="dup-card-info">
                <h2 title={item.file_name}>{item.file_name}</h2>
                <div className="dup-specs"><span className={pixelsDiffer?'diff':''}>{item.width && item.height?`${item.width} × ${item.height}`:'尺寸未知'}</span><span className={sizesDiffer?'diff':''}>{formatBytes(item.size)}</span><span>{item.file_name?.split('.').pop()?.toUpperCase()}</span></div>
                <p className="dup-folder" title={item.path}>{shortFolder(item.path)}</p>
                {details && <div className="dup-details"><p className={datesDiffer?'diff':''}>{item.asset_captured_at?new Date(item.asset_captured_at).toLocaleString('zh-CN',{hour12:false}):'拍摄时间未知'}</p><p>{item.path}</p>{item.organized_to && <p>已归档 · {item.organized_to}</p>}</div>}
                <button className={`dup-decision ${removing?'remove':'keep'}`} aria-pressed={!removing} aria-label={`保留第 ${n+1} 张`} disabled={busy} onClick={()=>toggle(item.file_id)}>
                  {removing?<Trash2 size={15} />:<Check size={15} />}{removing?'移除':'保留'}<span>{removing?'点击保留':'点击移除'}</span>
                </button>
              </div>
            </article>;
          })}
        </div>
      </div>}
    <footer className="dup-footer">
      <div className="dup-selection"><strong>{kept.length}</strong> 保留<span>·</span><strong className={selected.length?'dup-red':''}>{selected.length}</strong> 移除{selected.length>0 && <small>{formatBytes(selected.reduce((s,i)=>s+(i.size||0),0))}</small>}</div>
      <div className="dup-actions"><Button variant="ghost" disabled={busy || !group} onClick={()=>setRemoved([])} title="全部保留 A">全部保留<kbd>A</kbd></Button>
        <Button variant="outline" disabled={busy || !recommended} onClick={recommend} title="仅保留推荐项 R"><Sparkles />保留推荐<kbd>R</kbd></Button>
        <Button className="dup-submit" disabled={busy || !group || !kept.length} onClick={submit} title="确认并继续 Shift+Enter">
          {mutation.isPending?<Loader2 className="animate-spin" />:<Check />}{selected.length?`移除 ${selected.length} 个并继续`:'全部保留并继续'}<kbd>⇧ ↵</kbd></Button></div>
    </footer>
    <div className="dup-status"><span role="status" aria-live="polite">{!kept.length && group?'请至少保留一份':notice} {query.data?.coverage?.pending>0 && <span className="dup-muted">{query.data.coverage.pending} 张元数据未就绪</span>}</span>
      <div>{query.data?.dismissed>0 && <button disabled={busy} onClick={()=>refresh(true)}>重新查看已保留组</button>}<button onClick={()=>setHelp(true)} title="快捷键 ?"><Keyboard size={14} /><span>快捷键</span></button></div></div>
    {compare && group && <DuplicateCompareDialog items={items} initialIndex={compareIndex} onClose={()=>setCompare(false)} />}
    <Dialog open={help} onOpenChange={setHelp}><DialogContent><DialogTitle>审核快捷键</DialogTitle><DialogDescription>输入文字或打开弹窗时，审核快捷键暂停。</DialogDescription><dl className="dup-shortcuts">{shortcuts.map(([key,label])=><div key={key}><dt><kbd>{key}</kbd></dt><dd>{label}</dd></div>)}</dl></DialogContent></Dialog>

  </section>;
}
