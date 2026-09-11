import { ArrowLeft, ArrowRight, GitMerge, LoaderCircle, Search, UserCog, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { mergePerson, renamePerson } from '../api/client';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { PersonAvatar } from './PersonAvatar';
import { PeopleVirtualGrid } from './PeopleVirtualGrid';
import { displayPersonName, filterPeople, normalizePersonName, sortPeople } from './peoplePresentation';

const FILTER_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'unnamed', label: '未命名' },
  { key: 'named', label: '已命名' },
];

function PersonNameField({ person, onCommit, onError }) {
  const originalName = person.name?.trim() || '';
  const [draft, setDraft] = useState(originalName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const skipCommitRef = useRef(false);

  const commit = async () => {
    if (skipCommitRef.current) {
      skipCommitRef.current = false;
      return;
    }
    const nextName = draft.trim();
    if (!nextName || nextName === originalName) {
      setDraft(originalName);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const saved = await onCommit(person, nextName);
      if (!saved) setDraft(originalName);
    } catch (commitError) {
      const message = commitError?.response?.data?.error || commitError?.message || '保存失败';
      setError(message);
      onError?.(message);
      setDraft(originalName);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative mt-2">
      <input
        type="text"
        value={draft}
        disabled={saving}
        placeholder="添加姓名"
        aria-label={`设置${displayPersonName(person)}的姓名`}
        title={error || undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          if (error) setError('');
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            skipCommitRef.current = true;
            setDraft(originalName);
            event.currentTarget.blur();
          }
        }}
        className={`h-8 w-full rounded-lg border bg-white px-2 text-center text-xs font-medium outline-none transition-colors placeholder:font-normal placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 ${
          error ? 'border-red-300 text-red-700' : 'border-slate-200 text-slate-800'
        }`}
      />
      {saving && <LoaderCircle className="absolute right-2 top-2 h-3.5 w-3.5 animate-spin text-blue-500" />}
    </div>
  );
}

function ManagementCard({ person, onMerge, onRename, onError }) {
  return (
    <div className="group relative h-[212px] w-40 rounded-xl border border-slate-200 bg-white p-2 transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-sm">
      <div className="relative">
        <PersonAvatar person={person} className="h-36 w-36 rounded-lg" />
        <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
          {person.face_count || 0} 张照片
        </span>
        <button
          type="button"
          onClick={() => onMerge(person)}
          title={`合并${displayPersonName(person)}`}
          aria-label={`合并${displayPersonName(person)}`}
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full border border-white/70 bg-white/90 text-slate-600 shadow-sm transition-colors hover:bg-blue-600 hover:text-white"
        >
          <GitMerge className="h-4 w-4" />
        </button>
      </div>
      <PersonNameField key={`${person.id}:${person.name || ''}`} person={person} onCommit={onRename} onError={onError} />
    </div>
  );
}

function MergeTargetCard({ person, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(person)}
      className="group relative h-[212px] w-40 rounded-xl border border-slate-200 bg-white p-2 text-center transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-blue-500 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <PersonAvatar person={person} className="h-36 w-36 rounded-lg" />
      <span className="mt-2 block truncate text-xs font-semibold text-slate-800">{displayPersonName(person)}</span>
      <span className="mt-0.5 block text-[10px] text-blue-600">选择为保留人物</span>
    </button>
  );
}

