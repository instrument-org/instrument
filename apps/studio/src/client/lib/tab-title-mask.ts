/**
 * Fades a tab title out at its right edge, so a name too long for its tab
 * dissolves instead of being cut off mid-letter.
 *
 * The window's tab bar, where the close control sits in the flow beside the
 * title. The title's box therefore ends before the control begins, and the
 * gradient only has to soften the last of the text: it may still be reaching
 * transparent at the very edge, because nothing is drawn over it.
 */
export const tabTitleMaskStyle = {
  maskImage:
    "linear-gradient(to right, #000 0%, #000 calc(100% - 1.5rem), transparent 100%)",
  WebkitMaskImage:
    "linear-gradient(to right, #000 0%, #000 calc(100% - 1.5rem), transparent 100%)",
} as const;

// The task pane's strip, where the close control is positioned over the title
// rather than beside it, so the tab is the width of its name and does not
// resize when the control appears.
//
// That makes the geometry different in a way that matters: the title has to be
// *fully* transparent everywhere the control is drawn, not merely on its way
// there. Reaching transparent at 100% leaves the text at roughly four fifths
// opacity under the control's left half, which reads as text showing through a
// button. So the gradient finishes early -- clear by 0.75rem from the end,
// which is where the control starts once the title's own padding is counted --
// and the last stop holds that transparency to the edge.
const OVERLAID_MASK =
  "linear-gradient(to right, #000 0%, #000 calc(100% - 1.5rem), transparent calc(100% - 0.75rem), transparent 100%)";

export const overlaidTabTitleMaskStyle = {
  maskImage: OVERLAID_MASK,
  WebkitMaskImage: OVERLAID_MASK,
} as const;
