export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading the team calendar">
      <div className="mb-2 h-7 w-48 rounded bg-slate-200" />
      <div className="mb-6 h-4 w-full max-w-xl rounded bg-slate-200" />
      <div className="mb-3 h-14 rounded-xl bg-slate-200" />
      <div className="hidden grid-cols-7 gap-1 md:grid">
        {Array.from({ length: 35 }).map((_, i) => (
          <div key={i} className="h-24 rounded bg-slate-200" />
        ))}
      </div>
      <div className="space-y-2 md:hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-slate-200" />
        ))}
      </div>
    </div>
  );
}
