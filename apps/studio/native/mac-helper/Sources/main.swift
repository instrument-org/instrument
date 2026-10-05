import Contacts
import EventKit
import Foundation

// Calendar, Reminders, and Contacts through Apple's own frameworks. Every
// answer is one line of JSON on stdout; a failure is a sentence on stderr
// and a non-zero exit.
//
//   instrument-mac contacts [--search <words>] [--limit <n>]
//   instrument-mac calendars
//   instrument-mac events [--from <date>] [--to <date>] [--calendar <name>] [--search <words>] [--limit <n>]
//   instrument-mac reminders [--list <name>] [--due-before <date>] [--due-after <date>] [--all] [--search <words>] [--limit <n>]
//   instrument-mac add-event --title <t> --start <date> [--end <date>] [--calendar <name>] [--location <l>] [--notes <n>]
//   instrument-mac add-reminder --title <t> [--list <name>] [--due <date>] [--notes <n>]
//
// A date is today, tomorrow, yesterday, 2026-10-06, or 2026-10-06T14:30
// (local time), with an optional Z or offset. A calendar or list is named
// by its title; when two accounts share one, --account says which.

struct Failure: Error {
  let message: String
  let code: Int32
}

let store = EKEventStore()
let contactStore = CNContactStore()

func fail(_ message: String, _ code: Int32 = 1) -> Never {
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(code)
}

func emit(_ value: Any) {
  guard
    let data = try? JSONSerialization.data(
      withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])
  else { fail("could not encode the answer") }
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
}

/// Asks once, the first time; after that answers from what the user chose.
func requireAccess(to entity: EKEntityType) async {
  let what = entity == .event ? "Calendars" : "Reminders"
  switch EKEventStore.authorizationStatus(for: entity) {
  case .fullAccess, .authorized:
    return
  case .denied, .restricted:
    fail(
      "Instrument is not allowed to use your \(what.lowercased()). The user can allow it under System Settings, Privacy & Security, \(what).",
      2)
  default:
    do {
      let granted =
        entity == .event
        ? try await store.requestFullAccessToEvents()
        : try await store.requestFullAccessToReminders()
      if !granted {
        fail(
          "The user declined access to their \(what.lowercased()). Only they can change it, under System Settings, Privacy & Security, \(what).",
          2)
      }
    } catch {
      fail("Could not ask for access to \(what.lowercased()): \(error.localizedDescription)")
    }
  }
}

/// Asks once, the first time; after that answers from what the user chose.
func requireContactsAccess() async {
  switch CNContactStore.authorizationStatus(for: .contacts) {
  case .authorized:
    return
  case .denied, .restricted:
    fail(
      "Instrument is not allowed to use your contacts. The user can allow it under System Settings, Privacy & Security, Contacts.",
      2)
  default:
    do {
      if !(try await contactStore.requestAccess(for: .contacts)) {
        fail(
          "The user declined access to their contacts. Only they can change it, under System Settings, Privacy & Security, Contacts.",
          2)
      }
    } catch {
      fail("Could not ask for access to contacts: \(error.localizedDescription)")
    }
  }
}

/// A labeled phone or email as a person reads it: "mobile", "work".
func labeled<T>(_ values: [CNLabeledValue<T>], _ text: (T) -> String) -> [[String: String]] {
  values.map { value in
    [
      "label": value.label.map { CNLabeledValue<T>.localizedString(forLabel: $0) } ?? "",
      "value": text(value.value),
    ]
  }
}

func parseDate(_ text: String, endOfDay: Bool = false) -> Date {
  let calendar = Calendar.current
  let today = calendar.startOfDay(for: Date())
  let named: [String: Int] = ["yesterday": -1, "today": 0, "tomorrow": 1]
  if let offset = named[text.lowercased()] {
    let day = calendar.date(byAdding: .day, value: offset, to: today)!
    return endOfDay ? calendar.date(byAdding: .day, value: 1, to: day)! : day
  }
  let dayOnly = DateFormatter()
  dayOnly.locale = Locale(identifier: "en_US_POSIX")
  dayOnly.dateFormat = "yyyy-MM-dd"
  if let day = dayOnly.date(from: text) {
    return endOfDay ? calendar.date(byAdding: .day, value: 1, to: day)! : day
  }
  let iso = ISO8601DateFormatter()
  iso.formatOptions = [.withInternetDateTime]
  if let date = iso.date(from: text) { return date }
  let local = DateFormatter()
  local.locale = Locale(identifier: "en_US_POSIX")
  for format in ["yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd HH:mm"] {
    local.dateFormat = format
    if let date = local.date(from: text) { return date }
  }
  fail(
    "\(text) is not a date this reads: today, tomorrow, yesterday, 2026-10-06, or 2026-10-06T14:30.")
}

