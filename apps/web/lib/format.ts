/** 与 shadcn Select 对齐的原生 select 样式（服务端筛选用） */
export const selectCls =
  'h-8 max-w-56 cursor-pointer rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-input/30';

const PREVIEW_EXT = /\.(png|jpe?g|webp|gif|avif|bmp|mp4|webm|mov)$/i;

/** 工作流 JSON 等文件类产物不能当图片渲染 */
export const isPreviewable = (path: string) => PREVIEW_EXT.test(path);
