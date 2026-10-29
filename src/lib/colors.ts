// Colour helpers for company branding: shades of a brand colour and WCAG contrast checks.
// Shared by the server (to build the theme and validate saves) and the settings preview.

export const HEX = /^#[0-9a-f]{6}$/;

/** The default look: the colours the app had before branding existed. */
export const DEFAULT_BRAND = { primary: '#1f3a5f', secondary: '#1f3a5f', accent: '#3a5f90' } as const;

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}

/** Mix a colour with another; amount 0 = first colour, 1 = second. */
export function mix(hex: string, other: string, amount: number): string {
  const a = rgb(hex);
  const b = rgb(other);
  return toHex([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * amount) as [number, number, number]);
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours (1 to 21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The shades of the primary colour that the theme uses (the 800 shade is the colour itself). */
export function primaryScale(primary: string) {
  return {
    950: mix(primary, '#000000', 0.5),
    900: mix(primary, '#000000', 0.3),
    800: primary,
    700: mix(primary, '#ffffff', 0.1),
    600: mix(primary, '#ffffff', 0.2),
    100: mix(primary, '#ffffff', 0.88),
    50: mix(primary, '#ffffff', 0.95),
  };
}

export interface ContrastCheck {
  key: 'primary' | 'secondary' | 'accent';
  label: string;
  ratio: number;
  needed: number;
  ok: boolean;
}

/**
 * Readability rules: white text must be readable on the primary colour (buttons) and its link
 * shade must read on white, white text on the secondary colour (the selected menu item), and
 * the accent must stand out from a white page.
 */
export function brandChecks(c: { primary: string; secondary: string; accent: string }): ContrastCheck[] {
  const link = primaryScale(c.primary)[700];
  const primaryRatio = Math.min(contrast('#ffffff', c.primary), contrast('#ffffff', link));
  return [
    { key: 'primary', label: 'White text on buttons, and links on white', ratio: primaryRatio, needed: 4.5, ok: primaryRatio >= 4.5 },
    { key: 'secondary', label: 'White text on the selected menu item', ratio: contrast('#ffffff', c.secondary), needed: 4.5, ok: contrast('#ffffff', c.secondary) >= 4.5 },
    { key: 'accent', label: 'Accent against a white page', ratio: contrast('#ffffff', c.accent), needed: 3, ok: contrast('#ffffff', c.accent) >= 3 },
  ];
}
