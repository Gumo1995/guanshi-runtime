import EventKit
import Foundation

struct ReminderListItem: Codable {
  let calendarId: String
  let calendarName: String
  let sourceName: String
  let group: String
  let isDefault: Bool
}

struct ReminderListOutput: Codable {
  let generatedAt: String
  let calendars: [ReminderListItem]
}

func normalizeText(_ value: String?) -> String {
  return (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
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

func main() throws {
  let store = EKEventStore()
  guard requestReminderAccess(store: store) else {
    fputs("Reminder access denied. Please grant permission in System Settings > Privacy & Security > Reminders.\n", stderr)
    exit(2)
  }

  let writableLists = store.calendars(for: .reminder).filter { $0.allowsContentModifications }

  let mapped = writableLists.map { list -> ReminderListItem in
    let calendarId = normalizeText(list.calendarIdentifier)
    let calendarName = normalizeText(list.title)
    let sourceName = normalizeText(list.source.title)
    let group = sourceName.isEmpty ? calendarName : "\(sourceName)/\(calendarName)"
    return ReminderListItem(
      calendarId: calendarId,
      calendarName: calendarName,
      sourceName: sourceName,
      group: group,
      isDefault: false
    )
  }
    .sorted { lhs, rhs in
      if lhs.sourceName != rhs.sourceName {
        return lhs.sourceName.localizedCaseInsensitiveCompare(rhs.sourceName) == .orderedAscending
      }
      return lhs.calendarName.localizedCaseInsensitiveCompare(rhs.calendarName) == .orderedAscending
    }

  let payload = ReminderListOutput(
    generatedAt: ISO8601DateFormatter().string(from: Date()),
    calendars: mapped
  )

  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys]
  let data = try encoder.encode(payload)
  if let text = String(data: data, encoding: .utf8) {
    print(text)
  } else {
    throw NSError(domain: "ListReminderLists", code: 1)
  }
}

do {
  try main()
} catch {
  fputs("List reminder lists failed: \(error.localizedDescription)\n", stderr)
  exit(1)
}
