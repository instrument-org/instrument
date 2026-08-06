# Plan: how the agent presents files, data, and artifacts

Status: **spiked — the file group is built and measured; everything past it is still proposal.** Owner: TBD. Shippable independently of, and ahead of, the folder work in [user-chosen-working-folder.md](user-chosen-working-folder.md).

A writable shared folder is what forced this: the agent can now write where the task-directory watcher cannot see, so a file it produces there reaches the user through nothing at all. The syntax is how it says what it made.

## What the agent can express

A vocabulary written directly into the response, composing what the user sees:

- **A file**, mentioned in prose or embedded at a chosen prominence.
- **A group** of files, laid out as a grid, a list, or snippets.
- **A folder**, as an expandable tree.
- **A pair**, compared side by side.
- **A skill**, referenced rather than only reported when it changes.
- **Records from connected apps**, in the same shapes.
- **An action**, opening something into the artifact panel.

Two rules separate the last item from the rest, and everything else follows from them.

### What this replaces

Two mechanisms currently infer presentation from side effects, and both are the same mistake:

- Files written to `output/` become previews automatically, keyed off a magic directory.
- Skill changes become a card automatically, produced by diffing the workspace skills directory across a turn ([workspace-skill-index.ts](../../../packages/workspace/src/lib/workspace-skill-index.ts), rendered by [skill-changes-card.tsx](../../../apps/studio/src/client/components/skill-changes-card.tsx)).

The consequence is that the agent can only surface a skill it just _mutated_. A user asking "do we have a skill for this?" has no representation at all, which is the same gap retrieval had for files.

**A change record and a presentation are different things and should stay different.** What a turn touched is reported to the user, automatically, and belongs with the file change list. What the agent chooses to show is composed by the agent, explicitly. The skill-change card stays; the automatic `output/` rule goes.

## Rules

1. **Markup describes, actions do.** Presentation renders identically every time a conversation is reopened. Anything with a side effect is a tool call, fires once, and is recorded in the transcript.
2. **Degrade to something correct.** Every construct stays useful when nothing parses it: in a copied transcript, an export, or a half-streamed response.
3. **The agent describes intent; the renderer chooses the widget.** The agent says what it is showing and how prominent it should be. It never names a component, and never needs to know whether a path is an image, a document, or a directory.
4. **One node, one component family.** Files and connector records parse into the same shape and render through the same components.
5. **Hints are advisory.** Unknown attributes are ignored. Unsupported combinations fall back. The renderer may override a layout when it knows better, such as rendering chat messages as rows even when a grid was asked for.

## Files

### Mentioning one

```markdown
I updated [the revenue chart](output/revenue.png) with Q3 numbers.
```

A link in prose renders as a chip that opens a preview. This is the default, and it needs no new syntax.

The chip and the fence resolve identically now: both draw from the path and share one rule for which paths they will draw at all, so the same file cannot read as a chip in one half of a reply and as prose in the other.

**The better version of this is worth building.** Models name a file in prose as inline code — "the launch date is in `travel.md`" — and that is the natural place for a link, but a basename alone is ambiguous across a large tree and matching it against the whole index invites false positives. The fence removes the ambiguity: **link an inline-code mention when it resolves against the files this message's own fence declared.** The fence is the declaration; prose mentions of what was declared become chips. Nothing to add to the syntax, no per-link query, no way to link a file the reply was not already showing, and it means "show each file once" costs the user nothing.

### A group

**Built.** A fenced block whose info string is `files`, one path per line:

````markdown
```files
output/revenue.png
output/costs.png
/mnt/Reports/regional-split.pdf
```
````

The whole line is the path, so a name with spaces in it needs no quoting and no escaping. Paths are written exactly as the agent passes them to a file tool, which is the only path vocabulary it has: task-relative, or a `/mnt/...` mount path.

A fence rather than a directive, decided on evidence rather than taste:

