import { cn } from "@/client/lib/utils";

import { completeLines } from "./parse-body";
import { parseNumbers } from "./parse-numbers";
import { useReplyMarkdown } from "./reply-markdown-context";

/**
 * A numbers block: a few key figures set large enough to read at a glance,
 * each with its label over it and its note under it, in as many columns as
 * the block's width fits. A value that is words rather than a figure stays at
 * the text's size. Nothing around them: no box, rule, color or icon.
 */
export function NumbersBlock({
  code,
  isArriving,
}: {
  code: string;
  isArriving: boolean;
}) {
  const markdown = useReplyMarkdown();
  const { figures, rest } = parseNumbers(completeLines(code, isArriving));

  if (figures.length === 0) {
    return isArriving || rest.length === 0 ? null : (
      <>{markdown.block(rest.join("\n"))}</>
    );
  }

  return (
    <>
      {/* Four figures pair up two by two until a row fits all four, so
          none is left alone on a row of its own. */}
      <div className="not-prose @container my-[1.5em] first:mt-0 last:mb-0">
        <dl
          className={cn(
            "grid gap-x-[1.5em] gap-y-[1.25em]",
            figures.length === 4
              ? "grid-cols-2 @[41rem]:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]"
              : "grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]",
          )}
          data-slot="numbers"
        >
        {figures.map((figure, index) => (
          <div className="flex min-w-0 flex-col" key={index}>
            <dt className="text-[0.8125em] text-muted-foreground">
              {markdown.inline(figure.label)}
            </dt>
            <dd
              className={cn(
                "mt-[0.125em]",
                figure.isWords
                  ? "leading-snug"
                  : "text-[1.5em] leading-tight font-medium tracking-tight tabular-nums",
              )}
            >
              {markdown.inline(figure.value)}
            </dd>
            {figure.note && (
              <dd className="mt-[0.25em] text-[0.8125em] leading-snug text-muted-foreground">
                {markdown.inline(figure.note)}
              </dd>
            )}
          </div>
        ))}
        </dl>
      </div>
      {rest.length > 0 && markdown.block(rest.join("\n"))}
    </>
  );
}
