/** Joins class names with single spaces, dropping falsy ones: `cn('a', isOn && 'b', className)`. */
export const cn = (...classNames: Array<string | false | null | undefined>) =>
  classNames.filter(Boolean).join(' ')
