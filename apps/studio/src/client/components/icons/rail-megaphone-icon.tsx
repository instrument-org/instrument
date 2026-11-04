/**
 * Feedback's mark in the app rail: Phosphor's simple megaphone, redrawn on its
 * 256 grid with a 14-unit stroke. The inner wall and the handle put three
 * parallel lines around a small pocket, which at 16 units reads heavier than
 * the rail's other marks even though it measures the same.
 *
 * The horn and the inner wall are one path because the rail's muted color is
 * translucent in dark mode: a path's stroke paints once, where two paths'
 * strokes would double up at the joins.
 */
export function RailMegaphoneIcon({ className }: { className?: string }) {
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
      {/* The horn, then the inner wall running on down into the handle. */}
      <path d="M226.2 94.3 50.2 40.3A8 8 0 0 0 40 48v144a8 8 0 0 0 10.2 7.7l176-54a8 8 0 0 0 5.8-7.7v-36a8 8 0 0 0-5.8-7.7ZM144 69.1V192a8 8 0 0 0 8 8h32a8 8 0 0 0 8-8v-35.8" />
    </svg>
  );
}
