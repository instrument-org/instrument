# The Linux keyring check always says yes

**Status:** open, found 2026-11-27 reading the code and `dbus-send`'s source; not yet run on a Linux desktop. Harmless as things stand, and the thing to know before anyone fixes it.

At launch on Linux, `setup-dbus-env.ts` picks Chromium's `--password-store`: `gnome-libsecret` when `org.freedesktop.secrets` has an owner on the session bus, else KWallet when a `kwalletd` runs, else nothing and Chromium chooses. `hasDBusService` asks with `dbus-send ... org.freedesktop.DBus.NameHasOwner string:<name>` and counts a clean exit as yes. But `dbus-send --print-reply` exits 0 after printing any normal reply, `boolean false` included; it exits 1 only when the call itself errors. So wherever a session bus answers, the check says yes and every launch passes `--password-store=gnome-libsecret`, KDE and desktops with no keyring at all included.

To confirm on a desktop session: `dbus-send --session --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus.NameHasOwner string:no.such.name; echo $?` should print `boolean false` and `0`.

## What it does today

- On GNOME, and anywhere the Secret Service runs, the answer is right by accident.
- On KDE without the Secret Service, safeStorage looks for a libsecret keyring that isn't there, so key files can't be saved even though KWallet is running.
- Everywhere, the choice is the same on every launch. That is worth keeping: data encrypted under one store can't be read under another, and for cookies (if the encryption fuse is ever turned on for Linux) Chromium deletes every cookie of a site with one it can't decrypt.

## What a fix has to get right

Parsing `boolean true` alone makes it worse. A keyring that D-Bus starts on demand (common outside GNOME and KDE) has no owner until something asks for it, so it would read as absent on one launch and present on the next, and the store would change between launches. A fix also checks `ListActivatableNames`, or leaves a choice made once in the machine folder rather than choosing again each launch. Check it on GNOME, KDE with and without its Secret Service, and a minimal window manager before shipping.
