# A GitHub tree URL fetches as an error page, with a 200 on it

**Status:** open. The mechanism is understood and reproducible; the addressing fix is known and the reporting fix is a prompt rule. Last checked 2026-09-09.

A user pointed the conversation's agent at a skill that lives in a repository, by pasting the URL of its directory:

```
https://github.com/<org>/<repo>/tree/main/skills/<name>
```

Three tasks were told to use it. All three reported success. None of them read it, and none of them said they could not.

## What comes back

That URL is an application page, not content. Fetched without a browser it answers **HTTP 200** carrying GitHub's client-side error shell:

> Uh oh! There was an error while loading. Please reload this page.

Alongside it comes a bare list of the directory's entries, rendered server-side: `SKILL.md`, `idea.json`, `starter.html`, `examples/`, `references/`. So the fetch does not fail, does not return an error status, and does not return nothing. It returns a plausible-looking directory listing with the file names in it and none of the file contents.

That is the worst shape a failure can take. A task that fetches it has something to point at, no error to report, and no way to tell that the instructions it was sent for are missing. The names alone are enough to sustain the belief that the skill was consulted.

The file itself is fetchable, from the raw host:

```
https://raw.githubusercontent.com/<org>/<repo>/<ref>/<path>
```

That returns the content, 200, as text. The rule is that a tree URL addresses a page and a raw URL addresses a file; only the second is a resource an agent can read.

## Why nobody noticed

The silent fetch was survivable on its own. What made it invisible was the brief.

The conversation's agent cannot open a link, so what it believes is behind one is a guess. Handing a task the link **and** the guess in the same brief means the guess is the only readable instruction in the message, and it is a complete one: the task follows it, never opens the link, and produces something that satisfies the brief. The link becomes decoration. Neither side learns anything.

Measured on a real session: a skill whose whole output contract is one self-contained HTML page produced three Markdown reports instead, because the paraphrase in the brief described a table and said nothing about the format. The user found the failure by noticing the missing HTML files, several turns and roughly four million task tokens later.

## What has to be true for this to go away

- **A link in a brief is passed as the user wrote it and never described.** The brief tells the task to read it and to report a link it could not read rather than working around it. This is in the conversation agent's prompt.
- **A remote resource is addressed by a raw URL.** A tree URL in a brief should be rewritten to its raw form, or the task should be told the directory listing is not the skill.
- **Skills installed in the app remove the need for the remote reference entirely** for anything bundled. Until then, pointing at a skill over the network is a supported thing to want, and it has to fail loudly when it fails.

## Checking it

```
curl -s -o /dev/null -w '%{http_code}\n' https://github.com/<org>/<repo>/tree/main/<dir>
curl -s https://raw.githubusercontent.com/<org>/<repo>/main/<dir>/SKILL.md | head
```

The first prints 200 for a page with no content on it. The second prints the file. Any check that only looks at the status code cannot tell these apart, which is the whole finding.
