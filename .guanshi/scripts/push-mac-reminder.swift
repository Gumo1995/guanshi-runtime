import EventKit
import Foundation

struct Config {
  var title: String = ""
  var dueDate: String = ""
  var dueTime: String = ""
  var note: String = ""
  var sourceId: String = ""
  var reminderId: String = ""
  var alarmAt: String = ""
  var repeatMode: String = "once"
  var calendarId: String = ""
  var calendarName: String = ""
}

struct PushReminderResult: Codable {
  let ok: Bool
  let reminderId: String
  let title: String
  let list: String
  let repeatMode: String
  let dueAt: String
  let alarmAt: String
}

func printUsage() {
  let usage = """
  Usage:
    swift scripts/push-mac-reminder.swift --title <text> --due-date <yyyy-MM-dd> --due-time <HH:mm>
      [--note <text>] [--source-id <id>] [--reminder-id <id>] [--alarm-at <iso>] [--repeat <none|once|daily|weekly|monthly>] [--calendar-id <id>] [--calendar <name>]

  Example:
    swift scripts/push-mac-reminder.swift --title "跟进客户邮件" --due-date 2026-02-28 --due-time 10:30 --alarm-at 2026-02-28T10:25:00+08:00
  """
  print(usage)
}

func parseArgs(_ args: [String]) -> Config? {
  var config = Config()
  var index = 0

  while index < args.count {
    let arg = args[index]

    func nextValue() -> String? {
      guard index + 1 < args.count else { return nil }
      return args[index + 1]
    }

    switch arg {
    case "--title":
      guard let value = nextValue() else { return nil }
      config.title = value
      index += 2
    case "--due-date":
      guard let value = nextValue() else { return nil }
      config.dueDate = value
      index += 2
    case "--due-time":
      guard let value = nextValue() else { return nil }
      config.dueTime = value
      index += 2
    case "--note":
      guard let value = nextValue() else { return nil }
      config.note = value
      index += 2
    case "--source-id":
      guard let value = nextValue() else { return nil }
      config.sourceId = value
      index += 2
    case "--reminder-id":
      guard let value = nextValue() else { return nil }
      config.reminderId = value
      index += 2
    case "--alarm-at":
      guard let value = nextValue() else { return nil }
      config.alarmAt = value
      index += 2
    case "--repeat":
      guard let value = nextValue() else { return nil }
      config.repeatMode = value
      index += 2
    case "--calendar-id":
      guard let value = nextValue() else { return nil }
      config.calendarId = value
      index += 2
    case "--calendar":
      guard let value = nextValue() else { return nil }
      config.calendarName = value
      index += 2
    case "--help", "-h":
      printUsage()
      exit(0)
    default:
      return nil
    }
  }

  if config.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
    return nil
  }
  if !isValidDate(config.dueDate) || !isValidClock(config.dueTime) {
    return nil
  }
  return config
}

func normalizeRepeatMode(_ value: String) -> String {
  let text = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  if text.isEmpty || text == "none" || text == "off" { return "none" }
  if text == "once" || text == "single" { return "once" }
  if text == "daily" || text == "weekly" || text == "monthly" { return text }
  return "once"
}

func buildRecurrenceRules(_ repeatMode: String) -> [EKRecurrenceRule]? {
  switch normalizeRepeatMode(repeatMode) {
  case "daily":
    return [EKRecurrenceRule(recurrenceWith: .daily, interval: 1, end: nil)]
  case "weekly":
    return [EKRecurrenceRule(recurrenceWith: .weekly, interval: 1, end: nil)]
  case "monthly":
    return [EKRecurrenceRule(recurrenceWith: .monthly, interval: 1, end: nil)]
  default:
    return nil
  }
}

