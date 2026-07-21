# Responsive layout

How Studio decides what "narrow" means. The short version: a viewport media
query answers _how big is the OS window_, and almost nothing in the renderer is
actually asking that. Layout wants _how much room does this component have_,
which is a different number.

## Why the window is the wrong number

Two things sit between the window and a page, and neither moves a viewport
breakpoint:

- **UI zoom.** The whole main window scales with CSS `zoom` on `ZoomRoot`
  (`apps/studio/src/client/components/zoom-root.tsx`), user-adjustable 0.5x-2x.
  `zoom` divides every layout length below it, but media queries are evaluated
  against the viewport and ignore it entirely. At 2x on a 1440px window a page
  has 720 layout px while `matchMedia("(min-width: 1024px)")` still reports
  `true`.
- **The sidebar rail.** It opens, closes, and is dragged between 200px and 480px
  (`apps/studio/src/client/atoms/sidebar.ts`), all of which change what a page
  gets and none of which the window knows about.

They compound. A zoomed-in window with a wide sidebar open can leave a page a
few hundred layout px while every viewport breakpoint still reads as desktop.

## The shell container

`AppChrome` names the box a page actually occupies
(`apps/studio/src/client/components/app-chrome.tsx`):

```
@container/app-content
```

It is the flex child between the sidebar rail and the window edge, inside the
zoom root, so its inline size already accounts for both distortions above. A
page adapts to it by prefixing utilities with the container instead of a
viewport breakpoint:

```
lg:px-8   ->  @5xl/app-content:px-8
```

Tailwind's container scale is not the viewport scale. The sizes that line up
exactly: `@3xl` = 768px (`md`), `@5xl` = 1024px (`lg`), `@7xl` = 1280px (`xl`).
There is no container step at 640px, so `sm:` has no direct translation; pick
`@xl` (576px) or `@2xl` (672px) by what the layout needs.

The container wraps the route content only. It deliberately sits _below_ the
portal target that `PortalContainerProvider` renders as the route's sibling --
see the containing-block gotcha below, which is load-bearing and cost real
debugging time to find.

## Which tool for which question

| Question                                                                       | Tool                 |
| ------------------------------------------------------------------------------ | -------------------- |
| How much room does this component have?                                        | container query      |
| How big is the OS window / what device is this?                                | viewport media query |
| Does responsive state need to leave CSS (close a panel, tell another process)? | JS measurement       |

Reach for JS last. A layout that merely _looks_ different is a container query;
JS is for when a width has to change application state. Note that a structural
switch is usually not a real exception -- see the project page below.

Portalled dialogs are a legitimate media-query case: they are sized against the
window, not against the page behind them.

## Worked example: the project page

`apps/studio/src/client/routes/_app/projects/$id/index.tsx` puts a details panel
beside the main column when there's room and stacks it inline when there isn't.
The panel holds live editing state and a debounced file write, so rendering two
copies and hiding one would have two textareas racing to save the same file --
the usual CSS answer of duplicating markup is unavailable.

It resolves with a single instance and no JS. The page is one grid; only the
panel is placed explicitly, into column two spanning every row. The heading,
composer and task list carry no placement classes at all and auto-flow down
column one, which is also the order they read in when the grid collapses to a
single column at `@6xl/app-content`. The panel is `sticky` only while the grid
has two columns.

The general shape: when a responsive change looks structural, check whether grid
placement can express it before reaching for a boolean in JS. Reparenting is the
only thing CSS genuinely cannot do, and a grid usually makes reparenting
unnecessary.

## Sizing portalled content under zoom

Radix portals to `document.body`, outside the zoom root, so floating content
self-applies `zoom` via `useAppZoomStyle`
(`apps/studio/src/client/hooks/use-app-zoom.ts`). On a self-zoomed element,
units do not all behave the same way, and getting this backwards is silent:

| Unit         | Behaviour on a self-zoomed element                | Rule                            |
| ------------ | ------------------------------------------------- | ------------------------------- |
| `vw` / `vh`  | not rescaled; `100vh` renders `zoom x` the window | divide by `var(--content-zoom)` |
| `%`          | already resolved in the element's own units       | do **not** divide               |
| `rem` / `px` | intrinsic; the size the content needs             | do **not** divide               |

Dividing an intrinsic size pins the element's rendered size while the text
inside it grows, which is the one outcome zoom exists to prevent. Measured on a
1440px window at 2x, for a dialog that wants to be `32rem` wide:

| Expression                             | Layout px | Rendered px |
| -------------------------------------- | --------: | ----------: |
| `calc(32rem / z)`                      |       256 |         512 |
| `min(32rem, calc((100% - 2rem) / z))`  |       384 |         768 |
| `min(32rem, calc((100vw - 2rem) / z))` |       512 |        1024 |

Only the last keeps the dialog's layout room constant while letting it grow on
screen. `ZOOM_CONTENT_MAX_WIDTH` uses that shape; a dialog wanting a different
intrinsic size writes the same shape out literally, since Tailwind only
generates arbitrary values it can see in source.

## Gotchas

- **Never put a container above portalled floating UI.** floating-ui treats any
  element whose `container-type` isn't `normal` as a containing block for
  fixed-position content (`isContainingBlock` in `@floating-ui/utils/dom`) and
  subtracts that element's rect from every position it computes. Chrome does
  _not_ actually make one, so the correction is pure error: every menu, popover,
  tooltip and context menu shifts by the container's offset, scaled by the zoom
  factor. It is silent, it grows with distance from the container's origin, and
  near the top-left it is small enough to look plausible. A context menu landing
  under the cursor also puts a destructive item where the click lands. This is
  why `@container/app-content` wraps the route content instead of the app-chrome
  content column: the portal target is the route's sibling, so the container
  must stay below it. Verifying that Chrome doesn't create a containing block is
  _not_ sufficient -- what matters is what the positioning library believes.
- **A container query naming a container that has no matching ancestor does not
  match, silently.** There is no warning and no fallback. This is why the
  breakpoint variants are not globally redefined as container queries: dialogs
  portal outside `app-content`, and every `sm:max-w-*` on them would quietly
  stop applying.
- **`getBoundingClientRect()` returns on-screen px; `offsetWidth`/`offsetHeight`
  and `ResizeObserver` return layout px.** Under zoom these differ by the zoom
  factor. Any code that measures with one and positions with the other is broken
  at zoom != 1 -- virtualizers are the classic case, since they measure rows and
  then position them with `transform: translateY()`. Measure with `offsetHeight`.
- **The main window has `minWidth: 720`**
  (`apps/studio/src/electron-main/windows/main/index.ts`), so `sm:` (640px) is
  always true and `md:` (768px) only varies in a 48px band. Existing `sm:`
  utilities are effectively unconditional, not responsive.
- The breakpoint readout in the dev panel deliberately reports the _viewport_
  breakpoint and should stay a media query.
