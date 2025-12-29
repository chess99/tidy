import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Plus, Search, User } from 'lucide-react';
import { useEffect, useRef, useState, useMemo } from 'react';
import { apiUrl, createPersonFromFace, getFaces, getPeople, updateFace } from '../api/client';
import { Button } from './ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './ui/command';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
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
  const [newPersonName, setNewPersonName] = useState('');

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
      // qc.invalidateQueries({ queryKey: ['people'] }); // In case avatar changed
    },
  });

  const createPersonMutation = useMutation({
    mutationFn: ({ faceId, name }) => createPersonFromFace(faceId, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['faces', hash] });
      qc.invalidateQueries({ queryKey: ['people'] });
      setNewPersonName('');
    },
  });

  const faces = facesQuery.data || [];
  const people = peopleQuery.data || [];

  if (facesQuery.isLoading) return <div className="text-sm text-gray-500">加载人脸信息…</div>;
  if (!faces.length) return null;

  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold text-gray-500">PEOPLE ({faces.length})</div>
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
                  <Popover open={isOpen} onOpenChange={(v) => setPopoverOpenId(v ? face.id : null)}>
                    <PopoverTrigger asChild>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-6 px-2 -ml-2 text-sm font-medium hover:bg-gray-100 justify-start"
                      >
                        {assignedPerson ? (
                          <span className="text-blue-700">{assignedPerson.name}</span>
                        ) : (
                          <span className="text-gray-400 italic">Unknown</span>
                        )}
                        <ChevronsUpDown className="ml-1 h-3 w-3 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[200px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="搜索/新建人物..." />
                        <CommandList>
                          <CommandEmpty className="py-2 px-2">
                             <div className="text-xs text-muted-foreground mb-2">无匹配</div>
                             <div className="flex gap-2">
                               <input 
                                 className="flex-1 border rounded px-2 py-1 text-xs"
                                 placeholder="输入新名字"
                                 value={newPersonName}
                                 onChange={e => setNewPersonName(e.target.value)}
                                 onKeyDown={e => {
                                   if (e.key === 'Enter' && newPersonName.trim()) {
                                     e.stopPropagation();
                                     createPersonMutation.mutate({ faceId: face.id, name: newPersonName.trim() });
                                     setPopoverOpenId(null);
                                   }
                                 }}
                               />
                               <Button 
                                 size="sm" 
                                 className="h-7"
                                 disabled={!newPersonName.trim()}
                                 onClick={() => {
                                    createPersonMutation.mutate({ faceId: face.id, name: newPersonName.trim() });
                                    setPopoverOpenId(null);
                                 }}
                               >
                                 <Plus className="h-3 w-3" />
                               </Button>
                             </div>
                          </CommandEmpty>
                          <CommandGroup>
                            <CommandItem
                              value="unknown"
                              onSelect={() => {
                                updateFaceMutation.mutate({ faceId: face.id, personId: null });
                                setPopoverOpenId(null);
                              }}
                            >
                              <User className="mr-2 h-4 w-4 opacity-50" />
                              (Unknown)
                              {face.person_id === null && <Check className="ml-auto h-4 w-4" />}
                            </CommandItem>
                            {people.map((p) => (
                              <CommandItem
                                key={p.id}
                                value={p.name}
                                onSelect={() => {
                                  updateFaceMutation.mutate({ faceId: face.id, personId: p.id });
                                  setPopoverOpenId(null);
                                }}
                              >
                                <User className="mr-2 h-4 w-4 opacity-50" />
                                {p.name}
                                {face.person_id === p.id && <Check className="ml-auto h-4 w-4" />}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  
                  {assignedPerson ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 ml-auto text-gray-400 hover:text-blue-600"
                      title={`筛选 ${assignedPerson.name}`}
                      onClick={() => onFilterByPerson?.(assignedPerson.id)}
                    >
                      <Search className="h-3 w-3" />
                    </Button>
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

