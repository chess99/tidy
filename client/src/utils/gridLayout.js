// Shared layout constants for virtual thumbnail grids.
export const DEFAULT_GRID_COLUMNS = 4;
export const GRID_PAGE_SIZE = 200;
export const GRID_GAP_PX = 16;
export const GRID_MIN_CARD_WIDTH_PX = 232;
export const GRID_THUMB_ASPECT_RATIO = 4 / 3;
export const GRID_CARD_META_HEIGHT_PX = 80;
export const DEFAULT_GRID_CARD_WIDTH_PX = 288;

export function getGridMetrics(availableWidth) {
  const width = Number(availableWidth);
  const hasWidth = Number.isFinite(width) && width > 0;
  const columns = hasWidth
    ? Math.max(1, Math.floor((width + GRID_GAP_PX) / (GRID_MIN_CARD_WIDTH_PX + GRID_GAP_PX)))
    : DEFAULT_GRID_COLUMNS;
  const cardWidth = hasWidth
    ? Math.max(1, (width - GRID_GAP_PX * (columns - 1)) / columns)
    : DEFAULT_GRID_CARD_WIDTH_PX;
  const thumbnailHeight = Math.round(cardWidth / GRID_THUMB_ASPECT_RATIO);

  return {
    columns,
    cardWidth,
    thumbnailHeight,
    rowHeight: thumbnailHeight + GRID_CARD_META_HEIGHT_PX + GRID_GAP_PX,
  };
}
