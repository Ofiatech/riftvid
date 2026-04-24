import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
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
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: '#8b5cf6',
          colorBackground: '#0a0a0b',
          colorInputBackground: '#141821',
          colorInputText: '#f5f5f7',
          colorText: '#f5f5f7',
          colorTextSecondary: '#a1a1aa',
          colorNeutral: '#f5f5f7',
          borderRadius: '0.75rem',
        },
        elements: {
          card: 'bg-[#0a0a0b] border border-[#1f2937] shadow-2xl',
          headerTitle: 'text-white',
          headerSubtitle: 'text-zinc-400',
          socialButtonsBlockButton: 'border-[#1f2937] hover:bg-white/[0.03]',
          formButtonPrimary: 'bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 shadow-lg shadow-purple-500/30',
          footerActionLink: 'text-purple-400 hover:text-purple-300',
        },
      }}
    >
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}