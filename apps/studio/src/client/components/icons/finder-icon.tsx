/** The profile that splits the face, the eyes, and the smile. */
const FACE =
  "M140 32q-28 60-36 116h28q-4 40 4 76M84 88v20M172 88v20M80 172q48 26 96 0";

/**
 * The Finder's face as a line glyph, drawn to Phosphor's grid so it stands
 * with the rail's other marks: a 256 box, a rounded square as wide as
 * Phosphor's globe, and 16-unit round strokes for the profile that splits
 * the face, the eyes, and the smile. Phosphor has no Finder of its own.
 * The regular weight is one path, so a translucent `currentColor` paints
 * each crossing once rather than darkening where the profile meets the
 * square. `fill` is the square solid with the face cut out of it, the way
 * Phosphor's filled weights knock their details out.
 */
export function FinderIcon({
  className,
  weight = "regular",
}: {
  className?: string;
  weight?: "fill" | "regular";
}) {
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
            <path d={FACE} stroke="black" />
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
        <path
          d={`M64 32h128a32 32 0 0 1 32 32v128a32 32 0 0 1-32 32H64a32 32 0 0 1-32-32V64a32 32 0 0 1 32-32Z${FACE}`}
        />
      )}
    </svg>
  );
}
