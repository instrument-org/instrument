import { Markdown } from "@/client/components/markdown";
import { REASONING_PROSE } from "@/client/components/reasoning-message";
import { SessionMarkdown } from "@/client/components/session-markdown";
import { cn } from "@/client/lib/utils";
import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/_app/debug/components/typography")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Debug typography" }],
  }),
});

/**
 * The column a transcript is actually read at.
 *
 * `max-w-3xl` inside `p-4` is what `chat.tsx` gives `MessageScrollerContent`,
 * so a specimen set any wider answers a question nobody asked: leading, heading
 * scale, and list indent are all judgments about line length, and line length
 * in the product is 736px.
 *
 * It goes on a wrapper rather than on the prose itself, because
 * `.prose.prose-custom` sets `max-width: none` at a specificity a `max-w-*`
 * utility cannot reach. A cap written onto the prose element reads as though it
 * were doing something and is not.
 */
const TRANSCRIPT_COLUMN = "w-full max-w-[736px]";

/** What an assistant turn sets over `SessionMarkdown`'s own base. */
const TRANSCRIPT_PROSE = "text-[15px]/[1.5]";

const PROSE = [
  "Revenue is up 11% on the quarter, but almost none of that is the price change we shipped in April. Stripping out the two enterprise renewals that happened to land in the same week, the underlying number is closer to 4%, which is the third quarter in a row at roughly that rate.",
  "The more interesting movement is underneath. Self-serve conversion held flat while the number of trials rose by a third, which means the funnel absorbed the extra volume without degrading. That is the first quarter this year where that is true, and it is the number I would lead with.",
].join("\n\n");

const HEADINGS = [
  "# A first-level heading",
  "The paragraph under it, which the heading is meant to own rather than float above.",
  "## A second-level heading",
  "Prose again, at the size the body is set in.",
  "### A third-level heading",
  "And once more, to show where the scale lands against the paragraph.",
  "#### A fourth-level heading",
  "##### A fifth, straight onto a sixth",
  "###### The last one, which is the same size as the fifth",
  "Two headings in a row keep the space between them that a heading and its own first block give up.",
].join("\n\n");

/**
 * The bold-only paragraph, which the Markdown renderer marks as a section
 * label, in each position that decides a different margin.
 *
 * The last one is the shape that must stay ordinary. `:only-child` counts
 * element siblings, so CSS alone cannot tell a whole bold paragraph from a bold
 * lead-in with text after it; the renderer marks the parsed shape instead.
 */
const SECTION_LABELS = [
  "**Opening straight onto a label**",
  "A label as the first block takes no space above it, because there is nothing above it to be held apart from.",
  "A paragraph before the next label, long enough to wrap onto a second line so the space above the label is read against a full measure rather than a short one.",
  "**After a paragraph**",
  "The block under a label sits tight against it, which is the pairing the rhythm is for: a label belongs to what follows rather than to what came before.",
  "- Pull the account-level export\n- Split North by cohort\n- Re-run the chart script",
  "**After a list**",
  "A completed list already reads as a block, so this boundary is set a step tighter than the one above it.",
  "**Priority:** an ordinary sentence that opens with a bold lead-in, which is not a section label and keeps a paragraph's own rhythm.",
].join("\n\n");

const LISTS = [
  "A tight list, where no item carries a paragraph of its own:",
  "- North moved on volume rather than on price\n- South is flat, and has been flat long enough that flat is the forecast\n- East fell 6%, entirely inside a single account",
  "A loose one, where they do, and every item opens up to match:",
  "- **North.** The only region that moved. The growth is volume, and it is concentrated in the last four weeks.\n\n- **South.** Flat for four quarters. There is nothing here to explain.",
  "Ordered, and nested, which is where the gutter and the indent have to agree:",
  "1. Pull the account-level export.\n2. Split North by cohort.\n   - By signup month\n   - By plan at signup\n3. Re-run the chart script.",
].join("\n\n");

const CODE = [
  "```ts\nexport function quarterFile(quarter: number): string {\n  return `q${quarter}.csv`;\n}\n```",
  "The filename was interpolated once and cached at module scope, so `quarterFile` returned `q1.csv` for every quarter and inline code sits at full weight in the middle of a sentence.",
  "```bash\npnpm test run src/client/components\n```",
].join("\n\n");

const TABLES = [
  "| Region | Change | Driver |\n| --- | ---: | --- |\n| North | +11% | Volume, not price |\n| South | 0% | Flat for four quarters |\n| East | -6% | One account churned |",
  "A wide one takes the room the column has and scrolls inside itself rather than widening the transcript:",
  "| Product | Pack price | Per can | Caffeine | Calories and sugar | Takeaway |\n| --- | ---: | ---: | ---: | --- | --- |\n| Sparkling Ice +Caffeine | $15.11 / 12 | $1.26 | 70 mg | ~5 calories, zero sugar | Best value |\n| PHOCUS Caffeinated | $25.99 / 12 | $2.17 | 75 mg | Zero calories, zero sugar | Closest alternative |\n| JUNO Energy | $32.99 / 12 | $2.75 | 125 mg | Sugar-free | More caffeine, pricier |",
].join("\n\n");

