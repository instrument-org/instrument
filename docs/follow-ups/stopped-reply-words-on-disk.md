# Why the stopped-reply test fails on Linux CI

**Status:** closed 2026-10-26 · **Check after:** 2026-11-08, or the next CI failure of the test · **Last checked:** 2026-10-26

## What we're waiting to learn

`session.test.ts` "writes a stopped reply's words before its turn ends" failed on main's Linux CI in roughly one run in six from 10-21 to 10-25: the chat's `CHAT.md` written once the session was done held the user's message and none of the reply. It never failed on a Mac or on an Ubuntu VM, alone or in the full workspace suite. Every write on the stop path is awaited (`llm-request.ts` ends with `live.clear`, and the agent waits in `Aborting` for the request), so whether this is the product's ordering or the test's is not known.

The test used to compute the transcript on the first `session.done` the process published, from any session; it now reads once its own session is done, and on failure says which of two causes it saw. If the first was the cause, the failures stop.

## The signal

The test's failure message in a CI log:

- "reached the disk only after its session was done": the turn ended before the request's writes landed, a product race.
- "never reached the disk", followed by the `CHAT.md` it read: the write was lost or went somewhere else, for instance to a chat records entry left over from an earlier case.
- No failure by the check date: the old capture of another session's `session.done` was the likely cause.

## Where to look

CI runs on main, the "Check and Test" job's workspace `test:ci` output.

## What each answer means

- **Landed later:** trace what in `Finishing` or the session's `Done` can run before the request's last `#append` resolves under load, and fix the order in the machine.
- **Never landed:** check whether an earlier case's request still pins the chat in `chatRecords()` across `afterEach`'s `close` and `mockFs.restore`, and give each case its own chat if so.
- **No failure:** close this as not recurring.

## Result

Neither cause the signal named: the test's own wait. It waited for any text in the session before sending Stop, and the user's message and the session's context are text from the start, so on a slow runner Stop went out before the request had read a chunk and there were no words to write. A model stream held back 200 ms before its first chunk reproduced the failure every run, with the same CHAT.md and the same ~1.1 s. The wait now looks for the reply's own words. The product was never in question: a reply stopped before any words arrived has none to keep.
