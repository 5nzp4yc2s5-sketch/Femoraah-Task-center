import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'OpsPulse Workspace', template: '%s · OpsPulse' },
  description: 'Team task command center',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#1f3a5f', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
