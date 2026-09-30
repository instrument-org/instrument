/**
 * The Finder's face as a line glyph, drawn to Phosphor's grid so it stands
 * with the rail's other marks: a 256 box, a rounded square as wide as
 * Phosphor's globe, and 16-unit round strokes for the profile that splits
 * the face, the eyes, and the smile. Phosphor has no Finder of its own.
 * `fill` is the square solid with the face cut out of it, the way Phosphor's
 * filled weights knock their details out.
 */
export function FinderIcon({
  className,
  weight = "regular",
}: {
  className?: string;
  weight?: "fill" | "regular";
}) {
  const face = (
    <>
      <path d="M140 32q-28 60-36 116h28q-4 40 4 76" />
      <path d="M84 88v20M172 88v20" />
      <path d="M80 172q48 26 96 0" />
    </>
  );
  return (
    <svg
      aria-hidden
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={16}
      viewBox="0 0 256 256"
    >
      {weight === "fill" ? (
        <>
          <mask id="finder-icon-face">
            <rect fill="white" height="256" stroke="none" width="256" />
            <g stroke="black">{face}</g>
          </mask>
          {/* Out to the regular square's outer edge, half a stroke past its
            path, so the two weights are one size. */}
          <rect
            fill="currentColor"
            height="208"
            mask="url(#finder-icon-face)"
            rx="40"
            stroke="none"
            width="208"
            x="24"
            y="24"
          />
        </>
      ) : (
        <>
          <rect height="192" rx="32" width="192" x="32" y="32" />
          {face}
        </>
      )}
    </svg>
  );
}
