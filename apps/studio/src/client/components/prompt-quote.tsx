import { XIcon } from "@phosphor-icons/react/X";

const keepCaret = (event: React.MouseEvent) => {
  event.preventDefault();
};

/** Quoted words over the prompt, with a button to take them out. Pressed, it shows where they are from. */
export function PromptQuote({
  onRemove,
  onShow,
  words,
}: {
  onRemove: () => void;
  onShow?: (words: string) => void;
  words: string;
}) {
  return (
    <div className="relative flex w-full gap-2.5 rounded-xl bg-foreground/4.5 p-2.5 pr-10 select-none">
      <span className="w-[3px] shrink-0 rounded-full bg-foreground/20" />
      <span className="min-w-0 text-[13px] leading-[22px] text-foreground/70">
        {words}
      </span>
      {onShow && (
        <button
          aria-label="Show quote in chat"
          className="absolute inset-0 cursor-pointer rounded-xl"
          onClick={() => {
            onShow(words);
          }}
          onMouseDown={keepCaret}
          tabIndex={-1}
          type="button"
        />
      )}
      <button
        aria-label="Remove quote"
        className="absolute top-[9px] right-[9px] grid size-6 cursor-pointer place-items-center rounded-full text-foreground/40 hover:bg-foreground/6 hover:text-foreground"
        onClick={onRemove}
        onMouseDown={keepCaret}
        tabIndex={-1}
        type="button"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
