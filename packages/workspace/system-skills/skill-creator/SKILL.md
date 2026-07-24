---
name: skill-creator
description: Create or revise a reusable agent skill from a user's workflow, domain knowledge, or tool instructions. Use whenever a user wants to create, capture, package, edit, or turn something into a skill.
---

# Skill Creator

Create and revise focused, reusable skill packages in the Instrument workspace.

Skills live in `/skills/<name>/`, a writable mount outside the task root. Write and edit them with the ordinary file tools. A skill saved there is available to `load_skill` immediately.

## Workflow

1. Understand what the skill should enable, when it should trigger, and what a successful result looks like. Reuse details already present in the conversation before asking questions.
2. Ask only the questions whose answers would materially change the skill. Use concrete examples to resolve ambiguity.
3. Decide whether the skill needs only instructions or also reusable scripts, references, or assets.
4. Draft a concise `SKILL.md` body. Assume the agent already knows general concepts and include only domain-specific procedures, constraints, and decision guidance.
5. Write the package to `/skills/<name>/`. Check whether that directory already exists first: revising an existing skill is fine, silently replacing one the user did not mean to touch is not.
6. Run `validate-skill <name>` and fix what it reports. A skill with broken frontmatter fails silently by never appearing at all, so this is the only confirmation that what you wrote is a skill.
7. Tell the user the skill name and that it is available from Skills and the prompt slash menu.

## Package design

Every skill requires `SKILL.md`, whose frontmatter must set `name` and `description`:

```markdown
---
name: <directory name>
description: <what it does and when to use it>
---
```

Add `disable-model-invocation: true` when the skill should only ever run because the user asked for it by name. It then stays listed in Skills and the slash menu but is kept out of the catalog agents choose from.

Optional resources use these directories:

- `scripts/` for deterministic or repeatedly rewritten operations
- `references/` for details loaded only when needed
- `assets/` for templates and other files used in outputs

Do not create auxiliary documentation such as a README, installation guide, changelog, or quick reference.

## Naming and description

- Use lowercase letters, digits, and hyphens only. The directory name is the skill's identity, so it must match the `name` in frontmatter.
- Keep the name under 64 characters and prefer a short action-oriented phrase.
- Make the description explain both what the skill does and the situations that should trigger it. Trigger guidance belongs in the description, not the body.

## Writing guidance

- Use imperative instructions.
- Match specificity to risk: flexible prose for judgment calls, parameterized scripts for repeatable work, and exact steps for fragile operations.
- Keep the main file comfortably under 500 lines and 5000 tokens. Put extensive schemas, examples, or variants in directly linked reference files.
- Avoid duplicating information between `SKILL.md` and resources.
- Include examples when they clarify an input, output, or decision boundary.

This first creation flow does not run evaluations automatically. If the user asks to test the skill, create it first and then help them exercise it in a new task.
