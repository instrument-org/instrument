# Whether chats use instrument window look, and whether its pictures help

**Status:** open · **Check after:** 2027-01-06 · **Last checked:** never

## What we're waiting to learn

`instrument window look` gives the chat one picture of the person's window, blanked where the chat may not read, while it answers a message they just sent from that window. It costs about 1,900 input tokens a look and a fair amount of code: the command, the camera in the main process, the blanking of sides, pictures and fields, and the option that attaches the picture to the agent's feedback offer. In evals on a small model, chats looked for most questions only a picture answers once the window command told them to, and never looked for questions its text answers. Whether real chats look when it matters, and whether the picture changes their answer, only real use can tell. If they never reach for it, it should go.

The commits that ship it: `workspace,studio: add instrument window look for a picture of the window`, `workspace: tell the chat to look when asked how something on screen looks`, `workspace,studio: blank password, key and typing fields in window look` and `workspace,studio: attach the window picture to the agent's feedback offer`.

## The signal

Nothing new is logged for it. What is recorded today is enough on computers whose workspaces the team can read, and only the feedback reports reach further:

- **Looks taken:** in a chat's session logs, `tool-bash` parts whose command runs `instrument window look` and whose output has a `windowPicture`. Count them per chat and per week.
- **Looks refused:** the same calls answered `you can look at the user's window only while answering a message they just sent` (a look from a task or a woken turn) or `the model you run on can't see pictures`. Many of these mean the gate or the prompt is pointing chats at it at the wrong time.
- **Turns that called for a look:** user messages in the same chats asking how something looks or what is on screen (a color, a size or zoom, a card, a warning, "this button"). A rough text search finds candidates; read each one. Count the ones answered with a look, and the ones answered "I can't see your screen" without one.
- **Whether the picture helped:** for each look, read the reply after it. It helped when the reply says something only the picture shows; it did not when the reply repeats what `instrument window read` or `list` printed, or still says it can't tell.
- **Pictures on reports:** `offer_feedback` calls with `windowPicture: true` in session logs, and problem reports with a `window.png` attachment (`reports files <id>`).

If the logs show no looks and no turns that called for one, the question is still open: nobody asked. Move the date rather than conclude.

## Where to look

The `.instrument/chats/` records of workspaces on the team's own computers that ran a build with the look for at least a few weeks, and the problem reports from that period. The `chat-database-query` and `transcript-digest` skills read a chat's records.

## What each answer means

- **Chats look for most turns that call for it, and the replies use what the picture shows:** keep it, and close this.
- **Chats look, but the replies don't use it:** the picture is spent tokens. Check whether the blanking grays what was asked about; if not, remove it.
- **Turns call for it, chats don't look:** the prompt line isn't reaching the model. Try the wording once more against the evals in `packages/workspace/evals/cases/window-look.ts`, then remove it if real use stays flat.
- **No turn calls for it over the whole period:** remove it.

Removing it takes: the `windowLook` capability in `packages/workspace/src/lib/capabilities/window.ts` and its entries in `registry.ts`; `window-picture.ts`, `schemas/window-look.ts`, `shell-commands/window-pictures.ts`, the look's use of `chat/window-sends.ts` and the camera types in `types.ts`; the `windowPicture` output of `tools/bash.ts`; the look sentences in `model-text/commands/window-command.ts`; `window-look.ts` and `window-camera.ts` in Studio, the `data-secret-field` attributes, and the step picture in `tool-bash.tsx`; the `windowPicture` option of `offer_feedback` and the picture its card passes to the feedback form; the eval cases and fixtures under `window-look`; and the look's line in the threat model. Snapshots follow.

The only signal beyond the team's computers would be a count of looks taken and refused per model request in the activity log. Add it only if the team's own use is too thin to decide.

## Result

Not yet checked.
