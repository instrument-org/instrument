---
name: skill-creator
description: Create a reusable agent skill from a user's workflow, domain knowledge, or tool instructions. Use whenever a user wants to create, capture, package, or turn something into a new skill.
---

# Skill Creator

Create a focused, reusable skill package in the Instrument workspace.

## Workflow

1. Understand what the skill should enable, when it should trigger, and what a
   successful result looks like. Reuse details already present in the
   conversation before asking questions.
2. Ask only the questions whose answers would materially change the skill. Use
   concrete examples to resolve ambiguity.
3. Decide whether the skill needs only instructions or also reusable scripts,
   references, or assets.
4. Draft a concise `SKILL.md` body. Assume the agent already knows general
   concepts and include only domain-specific procedures, constraints, and
   decision guidance.
5. Call `save_skill` once the package is ready. It creates `SKILL.md`
   frontmatter and writes any bundled text resources atomically.
6. Tell the user the skill name and that it is available from Skills and the
   prompt slash menu.

## Package design

Every skill requires `SKILL.md`. Optional resources use these directories:

- `scripts/` for deterministic or repeatedly rewritten operations
- `references/` for details loaded only when needed
- `assets/` for templates and other files used in outputs

Do not create auxiliary documentation such as a README, installation guide,
changelog, or quick reference.

## Naming and description

- Use lowercase letters, digits, and hyphens only.
- Keep the name under 64 characters and prefer a short action-oriented phrase.
- Make the description explain both what the skill does and the situations that
  should trigger it. Trigger guidance belongs in the description, not the body.

## Writing guidance

- Use imperative instructions.
- Match specificity to risk: flexible prose for judgment calls, parameterized
  scripts for repeatable work, and exact steps for fragile operations.
- Keep the main file comfortably under 500 lines. Put extensive schemas,
  examples, or variants in directly linked reference files.
- Avoid duplicating information between `SKILL.md` and resources.
- Include examples when they clarify an input, output, or decision boundary.

This first creation flow does not run evaluations automatically. If the user
asks to test the skill, create it first and then help them exercise it in a new
task.
