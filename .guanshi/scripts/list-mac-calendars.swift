import EventKit
import Foundation

struct CalendarItem: Codable {
  let calendarId: String
  let calendarName: String
  let sourceName: String
  let group: String
  let isDefault: Bool
}

struct CalendarListPayload: Codable {
  let generatedAt: String
  let calendars: [CalendarItem]
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

func normalizeText(_ value: String?) -> String {
  return (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
}

func main() throws {
  let store = EKEventStore()
  guard requestCalendarAccess(store: store) else {
    fputs("Calendar access denied. Please grant permission in System Settings > Privacy & Security > Calendars.\n", stderr)
    exit(2)
  }

  let defaultCalendarId = normalizeText(store.defaultCalendarForNewEvents?.calendarIdentifier)
  let writableCalendars = store.calendars(for: .event).filter { $0.allowsContentModifications }

  let mapped = writableCalendars.map { calendar -> CalendarItem in
    let calendarId = normalizeText(calendar.calendarIdentifier)
    let calendarName = normalizeText(calendar.title)
    let sourceName = normalizeText(calendar.source.title)
    let group = sourceName.isEmpty ? calendarName : "\(sourceName)/\(calendarName)"
    return CalendarItem(
      calendarId: calendarId,
      calendarName: calendarName,
      sourceName: sourceName,
      group: group,
      isDefault: !defaultCalendarId.isEmpty && calendarId == defaultCalendarId
    )
  }

  let sorted = mapped.sorted { lhs, rhs in
    if lhs.isDefault != rhs.isDefault {
      return lhs.isDefault && !rhs.isDefault
    }
    if lhs.sourceName != rhs.sourceName {
      return lhs.sourceName.localizedCaseInsensitiveCompare(rhs.sourceName) == .orderedAscending
    }
    return lhs.calendarName.localizedCaseInsensitiveCompare(rhs.calendarName) == .orderedAscending
  }

  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  let payload = CalendarListPayload(
    generatedAt: formatter.string(from: Date()),
    calendars: sorted
  )

  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys]
  let data = try encoder.encode(payload)
  guard let json = String(data: data, encoding: .utf8) else {
    throw NSError(domain: "CalendarList", code: 1, userInfo: [NSLocalizedDescriptionKey: "Failed to encode payload"])
  }
  print(json)
}

do {
  try main()
} catch {
  fputs("List calendars failed: \(error.localizedDescription)\n", stderr)
  exit(4)
}
