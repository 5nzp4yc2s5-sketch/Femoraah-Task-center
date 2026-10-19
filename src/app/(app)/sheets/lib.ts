export interface SheetRow {
  id: string;
  name: string;
  purpose: string;
  category: string;
  team_id: string | null;
  owner_id: string | null;
  people: string[];
  url: string;
  visibility: 'everyone' | 'assigned';
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
  archived_by: string | null;
  archived_at: string | null;
}

/** Same rule the database enforces: a full Google Sheets link, nothing else. */
export const SHEET_URL = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{20,}([/?#][^\s<>"'\\]*)?$/;

export const SHEET_URL_HELP = 'Paste the full Google Sheets link, starting with https://docs.google.com/spreadsheets/d/';

export const SHEET_SORTS = [
  { key: 'name', label: 'Sort: sheet name' },
  { key: 'updated', label: 'Sort: last updated' },
  { key: 'owner', label: 'Sort: responsible' },
  { key: 'team', label: 'Sort: team' },
  { key: 'category', label: 'Sort: category' },
] as const;

/** The calendar day of a timestamp in the viewer's time zone, as YYYY-MM-DD. */
export function localDay(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}
