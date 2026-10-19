import type { Metadata, Viewport } from 'next';
import { brandCss, getBrand } from '@/lib/brand';
import { DEFAULT_BRAND } from '@/lib/colors';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  const short = brand.savedName ?? 'OpsPulse';
  return {
    title: { default: brand.companyName, template: `%s · ${short}` },
    description: brand.tagline,
    robots: { index: false, follow: false },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const brand = await getBrand();
  return { themeColor: brand.secondary ?? DEFAULT_BRAND.secondary, width: 'device-width', initialScale: 1 };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const css = brandCss(await getBrand());
  return (
    <html lang="en">
      {/* Brand colours replace the theme's; the values are validated hex codes. */}
      {css && (
        <head>
          <style>{css}</style>
        </head>
      )}
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
