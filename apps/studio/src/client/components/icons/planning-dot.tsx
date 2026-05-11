export function PlanningDotIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 12 12"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="6" cy="6" fill="url(#planning-dot-gradient)" r="6" />
      <defs>
        <radialGradient
          cx="0"
          cy="0"
          gradientTransform="translate(6) rotate(90) scale(12)"
          gradientUnits="userSpaceOnUse"
          id="planning-dot-gradient"
          r="1"
        >
          <stop stopColor="#DF3C23" />
          <stop offset="1" stopColor="#F96B55" />
        </radialGradient>
      </defs>
    </svg>
  );
}
