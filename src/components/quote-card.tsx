/** Today's motivational quote, the same for everyone. Hidden when there is none. */
export function QuoteCard({ quote }: { quote: { body: string; author: string } | null }) {
  if (!quote) return null;
  return (
    <figure className="mt-3 flex max-w-2xl items-start gap-2 text-sm">
      <span className="select-none text-xl leading-none text-accent" aria-hidden>
        “
      </span>
      <div className="min-w-0">
        <blockquote className="inline italic text-slate-700">{quote.body}</blockquote>
        {quote.author && <figcaption className="ml-2 inline text-slate-500">{quote.author}</figcaption>}
      </div>
    </figure>
  );
}
