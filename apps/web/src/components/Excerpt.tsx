import type { Excerpt as ExcerptData } from "@remotefit/core/api";

/** The quote highlighted inside its context (a fragment of the posting, never the whole text: ADR 0002). */
export function Excerpt({ excerpt }: { excerpt: ExcerptData }) {
  return (
    <p className="rounded border border-slate-200 bg-white p-3 text-sm leading-relaxed text-slate-700">
      {excerpt.before}
      <mark className="rounded bg-yellow-200 px-0.5 text-slate-900">{excerpt.match}</mark>
      {excerpt.after}
    </p>
  );
}
