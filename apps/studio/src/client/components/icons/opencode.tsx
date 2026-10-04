export function OpenCode({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="currentColor"
      viewBox="96 96 320 320"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M320 224V352H192V224H320Z" opacity={0.4} />
      <path
        clipRule="evenodd"
        d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z"
        fillRule="evenodd"
      />
    </svg>
  );
}