func iso(_ date: Date?) -> Any {
  guard let date else { return NSNull() }
  let formatter = ISO8601DateFormatter()
  formatter.timeZone = TimeZone.current
  formatter.formatOptions = [.withInternetDateTime]
  return formatter.string(from: date)
}

/// `--name value` pairs and bare `--flag`s, after the command.
func options(_ args: ArraySlice<String>) -> [String: String] {
  var found: [String: String] = [:]
  var index = args.startIndex
  while index < args.endIndex {
    let arg = args[index]
    guard arg.hasPrefix("--") else { fail("\(arg) is not an option; each takes --name value.") }
    let name = String(arg.dropFirst(2))
    let next = args.index(after: index)
    if next < args.endIndex, !args[next].hasPrefix("--") {
      found[name] = args[next]
      index = args.index(after: next)
    } else {
      found[name] = ""
      index = next
    }
  }
  return found
}

func calendarNamed(
  _ name: String?, account: String?, for entity: EKEntityType, writing: Bool = false
) -> EKCalendar? {
  guard let name else { return nil }
  let all = store.calendars(for: entity)
  let kind = entity == .event ? "calendar" : "list"
  let named = all.filter {
    $0.title.caseInsensitiveCompare(name) == .orderedSame
      && (account == nil || $0.source.title.caseInsensitiveCompare(account!) == .orderedSame)
  }
  guard let match = named.first else {
    let names = all.map { "\($0.title) (\($0.source.title))" }.joined(separator: ", ")
    fail("There is no \(kind) named \(name)\(account.map { " in \($0)" } ?? ""). There are: \(names).")
  }
  if named.count > 1 {
    let accounts = named.map(\.source.title).joined(separator: ", ")
    fail("More than one \(kind) is named \(name), in \(accounts); say which with --account.")
  }
  // A subscribed or shared calendar takes no additions, and saving into one
  // fails with an error that does not say so.
  if writing && !match.allowsContentModifications {
    fail("The \(kind) \(name) (\(match.source.title)) is read-only; add to another.")
  }
  return match
}

/// Whether any of the texts holds every word of the search, case aside.
func matches(_ search: String?, _ texts: [String?]) -> Bool {
  guard let search, !search.isEmpty else { return true }
  let haystack = texts.compactMap { $0 }.joined(separator: " ").lowercased()
  return search.lowercased().split(separator: " ").allSatisfy { haystack.contains($0) }
}

func limited<T>(_ items: [T]) -> [T] {
  guard let raw = given["limit"] else { return items }
  guard let limit = Int(raw), limit > 0 else { fail("--limit takes a positive number.") }
  return Array(items.prefix(limit))
}

@MainActor func fetchReminders(_ predicate: NSPredicate) async -> [EKReminder] {
  await withCheckedContinuation { continuation in
    store.fetchReminders(matching: predicate) { continuation.resume(returning: $0 ?? []) }
  }
}

let args = CommandLine.arguments.dropFirst()
guard let command = args.first else {
  fail("Usage: instrument-mac calendars | events | reminders | add-event | add-reminder")
}
let given = options(args.dropFirst())

