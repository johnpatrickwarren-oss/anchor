/**
 * csv-lite — dependency-free RFC 4180 subset CSV parser and stringifier.
 * Pure functions, no I/O, no options.
 */

/**
 * Parse a CSV string into a 2-D array of strings.
 *
 * - Records are separated by `\n` or `\r\n`.
 * - Fields are separated by commas.
 * - A field wrapped in `"…"` may contain commas, newlines, and escaped
 *   double-quotes written as `""`.
 * - A trailing newline does NOT produce an extra empty record.
 * - Empty input returns `[]`.
 */
export function parse(text: string): string[][] {
  if (text === '') return [];

  const rows: string[][] = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    const row: string[] = [];

    // Parse one record: loop until end-of-input or end-of-line.
    recordLoop: while (true) {
      if (i < n && text[i] === '"') {
        // ── Quoted field ──────────────────────────────────────────────────
        i++; // skip opening quote
        let field = '';
        while (i < n) {
          if (text[i] === '"') {
            if (i + 1 < n && text[i + 1] === '"') {
              // Escaped double-quote: "" → "
              field += '"';
              i += 2;
            } else {
              // Closing quote
              i++;
              break;
            }
          } else {
            field += text[i++];
          }
        }
        row.push(field);
      } else {
        // ── Unquoted field ────────────────────────────────────────────────
        const start = i;
        while (i < n && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
          i++;
        }
        row.push(text.slice(start, i));
      }

      // Decide what follows the field we just finished.
      if (i >= n) {
        // End of input — record ends here.
        break recordLoop;
      } else if (text[i] === ',') {
        i++; // comma: more fields in this record
      } else {
        // Newline (\r\n or \n) — end of record.
        if (text[i] === '\r' && i + 1 < n && text[i + 1] === '\n') {
          i += 2;
        } else {
          i++; // \n or lone \r
        }
        break recordLoop;
      }
    }

    rows.push(row);
  }

  return rows;
}

/**
 * Serialize a 2-D array of strings to CSV text.
 *
 * - Records are joined with `\n`.
 * - A field is quoted iff it contains a comma, a double-quote, or a newline;
 *   double-quotes inside a quoted field are escaped as `""`.
 * - `stringify([])` returns `""`.
 */
export function stringify(rows: string[][]): string {
  if (rows.length === 0) return '';

  return rows
    .map((row) =>
      row
        .map((field) => {
          if (
            field.includes(',') ||
            field.includes('"') ||
            field.includes('\n') ||
            field.includes('\r')
          ) {
            return '"' + field.replace(/"/g, '""') + '"';
          }
          return field;
        })
        .join(',')
    )
    .join('\n');
}
