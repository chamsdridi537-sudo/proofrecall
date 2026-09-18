"use client";

import { useCallback, useRef, useState } from "react";
import {
  IMPORT_FIELDS,
  type CsvAnalysis,
  type ImportField,
  type Mapping,
} from "@/lib/csv-import";
import type { CsvCommitResponse, RowProblem } from "@/lib/types";

/**
 * CSV upload (Day 4).
 *
 * Two steps on purpose. A file picker that guesses the columns and writes
 * immediately is how a support ticket starts; this one shows what it read and
 * lets the user say which column is the quote before anything is stored. The
 * guess is pre-selected, so the usual path is still "choose file → import".
 *
 * The commit re-uploads the same File rather than a server-side draft, so there
 * is nothing to clean up if the user walks away mid-import.
 */

const ANALYZE_ENDPOINT = "/api/import/csv/analyze";
const COMMIT_ENDPOINT = "/api/import/csv/commit";

type Stage = "idle" | "analyzing" | "mapping" | "committing";

type Report = CsvCommitResponse & { fileName: string };

function summarise(report: Report): string {
  const parts = [`Added ${report.imported} testimonial${report.imported === 1 ? "" : "s"}`];
  if (report.duplicates.length > 0) parts.push(`skipped ${report.duplicates.length} duplicate${report.duplicates.length === 1 ? "" : "s"}`);
  if (report.errors.length > 0) parts.push(`${report.errors.length} row${report.errors.length === 1 ? "" : "s"} could not be read`);
  return parts.join(" · ");
}