- **No second grammar inside the block.** The earlier proposal nested markdown links inside a directive container, which is two syntaxes to get right in one construct and a bulleted list of links when unparsed. One path per line has nothing to nest.
- **The renderer needs no parser.** remark already produces a `code` node with a `lang`; the branch is one line in [markdown.tsx](../../../apps/studio/src/client/components/markdown.tsx). A directive plugin is a dependency and a grammar we would own.
- **The model already knows this shape here.** A ` ```mermaid ` fence already renders as a diagram and the prompt already teaches it, so the fence is one more language rather than a new construct.
- **Streaming is free.** `remend` closes the unterminated fence, and each line resolves as it completes, so cards fill in and raw syntax never reaches the screen. A directive's opening token has to be recognized and suppressed by hand.
- **It degrades to something correct.** In an export, a copied transcript, or any other renderer, it is a code block listing the paths.

Its cost is real and accepted: unlike a markdown link, it is not a link anywhere else.

### Why not a JSON payload

The strongest alternative is a typed payload in a fence, which is what [json-render](https://json-render.dev) does for generative UI: a component catalog, Zod-validated element specs, and a streaming wire format. Worth revisiting the day we want the agent to compose arbitrary UI. For a list of paths it loses on every axis that matters:

- **Escaping.** A bare line is the one payload shape with no escaping at all: the whole line is the value, so spaces, quotes, `#`, and commas need nothing. JSON adds two escapes a model has to get right, and `"C:\\Users\\..."` is the shape they get wrong.
- **Streaming.** json-render's answer to partial JSON is `SpecStream`, one JSON Patch op per line, so a half-received line is buffered rather than parsed. That is the same insight as one path per line, reached by a longer route. Line-delimited is what makes either stream; JSON is what makes one of them need a compiler.
- **Interleaving with prose.** Their inline mode needs `createMixedStreamParser` to split patch lines from text. A fence sits in the prose already.
- **Degrading.** A fence is a readable list of paths in an export or a copied transcript. A patch stream is noise.
- **Reliability.** There is no headroom to win back: every fence emitted across four prompt revisions and two models was well formed.

What JSON would genuinely buy is validation and a large vocabulary, and neither is load-bearing yet. Both become load-bearing at the same moment: when items stop being paths and start being components with per-type props. Revisit then, and note the fence costs nothing to keep alongside — a second fence language is one more `if`.

### Layouts (not built)

| Layout     | Shape                                                 | Use                                                   |
| ---------- | ----------------------------------------------------- | ----------------------------------------------------- |
| `grid`     | Uniform cards, thumbnail interior varies by file type | Sets of results, mixed or not                         |
| `list`     | Rows with name, path, and size                        | Enumerations where identity matters more than content |
| `snippets` | Rows with matched content and the path retained       | Retrieval, where the user needs to recognize the file |
| `tree`     | Expandable, nestable, expanded by default             | Folders, which contain folders                        |
| `compare`  | Two items, aligned and same scale, labeled            | Before and after, two candidates, a diff              |

Layout is inferred when unstated: one item is a card, several images are a grid, a directory is a tree, exactly two comparable items offered as a comparison is `compare`.

**Uniform card height is load-bearing for `grid`.** A mixed set of formats reads as one result only if every card is the same object with a different thumbnail interior: an image preview, ruled lines for text, a small table for tabular data, a page for documents. Letting one item expand inline to show an excerpt is what turns a result into an accordion.

### Attributes (not built)

Nothing but the bare path list exists today, and the grid picks its own layout from the file types. When an attribute earns its place, its home is the fence's info string, which remark already hands to the renderer as `node.data.meta`:

````markdown
```files layout=grid columns=6
```
````

| Attribute | Values                                        | Applies to | Notes                                   |
| --------- | --------------------------------------------- | ---------- | --------------------------------------- |
| `layout`  | `compare`, `grid`, `list`, `snippets`, `tree` | Container  | Inferred when absent                    |
| `size`    | `sm`, `md`, `lg`, `full`                      | Either     | Prominence, not pixels                  |
| `columns` | number                                        | Container  | Grid only, advisory                     |
| `preview` | `none`, `thumb`, `excerpt`                    | Either     | Leading content for text-like files     |
| `expand`  | boolean                                       | Item       | Tree nodes; the root expands by default |

