import type { Field } from '@/lib/types'

/**
 * One line of the case file: the value, then `asOf · source · confidence` beneath it.
 * Confidence is visual weight, never a number.
 *
 * When the field carries no evidence the row reads `No evidence found` and lists the sources
 * that were checked. Conflicts render inline beside the winning value.
 */
export function FieldRow<T>(props: {
  label: string
  field: Field<T>
  format: (value: T) => string
}) {
  throw new Error('not implemented')
}
