import type { Response } from 'express'

export type EventStream = {
  /** Writes one `event:` frame with `data` as JSON. */
  event(name: string, data: unknown): void
  /** Writes one comment frame (`: text`), which clients ignore. */
  comment(text: string): void
  /** Stops the heartbeat and ends the response. Safe to call more than once. */
  close(): void
}

export type EventStreamOptions = {
  /** Interval of the `: ping` comment that keeps proxies from closing an idle stream. */
  heartbeatMs: number
  /** The client went away before the response finished, or was already gone when it opened. */
  onClientGone: () => void
}

/**
 * Turns `res` into a Server-Sent Events stream: status 200 and the SSE headers, flushed at once,
 * then a heartbeat. Frames are dropped once the response ended or was destroyed, so writing never
 * throws after the headers are out. The caller must `close()` the stream on every path. If opening
 * throws, the response is already ended and no heartbeat runs.
 */
export function openEventStream(
  res: Response,
  { heartbeatMs, onClientGone }: EventStreamOptions
): EventStream {
  const isAlive = () => !res.writableEnded && !res.destroyed
  const write = (frame: string) => {
    if (isAlive()) res.write(frame)
  }
  const comment = (text: string) => write(`: ${text}\n\n`)

  try {
    res.status(200)
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    res.flushHeaders()
    // A close before the response finished means the client went away.
    res.on('close', () => {
      if (!res.writableFinished) onClientGone()
    })
    // The client may already be gone (say, during the caller's database work).
    if (res.destroyed || res.socket?.destroyed) onClientGone()
  } catch (err) {
    // Never leave a half-opened response hanging; the caller still owns the error.
    if (!res.writableEnded) res.end()
    throw err
  }

  const heartbeat = setInterval(() => comment('ping'), heartbeatMs)
  let isClosed = false
  return {
    event: (name, data) => write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`),
    comment,
    close() {
      if (isClosed) return
      isClosed = true
      clearInterval(heartbeat)
      if (!res.writableEnded) res.end()
    }
  }
}
