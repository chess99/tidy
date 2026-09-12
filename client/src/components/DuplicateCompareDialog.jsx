import { useRef, useState } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { apiUrl } from '../api/client';
import { formatBytes, previewUrl } from '../utils/duplicateReview';

export function DuplicateCompareDialog({ items, initialIndex = 0, onClose }) {
  const [left, setLeft] = useState(initialIndex);
  const [right, setRight] = useState(initialIndex === 0 ? 1 : 0);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const drag = useRef(null);
  const zoom = (step) => setView((v) => {
    const z = Math.max(1, Math.min(4, v.zoom + step));
    return z === 1 ? {zoom:1,x:0,y:0} : {...v,zoom:z};
  });
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="dup-compare-dialog">
      <div className="dup-compare-toolbar">
        <div><DialogTitle>并排比较</DialogTitle><DialogDescription>同步缩放 · 拖动查看细节</DialogDescription></div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="缩小" disabled={view.zoom === 1} onClick={() => zoom(-0.5)}><Minus /></Button>
          <span className="w-12 text-center text-xs tabular-nums">{view.zoom.toFixed(1)}×</span>
          <Button variant="ghost" size="icon" aria-label="放大" disabled={view.zoom === 4} onClick={() => zoom(0.5)}><Plus /></Button>
          <Button variant="ghost" size="icon" aria-label="适应窗口" onClick={() => setView({zoom:1,x:0,y:0})}><RotateCcw /></Button>
        </div>
      </div>
      <div className="dup-compare-panes">
        {[left, right].map((idx, pane) => <div key={pane} className="dup-compare-pane">
          <select aria-label={pane ? '右侧照片' : '左侧照片'} value={idx} onChange={(e) => pane ? setRight(Number(e.target.value)) : setLeft(Number(e.target.value))}>
            {items.map((i, n) => <option key={i.file_id} value={n}>{n + 1}. {i.file_name}</option>)}
          </select>
          <div className="dup-zoom-surface" style={{cursor:view.zoom > 1 ? 'grab' : 'default'}}
            onPointerDown={(e) => {
              if (view.zoom === 1) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { px:e.clientX, py:e.clientY, x:view.x, y:view.y };
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              const start = drag.current;
              const box = e.currentTarget.getBoundingClientRect();
              setView(v => ({...v, x: Math.max(-box.width,Math.min(box.width,start.x + e.clientX - start.px)), y:Math.max(-box.height,Math.min(box.height,start.y + e.clientY - start.py))}));
            }} onPointerUp={() => {drag.current=null;}} onPointerCancel={() => {drag.current=null;}} onLostPointerCapture={() => {drag.current=null;}}>
            <img key={items[idx].hash} src={previewUrl(items[idx], apiUrl, true)} alt={items[idx].file_name} draggable={false}
              style={{transform:`translate(${view.x}px, ${view.y}px) scale(${view.zoom})`}} />
          </div>
          <div className="dup-compare-caption">{items[idx].width} × {items[idx].height}<span>{formatBytes(items[idx].size)}</span></div>
        </div>)}
      </div>
    </DialogContent>
  </Dialog>;
}
