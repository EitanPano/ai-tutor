import type { ReactNode } from 'react'
import type { GradedItem } from '@/lib/api/quiz'
import { DoneIcon, WrongIcon } from '@/lib/icon'

/** A choice in a graded item: the right answer, the reader's wrong pick, or neither. */
export type ChoiceState = 'answer' | 'wrongPick' | 'other'

export function choiceState(
  index: number,
  { answerIndex, choiceIndex }: Pick<GradedItem, 'answerIndex' | 'choiceIndex'>
): ChoiceState {
  if (index === answerIndex) return 'answer'
  return index === choiceIndex ? 'wrongPick' : 'other'
}

type ChoiceStyle = {
  /** The border colour. */
  frame: string
  /** The mark in the gutter. Decoration: the labels under the choice say the same in words. */
  mark: ReactNode
  /** Classes for the choice text. */
  text: string
}

export const CHOICE_STYLE: Record<ChoiceState, ChoiceStyle> = {
  answer: {
    frame: 'border-correct',
    mark: <DoneIcon aria-hidden="true" className="size-4 text-correct" strokeWidth={3} />,
    text: 'marker rounded-sm px-1 [--tw-prose-body:var(--marker-ink)] [--tw-prose-code:var(--marker-ink)] [--tw-prose-bold:var(--marker-ink)]'
  },
  wrongPick: {
    frame: 'border-wrong',
    mark: <WrongIcon aria-hidden="true" className="size-4 text-wrong" strokeWidth={3} />,
    text: 'text-wrong line-through decoration-wrong decoration-2'
  },
  other: {
    frame: 'border-rule',
    mark: <span aria-hidden="true" className="size-2 rounded-full bg-rule" />,
    text: ''
  }
}
