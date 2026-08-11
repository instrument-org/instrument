/**
 * Fades a tab title out under the close control that overlaps its right edge.
 *
 * Shared by the window's tab bar and the task pane's strip so the two agree on
 * where the name stops being readable, which is the width of the control the
 * fade runs beneath.
 */
export const tabTitleMaskStyle = {
  maskImage:
    "linear-gradient(to right, #000 0%, #000 calc(100% - 1.5rem), transparent 100%)",
  WebkitMaskImage:
    "linear-gradient(to right, #000 0%, #000 calc(100% - 1.5rem), transparent 100%)",
} as const;
