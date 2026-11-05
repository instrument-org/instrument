# Feedback reports send an outline of the chat, never what the agent read

Date: 2026-10-31

## Context

A feedback report sent each of a chat's session logs whole, through a redactor that took out values the app knows: the person's name, email, home folder and login, their memories, other chats, and anything shaped like a secret. Everything else went, tool output included. When the agent had searched someone's email, the report carried the sender, subject and first line of every result, the body of a signed agreement with its access code, and text from legal documents. Each audit of a real report found a new kind of leak, and the last one was content no redactor can know in advance, because it came from outside the app.

## Options weighed

- **More patterns.** Keep sending everything and widen the redactor. Every new source (a site, an app, a file) leaks until someone writes a pattern for it, and nothing can recognize that an email body is private.
- **Blocklist signed-in sites.** Send browser output from signed-in sites as its length. It misses the same content read through an app call, a file, or a site that isn't signed in.
- **A model that scrubs.** PII models miss a large share of real-world values and none treat a message body as sensitive, so they would be a less predictable version of the patterns.
- **An outline.** Send what was said and every step, and leave out what the agent read.
- **An outline with an opt-in.** The same, with a box that adds the full logs back. Almost nobody would check it, and nobody could tell from the box what it would add.

## Decision

A report sends an outline of the chat's records (`packages/workspace/src/lib/report-outline.ts`).

- Every kind of record has a rule naming each field: kept as written, written as its length (`"<2373 chars>"`), or kept as the host it names. What the person and the agent said goes as written; what a step read or wrote goes as its length.
- A kind with no rule keeps its keys and numbers, and every string goes as its length. A new tool or note sends nothing it read until it gets a rule.
- A shell call's output is what the agent read, so it goes as its length however the call ended. How a call failed goes as the end of its stderr, which can quote what a program read: a risk accepted so a report can explain a bug. A tool's error keeps its end.
- A command line goes through the sandbox's shell parser, so heredoc bodies and long quoted words go as their length and its words, flags and paths stay.
- The agent's thinking never goes.
- A device's state file and the notes a handoff leaves never go: the state names the pages its tabs had open, and the notes are the agent's summary of what it read.
- The feedback dialog offers the chat as one row, and its View page draws the outline a record a row, the same way for every kind, with a "Not sent" mark giving the length of what stayed home.
- The redactor still runs over everything first, as a backstop rather than the guarantee.

## Consequences

- A report shows the bug in almost every case without what the agent read. A blind diagnosis of eleven broken chats from outlines found the same causes as from full transcripts. A bug about something the agent read (a wrong answer about a page) needs us to ask the person what the page said.
- What still goes is whatever the agent repeated in its own words: its replies, and short arguments of its commands such as a search term, a file name or a URL.
- A new record kind or tool output field needs a line in the outline before a report shows it, which is the cost of it never leaking by default.
