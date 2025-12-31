/**
 * input: 通用参数（className/配置）
 * output: 通用工具/小库封装
 * pos: 客户端通用库层：跨组件复用（变更需同步更新本头注释与所属目录 README）
 */

import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
