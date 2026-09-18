"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SearchResponse, TestimonialRow } from "@/lib/types";

const DEBOUNCE_MS = 250;
const SAMPLE_BATCH = `"Switching to ProofRecall paid for itself in one week." — Dana Whitfield, Head of Ops, Northwind via email #roi #pricing
"The onboarding call took twenty minutes instead of two hours." — Marcus Lee, Founder, Brightloop #onboarding
"We finally stopped losing quotes in Slack threads." — Priya Raman, RevOps Lead, Kestrel #pricing #pain-points`;

/**
 * The whole Day 3 surface: search box, tag filter, results, paste-a-batch import.
 *
 * The user's library is never shipped to the browser as one big dump — the
 * search box asks the server (and therefore Postgres + RLS) for each query, and
 * only the "browse" state pulls the most recent rows.
 */
export default function Library() {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [rows, setRows] = useState<TestimonialRow[]>([]);
  const [meta, setMeta] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [batch, setBatch] = useState("");
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);

  const [refreshKey, setRefreshKey] = useState(0);
  const controller = useRef<AbortController | null>(null);

  // Debounce keystrokes: the whole promise of the product is that a search is
  // instant, so there is no reason to hit Postgres on every character.
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    controller.current?.abort();
    const own = new AbortController();
    controller.current = own;

    const searching = debounced.length > 0;
    const url = searching
      ? `/api/search?q=${encodeURIComponent(debounced)}&tag=${encodeURIComponent(tag ?? "")}&limit=25`
      : `/api/testimonials?tag=${encodeURIComponent(tag ?? "")}&limit=50`;

    setLoading(true);
    fetch(url, { signal: own.signal })
      .then(async (res) => {
        const body = (await res.json()) as SearchResponse & { error?: string };
        if (!res.ok) {
          throw new Error(body.error ?? `Search failed (${res.status})`);
        }
        setRows(body.results ?? []);
        setMeta(body);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Something went wrong.");
      })
      .finally(() => {
        if (controller.current === own) setLoading(false);
      });

    return () => own.abort();
  }, [debounced, tag, refreshKey]);

  // Filter chips come from the browse view so they do not vanish as you search.
  const knownTags = useMemo(() => {
    const seen: string[] = [];
    for (const row of rows) {
      for (const name of row.tags ?? []) {
        if (!seen.includes(name)) seen.push(name);
      }
    }
    return seen.sort();
  }, [rows]);

  const runImport = useCallback(async () => {
    if (!batch.trim() || importing) return;
    setImporting(true);
    setImportNote(null);
    try {
      const res = await fetch("/api/testimonials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw: batch }),
      });
      const body = (await res.json()) as {
        imported?: number;
        skipped?: string[];
        truncated?: boolean;
        message?: string;
      };
      if (!res.ok) throw new Error(body.message ?? "Import failed");

      setBatch("");
      setImportNote(
        `Added ${body.imported ?? 0} testimonial${body.imported === 1 ? "" : "s"}` +
          (body.skipped?.length ? `, skipped ${body.skipped.length}` : "") +
          (body.truncated ? " (batch capped at 50)" : ""),
      );
      setRefreshKey((key) => key + 1);
    } catch (err) {
      setImportNote(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }, [batch, importing]);

  const inputClasses =
    "w-full rounded-full border border-zinc-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100";

  return (
    <div className="w-full max-w-3xl">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          Find the right testimonial
        </h1>
        <span className="text-xs text-zinc-500">
          {loading ? "searching…" : `${rows.length} result${rows.length === 1 ? "" : "s"}`}
          {meta?.ms !== undefined && !loading ? ` in ${meta.ms}ms` : ""}
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search your quotes — try a word, or a typo"
          aria-label="Search testimonials"
          autoFocus
          className={inputClasses}
        />
        <button
          type="button"
          onClick={() => {
            setQuery("");
            setTag(null);
          }}
          className="shrink-0 rounded-full border border-zinc-300 px-4 py-2.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Reset
        </button>
      </div>

      {knownTags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {knownTags.map((name) => {
            const active = tag === name;
            return (
              <button
                key={name}
                type="button"
                onClick={() => setTag(active ? null : name)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  active
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                    : "border-zinc-300 text-zinc-600 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
                }`}
              >
                #{name}
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <ul className="mt-5 space-y-3">
        {rows.map((row) => (
          <li
            key={row.id}
            className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800"
          >
            <p className="text-[15px] leading-relaxed">“{row.quote}”</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
              {row.author && <span className="font-medium text-zinc-700 dark:text-zinc-300">{row.author}</span>}
              {row.author_role && <span>{row.author_role}</span>}
              {row.author_company && <span>{row.author_company}</span>}
              {row.source && <span>via {row.source}</span>}
            </div>
            {(row.tags?.length ?? 0) > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {row.tags?.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setTag(name)}
                    className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400"
                  >
                    #{name}
                  </button>
                ))}
              </div>
            )}
            {row.match_kind && row.match_kind !== "recent" && (
              <p className="mt-3 text-[11px] tracking-wide text-zinc-400 uppercase">
                matched by {row.match_kind}
                {typeof row.rank === "number" ? ` · ${row.rank.toFixed(3)}` : ""}
              </p>
            )}
          </li>
        ))}
        {!loading && rows.length === 0 && !error && (
          <li className="rounded-2xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            Nothing matches that yet. Paste a batch below to grow the library.
          </li>
        )}
      </ul>

      <section className="mt-8 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">Import a batch</h2>
        <p className="mt-1 text-xs text-zinc-500">
          One testimonial per line, or separate them with a blank line. Use
          <span className="font-medium"> — Author, Role, Company </span>
          after the quote, <span className="font-medium">via source</span> for
          where it came from, and <span className="font-medium">#tags</span> at
          the end.
        </p>
        <textarea
          value={batch}
          onChange={(event) => setBatch(event.target.value)}
          rows={5}
          spellCheck={false}
          placeholder={SAMPLE_BATCH}
          aria-label="Paste testimonials to import"
          className="mt-3 w-full rounded-xl border border-zinc-300 bg-white p-3 font-mono text-xs leading-relaxed outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100"
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={runImport}
            disabled={importing || !batch.trim()}
            className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {importing ? "Importing…" : "Add to library"}
          </button>
          <button
            type="button"
            onClick={() => setBatch(SAMPLE_BATCH)}
            className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            Fill with example
          </button>
          {importNote && (
            <span className="text-xs text-zinc-600 dark:text-zinc-400">
              {importNote}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
