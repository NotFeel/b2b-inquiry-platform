import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Back office',
  description: 'Catalogue, inquiry and document administration.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
