import {
  BrandVariants,
  Theme,
  createDarkTheme,
  createLightTheme,
} from "@fluentui/react-components";

export const OFFICE_WORD_BRAND = {
  10: "#020305",
  20: "#0D1520",
  30: "#142338",
  40: "#182F4D",
  50: "#1B3C63",
  60: "#1E4979",
  70: "#205790",
  80: "#2165A8",
  90: "#2174C0",
  100: "#2B579A",
  110: "#3A6BAE",
  120: "#4A7FC2",
  130: "#5B93D6",
  140: "#6DA7EA",
  150: "#8FBCF5",
  160: "#B2D1FF",
} satisfies BrandVariants;

export const OFFICE_WORD_BRAND_COLOR = OFFICE_WORD_BRAND[100];

export const WINDOWS_SYSTEM_FONT =
  '"Segoe UI Variable", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif';

export const WINDOWS_MONOSPACE_FONT =
  'Cascadia Mono, Consolas, "Courier New", monospace';

export const NATIVE_RADIUS = {
  none: "0",
  small: "4px",
  medium: "6px",
  large: "8px",
  xLarge: "8px",
} as const;

export const NATIVE_CONTROL_HEIGHT = {
  compact: "28px",
  regular: "32px",
  comfortable: "36px",
} as const;

export const NATIVE_STROKE_WIDTH = {
  thin: "1px",
  focus: "2px",
} as const;

export type TaskpaneColorScheme = "light" | "dark";

export const taskpaneLightTheme: Theme = {
  ...createLightTheme(OFFICE_WORD_BRAND),
  fontFamilyBase: WINDOWS_SYSTEM_FONT,
  borderRadiusSmall: NATIVE_RADIUS.small,
  borderRadiusMedium: NATIVE_RADIUS.medium,
  borderRadiusLarge: NATIVE_RADIUS.large,
  borderRadiusXLarge: NATIVE_RADIUS.xLarge,
};

export const taskpaneDarkTheme: Theme = {
  ...createDarkTheme(OFFICE_WORD_BRAND),
  fontFamilyBase: WINDOWS_SYSTEM_FONT,
  borderRadiusSmall: NATIVE_RADIUS.small,
  borderRadiusMedium: NATIVE_RADIUS.medium,
  borderRadiusLarge: NATIVE_RADIUS.large,
  borderRadiusXLarge: NATIVE_RADIUS.xLarge,
};

