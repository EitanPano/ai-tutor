import { EventEmitter } from 'node:events'
import type { Response } from 'express'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openEventStream } from '../../src/lib/sse.js'

const HEARTBEAT_MS = 1000

/** The slice of an Express response the stream touches; `end` and `destroy` emit `close` like Node. */
class FakeResponse extends EventEmitter {
  statusCode = 0
  headers: Record<string, string> = {}
  isFlushed = false
  frames: string[] = []
  endCount = 0
  writableEnded = false
  writableFinished = false
  destroyed = false
  socket: { destroyed: boolean } | null = { destroyed: false }

  status(code: number) {
    this.statusCode = code
    return this
  }

  set(fields: Record<string, string>) {
    Object.assign(this.headers, fields)
    return this
  }

  flushHeaders() {
    this.isFlushed = true
  }

  write(frame: string) {
    this.frames.push(frame)
    return true
  }

  end() {
    this.endCount += 1
    this.writableEnded = true
    this.writableFinished = true
    this.emit('close')
    return this
  }

  /** The client went away mid-response. */
  destroy() {
    this.destroyed = true
    if (this.socket) this.socket.destroyed = true
    this.emit('close')
  }
}

function open(res: FakeResponse, onClientGone = vi.fn()) {
  const stream = openEventStream(res as unknown as Response, {
    heartbeatMs: HEARTBEAT_MS,
    onClientGone
  })
  return { stream, onClientGone }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('openEventStream', () => {
  it('sets status 200 and the SSE headers, then flushes them', () => {
    const res = new FakeResponse()
    open(res)
    expect(res.statusCode).toBe(200)
    expect(res.headers).toEqual({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    expect(res.isFlushed).toBe(true)
    expect(res.frames).toEqual([])
  })

  it('writes a ping comment every heartbeat interval', () => {
    const res = new FakeResponse()
    open(res)
    vi.advanceTimersByTime(HEARTBEAT_MS - 1)
    expect(res.frames).toEqual([])
    vi.advanceTimersByTime(1)
    expect(res.frames).toEqual([': ping\n\n'])
    vi.advanceTimersByTime(HEARTBEAT_MS)
    expect(res.frames).toEqual([': ping\n\n', ': ping\n\n'])
  })

  it('frames an event as `event:` plus JSON `data:`, and a comment as `:`', () => {
    const res = new FakeResponse()
    const { stream } = open(res)
    stream.event('delta', { text: 'hi "there"' })
    stream.comment('note')
    expect(res.frames).toEqual(['event: delta\ndata: {"text":"hi \\"there\\""}\n\n', ': note\n\n'])
  })

  it('drops every write once the response ended', () => {
    const res = new FakeResponse()
    const { stream } = open(res)
    res.end()
    stream.event('delta', { text: 'late' })
    stream.comment('late')
    vi.advanceTimersByTime(HEARTBEAT_MS)
    expect(res.frames).toEqual([])
  })

  it('drops every write once the response was destroyed', () => {
    const res = new FakeResponse()
    const { stream } = open(res)
    res.destroy()
    stream.event('delta', { text: 'late' })
    stream.comment('late')
    vi.advanceTimersByTime(HEARTBEAT_MS)
    expect(res.frames).toEqual([])
  })

  it('reports the client gone when the response closes before it finished', () => {
    const res = new FakeResponse()
    const { onClientGone } = open(res)
    expect(onClientGone).not.toHaveBeenCalled()
    res.destroy()
    expect(onClientGone).toHaveBeenCalledOnce()
  })

  it('reports the client gone at once when the response is already destroyed', () => {
    const res = new FakeResponse()
    res.destroyed = true
    const { onClientGone } = open(res)
    expect(onClientGone).toHaveBeenCalledOnce()
  })

  it('reports the client gone at once when the socket is already destroyed', () => {
    const res = new FakeResponse()
    res.socket = { destroyed: true }
    const { onClientGone } = open(res)
    expect(onClientGone).toHaveBeenCalledOnce()
  })

  it('does not report the client gone on the close that follows a normal finish', () => {
    const res = new FakeResponse()
    const { stream, onClientGone } = open(res)
    stream.close()
    expect(onClientGone).not.toHaveBeenCalled()
  })

  it('closes once: clears the heartbeat and ends the response a single time', () => {
    const res = new FakeResponse()
    const { stream } = open(res)
    expect(vi.getTimerCount()).toBe(1)
    stream.close()
    stream.close()
    expect(res.endCount).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not end a response that already ended', () => {
    const res = new FakeResponse()
    const { stream } = open(res)
    res.end()
    stream.close()
    expect(res.endCount).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ends the response and starts no heartbeat when opening throws', () => {
    const res = new FakeResponse()
    res.flushHeaders = () => {
      throw new Error('flush failed')
    }
    expect(() => open(res)).toThrow('flush failed')
    expect(res.endCount).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
