import { Check, Search, UserCog, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { PeopleManagerDialog } from './PeopleManagerDialog';
import { PersonAvatar } from './PersonAvatar';
import { PeopleVirtualGrid } from './PeopleVirtualGrid';
import { displayPersonName, filterPeople, sortPeople } from './peoplePresentation';

export function PeopleFilterDialog({ people, selectedIds, onApply }) {
  const [open, setOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [draftIds, setDraftIds] = useState(() => new Set(selectedIds));

  const peopleById = useMemo(
    () => new Map(people.map((person) => [person.id, person])),
    [people]
  );
  const selectedPeople = useMemo(
    () => selectedIds.map((id) => peopleById.get(id)).filter(Boolean),
    [peopleById, selectedIds]
  );
  const draftPeople = useMemo(
    () => [...draftIds].map((id) => peopleById.get(id)).filter(Boolean),
    [draftIds, peopleById]
  );
  const filteredPeople = useMemo(() => {
    return sortPeople(filterPeople(people, query));
  }, [people, query]);

  const handleOpenChange = (nextOpen) => {
    if (nextOpen) {
      setDraftIds(new Set(selectedIds));
      setQuery('');
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

  const handleMerged = (fromPersonId, intoPersonId) => {
    if (!selectedIds.includes(fromPersonId)) return;
    const next = selectedIds.map((id) => (id === fromPersonId ? intoPersonId : id));
    onApply([...new Set(next)]);
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
              : '按人物筛选照片'}
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
        <DialogContent className="flex h-[min(920px,calc(100vh-2rem))] w-[min(1400px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-6 pb-4 pt-5 pr-14">
            <div className="flex items-start justify-between gap-6">
              <div>
                <DialogTitle className="flex items-center gap-2 text-base">
                  <Users className="h-4 w-4 text-blue-600" />
                  选择人物
                </DialogTitle>
                <DialogDescription className="mt-1.5 text-xs">
                  多选时仅显示共同出现的照片
                </DialogDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => {
                  setOpen(false);
                  setManagerOpen(true);
                }}
              >
                <UserCog className="mr-1.5 h-3.5 w-3.5" />
                管理人物
              </Button>
            </div>
          </DialogHeader>

          <div className="flex shrink-0 items-center gap-3 border-b bg-slate-50/70 px-6 py-3">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索姓名或人物 ID"
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
            <span className="shrink-0 text-xs text-slate-500">
              {query ? `${filteredPeople.length} 个结果` : `共 ${people.length} 人`}
            </span>
          </div>

          <section className="h-[92px] shrink-0 border-b border-blue-100 bg-blue-50/50 px-6 py-3" aria-label="弹层内已选人物">
            <div className="mb-2 flex items-center justify-between gap-4">
              <div className="text-xs font-semibold text-blue-900">已选人物（{draftPeople.length}）</div>
              {draftPeople.length > 0 && (
                <button
                  type="button"
                  onClick={() => setDraftIds(new Set())}
                  className="text-xs font-medium text-blue-600 hover:text-blue-800"
                >
                  清空已选
                </button>
              )}
            </div>
            {draftPeople.length > 0 ? (
              <div className="flex h-11 gap-2 overflow-x-auto pb-0.5">
                {draftPeople.map((person) => (
                  <div
                    key={person.id}
                    className="flex h-10 shrink-0 items-center gap-2 rounded-lg border border-blue-200 bg-white py-1 pl-1 pr-2 shadow-sm"
                  >
                    <PersonAvatar person={person} className="h-8 w-8 shrink-0 rounded-md" />
                    <span className="max-w-32 truncate text-xs font-semibold text-slate-800">
                      {displayPersonName(person)}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleDraft(person.id)}
                      aria-label={`取消选择${displayPersonName(person)}`}
                      className="rounded-full p-1 text-slate-400 hover:bg-blue-50 hover:text-blue-700"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-11 items-center text-xs text-blue-700/60">
                暂无选择
              </div>
            )}
          </section>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center px-6 pb-2 pt-4">
              <div className="text-xs font-semibold text-slate-700">全部人物</div>
            </div>

            {filteredPeople.length > 0 ? (
              <PeopleVirtualGrid
                people={filteredPeople}
                resetKey={query}
                renderPerson={(person) => {
                  const selected = draftIds.has(person.id);
                  return (
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleDraft(person.id)}
                      className={`group relative h-[186px] w-36 min-w-0 rounded-xl border p-2 text-center transition-[border-color,background-color,box-shadow,transform] focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        selected
                          ? 'border-blue-500 bg-blue-50 shadow-sm ring-1 ring-blue-500'
                          : 'border-slate-200 bg-white hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-sm'
                      }`}
                    >
                      <PersonAvatar person={person} className="mx-auto h-32 w-32 rounded-lg" />
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
                }}
              />
            ) : (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-10 text-center">
                <Search className="h-8 w-8 text-slate-300" />
                <div className="mt-3 text-sm font-medium text-slate-700">没有匹配的人物</div>
                <div className="mt-1 text-xs text-slate-500">换个姓名或 ID 试试</div>
                <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => setQuery('')}>
                  清除搜索
                </Button>
              </div>
            )}
          </div>

          <DialogFooter className="shrink-0 flex-row items-center justify-between border-t bg-white px-6 py-4 sm:justify-between sm:space-x-0">
            <span className="text-xs text-slate-500">
              已选 {draftIds.size} 人
            </span>
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
                应用筛选{draftIds.size > 0 ? `（${draftIds.size} 人）` : ''}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {managerOpen && (
        <PeopleManagerDialog
          people={people}
          onMerged={handleMerged}
          onClose={() => setManagerOpen(false)}
          onBack={() => {
            setManagerOpen(false);
            handleOpenChange(true);
          }}
        />
      )}
    </>
  );
}
