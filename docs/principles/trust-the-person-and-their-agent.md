# Trust the person and their agent; defend real threats

The person is not an adversary, and neither is the agent they are steering: anything the agent can do, the person could do too. Protection goes where it matters, to the folders the person keeps closed, the places people keep their own things, the app's secrets and anything that would break the product, and not to vectors that only exist in theory. Hardening against those builds rigid ceremony that keeps people from getting real work done, while anything able to exploit them could already do worse directly.

**Applies when:** triaging a security finding, writing a sandbox rule, deciding whether to lock a folder or a tool.

- Chats are not protected from each other. They are all the person's own data, and an agent may read another chat's records.
- A finding that needs the person's own agent to tamper with something does not get a fix.
- A finding whose only effect is harmless, like an empty folder, is left alone.
- Reviews report architectural flaws and deterministic bugs inside the threat model, not hypothetical attacks outside it.

**Not:** a claim that outside content speaks for the person. A web page, an email or a document can carry planted instructions, and the limits in the threat model hold whatever the agent decides. Not a reason to give the agent the threat model's details either.

**Sources:**
- [Threat model](../architecture/threat-model.md).
- Write the threat model down and use it to refuse over-hardening, and no fixes against the person's own agent tampering, stated 2026-10-14.
- Fantasy vectors excluded, and chats may read each other's records, stated 2026-10-16; the person and their agent are trusted to act intentionally, 2026-10-17.
- Reviews report flaws and deterministic bugs, stated 2026-10-20; harmless effects are out of scope, 2026-10-28.
