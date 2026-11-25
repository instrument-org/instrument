/**
 * A document's page thumbnails: two small solid pages beside the page, on
 * Phosphor's 256 grid, apart from the sidebar mark it can stand next to.
 */
export function ThumbnailsIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth={20}
      viewBox="0 0 256 256"
    >
      <g fill="currentColor" stroke="none">
        <rect height="80" rx="12" width="64" x="24" y="32" />
        <rect height="80" rx="12" width="64" x="24" y="144" />
      </g>
      <rect height="172" rx="12" width="108" x="122" y="42" />
    </svg>
  );
}
