export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="mb-2 h-8 w-56 rounded-lg bg-slate-200/70" />
      <div className="mb-6 h-4 w-full max-w-md rounded bg-slate-200/70" />
      <div className="h-44 rounded-xl bg-slate-200/70" />
      <div className="mb-3 mt-9 h-4 w-32 rounded bg-slate-200/70" />
      <div className="h-64 rounded-xl bg-slate-200/70" />
    </div>
  );
}
