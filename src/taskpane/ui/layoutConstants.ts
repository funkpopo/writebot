export const PAGE_BOTTOM_SAFE_PADDING = "calc(20px + env(safe-area-inset-bottom, 0px))";

export const PAGE_PADDING_X = "12px";
export const PAGE_PADDING_Y = "8px";

export const BREAKPOINT_XS = 320;

export function mediaMaxWidth(px: number) {
  return `@media (max-width: ${px}px)` as const;
}

export const CONTROL_HEIGHT_SM = "28px";
export const CONTROL_HEIGHT_MD = "32px";
export const CONTROL_HEIGHT_LG = "36px";
export const COMMAND_BUTTON_MIN_HEIGHT = "52px";
export const LIST_ROW_MIN_HEIGHT = "40px";

export const SPACING = {
  xs: "4px",
  sm: "6px",
  md: "8px",
  lg: "12px",
  xl: "16px",
} as const;
