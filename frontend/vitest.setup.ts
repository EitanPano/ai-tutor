import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library only flags the environment as act-aware from a global
// `beforeAll`, and `globals` is off here, so it never does. Without the flag,
// React reports "not configured to support act(...)" whenever an act scope
// overlaps a waitFor or user-event call (which toggle it off while they wait).
// With it on, they restore it to true, and genuine un-acted updates are reported.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom has no layout, so it does not implement scrolling.
if (typeof window !== 'undefined') window.scrollTo = () => {}

afterEach(() => {
  cleanup()
})
