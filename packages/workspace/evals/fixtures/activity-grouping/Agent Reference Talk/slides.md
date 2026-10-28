# Agent Reference

Giving coding agents the real source

---

## The problem

- Agents write against APIs from memory
- Memory is stale or invented
- Confident, wrong, and hard to spot

---

## The usual fixes

- Paste docs into the chat
- A docs search server
- Docs lag the code and skip edge cases

---

## Read the source instead

- `agent-reference get <name>` returns a checkout path
- Pinned to the version in your lockfile
- The agent reads it with grep and read file

---

## Demo

Building a combobox with a component library

---

## How it works

- `agent-reference.json` in the repo
- `agent-reference.local.json` for machine paths, never committed
- Clones on demand, read only

---

## What I learned

- Agents only use it when told when
- The skill description matters more than the tool

---

## Results

- Wrong-API rate: about 1 in 4 down to near zero
- Slightly slower per task, far fewer retries

---

## What's next

- Reference your own other repos
- Share reference lists across teams

---

# Questions?
