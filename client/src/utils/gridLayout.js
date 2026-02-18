/**
 * input: 基础数据结构
 * output: 纯函数工具（布局/格式化等）
 * pos: 客户端工具层：无 IO 的可测试逻辑（变更需同步更新本头注释与所属目录 README）
 */

// Shared layout constants for thumbnail grids.
// Card: thumb(160) + bottom(64) = 224.

export const GRID_COLUMNS = 4;
export const CARD_HEIGHT_PX = 224;
export const ROW_GAP_PX = 16;
export const ROW_HEIGHT_PX = CARD_HEIGHT_PX + ROW_GAP_PX;


