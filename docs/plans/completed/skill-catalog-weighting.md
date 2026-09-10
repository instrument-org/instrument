# Plan: weight the skill catalog so a named skill keeps its trigger

Status: **complete for the code half.** Change 1 landed in [`skill-catalog.ts`](../../../packages/workspace/src/lib/skill-catalog.ts): the shortening step keeps every `SKILL_NAMES` skill whole while together they need at most half of what is left after the names, and falls back to the flat cap past that; `skill-catalog.test.ts` covers the reservation, the fallback, a namesake from another source, and a realistic skill count where the shortening step fires. The four eval cases live in `evals/cases/create-page-skill.ts`. Change 2, front-loading the description, is a skills-repository edit and is still open. Change 3 was a note and stays one. Two things this plan did not see: the orchestrator had no skill catalog at all and briefed tasks blind, fixed alongside; and the `<skill><name/><description/></skill>` markup costs about 71 characters per entry, so on a 54-skill machine names and markup take 63% of the budget before any description, which makes a compact entry format the next lever if the budget gets tight again.

## What goes wrong

`create-page` is the skill the main agent's prompt names by constant and tells the model to err toward. On a developer machine with 46 skills installed, the catalog showed the model 76 characters of its 334:

```
Makes one self-contained HTML page in the house style, in whichever form the
```

It stops mid-sentence. What the cut removes is the whole selection signal: the sixteen document kinds, and the sentence that says when to reach for it at all ("Use when the answer wants to be a document the reader can keep, print, or send on"). The model is left with a statement of what the skill is and nothing about when it applies.

The skill it replaced survived the same cut intact, because it put its trigger first: "When the user says ... or asks for a question answered or work". Truncation took its explanation and left its cue. The replacement front-loads the explanation, so truncation takes the cue.

## Why it happens

[`skill-catalog.ts`](../../../packages/workspace/src/lib/skill-catalog.ts) degrades in three steps: every description in full, then descriptions shortened to a fair share of what is left, then names alone. The middle step is the one that fires in practice, and it applies **one cap to every skill**:

```ts
const cap = fairShareLength(entries.map((e) => e.descriptionCost), entryBudget - nameOnlyCost);
```

`fairShareLength` is fair in the sense that a short description costs only its own length and its unused share flows to the longer ones. It is not fair in the sense this product needs: a skill the app itself names in its prompt is capped exactly like a skill that happens to be installed by another vendor's agent.

The catalog already has a notion of priority. `SOURCE_PRIORITY` ranks `system` above the app's own skills above every third-party source, but it only decides sort order and which names survive the last-resort step. It has no say in how long a description may be, which is the step that actually runs.

The budget is 8000 characters, deliberately, and [the finding behind it](../../findings/character-budgets-are-a-token-proxy.md) explains why it is characters rather than tokens. Raising it is not the fix: the catalog is discovered from the user's machine, so its size is set by how many skills they happen to have across every agent vendor, and any ceiling gets eaten as that number grows. The problem is the allocation, not the total.

## What to change

Three independent changes, in order of leverage.

### 1. Reserve full length for skills the product names

The codebase already declares which skills matter: [`SKILL_NAMES`](../../../packages/workspace/src/lib/skill-names.ts) is the list of skills referenced by name from tool descriptions and agent prompts, and `skill-names.test.ts` already fails when one of them stops resolving in the registry. That list is the weighting signal, and it needs no new source of truth.

In the shortening step, take the named skills' descriptions in full first, then fair-share what remains among everything else:

```
reserved  = sum of full descriptionCost for skills named in SKILL_NAMES
available = entryBudget - nameOnlyCost
if reserved is a modest fraction of available:
    named skills shown in full
    cap = fairShareLength(remaining descriptions, available - reserved)
else:
    fall back to today's uniform cap
```

The fallback matters. Without it, a future where most skills are named turns the reservation into the same flat cap with extra steps, and one pathological description could starve every other entry. Pick the fraction so that today's named set cannot crowd the rest, and cover it with a test that adds a named skill with an enormous description and asserts the fallback fires.

Worth deciding while implementing: whether the app's own skills (`SOURCE_PRIORITY` rank 2) deserve a floor above third-party ones even when unnamed. That is a larger change and should not block this one.

### 2. Front-load the description in the skills repository

Independent of any code change, `create-page`'s description should lead with when to use it and follow with what it is, so that a truncated entry still carries its trigger. This is the cheap half of the fix and it protects every consumer of the skill, not only this app.

The edit belongs in the skills repository the `registry/` submodule tracks. **Never edit `registry/` in place**; change it upstream, then move the submodule pin here.

Apply the same test to the other entries in `SKILL_NAMES`: read each description as its first 76 characters and ask whether a model could tell from that alone when to reach for it.

### 3. A superseded skill can outrank its replacement

A skill removed from the registry does not disappear from a machine that installed it under another agent's home, and it keeps competing in every catalog. In the case that prompted this plan, the removed skill's truncated line read as a stronger trigger than the skill that replaced it. Nothing in the product can delete another vendor's skills, so this is a note for whoever renames a skill rather than a code change: a rename leaves a competitor behind, and the replacement has to out-describe it in the first 76 characters.

## How to know it worked

`evals/cases/pdf-skill.ts` is the model to copy: it asserts a `tool-load_skill` part carrying a specific skill name. A `create-page` case wants the same shape, with three cases rather than one.

- **Positive**: a request that plainly wants a document and does **not** name a file format should load `create-page`.
- **Negative control**: a request that names a `.md` file by name should **not** load it. Following an explicit format instruction is correct behavior, and an eval that punishes it would push the agent to override what the user asked for.
- **Through the orchestrator**: run it as `kind: "orchestrator"` too, since what matters is that the tasks the conversation creates respect it. Assertions there get `childSessions()` alongside `sessions`, because the work being scored happens in the tasks.

**The trap to avoid.** Every eval run gets a sandboxed home of its own, which is the whole point of `evals/lib/sandbox-home.ts`. Skills are discovered partly from co-installed agent homes, so a sandboxed run sees a much smaller catalog than a real machine, everything fits in full, the shortening step never fires, and the eval passes for a reason that has nothing to do with the fix. Before trusting a green run, confirm the catalog under test actually shortened: `renderSkillCatalog` returns `shortened` and `omitted` counts for exactly this. The cheapest honest coverage is a unit test that calls `renderSkillCatalog` directly with a realistic skill count and asserts the named skills kept their full descriptions; the eval then measures whether the model acts on what it was shown.

`--model` is required and there is no default set. Workers AI first, since the credits are already paid for, and say which models were run and why in the same breath as the result.

## What is deliberately not changed

- The 8000-character budget. The problem is how it is divided, not how large it is.
- The three-step degradation. Full, then shortened, then names only is the right shape; only the middle step's allocation changes.
- The prompt line naming `create-page`. It reached the session that prompted this plan and is not what failed.
