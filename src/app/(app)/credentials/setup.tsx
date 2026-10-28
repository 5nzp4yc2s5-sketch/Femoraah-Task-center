import { Notice } from '@/components/ui';
import type { KeyStatus } from '@/lib/credentials-crypto';
import { KeyGenerator } from './inputs';

/** Shown until the server has a valid CREDENTIALS_ENCRYPTION_KEY. Only the Super Admin can add it. */
export function KeySetup({ status, isSuperAdmin }: { status: Exclude<KeyStatus, 'ok'>; isSuperAdmin: boolean }) {
  if (!isSuperAdmin) {
    return (
      <Notice tone="warn">
        The credential manager is not switched on yet: the Super Admin still has to add the encryption key. Saved logins can be listed but not shown or changed until then.
      </Notice>
    );
  }
  return (
    <section className="card mb-5 space-y-4 border-amber-200 p-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Switch on the credential manager</h2>
        <p className="mt-1 text-sm text-slate-600">
          {status === 'invalid'
            ? 'The server has a CREDENTIALS_ENCRYPTION_KEY, but it is not a valid key (it must be 32 random bytes in base64). Replace it using the steps below.'
            : 'Passwords are encrypted with a key that only the app server holds. It is not set yet, so nothing can be saved. This takes about two minutes, once.'}
        </p>
      </div>
      <ol className="list-decimal space-y-3 pl-5 text-sm text-slate-800">
        <li>
          Make a key:
          <div className="mt-2"><KeyGenerator /></div>
        </li>
        <li>
          Keep a copy of the key somewhere safe outside this app, such as your own password manager. <strong>If the key is lost, saved passwords cannot be recovered.</strong> Do not paste it into chat, email or GitHub.
        </li>
        <li>
          In Vercel, open the <strong>femoraah-task-center</strong> project → <strong>Settings</strong> → <strong>Environment Variables</strong> → <strong>Add</strong>. Name: <code className="rounded bg-slate-100 px-1">CREDENTIALS_ENCRYPTION_KEY</code>. Value: the key. Environment: <strong>Production</strong>. Turn on <strong>Sensitive</strong>, then save.
        </li>
        <li>
          Open <strong>Deployments</strong>, select the top one, and choose <strong>Redeploy</strong>. When it finishes, reload this page.
        </li>
      </ol>
      <p className="text-xs text-slate-500">Once set, never change the key: logins saved with the old key could no longer be read.</p>
    </section>
  );
}
