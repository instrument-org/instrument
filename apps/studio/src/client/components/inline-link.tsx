import { useImageArrival } from "@/client/hooks/use-image-arrival";
import { getFaviconUrl } from "@/client/lib/favicon-url";
import {
  mailtoAddress,
  originToDisclose,
  webUrl,
} from "@/client/lib/link-target";
import { cn } from "@/client/lib/utils";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/EnvelopeSimple";
import { type ReactNode, useState } from "react";

import { EmailLink } from "./email-link";
import { ExternalLink } from "./external-link";

/**
 * A chip drawn inside a sentence: a small icon, then a short label naming what
 * it points at.
 *
 * For the two things a link can open that are not a page: a file, and a
 * message. A link to a page is text in the sentence it was written into,
 * because a box around one says only that it is a link, which the underline
 * and the site's own icon already said.
 *
 * Centered on the text rather than sitting on its baseline, so a run of them
 * across one line reads along the same middle as the words between them.
 *
 * Twenty pixels tall, which is what the rest of it is in service of: a line box
 * around `text-sm` is twenty pixels, and a chip taller than that grows every
 * line it lands in, leaving a paragraph that mentions a file visibly looser
 * than the one under it. A table cell is where that binds hardest, since its
 * text is the small one and its line box is exactly twenty.
 *
 * Inside that budget the icon sits in an even four-pixel inset, the same on the
 * left as above and below, which is what leaves the border reading as a frame
 * around the icon rather than a box the icon is jammed against. Above and below
 * that inset is the border, a pixel of padding, and the two pixels the line box
 * has spare around a twelve-pixel icon; on the left it is the border and three
 * pixels of padding. The line box is what may not be traded away for it: a chip
 * clips what overflows it, so a line box shorter than the text's own takes the
 * bottom off every descender in the label. Only the right side is wider, where
 * the label ends rather than an icon.
 */
export const INLINE_CHIP_CLASS_NAME =
  "inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted/50 py-px pr-1.5 pl-[3px] align-middle text-sm/4 font-medium text-foreground no-underline! hover:bg-muted";

/** The icon that leads a chip, sized to what the chip's height leaves it. */
export const INLINE_CHIP_ICON_CLASS_NAME =
  "size-3 shrink-0 text-muted-foreground";

/**
 * A link that stays in the sentence it was written into.
 *
 * The same weight as that sentence, so the underline is the only thing setting
 * it apart. The typography styles set a heavier one, which made a paragraph
 * carrying several links read as a paragraph with several emphasized phrases in
 * it, none of which the writer had emphasized.
 *
 * Both of these are spelled out rather than inherited, because only half the
 * places one of these is drawn is prose: a reply takes its link styling from
 * the typography styles and a sent message takes none at all. Both are
 * important because those styles and a utility class carry the same
 * specificity, and the typography ones are declared later.
 *
 * The anchor draws no rule of its own, which is the other half of what
 * `no-underline` is for: the parts inside it each draw their own, and one
 * declared out here would paint over all of them in the label's color.
 */
const INLINE_LINK_CLASS_NAME = "font-normal! no-underline!";

/**
 * The underline, on the parts rather than on the anchor around them.
 *
 * A decoration is painted in the color of the element that declares it, and a
 * descendant cannot repaint one it inherited. Declared on the anchor, the rule
 * under the muted destination came out in the label's color, which is the
 * brightest thing in the sentence sitting under the quietest. Each part drawing
 * its own keeps every underline the color of the text above it, and leaves the
 * icon in front unruled, which an anchor-wide decoration would have struck
 * through.
 */
const INLINE_LINK_UNDERLINE_CLASS_NAME = "underline";

/**
 * One link, drawn as whatever its destination makes it.
 *
 * The single place that decides, so a link reads the same in a reply and in the
 * message that prompted it. `children` is for a caller holding markup for the
 * label -- a host in backticks, a bolded title -- and `label` is that same label
 * as text, which is what the decision is made from either way.
 */
export function InlineLink({
  children,
  className,
  href,
  label,
  ...props
}: Omit<React.ComponentProps<"a">, "children"> & {
  children?: ReactNode;
  href: string;
  label: string;
}) {
  const address = mailtoAddress(href);
  if (address) {
    return (
      <MailLink address={address} className={className}>
        {children ?? label}
      </MailLink>
    );
  }

  return (
    <WebLink {...props} className={className} href={href} label={label}>
      {children ?? label}
    </WebLink>
  );
}

/**
 * A link to an address, as a chip naming who the mail is for.
 *
 * A chip rather than a disclosed origin because an address is already the whole
 * destination: there is nothing about it left to reveal, and the thing worth
 * saying is that clicking it opens a message rather than a page.
 */
