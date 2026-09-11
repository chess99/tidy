import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useState } from 'react';

const GRID_GAP_PX = 12;
const GRID_MAX_COLUMNS = 10;
const GRID_INITIAL_VIEWPORT_HEIGHT_PX = 560;
const GRID_HORIZONTAL_PADDING_PX = 48;

export function PeopleVirtualGrid({ people, renderPerson, cardWidth = 144, rowHeight = 198, resetKey = '' }) {
  "use no memo";
  const [listWidth, setListWidth] = useState(1000);
  const [scrollElement, setScrollElement] = useState(null);
  const columnCount = Math.max(
    1,
    Math.min(GRID_MAX_COLUMNS, Math.floor((listWidth + GRID_GAP_PX) / (cardWidth + GRID_GAP_PX)))
  );
  const rowCount = Math.ceil(people.length / columnCount);

  // TanStack Virtual manages mutable measurements internally and is intentionally excluded from compiler memoization.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollElement,
    estimateSize: () => rowHeight,
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
    if (!scrollElement) return;
    rowVirtualizer.scrollToOffset(0);
    rowVirtualizer.measure();
  }, [columnCount, resetKey, rowVirtualizer, scrollElement]);

  return (
    <div ref={setListElement} className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">
      <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const rowStart = virtualRow.index * columnCount;
          const rowPeople = people.slice(rowStart, rowStart + columnCount);
          return (
            <div
              key={virtualRow.key}
              className="absolute left-0 top-0 flex w-full justify-center"
              style={{ height: `${rowHeight}px`, transform: `translateY(${virtualRow.start}px)` }}
            >
              <div
                className="grid"
                style={{
                  gap: `${GRID_GAP_PX}px`,
                  gridTemplateColumns: `repeat(${columnCount}, ${cardWidth}px)`,
                }}
              >
                {rowPeople.map((person) => (
                  <div key={person.id} style={{ width: `${cardWidth}px` }}>
                    {renderPerson(person)}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
