/** Today's motivational quote, the same for everyone. Hidden when there is none. */
export function QuoteCard({ quote }: { quote: { body: string; author: string } | null }) {
  if (!quote) return null;
  return (
    <figure className="card mb-4 flex gap-3 border-l-4 border-l-accent px-4 py-3">
      <svg viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0 text-accent" fill="currentColor" aria-hidden>
        <path d="M7.2 6C4.9 7.2 3.5 9.4 3.5 12.2V18h6v-6H6.3c.1-1.7 1-3 2.6-3.8L7.2 6zm10 0c-2.3 1.2-3.7 3.4-3.7 6.2V18h6v-6h-3.2c.1-1.7 1-3 2.6-3.8L17.2 6z" />
      </svg>
      <div className="min-w-0">
        <blockquote className="text-sm italic text-slate-800">{quote.body}</blockquote>
        {quote.author && <figcaption className="mt-0.5 text-xs font-medium text-slate-500">{quote.author}</figcaption>}
      </div>
    </figure>
  );
}