export function PeopleManagerDialog({ people, onBack, onClose, onMerged }) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [mergeSource, setMergeSource] = useState(null);
  const [mergeTarget, setMergeTarget] = useState(null);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState('');
  const [removedIds, setRemovedIds] = useState(() => new Set());
  const [feedback, setFeedback] = useState(null);

  const activePeople = useMemo(
    () => people.filter((person) => !removedIds.has(person.id)),
    [people, removedIds]
  );
  const visiblePeople = useMemo(() => {
    const filteredByMode = activePeople.filter((person) => {
      if (mergeSource?.id === person.id) return false;
      if (filter === 'named') return !!person.name?.trim();
      if (filter === 'unnamed') return !person.name?.trim();
      return true;
    });
    return sortPeople(filterPeople(filteredByMode, query));
  }, [activePeople, filter, mergeSource?.id, query]);
  const namedCount = activePeople.filter((person) => person.name?.trim()).length;
  const unnamedCount = activePeople.length - namedCount;

  const refreshPeopleData = () => {
    queryClient.invalidateQueries({ queryKey: ['people'] });
    queryClient.invalidateQueries({ queryKey: ['faces'] });
  };

  const handleRename = async (person, name) => {
    const normalizedName = normalizePersonName(name);
    const duplicate = activePeople.find((candidate) => (
      candidate.id !== person.id
      && candidate.name?.trim()
      && normalizePersonName(candidate.name) === normalizedName
    ));
    if (duplicate) {
      setMergeSource(person);
      setMergeTarget(duplicate);
      setMergeError('');
      return false;
    }

    await renamePerson(person.id, name);
    setFeedback({ type: 'success', text: `已将${displayPersonName(person)}命名为“${name}”` });
    refreshPeopleData();
    return true;
  };

  const beginMerge = (person) => {
    setMergeSource(person);
    setMergeTarget(null);
    setMergeError('');
    setFeedback(null);
    setQuery('');
    setFilter('all');
  };

  const cancelMerge = () => {
    setMergeSource(null);
    setMergeTarget(null);
    setMergeError('');
  };

  const confirmMerge = async () => {
    if (!mergeSource || !mergeTarget || merging) return;
    setMerging(true);
    setMergeError('');
    try {
      await mergePerson(mergeSource.id, mergeTarget.id);
      const sourceId = mergeSource.id;
      const targetId = mergeTarget.id;
      const sourceName = displayPersonName(mergeSource);
      const targetName = mergeTarget.name?.trim() || mergeSource.name?.trim() || displayPersonName(mergeTarget);
      setRemovedIds((current) => new Set([...current, sourceId]));
      setFeedback({ type: 'success', text: `已将${sourceName}合并到${targetName}` });
      setMergeSource(null);
      setMergeTarget(null);
      refreshPeopleData();
      queryClient.invalidateQueries({ queryKey: ['files'] });
      onMerged?.(sourceId, targetId);
    } catch (error) {
      setMergeError(error?.response?.data?.error || error?.message || '合并失败，请稍后重试');
    } finally {
      setMerging(false);
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(nextOpen) => !nextOpen && onClose()}>
        <DialogContent className="flex h-[min(920px,calc(100vh-2rem))] w-[min(1400px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-6 pb-4 pt-5 pr-14">
            <div className="flex items-start gap-3">
              <Button type="button" variant="ghost" size="icon" className="-ml-2 h-8 w-8 shrink-0" onClick={onBack} title="返回人物选择">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <DialogTitle className="flex items-center gap-2 text-base">
                  <UserCog className="h-4 w-4 text-blue-600" />
                  人物管理
                </DialogTitle>
                <DialogDescription className="mt-1.5 text-xs">
                  直接添加或修改姓名；识别为同一个人时可合并人物。
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="flex shrink-0 items-center gap-3 border-b bg-slate-50/70 px-6 py-3">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={mergeSource ? '搜索要保留的人物' : '搜索姓名或人物 ID'}
                autoFocus
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-9 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="清除人物搜索"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5">
              {FILTER_OPTIONS.map((option) => {
                const count = option.key === 'named' ? namedCount : option.key === 'unnamed' ? unnamedCount : activePeople.length;
                return (
                  <button
                    type="button"
                    key={option.key}
                    onClick={() => setFilter(option.key)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      filter === option.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {option.label} {count}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={`flex h-16 shrink-0 items-center justify-between border-b px-6 ${mergeSource ? 'border-blue-100 bg-blue-50/60' : 'border-slate-100 bg-white'}`}>
            {mergeSource ? (
              <>
                <div className="flex min-w-0 items-center gap-3">
                  <PersonAvatar person={mergeSource} className="h-10 w-10 shrink-0 rounded-lg" />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-blue-900">正在合并 {displayPersonName(mergeSource)}</div>
                    <div className="mt-0.5 text-[11px] text-blue-700">请从下方选择合并后要保留的人物</div>
                  </div>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={cancelMerge}>取消合并</Button>
              </>
            ) : (
              <div className={`text-xs ${
                feedback?.type === 'error'
                  ? 'font-medium text-red-700'
                  : feedback?.type === 'success'
                    ? 'font-medium text-green-700'
                    : 'text-slate-500'
              }`}>
                {feedback?.text || '直接在头像下方输入姓名；点击头像右上角按钮开始合并。'}
              </div>
            )}
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between px-6 pb-2 pt-4">
              <div className="text-xs font-semibold text-slate-700">
                {mergeSource ? '选择保留人物' : '全部人物'}
              </div>
              <div className="text-[11px] text-slate-500">{visiblePeople.length} 人 · 滚动自动加载</div>
            </div>

            {visiblePeople.length > 0 ? (
              <PeopleVirtualGrid
                people={visiblePeople}
                cardWidth={160}
                rowHeight={224}
                resetKey={`${query}:${filter}:${mergeSource?.id || ''}`}
                renderPerson={(person) => mergeSource
                  ? <MergeTargetCard person={person} onSelect={setMergeTarget} />
                  : (
                    <ManagementCard
                      person={person}
                      onMerge={beginMerge}
                      onRename={handleRename}
                      onError={(message) => setFeedback({ type: 'error', text: `姓名保存失败：${message}` })}
                    />
                  )}
              />
            ) : (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-10 text-center">
                <UserCog className="h-9 w-9 text-slate-300" />
                <div className="mt-3 text-sm font-medium text-slate-700">没有匹配的人物</div>
                <div className="mt-1 text-xs text-slate-500">清除搜索或切换命名状态后再试</div>
              </div>
            )}
          </div>

          <DialogFooter className="shrink-0 flex-row items-center justify-between border-t bg-white px-6 py-4 sm:justify-between sm:space-x-0">
            <span className="text-xs text-slate-500">姓名在输入框失焦或按 Enter 后保存</span>
            <Button type="button" onClick={onBack}>完成并返回选择</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!mergeTarget} onOpenChange={(nextOpen) => !nextOpen && !merging && setMergeTarget(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>确认合并人物</DialogTitle>
            <DialogDescription>
              合并后，左侧人物的全部照片会归入右侧人物，左侧人物记录将被删除。
            </DialogDescription>
          </DialogHeader>
          {mergeSource && mergeTarget && (
            <div className="my-2 flex items-center justify-center gap-5">
              <div className="min-w-0 text-center">
                <PersonAvatar person={mergeSource} className="mx-auto h-24 w-24 rounded-xl" />
                <div className="mt-2 max-w-36 truncate text-sm font-semibold">{displayPersonName(mergeSource)}</div>
                <div className="text-[11px] text-red-600">将被合并</div>
              </div>
              <ArrowRight className="h-5 w-5 shrink-0 text-slate-400" />
              <div className="min-w-0 text-center">
                <PersonAvatar person={mergeTarget} className="mx-auto h-24 w-24 rounded-xl" />
                <div className="mt-2 max-w-36 truncate text-sm font-semibold">
                  {mergeTarget.name?.trim() || mergeSource.name?.trim() || displayPersonName(mergeTarget)}
                </div>
                <div className="text-[11px] text-green-700">保留此人物</div>
              </div>
            </div>
          )}
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
            此操作不能撤销。若保留人物尚未命名，会继承被合并人物的姓名。
          </div>
          {mergeError && <div role="alert" className="text-xs text-red-600">{mergeError}</div>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={merging} onClick={() => setMergeTarget(null)}>取消</Button>
            <Button type="button" disabled={merging} className="bg-red-600 hover:bg-red-700" onClick={confirmMerge}>
              {merging && <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" />}
              确认合并
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