const QUOTES = [
  "> The reclassification was an administrative change made in the first week of August. It is recorded in the notes but not reflected in the per-quarter files.",
  "A rule closes one part of an answer against the next:",
  "---",
  "Everything above is in the written summary in the reports folder.",
].join("\n\n");

/** A thought, which is the shape the compact panel below is tuned for. */
const THOUGHT = [
  "**Reading the quarters**",
  "Four files, one per quarter, and the chart script that draws from them.",
  "**What looks wrong**",
  "Every chart is drawn from January data, so the filename is being interpolated once and cached rather than rebuilt per quarter.",
  "**What to check next**",
  "Whether the decks already issued were drawn from the same cached path.",
].join("\n\n");

/** Everything at once, which is the only way the rhythm as a whole is legible. */
const WHOLE_ANSWER = [
  "## What actually moved",
  "Revenue is up 11% on the quarter, and almost none of it is the price change. Two enterprise renewals landed in the same week; stripping them out leaves roughly 4%, which is the third quarter in a row at that rate.",
  "**The regions**",
  "- North moved, on volume rather than price\n- South is flat, and has been for four quarters\n- East fell 6%, entirely inside one churned account",
  "### The chart script",
  "It was reading `q1.csv` for every quarter, because the filename was interpolated once and cached at module scope:",
  "```ts\nconst file = `q${quarter}.csv`;\n```",
  "The fix is in, but the historical charts are wrong and someone has to decide whether to reissue them.",
  "> Standard practice would be to restate the prior periods so the comparison holds. That has not been done here.",
  "**What I would look at next**",
  "Whether the February churn in East was one account or the start of something, which needs an export nobody has pulled yet.",
].join("\n\n");

function RouteComponent() {
  return (
    <div className="size-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-14 px-8 py-10">
        <header className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">
            Components
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Typography</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Session prose as the product draws it, at the 736px column a
            transcript is read at. Every specimen is the real SessionMarkdown,
            so what is here is what a turn renders.
          </p>
        </header>

        <Specimen
          note="An assistant turn's own size over SessionMarkdown's base, at roughly 95 characters a line."
          title="Transcript prose"
        >
          <TranscriptProse markdown={PROSE} />
        </Specimen>

        <Specimen
          note="Sans and compact for a session, from the prose-session variant. A heading and its first block are one unit; two headings in a row are not."
          title="Headings"
        >
          <TranscriptProse markdown={HEADINGS} />
        </Specimen>

        <Specimen
          note="The same document without prose-session, which is what a rendered file gets: serif, larger, editorial."
          title="Headings, editorial"
        >
          <div
            className={cn(
              "prose prose-custom w-full font-serif dark:prose-invert",
              TRANSCRIPT_PROSE,
            )}
          >
            <Markdown markdown={HEADINGS} />
          </div>
        </Specimen>

        <Specimen
          note="A paragraph whose entire contents are bold reads as a section break: open above, tight onto what it introduces."
          title="Section labels"
        >
          <TranscriptProse markdown={SECTION_LABELS} />
        </Specimen>

        <Specimen note="Tight and loose, ordered and nested." title="Lists">
          <TranscriptProse markdown={LISTS} />
        </Specimen>

        <Specimen note="Fenced and inline." title="Code">
          <TranscriptProse markdown={CODE} />
        </Specimen>

        <Specimen note="Narrow, then wider than the column." title="Tables">
          <TranscriptProse markdown={TABLES} />
        </Specimen>

        <Specimen note="Blockquote and rule." title="Quotes and rules">
          <TranscriptProse markdown={QUOTES} />
        </Specimen>

        <Specimen
          note="The panel a thought is drawn in caps itself at 176px and fades at both edges, so its rhythm is deliberately tighter than a transcript's. The box is small here because it is small in the product."
          title="A thought"
        >
          <div className="max-h-44 w-full overflow-y-auto scroll-fade-y">
            <SessionMarkdown
              className={cn(REASONING_PROSE, "w-full opacity-100")}
              markdown={THOUGHT}
            />
          </div>
        </Specimen>

        <Specimen
          note="Every block against every other one, which is the only way the rhythm as a whole can be judged."
          title="A whole answer"
        >
          <TranscriptProse markdown={WHOLE_ANSWER} />
        </Specimen>
      </div>
    </div>
  );
}

/** One titled specimen, with the type it resolved to read back off the DOM. */
function Specimen({
  children,
  note,
  title,
}: {
  children: ReactNode;
  note: string;
  title: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [readout, setReadout] = useState("");

  useEffect(() => {
    const root = ref.current?.querySelector(".prose");
    if (root instanceof HTMLElement) {
      const style = globalThis.getComputedStyle(root);
      setReadout(`${style.fontSize} / ${style.lineHeight}`);
    }
  }, []);

  return (
    <section className="flex flex-col gap-4 border-t border-border pt-6">
      <div className="flex items-baseline gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
          {readout}
        </p>
      </div>
      <p className="max-w-2xl text-sm text-muted-foreground">{note}</p>
      <div className={TRANSCRIPT_COLUMN} ref={ref}>
        {children}
      </div>
    </section>
  );
}

/** Session Markdown exactly as an assistant turn sets it. */
function TranscriptProse({ markdown }: { markdown: string }) {
  return (
    <SessionMarkdown
      className={cn("w-full", TRANSCRIPT_PROSE)}
      markdown={markdown}
    />
  );
}