## Skills and connector records (not built)

One item per line generalizes past files without a second construct: a line that carries a scheme is a record rather than a path, and the fence stays the same shape.

````markdown
```files
skill://pdf-forms
notion://page/3f81a0
linear://issue/ENG-4471
```
````

Sources differ in what they can offer. A page has a cover and a body; a skill has a description and no image; an issue has a status; a mail thread has neither. One card shape absorbs all of it:

- Source mark and title are required. Everything else is optional.
- The media slot is a fixed height, filled by a cover when one exists and a labeled band when not, so a mixed grid never goes ragged.
- One metadata line, bottom-aligned across cards regardless of title length.
- Snippets are clamped to two lines and simply absent when there is no description or body text.
- **A source supplies data, never a layout.** It cannot introduce a new card shape.

Skills lead with their description rather than an image, so they read best as rows. Chat messages do too. This is the main case for the renderer overriding a requested layout.

Unavailable items still render. A disconnected app, a revoked permission, or an uninstalled skill are normal states, shown dimmed with a way to restore, because the user may recognize the item and want it back.

## Actions

Opening a file, a folder, or a web page into the artifact panel is a tool call, not markup.

- The transcript records it collapsed to a sentence a person can read months later, expandable for anyone who wants the detail.
- It fires once, when the agent takes it. Reopening the conversation does not reopen anything.
- Closing the panel does not erase the record, and the record stays clickable. A later click is the user opening something, which is fine.
- Opening is never the only route to a file. Everything shown can already be revealed.

The natural home is the bash surface the agent already uses, where `open` composes with everything else it does. A dedicated tool is the alternative, and has a clearer permission story for targets outside the sandbox.

## The parsed node

Syntax is the surface. What is built parses to a list of paths, and the shape it grows into is:

```ts
{
  kind: "files" | "items",
  layout?: "compare" | "grid" | "list" | "snippets" | "tree",
  size?: "full" | "lg" | "md" | "sm",
  items: Array<{
    source: "glob" | "path" | "record" | "skill" | "url",
    value: string,
    label?: string,
    attrs?: Record<string, string>,
  }>,
}
```

`source` is why files, skills, and connector records share a component family, and why a source added later costs nothing at the grammar level. Skills are the proof: they were built as a bespoke card with its own watcher and its own component, and they collapse into one more value in this union.

## Resolution

**Nothing resolves over the network while rendering.** A card draws from its path: the basename is the label, the extension gives the type and icon, and `assetBase + path` is the URL. Truth is established when someone clicks. The reasoning is in [file-references-without-a-watcher.md](file-references-without-a-watcher.md), whose first step this is; what remains here is what the fence itself does with a path.

A line is drawn only if it is **addressable** — task-relative or under the attached-folder mount root, never traversing — because the lines come from model output and a host path among them has to read as prose rather than as an affordance that cannot work ([task-file-path.ts](../../../apps/studio/src/client/lib/task-file-path.ts), shared with the chip so one path grammar covers both).

Not built: globs and directories, and an item cap.

## States

**Streaming** falls out of the syntax: `remend` closes the unterminated fence, and only lines the fence has finished are drawn, so raw syntax never reaches the screen. A line is finished when a newline follows it — mid-stream the last one is a path still being typed, and drawing it would put up a card for `output/ch` and replace it on every keystroke. `part.state === "streaming"` is threaded down to the renderer for this; nothing else in the pipeline can tell a half-typed path from a complete one.

**Missing** is not a render-time state. An image reports itself by failing to load, since the asset origin is a static file server and `ImageWithFallback` already draws the failure; everything else reports when someone asks for it. This replaced a dimmed "not found" card gated on a per-path lookup, and the trade is deliberate: whether a file is there has a different answer every minute, so the honest moment to ask is the one where it matters.

**A line that was never a path** is still skipped rather than drawn as a card naming it. A fence is a block of lines, unlike a link, so a stray sentence can land in one. No model in the evals has put one there; this keeps the first one that does from reading as a bug in the file.

