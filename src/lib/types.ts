/** Shapes shared by the API routes and the dashboard client components. */

import type { CsvAnalysis, RowProblem } from "@/lib/csv-import";

export type { ImportField, Mapping, CsvColumn, RowProblem } from "@/lib/csv-import";

export type MatchKind = "recent" | "fts" | "trigram";

/** One row of `search_testimonials` / the testimonials list. */
export type TestimonialRow = {
  id: string;
  quote: string;
  author: string | null;
  author_role: string | null;
  author_company: string | null;
  source: string | null;
  created_at: string;
  tags: string[] | null;
  rank?: number | null;
  match_kind?: MatchKind;
};

export type SearchResponse = {
  results: TestimonialRow[];
  query: string;
  tag: string | null;
  /** Which retrieval tier produced the rows: tsvector, trigram, or recency. */
  match_kind: MatchKind | null;
  ms: number;
  error?: string;
};

export type LibraryResponse = {
  results: TestimonialRow[];
  error?: string;
};

export type ImportError = {
  imported: number;
  skipped: string[];
  truncated: boolean;
  /** Quotes this owner already had — skipped, never rewritten. */
  duplicates?: string[];
  message?: string;
};

/**
 * Day 4 — CSV upload. `analyse` describes the file and guesses a mapping;
 * `commit` runs it and reports per row, because a 300-row export that fails on
 * row 4 has to say so.
 */
export type CsvAnalyzeResponse = CsvAnalysis & {
  fileName: string;
  error?: string;
};

export type CsvCommitResponse = {
  imported: number;
  duplicates: RowProblem[];
  errors: RowProblem[];
  totalRows: number;
  message?: string;
  error?: string;
};
