/**
 * Fades a tab title out at its right edge, so a name too long for its tab
 * dissolves instead of being cut off mid-letter.
 *
 * The window's tab bar, where the close control sits in the flow beside the
 * title. The title's box therefore ends before the control begins, and the
 * gradient only has to soften the last of the text: it may still be reaching
 * transparent at the very edge, because nothing is drawn over it.
 *
 * The task pane's strip needs a different gradient for the same job, because
 * its control is drawn on top of the title rather than beside it. That one is
 * the `tab-title-fade` utility in globals.css, which explains the difference.
 */
export const tabTitleMaskStyle = {
  maskImage:
    "linear-gradient(to right, #000 0%, #000 calc(100% - 1.5rem), transparent 100%)",
  WebkitMaskImage:
    "linear-gradient(to right, #000 0%, #000 calc(100% - 1.5rem), transparent 100%)",
} as const;
