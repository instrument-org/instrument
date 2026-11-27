# Boxed transcript turns: known gaps

**Status:** open, checked 2026-11-27. Each gap below is small and was left when far turns became boxes ([transcript-virtualization.md](../plans/transcript-virtualization.md), [far-rows.ts](../../apps/studio/src/client/components/ui/scroll-owner/far-rows.ts)); none loses words or moves the reader's place in the checks that exist.

- **A turn a link reached stays drawn.** A quote chip or `#heading` link into a boxed turn draws it through `keepDrawn`, and nothing releases it until the next such link, so one far turn can stay drawn for the life of the transcript.
- **A heading link scrolls on its own.** It lands with one smooth scroll to a fixed position rather than through `ScrollOwner`. Unchecked: whether boxes above drawing during that scroll push the heading off the spot.
- **A link inside a table or the composer searches only that container.** Older than boxing; boxing only makes the miss likelier.
- **Streaming during a zoom skews box heights.** A box with no height measured at the new width scales by the ratio the drawn rows changed by in the same resize, and a drawn row growing from streamed text in that resize counts as zoom.
- **A wrap choice made while a code block's first line streams is lost if its turn then boxes.**
- **Two code blocks in one turn with the same language and first line share their wrap and expand state** in `kept-open.ts`, since that is what keys them.
