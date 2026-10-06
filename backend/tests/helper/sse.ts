export type SseEvent = { event: string; data: unknown }

/** Parses an SSE body into its events. Comment lines (`: ping`) are skipped. */
export function parseSse(text: string): SseEvent[] {
  const events: SseEvent[] = []
  for (const frame of text.split(/\r?\n\r?\n/)) {
    let event = 'message'
    const data: string[] = []
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).trim())
    }
    if (data.length > 0) events.push({ event, data: JSON.parse(data.join('\n')) })
  }
  return events
}
