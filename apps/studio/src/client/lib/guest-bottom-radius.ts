/**
 * The bottom corners of the frame `element` sits in, as that frame says them
 * through `--guest-bottom-radius` ("left [right]"), square where none does.
 */
export function guestBottomCorners(element: Element) {
  const said =
    getComputedStyle(element)
      .getPropertyValue("--guest-bottom-radius")
      .trim() || "0px";
  const [bottomLeft = said, bottomRight = bottomLeft] = said.split(/\s+/);
  return { bottomLeft, bottomRight };
}
