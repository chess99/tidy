import { Check, Search, UserRound, Users, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { apiUrl } from '../api/client';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

const GRID_GAP_PX = 12;
const GRID_CARD_WIDTH_PX = 144;
const GRID_ROW_HEIGHT_PX = 198;
const GRID_MAX_COLUMNS = 9;
const GRID_INITIAL_VIEWPORT_HEIGHT_PX = 560;
const GRID_HORIZONTAL_PADDING_PX = 48;

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

function sortPeople(people) {
  return [...people].sort((a, b) => {
    const aNamed = !!a.name?.trim();
    const bNamed = !!b.name?.trim();
    if (aNamed !== bNamed) return aNamed ? -1 : 1;
    if (aNamed) return displayPersonName(a).localeCompare(displayPersonName(b), 'zh-CN', { numeric: true });
    const photoCountDifference = Number(b.face_count || 0) - Number(a.face_count || 0);
    return photoCountDifference || a.id - b.id;
  });
}

export function PeopleFilterDialog({ people, selectedIds, onApply }) {
  "use no memo";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [draftIds, setDraftIds] = useState(() => new Set(selectedIds));
  const [listWidth, setListWidth] = useState(1000);
  const [scrollElement, setScrollElement] = useState(null);

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
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
    const matches = normalizedQuery
      ? people.filter((person) => (
          displayPersonName(person).toLocaleLowerCase('zh-CN').includes(normalizedQuery)
          || String(person.id).includes(normalizedQuery)
        ))
      : people;
    return sortPeople(matches);
  }, [people, query]);

  const columnCount = Math.max(
    1,
    Math.min(GRID_MAX_COLUMNS, Math.floor((listWidth + GRID_GAP_PX) / (GRID_CARD_WIDTH_PX + GRID_GAP_PX)))
  );
  const rowCount = Math.ceil(filteredPeople.length / columnCount);
  // TanStack Virtual manages mutable measurements internally and is intentionally excluded from compiler memoization.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollElement,
    estimateSize: () => GRID_ROW_HEIGHT_PX,
    // Dialog content is portalled; seed the first measurement so cards render before the element observer connects.
    initialRect: { width: listWidth, height: GRID_INITIAL_VIEWPORT_HEIGHT_PX },
    overscan: 2,
  });

  const setListElement = useCallback((element) => {
    setScrollElement(element);
    if (element?.clientWidth) setListWidth(Math.max(1, element.clientWidth - GRID_HORIZONTAL_PADDING_PX));
  }, []);

  useEffect(() => {
    if (!scrollElement) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = entry?.contentRect?.width || 0;
      if (nextWidth > 0) setListWidth(nextWidth);
    });
    observer.observe(scrollElement);
    return () => observer.disconnect();
  }, [scrollElement]);

  useEffect(() => {
    if (!open || !scrollElement) return;
    rowVirtualizer.scrollToOffset(0);
    rowVirtualizer.measure();
  }, [columnCount, open, query, rowVirtualizer, scrollElement]);

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
        <DialogContent className="flex h-[min(920px,calc(100vh-2rem))] w-[min(1400px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-6 pb-4 pt-5 pr-14">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-blue-600" />
              选择人物
            </DialogTitle>
            <DialogDescription className="text-xs">
              可多选；应用后将查找同时包含所有已选人物的照片。
            </DialogDescription>
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
                从下方人物中选择，已选项会固定显示在这里
              </div>
            )}
          </section>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between px-6 pb-2 pt-4">
              <div className="text-xs font-semibold text-slate-700">全部人物</div>
              <div className="text-[11px] text-slate-500">已命名和常见人物优先 · 滚动自动加载</div>
            </div>

            {filteredPeople.length > 0 ? (
              <div ref={setListElement} className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">
                <div
                  className="relative w-full"
                  style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
                >
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const rowStart = virtualRow.index * columnCount;
                    const rowPeople = filteredPeople.slice(rowStart, rowStart + columnCount);
                    return (
                      <div
                        key={virtualRow.key}
                        className="absolute left-0 top-0 flex w-full justify-center"
                        style={{
                          height: `${GRID_ROW_HEIGHT_PX}px`,
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        <div
                          className="grid"
                          style={{
                            gap: `${GRID_GAP_PX}px`,
                            gridTemplateColumns: `repeat(${columnCount}, ${GRID_CARD_WIDTH_PX}px)`,
                          }}
                        >
                          {rowPeople.map((person) => {
                            const selected = draftIds.has(person.id);
                            return (
                              <button
                                type="button"
                                key={person.id}
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
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
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
              已选 {draftIds.size} 人{draftIds.size > 1 ? ' · 结果需同时包含这些人物' : ''}
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
    </>
  );
}
