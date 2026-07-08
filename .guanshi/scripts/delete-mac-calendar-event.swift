import EventKit
import Foundation

struct Config {
  var eventId: String = ""
}

struct DeleteResult: Codable {
  let ok: Bool
  let eventId: String
  let deleted: Bool
  let notFound: Bool
  let calendar: String?
  let title: String?
}

func printUsage() {
  let usage = """
  Usage:
    swift scripts/delete-mac-calendar-event.swift --event-id <id>
  """
  print(usage)
}

func parseArgs(_ args: [String]) -> Config? {
  var config = Config()
  var index = 0

  while index < args.count {
    let arg = args[index]
    switch arg {
    case "--event-id":
      guard index + 1 < args.count else { return nil }
      config.eventId = args[index + 1].trimmingCharacters(in: .whitespacesAndNewlines)
      index += 2
    case "--help", "-h":
      printUsage()
      exit(0)
    default:
      return nil
    }
  }

  if config.eventId.isEmpty {
    return nil
  }

  return config
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

func printResult(_ result: DeleteResult) throws {
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys]
  let data = try encoder.encode(result)
  if let text = String(data: data, encoding: .utf8) {
    print(text)
  } else {
    print("{\"ok\":true}")
  }
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

  guard let event = store.event(withIdentifier: config.eventId) else {
    try printResult(
      DeleteResult(
        ok: true,
        eventId: config.eventId,
        deleted: false,
        notFound: true,
        calendar: nil,
        title: nil
      )
    )
    return
  }

  guard event.calendar.allowsContentModifications else {
    fputs("Target event calendar is read-only.\n", stderr)
    exit(3)
  }

  let title = (event.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  let calendarName = event.calendar.title
  try store.remove(event, span: .thisEvent, commit: true)

  try printResult(
    DeleteResult(
      ok: true,
      eventId: config.eventId,
      deleted: true,
      notFound: false,
      calendar: calendarName,
      title: title
    )
  )
}

do {
  try main()
} catch {
  fputs("Delete failed: \(error.localizedDescription)\n", stderr)
  exit(5)
}
