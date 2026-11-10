---
name: copy-review
description: Check words a person reads in Instrument (labels, buttons, subheads, descriptions, toasts, empty states, dialogs, errors) against the checklist built from past copy review, before the change is called done. Use after writing or changing any UI string, when the Stop hook lists new copy, or when asked for a copy pass over a screen.
---

# Copy review

Copy written by an agent keeps failing review in the same few ways. This skill is the check for the ones a pattern can't catch; `studio/plain-copy` already fails the build on the phrases it can (holds, carries on, picks it up, should live, hears, "Instrument's own", ", never", em dashes).

## 1. List the strings

```sh
node scripts/ui-copy.ts --new            # strings this branch added or changed
node scripts/ui-copy.ts <file>...        # every string in some files
node scripts/ui-copy.ts                  # every string in Studio
```

Each line is `path:line [where] text`, `…` standing for a value put in. A fragment of a sentence split around `{…}` gets read in its file before judging.

## 2. Ask each question of each string

Answer yes or no, one string at a time. A string fails a question only when you can quote the words that fail it. A plain, short line passes even when you would have phrased it differently.

1. **What it is.** Does it say what the thing is or what the person can do, rather than how the app works inside, why it is there, or what just happened to it? Fails: "Instrument reads it in a new chat and keeps what is worth keeping." "in view behind the draft now".
2. **Someone real as the subject.** Is the subject the person, the thing, or a plain sentence with none? Fails: software that hears, is told, wants or picks up; "we" narrating inside the product ("We opened … in your browser"). Passes: "Chats can see this", "Couldn't load the release notes."
3. **Everyday words.** Would a person outside the company say every word? Fails: turn, prompt, session, record, provider default, GPT, API key on a screen for everyone, `~`, `Safari.app`, ms, ids, our own feature names.
4. **The standard word.** Is each label the word ChatGPT, macOS or Chrome use for the same act, or the service's own word for its own thing? Disconnect is Remove, Open table is Expand table, Search DuckDuckGo is Search the web, a ChatGPT session is signed out of, not logged out of.
5. **Only what is new.** Is everything in it something the person can't already see or assume? Fails: "You can close this tab." "press Command K anywhere to open this menu over what you're doing", "Can change or delete files in it" on a folder it can obviously change.
6. **Short for its place.** Buttons and labels are a verb or a noun, a few words ("Stop and send" is Send). A placeholder names the act, never an inventory ("Search chats, files, apps, pages, and commands"). A description says one thing.
7. **True everywhere.** Is it true on every device, every system and in every state? Fails: "New from your Mac" (it may have come from a PC), "picks the best one for each message" when it doesn't, a switch's description that changes when the switch flips, a promise about a later build.
8. **Whose it is.** When a limit, error or sign-in belongs to another service, does the line name it? "ChatGPT's limit", not "the limit".
9. **Plain sentence.** Full sentences with their small words, no colon reveals ("Nothing: it is open."), no "X, never Y" or "not X but Y", no examples quoted mid-sentence, no marketing ("at one affordable price", "doing your best work").

Text written for the agent (prompts, tool descriptions) is out of scope. Developer-mode screens may use developer words.

## 3. Report, then fix

For each failing string: the location, the question it fails, the words that fail it, and two or three rewrites no longer than the original, the shortest first. Removing the line is often one of them. Apply the one that answers every question, and list each change before → after in the report or PR so it can be read without the code.

## Lines that passed review

- "Sent to Instrument with your message" (a chip's tooltip)
- "Instrument keeps a history of what you do in it on your device."
- "Chats can see this" (a switch label)
- "The 30 minutes before this, without names" (one line under a switch, true on and off)
- "Importing adds to what Instrument remembers, so you can bring in memories from every AI you use."
- "Files you open in Instrument show up here."
- "Auto chose:" (a label naming who did it)
- "Create an account to enjoy free AI usage" (warm words are fine)

## Lines review sent back, and what replaced them

| Sent back | Became |
|---|---|
| Stop and send | Send |
| Send with Gmail | Send |
| Disconnect | Remove |
| Open table | Expand table |
| Search DuckDuckGo | Search the web |
| Answered by / Picked by / Chose | Auto chose: |
| This turn is using … | (removed: "turn" is our word) |
| Not now / Allow, before a system prompt | Grant access |
| Instrument is back in front. You can close this tab. | (removed) |
| Before each message, a chat hears what kind of thing you just did | Each message you send includes a short list of what you just did here, without names. |
