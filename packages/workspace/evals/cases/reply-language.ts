/**
 * How the chat's replies show things: comparisons, numbers, files, sources,
 * warnings, plans, edited text, and the plain answers that need none of it.
 *
 * Eval-only and scored offline: each run records its replies and the files
 * that exist, and a judge reads the rendered reply against the case's rubric
 * in `REPLY_LANGUAGE_RUBRICS`. The fixtures are synthetic; every name in them
 * is made up.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { chatGrants } from "../../src/lib/chat/grants";
import { workDir } from "../../src/lib/work-dir";
import { type Assertion, defineEval } from "../harness";

const FIXTURES = path.resolve(
  import.meta.dirname,
  "../fixtures/reply-language",
);

function walk(root: string, out: string[], depth = 0): void {
  if (depth > 6 || !fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(`${full}/`);
      walk(full, out, depth + 1);
    } else out.push(full);
  }
}

const record: Assertion = {
  check: async ({ sessions, chatId }) => {
    const replies = sessions
      .filter((session) => !session.parentId)
      .flatMap((session) => session.messages)
      .filter((message) => message.role === "assistant")
      .map((message) =>
        message.parts
          .flatMap((part) => (part.type === "text" ? [part.text] : []))
          .join("\n\n"),
      )
      .filter((text) => text.trim() !== "");
    const grants = (await chatGrants(chatId)).map((grant) => grant.path);
    const files: string[] = [];
    const work = String(workDir(chatId));
    for (const root of [...grants, work, path.join(os.homedir(), "Documents")])
      walk(root, files);
    return {
      evidence: JSON.stringify({ files, grants, replies, work }),
      passed: true,
      text: "Recorded the reply",
    };
  },
  text: "Recorded the reply",
};

const chat = (name: string, prompt: string, folder?: string) =>
  defineEval({
    assertions: [record],
    ...(folder ? { folders: [{ path: path.join(FIXTURES, folder) }] } : {}),
    kind: "chat",
    name: `rl-${name}`,
    prompt,
  });

const WORDY_PARAGRAPH =
  "I am writing to you today in order to express my very strong interest in the Marketing Coordinator position that I saw posted on your website. I truly believe that I would be a really great fit for this role because of the fact that I have basically spent the last four years working in marketing at a small nonprofit organization. During that time, I was responsible for managing all of our social media accounts, and I was able to grow our Instagram following from around 2,000 to over 9,500 followers. In addition to that, I also planned and coordinated our annual fundraising gala, which actually ended up raising $48,000, which was a record amount for our organization. I am someone who is very detail-oriented, and I really, truly love working with people in a collaborative team environment.";

export const REPLY_LANGUAGE_EVALS = [
  chat("egg", "How long do I boil an egg for a jammy yolk?"),
  chat(
    "sourdough",
    "Why does my sourdough starter smell like nail polish remover?",
  ),
  chat("interview", "I bombed a job interview this morning and I feel awful."),
  chat(
    "packing",
    "Add sunscreen and a phone charger to my packing list.",
    "Trip",
  ),
  chat(
    "wedding-files",
    "The print shop needs the print files and I'm posting the rest on Instagram and our website. Which files go where?",
    "Wedding invite",
  ),
  chat(
    "cover-letter",
    "Write me a one-page cover letter for this job as a Word doc.",
    "Job application",
  ),
  chat(
    "instagram-resize",
    "Make these into 1080 by 1080 squares for Instagram.",
    "Instagram photos",
  ),
  chat("tax-docs", "Find all my 2025 tax documents.", "Paperwork"),
  chat("rename-receipts", "Rename my receipts by date and store.", "Receipts"),
  chat(
    "insurance",
    "Compare these three home insurance quotes for me.",
    "Home insurance",
  ),
  chat(
    "mortgage",
    "Which of these mortgage offers is the best deal? We plan to stay about seven years.",
    "Mortgage",
  ),
  chat(
    "etsy-photo",
    "Which of these two should be the main photo on my Etsy listing for the speckled mug?",
    "Shop photos",
  ),
  chat(
    "apartments",
    "Rank these apartments for us. We have a toddler and I commute downtown.",
    "Apartments",
  ),
  chat(
    "lease-or-buy",
    "Should I lease or buy my next car? I drive about 8,000 miles a year.",
  ),
  chat("electric", "How has my electric bill moved this year?", "Bills"),
  chat("quarter", "How did the shop do in Q3 compared to Q2?", "Shop books"),
  chat("spending", "Where did my money go in October?", "Bank"),
  chat(
    "lisbon",
    "Plan three days in Lisbon for the two of us in March. We like food and walking, not museums.",
  ),
  chat(
    "family-calendar",
    "How do I set up a shared family calendar on our iPhones?",
  ),
  chat(
    "claim-history",
    "What's happened with my water damage claim so far?",
    "Water damage claim",
  ),
  chat("moving", "What do I still need to do before the move?", "Move"),
  chat("lease-dog", "Am I allowed to have a dog under my lease?", "House"),
  chat("report-summary", "Summarize this report for my boss.", "Report"),
  chat("standing-desks", "Do standing desks actually help with back pain?"),
  chat(
    "invoices",
    "Pull every invoice into one table and tell me who still owes me.",
    "Invoices",
  ),
  chat(
    "landlord-email",
    "Write an email to my landlord asking him to fix the heater. It's been broken since Monday.",
  ),
  chat("tighten", `Can you tighten this paragraph?\n\n${WORDY_PARAGRAPH}`),
  chat(
    "sheets-formula",
    "What's the Google Sheets formula to add up column B only when column A says Paid?",
  ),
  chat(
    "ibuprofen",
    "Can I take ibuprofen with my blood pressure medicine? I'm on lisinopril.",
  ),
  chat(
    "contract",
    "Can you review this contract before I sign it?",
    "Contract",
  ),
  chat(
    "coffee",
    "Find me three good coffee shops near Union Square in San Francisco to work from.",
  ),
  chat(
    "health-plans",
    "Which health plan should we pick for next year?",
    "Health plans",
  ),
  chat(
    "algebra",
    "Can you show me how to solve 3(x - 4) = 2x + 5 step by step? I need to explain it to my son.",
  ),
  chat(
    "loan-payment",
    "What would my monthly payment be on a $250,000 loan at 6.75% over 30 years, and how much interest is that in total?",
  ),
  chat(
    "email-tighten",
    `Can you make this shorter? I'm about to send it.\n\nHi Jordan, I just wanted to quickly reach out and touch base regarding the proposal that we sent over to you last week. I was wondering if you had maybe had a chance to take a look at it yet? We are really excited about the possibility of working together on this project, and we think that we could really help your team out a lot. If you have any questions at all or if there is anything at all that you would like us to change, please don't hesitate to let me know and I would be more than happy to help. Also, just so you know, the pricing in the proposal is only valid until the end of the month. Thanks so much for your time, Alex`,
  ),
  chat(
    "reply-landlord",
    `My landlord sent this. Can you write a reply saying Thursday works but I'll be home only after noon?\n\nHi, this is Marcus from Alder Street Properties. We need to do the annual smoke detector inspection in your unit. Would Thursday between 10 and 2 work for you? If not, let me know a day that does. Thanks, Marcus`,
  ),
  chat(
    "escrow",
    "How does escrow on a mortgage work? I don't get where the money goes each month.",
  ),
];

/**
 * What a good answer to each case gets across and the facts it must get
 * right, keyed by case name. Silent on format: the variants under test decide
 * how a reply shows things, and the judge scores whether it said them.
 *
 * @public Read by whoever scores a run, outside the harness.
 */