func isValidDate(_ value: String) -> Bool {
  let regex = try! NSRegularExpression(pattern: #"^\d{4}-\d{2}-\d{2}$"#)
  let range = NSRange(location: 0, length: value.utf16.count)
  return regex.firstMatch(in: value, options: [], range: range) != nil
}

func isValidClock(_ value: String) -> Bool {
  let regex = try! NSRegularExpression(pattern: #"^\d{2}:\d{2}$"#)
  let range = NSRange(location: 0, length: value.utf16.count)
  guard regex.firstMatch(in: value, options: [], range: range) != nil else {
    return false
  }
  let parts = value.split(separator: ":").map { Int($0) ?? -1 }
  guard parts.count == 2 else { return false }
  return parts[0] >= 0 && parts[0] <= 23 && parts[1] >= 0 && parts[1] <= 59
}

func requestReminderAccess(store: EKEventStore) -> Bool {
  let semaphore = DispatchSemaphore(value: 0)
  var granted = false

  if #available(macOS 14.0, *) {
    store.requestFullAccessToReminders { access, _ in
      granted = access
      semaphore.signal()
    }
  } else {
    store.requestAccess(to: .reminder) { access, _ in
      granted = access
      semaphore.signal()
    }
  }

  semaphore.wait()
  return granted
}

func resolveTargetReminderList(store: EKEventStore, preferredId: String, preferredName: String) -> EKCalendar? {
  let writable = store.calendars(for: .reminder).filter { $0.allowsContentModifications }

  if !preferredId.isEmpty {
    if let exactById = writable.first(where: { $0.calendarIdentifier.trimmingCharacters(in: .whitespacesAndNewlines) == preferredId }) {
      return exactById
    }
  }

  if !preferredName.isEmpty {
    if let exact = writable.first(where: { $0.title == preferredName }) {
      return exact
    }
    let lower = preferredName.lowercased()
    if let fuzzy = writable.first(where: { $0.title.lowercased() == lower }) {
      return fuzzy
    }
  }

  return writable.first
}

func buildDueDate(_ dateText: String, _ timeText: String) -> Date? {
  let formatter = DateFormatter()
  formatter.locale = Locale(identifier: "en_US_POSIX")
  formatter.timeZone = TimeZone.current
  formatter.dateFormat = "yyyy-MM-dd HH:mm"
  return formatter.date(from: "\(dateText) \(timeText)")
}

func parseAlarmDate(_ value: String) -> Date? {
  let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
  if text.isEmpty { return nil }

  let iso = ISO8601DateFormatter()
  iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  if let parsed = iso.date(from: text) {
    return parsed
  }
  iso.formatOptions = [.withInternetDateTime]
  if let parsed = iso.date(from: text) {
    return parsed
  }

  let formatter = DateFormatter()
  formatter.locale = Locale(identifier: "en_US_POSIX")
  formatter.timeZone = TimeZone.current
  formatter.dateFormat = "yyyy-MM-dd'T'HH:mm"
  if let parsed = formatter.date(from: text) {
    return parsed
  }
  formatter.dateFormat = "yyyy-MM-dd HH:mm"
  if let parsed = formatter.date(from: text) {
    return parsed
  }
  return nil
}

func buildTimeQualityURL(sourceId: String) -> URL? {
  let trimmed = sourceId.trimmingCharacters(in: .whitespacesAndNewlines)
  if trimmed.isEmpty { return nil }

  var components = URLComponents()
  components.scheme = "timequality"
  components.host = "todo"
  components.queryItems = [
    URLQueryItem(name: "v", value: "1"),
    URLQueryItem(name: "taskId", value: trimmed),
    URLQueryItem(name: "module", value: "reminder")
  ]
  return components.url
}

func main() throws {
  guard let config = parseArgs(Array(CommandLine.arguments.dropFirst())) else {
    printUsage()
    exit(1)
  }

  let store = EKEventStore()
  guard requestReminderAccess(store: store) else {
    fputs("Reminder access denied. Please grant permission in System Settings > Privacy & Security > Reminders.\n", stderr)
    exit(2)
  }

  guard let dueDate = buildDueDate(config.dueDate, config.dueTime) else {
    fputs("Invalid due date/time.\n", stderr)
    exit(3)
  }

  guard let targetList = resolveTargetReminderList(
    store: store,
    preferredId: config.calendarId.trimmingCharacters(in: .whitespacesAndNewlines),
    preferredName: config.calendarName.trimmingCharacters(in: .whitespacesAndNewlines)
  ) else {
    fputs("No writable reminder list found.\n", stderr)
    exit(4)
  }

  let reminder: EKReminder
  if !config.reminderId.isEmpty,
    let existing = store.calendarItem(withIdentifier: config.reminderId) as? EKReminder,
    existing.calendar.allowsContentModifications
  {
    reminder = existing
    if !config.calendarId.isEmpty || !config.calendarName.isEmpty {
      reminder.calendar = targetList
    }
  } else {
    reminder = EKReminder(eventStore: store)
    reminder.calendar = targetList
  }

  reminder.title = config.title.trimmingCharacters(in: .whitespacesAndNewlines)
  reminder.notes = config.note.trimmingCharacters(in: .whitespacesAndNewlines)
  reminder.url = buildTimeQualityURL(sourceId: config.sourceId)
  reminder.completionDate = nil
  let repeatMode = normalizeRepeatMode(config.repeatMode)

  var dueComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: dueDate)
  dueComponents.timeZone = TimeZone.current
  reminder.dueDateComponents = dueComponents

  if let alarmDate = parseAlarmDate(config.alarmAt) {
    reminder.alarms = [EKAlarm(absoluteDate: alarmDate)]
  } else {
    reminder.alarms = []
  }
  reminder.recurrenceRules = buildRecurrenceRules(repeatMode)

  try store.save(reminder, commit: true)

  let iso = ISO8601DateFormatter()
  iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

  let payload = PushReminderResult(
    ok: true,
    reminderId: reminder.calendarItemIdentifier,
    title: reminder.title ?? config.title,
    list: reminder.calendar.title,
    repeatMode: repeatMode,
    dueAt: iso.string(from: dueDate),
    alarmAt: reminder.alarms?.first?.absoluteDate.map { iso.string(from: $0) } ?? ""
  )

  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys]
  let data = try encoder.encode(payload)
  if let text = String(data: data, encoding: .utf8) {
    print(text)
  } else {
    print("{\"ok\":true}")
  }
}

do {
  try main()
} catch {
  fputs("Push reminder failed: \(error.localizedDescription)\n", stderr)
  exit(5)
}
