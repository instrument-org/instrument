/**
 * Phosphor's ChatsCircle outline, redrawn as strokes so its weight can sit
 * between Phosphor's own: two bubbles overlapping pack twice the outline
 * into one box, so at the regular weight (16) it reads heavier than a single
 * shape's marks and at the light one (12) thinner. 14 matches them by eye.
 *
 * The geometry is Phosphor's, recovered from its paths: two circles of
 * radius 72 about (96,104) and (160,152), each with a tail at its corner. The
 * back one is an open path that stops where its centerline meets the front
 * one's outer edge (radius 79), so its round caps tuck under the front
 * stroke. It takes no mask: the app window keeps every tab mounted in one
 * document, so a mask's id repeats, and `url(#id)` resolving to a copy in a
 * hidden tab drops the masked bubble from every copy.
 */
export function ChatsOutlineIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={14}
      viewBox="0 0 256 256"
    >
      <path d="M31.74 136.5A72 72 0 1 1 63.5 168.26L20.19 179.81Z" />
      <path d="M171.56 80.93A72 72 0 0 1 224.26 184.5L235.81 227.81L192.5 216.26A72 72 0 0 1 95.01 182.99" />
    </svg>
  );
}
