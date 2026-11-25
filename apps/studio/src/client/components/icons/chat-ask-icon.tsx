/**
 * A chat's bubble with a question mark in it: the chat waits on the person.
 * Phosphor's bold chat bubble and the bold mark of its Question, so it stands
 * in for the plain bubble at the same weight.
 */
export function ChatAskIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      data-chat-asks=""
      fill="currentColor"
      viewBox="0 0 256 256"
    >
      <path d="M128,20A108,108,0,0,0,31.85,177.23L21,209.66A20,20,0,0,0,46.34,235l32.43-10.81A108,108,0,1,0,128,20Zm0,192a84,84,0,0,1-42.06-11.27,12,12,0,0,0-6-1.62,12.1,12.1,0,0,0-3.8.62l-29.79,9.93,9.93-29.79a12,12,0,0,0-1-9.81A84,84,0,1,1,128,212Z" />
      <path d="M144,180a16,16,0,1,1-16-16A16,16,0,0,1,144,180ZM128,64c-24.26,0-44,17.94-44,40v4a12,12,0,0,0,24,0v-4c0-8.82,9-16,20-16s20,7.18,20,16-9,16-20,16a12,12,0,0,0-12,12v8a12,12,0,0,0,23.73,2.56C158.31,137.88,172,122.37,172,104,172,81.94,152.26,64,128,64Z" />
    </svg>
  );
}
