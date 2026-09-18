/**
 * CSV -> library rows (Day 4).
 *
 * Two jobs:
 *
 *   1. `analyseCsv` — describe an uploaded file so the dashboard can show its
 *      columns and a first few rows, and pre-fill a mapping the user can
 *      override. Most exports already say what they are ("Testimonial",
 *      "Customer", "Company"), so the guess is usually right and one click
 *      finishes the import.
 *   2. `csvToItems` — turn the mapped rows into the same `ParsedTestimonial`
 *      shape the paste-a-batch importer produces, so the DB write path is
 *      shared and there is only one place where a quote can be rejected.
 *
 * The duplicate rule lives in Postgres (see migration 0003):
 * md5(lower(btrim(regexp_replace(quote, '\s+', ' ', 'g')))). `normaliseQuote`
 * mirrors it in JavaScript so a report can name *which* rows were skipped
 * without a second round trip — the database stays the arbiter either way.
 */

import { looksLikeHeader, parseCsv } from "@/lib/csv";
import { normaliseTag, MAX_QUOTE_LENGTH, type ParsedTestimonial } from "@/lib/parse-batch";

export type ImportField =
  | "quote"
  | "author"
  | "author_role"
  | "author_company"
  | "source"
  | "tags";

/** Display order + labels for the mapping step. */
export const IMPORT_FIELDS: { field: ImportField; label: string; hint: string }[] = [
  { field: "quote", label: "Quote", hint: "required" },
  { field: "author", label: "Author", hint: "optional" },
  { field: "author_role", label: "Role", hint: "optional" },
  { field: "author_company", label: "Company", hint: "optional" },
  { field: "source", label: "Source", hint: "optional" },
  { field: "tags", label: "Tags", hint: "optional" },
];

export type Mapping = Record<ImportField, number | null>;

export const EMPTY_MAPPING: Mapping = {
  quote: null,
  author: null,
  author_role: null,
  author_company: null,
  source: null,
  tags: null,
};

const MAPPING_FIELDS = IMPORT_FIELDS.map(({ field }) => field);

/**
 * Trust nothing from the request body: a mapping is only useful if every index
 * it names actually exists in this file, so out-of-range or non-integer entries
 * are dropped back to "not mapped" instead of throwing mid-import.
 */
export function sanitiseMapping(raw: unknown, columnCount: number): Mapping {
  const out: Mapping = { ...EMPTY_MAPPING };
  if (typeof raw !== "object" || raw === null) return out;

  const source = raw as Record<string, unknown>;
  for (const field of MAPPING_FIELDS) {
    const value = source[field];
    if (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 0 &&
      value < columnCount
    ) {
      out[field] = value;
    }
  }
  return out;
}

export type CsvColumn = { index: number; name: string };

export type CsvAnalysis = {
  columns: CsvColumn[];
  /** First rows of data, already mapped to the header width. */
  preview: string[][];
  totalRows: number;
  hasHeader: boolean;
  truncated: boolean;
  suggestedMapping: Mapping;
};

const MAX_TEXT_LENGTH = 300;
const MAX_TAGS_PER_ROW = 12;

/** Mirror of the SQL normalisation behind the unique index. */
export function normaliseQuote(quote: string): string {
  return quote.replace(/\s+/g, " ").trim().toLowerCase();
}

const SUGGESTIONS: { field: ImportField; patterns: RegExp }[] = [
  { field: "quote", patterns: /^(quote|testimonial|text|content|feedback|review|comment)$/i },
  { field: "author", patterns: /^(author|name|full ?name|customer|person|who|client)$/i },
  { field: "author_role", patterns: /^(role|title|job ?title|position|designation)$/i },
  { field: "author_company", patterns: /^(company|organisation|organization|org|firm|business|account|employer)$/i },
  { field: "source", patterns: /^(source|channel|platform|from|via|medium)$/i },
  { field: "tags", patterns: /^(tags?|labels?|keywords?|themes?)$/i },
];

function suggestFor(name: string): ImportField | null {
  const cleaned = name.trim().replace(/^"|"$/g, "");
  if (!cleaned) return null;
  for (const { field, patterns } of SUGGESTIONS) {
    if (patterns.test(cleaned)) return field;
  }
  // Loose match for headers like "Customer quote" or "Testimonial text".
  if (/quote|testimonial|feedback/i.test(cleaned)) return "quote";
  if (/author|name|customer/i.test(cleaned)) return "author";
  if (/role|title/i.test(cleaned)) return "author_role";
  if (/company|organi[sz]ation/i.test(cleaned)) return "author_company";
  return null;
}

function columnNames(cells: string[]): string[] {
  return cells.map((cell, index) => {
    const trimmed = cell.trim();
    return trimmed.length > 0 ? trimmed : `Column ${index + 1}`;
  });
}

