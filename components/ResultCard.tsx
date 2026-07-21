import { useState } from 'react';
import { buildShareMarkdown, copyText, PRODUCT_URL } from '@/lib/core/share';

export type ResultCardData = {
  summary: string;
  thumbnailUrl: string;
  title: string;
};

export function ResultCard({ summary, thumbnailUrl, title }: ResultCardData) {
  const [feedback, setFeedback] = useState('');

  async function copy(payload: string, successMessage: string) {
    try {
      await copyText(payload);
      setFeedback(successMessage);
    } catch {
      setFeedback('Copy failed. Your browser blocked clipboard access.');
    }
  }

  return (
    <section
      aria-label="Share latest export"
      className="mt-6 rounded-2xl border border-emerald-300/30 bg-emerald-300/[0.06] p-4 sm:p-5"
    >
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:items-center">
        <img
          alt="Waveform preview of the exported audio"
          className="aspect-[16/5] w-full rounded-xl border border-white/10 bg-[#0d1e1a] object-cover"
          src={thumbnailUrl}
        />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
            Latest export
          </p>
          <h3 className="mt-2 text-xl font-semibold text-emerald-50">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-emerald-100/70">{summary}</p>
          <p className="mt-2 text-xs text-emerald-100/60">
            The link shares Media Tools, not your audio.
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-3 border-t border-white/10 pt-4">
        <button
          className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 motion-reduce:transition-none"
          type="button"
          onClick={() => void copy(PRODUCT_URL, 'Link copied.')}
        >
          Copy link
        </button>
        <button
          className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 motion-reduce:transition-none"
          type="button"
          onClick={() =>
            void copy(buildShareMarkdown(title, summary), 'Markdown copied.')
          }
        >
          Copy as markdown
        </button>
        <p aria-live="polite" className="min-h-5 self-center text-sm text-emerald-200">
          {feedback}
        </p>
      </div>
    </section>
  );
}
