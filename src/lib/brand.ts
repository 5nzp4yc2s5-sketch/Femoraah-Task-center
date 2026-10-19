import 'server-only';
import { cache } from 'react';
import { createClient } from './supabase/server';
import { HEX, primaryScale } from './colors';

export interface Brand {
  companyName: string;
  tagline: string;
  /** What the admin typed (null when not set). */
  savedName: string | null;
  savedTagline: string | null;
  /** Only the colours the admin set; unset ones keep the default look. */
  primary: string | null;
  secondary: string | null;
  accent: string | null;
  logoUrl: string | null;
  /** True when the admin has saved any branding (the app then uses the company name). */
  custom: boolean;
}

const DEFAULT_NAME = 'OpsPulse Workspace';
const DEFAULT_TAGLINE = 'Team task command center';

const color = (v: unknown) => (typeof v === 'string' && HEX.test(v) ? v : null);

/** The company profile, readable before sign-in. Falls back to the default look on any error. */
export const getBrand = cache(async (): Promise<Brand> => {
  let row: Record<string, unknown> = {};
  try {
    const supabase = await createClient();
    const { data } = await supabase.rpc('brand_settings');
    if (data && typeof data === 'object') row = data as Record<string, unknown>;
  } catch {
    // Keep the default look rather than breaking every page.
  }
  const name = typeof row.company_name === 'string' && row.company_name ? row.company_name : null;
  const tagline = typeof row.tagline === 'string' && row.tagline ? row.tagline : null;
  const version = typeof row.logo_version === 'number' ? row.logo_version : null;
  const brand: Brand = {
    companyName: name ?? DEFAULT_NAME,
    tagline: tagline ?? DEFAULT_TAGLINE,
    savedName: name,
    savedTagline: tagline,
    primary: color(row.primary),
    secondary: color(row.secondary),
    accent: color(row.accent),
    logoUrl: version ? `/brand/logo?v=${version}` : null,
    custom: false,
  };
  brand.custom = Boolean(name || tagline || brand.primary || brand.secondary || brand.accent || brand.logoUrl);
  return brand;
});

/** CSS that swaps the theme colours for the brand colours. Empty when nothing is set. */
export function brandCss(b: Brand): string {
  const vars: string[] = [];
  if (b.primary) {
    for (const [shade, hex] of Object.entries(primaryScale(b.primary))) vars.push(`--color-navy-${shade}:${hex}`);
  }
  if (b.secondary) vars.push(`--color-sidebar:${b.secondary}`);
  if (b.accent) vars.push(`--color-accent:${b.accent}`);
  return vars.length ? `:root{${vars.join(';')}}` : '';
}

/** The menu's brand block: "OpsPulse / Workspace" until the admin names the company. */
export function sidebarBrand(b: Brand) {
  return {
    name: b.companyName,
    short: b.savedName ?? 'OpsPulse',
    tagline: b.savedTagline ?? 'Workspace',
    mark: initials(b.companyName),
    logoUrl: b.logoUrl,
  };
}

/** Two-letter mark for when there is no logo. */
export function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (name === DEFAULT_NAME) return 'OP';
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
}
