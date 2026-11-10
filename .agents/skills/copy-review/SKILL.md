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
2. **Someone real as the subject.** Is the subject the person, the thing, or a plain sentence with none? Fails: software that hears, is told, wants, keeps or picks up; "we" anywhere, since the app is never a person ("We opened … in your browser", "we can send another one", "Thanks, we got your feedback"). Passes: "Thanks for your feedback.", "Chats can see this", "Couldn't load the release notes."
3. **Everyday words.** Would a person outside the company say every word? Fails: turn, prompt, session, record, provider default, GPT, API key on a screen for everyone, `~`, `Safari.app`, ms, ids, our own feature names.
4. **The standard word.** Is each label the word ChatGPT, macOS or Chrome use for the same act, or the service's own word for its own thing? Disconnect is Remove, Open table is Expand table, Search DuckDuckGo is Search the web, a ChatGPT session is signed out of, not logged out of. A folder or file the app won't open is "a protected folder", and the app stores data rather than keeping it. A dialog macOS also shows takes its wording and button order: a name clash asks "Do you want to replace it with the one you're moving?" over Keep Both, Stop, Replace.
5. **Only what is new.** Is everything in it something the person can't already see or assume? Fails: "You can close this tab." "press Command K anywhere to open this menu over what you're doing", "Can change or delete files in it" on a folder it can obviously change, "then comes right back here", a dialog description that restates its title ("Clear browsing data" needs none), a note defending a card that explains itself.
6. **Short for its place.** Buttons and labels are a verb or a noun, a few words ("Stop and send" is Send). A placeholder names the act, never an inventory ("Search chats, files, apps, pages, and commands"). A description says one thing. A line beside a button uses the button's words ("If it didn't show up, try sending again." beside Send again).
7. **True everywhere.** Is it true on every device, every system and in every state? Fails: "New from your Mac" (it may have come from a PC), "picks the best one for each message" when it doesn't, a switch's description that changes when the switch flips, a promise about a later build.
8. **Whose it is.** When a limit, error or sign-in belongs to another service, does the line name it? "ChatGPT's limit", not "the limit".
9. **Plain sentence.** Full sentences with their small words, no colon reveals ("Nothing: it is open."), no "X, never Y" or "not X but Y", no examples quoted mid-sentence, no marketing ("at one affordable price", "doing your best work"), no possessive on a thing ("the model's limit" is "model limits"). "Please" is fine where a person would say it ("Please check your edits").
10. **Trusts the reader.** Does it use the ordinary word even when a simpler-sounding phrase exists? "Scale the app", not "Make the app larger or smaller": people know what scale means, and the longer line talks down to them.

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
- "Instrument can't keep your folder there anymore. Choose a new place for it."
- "Programs the agent runs, like Python scripts, can reach any file you can. Instrument's built-in tools still follow this list."
- "Couldn't load the release notes. Check your connection and try again."
- "This box fits up to 4,000 characters, so the rest was left out."

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
| You answered from Sam's iPhone while this computer was away, so the chat is asking again. | (removed: the card asks again without defending itself) |
| Instrument keeps "Instrument" private / Instrument keeps its data in this folder | "Instrument" is a protected folder / Instrument stores its data in this folder |
| Instrument keeps its data in "X", so it stays closed. | Instrument stores data in "X", so this folder is protected. |
| Your chats, projects and memories are kept in your Instrument folder … and what Instrument makes for you will go there too. | Your chats, projects, and memories are stored in your Instrument folder, along with Instrument's data. You can move the folder location. |
| Instrument restarts once to finish, then comes right back here. | Instrument will restart to finish setup. |
| If it didn't show up, we can send another one | If it didn't show up, try sending again. |
| Make the app larger or smaller. | Scale the app. |
| Copy and paste from any AI / Ask the AI you use a question, then paste its answer here. | Copy and paste from your existing AI tool / Submit this prompt to your existing AI tool, then paste its answer here. |
| Connect the services you already use, so your chats can work in them. | Connect your existing services to work with them in Instrument. |
| This provider doesn't share the model's limit | This provider doesn't share model limits |
| Check where your edits went | Please check your edits |
| It's one of the items you're moving, or has one inside it, so you can keep both or skip this one. | Do you want to keep both? |
