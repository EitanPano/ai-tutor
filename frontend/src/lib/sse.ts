export type SseEvent = { event: string; data: string }

/**
 * Incremental Server-Sent Events parser. Feed it decoded text chunks as they arrive; it calls
 * `onEvent` once per complete frame. Frames end at a blank line, `:` lines are comments
 * (heartbeats) and are ignored, and a frame split across chunks is held until it completes.
 */
export function createSseParser(onEvent: (event: SseEvent) => void) {
  let buffer = ''

  function dispatch(frame: string) {
    let event = 'message'
    const data: string[] = []
    let hasField = false
    for (const line of frame.split('\n')) {
      if (line === '' || line.startsWith(':')) continue
      const colon = line.indexOf(':')
      const field = colon === -1 ? line : line.slice(0, colon)
      let value = colon === -1 ? '' : line.slice(colon + 1)
      if (value.startsWith(' ')) value = value.slice(1)
      if (field === 'event') {
        event = value
        hasField = true
      } else if (field === 'data') {
        data.push(value)
        hasField = true
      }
    }
    if (hasField) onEvent({ event, data: data.join('\n') })
  }

  return (chunk: string) => {
    // A "\r" at the end of one chunk may pair with a "\n" at the start of the next, so the
    // normalising runs on the whole buffer rather than on each chunk.
    buffer = (buffer + chunk).replace(/\r\n/g, '\n')
    let end = buffer.indexOf('\n\n')
    while (end !== -1) {
      dispatch(buffer.slice(0, end))
      buffer = buffer.slice(end + 2)
      end = buffer.indexOf('\n\n')
    }
  }
}
