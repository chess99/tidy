/**
 * input: 滚动容器 ref + 水平内边距
 * output: 随容器宽度变化的网格列数与卡片尺寸
 * pos: 客户端交互状态层：为虚拟网格提供稳定的响应式布局指标（变更需同步更新本头注释与所属目录 README）
 */

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
