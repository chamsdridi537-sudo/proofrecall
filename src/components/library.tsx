"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CsvUpload from "@/components/csv-upload";
import { attributedQuote } from "@/lib/attribution";
import { OBJECTIONS, searchedPhrase } from "@/lib/objections";
import type { SearchResponse, TestimonialRow } from "@/lib/types";

const DEBOUNCE_MS = 250;
const SAMPLE_BATCH = `"Switching to ProofRecall paid for itself in one week." — Dana Whitfield, Head of Ops, Northwind via email #roi #pricing
"The onboarding call took twenty minutes instead of two hours." — Marcus Lee, Founder, Brightloop #onboarding
"We finally stopped losing quotes in Slack threads." — Priya Raman, RevOps Lead, Kestrel #pricing #pain-points`;

/**
 * Copy, with a fallback.
 *
 * `navigator.clipboard` is undefined on non-secure origins and its `writeText`
 * rejects when the browser judges the click untrusted (Safari after a long
 * pause, any browser in a background tab), so the API-only version fails exactly
 * when a seller is mid-conversation — the one moment this button exists for.
 */
function writeToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }

  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    document.body.removeChild(area);
  }
  return copied
    ? Promise.resolve()
    : Promise.reject(new Error("Your browser blocked the copy — select the text instead."));
}

/**
 * The dashboard surface: search box, tag filter, results, and both importers
 * (paste-a-batch from Day 3, CSV upload from Day 4).
 *
 * The user's library is never shipped to the browser as one big dump — the
 * search box asks the server (and therefore Postgres + RLS) for each query, and
 * only the "browse" state pulls the most recent rows.
 *
 * `initialRows` is the first browse page, fetched by the Server Component above
 * the route. Seeding state from it means the very first paint already shows the
 * library — or the empty state that teaches the search box — instead of a
 * spinner that hides the product's point from a new visitor.
 */
