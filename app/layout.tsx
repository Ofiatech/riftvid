import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Riftvid — AI Video Studio',
  description: 'Generate, translate, and remix video with AI.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}