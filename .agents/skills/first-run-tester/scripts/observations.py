"""Pictures and rows for a first-run results page, from a run folder.

  uv run --with pillow python observations.py grid <run folder> <screenshot> <out.png>
  uv run --with pillow python observations.py draw <spec.json> <out folder>

`grid` writes a copy of one screenshot under a percentage grid, so whoever
places the callouts reads each box off the picture instead of guessing.

`draw` reads a spec naming the observations in order:

  {"run": "<run folder>",
   "items": [{"name": "Plus button", "step": 23, "kind": "logged",
              "sentence": "The plus beside the tab opened a search page.",
              "callouts": [{"box": [51.2, 0.4, 3.2, 4.6], "note": "Clicked this plus."}]}]}

`kind` is "logged" for a note_stumble (its screenshot is the main picture) or
"passing" for something said in a step's think-aloud (the screen the tester
was looking at when it said it). `box` is x, y, width, height in percent of
the picture. The spec's "page" names the words around the rows:

  "page": {"kicker": "For ... · <date> · run <n> on <build>, <scenario>",
           "title": "<n> things a returning tester noticed, each circled",
           "description": "<one sentence for the link unfurl>",
           "left_out": "<one line naming the stumbles the rig caused>",
           "footer": "<what it was made from, and what is the test account's>"}

It writes the circled and pointed JPEGs and `page.html` beside them: the
names as an index, then one row per item. Build that with the instrument-page
skill's page.mjs, which embeds the pictures and checks the page.
"""

import html
import json
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

INK, HALO = (232, 62, 112), (255, 255, 255)


def font(size):
    for name in ("/System/Library/Fonts/Helvetica.ttc", "DejaVuSans-Bold.ttf", "arialbd.ttf"):
        try:
            return ImageFont.truetype(name, size, index=1 if name.endswith(".ttc") else 0)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def jsonl(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def grid(run, shot, out):
    im = Image.open(pathlib.Path(run) / shot).convert("RGB")
    w, h = im.size
    d = ImageDraw.Draw(im, "RGBA")
    f = font(14)
    for p in range(0, 101, 5):
        strong = p % 10 == 0
        color = (0, 160, 255, 170 if strong else 80)
        x, y = p / 100 * w, p / 100 * h
        d.line((x, 0, x, h), fill=color, width=1)
        d.line((0, y, w, y), fill=color, width=1)
        if strong and 0 < p < 100:
            for at in ((x + 2, 2), (x + 2, h - 18)):
                d.text(at, str(p), font=f, fill=(0, 90, 200, 255), stroke_width=2, stroke_fill=HALO)
            for at in ((2, y + 2), (w - 26, y + 2)):
                d.text(at, str(p), font=f, fill=(0, 90, 200, 255), stroke_width=2, stroke_fill=HALO)
    im.save(out)


def draw(spec_path, out):
    spec = json.loads(pathlib.Path(spec_path).read_text())
    run = pathlib.Path(spec["run"])
    out = pathlib.Path(out)
    out.mkdir(parents=True, exist_ok=True)
    steps = jsonl(run / "steps.jsonl")
    stumbles = {s["step"]: s for s in jsonl(run / "stumbles.jsonl")}
    number = font(22)
    e = lambda s: html.escape(s, quote=False)

    def save(im, name):
        im.convert("RGB").save(out / name, quality=82)
        return name

    def circled(shot, name, callouts):
        im = Image.open(run / shot).convert("RGB")
        w, h = im.size
        d = ImageDraw.Draw(im)
        corners = []
        for c in callouts:
            x, y, bw, bh = c["box"]
            x0, y0 = x / 100 * w - 6, y / 100 * h - 6
            x1, y1 = (x + bw) / 100 * w + 6, (y + bh) / 100 * h + 6
            d.rounded_rectangle((x0 - 3, y0 - 3, x1 + 3, y1 + 3), radius=14, outline=HALO, width=3)
            d.rounded_rectangle((x0, y0, x1, y1), radius=12, outline=INK, width=5)
            corners.append((x0, y0))
        for k, (x0, y0) in enumerate(corners, 1):
            r = 17
            cx, cy = max(r + 3, x0 - 2), max(r + 3, y0 - 2)
            d.ellipse((cx - r - 3, cy - r - 3, cx + r + 3, cy + r + 3), fill=HALO)
            d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=INK)
            d.text((cx, cy), str(k), font=number, fill=HALO, anchor="mm")
        return save(im, name)

    def pointed(shot, name, at):
        im = Image.open(run / shot).convert("RGB")
        if at:
            x, y = at
            k = 3.4
            arrow = [(0, 0), (0, 17), (4.6, 13), (8, 20.5), (11, 19.2), (7.8, 12), (13.5, 12)]
            poly = [(x + px * k, y + py * k) for px, py in arrow]
            d = ImageDraw.Draw(im)
            d.polygon(poly, fill=(20, 20, 20))
            d.line(poly + [poly[0]], fill=HALO, width=4, joint="curve")
        return save(im, name)

    def action_on(step):
        return next(s for s in steps if s.get("step") == step and s.get("tool") and s.get("before"))

    def action_making(shot):
        return next((s for s in steps if s.get("screenshot") == shot and s.get("tool") and s.get("before")), None)

    anchor = lambda name: name.lower().replace(" ", "-")
    rows = []
    for i, item in enumerate(spec["items"], 1):
        logged = item["kind"] == "logged"
        shot = stumbles[item["step"]]["screenshot"] if logged else action_on(item["step"])["before"]
        main = circled(shot, f"{i:02d}.jpg", item["callouts"])
        notes = "".join(f"<li><b>{k}</b><span>{e(c['note'])}</span></li>" for k, c in enumerate(item["callouts"], 1))
        before = '<span class="prev"></span>'
        made = action_making(shot)
        if made:
            given = made.get("input") or {}
            at = (given["x"], given["y"]) if "x" in given and "y" in given else None
            src = pointed(made["before"], f"{i:02d}-before.jpg", at)
            did = "" if at else {
                "press_key": f"{given.get('key', 'a key')} pressed",
                "type_text": "a message typed",
                "wait": "a wait",
                "pick_menu_item": "a menu item picked",
            }.get(made["tool"], "")
            caption = "The screen before" + (f", then {e(str(did))}" if did else "")
            before = f'<figure class="prev"><img src="{src}" alt="The screen before this one"><figcaption>{caption}</figcaption></figure>'
        rows.append(f"""<article class="obs" id="{anchor(item['name'])}">
<h3>{e(item['name'])}</h3>
<p class="what">{e(item['sentence'])}</p>
{before}
<figure class="main"><img src="{main}" alt="The tester's screen, with what it noticed circled and numbered"></figure>
<ol class="keys">{notes}</ol>
</article>""")
    names = "".join(f'<li><a href="#{anchor(i["name"])}">{e(i["name"])}</a></li>' for i in spec["items"])
    words = spec["page"]
    (out / "page.html").write_text(PAGE.format(
        n=len(rows),
        kicker=e(words["kicker"]),
        title=e(words["title"]),
        description=html.escape(words["description"]),
        names=names,
        rows="\n".join(rows),
        left_out=e(words["left_out"]),
        footer=e(words["footer"]),
    ))
    print(f"{len(rows)} rows in {out / 'page.html'}")


