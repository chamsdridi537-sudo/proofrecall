/**
 * A small, dependency-free CSV reader (Day 4).
 *
 * Deliberately hand-written: the whole product has to stay under a $10/month
 * budget and a single-file parser is a few dozen lines, while an npm
 * dependency would be another thing to audit and update. It is strict enough
 * to be trustworthy with real exports:
 *
 *   - `"quoted, fields"` keep their commas
 *   - `""` inside quotes is a literal quote
 *   - newlines inside quotes are part of the value (how testimonials get pasted
 *     out of emails)
 *   - CRLF and lone CR line endings, and a leading UTF-8 BOM, both from Excel
 *   - `,` `;` and tab delimiters are detected from the first line, because a
 *     European export is semicolon-separated and a Mac Numbers one is tabbed
 *
 * Ragged rows are padded to the widest row so a mapping never reads `undefined`.
 */

export const MAX_CSV_BYTES = 1_000_000;
export const MAX_CSV_ROWS = 500;

/** Strip the BOM Excel writes, and normalise every line ending to "\n". */
export function normaliseNewlines(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

export const CSV_DELIMITERS = [",", ";", "\t", "|"] as const;
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

/**
 * Pick the delimiter by counting unquoted candidates on the first line and
 * taking the most frequent one. Counting only outside quotes is what stops a
 * comma inside `"Kowalski, Marta"` from winning.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const firstLine = normaliseNewlines(text).split("\n")[0] ?? "";

  let best: CsvDelimiter = ",";
  let bestCount = 0;

  for (const candidate of CSV_DELIMITERS) {
    let count = 0;
    let insideQuotes = false;

    for (let i = 0; i < firstLine.length; i += 1) {
      const char = firstLine[i];
      if (char === '"') insideQuotes = !insideQuotes;
      else if (char === candidate && !insideQuotes) count += 1;
    }

    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }

  return best;
}

/**
 * Parse into a rectangular matrix. `onRecord` receives each finished row, so a
 * caller can stop early instead of holding a huge file in memory.
 */
export function parseCsv(
  text: string,
  options: { delimiter?: CsvDelimiter; maxRows?: number } = {},
): { rows: string[][]; delimiter: CsvDelimiter; truncated: boolean } {
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const maxRows = options.maxRows ?? MAX_CSV_ROWS;
  const source = normaliseNewlines(text);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let insideQuotes = false;
  let fieldWasQuoted = false;
  let truncated = false;

  const endField = () => {
    row.push(fieldWasQuoted ? field : field.trim());
    field = "";
    fieldWasQuoted = false;
  };

  const endRow = () => {
    endField();
    const isBlankLine =
      row.length === 1 && row[0] !== undefined && row[0].length === 0;
    if (!isBlankLine) {
      if (rows.length >= maxRows) {
        truncated = true;
        return;
      }
      rows.push(row);
    }
    row = [];
  };

  for (let i = 0; i < source.length; i += 1) {
    if (truncated) break;

    const char = source[i];

    if (insideQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          insideQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === "") {
      insideQuotes = true;
      fieldWasQuoted = true;
      continue;
    }

    if (char === delimiter) {
      endField();
      continue;
    }

    if (char === "\n") {
      endRow();
      continue;
    }

    field += char;
  }

  if (!truncated && (field !== "" || row.length > 0)) endRow();

  // Unterminated quote at EOF (a truncated upload) still yields the row.
  const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
  const rectangular = rows.map((r) =>
    r.length === width
      ? r
      : [...r, ...Array<string>(width - r.length).fill("")],
  );

  return { rows: rectangular, delimiter, truncated };
}

/** Does this file look like a header row rather than data? */
export function looksLikeHeader(cells: string[]): boolean {
  const names = ["quote", "testimonial", "text", "author", "name", "company"];
  const lowered = cells.map((cell) => cell.trim().toLowerCase());
  return names.some((name) => lowered.includes(name));
}
