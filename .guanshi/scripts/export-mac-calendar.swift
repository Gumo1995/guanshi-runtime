import EventKit
import Foundation

struct ExportEvent: Codable {
  let externalId: String
  let calendarId: String
  let calendarName: String
  let sourceName: String
  let title: String
  let group: String
  let note: String
  let url: String
  let modifiedAt: String?
  let date: String
  let startTime: String
  let endTime: String
  let start: String
  let end: String
}

struct ExportPayload: Codable {
  let generatedAt: String
  let source: String
  let daysBack: Int
  let daysForward: Int
  let events: [ExportEvent]
}

struct Config {
  var outputPath: String = "calendar_sync.json"
  var daysBack: Int = 30
  var daysForward: Int = 60
  var includeAllDay: Bool = true
}

func printUsage() {
  let usage = """
  Usage:
    swift scripts/export-mac-calendar.swift [--output <path>] [--days-back <n>] [--days-forward <n>] [--exclude-all-day]

  Examples:
    swift scripts/export-mac-calendar.swift
    swift scripts/export-mac-calendar.swift --output calendar_sync.json --days-back 60 --days-forward 120
  """
  print(usage)
}

func parseArgs(_ args: [String]) -> Config? {
  var config = Config()
  var index = 0

  while index < args.count {
    let arg = args[index]
    switch arg {
    case "--output":
      guard index + 1 < args.count else { return nil }
      config.outputPath = args[index + 1]
      index += 2
    case "--days-back":
      guard index + 1 < args.count, let value = Int(args[index + 1]), value >= 0 else {
        return nil
      }
      config.daysBack = value
      index += 2
    case "--days-forward":
      guard index + 1 < args.count, let value = Int(args[index + 1]), value >= 0 else {
        return nil
      }
      config.daysForward = value
      index += 2
    case "--exclude-all-day":
      config.includeAllDay = false
      index += 1
    case "--help", "-h":
      printUsage()
      exit(0)
    default:
      return nil
    }
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

func resolveOutputURL(path: String) -> URL {
  let url = URL(fileURLWithPath: path)
  if url.path.hasPrefix("/") {
    return url
  }

  return URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    .appendingPathComponent(path)
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

  let now = Date()
  let calendar = Calendar.current
  guard
    let startDate = calendar.date(byAdding: .day, value: -config.daysBack, to: now),
    let endDate = calendar.date(byAdding: .day, value: config.daysForward, to: now)
  else {
    fputs("Failed to build date range.\n", stderr)
    exit(3)
  }

  let predicate = store.predicateForEvents(withStart: startDate, end: endDate, calendars: nil)
  let events = store.events(matching: predicate).sorted { lhs, rhs in
    lhs.startDate < rhs.startDate
  }

  let dateFormatter = DateFormatter()
  dateFormatter.dateFormat = "yyyy-MM-dd"

  let timeFormatter = DateFormatter()
  timeFormatter.dateFormat = "HH:mm"

  let isoFormatter = ISO8601DateFormatter()
  isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

  let exportedEvents: [ExportEvent] = events.compactMap { event in
    if !config.includeAllDay && event.isAllDay {
      return nil
    }

    guard event.endDate > event.startDate else {
      return nil
    }

    let calendarName = event.calendar.title
    let groupName = event.calendar.source.title
    let combinedGroup = "\(groupName)/\(calendarName)"

    return ExportEvent(
      externalId: event.calendarItemIdentifier,
      calendarId: event.calendar.calendarIdentifier,
      calendarName: calendarName,
      sourceName: groupName,
      title: (event.title ?? "Untitled").trimmingCharacters(in: .whitespacesAndNewlines),
      group: combinedGroup,
      note: (event.notes ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
      url: (event.url?.absoluteString ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
      modifiedAt: event.lastModifiedDate.map { isoFormatter.string(from: $0) },
      date: dateFormatter.string(from: event.startDate),
      startTime: timeFormatter.string(from: event.startDate),
      endTime: timeFormatter.string(from: event.endDate),
      start: isoFormatter.string(from: event.startDate),
      end: isoFormatter.string(from: event.endDate)
    )
  }

  let payload = ExportPayload(
    generatedAt: isoFormatter.string(from: now),
    source: "mac-calendar-eventkit",
    daysBack: config.daysBack,
    daysForward: config.daysForward,
    events: exportedEvents
  )

  let encoder = JSONEncoder()
  encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
  let data = try encoder.encode(payload)

  let outputURL = resolveOutputURL(path: config.outputPath)
  try FileManager.default.createDirectory(
    at: outputURL.deletingLastPathComponent(),
    withIntermediateDirectories: true,
    attributes: nil
  )
  try data.write(to: outputURL, options: .atomic)

  print("Exported \(exportedEvents.count) events")
  print("Output: \(outputURL.path)")
}

do {
  try main()
} catch {
  fputs("Export failed: \(error.localizedDescription)\n", stderr)
  exit(4)
}