switch command {
case "calendars":
  await requireAccess(to: .event)
  await requireAccess(to: .reminder)
  let describe = { (calendar: EKCalendar, kind: String) -> [String: Any] in
    [
      "account": calendar.source.title, "kind": kind, "name": calendar.title,
      "writable": calendar.allowsContentModifications,
    ]
  }
  emit(
    store.calendars(for: .event).map { describe($0, "calendar") }
      + store.calendars(for: .reminder).map { describe($0, "list") })

case "events":
  await requireAccess(to: .event)
  let from = parseDate(given["from"] ?? "today")
  let to = parseDate(given["to"] ?? given["from"] ?? "today", endOfDay: true)
  // One query spans at most four years; past that EventKit quietly answers
  // with less.
  if to.timeIntervalSince(from) > 4 * 365 * 24 * 3600 {
    fail("A range of more than four years is more than one query answers; narrow --from and --to.")
  }
  let calendars = calendarNamed(given["calendar"], account: given["account"], for: .event).map {
    [$0]
  }
  let predicate = store.predicateForEvents(withStart: from, end: to, calendars: calendars)
  // The predicate takes both ends, so an event starting on the end itself,
  // at midnight, belongs to the next range and is left to it.
  let found = store.events(matching: predicate).filter {
    $0.startDate < to && matches(given["search"], [$0.title, $0.location, $0.notes])
  }
  emit(
    limited(found.sorted { $0.startDate < $1.startDate }).map { event in
      [
        "allDay": event.isAllDay, "calendar": event.calendar.title, "end": iso(event.endDate),
        "location": event.location ?? NSNull(), "start": iso(event.startDate),
        "title": event.title ?? "",
      ] as [String: Any]
    })

case "reminders":
  await requireAccess(to: .reminder)
  let lists = calendarNamed(given["list"], account: given["account"], for: .reminder).map {
    [$0]
  }
  let predicate =
    given["all"] != nil
    ? store.predicateForReminders(in: lists)
    : store.predicateForIncompleteReminders(
      withDueDateStarting: given["due-after"].map { parseDate($0) },
      ending: given["due-before"].map { parseDate($0, endOfDay: true) },
      calendars: lists)
  let found = await fetchReminders(predicate).filter {
    matches(given["search"], [$0.title, $0.notes])
  }
  emit(
    limited(found).map { reminder in
      [
        "completed": reminder.isCompleted,
        "due": iso(reminder.dueDateComponents.flatMap { Calendar.current.date(from: $0) }),
        "list": reminder.calendar.title, "notes": reminder.notes ?? NSNull(),
        "title": reminder.title ?? "",
      ] as [String: Any]
    })

case "add-event":
  await requireAccess(to: .event)
  guard let title = given["title"], let start = given["start"] else {
    fail("add-event needs --title and --start.")
  }
  let event = EKEvent(eventStore: store)
  event.title = title
  event.startDate = parseDate(start)
  event.endDate = given["end"].map { parseDate($0) } ?? event.startDate.addingTimeInterval(3600)
  guard
    let calendar = calendarNamed(
      given["calendar"], account: given["account"], for: .event, writing: true)
      ?? store.defaultCalendarForNewEvents
  else { fail("There is no calendar to add to; name one with --calendar.") }
  event.calendar = calendar
  event.location = given["location"]
  event.notes = given["notes"]
  do { try store.save(event, span: .thisEvent) } catch {
    fail("Could not add the event: \(error.localizedDescription)")
  }
  emit(["added": title, "calendar": event.calendar.title, "start": iso(event.startDate)])

case "add-reminder":
  await requireAccess(to: .reminder)
  guard let title = given["title"] else { fail("add-reminder needs --title.") }
  let reminder = EKReminder(eventStore: store)
  reminder.title = title
  guard
    let list = calendarNamed(
      given["list"], account: given["account"], for: .reminder, writing: true)
      ?? store.defaultCalendarForNewReminders()
  else { fail("There is no reminder list to add to; name one with --list.") }
  reminder.calendar = list
  if let due = given["due"] {
    reminder.dueDateComponents = Calendar.current.dateComponents(
      [.year, .month, .day, .hour, .minute], from: parseDate(due))
  }
  reminder.notes = given["notes"]
  do { try store.save(reminder, commit: true) } catch {
    fail("Could not add the reminder: \(error.localizedDescription)")
  }
  emit(["added": title, "list": reminder.calendar.title])

case "contacts":
  await requireContactsAccess()
  let keys: [CNKeyDescriptor] = [
    CNContactGivenNameKey, CNContactFamilyNameKey, CNContactNicknameKey,
    CNContactOrganizationNameKey, CNContactJobTitleKey, CNContactEmailAddressesKey,
    CNContactPhoneNumbersKey, CNContactBirthdayKey,
  ].map { $0 as CNKeyDescriptor }
  var found: [CNContact] = []
  do {
    try contactStore.enumerateContacts(with: CNContactFetchRequest(keysToFetch: keys)) {
      contact, _ in
      let texts: [String?] =
        [
          contact.givenName, contact.familyName, contact.nickname, contact.organizationName,
          contact.jobTitle,
        ] + contact.emailAddresses.map { String($0.value) }
        + contact.phoneNumbers.map { $0.value.stringValue }
      if matches(given["search"], texts) { found.append(contact) }
    }
  } catch {
    fail("Could not read contacts: \(error.localizedDescription)")
  }
  emit(
    limited(found).map { contact in
      let name = [contact.givenName, contact.familyName].filter { !$0.isEmpty }.joined(
        separator: " ")
      return [
        "birthday": contact.birthday.map { birthday -> String in
          birthday.year.map { String(format: "%04d-%02d-%02d", $0, birthday.month ?? 0, birthday.day ?? 0) }
            ?? String(format: "--%02d-%02d", birthday.month ?? 0, birthday.day ?? 0)
        } ?? NSNull(),
        "emails": labeled(contact.emailAddresses) { String($0) },
        "jobTitle": contact.jobTitle.isEmpty ? NSNull() : contact.jobTitle,
        "name": name.isEmpty ? contact.organizationName : name,
        "nickname": contact.nickname.isEmpty ? NSNull() : contact.nickname,
        "organization": contact.organizationName.isEmpty ? NSNull() : contact.organizationName,
        "phones": labeled(contact.phoneNumbers) { $0.stringValue },
      ] as [String: Any]
    })

default:
  fail(
    "\(command) is not a command: calendars, events, reminders, add-event, add-reminder, or contacts."
  )
}
