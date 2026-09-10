import { useLayoutEffect, useMemo, useState } from 'react';
import { getGridMetrics } from '../utils/gridLayout';

export function useResponsiveGridMetrics(containerRef, { horizontalPadding = 0 } = {}) {
  const [availableWidth, setAvailableWidth] = useState(0);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;

    const measure = () => {
      const nextWidth = Math.max(0, element.clientWidth - horizontalPadding);
      setAvailableWidth((current) => (Math.abs(current - nextWidth) < 1 ? current : nextWidth));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef, horizontalPadding]);

  return useMemo(() => getGridMetrics(availableWidth), [availableWidth]);
}
