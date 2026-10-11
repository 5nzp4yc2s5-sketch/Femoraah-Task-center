import Link from 'next/link';
import { requireMe } from '@/lib/session';
import { PageHeader } from '@/components/ui';

export const metadata = { title: 'How It Works' };

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-navy-800">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}

export default async function Help() {
  await requireMe();
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="How It Works" subtitle="Team Task Command Center" />

      <Card title="For employees (2 minutes a day)">
        <ol className="list-decimal space-y-2 pl-5">
          <li>Open <Link href="/" className="text-navy-700 underline">My Dashboard</Link>. Your open tasks are already filtered to you (no need to filter the Owner column).</li>
          <li>On anything you worked on, open the task and update <strong>Status</strong>, <strong>% Complete</strong> and a one-line <strong>Progress Note</strong>.</li>
          <li><strong>Last Update</strong> is filled in automatically when you save. If you are stuck, set Status to <strong>Blocked</strong> and say why in the note.</li>
          <li>Dev: Sanket adds your tasks to the Task Board with you as Owner. Sanket can also see your tasks and routines.</li>
          <li>Tick off routine work in <Link href="/routines" className="text-navy-700 underline">Routine Tasks</Link> with <strong>Mark done</strong>. Last Done and Next Due update for you.</li>
          <li>New work that nobody owns yet goes into <Link href="/backlog" className="text-navy-700 underline">Pending Backlog</Link>, not the Task Board.</li>
        </ol>
      </Card>

      <Card title="Where work lives">
        <ul className="list-disc space-y-1.5 pl-5">
          <li><strong>Task Board</strong>: assigned work with an owner and a due date.</li>
          <li><strong>Pending Backlog</strong>: unassigned work waiting for a manager to approve an owner.</li>
          <li><strong>Routine Tasks</strong>: recurring work (daily, weekly, monthly or every N days).</li>
        </ul>
      </Card>

      <Card title="How delegation works">
        <ol className="list-decimal space-y-2 pl-5">
          <li>Anyone adds unassigned work to Pending Backlog with the Skills Needed, Priority and Due Date.</li>
          <li>The app matches Skills Needed against each person&apos;s Expertise on the Team page, and checks how many open, overdue and blocked tasks they already have against their Max Open Tasks.</li>
          <li>It fills <strong>Suggested Owner</strong> and <strong>Why</strong> on the backlog row. The score is 70% skill match and 30% spare capacity; people at capacity are never suggested. (In the spreadsheet this step was done by Claude; the app does it with a fixed, transparent rule and needs no AI subscription.)</li>
          <li>The manager approves (Approved = Yes), and can pick a different owner and note why.</li>
          <li>Approval moves the work to the Task Board with that Owner and marks the backlog row Assigned. Approving twice never creates a second task. The backlog row stays for the record.</li>
        </ol>
        <p>You can also create a task directly and assign it to a teammate. You stay recorded as Assigned By and can track that task from your dashboard, without seeing the rest of their work.</p>
      </Card>

      <Card title="What the colours mean (Task Board)">
        <ul className="space-y-1.5">
          <li><span className="mr-2 inline-block h-3 w-3 rounded-full bg-red-500 align-middle" /><strong>Red</strong> = overdue.</li>
          <li><span className="mr-2 inline-block h-3 w-3 rounded-full bg-amber-500 align-middle" /><strong>Amber</strong> = due in the next 3 days, or no update for 3+ days.</li>
          <li><span className="mr-2 inline-block h-3 w-3 rounded-full bg-slate-500 align-middle" /><strong>Grey</strong> = Blocked.</li>
          <li><span className="mr-2 inline-block h-3 w-3 rounded-full bg-green-600 align-middle" /><strong>Green</strong> = Done.</li>
        </ul>
        <p>When more than one applies, one flag is shown in this order: Done, then Overdue, then Blocked, then Due soon, then Stale (no update 3+ days). A Done task is never shown as overdue.</p>
      </Card>

      <Card title="The Dashboard">
        <p>The manager&apos;s Dashboard shows open, overdue, blocked and due-this-week work per person, plus stale tasks, the unassigned backlog and overdue routines, so you can keep a hold on deadlines without chasing people for status. Everyone also has their own dashboard with just their work.</p>
      </Card>

      <Card title="Signing in">
        <p>Sign in with your username and password, then your 3-digit PIN. Five wrong PINs lock the account for 15 minutes; five wrong passwords do the same. Change your password and PIN from <Link href="/account" className="text-navy-700 underline">Account</Link>. Ask the admin if you are locked out or forgot either.</p>
      </Card>
    </div>
  );
}
