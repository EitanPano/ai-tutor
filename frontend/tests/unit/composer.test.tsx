import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Composer, MAX_QUESTION } from '@/component/thread/composer'

function Harness({
  onSubmit,
  initial = '',
  ...rest
}: {
  onSubmit: () => void
  initial?: string
  isStreaming?: boolean
  onStop?: () => void
}) {
  const [value, setValue] = useState(initial)
  return <Composer value={value} onChange={setValue} onSubmit={onSubmit} {...rest} />
}

describe('Composer', () => {
  it('sends on Ctrl+Enter and on Cmd+Enter', async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    const typist = userEvent.setup()

    await typist.type(screen.getByLabelText('Your question'), 'why{Control>}{Enter}{/Control}')
    expect(onSubmit).toHaveBeenCalledTimes(1)

    await typist.type(screen.getByLabelText('Your question'), '{Meta>}{Enter}{/Meta}')
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })

  it('does not send a plain Enter or an empty question', async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    const typist = userEvent.setup()
    const box = screen.getByLabelText('Your question')

    await typist.type(box, '{Control>}{Enter}{/Control}')
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled()
    await typist.type(box, 'hello{Enter}')

    expect(onSubmit).not.toHaveBeenCalled()
    expect(box).toHaveValue('hello\n')
  })

  it('shows a counter past 18,000 characters and blocks sending past 20,000', () => {
    const onSubmit = vi.fn()
    const { rerender } = render(<Composer value="a" onChange={() => {}} onSubmit={onSubmit} />)
    expect(screen.queryByText(/ \/ 20,000/)).not.toBeInTheDocument()

    rerender(<Composer value={'a'.repeat(18_500)} onChange={() => {}} onSubmit={onSubmit} />)
    expect(screen.getByText('18,500 / 20,000')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask' })).toBeEnabled()

    rerender(
      <Composer value={'a'.repeat(MAX_QUESTION + 1)} onChange={() => {}} onSubmit={onSubmit} />
    )
    expect(screen.getByText(/20,001 \/ 20,000/)).toBeInTheDocument()
    expect(screen.getByLabelText('Your question')).toBeInvalid()
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled()
  })

  it('swaps Ask for Stop while streaming and ignores Ctrl+Enter', async () => {
    const onSubmit = vi.fn()
    const onStop = vi.fn()
    render(<Harness onSubmit={onSubmit} onStop={onStop} isStreaming initial="next" />)
    const typist = userEvent.setup()

    expect(screen.queryByRole('button', { name: 'Ask' })).not.toBeInTheDocument()
    await typist.type(screen.getByLabelText('Your question'), '{Control>}{Enter}{/Control}')
    await typist.click(screen.getByRole('button', { name: 'Stop' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('shows the reminder about secrets', () => {
    render(<Harness onSubmit={() => {}} />)
    expect(
      screen.getByText("Answers can be wrong. Don't paste secrets or personal data.")
    ).toBeInTheDocument()
  })
})
