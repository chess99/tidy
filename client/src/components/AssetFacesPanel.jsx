import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Search, User } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getFaces, getPeople, updateFace } from '../api/client';
import { Button } from './ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './ui/command';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { PersonAvatar } from './PersonAvatar';
import { displayPersonName, filterPeople, sortPeople } from './peoplePresentation';
import clsx from 'clsx';

function FaceThumbnail({ assetUrl, box, originalSize, className }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = assetUrl;
    img.onload = () => {
      const cvs = canvasRef.current;
      if (!cvs) return;
      const ctx = cvs.getContext('2d');
      
      const naturalW = img.naturalWidth;
      const naturalH = img.naturalHeight;
      
      let scaleX = 1, scaleY = 1;
      if (originalSize && originalSize.width && originalSize.height) {
        scaleX = naturalW / originalSize.width;
        scaleY = naturalH / originalSize.height;
      }
      
      // box is {x, y, width, height} or {x, y, w, h}
      const bx = (box.x || 0) * scaleX;
      const by = (box.y || 0) * scaleY;
      const bw = (box.width || box.w || 0) * scaleX;
      const bh = (box.height || box.h || 0) * scaleY;
      
      // Add padding (20%)
      const padX = bw * 0.2;
      const padY = bh * 0.2;
      
      const sx = Math.max(0, bx - padX);
      const sy = Math.max(0, by - padY);
      const sw = Math.min(naturalW - sx, bw + padX * 2);
      const sh = Math.min(naturalH - sy, bh + padY * 2);

      cvs.width = sw;
      cvs.height = sh;
      
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    };
  }, [assetUrl, box, originalSize]);

  return <canvas ref={canvasRef} className={clsx("object-cover bg-gray-100 rounded-full", className)} />;
}

export function AssetFacesPanel({ hash, assetUrl, originalSize, onFilterByPerson }) {
  const qc = useQueryClient();
  const [popoverOpenId, setPopoverOpenId] = useState(null);
  const [pendingPersonId, setPendingPersonId] = useState(null);
  const [personQuery, setPersonQuery] = useState('');

  // originalSize is used by FaceThumbnail for scaling; keep prop for compatibility.
  void originalSize;

  const facesQuery = useQuery({
    queryKey: ['faces', hash],
    queryFn: () => getFaces(hash),
    enabled: !!hash,
  });

  const peopleQuery = useQuery({
    queryKey: ['people'],
    queryFn: getPeople,
    staleTime: 60000,
  });

  const updateFaceMutation = useMutation({
    mutationFn: ({ faceId, personId }) => updateFace(faceId, { person_id: personId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['faces', hash] });
      qc.invalidateQueries({ queryKey: ['people'] });
    },
  });

  const faces = facesQuery.data || [];
  const people = useMemo(() => peopleQuery.data || [], [peopleQuery.data]);
  const visiblePeople = useMemo(
    () => sortPeople(filterPeople(people, personQuery)).slice(0, 60),
    [people, personQuery]
  );

  if (facesQuery.isLoading) return <div className="text-sm text-gray-500">加载人脸信息…</div>;
  if (!faces.length) return null;

  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold text-gray-500">人物（{faces.length}）</div>
      <div className="space-y-3">
        {faces.map((face) => {
          const assignedPerson = people.find(p => p.id === face.person_id);
          const isOpen = popoverOpenId === face.id;

          return (
            <div key={face.id} className="flex items-center gap-3">
              <FaceThumbnail 
                assetUrl={assetUrl} 
                box={face.box} 
                className="w-10 h-10 border border-gray-200 shrink-0"
              />
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Popover
                    open={isOpen}
                    onOpenChange={(nextOpen) => {
                      if (nextOpen) {
                        setPendingPersonId(face.person_id ?? null);
                        setPersonQuery('');
                        updateFaceMutation.reset();
                      }
                      setPopoverOpenId(nextOpen ? face.id : null);
                    }}
                  >
                    <PopoverTrigger asChild>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="-ml-2 h-7 max-w-52 justify-start px-2 text-sm font-medium hover:bg-gray-100"
                        title="修改人物归属"
                        aria-label={`修改${assignedPerson ? displayPersonName(assignedPerson) : '未归属人脸'}的人物归属`}
                      >
                        {assignedPerson ? (
                          <span className="truncate text-blue-700">{displayPersonName(assignedPerson)}</span>
                        ) : (
                          <span className="text-gray-400">未归属</span>
                        )}
                        <ChevronDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-0" align="start">
                      <div className="border-b px-3 py-2.5">
                        <div className="text-xs font-semibold text-slate-800">人物归属</div>
                        <div className="mt-0.5 text-[11px] text-slate-500">当前照片 · 单张人脸</div>
                      </div>
                      <Command shouldFilter={false}>
                        <CommandInput
                          value={personQuery}
                          onValueChange={setPersonQuery}
                          placeholder="搜索人物"
                        />
                        <CommandList className="max-h-64">
                          <CommandEmpty>没有匹配人物</CommandEmpty>
                          <CommandGroup>
                            <CommandItem
                              value="unknown"
                              onSelect={() => setPendingPersonId(null)}
                            >
                              <User className="mr-2 h-4 w-4 opacity-50" />
                              未归属
                              {pendingPersonId === null && <Check className="ml-auto h-4 w-4" />}
                            </CommandItem>
                            {visiblePeople.map((person) => (
                              <CommandItem
                                key={person.id}
                                value={String(person.id)}
                                onSelect={() => setPendingPersonId(person.id)}
                              >
                                <PersonAvatar person={person} className="mr-2 h-6 w-6 shrink-0 rounded-full" />
                                <span className="truncate">{displayPersonName(person)}</span>
                                {pendingPersonId === person.id && <Check className="ml-auto h-4 w-4" />}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                      <div className="flex items-center justify-between gap-2 border-t px-3 py-2.5">
                        <span className="text-[11px] text-red-600">
                          {updateFaceMutation.isError ? '保存失败' : ''}
                        </span>
                        <div className="flex items-center gap-2">
                          <Button type="button" variant="ghost" size="sm" onClick={() => setPopoverOpenId(null)}>
                            取消
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            disabled={pendingPersonId === (face.person_id ?? null) || updateFaceMutation.isPending}
                            onClick={() => {
                              updateFaceMutation.mutate(
                                { faceId: face.id, personId: pendingPersonId },
                                { onSuccess: () => setPopoverOpenId(null) }
                              );
                            }}
                          >
                            保存
                          </Button>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                  
                  {assignedPerson ? (
                    <div className="ml-auto flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-gray-400 hover:text-blue-600"
                        title={`筛选 ${assignedPerson.name || `ID:${assignedPerson.id}`}`}
                        onClick={() => onFilterByPerson?.(assignedPerson.id)}
                      >
                        <Search className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
