import { titleCase } from './titleCase.ts';
import { truncate } from './truncate.ts';

/**
 * Title-cases the string and then truncates it to at most n characters,
 * appending a single "…" (U+2026) if the title-cased string exceeded n.
 *
 * @param s - the input string
 * @param n - maximum character length of the output (before the ellipsis counts)
 * @returns the title-cased, possibly-truncated string
 */
export function headline(s: string, n: number): string {
  return truncate(titleCase(s), n);
}
