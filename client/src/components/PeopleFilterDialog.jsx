/**
 * input: 人物列表 + 当前筛选值 + 应用回调
 * output: 可搜索、看头像、多选的人物筛选弹层
 * pos: 客户端视图层：承载人物筛选的高辨识度选择体验（变更需同步更新所属目录 README）
 */

import { Check, Search, UserRound, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { apiUrl } from '../api/client';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

const PEOPLE_PAGE_SIZE = 60;

function displayPersonName(person) {
  return person.name?.trim() || `人物 ${person.id}`;
}

function PersonAvatar({ person, className = '' }) {
  const imageSrc = person.avatar_face_id
    ? apiUrl(`/faces/people/${person.id}/avatar?v=${person.avatar_face_id}`)
    : '';
  const [failedSrc, setFailedSrc] = useState('');

  return (
    <div className={`relative overflow-hidden bg-slate-100 ${className}`}>
      <div className="absolute inset-0 flex items-center justify-center text-slate-300">
        <UserRound className="h-1/2 w-1/2" strokeWidth={1.5} />
      </div>
      {imageSrc && failedSrc !== imageSrc && (
        <img
          src={imageSrc}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailedSrc(imageSrc)}
        />
      )}
    </div>
  );
}

export function PeopleFilterDialog({ people, selectedIds, onApply }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [draftIds, setDraftIds] = useState(() => new Set(selectedIds));
  const [visibleLimit, setVisibleLimit] = useState(PEOPLE_PAGE_SIZE);

  const selectedPeople = useMemo(
    () => selectedIds.map((id) => people.find((person) => person.id === id)).filter(Boolean),
    [people, selectedIds]
  );
  const filteredPeople = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
    const matches = normalizedQuery
      ? people.filter((person) => (
          displayPersonName(person).toLocaleLowerCase('zh-CN').includes(normalizedQuery)
          || String(person.id).includes(normalizedQuery)
        ))
      : people;
    return [...matches].sort((a, b) => {
      const selectedDifference = Number(draftIds.has(b.id)) - Number(draftIds.has(a.id));
      if (selectedDifference) return selectedDifference;
      const aNamed = !!a.name?.trim();
      const bNamed = !!b.name?.trim();
      if (aNamed !== bNamed) return aNamed ? -1 : 1;
      if (aNamed) return displayPersonName(a).localeCompare(displayPersonName(b), 'zh-CN', { numeric: true });
      const photoCountDifference = Number(b.face_count || 0) - Number(a.face_count || 0);
      return photoCountDifference || a.id - b.id;
    });
  }, [draftIds, people, query]);
  const visiblePeople = filteredPeople.slice(0, visibleLimit);

  const handleOpenChange = (nextOpen) => {
    if (nextOpen) {
      setDraftIds(new Set(selectedIds));
      setQuery('');
      setVisibleLimit(PEOPLE_PAGE_SIZE);
    }
    setOpen(nextOpen);
  };

  const removeSelected = (personId) => {
    const next = selectedIds.filter((id) => id !== personId);
    onApply(next);
  };

  const toggleDraft = (personId) => {
    setDraftIds((current) => {
      const next = new Set(current);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => handleOpenChange(true)}
        className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/60 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <div className="flex h-9 min-w-11 items-center">
          {selectedPeople.length > 0 ? (
            selectedPeople.slice(0, 3).map((person, index) => (
              <PersonAvatar
                key={person.id}
                person={person}
                className={`h-8 w-8 rounded-full border-2 border-white shadow-sm ${index > 0 ? '-ml-3' : ''}`}
              />
            ))
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-blue-600">
              <Users className="h-4 w-4" />
            </div>
          )}
        </div>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-slate-800">
            {selectedPeople.length > 0 ? `已选 ${selectedPeople.length} 人` : '选择人物'}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-slate-500">
            {selectedPeople.length > 0
              ? selectedPeople.map(displayPersonName).join('、')
              : '打开头像列表，快速辨认'}
          </span>
        </span>
        <span className="text-[11px] font-medium text-blue-600 group-hover:text-blue-700">
          {selectedPeople.length > 0 ? '修改' : '打开'}
        </span>
      </button>

      {selectedPeople.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="已选人物">
          {selectedPeople.map((person) => (
            <span
              key={person.id}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-blue-200 bg-blue-50 py-1 pl-1 pr-1.5 text-[11px] font-medium text-blue-700"
            >
              <PersonAvatar person={person} className="h-5 w-5 shrink-0 rounded-full" />
              <span className="max-w-28 truncate">{displayPersonName(person)}</span>
              <button
                type="button"
                onClick={() => removeSelected(person.id)}
                aria-label={`移除${displayPersonName(person)}`}
                className="rounded-full p-0.5 text-blue-400 hover:bg-blue-100 hover:text-blue-700"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="flex max-h-[min(760px,85vh)] w-[min(820px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b px-6 pb-4 pt-5 pr-14">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-blue-600" />
              选择人物
            </DialogTitle>
            <DialogDescription className="text-xs">
              可多选；结果将同时包含所有已选人物。
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-3 border-b bg-slate-50/70 px-6 py-3">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setVisibleLimit(PEOPLE_PAGE_SIZE);
                }}
                placeholder="搜索姓名或人物 ID"
                autoFocus
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <span className="shrink-0 text-xs text-slate-500">已选 {draftIds.size} 人</span>
            {draftIds.size > 0 && (
              <button
                type="button"
                onClick={() => setDraftIds(new Set())}
                className="shrink-0 text-xs font-medium text-slate-500 hover:text-slate-900"
              >
                清除
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {filteredPeople.length > 0 ? (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                {visiblePeople.map((person) => {
                  const selected = draftIds.has(person.id);
                  return (
                    <button
                      type="button"
                      key={person.id}
                      aria-pressed={selected}
                      onClick={() => toggleDraft(person.id)}
                      className={`group relative min-w-0 rounded-xl border p-2 text-center transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        selected
                          ? 'border-blue-500 bg-blue-50 shadow-sm ring-1 ring-blue-500'
                          : 'border-slate-200 bg-white hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-sm'
                      }`}
                    >
                      <PersonAvatar person={person} className="mx-auto aspect-square w-full rounded-lg" />
                      <span className="mt-2 block truncate text-xs font-semibold text-slate-800" title={displayPersonName(person)}>
                        {displayPersonName(person)}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-slate-500">
                        {person.face_count || 0} 张照片
                      </span>
                      <span className={`absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border shadow-sm ${
                        selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-white bg-white/90 text-transparent'
                      }`}>
                        <Check className="h-3 w-3" strokeWidth={3} />
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex min-h-52 flex-col items-center justify-center text-center">
                <Search className="h-8 w-8 text-slate-300" />
                <div className="mt-3 text-sm font-medium text-slate-700">没有匹配的人物</div>
                <div className="mt-1 text-xs text-slate-500">换个姓名或 ID 试试</div>
              </div>
            )}
            {visiblePeople.length < filteredPeople.length && (
              <div className="mt-5 flex flex-col items-center gap-2 border-t border-slate-100 pt-4">
                <span className="text-[11px] text-slate-500">
                  已显示 {visiblePeople.length} / {filteredPeople.length} 人
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setVisibleLimit((current) => current + PEOPLE_PAGE_SIZE)}
                >
                  再显示 {Math.min(PEOPLE_PAGE_SIZE, filteredPeople.length - visiblePeople.length)} 人
                </Button>
              </div>
            )}
          </div>

          <DialogFooter className="flex-row items-center justify-between border-t bg-white px-6 py-4 sm:justify-between sm:space-x-0">
            <span className="text-xs text-slate-500">共 {people.length} 人</span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  onApply([...draftIds]);
                  setOpen(false);
                }}
              >
                查看结果{draftIds.size > 0 ? `（${draftIds.size} 人）` : ''}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