# Each row reads left to right on a wide screen: the name over the screen
# before, the sentence over the circled screen, the numbered notes beside it.
# On a narrow one they stack, the screen before kept small.
PAGE = """<!doctype html>
<!-- direction: reader="the owner, going down the list saying yes or no to each by name" point="{n} things the tester noticed, each circled, numbered and shown with the screen before it" conflicts="none; stumbles the test setup caused are left out and named at the end" shape=read feel=calm hero="the list of names, each linking to its circled screenshot" -->
<html lang="en" data-shape="read" data-feel="calm">
<head>
<title>{title}</title>
<meta name="description" content="{description}">
<style>
.obs {{ display: grid; grid-template-columns: minmax(0, 1fr); gap: .6rem 1.25rem; align-items: start; padding-block: 1.5rem; border-top: 1px solid var(--line); scroll-margin-top: 3rem; }}
.obs h3 {{ margin: 0; font-size: 1.35rem; line-height: 1.25; }}
.obs .what {{ margin: 0; font-size: 1.05rem; }}
.obs figure {{ margin: 0; }}
.obs img {{ display: block; width: 100%; height: auto; border: 1px solid var(--line); border-radius: var(--radius); }}
.prev figcaption {{ margin: .35rem 0 0; font-size: .8rem; color: var(--muted); }}
.keys {{ list-style: none; margin: 0; padding: 0; display: grid; gap: .6rem; }}
.keys li {{ display: grid; grid-template-columns: 1.45rem minmax(0, 1fr); gap: .6rem; align-items: start; }}
.keys li > b {{ display: grid; place-items: center; width: 1.45rem; height: 1.45rem; border-radius: 50%; background: var(--bad); color: var(--paper); font-size: .8rem; font-weight: 700; line-height: 1; }}
@media (min-width: 1000px) {{
  .obs {{ grid-template-columns: minmax(0, 5fr) minmax(0, 11fr) minmax(0, 5fr); }}
  .obs h3 {{ grid-column: 1; grid-row: 1; }}
  .obs .what {{ grid-column: 2 / 4; grid-row: 1; align-self: end; }}
  .obs .prev {{ grid-column: 1; grid-row: 2; }}
  .obs .main {{ grid-column: 2; grid-row: 2; }}
  .obs .keys {{ grid-column: 3; grid-row: 2; }}
}}
@media (max-width: 999px) {{ .obs .prev {{ max-width: 22rem; }} }}
ol.names {{ columns: 3 11rem; padding-left: 1.6rem; margin: 0; }}
ol.names li {{ break-inside: avoid; padding-block: .15rem; }}
</style>
</head>
<body>
<header>
<hgroup>
<p>{kicker}</p>
<h1>{title}</h1>
<p>Each row runs left to right: the screen before, the screen in question, the notes. Click any picture to enlarge it.</p>
</hgroup>
</header>
<section class="hero"><div class="bleed"><ol class="names">{names}</ol></div></section>
<section>
<h2>In the order the tester met them</h2>
<div class="bleed">{rows}</div>
</section>
<section>
<h2>Left out: what the test setup caused</h2>
<p>{left_out}</p>
</section>
<footer><p>{footer}</p></footer>
</body>
</html>
"""


if __name__ == "__main__":
    command, *args = sys.argv[1:]
    {"grid": grid, "draw": draw}[command](*args)
