import { describe, expect, it } from 'vitest'
import { ipLimitKey } from '../../src/lib/rate-limit.js'

describe('ipLimitKey', () => {
  it('counts an IPv4 address on its own', () => {
    expect(ipLimitKey('203.0.113.7')).toBe('203.0.113.7')
    expect(ipLimitKey('203.0.113.7')).not.toBe(ipLimitKey('203.0.113.8'))
  })

  it('counts an IPv4-mapped IPv6 address as the IPv4 address', () => {
    expect(ipLimitKey('::ffff:203.0.113.7')).toBe(ipLimitKey('203.0.113.7'))
    expect(ipLimitKey('::FFFF:203.0.113.7')).toBe(ipLimitKey('203.0.113.7'))
  })

  it('shares one key between IPv6 addresses in the same /64', () => {
    const a = ipLimitKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')
    expect(ipLimitKey('2001:db8:1:2::1')).toBe(a)
    expect(ipLimitKey('2001:0DB8:0001:0002:0:0:0:ffff')).toBe(a)
  })

  it('separates IPv6 addresses in different /64s', () => {
    expect(ipLimitKey('2001:db8:1:2::1')).not.toBe(ipLimitKey('2001:db8:1:3::1'))
    expect(ipLimitKey('2001:db8:1:2::1')).not.toBe(ipLimitKey('2001:db8:2:2::1'))
  })

  it('expands :: at the start, middle and end', () => {
    expect(ipLimitKey('::1')).toBe(ipLimitKey('0:0:0:0:0:0:0:2'))
    expect(ipLimitKey('2001:db8::')).toBe(ipLimitKey('2001:db8:0:0::5'))
    expect(ipLimitKey('1::8')).toBe(ipLimitKey('1:0:0:0:5:6:7:8'))
  })

  it('ignores an IPv6 zone id and falls back to the raw value for non-addresses', () => {
    expect(ipLimitKey('fe80::1%eth0')).toBe(ipLimitKey('fe80::2'))
    expect(ipLimitKey('unknown')).toBe('unknown')
  })
})
