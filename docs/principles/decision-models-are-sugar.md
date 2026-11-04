# Decision models are sugar, never the hinge

The decision model (`askDecisionModel`) answers only for a person signed in to Instrument or one who brought their own OpenRouter key, so a feature that works only when it answers works for some people and silently not for the rest. Use it to make something better that already works without it: a suggested topic, a ranking, a guess the person can ignore. When a model call is what makes a feature work at all, it goes to the model the chat already runs on, since every person who has a chat has that model: a side call the way a chat's title is made (`generate-title-from-user-message.ts`), or a note that has the chat's own agent do it at the moment it applies, the way the note after a sign-in has it name the account.

**Applies when:** a feature needs a model's judgment (naming, classifying, picking among options), and choosing which model gives it.

- A chat's title is a side call on the chat's model.
- An app's account is named by the chat that signed it in, told to by the note that wakes it (`app-event-model-text.ts`).

**Not:** a ban on the decision model. Where its answer only improves on a default that stands without it, it is the cheaper and faster choice.

**Sources:**
- Decision model ruled out for anything a feature depends on, since not everyone has it (2026-11-03).