export default function Library({
  initialRows,
}: {
  initialRows?: TestimonialRow[] | null;
}) {
  const seeded = initialRows != null;
  const [query, setQuery] = useState("");
  // What the objection chips *show* and what they *search* are different
  // strings: a seller recognises "It's too expensive", while the query that
  // answers it is the synonym union behind it. Typing in the box clears the
  // override, so the box is always the source of truth for a manual search.
  const [chipQuery, setChipQuery] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [rows, setRows] = useState<TestimonialRow[]>(initialRows ?? []);
  const [meta, setMeta] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(!seeded);
  const [error, setError] = useState<string | null>(null);

  const [batch, setBatch] = useState("");
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);

  // Only one row reads "Copied" at a time, so the feedback is unambiguous about
  // which quote went to the clipboard.
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  const [refreshKey, setRefreshKey] = useState(0);
  const controller = useRef<AbortController | null>(null);
  // The Server Component already answered this exact browse query; don't ask twice.
  const serverRowsPending = useRef(seeded);

  // Debounce keystrokes: the whole promise of the product is that a search is
  // instant, so there is no reason to hit Postgres on every character.
  const [debounced, setDebounced] = useState("");
  const effectiveQuery = chipQuery ?? query;
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(effectiveQuery.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [effectiveQuery]);

  useEffect(() => {
    if (serverRowsPending.current) {
      serverRowsPending.current = false;
      return;
    }

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
        duplicates?: string[];
        truncated?: boolean;
        message?: string;
      };
      if (!res.ok) throw new Error(body.message ?? "Import failed");

      setBatch("");
      setImportNote(
        `Added ${body.imported ?? 0} testimonial${body.imported === 1 ? "" : "s"}` +
          (body.duplicates?.length
            ? `, ${body.duplicates.length} already in your library`
            : "") +
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

  const copyQuote = useCallback(async (id: string, text: string) => {
    setCopyError(null);
    try {
      await writeToClipboard(text);
      setCopiedId(id);
    } catch (err: unknown) {
      setCopiedId(null);
      setCopyError(err instanceof Error ? err.message : "Copy failed.");
    }
  }, []);

  const inputClasses =
    "w-full rounded-full border border-zinc-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100";

  // No query and no filter means the list *is* the library, so an empty result
  // here is the first-run state rather than a search that missed.
  const browsing = debounced.length === 0 && tag === null;

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

      {/*
        The objection-first entry. A seller does not start from the word
        "pricing"; they start from "they said we're too expensive". The chips
        translate the thing they remember hearing into the term a testimonial
        actually contains, then reuse the search box — same debounce, same
        /api/search, same RLS-filtered tiers — so there is only one retrieval
        path to reason about.

        The chip's label stays in the box and the synonym union goes underneath
        it, because putting `pricing or expensive` in front of someone who only
        wanted an answer reads like the tool arguing with them. The union is
        visible where it belongs: a tooltip per chip, and one line under the box
        once a chip is active, so the operator stays discoverable rather than
        secret.
      */}
      <div className="mt-4" role="group" aria-label="Search by the objection you just heard">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          They said…
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {OBJECTIONS.map((objection) => {
            const active = tag === null && chipQuery === objection.query;
            return (
              <button
                key={objection.query}
                type="button"
                onClick={() => {
                  setTag(null);
                  setQuery(objection.said);
                  setChipQuery(objection.query);
                  setCopiedId(null);
                }}
                aria-pressed={active}
                aria-label={`Find proof against “${objection.said}”`}
                title={`Searched: ${searchedPhrase(objection.query)}`}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  active
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                    : "border-zinc-300 text-zinc-600 hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-100"
                }`}
              >
                {objection.said}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setChipQuery(null);
          }}
          placeholder="Search your quotes — a word, a typo, or two words with or"
          aria-label="Search testimonials"
          autoFocus
          className={inputClasses}
        />
        <button
          type="button"
          onClick={() => {
            setQuery("");
            setChipQuery(null);
            setTag(null);
          }}
          className="shrink-0 rounded-full border border-zinc-300 px-4 py-2.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Reset
        </button>
      </div>

      {chipQuery && (
        <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          Searched:{" "}
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {searchedPhrase(chipQuery)}
          </span>{" "}
          — either word counts, because customers do not all say it the same way.
        </p>
      )}

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

      {copyError && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {copyError}
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
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {(row.tags?.length ?? 0) === 0 && (
                <span className="text-[11px] text-zinc-400">untagged</span>
              )}
              {(row.tags ?? []).map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setTag(name)}
                  aria-label={`Filter by tag ${name}`}
                  className={`rounded-full px-2 py-0.5 text-[11px] transition ${
                    tag === name
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                  }`}
                >
                  #{name}
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                data-copy={attributedQuote(row)}
                onClick={(event) =>
                  void copyQuote(
                    row.id,
                    event.currentTarget.dataset.copy ?? attributedQuote(row),
                  )
                }
                aria-label="Copy this quote with attribution"
                className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {copiedId === row.id ? "Copied" : "Copy with attribution"}
              </button>
              {copiedId === row.id && (
                <span className="text-xs text-zinc-500">On your clipboard</span>
              )}
            </div>
            {row.match_kind && row.match_kind !== "recent" && (
              <p className="mt-3 text-[11px] tracking-wide text-zinc-400 uppercase">
                matched by {row.match_kind}
                {typeof row.rank === "number" ? ` · ${row.rank.toFixed(3)}` : ""}
              </p>
            )}
          </li>
        ))}
        {!loading && rows.length === 0 && !error && browsing && (
          <li className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
            <p className="text-sm font-medium">Your library is empty</p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-500">
              Add the testimonials you already have — from email, Slack,
              G2, a survey export, anywhere. Then, five seconds before a sales
              call, tap one of the objections above, or type a word like{" "}
              <span className="font-medium">pricing</span>, and the right quote
              comes back, even if you mistype it.
            </p>
            <p className="mt-4 text-xs text-zinc-400">
              Paste a batch or upload a CSV below. Duplicates are skipped, not
              re-imported.
            </p>
          </li>
        )}
        {!loading && rows.length === 0 && !error && !browsing && (
          <li className="rounded-2xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            {debounced.length > 0 ? (
              <>
                Nothing matches{" "}
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  “{chipQuery ? searchedPhrase(chipQuery) : debounced}”
                </span>
                {tag ? ` under #${tag}` : ""} yet.
              </>
            ) : (
              <>Nothing is tagged{" "}
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  #{tag}
                </span>{" "}
                yet.</>
            )}
            <span className="mt-1 block text-xs text-zinc-400">
              Reset to browse everything, or add another quote below.
            </span>
          </li>
        )}
      </ul>

      <section className="mt-8 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">Add testimonials</h2>
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

        <CsvUpload onImported={() => setRefreshKey((key) => key + 1)} />
      </section>
    </div>
  );
}
