import EventKit
import Foundation

struct Config {
  var reminderId: String = ""
  var sourceId: String = ""
  var completedAt: String = ""
  var action: String = "complete"
}

struct CompleteReminderResult: Codable {
  let ok: Bool
  let reminderId: String
  let action: String
  let completed: Bool
  let disabled: Bool
  let notFound: Bool
  let list: String?
  let completedAt: String
}

func printUsage() {
  let usage = """
  Usage:
    swift scripts/complete-mac-reminder.swift [--reminder-id <id>] [--source-id <taskId>] [--action <complete|disable>] [--completed-at <iso>]

  Example:
    swift scripts/complete-mac-reminder.swift --reminder-id ABCDEF123
    swift scripts/complete-mac-reminder.swift --source-id todo_123 --action complete
  """
  print(usage)
}

func normalizeAction(_ value: String) -> String {
  let text = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  if text == "disable" { return "disable" }
  return "complete"
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
    case "--reminder-id":
      guard let value = nextValue() else { return nil }
      config.reminderId = value
      index += 2
    case "--completed-at":
      guard let value = nextValue() else { return nil }
      config.completedAt = value
      index += 2
    case "--source-id":
      guard let value = nextValue() else { return nil }
      config.sourceId = value
      index += 2
    case "--action":
      guard let value = nextValue() else { return nil }
      config.action = normalizeAction(value)
      index += 2
    case "--help", "-h":
      printUsage()
      exit(0)
    default:
      return nil
    }
  }

  if config.reminderId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    && config.sourceId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  {
    return nil
  }
  return config
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

func parseCompletedDate(_ value: String) -> Date {
  let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
  if text.isEmpty { return Date() }

  let iso = ISO8601DateFormatter()
  iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  if let parsed = iso.date(from: text) { return parsed }
  iso.formatOptions = [.withInternetDateTime]
  if let parsed = iso.date(from: text) { return parsed }
  return Date()
}

func extractTaskIdFromReminderURL(_ url: URL?) -> String {
  guard let url = url else { return "" }
  guard url.scheme?.lowercased() == "timequality" else { return "" }
  guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return "" }
  for item in components.queryItems ?? [] {
    if item.name == "taskId" {
      return (item.value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }
  }
  return ""
}

func fetchAllReminders(store: EKEventStore) -> [EKReminder] {
  let calendars = store.calendars(for: .reminder)
  let predicate = store.predicateForReminders(in: calendars)
  let semaphore = DispatchSemaphore(value: 0)
  var results: [EKReminder] = []
  store.fetchReminders(matching: predicate) { items in
    results = items ?? []
    semaphore.signal()
  }
  semaphore.wait()
  return results
}

func reminderDueDate(_ reminder: EKReminder) -> Date? {
  guard let components = reminder.dueDateComponents else { return nil }
  var normalized = components
  if normalized.timeZone == nil {
    normalized.timeZone = TimeZone.current
  }
  return Calendar.current.date(from: normalized)
}

func pickReminderBySourceId(_ sourceId: String, from reminders: [EKReminder]) -> EKReminder? {
  let now = Date()
  let candidates = reminders.filter { item in
    if extractTaskIdFromReminderURL(item.url) != sourceId { return false }
    if !item.calendar.allowsContentModifications { return false }
    if item.completionDate != nil { return false }
    return true
  }
  if candidates.isEmpty { return nil }
  let overdue = candidates.filter { item in
    guard let due = reminderDueDate(item) else { return false }
    return due <= now
  }
  if !overdue.isEmpty {
    return overdue.max { lhs, rhs in
      let leftDate = reminderDueDate(lhs) ?? Date.distantPast
      let rightDate = reminderDueDate(rhs) ?? Date.distantPast
      if leftDate != rightDate { return leftDate < rightDate }
      return lhs.calendarItemIdentifier < rhs.calendarItemIdentifier
    }
  }

  let upcoming = candidates.filter { item in
    guard let due = reminderDueDate(item) else { return false }
    return due > now
  }
  if !upcoming.isEmpty {
    return upcoming.min { lhs, rhs in
      let leftDate = reminderDueDate(lhs) ?? Date.distantFuture
      let rightDate = reminderDueDate(rhs) ?? Date.distantFuture
      if leftDate != rightDate { return leftDate < rightDate }
      return lhs.calendarItemIdentifier < rhs.calendarItemIdentifier
    }
  }

  return candidates.sorted { lhs, rhs in
    return lhs.calendarItemIdentifier < rhs.calendarItemIdentifier
  }.first
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

  let reminderId = config.reminderId.trimmingCharacters(in: .whitespacesAndNewlines)
  let sourceId = config.sourceId.trimmingCharacters(in: .whitespacesAndNewlines)
  let action = normalizeAction(config.action)
  let reminderById = store.calendarItem(withIdentifier: reminderId) as? EKReminder

  let iso = ISO8601DateFormatter()
  iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  let payload: CompleteReminderResult
  if action == "disable" {
    var removedAny = false
    var listName: String? = nil
    var candidates: [EKReminder] = []
    if let reminder = reminderById {
      candidates.append(reminder)
    }
    if !sourceId.isEmpty {
      let all = fetchAllReminders(store: store)
      for item in all {
        if extractTaskIdFromReminderURL(item.url) == sourceId {
          candidates.append(item)
        }
      }
    }

    var seen = Set<String>()
    for item in candidates {
      let identifier = item.calendarItemIdentifier
      if seen.contains(identifier) { continue }
      seen.insert(identifier)
      if !item.calendar.allowsContentModifications { continue }
      listName = listName ?? item.calendar.title
      do {
        try store.remove(item, commit: true)
        removedAny = true
      } catch {
        // continue removing others
      }
    }

    payload = CompleteReminderResult(
      ok: true,
      reminderId: reminderId,
      action: action,
      completed: false,
      disabled: removedAny,
      notFound: !removedAny,
      list: listName,
      completedAt: ""
    )
  } else {
    var targetReminder: EKReminder? = reminderById
    let shouldFallbackBySource = !sourceId.isEmpty && (
      targetReminder == nil
      || !(targetReminder?.calendar.allowsContentModifications ?? false)
      || targetReminder?.completionDate != nil
    )
    if shouldFallbackBySource {
      let all = fetchAllReminders(store: store)
      if let fallback = pickReminderBySourceId(sourceId, from: all) {
        targetReminder = fallback
      }
    }

    guard let reminder = targetReminder else {
      let notFoundPayload = CompleteReminderResult(
        ok: true,
        reminderId: reminderId,
        action: action,
        completed: false,
        disabled: false,
        notFound: true,
        list: nil,
        completedAt: ""
      )
      let data = try JSONEncoder().encode(notFoundPayload)
      if let text = String(data: data, encoding: .utf8) {
        print(text)
      }
      return
    }
    guard reminder.calendar.allowsContentModifications else {
      fputs("Target reminder list is read-only.\n", stderr)
      exit(3)
    }
    let completedDate = parseCompletedDate(config.completedAt)
    reminder.completionDate = completedDate
    try store.save(reminder, commit: true)
    payload = CompleteReminderResult(
      ok: true,
      reminderId: reminder.calendarItemIdentifier,
      action: action,
      completed: true,
      disabled: false,
      notFound: false,
      list: reminder.calendar.title,
      completedAt: iso.string(from: completedDate)
    )
  }

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
  fputs("Complete reminder failed: \(error.localizedDescription)\n", stderr)
  exit(4)
}