export function MailLink({
  address,
  children,
  className,
}: {
  address: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <EmailLink
      className={cn(INLINE_CHIP_CLASS_NAME, className)}
      email={address}
      title={address}
    >
      <EnvelopeSimpleIcon className={INLINE_CHIP_ICON_CLASS_NAME} />
      <span className="truncate">{children}</span>
    </EmailLink>
  );
}

/**
 * A link to a page: the site's icon, the label, and the origin it leads to when
 * the label does not already say.
 *
 * One shape for all of them, whether the label is a sentence or the URL itself.
 * The alternative was a chip wherever the label happened to be exactly an
 * origin, and the rule deciding that was invisible to anyone who did not
 * already know it: two links a line apart, one boxed and one not, with nothing
 * on screen saying why.
 *
 * The whole thing is one anchor, so a click anywhere on it opens the same URL,
 * and the label is wrapped in `bdi` so a right-to-left one cannot reorder
 * itself around what sits beside it.
 */
export function WebLink({
  children,
  className,
  href,
  label,
  ...props
}: React.ComponentProps<"a"> & {
  href: string;
  /** The label as plain text, which is what the origin is compared against. */
  label: string;
}) {
  const url = webUrl(href);
  const origin = url ? originToDisclose(label, url) : null;

  return (
    <ExternalLink
      {...props}
      className={cn(INLINE_LINK_CLASS_NAME, className)}
      href={href}
    >
      {/* An image is an atomic inline, and the boundary between one and the
          text after it is an ordinary place to wrap, which left the icon
          behind at the end of the line above pointing at nothing. A break is
          refused where it belongs to this span and allowed again inside the
          label, so the icon keeps the label's first word and everything after
          that wraps as prose. */}
      <span className="whitespace-nowrap">
        {url && <SiteIcon className="mr-1 inline-block" href={href} />}
        <bdi
          className={cn("whitespace-normal", INLINE_LINK_UNDERLINE_CLASS_NAME)}
        >
          {children}
        </bdi>
      </span>
      {origin !== null && (
        // One text node rather than three: split across them, the accessible
        // name this anchor computes has the parentheses standing off from the
        // origin as separate words.
        <span
          className={cn(
            "text-muted-foreground",
            INLINE_LINK_UNDERLINE_CLASS_NAME,
          )}
          data-slot="link-origin"
        >{` (${origin})`}</span>
      )}
    </ExternalLink>
  );
}

/**
 * The largest a favicon can be and still be the lookup service saying it has
 * none.
 *
 * Asked for a host it does not know, the service answers 404 with a decodable
 * sixteen-pixel globe of its own. A browser paints an image whose bytes decode
 * whatever the status line said, so nothing about that reaches `onError`, and
 * the response carries no header this origin is allowed to read. What is left
 * is the size: a real icon comes back at the source's own resolution, which
 * this endpoint hands over without upscaling, and the placeholder is always
 * sixteen square.
 *
 * A site whose only icon is a sixteen-pixel one is therefore read as having
 * none. That is the better way to be wrong: what it costs is a link with no
 * icon in place of a sixteen-pixel image resampled into a twelve-pixel box.
 */
const ABSENT_ICON_SIZE = 16;

/**
 * Every source already known to have nothing behind it.
 *
 * A link with no icon draws none, so what a first render costs is the width of
 * one that is about to be taken away again. Remembering which sources those
 * were spares every later link to the same host that shuffle, and a transcript
 * naming one host repeatedly is the ordinary case rather than the exception.
 * Keyed by source and never evicted, the same as the arrival cache it sits
 * beside.
 */
const absentIcons = new Set<string>();

/**
 * The site's own icon, and nothing at all when the site has none.
 *
 * A stand-in glyph was the other option and says less than the space it takes:
 * a globe in front of a link is a picture of the word link. Where an icon
 * cannot be had, the label and the origin beside it were already carrying the
 * whole message.
 */
function SiteIcon({ className, href }: { className?: string; href: string }) {
  const src = getFaviconUrl(href);
  const [absent, setAbsent] = useState(() => absentIcons.has(src));
  const arrival = useImageArrival(src, "icon");

  if (absent) {
    return null;
  }

  const markAbsent = () => {
    absentIcons.add(src);
    setAbsent(true);
  };

  return (
    <img
      alt=""
      // A reply is rendered as prose, and prose gives every image a margin of
      // over an em on each side. On a picture between two paragraphs that is
      // right; on an icon inside a sentence it is a line twice the height of
      // the ones around it. Important because the typography styles and a
      // utility class carry the same specificity, so the plain utility only
      // wins where prose was not applied in the first place -- which is to say,
      // everywhere the margin was already zero.
      className={cn(
        "my-0! size-3 shrink-0 rounded-xs bg-background align-middle",
        arrival.className,
        className,
      )}
      onError={markAbsent}
      onLoad={(event) => {
        if (event.currentTarget.naturalWidth <= ABSENT_ICON_SIZE) {
          markAbsent();
          return;
        }
        arrival.onLoad();
      }}
      src={src}
    />
  );
}
