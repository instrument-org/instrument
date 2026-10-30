# Principles

The standing rules that keep producing decisions: what the product is for, how the agent should be steered, how the code should break and bend. A decision in [`../decisions/`](../decisions/README.md) records one choice on one date; a principle is the rule behind many of them, written down so an agent can apply it instead of asking again.

Before raising a product or design question, check here. If a principle answers it, cite it and go. If a case seems to break a principle, say so rather than quietly working around it; that is how a principle gets corrected.

## Shape

One Markdown file per principle, named for the rule (`short-slug.md`), no date.

- **Title:** the rule as a sentence.
- **Body:** what it asks for and why, in a few sentences. The why is what lets a reader apply it to a case nobody wrote down.
- **Applies when** and **Not:** where it reaches, and what it does not license. A principle without limits gets stretched.
- **Sources:** the decisions, architecture docs and commits it was drawn from, and the date each verdict was given.

Principles are edited in place, like architecture: when one is refined, fix the sentence and add the source that refined it. When one is dropped, delete it and say why in the commit. Leave out anything tied to one machine, person, or moment, as everywhere in `docs/`.

## Index

| Principle | In short |
| --- | --- |
| [One mechanism, not per-case fixes](one-mechanism-not-per-case-fixes.md) | Shared abstractions and shared controls over bespoke handling |
| [Give the agent the truth, not clever affordances](give-the-agent-the-truth.md) | Real paths, real records, raw formats over helpers |
| [Built for regular people](built-for-regular-people.md) | The person works above the technical details |
