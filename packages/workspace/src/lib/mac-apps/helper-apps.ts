import { z } from "zod";

import {
  defineTool,
  helperFlags,
  type MacAppDefinition,
  runHelper,
} from "./tool";

const DATE_WORDS =
  "today, tomorrow, yesterday, 2026-10-06, or 2026-10-06T14:30 in local time (a Z or an offset also works)";

const Limit = z
  .int()
  .positive()
  .optional()
  .meta({ description: "At most this many, the first ones." });

const Account = z.string().min(1).optional().meta({
  description:
    "The account the calendar or list is in, when two accounts share its name.",
});

const CalendarSchema = z.object({
  account: z.string(),
  name: z.string(),
  writable: z.boolean(),
});

const EventSchema = z.object({
  allDay: z.boolean(),
  calendar: z.string(),
  end: z.string().nullable(),
  location: z.string().nullable(),
  start: z.string().nullable(),
  title: z.string(),
});

const ReminderSchema = z.object({
  completed: z.boolean(),
  due: z.string().nullable(),
  list: z.string(),
  notes: z.string().nullable(),
  title: z.string(),
});

const LabeledSchema = z.object({ label: z.string(), value: z.string() });

const ContactSchema = z.object({
  birthday: z.string().nullable(),
  emails: z.array(LabeledSchema),
  jobTitle: z.string().nullable(),
  name: z.string(),
  nickname: z.string().nullable(),
  organization: z.string().nullable(),
  phones: z.array(LabeledSchema),
});

export const CALENDAR_APP: MacAppDefinition = {
  about:
    "Calendar on this Mac, with every calendar added to it, Google and Exchange ones included.",
  bundleId: "com.apple.iCal",
  name: "Calendar",
  server: "apple-calendar",
  through: "helper",
  tools: [
    defineTool({
      description:
        "Every calendar, with its account and whether it takes new events.",
      input: {},
      name: "list_calendars",
      output: { calendars: z.array(CalendarSchema) },
      readOnly: true,
      run: async (_input, context) => ({
        structured: {
          calendars: await runHelper(
            context,
            ["calendars"],
            z.array(CalendarSchema),
          ),
        },
      }),
    }),
    defineTool({
      description: `Events between two days, earliest first: today's when no days are given, and one day's with only from. A date is ${DATE_WORDS}.`,
      input: {
        account: Account,
        calendar: z
          .string()
          .min(1)
          .optional()
          .meta({ description: "Only this calendar's events." }),
        from: z.string().min(1).optional(),
        limit: Limit,
        search: z.string().min(1).optional().meta({
          description:
            "Only events whose title, location or notes holds every word.",
        }),
        to: z
          .string()
          .min(1)
          .optional()
          .meta({ description: "The last day, included." }),
      },
      name: "list_events",
      output: { events: z.array(EventSchema) },
      readOnly: true,
      run: async (input, context) => ({
        structured: {
          events: await runHelper(
            context,
            ["events", ...helperFlags(input)],
            z.array(EventSchema),
          ),
        },
      }),
    }),
    defineTool({
      description: `Add an event. It lasts an hour unless end says otherwise, and goes in the default calendar unless calendar names another. A date is ${DATE_WORDS}.`,
      input: {
        account: Account,
        calendar: z.string().min(1).optional(),
        end: z.string().min(1).optional(),
        location: z.string().min(1).optional(),
        notes: z.string().min(1).optional(),
        start: z.string().min(1),
        title: z.string().min(1),
      },
      name: "add_event",
      output: {
        event: z.object({
          calendar: z.string(),
          start: z.string().nullable(),
          title: z.string(),
        }),
      },
      readOnly: false,
      run: async (input, context) => {
        const added = await runHelper(
          context,
          ["add-event", ...helperFlags(input)],
          z.object({
            added: z.string(),
            calendar: z.string(),
            start: z.string().nullable(),
          }),
        );
        return {
          structured: {
            event: {
              calendar: added.calendar,
              start: added.start,
              title: added.added,
            },
          },
          text: `Added "${added.added}" to ${added.calendar} at ${added.start ?? input.start}.`,
        };
      },
    }),
  ],
};

export const REMINDERS_APP: MacAppDefinition = {
  about:
    "Reminders on this Mac, with every list synced to it, iCloud's included.",
  bundleId: "com.apple.reminders",
  name: "Reminders",
  server: "apple-reminders",
  through: "helper",
  tools: [
    defineTool({
      description:
        "Every reminder list, with its account and whether it takes new reminders.",
      input: {},
      name: "list_lists",
      output: { lists: z.array(CalendarSchema) },
      readOnly: true,
      run: async (_input, context) => ({
        structured: {
          lists: await runHelper(context, ["lists"], z.array(CalendarSchema)),
        },
      }),
    }),
    defineTool({
      description: `Reminders not yet done, or every one with all. A date is ${DATE_WORDS}.`,
      input: {
        account: Account,
        all: z
          .boolean()
          .optional()
          .meta({ description: "Completed ones too." }),
        due_after: z.string().min(1).optional(),
        due_before: z.string().min(1).optional(),
        limit: Limit,
        list: z
          .string()
          .min(1)
          .optional()
          .meta({ description: "Only this list's reminders." }),
        search: z.string().min(1).optional().meta({
          description: "Only reminders whose title or notes holds every word.",
        }),
      },
      name: "list_reminders",
      output: { reminders: z.array(ReminderSchema) },
      readOnly: true,
      run: async ({ due_after, due_before, ...rest }, context) => ({
        structured: {
          reminders: await runHelper(
            context,
            [
              "reminders",
              ...helperFlags({
                ...rest,
                "due-after": due_after,
                "due-before": due_before,
              }),
            ],
            z.array(ReminderSchema),
          ),
        },
      }),
    }),
    defineTool({
      description: `Add a reminder, to the default list unless list names another. A date is ${DATE_WORDS}.`,
      input: {
        account: Account,
        due: z.string().min(1).optional(),
        list: z.string().min(1).optional(),
        notes: z.string().min(1).optional(),
        title: z.string().min(1),
      },
      name: "add_reminder",
      output: {
        reminder: z.object({ list: z.string(), title: z.string() }),
      },
      readOnly: false,
      run: async (input, context) => {
        const added = await runHelper(
          context,
          ["add-reminder", ...helperFlags(input)],
          z.object({ added: z.string(), list: z.string() }),
        );
        return {
          structured: { reminder: { list: added.list, title: added.added } },
          text: `Added "${added.added}" to ${added.list}${input.due ? `, due ${input.due}` : ""}.`,
        };
      },
    }),
  ],
};

export const CONTACTS_APP: MacAppDefinition = {
  about: "Contacts on this Mac, with every account added to it.",
  bundleId: "com.apple.AddressBook",
  name: "Contacts",
  server: "apple-contacts",
  through: "helper",
  tools: [
    defineTool({
      description:
        "People whose name, nickname, company, title, email or phone holds every word of search, with their emails, phones and birthday; everyone without search.",
      input: { limit: Limit, search: z.string().min(1).optional() },
      name: "search_contacts",
      output: { contacts: z.array(ContactSchema) },
      readOnly: true,
      run: async (input, context) => ({
        structured: {
          contacts: await runHelper(
            context,
            ["contacts", ...helperFlags(input)],
            z.array(ContactSchema),
          ),
        },
      }),
    }),
  ],
};
