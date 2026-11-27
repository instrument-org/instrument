# Plan: a side panel down the window's right edge

Status: done. The panel, its open state per tab group, the corner controls, the Chat chip and the bookmarks bar's move to web pages are built. Not built: hints at the window's edge.

A tab group's corner had one control that split it: unnamed on a new tab or a chat, named Chat on a page. A new tab forced the bookmarks bar on, and the places a person goes most (recent chats, folders, bookmarks, apps) lived in the left sidebar or nowhere. The side panel gathers them on the right, the way a browser's side panel does, and the corner stops splitting.

## The panel

- On the window's ground at the right edge, outside the card (`WindowFrame`'s `aside`, `SidePanelRail`): the sidebar's rail mirrored (`StudioSidebarRail` with `side="right"`), so it slides in and out on the sidebar's motion, keeping its contents until the slide ends, and is resized by its left edge, 264pt until dragged (`side-panel-width.v1`; dragged under 180 it slides shut). It comes and goes at once as the group up changes. Its top row has only an X; in All chats or All bookmarks, Back and the list's name before it, which slide in with the list as the sidebar's do into a project (`useProjectShift`). Its ground moves the window, past the rows and buttons. It is gray and faint until the pointer comes into its column, and stays in color while the pointer is anywhere in it, ground included, since the page hears nothing over ground that moves the window. A folder's rows grow in as it opens.
- All chats has the chat list's view button, with its one, two and three line rows, kept apart from the list's and one line until changed (`side-panel-chat-row-density.v1`). Its lists fade at an end with more past it.
- Apps (icons only, no tiles), Chats (four recent on one line each, then All chats, a searchable list in the panel), Files (the project folder and the Files sidebar's places), Bookmarks (the bar as a folder, the bookmarks kept off it, then All bookmarks). An All row shows only while the section has more than it shows. Every heading opens its whole list in the panel, never in a tab: Apps lists the apps by name with Add an app, which opens the Apps page; Files opens This Mac (Files' computer page: folders, drives, cloud storage). A chat's time is short (`shortActivityLabel`) while the panel is narrower than `@xs`, and the list's full time past it.
- The tab up on the keyboard side draws it (`SidePanelHere`, portaled into the slot), so a pick uses that tab's own way in: it replaces the tab as a bookmark does, Back returns, and Cmd-click, right-click and drag work as they do on the bar. Apart from beside a chat shown alone (below), it never opens a new tab by itself. Its bookmarks are an outline as the Bookmarks page's is: what is held lands among the rows or, on All bookmarks, at the end of All Bookmarks, folders drag and have the bar's folder menu, and a Files row drags as a shortcut does, so it opens as a tab at a page's edge or in a strip.
- One cleverness before a split: where the group shows a chat alone, a pick of anything but a chat opens on the other side of it and takes the keyboard, so the picks after it replace that side. Once split, every pick replaces the side with the keyboard.
- It is gray and a little faint until the pointer or the keyboard is on it, or one of its menus is open, so its icons draw no eye from the page.
- A chat already open in another group brings that group up and opens the panel there.

## Open and closed

- Open state is per tab group (`GroupOwn.sidePanel`, saved with the window's groups). Unset, it follows the tab up: open over a new tab in a group of one side, closed over anything else (`isSidePanelOpen`). So a new group opens with it, and a send from the new tab puts it away.
- Opening or closing it sets the group's own value. A pick from the panel sets it open, so the pick keeps it (`keepForPick`). Sending from a new tab clears an open the person set (`useSidePanelUpkeep`), back to following the tab up; a close they set stays.
- In a window too narrow for the panel beside the group (640pt for one side, 420pt for each side of a split, in the app's own pt so a zoom counts), an open panel steps out of the way and comes back as the window widens (`sidePanelRoomOf`). Only a resize that crosses that line or a change of zoom moves it: opening the sidebar or a split in a narrow window leaves it be, and so does nudging the window after. Opened by hand without room it shows anyway until the room changes.
- The corner button (a mirrored sidebar icon) shows while it is closed; the X closes it. ⌃⌘S (Ctrl+Shift+S elsewhere) toggles it, from the View menu's Toggle Side Panel and ⌘K's Show or Hide Side Panel.
- A split has no panel button on either side; one made while the panel is open keeps it, closed by its X. ⌥⌘N and New Tab in Split still split from the menu and ⌘K.

## Chat in the address field

Pages, folders and files get a Chat chip in the address field, before open-in and the star, that opens a new chat beside the tab. It shows only while the group has one side, and narrows to its bubble when the field is narrow. The leading Files or app chip is quieter than Chat.

## The bookmarks bar

The bar shows under a web page's address row and on the web's start, and nowhere else: not on a new tab, not in Files. ⇧⌘B still turns it on and off for web pages; off, it shows on the web's start alone. Since it is out of sight most of the time, the star files a new bookmark in All Bookmarks, where the panel shows it, until another place is picked in its card, which it then remembers as a browser's does.
