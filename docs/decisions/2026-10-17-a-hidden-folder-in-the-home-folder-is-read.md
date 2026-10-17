# A hidden folder in the home folder is read without a card

**Date:** 2026-10-17

Every hidden entry sitting directly in the home folder used to belong to the app-files place, which asks first. So a chat that read `~/.cache`, `~/.claude`, `~/.cursor` or `~/.npm` raised a card naming a folder the person has no way to judge, and the only answers were to say yes without knowing or to lose the work. On Windows the rule did not exist at all, which is how this surfaced: a test asserted the card and failed there.

Hidden folders in the home folder are now read like anything else no rule covers, and changed only after a card, which is what every other uncovered path does. What asks is a list of folders where a program keeps a sign-in under a name people know: `.ssh`, `.gnupg`, `.aws`, `.azure`, `.config/gcloud`, `.kube`, `.docker/config.json`, `.netrc`, `.git-credentials`, `.config/gh`, `.config/op`, `.password-store`, and now `.m2/settings.xml`, `.gradle/gradle.properties`, `.pypirc`, `.cargo/credentials.toml`, `.gem/credentials` and `.terraform.d/credentials.tfrc.json`. What holds every sign-in at once (the Keychain, browser profiles, 1Password's own data) stays closed unless the person opens the place.

Linux keeps an app-files place of its own, `.config` and `.local/share`, which is what `Library` is on a Mac and `AppData` on Windows. `.cache` is deliberately left out of it: what is in it is made again from something else, and asking about a cache is the kind of card this decision exists to remove.

## Why

The threat model is grounded in trusting the person and the agent they are using to be working toward the same thing. Protecting a person from their own agent is overreach; protecting them from handing out a credential they did not think about is not. So the line is a blacklist of well-known credential folders rather than a whitelist of allowed ones: a whitelist misses the folder some niche program keeps the person's work in, and the cost of that miss is a card nobody can read, which teaches the habit of saying yes to everything. That habit is worse for a person's safety than reading `~/.cache` ever was.

What this does not change: a write anywhere outside the folders a chat was given still asks, the names that run code when a folder is used (`.git/hooks`, `.envrc`, an editor's or a coding agent's settings) are still never changed outside the chat's own folder, and the files a shell runs at login are still refused whatever the settings say.

## Rejected

- **Giving Windows the same blanket rule**, which was the first reading of the test failure and the opposite of this decision: it would have made three platforms agree on asking about folders nobody can judge.
- **A whitelist of tool folders that may be read** (`.claude`, `.cursor`, `.npm`, ...), which has to be grown by hand forever and refuses the esoteric program nobody on the team uses.
- **Asking about `~/.cache` on Linux** as part of the app-files place, which would have kept the exact card this removes.
