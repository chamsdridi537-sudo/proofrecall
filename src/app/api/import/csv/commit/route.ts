import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  analyseCsv,
  csvToItems,
  excerpt,
  normaliseQuote,
  sanitiseMapping,
  CsvTooLargeError,
  type CsvAnalysis,
  type CsvItemsResult,
  type Mapping,
  type RowProblem,
} from "@/lib/csv-import";
import { insertTestimonialBatch } from "@/lib/import-items";
import { readCsvUpload, uploadFailed } from "@/lib/upload";
import type { CsvCommitResponse } from "@/lib/types";

/**
 * POST /api/import/csv/commit — write a mapped CSV into the caller's library.
 *
 * The file is re-sent with the chosen mapping instead of being cached on the
 * server: stateless, nothing to expire, and the user still has the file open.
 *
 * Failure is reported per row, never as one red toast, because the common case
 * is "297 of 300 landed" and the useful answer is which three did not and why.
 * Two kinds of duplicate are distinguished on purpose:
 *
 *   - repeats inside this file (caught while reading the rows)
 *   - quotes already in this owner's library (caught by the unique index, so
 *     the database stays the one that decides)
 */
export const dynamic = "force-dynamic";

const MAX_ROWS_PER_IMPORT = 500;

type Failure = { error: string; status: number };

function failure(error: string, status: number): Failure {
  return { error, status };
}

function isFailure(value: unknown): value is Failure {
  return typeof value === "object" && value !== null && "status" in value;
}

/** A file that cannot be read is a 413 with a human sentence, never a 500. */
function badFile(error: unknown): Failure {
  return failure(
    error instanceof CsvTooLargeError
      ? error.message
      : "That file could not be read as CSV.",
    413,
  );
}

function analyseOr(text: string): CsvAnalysis | Failure {
  try {
    return analyseCsv(text);
  } catch (error) {
    return badFile(error);
  }
}

function itemsOr(
  text: string,
  mapping: Mapping,
  hasHeader: boolean,
): CsvItemsResult | Failure {
  try {
    return csvToItems(text, mapping, { hasHeader });
  } catch (error) {
    return badFile(error);
  }
}

/** Everything that can go wrong with the file itself, before touching Postgres. */
function prepare(
  text: string,
  fields: Record<string, string>,
): CsvItemsResult | Failure {
  const analysis = analyseOr(text);
  if (isFailure(analysis)) return analysis;

  let rawMapping: unknown = {};
  if (fields.mapping) {
    try {
      rawMapping = JSON.parse(fields.mapping);
    } catch {
      return failure("The column mapping was not valid JSON.", 400);
    }
  }

  const mapping = sanitiseMapping(rawMapping, analysis.columns.length);
  if (mapping.quote === null) {
    return failure("Pick the column that holds the quote before importing.", 422);
  }

  const declared = fields.hasHeader;
  const hasHeader =
    declared === "true" ? true : declared === "false" ? false : analysis.hasHeader;

  const parsed = itemsOr(text, mapping, hasHeader);
  if (isFailure(parsed)) return parsed;

  if (parsed.items.length > MAX_ROWS_PER_IMPORT) {
    return failure(`Import at most ${MAX_ROWS_PER_IMPORT} rows at a time.`, 413);
  }

  return parsed;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return respond("unauthenticated", 401);

  const upload = await readCsvUpload(request);
  if (uploadFailed(upload)) return respond(upload.error, upload.status);

  const parsed = prepare(upload.text, upload.fields);
  if (isFailure(parsed)) return respond(parsed.error, parsed.status);

  if (parsed.items.length === 0) {
    return respond(
      {
        imported: 0,
        duplicates: parsed.duplicates,
        errors: parsed.errors,
        totalRows: parsed.totalRows,
        message: "Nothing usable — every row was empty or already imported.",
      } satisfies CsvCommitResponse,
      422,
    );
  }

  // Which row produced which quote? The database reports duplicates as items,
  // so the response translates them back into row numbers.
  const rowsByQuote = new Map<string, number[]>();
  for (const { row, testimonial } of parsed.items) {
    const key = normaliseQuote(testimonial.quote);
    const bucket = rowsByQuote.get(key) ?? [];
    bucket.push(row);
    rowsByQuote.set(key, bucket);
  }

  const outcome = await insertTestimonialBatch(
    supabase,
    parsed.items.map(({ testimonial }) => testimonial),
  );

  if (outcome.error) return respond(outcome.error, 500);

  const libraryDuplicates: RowProblem[] = outcome.duplicates.map((item) => ({
    row: rowsByQuote.get(normaliseQuote(item.quote))?.shift() ?? 0,
    reason: "Already in your library.",
    excerpt: excerpt(item.quote),
  }));

  const body: CsvCommitResponse = {
    imported: outcome.inserted.length,
    duplicates: [...parsed.duplicates, ...libraryDuplicates].sort((a, b) => a.row - b.row),
    errors: parsed.errors,
    totalRows: parsed.totalRows,
    ...(outcome.warning ? { message: outcome.warning } : {}),
  };

  return NextResponse.json(body, { status: 201 });
}

function respond(payload: string | CsvCommitResponse, status: number) {
  return NextResponse.json(
    typeof payload === "string" ? { error: payload } : payload,
    { status },
  );
}
