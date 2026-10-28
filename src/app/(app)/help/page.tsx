import Link from 'next/link';
import { requireMe } from '@/lib/session';
import { PageHeader } from '@/components/ui';

export const metadata = { title: 'How It Works' };

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="mb-3 text-[15px] font-semibold text-slate-900">{title}</h2>
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
          <li>Open <Link href="/" className="text-navy-700 underline">My Dashboard</Link>. It shows your own work: what is due today, overdue or blocked, your routines and your workload.</li>
          <li>On anything you worked on, open the task and update <strong>Status</strong> (To Do, Active, Blocked or Done), <strong>% Complete</strong> and a one-line <strong>Progress Note</strong>.</li>
          <li><strong>Last Update</strong> is filled in automatically when you save. If you are stuck, set Status to <strong>Blocked</strong> and write the <strong>blocker reason</strong>. A blocked task cannot be saved without one, and the time it became blocked is recorded.</li>
          <li>Tick off routine work in <Link href="/routines" className="text-navy-700 underline">Routine Tasks</Link> with <strong>Mark done</strong>. Last Done and Next Due update for you.</li>
          <li>New work that nobody is assigned to yet goes into <Link href="/backlog" className="text-navy-700 underline">Pending Backlog</Link>, not the Task Board.</li>
          <li>Going on leave? Add it to the <Link href="/calendar" className="text-navy-700 underline">Team Calendar</Link> and name a backup.</li>
        </ol>
      </Card>

      <Card title="Who sees what">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>You see tasks assigned to you, tasks you created or delegated, and tasks shared with you. You see your own routines, and routines you back up for someone.</li>
          <li>Managers see all tasks and routines. Nobody else sees a teammate&apos;s tasks or routines, whoever they work with or report to.</li>
          <li>The <Link href="/team" className="text-navy-700 underline">Team</Link> page shows everyone&apos;s counts (open, overdue, blocked, capacity and leave), not the tasks themselves.</li>
        </ul>
      </Card>

      <Card title="Roles">
        <ul className="list-disc space-y-1.5 pl-5">
          <li><strong>Super Admin</strong>: everything, including team members, logins, PINs and who is an Admin.</li>
          <li><strong>Admin</strong>: sees all tasks and routines, approves the backlog and records leave for others, plus only the admin areas the Super Admin gives them on the Team page (Attendance, Company settings, Google Sheets, Credentials).</li>
          <li><strong>Access manager</strong>: for a login they were made access manager of, can also change its saved password and share it with others.</li>
          <li><strong>Employee</strong>: their own work, attendance, the sheets and logins shared with them, and the sheets they add.</li>
          <li>Wherever the app says <em>manager</em>, it means an Admin or the Super Admin.</li>
        </ul>
      </Card>

      <Card title="Where work lives">
        <ul className="list-disc space-y-1.5 pl-5">
          <li><strong>Task Board</strong>: work with someone assigned to it, a priority and a due date. Each task has an ID such as TSK-001.</li>
          <li><strong>Pending Backlog</strong>: work nobody is assigned to yet, waiting for a manager to approve who does it.</li>
          <li><strong>Routine Tasks</strong>: recurring work (daily, weekly, monthly every 30 days, or every N days).</li>
          <li><strong>Team Calendar</strong>: company holidays and who is on leave.</li>
          <li><strong>Attendance</strong>: your sign-in and sign-out times.</li>
          <li><strong>Google Sheets</strong>: links to the team&apos;s working sheets, what each is for, who is responsible and who works on it. Google still decides who can open a sheet.</li>
          <li><strong>Credentials</strong>: shared logins for websites and tools, shown only to the people and teams they are shared with.</li>
        </ul>
      </Card>

      <Card title="Task words">
        <ul className="list-disc space-y-1.5 pl-5">
          <li><strong>Assigned to</strong>: the person doing the task.</li>
          <li><strong>Delegated by</strong>: the person who handed it over. They can follow that task from their dashboard without seeing the rest of the assignee&apos;s work.</li>
          <li><strong>Status</strong>: To Do, Active, Blocked or Done. Blocked always needs a blocker reason.</li>
          <li><strong>Priority</strong>: Critical, High, Medium or Low.</li>
          <li><strong>Flag as important</strong>: marks a task with a star (★) so it stands out on the board.</li>
          <li>Changes to the due date, priority, title, blocker or who delegated a task are kept in the task&apos;s history.</li>
        </ul>
      </Card>

      <Card title="How backlog work gets assigned">
        <ol className="list-decimal space-y-2 pl-5">
          <li>Anyone adds unassigned work to Pending Backlog with the Skills Needed, Priority and Due Date.</li>
          <li>The app matches Skills Needed against each person&apos;s Expertise on the Team page, and checks how many open, overdue and blocked tasks they already have against their Max Open Tasks.</li>
          <li>It suggests who should do it and says why. The score is 70% skill match and 30% spare capacity, using a fixed rule anyone can check. People who are at capacity or on leave today are not suggested.</li>
          <li>A manager approves the suggestion, picks someone else and notes why, or dismisses the item. Someone on leave can only be chosen if the manager confirms it.</li>
          <li>Approval creates the task on the Task Board (status To Do), delegated by the manager who approved it. Approving twice never creates a second task. The backlog row stays for the record as Pending, Approved, Converted to Task or Dismissed.</li>
        </ol>
        <p>You can also create a task directly and assign it to a teammate. You are recorded as <strong>Delegated by</strong> and can track that task from your dashboard.</p>
      </Card>

      <Card title="What the colours mean (Task Board)">
        <ul className="space-y-1.5">
          <li><span className="mr-2 inline-block h-3 w-3 rounded-full bg-red-500 align-middle" /><strong>Red</strong> = Overdue.</li>
          <li><span className="mr-2 inline-block h-3 w-3 rounded-full bg-orange-500 align-middle" /><strong>Orange</strong> = Blocked.</li>
          <li><span className="mr-2 inline-block h-3 w-3 rounded-full bg-amber-500 align-middle" /><strong>Amber</strong> = Due soon (in the next 3 days), or Stale (no update for 3+ days).</li>
          <li><span className="mr-2 inline-block h-3 w-3 rounded-full bg-yellow-400 align-middle" /><strong>Yellow</strong> = Due in 7 days.</li>
          <li><span className="mr-2 inline-block h-3 w-3 rounded-full bg-green-600 align-middle" /><strong>Green</strong> = Done.</li>
        </ul>
        <p>When more than one applies, one flag is shown in this order: Done, Overdue, Blocked, Due soon, Stale, Due in 7 days, On track. A Done task is never shown as overdue.</p>
      </Card>

      <Card title="Routines and backups">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>A routine shows <strong>OK</strong>, <strong>Due Today</strong>, <strong>Overdue</strong>, <strong>Not Logged</strong> (never ticked off yet) or <strong>Paused</strong>.</li>
          <li>A routine can have a backup person. While the person it is assigned to is on leave, the backup covers it: they can see it and tick it off. If the routine has no backup, the backup named on the leave covers it.</li>
          <li>Covering never changes who the routine is assigned to. Your dashboard tells you when you are covering routines for someone.</li>
        </ul>
      </Card>

      <Card title="Team Calendar and capacity">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Everyone can see who is away and on which dates. The type of leave and any note are shown only to managers, the person and their backup.</li>
          <li>You can add your own upcoming leave. Managers can add leave for anyone and manage company holidays.</li>
          <li><strong>Holiday Swap</strong>: you work a company holiday or one of your weekly offs, and take another day off instead. Choose the day you will work on the leave form; that day then counts as a normal working day for you.</li>
          <li>Each person has a <strong>Max Open Tasks</strong> (10 unless an admin changes it). <strong>Available</strong> = below it, <strong>At Capacity</strong> = exactly at it, <strong>Overloaded</strong> = above it, <strong>On Leave</strong> = on leave today.</li>
        </ul>
      </Card>

      <Card title="Attendance">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Only two things are recorded: when you sign in with your PIN and when you sign out. Nothing else about your device or activity is collected.</li>
          <li>The server&apos;s clock is the source of truth, not your phone or computer, so everyone is measured the same way.</li>
          <li>Each day is compared with your work schedule. <strong>Late</strong> and <strong>Left Early</strong> flags are prompts for an admin to check, not findings against you.</li>
          <li>If you forget to sign out, the day shows an <strong>Incomplete Session</strong>. No sign-out time is made up.</li>
          <li>If a time is wrong, request a correction on the <Link href="/attendance" className="text-navy-700 underline">Attendance</Link> page. An admin approves or rejects it.</li>
          <li>You see only your own attendance. Admins see everyone&apos;s.</li>
        </ul>
      </Card>

      <Card title="The Dashboards">
        <p><strong>My Dashboard</strong> shows only your work: tasks due today, overdue, blocked and coming up in the next 7 days, your routines, your workload against your capacity, recent changes others made to tasks you can see, upcoming leave and holidays, and your attendance today.</p>
        <p>The manager&apos;s <strong>Dashboard</strong> shows team-wide counts that can be filtered by employee, status, priority, due dates and routine frequency, workload and capacity per person, and an escalation list of overdue and blocked work. Every number is counted from live records; select one to open the matching list.</p>
      </Card>

      <Card title="Company look and daily quote">
        <p>An admin can set the company name, logo and colours under <strong>Settings → Company &amp; branding</strong>. Colours that would make text hard to read are refused. Everyone sees the same motivational quote on their dashboard each day; an admin manages the list under <strong>Settings → Quotes</strong>.</p>
      </Card>

      <Card title="Google Sheets">
        <p>The <Link href="/sheets" className="text-navy-700 underline">Google Sheets</Link> page lists the team&apos;s sheets with search, filters by team, category and person, and sorting. Select <strong>Open sheet</strong> to open it in Google Sheets. Anyone can add a sheet with <strong>Add a sheet</strong>; whoever adds it becomes its responsible person. A Sheets admin can edit, hand over or remove any entry; the responsible person can update an entry&apos;s details and who works on it. Removed entries are kept and can be restored. Only the link is stored here, never the sheet&apos;s contents.</p>
      </Card>

      <Card title="Credentials">
        <p>The <Link href="/credentials" className="text-navy-700 underline">Credentials</Link> page lists the shared logins you can use. Passwords and notes are encrypted and stay hidden: select <strong>Show password</strong> or <strong>Copy password</strong> and enter your PIN each time. A shown password hides itself after a minute, and a copied one is cleared from the clipboard after 30 seconds. Five wrong PINs lock your account, the same as at sign-in.</p>
        <p className="mt-2">A Credentials admin adds logins and shares them with people or teams. An <strong>access manager</strong> can also save a new password and share the login. Saving a password here only updates the copy kept in the app: change it on the website first. Every show, copy, change and share is recorded in the login&apos;s history, and access ends automatically when someone&apos;s role changes or their account is deactivated.</p>
      </Card>

      <Card title="Signing in">
        <p>Sign in with your username and 3-digit PIN. Your device stays signed in and asks for the PIN again every 12 hours. Five wrong PINs in a row lock the account until the admin resets your PIN from the Team page. Change your PIN from <Link href="/account" className="text-navy-700 underline">Account</Link>, and never share it in a group chat.</p>
      </Card>
    </div>
  );
}
