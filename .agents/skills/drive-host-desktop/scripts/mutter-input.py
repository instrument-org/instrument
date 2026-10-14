#!/usr/bin/env python3
"""Keyboard and pointer input on GNOME Wayland through Mutter's own
RemoteDesktop D-Bus API, for the input Cua Driver cannot deliver there.

Runs on the host, in the desktop session's bus environment, and takes one
JSON request on stdin:

  {"action": "key", "keys": ["ctrl", "l"]}         a chord, pressed in order, released in reverse
  {"action": "type", "text": "hello"}               one keysym per character
  {"action": "click", "x": 640, "y": 400, "button": "left", "count": 1}
  {"action": "move", "x": 640, "y": 400}

Coordinates are desktop pixels on the primary monitor, the space of the
driver's get_desktop_state image. Mutter's API is on the session bus and
asks for no consent, unlike the RemoteDesktop portal; it injects input the
way gnome-remote-desktop does, into whatever has focus.
"""

import json
import sys
import time

from gi.repository import Gio, GLib

KEYSYMS = {
    "return": 0xFF0D, "enter": 0xFF0D, "escape": 0xFF1B, "esc": 0xFF1B,
    "tab": 0xFF09, "backspace": 0xFF08, "delete": 0xFFFF, "space": 0x20,
    "up": 0xFF52, "down": 0xFF54, "left": 0xFF51, "right": 0xFF53,
    "home": 0xFF50, "end": 0xFF57, "pageup": 0xFF55, "pagedown": 0xFF56,
    "ctrl": 0xFFE3, "control": 0xFFE3, "shift": 0xFFE1, "alt": 0xFFE9,
    "super": 0xFFEB, "meta": 0xFFEB, "insert": 0xFF63,
}
BUTTONS = {"left": 0x110, "right": 0x111, "middle": 0x112}

bus = Gio.bus_get_sync(Gio.BusType.SESSION)


def call(name, path, interface, method, args=None):
    return bus.call_sync(name, path, interface, method, args, None, 0, -1, None).unpack()


def keysym(name):
    lowered = name.lower()
    if lowered in KEYSYMS:
        return KEYSYMS[lowered]
    if lowered.startswith("f") and lowered[1:].isdigit():
        return 0xFFBE + int(lowered[1:]) - 1
    if len(name) == 1:
        code = ord(name)
        # Latin-1 keysyms equal their code points; the rest are offset.
        return code if code < 0x100 else 0x01000000 + code
    raise SystemExit("Unknown key %r" % name)


def open_session():
    state = call("org.gnome.Mutter.DisplayConfig", "/org/gnome/Mutter/DisplayConfig",
                 "org.gnome.Mutter.DisplayConfig", "GetCurrentState")
    connector = state[1][0][0][0]
    session, = call("org.gnome.Mutter.RemoteDesktop", "/org/gnome/Mutter/RemoteDesktop",
                    "org.gnome.Mutter.RemoteDesktop", "CreateSession")
    session_id = bus.call_sync(
        "org.gnome.Mutter.RemoteDesktop", session, "org.freedesktop.DBus.Properties", "Get",
        GLib.Variant("(ss)", ("org.gnome.Mutter.RemoteDesktop.Session", "SessionId")),
        None, 0, -1, None).unpack()[0]
    cast, = call("org.gnome.Mutter.ScreenCast", "/org/gnome/Mutter/ScreenCast",
                 "org.gnome.Mutter.ScreenCast", "CreateSession",
                 GLib.Variant("(a{sv})", ({"remote-desktop-session-id": GLib.Variant("s", session_id)},)))
    # Absolute pointer motion is addressed to a stream, so one is recorded
    # even though no frame is ever read from it.
    stream, = call("org.gnome.Mutter.ScreenCast", cast, "org.gnome.Mutter.ScreenCast.Session",
                   "RecordMonitor", GLib.Variant("(sa{sv})", (connector, {})))
    loop = GLib.MainLoop()
    bus.signal_subscribe("org.gnome.Mutter.ScreenCast", "org.gnome.Mutter.ScreenCast.Stream",
                         "PipeWireStreamAdded", stream, None, 0, lambda *_: loop.quit())
    call("org.gnome.Mutter.RemoteDesktop", session, "org.gnome.Mutter.RemoteDesktop.Session", "Start")
    GLib.timeout_add(5000, loop.quit)
    loop.run()
    return session, stream


def notify(session, method, signature, values):
    bus.call_sync("org.gnome.Mutter.RemoteDesktop", session, "org.gnome.Mutter.RemoteDesktop.Session",
                  method, GLib.Variant(signature, values), None, 0, -1, None)


def main():
    request = json.load(sys.stdin)
    action = request.get("action")
    session, stream = open_session()
    try:
        if action == "key":
            syms = [keysym(name) for name in request["keys"]]
            for sym in syms:
                notify(session, "NotifyKeyboardKeysym", "(ub)", (sym, True))
            for sym in reversed(syms):
                notify(session, "NotifyKeyboardKeysym", "(ub)", (sym, False))
        elif action == "type":
            for character in request["text"]:
                sym = keysym("\n" if character == "\n" else character) if character != "\n" else KEYSYMS["return"]
                notify(session, "NotifyKeyboardKeysym", "(ub)", (sym, True))
                notify(session, "NotifyKeyboardKeysym", "(ub)", (sym, False))
                time.sleep(0.01)
        elif action in ("click", "move"):
            notify(session, "NotifyPointerMotionAbsolute", "(sdd)",
                   (stream, float(request["x"]), float(request["y"])))
            if action == "click":
                time.sleep(0.05)
                button = BUTTONS[request.get("button", "left")]
                for _ in range(int(request.get("count", 1))):
                    notify(session, "NotifyPointerButton", "(ib)", (button, True))
                    notify(session, "NotifyPointerButton", "(ib)", (button, False))
                    time.sleep(0.05)
        else:
            raise SystemExit("Unknown action %r" % action)
        time.sleep(0.1)
    finally:
        call("org.gnome.Mutter.RemoteDesktop", session, "org.gnome.Mutter.RemoteDesktop.Session", "Stop")
    print(json.dumps({"ok": True, "action": action}))


main()