/** A `<select>` gives back a string; an unmapped column is `null`. */
function readIndex(value: string): number | null {
  if (value === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function withField(previous: Mapping, field: ImportField, value: number | null): Mapping {
  const next: Mapping = { ...previous };
  next[field] = value;
  return next;
}

export default function CsvUpload({ onImported }: { onImported: () => void }) {
  const [stage, setStage] = useState<Stage>("idle");
  const [analysis, setAnalysis] = useState<CsvAnalysis | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const reset = useCallback(() => {
    fileRef.current = null;
    setAnalysis(null);
    setMapping(null);
    setReport(null);
    setError(null);
    setStage("idle");
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const onPicked = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      fileRef.current = file;
      setReport(null);
      setError(null);
      setAnalysis(null);
      setMapping(null);
      setStage("analyzing");

      const form = new FormData();
      form.append("file", file);

      try {
        const res = await fetch(ANALYZE_ENDPOINT, { method: "POST", body: form });
        const body = (await res.json()) as CsvAnalysis & { error?: string };
        if (!res.ok || body.error) {
          throw new Error(body.error ?? `Could not read that file (${res.status}).`);
        }
        setAnalysis(body);
        setMapping(body.suggestedMapping);
        setStage("mapping");
      } catch (err) {
        setStage("idle");
        fileRef.current = null;
        setError(err instanceof Error ? err.message : "Could not read that file.");
      }
    },
    [],
  );

  const commit = useCallback(async () => {
    const file = fileRef.current;
    const currentMapping = mapping;
    if (!file || !currentMapping || !analysis) return;

    setStage("committing");
    setError(null);

    const form = new FormData();
    form.append("file", file);
    form.append("mapping", JSON.stringify(currentMapping));
    form.append("hasHeader", String(analysis.hasHeader));

    try {
      const res = await fetch(COMMIT_ENDPOINT, { method: "POST", body: form });
      const body = (await res.json()) as CsvCommitResponse & { error?: string };
      if (!res.ok || body.error) {
        throw new Error(
          body.error ?? body.message ?? `Import failed (${res.status}).`,
        );
      }
      setReport({ ...body, fileName: file.name });
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setStage("idle");
    }
  }, [analysis, mapping, onImported]);

  const busy = stage === "analyzing" || stage === "committing";

  const selectClasses =
    "w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100";

  return (
    <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
        Or upload a CSV
      </h3>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          aria-label="Upload a CSV of testimonials"
          onChange={onPicked}
          className="block w-full cursor-pointer text-xs text-zinc-600 file:mr-3 file:rounded-full file:border-0 file:bg-zinc-900 file:px-4 file:py-2 file:text-xs file:font-medium file:text-white hover:file:bg-zinc-700 dark:text-zinc-400 dark:file:bg-zinc-100 dark:file:text-zinc-900 dark:hover:file:bg-zinc-300 sm:w-auto"
        />
        {analysis && !busy && (
          <button
            type="button"
            onClick={reset}
            className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            Choose another file
          </button>
        )}
      </div>

      {stage === "analyzing" && (
        <p className="mt-2 text-xs text-zinc-500" aria-live="polite">
          Reading the file…
        </p>
      )}

      {error && (
        <p
          className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300"
          aria-live="polite"
        >
          {error}
        </p>
      )}

      {analysis && mapping && (stage === "mapping" || stage === "committing") && (
        <div className="mt-3 rounded-xl bg-zinc-50 p-4 dark:bg-zinc-950">
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            {analysis.totalRows} data row{analysis.totalRows === 1 ? "" : "s"} ·{" "}
            {analysis.columns.length} column{analysis.columns.length === 1 ? "" : "s"}
            {analysis.hasHeader ? " · header detected" : " · no header detected"}
            {analysis.truncated ? " · only the first 500 rows were read" : ""}
          </p>

          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {IMPORT_FIELDS.map(({ field, label, hint }) => (
              <label key={field} className="block">
                <span className="text-[11px] font-medium text-zinc-500">
                  {label}{" "}
                  <span className="font-normal text-zinc-400">({hint})</span>
                </span>
                <select
                  value={mapping[field] ?? ""}
                  disabled={busy}
                  onChange={(event) => {
                    setMapping((previous) =>
                      previous ? withField(previous, field, readIndex(event.target.value)) : previous,
                    );
                  }}
                  className={`${selectClasses} mt-1`}
                  aria-label={`Column holding ${label.toLowerCase()}`}
                >
                  <option value="">— not mapped —</option>
                  {analysis.columns.map((column) => (
                    <option key={column.index} value={column.index}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-left text-[11px]">
              <thead>
                <tr>
                  {analysis.columns.map((column) => {
                    const mapped = (Object.keys(mapping) as (keyof Mapping)[]).find(
                      (field) => mapping[field] === column.index,
                    );
                    return (
                      <th
                        key={column.index}
                        className={`border-b border-zinc-200 px-2 py-1 font-medium dark:border-zinc-800 ${
                          mapped ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400"
                        }`}
                      >
                        {column.name}
                        {mapped ? (
                          <span className="ml-1 text-zinc-400">→ {mapped}</span>
                        ) : null}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {analysis.preview.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td
                        key={cellIndex}
                        className="max-w-[16rem] truncate border-b border-zinc-100 px-2 py-1 text-zinc-600 dark:border-zinc-900 dark:text-zinc-400"
                        title={cell}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={commit}
              disabled={busy || mapping.quote === null}
              className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {stage === "committing"
                ? "Importing…"
                : `Import ${analysis.totalRows} row${analysis.totalRows === 1 ? "" : "s"}`}
            </button>
            {mapping.quote === null && (
              <span className="text-xs text-amber-700 dark:text-amber-400">
                Choose the quote column to enable the import.
              </span>
            )}
          </div>
        </div>
      )}

      {report && (
        <div className="mt-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <p className="text-[11px] text-zinc-400">{report.fileName}</p>
          <p className="mt-1 text-sm font-medium" aria-live="polite">
            {summarise(report)}
          </p>
          {report.message && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              {report.message}
            </p>
          )}
          <RowList title="Skipped as duplicates" problems={report.duplicates} />
          <RowList title="Rows that could not be read" problems={report.errors} />
          <button
            type="button"
            onClick={reset}
            className="mt-3 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            Import another file
          </button>
        </div>
      )}
    </div>
  );
}

function RowList({ title, problems }: { title: string; problems: RowProblem[] }) {
  if (problems.length === 0) return null;

  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-zinc-500">
        {title} ({problems.length})
      </summary>
      <ul className="mt-1 space-y-1">
        {problems.slice(0, 20).map((problem, index) => (
          <li key={`${problem.row}-${index}`} className="text-[11px] text-zinc-500">
            {problem.row > 0 ? `Row ${problem.row}: ` : ""}
            {problem.reason}
            {problem.excerpt ? (
              <span className="text-zinc-400"> — “{problem.excerpt}”</span>
            ) : null}
          </li>
        ))}
        {problems.length > 20 && (
          <li className="text-[11px] text-zinc-400">
            …and {problems.length - 20} more.
          </li>
        )}
      </ul>
    </details>
  );
}
