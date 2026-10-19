import type { CredentialRow } from './lib';

/** The parts of a login that are not secret. They are visible to everyone the login is shared with. */
export function CredentialFields({ c, categories, idPrefix = 'cred' }: { c?: CredentialRow; categories: string[]; idPrefix?: string }) {
  const id = (f: string) => `${idPrefix}-${f}`;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label className="label" htmlFor={id('name')}>Name</label>
        <input id={id('name')} name="name" className="input" required maxLength={120} defaultValue={c?.name} placeholder="Amazon Seller Central" />
      </div>
      <div>
        <label className="label" htmlFor={id('category')}>Category</label>
        <input id={id('category')} name="category" className="input" maxLength={60} defaultValue={c?.category} list={id('categories')} placeholder="Marketplaces, Banking, Social…" />
        <datalist id={id('categories')}>
          {categories.map((x) => <option key={x} value={x} />)}
        </datalist>
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor={id('url')}>Website</label>
        <input id={id('url')} name="url" type="url" className="input" maxLength={2000} defaultValue={c?.url} placeholder="https://…" />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor={id('username')}>Username or email</label>
        <input id={id('username')} name="username" className="input" maxLength={200} defaultValue={c?.username} autoComplete="off" />
      </div>
    </div>
  );
}
