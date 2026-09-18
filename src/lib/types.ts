/** Shapes shared by the API routes and the dashboard client components. */

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
  message?: string;
};
