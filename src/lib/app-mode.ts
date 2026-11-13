// The same code runs two apps. With APP_MODE=cashflow (a server-side setting on that deployment) it is
// the separate Cash Flow app: only Cash Flow, its bank emails and the Team page for managing logins and
// Finance access, and only the Super Admin and people with Finance access can sign in. Without it, it
// is the full workspace.

export function cashflowOnly(): boolean {
  return process.env.APP_MODE === 'cashflow';
}

const CASHFLOW_PATHS = ['/finance', '/team', '/account', '/api/finance', '/verify', '/login'];

/** Pages the Cash Flow app serves. Everything else goes to its home page. */
export function cashflowServes(path: string): boolean {
  return path === '/' || CASHFLOW_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

export const CASHFLOW_NAME = 'Cash Flow';
export const FINANCE_ONLY_MESSAGE = 'This app is for the Super Admin and people with Finance access.';
