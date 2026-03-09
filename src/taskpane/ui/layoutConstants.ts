export const PAGE_BOTTOM_SAFE_PADDING = "calc(20px + env(safe-area-inset-bottom, 0px))";

export const PAGE_PADDING_X = "12px";
export const PAGE_PADDING_Y = "8px";

export const BREAKPOINT_XS = 320;

export function mediaMaxWidth(px: number) {
  return `@media (max-width: ${px}px)` as const;
}

export const SPACING = {
  xs: "4px",
  sm: "6px",
  md: "8px",
  lg: "12px",
  xl: "16px",
} as const;

