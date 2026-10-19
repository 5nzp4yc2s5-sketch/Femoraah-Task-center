import { requireArea } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { getBrand } from '@/lib/brand';
import { DEFAULT_BRAND } from '@/lib/colors';
import { friendlyError } from '@/lib/format';
import { ActionForm, ConfirmAction, SubmitButton } from '@/components/forms';
import { Notice, PageHeader, SectionTitle } from '@/components/ui';
import { SettingsTabs } from '../tabs';
import { removeLogoAction, resetBrandingAction, uploadLogoAction } from '../company-actions';
import { BrandingForm } from './branding-form';

export const metadata = { title: 'Company & branding' };

interface ProfileRow {
  company_name: string | null;
  tagline: string | null;
  brand_primary: string | null;
  brand_secondary: string | null;
  brand_accent: string | null;
  updated_at: string;
}

export default async function CompanySettingsPage() {
  const me = await requireArea('settings');
  const supabase = await createClient();
  const [{ data, error }, brand] = await Promise.all([
    supabase.from('company_profile').select('company_name, tagline, brand_primary, brand_secondary, brand_accent, updated_at').maybeSingle(),
    getBrand(),
  ]);
  const p = data as ProfileRow | null;

  return (
    <>
      <PageHeader title="Settings" subtitle="Your company's name, logo and colours. Everyone sees them, including on the sign-in page." />
      <SettingsTabs current="/settings/company" areas={me.areas} />
      {error && <Notice tone="error">Could not load the company settings: {friendlyError(error.message)}</Notice>}

      <SectionTitle>Name and colours</SectionTitle>
      <BrandingForm
        initial={{
          company_name: p?.company_name ?? '',
          tagline: p?.tagline ?? '',
          primary: p?.brand_primary ?? DEFAULT_BRAND.primary,
          secondary: p?.brand_secondary ?? DEFAULT_BRAND.secondary,
          accent: p?.brand_accent ?? DEFAULT_BRAND.accent,
        }}
        logoUrl={brand.logoUrl}
      />
      {brand.custom && (
        <div className="mt-3">
          <ConfirmAction
            action={resetBrandingAction}
            label="Restore the original look"
            title="Restore the original name and colours?"
            body="The app goes back to the OpsPulse name and navy colours. Your logo stays; remove it separately below."
            confirmLabel="Restore"
            className="btn-secondary"
          />
        </div>
      )}

      <SectionTitle>Logo</SectionTitle>
      <div className="card flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-line bg-white">
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt="Current logo" className="max-h-16 max-w-16 object-contain" />
          ) : (
            <span className="text-xs text-slate-400">No logo</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <ActionForm action={uploadLogoAction} resetOnSuccess className="space-y-3">
            <div>
              <label className="label" htmlFor="logo">Upload a logo</label>
              <input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" required className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-navy-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-navy-900 hover:file:bg-navy-50" />
              <p className="mt-1 text-xs text-slate-500">PNG, JPEG or WebP, up to 300 KB. A square image works best. SVG files are not accepted for security.</p>
            </div>
            <SubmitButton pendingText="Uploading…">Save logo</SubmitButton>
          </ActionForm>
          {brand.logoUrl && (
            <div className="mt-3">
              <ConfirmAction
                action={removeLogoAction}
                label="Remove logo"
                title="Remove the logo?"
                body="The menu and sign-in page show the company initials instead. You can upload a logo again at any time."
                confirmLabel="Remove"
                className="btn-secondary"
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