export function analyseCsv(text: string, previewRows = 5): CsvAnalysis {
  const { rows, truncated } = parseCsvFile(text);

  if (rows.length === 0) {
    return {
      columns: [],
      preview: [],
      totalRows: 0,
      hasHeader: false,
      truncated,
      suggestedMapping: { ...EMPTY_MAPPING },
    };
  }

  const hasHeader = looksLikeHeader(rows[0]);
  const headerCells = hasHeader ? (rows[0] as string[]) : [];
  const dataRows = hasHeader ? rows.slice(1) : rows;

  const names = headerCells.length > 0
    ? columnNames(headerCells)
    : columnNames(
        Array<string>(dataRows.reduce((max, r) => Math.max(max, r.length), 0)).fill(""),
      );

  const columns: CsvColumn[] = names.map((name, index) => ({ index, name }));

  const suggestedMapping: Mapping = { ...EMPTY_MAPPING };
  const taken = new Set<ImportField>();
  for (const { index, name } of columns) {
    const field = suggestFor(name);
    if (field && !taken.has(field)) {
      suggestedMapping[field] = index;
      taken.add(field);
    }
  }
  // No header at all: the widest, most sentence-like column is the quote.
  if (!hasHeader && suggestedMapping.quote === null) {
    let best = 0;
    let bestLength = -1;
    for (const row of dataRows.slice(0, 20)) {
      for (let index = 0; index < row.length; index += 1) {
        const length = row[index]?.length ?? 0;
        if (length > bestLength) {
          bestLength = length;
          best = index;
        }
      }
    }
    suggestedMapping.quote = best;
  }

  return {
    columns,
    preview: dataRows.slice(0, previewRows),
    totalRows: dataRows.length,
    hasHeader,
    truncated,
    suggestedMapping,
  };
}

export type RowProblem = { row: number; reason: string; excerpt: string };

/** One accepted row, tagged with its position so reports can name it. */
export type CsvRowItem = { row: number; testimonial: ParsedTestimonial };

export type CsvItemsResult = {
  items: CsvRowItem[];
  /** Rejected by the row itself (empty quote, nothing mapped). */
  errors: RowProblem[];
  /** Repeats inside this same file — Postgres would skip them anyway. */
  duplicates: RowProblem[];
  totalRows: number;
};

function cellAt(row: string[], index: number | null): string {
  if (index === null) return "";
  const value = row[index];
  return typeof value === "string" ? value.trim() : "";
}

export function excerpt(value: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > 90 ? `${cleaned.slice(0, 90)}…` : cleaned;
}

/** `pricing, roi | #onboarding` -> ["pricing", "roi", "onboarding"] */
export function splitTags(cell: string): string[] {
  const seen: string[] = [];
  for (const part of cell.split(/[,;|#\n]/)) {
    const tag = normaliseTag(part);
    if (tag && !seen.includes(tag)) seen.push(tag);
    if (seen.length >= MAX_TAGS_PER_ROW) break;
  }
  return seen;
}

function clipped(value: string): string | null {
  if (!value) return null;
  return value.slice(0, MAX_TEXT_LENGTH);
}

export function csvToItems(
  text: string,
  mapping: Mapping,
  options: { hasHeader?: boolean } = {},
): CsvItemsResult {
  const { rows } = parseCsvFile(text);
  const hasHeader =
    options.hasHeader ?? (rows.length > 0 ? looksLikeHeader(rows[0]) : false);
  const dataRows = hasHeader ? rows.slice(1) : rows;

  const items: CsvRowItem[] = [];
  const errors: RowProblem[] = [];
  const duplicates: RowProblem[] = [];
  const seen = new Set<string>();

  if (mapping.quote === null) {
    return {
      items,
      errors: [{ row: 0, reason: "Pick the column that holds the quote.", excerpt: "" }],
      duplicates,
      totalRows: dataRows.length,
    };
  }

  dataRows.forEach((row, position) => {
    const rowNumber = position + 1;
    const rawQuote = cellAt(row, mapping.quote);

    if (!rawQuote) {
      errors.push({
        row: rowNumber,
        reason: "No quote in this row.",
        excerpt: excerpt(row.join(" | ")),
      });
      return;
    }

    const key = normaliseQuote(rawQuote);
    if (seen.has(key)) {
      duplicates.push({
        row: rowNumber,
        reason: "Same quote appears earlier in this file.",
        excerpt: excerpt(rawQuote),
      });
      return;
    }
    seen.add(key);

    // A tag column that also carries "#tag" words is fine; normaliseTag strips it.
    const tags = splitTags(cellAt(row, mapping.tags));

    items.push({
      row: rowNumber,
      testimonial: {
        quote: rawQuote.slice(0, MAX_QUOTE_LENGTH),
        author: clipped(cellAt(row, mapping.author)),
        author_role: clipped(cellAt(row, mapping.author_role)),
        author_company: clipped(cellAt(row, mapping.author_company)),
        source: clipped(cellAt(row, mapping.source)),
        tags,
      },
    });
  });

  return { items, errors, duplicates, totalRows: dataRows.length };
}

/**
 * Guard rails shared by both upload steps: a file that is not a CSV (or is
 * absurdly large) should say so here, not half-way through an insert.
 */
const MAX_CSV_CHARS = 2_000_000;

export class CsvTooLargeError extends Error {
  constructor() {
    super("That file is too large — export 500 rows at a time.");
    this.name = "CsvTooLargeError";
  }
}

function parseCsvFile(text: string): { rows: string[][]; truncated: boolean } {
  if (text.length > MAX_CSV_CHARS) {
    throw new CsvTooLargeError();
  }
  return parseCsv(text);
}
