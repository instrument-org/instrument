/**
 * Help's mark in the app rail: a speech bubble whose tail sits at the lower
 * left, with a question mark inside, on Phosphor's 256 grid at its regular
 * 16-unit stroke. The tail keeps it apart from Chat's round bubble at the top
 * of the rail.
 */
export function RailHelpIcon({ className }: { className?: string }) {
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
      <path d="M132 216H47.7a7.7 7.7 0 0 1-7.7-7.7V124a92 92 0 0 1 92-92a92 92 0 0 1 92 92a92 92 0 0 1-92 92Z" />
      <path d="M112 96a22 22 0 1 1 30 20.5c-6 2.3-10 7-10 13.5v4" />
      <circle cx="132" cy="166" fill="currentColor" r="12" stroke="none" />
    </svg>
  );
}
