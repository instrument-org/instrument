# Plan: grouping a run of tool calls under what it is for

Status: **in progress -- the control tool, the heading, and collapsing groups are built; the cadence nudge and the animated swap are not.** Owner: TBD.

A transcript that gives every call its own sentence repeats itself: "Reading the note", "Reading the next note", "Reading the third note". The user needs one line above the run of them saying why it is happening. The research behind this, including what Manus, Codex, ACP, and Gemini CLI actually expose, is [Research: Grouped Tool-Call Activities in Provider-Agnostic Agent Harnesses](https://app.notion.com/p/3b38f368f2d781c2b942ea62328f7a0e).

## What is built

`start_activity` ([start-activity.ts](../../../packages/workspace/src/tools/start-activity.ts)), a control tool that touches nothing and exists to be shown. Its only field is a `title`: the heading is one line, and a second sentence under it neither fits nor earns the tokens.

It renders as an iconless heading ([group-heading.tsx](../../../apps/studio/src/client/components/message-part/group-heading.tsx)) with the calls of its span indented beneath it, and reads as running (the same dot and moving text any in-flight row uses) while the agent is still working inside it.

**How it gets looked at: the transcript page**, `/debug/components/transcript`. A scenario is a list of the things the agent did ([script.ts](../../../apps/studio/src/client/routes/_app/debug/-transcript/script.ts)); `buildFrames` folds it into every state the transcript passes through on the way ([frames.ts](../../../apps/studio/src/client/routes/_app/debug/-transcript/frames.ts)); the page scrubs, plays, and single-steps that list through the real chat stream in the real scroller. Because a frame is the fold of the first `n` events and nothing else, dragging, playing, and stepping cannot disagree, and there is no timer in the model at all. Parts keep the id they were born with across their states, so a call is one row changing rather than a row replaced -- which is the difference the rendering rules turn on.

Two things it fixes that a fixed fixture cannot. The **states between states** -- a call arriving, queued behind another, running, finished -- only exist for a moment each, and every one of them is a frame here. And scenarios are **typed against the tools**: `input` and `output` are read off the part union by `type`, so a call with the wrong fields, or one naming a tool that has been renamed or removed, is a compile error rather than a fixture that quietly rots. `unavailable` is the one tool left out, since the runtime builds it from whatever the model sent and its input is `any`.

[frames-render.test.tsx](../../../apps/studio/src/client/routes/_app/debug/-transcript/frames-render.test.tsx) draws every frame of every scenario and checks what has to hold in all of them: at most one row marked as the work in flight, no empty group box, and nothing indented until a group is opened. That is the part of watching it a machine can do; how it looks is still the page's job.

Membership is decided in [chat-stream-utils.ts](../../../apps/studio/src/client/components/chat-stream-utils.ts), in the pass that already walks the parts in order for run adjacency. Nothing in the data says a call belongs to a group: no tool part carries a group id, and a declared group is only ever implied by the agent having announced one first. So membership is read positionally, and a group opens at a heading or at the first step after a break and closes at the next heading or at the end of the turn.

**A run the agent never named groups the same way.** There is one concept, in two kinds: a **declared** group opened by `start_activity` and headed by that row, and an **inferred** group -- any other unbroken run of steps -- headed by a phrase generated from what it turned out to contain ("Read 2 files, ran a command and searched the web"). Both fold identically, so a phase of work costs one line whether or not the agent named it, and the cadence gap below stops being the difference between a grouped transcript and a flat one.

A group is `working` until something closes it and `settled` after, and that is the whole of how it draws:

|          | working                                  | settled                        |
| -------- | ---------------------------------------- | ------------------------------ |
| declared | heading, and the step in flight under it | heading, rows folded behind it |
| inferred | the step in flight, standing for the run | generated heading, rows folded |

**The step in flight is drawn as a copy, in a slot the group owns.** Its own row stays folded with the rest. A group reaches across many messages, so the step it is on moves down the transcript as it works; drawing it where it sits moved the folded group with it, which read as the whole run jumping from one place to another every step. The copy holds one slot in one place and changes only what it says. It costs one duplicated row when the group is open -- the step heads it and appears again in its place in the run -- which is the trade the reference implementations make too.

**Groups are closed by default, a reopened task included.** So a finished phase costs one line rather than thirty, and a live one steps through its calls one at a time in a fixed slot. Only the head line of a group shows the green dot and the brand shimmer; anything beneath it says it is working in the plain shimmer instead, so there is one thing moving per group. An inferred run of one call keeps its row: "Read a file" says less than the row it would replace, which at least said which file.

**A group is opened and shut from its head line.** For a declared group that is the heading. For an unannounced run in progress it is the copy of the step in flight, which is the only thing on screen: a click there opens the group rather than the one call's own output, and the copy stays put once the group is open, since it is then the only thing that can shut it again.

**One 8px rhythm, top to bottom.** Every container in the transcript spaces its children by `gap-2`. A step row cannot: it carries 4px of its own padding so there is something to click, which would put its neighbours 16px apart. So the group box stacks its rows flush and pulls itself in by that padding (`-my-1`), which leaves the text of a step exactly 8px from whatever is above and below it -- another step, a head line, or a paragraph of prose. No row anywhere in the transcript carries a vertical margin of its own: rows that do move the whole block every time the fold changes which of them is showing, and a run turning into a group would change how tall it is as well as what it says.

**Prose closes a group of either kind, and belongs to none.** The agent turning to address the user is the clearest break in a run there is, and taking it as one is what makes every boundary decidable the moment it arrives rather than at the end of the turn. So a paragraph is at the margin from the moment it is written and stays there: no fold can reach what the agent said, and nothing landing later -- a project change, a file the watcher saw, whatever developer mode is drawing -- can pull it out of view. Whatever the agent does after a paragraph opens a phase of its own, which means an agent that declares one activity and writes as it goes gets a named phase and then unnamed runs after it. That is the trade: a generated heading, in exchange for the transcript never rearranging what is already drawn.

**Which is the point.** A phase that carried on across a paragraph would keep collecting steps, and the copy of the step in flight would have to be drawn below prose written before it -- so the run moves down the page as it works, and jumps back up when the phase finally settles. Cutting at the paragraph is what holds everything above the live row still.

**A call the queue has not reached is not drawn at all.** Stopping the agent drops the rest of the batch, so drawing one announces work that may never happen, and while it waits it has nothing to say that the row ahead of it is not already saying. Developer mode draws the queue, where watching it drain is the point.

**A group nearly always spans several messages.** A turn is one assistant message per step, so a group of any size is split across a dozen of them, and the renderer walks one message at a time for its per-message chrome. Everything a group's box decides therefore comes off the group -- whether it can be opened, where its head line goes -- and never off the rows that happened to land on one side of a boundary. A message holding nothing that draws contributes no box at all, so a folded group draws in the slice it opened in and nowhere else, which is what keeps it still while the agent works past it.

The whole fold is `planRow` in [chat-stream-utils.ts](../../../apps/studio/src/client/components/chat-stream-utils.ts), fed by `buildTranscriptLayout`; both are pure over the parts, and [chat-stream-utils.test.tsx](../../../apps/studio/src/client/components/chat-stream-utils.test.tsx) snapshots each case as the shape it produces, so a change to any rule shows up as a change to the picture.

**`startedAt` on tool part metadata** says which call that row is. The AI SDK has no state between "the model asked for this" and "the output is here" -- its part states are `input-streaming`, `input-available`, `approval-requested`, `approval-responded`, `output-available`, `output-error`, `output-denied` -- because it executes calls itself with no queue, so it has no wait to name. We do have one: [agent.ts](../../../packages/workspace/src/machines/agent.ts) drains tool calls sequentially, which leaves a whole batch sitting in `input-available` while one member of it runs. Position in the part list identifies the runner today and would silently stop doing so the first time anything runs concurrently, so [run-tool-call.ts](../../../packages/workspace/src/lib/run-tool-call.ts) stamps the part when it picks it up. It pairs with the `endedAt` already there, survives concurrency, and needs no change to the state union. A stamp with no end is not on its own a claim that anything is running -- the record outlives the process -- so every reader also requires the live session to agree.

## The decisions, and why

**One tool, not the plan tool plus a control tool.** The research recommends plan steps as the primary way an activity opens, with a synthetic control tool for tasks too small to plan. We have no plan concept, and building one to get grouping would put a step list, statuses, and replanning in front of the question actually being asked. A control tool answers that question on its own; a plan tool can open activities later without changing the event the UI consumes.

**No end call.** An activity is closed by the next one starting, by the agent writing a paragraph, or by the turn ending. An explicit end doubles the calls and adds a way to get it wrong, and the final message already says how the work came out. It would also be a rule the model can forget, so the fallbacks have to exist regardless -- and the paragraph boundary already ends a phase at the one moment the model reliably marks, which is when it stops working to say something.

**Transcript order is the join, not an `activityId` on every tool part.** For one linear stream the two are equivalent, and the id is a schema change to every tool part. Parallel work is what makes the id necessary, and there is none today.

**A tool call, not leading assistant text.** Text before a call competes with turn termination. OpenAI's Codex guidance is to strip preamble prompting for exactly that reason. A tool call cannot end the turn: `shouldContinueWithToolCalls` continues while the last assistant message has tool parts. Measured across every run below, no activity was announced and then abandoned.

## What the evals measured

[activity-grouping.ts](../../../packages/workspace/evals/activity-grouping.ts), four situations spanning the range the tool has to cover, four prompt revisions, run against the harness's representative model set.

**The syntax is not the problem, and neither is early stopping.** Every call every model made was well formed, every activity was followed by real work, and no reply repeated its own activity titles back as prose. The previously validated behavior held: every run that produced a file still ended with a ` ```files ` fence.

**Every frontier model reaches for it, in the right places**, on the final wording:

| Case                                   | sonnet-5 | gemini-3.1-pro | gpt-5.6-luna | kimi-k3 | haiku-4.5 |
| -------------------------------------- | -------- | -------------- | ------------ | ------- | --------- |
| Find something, then produce something | 2        | 2              | 3            | 2       | 0         |
| One lookup and an answer               | 1        | 1              | 1            | 1       | 0         |
| A reply with no tool calls             | 0        | 0              | 0            | 0       | 0         |
| Long build, 21 calls                   | --       | --             | 2            | --      | over budget |

Findings worth keeping:

- **Both rules have to be stated with equal force.** Phrasing the trigger around phases of work got well-placed boundaries and no adoption at the small end. Making it unconditional (every turn that uses tools opens with one) bought adoption and collapsed a whole turn into a single activity. Only stating the opener and "start another when the objective changes" as two unconditional rules gets both.
- **Cadence does not bind on a long run.** "Roughly six calls" is in both the prompt and the tool description, and three separate long tasks broke it the same way: groups of 3, 4, 10, 14 on one; 3, 8, 5, 25 on another. The tail is always the failure, and it starts when the model enters a debugging loop, which is exactly when a person most wants to be told what is happening. Prompt text has now failed at this across four revisions. A runtime nudge after N unannounced calls is the next thing to try, and it is what the research's open question about an activity refresh anticipates.
- **Haiku never calls it**, under four wordings and eight runs, having called it once in one run. It is a small cheap model and the files-fence evals record it being unreliable run to run too, so this is a known gap at the bottom of the range rather than a blocker.
- **The description was dropped after this ran.** The evals collected one: Sonnet and Gemini left it out entirely and read fine on the title alone, luna and Kimi filled it, and it ran long and first-person until the schema capped it at about fifteen words. A heading is one line, so the second sentence had nowhere to go; the field is gone from the tool. The mockups below still show it, since they are a record of what those runs produced.
- **The per-call `explanation` is a label, not a sentence.** Asking for present continuous was not enough on its own; models still wrote "I'm copying the read-only sales CSV into the working area for analysis." Naming the failure (no first person, nothing framed as about to happen, no trailing period) took first-person labels to zero across four models and, separately, across a real 45-call task.
- **A retrospective title does not survive contact.** A heading could once carry `previousTitle` to restate the activity it closed, since a title written up front decays over a long group. Four frontier models ignored the field entirely, including on a case built to falsify an opening title. A real run then filled it on every call with the prior title copied verbatim, because the name reads as a pointer and beat the description telling it to restate. Both failures are the same lesson: an optional field is either skipped or misread, and the defect it targeted is better fixed by keeping groups short. Removed.

## How it reads

Real runs, drawn the way the transcript groups them. Titles, descriptions, per-call labels, and commands are verbatim; long commands are cut with an ellipsis and mount paths shortened. The description line under each heading is a record of what these runs produced and is no longer rendered or collected.

**The shape we are after.** Three objectives, each a few calls, on `gpt-5.6-luna`:

```
  ╭─ You ────────────────────────────────────────────────────────────────────╮
  │ First work out which of the notes in my Notes folder has the Helsinki    │
  │ launch date in it, then write me a one-page markdown brief about that    │
  │ launch.                                                                  │
  ╰──────────────────────────────────────────────────────────────────────────╯

  ▸ Finding the Helsinki launch note
  │ Locating the note that contains the Helsinki launch date and gathering
  │ its launch details.
  │
  │   ⌨  Listing the attached Notes folder             find '/mnt/Notes' -maxde…
  │   ⌨  Searching the notes for Helsinki references   rg -n -i -C 3 'Helsinki|…
  │   ◈  Reading the note with the launch date         travel.md
  │   ◈  Checking the remaining notes for context      meeting-2026-03-02.md

  ▸ Writing the launch brief
  │ Turning the confirmed date and limited logistics notes into a concise,
  │ factual launch brief.
  │
  │   ✎  Writing the one-page Helsinki launch brief    helsinki-launch-brief.md

  ▸ Verifying the launch brief
  │ Checking the finished brief against the notes for accuracy.
  │
  │   ◈  Reading the completed brief for verification  helsinki-launch-brief.md

  The Helsinki launch date is in the Travel note: 14 September 2026. I also
  checked the other notes for context and prepared a one-page brief covering
  confirmed details, open decisions, priorities, and next steps.
```

**Same prompt, no descriptions and no per-call labels.** `claude-sonnet-5` omits the optional description entirely, and drops `explanation` on its reads, so those rows fall back to the tool's own verb and the file chip. The header is doing all of the explaining:

```
  ▸ Searching notes for Helsinki launch
  │
  │   ⌨  Listing files in the Notes folder             find /mnt/Notes -type f …
  │   ⌨  Searching for Helsinki mentions across notes  rg -il "helsinki" /mnt/N…
  │   ⌨  Listing all files in Notes folder             find /mnt/Notes -type f
  │   ◈  Read                                          travel.md
  │   ◈  Read                                          roadmap.md
  │   ◈  Read                                          meeting-2026-03-02.md
  │   ◈  Read                                          onboarding.md
  │   ⌨  Checking why other files matched              rg -i "helsinki" -C1 /mn…

  ▸ Writing the Helsinki launch brief
  │
  │   ✎  Created                                       helsinki-launch-brief.md
```

**One call under one header**, the cost of the unconditional opener. Every model does this on a one-line question:

```
  ╭─ You ────────────────────────────────────────────────────────────────────╮
  │ What's the Helsinki launch date in my notes?                             │
  ╰──────────────────────────────────────────────────────────────────────────╯

  ▸ Searching your notes
  │ Searching the attached notes for the Helsinki launch date.
  │
  │   ⌨  Finding note files and Helsinki references    find '/mnt/Notes' -type …

  The Helsinki launch is set for 14 September 2026.
```

**A long task grouped well.** Twenty-one calls over four objectives, including a mid-course correction when a plotting library turned out to be unavailable:

```
  ╭─ You ────────────────────────────────────────────────────────────────────╮
  │ Take the sales spreadsheet in my Reports folder, work out the month-     │
  │ over-month growth, and give me a PNG chart of it plus a two-line         │
  │ takeaway. Look at the chart yourself before you tell me it's done.       │
  ╰──────────────────────────────────────────────────────────────────────────╯

  ▸ Inspecting the sales data
  │ Locating the sales spreadsheet and checking its structure before
  │ calculating growth.
  │
  │   ◆  Loading spreadsheet guidance                  sheets
  │   ⌨  Listing the Reports folder                    find '/mnt/Reports' -max…
  │   ⌨  Checking the folder contents and file types   ls -lah '/mnt/Reports'

  ▸ Reading the sales records
  │ Copying the CSV into the workspace and inspecting rows and columns
  │ before computing month-over-month changes.
  │
  │   ⌨  Copying the read-only sales CSV in            cp '/mnt/Reports/sales.c…
  │   ◈  Reading the source CSV to confirm contents    sales.csv

  ▸ Building the growth chart
  │ Calculating each month's percentage change and building a PNG focused
  │ on month-over-month growth.
  │
  │   ✎  Saving the analysis and chart script          create_sales_chart.py
  │   ⌨  Running the chart script                      python work/create_sales…
  │   ◆  Loading image-processing guidance             sharp-images
  │   ✎  Creating a deterministic SVG-based chart      create-sales-growth-char…
  │   ⌨  Rendering the final PNG                       tsx work/skills/instrume…
  │   ⌨  Checking available rendering libraries        python - <<'PY'
  │   ✎  Switching to a self-contained PNG renderer    create_sales_chart_png.py
  │   ⌨  Generating the PNG and checking its signature python work/create_sales…

  ▸ Visually checking the chart
  │ Opening the generated PNG and checking layout, labels, bars, and the
  │ negative-growth month before reporting back.
  │
  │   ◈  Inspecting the final PNG at full resolution   monthly_sales_growth.png
  │   ✎  Tightening the chart typography and labels    create_sales_chart_png.py
  │   ✎  Adding missing glyphs, adjusting text sizes   create_sales_chart_png.py
  │   ✎  Applying final typography corrections         create_sales_chart_png.py
  │   ✎  Replacing numeric month labels with names     create_sales_chart_png.py
  │   ⌨  Rerendering and checking final dimensions     python work/create_sales…
  │   ◈  Verifying the corrected PNG                   monthly_sales_growth.png
```

**The case to design against.** Same prompt, a later run: fifteen calls under a header that stopped describing them five calls in, and one command long enough to be its own document. "Inspecting the sales report" is where the model wrote a script, hit a missing dependency, tried the browser, tried FFmpeg, and drew the chart by hand:

```
  ▸ Inspecting the sales report
  │ Finding the sales spreadsheet and checking its structure before
  │ calculating growth.
  │
  │   ◆  Loading spreadsheet guidance                  sheets
  │   ⌨  Listing the attached Reports folder           find '/mnt/Reports' -max…
  │   ◈  Reading the sales rows and headers            sales.csv
  │   ⌨  Copying the sales CSV into the workspace      cp '/mnt/Reports/sales.c…
  │   ✎  Writing a chart script                        create_mom_chart.py
  │   ⌨  Running the chart script                      python work/create_mom_c…
  │   ⌨  Checking image libraries and converters       python - <<'PY'
  │   ✎  Replacing the unavailable plotting dependency create_mom_chart.py
  │   ⌨  Rendering the SVG to PNG with FFmpeg          python work/create_mom_c…
  │   ◆  Loading browser automation guidance           agent-browser
  │   ⌨  Opening the chart in the managed browser      agent-browser open work/…
  │   ⌨  Retrying with an explicit relative path       agent-browser open ./wor…
  │   ⌨  Checking for another vector-to-raster tool    command -v convert || tr…
  │   ◈  Checking the workspace package manifest       package.json
  │   ⌨  Drawing the chart with FFmpeg primitives      ffmpeg -y -loglevel erro…
  │                                                    (3,100 characters)

  ▸ Reviewing the chart image
  │ Inspecting the rendered PNG itself to confirm the bars, labels, and
  │ layout are visible and correct.
  │
  │   ◈  Opening the finished PNG for quality control  month-over-month-growth.…
  │   ⌨  Fixing escaped percent labels, regenerating   ffmpeg -y -loglevel erro…
  │   ⌨  Replacing percent glyphs with full-width      ffmpeg -y -loglevel erro…
  │   ◈  Reviewing the corrected PNG                   month-over-month-growth.…
  │   ⌨  Replacing glyphs with readable "pct" labels   ffmpeg -y -loglevel erro…
  │   ◈  Final visual inspection of the chart          month-over-month-growth.…
```

**For contrast, what a turn looks like with no activity at all** (`claude-haiku-4.5`, which never calls the tool). Thirty-six calls, no header anywhere, which is the transcript as it stands today:

```
  │   ⌨  Listing the contents of the Reports folder    ls -la /mnt/Reports/
  │   ◈  Reading the sales spreadsheet                 sales.csv
  │   ✎  Writing a TypeScript script for growth        mom_analysis.ts
  │   ⌨  Checking if csv-parse is already installed    cd work && npm list csv-…
  │   ⌨  Installing csv-parse dependency               cd work && pnpm add csv-…
  │   ⌨  Installing csv-parse as a workspace dep       cd work && pnpm add -w c…
  │   ⌨  Running the analysis script                   cd work && tsx mom_analy…
  │   ⌨  Copying the sales CSV into the task folder    cp /mnt/Reports/sales.cs…
  │   ✎  Updating the script to reference the copy     mom_analysis.ts
  │   ⌨  Running the analysis script                   cd work && tsx mom_analy…
  │   ✎  Using an absolute task-relative path          mom_analysis.ts
  │   ⌨  Running the analysis script                   cd work && tsx mom_analy…
  │   ... 24 more, none of them saying why
```

Four things in there are decisions, not accidents:

- **A header can arrive with no per-call labels under it.** Sonnet leaves `explanation` off its reads, so those rows fall back to the tool's own verb and the file chip. The heading carries the meaning.
- **A group can be one call.** The unconditional opener guarantees it on short questions.
- **A group can be fifteen calls, wrongly titled, containing a 3,000-character command.** Whatever the collapsed state is has to survive that.
- **The last group of a turn has no closing event.** It ends when the reply text starts, which is also what takes the heading out of its running state.

## Not built

1. **Animating the swap.** The head line's contents are replaced outright as the agent moves from one step to the next. Motion is already a Studio dependency, and the fold is a pure function of the parts, so the four moments worth animating are all identifiable from the layout: the copy in the head line being replaced (a keyed crossfade in a slot that is already fixed), an unannounced run settling into its generated heading (one row out, one heading in, same height), a group opening or closing (height), and a step arriving into an open group. The first two are cheap and buy the most. Height on expand is the one to hold: it fights the transcript scroller, so it wants the `releaseAutoScroll` fix underneath it first.
2. **The scroll jump on expand.** Opening a group grows the transcript above the viewport, the same jump the file grid hits. Both want `releaseAutoScroll` in the scroller.
3. **A runtime cadence nudge**, per the finding above.
4. **Keeping the prominent rows out of the fold.** Everything inside a closed group is folded, routine reads and writes alike. Anything awaiting approval must never be, since the user approves a concrete action rather than a group summary; today no such call reaches a group, because `choose` is the only interactive tool and it bypasses the queue.
5. **`activityId` on tool parts**, when parallel work or subagents make order insufficient.
6. **Plan steps opening activities**, if a plan tool ever lands.

## Open questions

- Does the header survive compaction and session resume, or does a resumed turn start unannounced?
- Should an activity that failed stay in the transcript, or be replaced by the one that superseded it?
- Does declaring an activity that the model then drifts past need a corrective signal, given the copy is currently write-only to the UI?
- Is one activity above a single-call lookup worth its line, or should the unconditional opener apply only past some size?
- An agent that declares one activity and then works for forty calls without saying anything gets one group with a title from the first minute of it. Collapsed that is one stale line rather than forty unexplained rows, so it is an improvement either way, but it is the cadence gap showing up somewhere new.
- The generated heading counts calls and does not read outcomes: a run where every call failed still reads "Read 3 files". Whether that matters depends on how visible failures are once folded.
