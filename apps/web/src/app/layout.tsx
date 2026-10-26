import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { APP_NAME, APP_TAGLINE } from '@nidhisetu/shared';
import './globals.css';

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_TAGLINE,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