Still to build:

- **Unavailable.** A connector record whose service is disconnected renders with a reconnect path.

## What the spike measured

Four situations, `openai/gpt-5.6-luna` (what the auto model resolves to) and `anthropic/claude-haiku-4.5`, three prompt revisions, run with [spike-files-block.ts](../../../packages/workspace/evals/spike-files-block.ts).

**The syntax is not the problem.** Every fence either model emitted, across all three revisions, was well formed: bare paths, one per line, a single fence per reply, and every path resolving to a real file. Not one bullet, label, comment, or markdown link appeared inside a fence, and neither model ever emitted one for a reply with no files in it. The renderer's tolerance for those near-misses has yet to be needed.

**Whether the model reaches for it is entirely a prompt question**, and it moved a long way on wording alone:

| Case                                     | Prompt v1 | v2     | v3     | v4 (current) |
| ---------------------------------------- | --------- | ------ | ------ | ------------ |
| Deliverable written into a shared folder | luna ✓    | luna ✓ | luna ✓ | luna ✓       |
| Three files produced at once             | both ✓    | luna ✓ | both ✓ | luna ✓       |
| A file found while answering a question  | both ✗    | both ✗ | luna ✓ | luna ✓       |
| An answer with no files                  | both ✓    | both ✓ | both ✓ | both ✓       |

The retrieval case is the finding worth keeping. Both models answered "the note is `travel.md`" in one line, naming the file and showing nothing, under two revisions that said the fence was for files "you made or found". What fixed it was making the trigger unconditional and about the reply rather than the work: **any reply that names a file ends with the fence, a one-line answer included.** A short factual answer does not read as a turn that "produces" anything, so guidance phrased around deliverables never engages.

Then real use turned up the opposite failure: **models did the new thing and the old thing at once.** One reply carried a Markdown link and a fence for the same file; another carried a bulleted list of seven filenames above a fence naming the same seven. Both are worse than either mechanism alone. The cause was in the prompt, which taught a file link and a fence in adjacent sentences and never said to pick one. v4 makes files a single-mechanism subject: the link instruction is gone, and "show each file once and only there" is stated as a rule with its two failure shapes named. The renderer still renders a file link, so old transcripts keep working; it is only no longer taught.

Haiku is unreliable here run to run — it dropped the fence on cases it had passed a run earlier. Treat single-model, single-run results as noise; the matrix is the evidence.

## Phases

1. ~~**Parser and node schema.** A flat group of paths.~~ Built: [parse-files-block.ts](../../../apps/studio/src/client/lib/parse-files-block.ts), [agent-files-block.tsx](../../../apps/studio/src/client/components/agent-files-block.tsx).
2. **Component family.** Built only as far as the existing grid, which now takes `preserveOrder` so an agent-chosen set is shown as given rather than bucketed by task folder. Card, list, snippets, tree, compare are unbuilt.
3. **Resolution.** Per-path resolution is built; globs, directories, caps, and persisted results are not.
4. ~~**Prompt.** Describe the vocabulary.~~ Built. **Deleting the automatic `output/` preview rule is not**, and is deliberately deferred: the fence and the change list currently both fire for a deliverable in `output/`, which is duplication a user can see.
5. **Actions.** Opening into the artifact panel.
6. **Skills as a source**, replacing the bespoke card path with the shared one.
7. **Connector records**, when the first connector needs them.

## Open questions

- **Does the fence duplicate the change list?** For a file in `output/` both now fire. Either the automatic rule goes (phase 4) or the change list learns to drop what the reply already showed.
- Does a group need a title of its own, beyond per-item labels?
- How much should the renderer infer? Inference is friendly to the model and unpredictable to the designer.
- Does `compare` extend to text and PDF diffs in the first version, or only images?
- **Folders.** The grid has no folder card, so a fence naming a directory resolves to nothing today. Retrieval over a large tree wants one.
- **Linking inline mentions against the fence** (see [Mentioning one](#mentioning-one)) — worth building, not built.
