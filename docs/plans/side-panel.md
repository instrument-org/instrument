# Plan: a side panel down the window's right edge

Status: done. The panel, its open state per tab group, the corner controls, the Chat chip and the bookmarks bar's move to web pages are built. Not built: dragging bookmarks to reorder them inside the panel (drag out and the context menu work), and hints at the window's edge.

A tab group's corner had one control that split it: unnamed on a new tab or a chat, named Chat on a page. A new tab forced the bookmarks bar on, and the places a person goes most (recent chats, folders, bookmarks, apps) lived in the left sidebar or nowhere. The side panel gathers them on the right, the way a browser's side panel does, and the corner stops splitting.

## The panel

- 288pt wide, on the window's ground at the right edge, outside the card (`WindowFrame`'s `aside`, `SidePanelSlot`). Its top row has only an X.
- Apps (icons only), Chats (four recent, then All chats, a searchable list in the panel), Files (the project folder and the Files sidebar's places), Bookmarks (the bar as a folder, the bookmarks kept off it, then All bookmarks).
- The tab up on the keyboard side draws it (`SidePanelHere`, portaled into the slot), so a pick uses that tab's own way in: it replaces the tab as a bookmark does, Back returns, and Cmd-click, right-click and drag work as they do on the bar. It never opens a new tab by itself.
- A chat already open in another group brings that group up and opens the panel there.

## Open and closed

- Open state is per tab group (`GroupOwn.sidePanel`, saved with the window's groups). Unset, it follows the tab up: open over a new tab in a group of one side, closed over anything else (`isSidePanelOpen`). So a new group opens with it, and a send from the new tab puts it away.
- Opening or closing it sets the group's own value. A pick from the panel sets it open, so the pick keeps it (`keepForPick`). Sending from a new tab clears an open the person set (`useSidePanelUpkeep`), back to following the tab up; a close they set stays.
- The corner button (a mirrored sidebar icon) shows while it is closed; the X closes it. ⌃⌘S (Ctrl+Shift+S elsewhere) toggles it, from the View menu's Toggle Side Panel and ⌘K's Show or Hide Side Panel.
- A split has no panel button on either side; one made while the panel is open keeps it, closed by its X. ⌥⌘N and New Tab in Split still split from the menu and ⌘K.

## Chat in the address field

Pages, folders and files get a Chat chip in the address field, before open-in and the star, that opens a new chat beside the tab. It shows only while the group has one side, and narrows to its bubble when the field is narrow. The leading Files or app chip is quieter than Chat.

## The bookmarks bar

The bar shows under a web page's address row and on the web's start, and nowhere else: not on a new tab, not in Files. ⇧⌘B still turns it on and off for web pages; off, it shows on the web's start alone.
