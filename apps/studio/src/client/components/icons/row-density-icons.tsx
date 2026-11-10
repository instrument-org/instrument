/**
 * The chat list's row densities, each drawn as one row: a rounded box holding
 * as many lines as the row shows, so the box is shorter for fewer lines.
 * Drawn to Phosphor's grid (a 256 box and 16-unit round strokes) so they sit
 * with the menu's other marks.
 */
function RowDensityIcon({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
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
      {children}
    </svg>
  );
}

export function ThreeLinesIcon({ className }: { className?: string }) {
  return (
    <RowDensityIcon className={className}>
      <rect height="176" rx="28" width="192" x="32" y="40" />
      <path d="M72 88H184M72 128H160M72 168H128" />
    </RowDensityIcon>
  );
}

export function TwoLinesIcon({ className }: { className?: string }) {
  return (
    <RowDensityIcon className={className}>
      <rect height="128" rx="28" width="192" x="32" y="64" />
      <path d="M72 108H184M72 148H144" />
    </RowDensityIcon>
  );
}

export function OneLineIcon({ className }: { className?: string }) {
  return (
    <RowDensityIcon className={className}>
      <rect height="80" rx="28" width="192" x="32" y="88" />
      <path d="M72 128H184" />
    </RowDensityIcon>
  );
}
