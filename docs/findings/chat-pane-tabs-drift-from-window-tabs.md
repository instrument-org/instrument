# A chat's pane tabs drift from the window's tabs

**Status:** resolved in 6271b8163 and e77442cdb, checked 2026-11-07: the pane draws the window's strip in a scrolling mode. Whether pane tabs should compress as the window's do is the one question left open.

A chat's tabs show in a row across the head of the pane beside it ([`pane-tabs.tsx`](../../apps/studio/src/client/components/window/pane-tabs.tsx)). The window's own tabs across its bar are drawn by [`tab-strip.tsx`](../../apps/studio/src/client/components/window/tab-strip.tsx), which [`app-tab-strip.tsx`](../../apps/studio/src/client/components/window/app-tab-strip.tsx) feeds. The pane's row was written on its own when the tiles over the composer went (e4eced2b1), with Motion's `Reorder` used directly rather than through the strip, so every motion and behavior the strip gained after that had to be added to the pane by hand, and most were not. The two shared only the menu's rows (`TabMenuItems`), the edge fade (`useEdgeFade`) and the shimmer on a working tab's name. The table is the audit as it stood before the two were made one.

## The differences

Each row says which strip has the behavior and whether the pane should. "Window" is `TabStrip` as the window's bar uses it.

| Behavior | Window | Pane, before | Pane should |
| --- | --- | --- | --- |
| A tab opening | grows in from nothing (`pane-tab-arriving`, 150 ms) | appears at full width at once | grow in, as the window's do |
| A tab closing | stays drawn and collapses, the tabs beside it widening (`COLLAPSED`) | vanishes, the row jumps | collapse |
| A swapped set of tabs (another chat) | adopted with nothing animating (`groupKey`, the no-overlap rule) | nothing animates anyway | adopt silently, so the motions above do not fire on a chat switch |
| Tabs making way for a drag | 200 ms ease (`MAKE_WAY`) on position only (`layout="position"`) | Motion's default spring, on size as well as position | the window's timing |
| A dragged tab let go | critically damped settle, no momentum (`SETTLE`, `dragMomentum={false}`) | Motion's default momentum and bounce | the window's settle |
| Selecting | on the left press, without taking the keyboard from the screen (`preventDefault` on mousedown) | on click, and the tab's button keeps the focus | on the press, as the window's |
| Keyboard | one tab stop (roving `tabIndex`), Left and Right move the selection and the focus, Enter and Space select | every tab and every × is its own stop; no arrows | the window's |
| Middle press | closes, except on the × | closes anywhere on the tab, and refuses the press so a scrolling row does not start the system's autoscroll | both, and the × too |
| A long name | fades out at its end (`tab-title-fade`), since an ellipsis reads as a different name | ends in an ellipsis | fade |
| The × | shown on the tab up, and on another tab on hover; never on an icon-only tab; pressing it never starts a drag | only on hover, the tab up included | the window's |
| Separators | a hairline between two tabs neither of which is up | none | the hairlines, since they are what tells two unselected tabs apart |
| Tooltip | the whole name over a detail line: a page's address, a file's folder, a chat's latest line (`tabTooltip`) | a page's title and address (`PageTooltip`); a screen's bare name in `title` | the window's, which says the same for a page and more for a file |
| Tabs of one site | named by what tells them apart (`siteTabTitles`) | each page's whole title | the window's |
| A working agent | the name shimmers (`isWorking`) | the name shimmers while the agent drives that page | same, already; one hook per tab becomes one per row |
| Width | an even share of the row, 80 to 240 px, compressing to icons and showing a run around the tab up when even icons do not fit | a fixed 144 px, the row scrolling sideways (wheel included) and keeping the tab up in view | keep scrolling: see below |
| Edge fade | while a tab is dragged past an end | while dragged, and wherever the row scrolls on | both, as each has |
| New tab | a plus that opens one; a right click lists the tabs closed lately | a plus with a menu, Browser or the computer | the pane's menu, on the window's button |
| Context menu | at the pointer: Reload, Duplicate, Move Tab to Another Window or New Window, developer mode's toggle, the closes | a context menu on the tab: Reload, Duplicate, Open in Window Tab Bar, Open in New Window, Copy URL, the closes | both lists stand: a pane's tab belongs to its chat, so it opens a copy elsewhere rather than moving. The window's menu, opened under the pointer near the window's right edge, picked the item the right-click's own release landed on, which a context menu guards against |
| Tearing off, moving between windows | `useTabCarry`, `heldAt`, `carriedKey` | none | no: a pane's tab is one of its chat's tabs, and the chat goes wherever it goes. Open in New Window and Open in Window Tab Bar are its way out |
| Fixed tabs | supported (`isFixed`), drawn first and never dragged | none | nothing a pane holds is fixed |
| Badge | a count after the name | none | nothing in a pane counts yet; free once it is the strip |
| Hide | none | an × at the row's end puts the pane away | pane only |
| Window title | the tab up names the window | none | window only |
| Audio, pinning, loading spinner | neither has them | neither | out of scope here |

## Width: scroll or compress

The window's bar never scrolls: it shares the row out evenly and compresses tabs to icons, since a browser's tab strip does, and a bar that scrolled would hide what is open. The pane's row is narrower and holds a chat's pages, which an agent may open a dozen of; the pane was built to scroll on purpose, with a tab wide enough for its name. The strip takes both as modes of one row (`overflow="scroll"` beside the default compressing one), so everything above the width row is the same code either way and only the sizing and the scroller differ. Whether the pane should compress as the window's does is a design question the code no longer decides.

## How they share it

The pane draws `TabStrip` with `overflow="scroll"`, so opening, closing, reordering, settling, selecting, the keyboard, the ×, the separators, the name's fade and the tooltip are the window's own code. What the pane keeps of its own is what it says about its tabs (names and marks from `screenPresentation`, the working mark from `useTargetsAgentActivity`), its menu's rows, the plus's menu around the strip's `NewTabButton`, the ground a tab up stands on (`--tab-selected`, the pane's card), and the hide button. Both strips raise their tab menu through `TabMenuAtPoint`, whose panel ignores the opening right-click's release (`useOpeningReleaseGuard`, shared with `ContextMenuContent`). A behavior both rows should have goes in the strip; a pane-only one is a prop.

A driven instance kept off screen draws no frames, so its CSS animations and smooth scrolls sit at their start: there, `getAnimations()` on a tab shows the arrival keyframe or the collapse transition running, which is the check that the motion is asked for. Watching it play needs a window on screen.
