import EventKit
import Foundation

struct Config {
  var title: String = ""
  var date: String = ""
  var start: String = ""
  var end: String = ""
  var note: String = ""
  var category: String = ""
  var quality: Int? = nil
  var happiness: Int? = nil
  var sourceId: String = ""
  var eventId: String = ""
  var calendarId: String = ""
  var calendarName: String = ""
}

struct PushResult: Codable {
  let ok: Bool
  let eventId: String
  let title: String
  let calendar: String
  let start: String
  let end: String
}

func printUsage() {
  let usage = """
  Usage:
    swift scripts/push-mac-calendar-event.swift --title <text> --date <yyyy-MM-dd> --start <HH:mm> --end <HH:mm>
      [--note <text>] [--category <text>] [--quality <1-10>] [--happiness <1-10>] [--source-id <id>] [--event-id <id>] [--calendar-id <id>] [--calendar <name>]

  Example:
    swift scripts/push-mac-calendar-event.swift --title "周复盘" --date 2026-02-16 --start 20:00 --end 21:00 --note "完成周复盘"
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
    case "--date":
      guard let value = nextValue() else { return nil }
      config.date = value
      index += 2
    case "--start":
      guard let value = nextValue() else { return nil }
      config.start = value
      index += 2
    case "--end":
      guard let value = nextValue() else { return nil }
      config.end = value
      index += 2
    case "--note":
      guard let value = nextValue() else { return nil }
      config.note = value
      index += 2
    case "--category":
      guard let value = nextValue() else { return nil }
      config.category = value
      index += 2
    case "--quality":
      guard let value = nextValue(), let parsed = Int(value), parsed >= 1, parsed <= 10 else {
        return nil
      }
      config.quality = parsed
      index += 2
    case "--happiness":
      guard let value = nextValue(), let parsed = Int(value), parsed >= 1, parsed <= 10 else {
        return nil
      }
      config.happiness = parsed
      index += 2
    case "--source-id":
      guard let value = nextValue() else { return nil }
      config.sourceId = value
      index += 2
    case "--event-id":
      guard let value = nextValue() else { return nil }
      config.eventId = value
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

  if !isValidDate(config.date) || !isValidClock(config.start) || !isValidClock(config.end) {
    return nil
  }

  return config
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

func requestCalendarAccess(store: EKEventStore) -> Bool {
  let semaphore = DispatchSemaphore(value: 0)
  var granted = false

  if #available(macOS 14.0, *) {
    store.requestFullAccessToEvents { access, _ in
      granted = access
      semaphore.signal()
    }
  } else {
    store.requestAccess(to: .event) { access, _ in
      granted = access
      semaphore.signal()
    }
  }

  semaphore.wait()
  return granted
}

func buildDateRange(date: String, start: String, end: String) -> (Date, Date)? {
  let formatter = DateFormatter()
  formatter.locale = Locale(identifier: "en_US_POSIX")
  formatter.timeZone = TimeZone.current
  formatter.dateFormat = "yyyy-MM-dd HH:mm"

  guard
    let startDate = formatter.date(from: "\(date) \(start)"),
    var endDate = formatter.date(from: "\(date) \(end)")
  else {
    return nil
  }

  if endDate <= startDate {
    endDate = Calendar.current.date(byAdding: .day, value: 1, to: endDate) ?? endDate
  }

  return (startDate, endDate)
}

func resolveTargetCalendar(store: EKEventStore, preferredId: String, preferredName: String) -> EKCalendar? {
  let writableCalendars = store.calendars(for: .event).filter { $0.allowsContentModifications }

  if !preferredId.isEmpty {
    if let exactById = writableCalendars.first(where: {
      $0.calendarIdentifier.trimmingCharacters(in: .whitespacesAndNewlines) == preferredId
    }) {
      return exactById
    }
  }

  if !preferredName.isEmpty {
    if let exact = writableCalendars.first(where: { $0.title == preferredName }) {
      return exact
    }

    let lower = preferredName.lowercased()
    if let fuzzy = writableCalendars.first(where: { $0.title.lowercased() == lower }) {
      return fuzzy
    }
  }

  if let `default` = store.defaultCalendarForNewEvents, `default`.allowsContentModifications {
    return `default`
  }

  return writableCalendars.first
}

func buildNotes(config: Config) -> String {
  let trimmedNote = config.note.trimmingCharacters(in: .whitespacesAndNewlines)
  return trimmedNote
}

func buildTimeQualityURL(config: Config) -> URL? {
  let sourceId = config.sourceId.trimmingCharacters(in: .whitespacesAndNewlines)
  if sourceId.isEmpty {
    return nil
  }

  var components = URLComponents()
  components.scheme = "timequality"
  components.host = "todo"

  var items: [URLQueryItem] = [
    URLQueryItem(name: "v", value: "1"),
    URLQueryItem(name: "taskId", value: sourceId),
  ]

  let category = config.category.trimmingCharacters(in: .whitespacesAndNewlines)
  if !category.isEmpty {
    items.append(URLQueryItem(name: "category", value: category))
  }

  if let quality = config.quality {
    items.append(URLQueryItem(name: "quality", value: String(quality)))
  }

  if let happiness = config.happiness {
    items.append(URLQueryItem(name: "happiness", value: String(happiness)))
  }

  components.queryItems = items
  return components.url
}

func main() throws {
  guard let config = parseArgs(Array(CommandLine.arguments.dropFirst())) else {
    printUsage()
    exit(1)
  }

  let store = EKEventStore()
  guard requestCalendarAccess(store: store) else {
    fputs("Calendar access denied. Please grant permission in System Settings > Privacy & Security > Calendars.\n", stderr)
    exit(2)
  }

  guard let (startDate, endDate) = buildDateRange(date: config.date, start: config.start, end: config.end) else {
    fputs("Invalid date/time combination.\n", stderr)
    exit(3)
  }

  guard let targetCalendar = resolveTargetCalendar(
    store: store,
    preferredId: config.calendarId.trimmingCharacters(in: .whitespacesAndNewlines),
    preferredName: config.calendarName.trimmingCharacters(in: .whitespacesAndNewlines)
  ) else {
    fputs("No writable calendar found.\n", stderr)
    exit(4)
  }

  let event: EKEvent
  if !config.eventId.isEmpty,
    let existing = store.event(withIdentifier: config.eventId),
    existing.calendar.allowsContentModifications
  {
    event = existing
    if !config.calendarName.isEmpty || !config.calendarId.isEmpty {
      event.calendar = targetCalendar
    }
  } else {
    event = EKEvent(eventStore: store)
    event.calendar = targetCalendar
  }

  event.title = config.title.trimmingCharacters(in: .whitespacesAndNewlines)
  event.startDate = startDate
  event.endDate = endDate
  event.notes = buildNotes(config: config)
  event.url = buildTimeQualityURL(config: config)

  try store.save(event, span: .thisEvent, commit: true)

  let isoFormatter = ISO8601DateFormatter()
  isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

  let payload = PushResult(
    ok: true,
    eventId: event.calendarItemIdentifier,
    title: event.title ?? config.title,
    calendar: event.calendar.title,
    start: isoFormatter.string(from: startDate),
    end: isoFormatter.string(from: endDate)
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
  fputs("Push failed: \(error.localizedDescription)\n", stderr)
  exit(5)
}
