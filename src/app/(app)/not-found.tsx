import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="card mx-auto mt-10 max-w-lg p-6 text-center">
      <h1 className="text-lg font-semibold text-slate-900">Not found</h1>
      <p className="mt-2 text-sm text-slate-600">This item does not exist, or you do not have access to it.</p>
      <Link href="/" className="btn-primary mt-4">Back to my dashboard</Link>
    </div>
  );
}
