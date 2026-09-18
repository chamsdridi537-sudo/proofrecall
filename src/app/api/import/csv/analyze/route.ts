import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { analyseCsv, CsvTooLargeError, type CsvAnalysis } from "@/lib/csv-import";
import { readCsvUpload, uploadFailed } from "@/lib/upload";
import type { CsvAnalyzeResponse } from "@/lib/types";

/**
 * POST /api/import/csv/analyze — describe an uploaded CSV before importing it.
 *
 * Nothing is written here. The dashboard needs the column names plus a couple of
 * preview rows so the user can point at which column holds the quote, and this
 * is also where a "CSV" that is really a 40 MB JSON dump gets refused.
 *
 * Auth is checked first because the analysis echoes customer text back.
 */
export const dynamic = "force-dynamic";

function failure(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/** Parse errors never escape as a 500 with a stack trace in the message. */
function describe(text: string): CsvAnalysis | { error: string; status: number } {
  try {
    return analyseCsv(text);
  } catch (error) {
    return {
      error:
        error instanceof CsvTooLargeError
          ? error.message
          : "That file could not be read as CSV.",
      status: 413,
    };
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return failure("unauthenticated", 401);

  const upload = await readCsvUpload(request);
  if (uploadFailed(upload)) return failure(upload.error, upload.status);

  const analysis = describe(upload.text);
  if ("error" in analysis) return failure(analysis.error, analysis.status);
  if (analysis.columns.length === 0) return failure("No rows to import in that file.", 422);

  const body: CsvAnalyzeResponse = { ...analysis, fileName: upload.fileName };
  return NextResponse.json(body);
}
