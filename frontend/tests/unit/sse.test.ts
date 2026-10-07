import { describe, expect, it } from 'vitest'
import { createSseParser, type SseEvent } from '@/lib/sse'

function collect() {
  const events: SseEvent[] = []
  return { events, feed: createSseParser((event) => events.push(event)) }
}

describe('createSseParser', () => {
  it('parses a complete frame', () => {
    const { events, feed } = collect()
    feed('event: delta\ndata: {"text":"hi"}\n\n')
    expect(events).toEqual([{ event: 'delta', data: '{"text":"hi"}' }])
  })

  it('holds a frame split across chunks until it ends', () => {
    const { events, feed } = collect()
    feed('event: del')
    feed('ta\ndata: {"te')
    expect(events).toEqual([])
    feed('xt":"hi"}\n')
    expect(events).toEqual([])
    feed('\nevent: message.complete\ndata: {}\n\n')
    expect(events).toEqual([
      { event: 'delta', data: '{"text":"hi"}' },
      { event: 'message.complete', data: '{}' }
    ])
  })

  it('tolerates CRLF, even when the pair is split between chunks', () => {
    const { events, feed } = collect()
    feed('event: delta\r\ndata: a\r')
    feed('\n\r\n')
    expect(events).toEqual([{ event: 'delta', data: 'a' }])
  })

  it('ignores comment lines and comment-only frames (heartbeats)', () => {
    const { events, feed } = collect()
    feed(': ping\n\n')
    feed(': keep-alive\nevent: delta\ndata: x\n\n')
    expect(events).toEqual([{ event: 'delta', data: 'x' }])
  })

  it('joins multiple data lines with a newline', () => {
    const { events, feed } = collect()
    feed('event: delta\ndata: one\ndata: two\n\n')
    expect(events).toEqual([{ event: 'delta', data: 'one\ntwo' }])
  })

  it('does not emit an unterminated trailing frame', () => {
    const { events, feed } = collect()
    feed('event: delta\ndata: x')
    expect(events).toEqual([])
  })
})