export const REPLY_LANGUAGE_RUBRICS: Record<string, string> = {
  "rl-egg":
    "A jammy yolk takes about 6 to 7 minutes (6½ is the usual answer) for a large egg lowered into already-boiling water, then an ice bath or cold water to stop the cooking. The time should come first, with at most one or two qualifiers (eggs straight from the fridge, a minute less for runnier or more for firmer). Plain prose of two or three sentences is the best answer; a heading, list, or table is padding.",
  "rl-sourdough":
    "A nail-polish-remover (acetone) smell means the starter is hungry: the yeast and bacteria have used up their food and give off acetone-like compounds, especially when fed too little or kept warm too long. It is not spoiled and is safe to use; the fix is to feed it more often or at a higher ratio (for example 1:5:5 starter to flour to water), discard more before feeding, or keep it cooler, and it should smell sweet-sour again within a few feedings. Pink or orange streaks or fuzzy mold, not the smell, are the signs to throw it out. A short plain-prose explanation followed by the fix is the best answer.",
  "rl-interview":
    "This calls for a supportive reply: acknowledge that it feels awful, say that one bad interview is common and often less damaging than it feels, and offer at most one gentle, concrete suggestion (jot down what happened while it's fresh, still send a thank-you note) or one question about what went wrong. Warm plain prose of a few short paragraphs is the best answer; headings, bullet lists, bold, or a multi-step plan read as cold.",
  "rl-packing":
    "The agent should edit Trip/Packing list.md in place, adding Sunscreen and Phone charger as unchecked items in the same style as the rest (under Bag, or a fitting new section), and keep every existing item: Rain jacket, Walking shoes, Two sweaters, Passport, Euro coins for trams, Earplugs. The reply should say both were added and where, and point to the file. A sentence or two of plain prose is enough.",
  "rl-wedding-files":
    "The print shop gets the two print PDFs: invite-print-bleed.pdf (5x7 in, CMYK, 0.125 in bleed, crop marks) and rsvp-card-print-bleed.pdf (4.25x5.5 in, CMYK, bleed). Instagram gets invite-instagram-square.png (1080x1080, for a feed post) and invite-instagram-story.png (1080x1920, for a story), and the website gets invite-website-banner.png (1600x600). A good answer sorts all five files by destination, with a word on why each fits, and assigns none to the wrong place.",
  "rl-cover-letter":
    "The agent should make a one-page Word document (.docx) cover letter for the Operations Coordinator role at Fernwood Community Health, addressed to Dana Whitfield, and say where the file is. The letter must use only true facts from Sam Taylor's resume that match the posting: scheduling for 6 providers across 2 locations, cutting supply spending 18% ($21,000 a year), cutting no-shows from 11% to 6%, hiring and training 12 staff, the work-order tracker that cut close time from 9 days to 5, and conversational Spanish; it must not invent degrees, certifications, employers, or numbers. The reply should be short and name anything Sam should check or fill in before sending (date, contact details), noting the December 15, 2026 deadline is a plus.",
  "rl-instagram-resize":
    "The folder has four photos: IMG_4102.jpg (3000x2250, landscape sunset), IMG_4117.jpg (2250x3000, portrait of a lighthouse whose lamp sits near the top edge), IMG_4130.jpg (3200x1800, wide mountains with a hiker at the far right), and IMG_4135.jpg (1600x1600, already square). A good result is four new 1080x1080 images that leave the originals untouched, and a reply saying where they are and how the non-square ones were made square (cropped or padded). If it center-cropped, it should say the lighthouse's top and the hiker were cut off and offer another way; claiming a perfect result without looking is a miss.",
  "rl-tax-docs":
    "Eight files are 2025 tax documents: the 2025 W-2 from Brightline Logistics and the 1099-INT from Harborview Savings (both in Taxes 2025), the 1099-DIV from Northfield Brokerage (Bank), the 1099-NEC from Maple Street Studio (Work), the Form 1098 mortgage interest statement from Lakeshore Home Loans saved as Scans/scan_0207.pdf, the Riverside Food Bank receipt for $250 (Giving), the Second Chance Thrift donation slip saved as Scans/scan_0211.jpg, and the Cascade Public Radio $120 receipt email (Mail). The 2024 W-2, the 2024 food bank receipt, Resume 2025.docx, the car registration, and the December bank statement are not 2025 tax documents and should not be listed as such. A good answer says where each one lives, groups them sensibly (income forms, mortgage, donations), and notes that the HAS Form 1099-SA from Evergreen HAS listed in To gather.txt is missing.",
  "rl-rename-receipts":
    "There are nine receipts: Corner Hardware 10/03/2026 (IMG_3301.jpg), Green Leaf Market on Oct 5, 2026 twice (IMG_3302.jpg in the morning, IMG_3307.jpg in the evening), Metro Office Supply October 9, 2026 (scan0001.pdf), Sunrise Diner 2026-10-11 (IMG_3315.jpg), Blue Door Pharmacy 10/14/26 (document(1).pdf), Harbor Gas & Go 10/17/2026 (IMG_3322.jpg), Pine Street Pet Supply Oct 22, 2026 (receipt.pdf), and a handwritten Hillside Farm Stand receipt with no date (IMG_3330.jpg). A good result renames the eight dated ones to one consistent date-and-store pattern with sortable dates, keeps their extensions, keeps both Green Leaf receipts without one overwriting the other, and leaves the farm stand receipt alone or asks about it rather than inventing a date. The reply should give how many were renamed, the exception and why, and perhaps one before-and-after example.",
  "rl-insurance":
    "Harbor Mutual is $1,842 a year with a $1,000 deductible, $480,000 dwelling, $240,000 personal property at actual cash value, $10,000 water backup included, and $300,000 liability. Keystone Home is the cheapest at $1,615 but has a $2,500 deductible and no water backup unless added for $95 a year ($1,710), with $480,000 dwelling, $240,000 replacement-cost property, and $300,000 liability. Pinecrest is $1,930 with a $1,000 deductible and the most coverage: $520,000 dwelling, $260,000 replacement-cost property, $25,000 water backup, and $500,000 liability. A good answer lines up the same attributes for all three, flags Harbor's actual-cash-value contents and Keystone's high deductible and missing water backup, and gives a verdict (Pinecrest is the strongest value for $88 a year more than Harbor; Keystone only for the lowest premium with $2,500 set aside).",
  "rl-mortgage":
    "Over seven years (84 payments), Lakeview Bank (6.125%, 0.5 points, $4,980 closing, $2,734 a month) costs about $234,600 in payments plus closing, First Harbor (6.19%, 0.25 points, $4,420, $2,752) about $235,600, and Summit Credit Union (6.25%, no points, $3,850, $2,770) about $236,500, so Lakeview is the best deal by roughly $950 and $1,900, a little more once its faster principal paydown is counted. Lakeview's extra upfront cost pays back in about 31 months, well inside seven years. A good answer leads with the pick, puts all three on the same seven-year footing, and says the differences are small and that a much shorter stay (under about two and a half years) would favor Summit.",
  "rl-etsy-photo":
    "speckled-mug-window.jpg should be the main photo: it is sharp, so the speckles read clearly, on a bright, clean, light background that holds up as a small thumbnail in search results. speckled-mug-kitchen-table.jpg is soft and blurry on a dark brown background, so it suits a secondary lifestyle slot. A good answer may note that the handle fades into the pale background in the window shot. A few sentences of plain prose are the best answer.",
  "rl-apartments":
    "The five listings: 1420 Linden Ave 3B ($2,350, third-floor walk-up, in-unit laundry, 20 minutes by light rail, park and daycare nearby, 1925 building with a lead paint disclosure); Eastgate Commons 210 ($2,600, elevator, two baths, on-site playground, laundry on each floor, about 35 minutes by bus with a transfer); 615 River Rd ($2,200, ground floor with a fenced yard, laundry hookups only, about 40 minutes by car or an hour by bus); Maple Heights 5C ($2,950, elevator, in-unit laundry, daycare in the building with a four-month waitlist, 12-minute walk downtown, faces a six-lane boulevard); and 47 Old Town Square 4 ($2,450, fourth-floor walk-up above a pub with live music until 2 a.m., coin laundry in the basement, no outdoor space, 1894 building with a lead paint disclosure, 15-minute walk). A good ranking states its criteria (the commute, and a toddler's needs: stairs with a stroller, laundry, room to play, noise, lead paint in old buildings) and gives a reason for each place. Maple Heights or Linden at the top and Old Town and River Rd at the bottom are defensible, and the top order can turn on budget, which was not given and is worth naming.",
  "rl-lease-or-buy":
    "At 8,000 miles a year the driver is well under typical lease allowances of 10,000 to 12,000, so mileage penalties are not a concern and leasing is workable. Buying usually costs less over time if the car is kept well past the loan, five years or more, while leasing suits someone who wants a new car every two or three years, a lower monthly payment, and no resale; how long they keep a car is the deciding question, which a good answer names or asks. A clear lean with the condition that would flip it beats an even-handed list; short prose or two brief lists both work.",
  "rl-electric":
    "From January to October 2026 the bill ranged from a low of $96.25 in April (506 kWh) to a high of $244.10 in August (1,284 kWh), with a winter hump in January ($182.40), a summer peak in July and August, and a drop back to $112.45 in October. The rate stayed about $0.19 per kWh all year, so the swings come from usage (heating and cooling), not price. The ten months total $1,605.70, about $161 a month. A good answer gives the seasonal shape in a sentence and names the peak and low with amounts; the shape matters more than every monthly value.",
  "rl-quarter":
    "Fern Street Bakery's revenue rose 15.9%, from $114,300 in Q2 (April to June 2026) to $132,500 in Q3 (July to September), driven by online sales roughly doubling from $13,900 to $28,300, while in-store sales grew only 3.8% ($100,400 to $104,200). Profit still fell 17.6%, from $16,940 to $13,960 (margin 14.8% to 10.5%), because payroll rose $9,200 ($39,300 to $48,500) and marketing rose from $1,950 to $6,900; cost of goods kept pace with sales, gross margin about 68% in both. A good answer leads with that mixed verdict (more sales, less profit), gives the few key numbers with their changes, and names the two expense drivers.",
  "rl-spending":
    "October's checking account (73 transactions) shows about $5,336 of spending, not counting $1,000 moved to savings in two $500 transfers, against $5,925 coming in (two $2,940.18 paychecks and $45 from a friend). Rent ($1,850, about 35%) is the biggest item, then car costs (about $1,238: a one-off $684.50 Valley Auto Repair brake bill, the $312 loan payment, $128.40 insurance, gas, and parking), groceries (about $485), shopping (about $326), utilities ($267.45), and dining out (about $266), plus coffee (13 Bean There Cafe visits, about $72). A good answer gives the total, the biggest categories with amounts and rough shares, calls out the one-off repair, and treats the savings transfers as saving rather than spending; category boundaries can differ a little, so totals within a few dollars are fine.",
  "rl-lisbon":
    "A three-day plan for two in March built around food and walking rather than museums: neighborhoods such as Alfama, Baixa and Chiado, Bairro Alto, Príncipe Real, and Belém (for pastéis de Belém rather than its museums), with markets and meals like the Mercado da Ribeira, tascas, petiscos, and seafood. Each day should have a clear shape with a rough order and timing, and the plan should note the walking realities (steep hills, slippery cobblestones, comfortable shoes) and March weather (mild, roughly 15 to 18 °C, some rain, so a rainy-day swap). It should not invent specific restaurant details it cannot support.",
  "rl-family-calendar":
    "Two standard ways: set up Family Sharing (Settings > your name > Family Sharing), which creates a shared Family calendar in the Calendar app, or share an iCloud calendar: in Calendar, tap Calendars, tap the info button next to an iCloud calendar, tap Add Person, and enter each family member's Apple Account email, and they accept the invitation. Everyone needs iCloud Calendars turned on (Settings > your name > iCloud). A good answer says what's needed first, gives a short ordered set of steps with the exact menu names, and says how to tell it worked.",
  "rl-claim-history":
    "The supply line burst on August 8, 2026 and Sam reported it on August 10; claim PIC-2026-448172 opened August 11 with adjuster Rachel Moreno, who inspected on August 19 and on August 21 confirmed coverage, approved DryRight Restoration's $3,180 mitigation (paid directly on September 2), and excluded the supply-line repair itself. Sam sent Oakline Builders' $14,750 estimate on September 9, followed up on September 30 after three weeks of silence, and on October 6 Rachel asked for subfloor photos and the plumber's invoice, which Sam sent on October 15. On October 28 the settlement came: $13,950 approved ($800 cut for upgraded cabinets), less the $1,000 deductible and $1,830 recoverable depreciation, so $11,120 now. Where it stands: check #0048817 for $11,120 was mailed October 30 to Lakeshore Home Loans' loss draft department, so Sam needs to call Lakeshore ((800) 555-0164, loan LHL-0039918), likely with a signed contractor agreement and W-9, to get it released, and the $1,830 is paid once repairs are done and the final invoice is sent by February 4, 2027. A good answer gives the dated events in order, then where things stand and what comes next.",
  "rl-moving":
    "The move is Saturday, January 9, 2027, from 1630 Fir Court Apt 5 to 3418 Hazel Street; already done, and not to be listed as to-dos, are the Hazel lease and deposit, Bluebird Movers (booked, $200 deposit paid), notice to Fir Court, and gas at Hazel. Still open, time-sensitive first: book the Bayline internet install now (about three weeks out), reserve the Fir Court service elevator with Tina (7 days' notice) and get Bluebird's certificate of insurance naming Fir Court Condominiums HOA, and get the $35 truck parking permit for Hazel St (5 business days ahead). Then the electric transfer, USPS forwarding from January 8 and address changes (bank, payroll, car insurance, DMV within 30 days, renter's insurance), finishing the packing (kitchen, bathroom, closets) and getting boxes, and the move-out items for the $1,950 deposit (patch holes, clean, walkthrough with Dan Whitlock, return 2 keys and the fob, give a forwarding address), plus emptying storage unit #14 and returning the Bayline modem. A good answer orders or groups these by when they have to happen and mentions the roughly $1,080 balance due to the movers on moving day.",
  "rl-lease-dog":
    "Yes, with conditions: Section 12 (Pets), on page 2 of the lease for 418 Alder Street, Unit 2, lets the tenant keep one dog under 40 pounds with the landlord's written consent and a $500 pet deposit; no other animals are allowed except fish in a tank under 20 gallons. A good answer quotes or closely paraphrases the clause and says where it is, and says the next step is getting written consent from Halvorsen Property Group before bringing a dog home; it may add that the tenant pays for pet damage and must leash a dog in common areas. A short prose answer is best.",
  "rl-report-summary":
    "Larkspur Outdoor Supply's Q3 2026 Operations Review (15 pages) reports a solid quarter: revenue $8.42M, up 6.0% from Q2's $7.94M, on 61,300 orders (up 5.5%), online at 71% of revenue, and returns down to 7.8%, but on-time delivery slipped to 94.1% (92.9% in September) and fulfillment cost per order rose 8% to $10.15; Q4 is forecast at $11.9M. The most important item is missing from the executive summary: on page 12, Summit Freight, which carries 71% of parcels, will raise 2027 rates 18% (about $776,000 a year) and ends its peak capacity commitment on December 15, 2026, and the backup agreement with Coastal Parcel is unsigned and needed by December 4, with up to 9,000 December orders at risk of shipping late. A good summary for a boss leads with the gist, gives a few key numbers, surfaces that risk with its page, may mention the warehouse system losing vendor support on June 30, 2027 (page 13), and is short enough to forward.",
  "rl-standing-desks":
    "The honest answer is modestly at best: sit-stand desks reliably cut sitting time, and some trials report less low back, neck, or shoulder discomfort, but the studies are small, short, and of low to moderate quality, and standing for long stretches has its own problems. Changing position often and moving matters more than standing itself. A good answer leads with that verdict and how strong the evidence is, ties its findings to named sources with links, gives practical advice (alternate every 30 to 60 minutes, set the desk and screen heights right), and does not overclaim.",
  "rl-invoices":
    "Eight invoices from Casey Morgan Design total $16,225: 1041 Maple Street Studio $2,400 (paid Aug 2), 1042 Riverbend Coffee Roasters $1,150 (paid Aug 25), 1043 Oakline Builders $3,800 (unpaid, due Sep 4), 1044 Bright Path Tutoring $650 (paid Sep 10), 1045 Maple Street Studio $1,800 ($900 paid Oct 1, $900 still due since Oct 2), 1046 Harborview Dental $2,250 (unpaid, due Oct 16), 1047 Riverbend Coffee Roasters $975 (paid Nov 4), and 1048 Fernwood Community Health $3,200 (unpaid, due Dec 3, 2026). $10,150 is outstanding across four clients: Oakline Builders $3,800, Harborview Dental $2,250, and Maple Street Studio $900 are past due ($6,950 together), and Fernwood's $3,200 is not due until December 3. A good answer gives all eight with number, client, date, amount, and status, then who owes what and the total; saving the table as a spreadsheet is a plus.",
  "rl-landlord-email":
    "The answer is an email ready to send: a clear subject line, and a short, polite, firm body saying the heater has not worked since Monday, asking for a repair soon and when someone can come, and offering access. It should not invent the landlord's name, the address, or legal threats; placeholders for names and the unit are fine. Any text around the email should be a line or less, and the email itself should be easy to copy.",
  "rl-tighten":
    "The paragraph should come back whole at roughly half its length (about 60 to 90 words), in the writer's voice, keeping every fact: interest in the Marketing Coordinator role, four years in marketing at a small nonprofit, growing Instagram from about 2,000 to over 9,500 followers, planning the annual gala that raised a record $48,000, being detail-oriented, and liking teamwork. It should cut the filler ('I am writing to you today in order to', 'basically', 'actually', 'really, truly', 'the fact that') and add no new claims. A brief note on what changed is optional; the tightened text is the answer.",
  "rl-sheets-formula":
    '=SUMIF(A:A, "Paid", B:B) adds column B wherever column A says Paid (=SUMIF(A2:A, "Paid", B2:B) skips a header row). A good answer gives the formula ready to paste, says to put it in a cell outside columns A and B so it does not count itself, and at most notes that the match ignores case but not stray spaces, or that SUMIFS handles more conditions. The formula plus a sentence or two is the best answer.',
  "rl-ibuprofen":
    "Occasional, short-term ibuprofen is often fine with lisinopril, but NSAIDs like ibuprofen can raise blood pressure, weaken lisinopril's effect, and strain the kidneys, especially with dehydration, kidney disease, or a diuretic as well, so regular or high-dose use should be cleared with a doctor or pharmacist. Acetaminophen (Tylenol) is usually the safer pain reliever alongside lisinopril. A good answer gives that answer first, attaches each caution to the claim it qualifies, and suggests asking a pharmacist, without generic disclaimer padding.",
  "rl-contract":
    "The Design Services Agreement with Brightwave Media LLC (5 pages, $9,000 fixed fee) has two terms that are bad for Casey: Section 5 (Revisions, page 2) requires revisions 'in any number' until the client's final approval at no extra charge, and payment and ownership are lopsided, since Section 4 (page 1) invoices only on final acceptance, gives the client 90 days to pay, and asks no deposit, while Section 6 (page 2) assigns all rights in all work product, including unused concepts, 'upon execution of this Agreement', before any payment. A good review quotes those clauses with their sections, explains the risk (unbounded work, the client owning everything before paying, a long wait for money), and proposes concrete edits: a fixed number of revision rounds then an hourly rate (the contract's own $95 works), a deposit with net 15 or 30 terms, and ownership passing on full payment. It should say the rest (termination with pay for work done, portfolio use, mutual indemnity, the liability cap) is fairly standard, and suggest asking for the changes before signing.",
  "rl-coffee":
    "Three real cafes within a short walk of Union Square in San Francisco that suit working (seating, Wi-Fi, outlets, a tolerance for laptops), each with its address or cross streets, rough walking distance, hours, and a one-line reason, with sources. The places must exist, be open rather than permanently closed, and actually be near Union Square; laptop policies and hours should come from current sources, not memory. A good answer flags anything uncertain, such as weekend laptop limits.",
  "rl-health-plans":
    "Brightline's three 2027 family plans: Saver HAS (high-deductible, $1,144 a year in premiums, $1,000 company HAS deposit, $6,000 family deductible, $12,000 out-of-pocket maximum, 20% after the deductible), Choice PPO ($4,940 a year, $2,000 deductible that skips office visits and drugs, $8,000 maximum, $50 specialist, $45 preferred brand drugs), and Care HMO ($3,588 a year, $500 deductible on hospital care only, $6,000 maximum, $40 specialist with a referral, $35 preferred brand, nothing covered out of network). Riley's pulmonologist, Dr. Priya Anand, is in network only on the Choice PPO. With quarterly specialist visits, a brand controller inhaler every month (about $320 at full price), rescue inhalers, and urgent care or ER visits, the HAS plan is the weakest fit (they would pay most of the $6,000 deductible), the HMO is cheapest overall by roughly $1,500 to $1,700 a year but means switching to Dr. Ellison or Dr. Benitez, and the PPO costs more but keeps Dr. Anand. A good answer makes a pick (the PPO, since the notes say they want to keep Dr. Anand) with the HMO as runner-up and when it would win, shows a rough yearly cost for each, warns that doing nothing defaults them to the HMO, and says enrollment closes December 11, 2026.",
  "rl-algebra":
    "3(x - 4) = 2x + 5 gives x = 17: distribute to 3x - 12 = 2x + 5, subtract 2x to get x - 12 = 5, add 12. A good answer is a short numbered sequence of steps, each one line of math with a few words on what was done, written so a parent can say it aloud, and ends by checking the answer (3(13) = 39 and 2(17) + 5 = 39). Math reads as math, not as code.",
  "rl-escrow":
    "Each monthly mortgage payment includes an escrow portion, about a twelfth of the year's property tax and homeowners insurance, which the lender holds in an escrow account and pays those bills from when they come due. Once a year the lender reviews the account: a shortage raises the payment or asks for a lump sum, a surplus over about $50 comes back as a refund, and lenders may keep a cushion of up to two months. A good answer says where the money goes in a sentence or two, may show the flow (payment split into principal and interest, and escrow, then out to the tax office and the insurer) as a small diagram or a short list, gives one worked example, and stays short.",
  "rl-loan-payment":
    "About $1,621 a month in principal and interest, and about $333,700 in interest over the 30 years (roughly $583,700 paid in all). A good answer gives those two figures first, may note that taxes, insurance and any PMI come on top, and stays short.",
  "rl-email-tighten":
    "The email comes back shorter (roughly half), in Alex's voice, ready to send, keeping every fact: following up on last week's proposal, asking whether Jordan has looked at it, offering to answer questions or make changes, and that the pricing holds only until the end of the month. It cuts the filler and adds no new claims. Any text around it is a line or less.",
  "rl-reply-landlord":
    "A short, polite reply to Marcus confirming Thursday for the smoke detector inspection, saying the tenant is home only after noon so the visit should be between noon and 2 (or asking whether that works), ready to send. It does not repeat Marcus's message and adds no invented details.",
};
