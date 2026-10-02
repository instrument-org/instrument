/**
 * Phosphor's ChatsCircle outline, redrawn as strokes so its weight can sit
 * between Phosphor's own: two bubbles overlapping pack twice the outline
 * into one box, so at the regular weight (16) it reads heavier than a single
 * shape's marks and at the light one (12) thinner. 14 matches them by eye.
 *
 * The geometry is Phosphor's, recovered from its paths: two circles of
 * radius 72 about (96,104) and (160,152), each with a tail at its corner, and
 * the front one hidden where it runs under the back one, out to the back
 * one's outer edge.
 */
export function ChatsOutlineIcon({ className }: { className?: string }) {
  const weight = 14;
  return (
    <svg
      aria-hidden
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={weight}
      viewBox="0 0 256 256"
    >
      <mask id="chats-outline-icon-front">
        <rect fill="white" height="256" width="256" />
        <circle cx="96" cy="104" fill="black" r={72 + weight / 2} />
      </mask>
      <path d="M31.74 136.5A72 72 0 1 1 63.5 168.26L20.19 179.81Z" />
      <path
        d="M224.26 184.5A72 72 0 1 0 192.5 216.26L235.81 227.81Z"
        mask="url(#chats-outline-icon-front)"
      />
    </svg>
  );
}
