import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CHOICE_STYLE, choiceState, type ChoiceState } from '@/component/quiz/choice-style'

describe('choiceState', () => {
  it.each<[string, number, number, number, ChoiceState]>([
    ['the right answer, picked', 1, 1, 1, 'answer'],
    ['the right answer, not picked', 1, 1, 2, 'answer'],
    ['a wrong pick', 2, 1, 2, 'wrongPick'],
    ['a choice nobody picked', 0, 1, 2, 'other']
  ])('reads %s', (_name, index, answerIndex, choiceIndex, state) => {
    expect(choiceState(index, { answerIndex, choiceIndex })).toBe(state)
  })
})

describe('CHOICE_STYLE', () => {
  it.each<[ChoiceState, string, string[]]>([
    ['answer', 'border-correct', ['marker']],
    ['wrongPick', 'border-wrong', ['text-wrong', 'line-through']]
  ])('frames %s with %s and marks its text with %j', (state, frame, textClasses) => {
    expect(CHOICE_STYLE[state].frame).toBe(frame)
    expect(CHOICE_STYLE[state].text.split(' ')).toEqual(expect.arrayContaining(textClasses))
  })

  it('leaves a choice nobody picked in a plain frame and plain text', () => {
    expect(CHOICE_STYLE.other.frame).toBe('border-rule')
    expect(CHOICE_STYLE.other.text).toBe('')
  })

  it.each<[ChoiceState, string]>([
    ['answer', 'text-correct'],
    ['wrongPick', 'text-wrong'],
    ['other', 'bg-rule']
  ])('gives %s a decorative mark coloured %s', (state, colour) => {
    const { container } = render(<>{CHOICE_STYLE[state].mark}</>)
    const mark = container.firstElementChild!
    expect(mark).toHaveAttribute('aria-hidden', 'true')
    expect(mark).toHaveClass(colour)
  })

  it('draws a different mark for each state', () => {
    const html = (['answer', 'wrongPick', 'other'] as const).map(
      (state) => render(<>{CHOICE_STYLE[state].mark}</>).container.innerHTML
    )
    expect(new Set(html).size).toBe(3)
  })
})
