import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ToastProvider } from '@/components/Toast';

const warbler = localFont({
  src: '../../fonts/warbler/WarblerDisplayV1.2-Regular.woff2',
  display: 'swap',
});

const ibm3270 = localFont({
  src: '../../fonts/3270/3270NerdFontMono-Regular.woff2',
  display: 'swap',
  variable: '--font-3270',
});

export const metadata: Metadata = {
  title: "Photarium",
  description: "An elegant image management platform powered by Cloudflare Images",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="overscroll-none">
      <body className={`overscroll-none ${ibm3270.variable}`} suppressHydrationWarning>
        <header className="px-6 py-2 border-b border-stone-200 bg-[#f9f7f4] sticky top-0 z-50 flex items-center justify-between">
          <a href="https://bleeckerj.github.io/nfl-photarium/" className={`${warbler.className} text-xl text-stone-900 pt-1 hover:text-stone-600 transition-colors`}>Photarium</a>
          <div className="flex items-center gap-4">
            <span className="text-xs text-stone-500 font-mono hidden sm:inline-block">From Near Future Laboratory Tooling and Flow Maintenance Dept.</span>
            <img 
              src="https://imagedelivery.net/gaLGizR3kCgx5yRLtiRIOw/aec92db4-b882-4ea0-cf93-22ca12501a00/public?format=webp" 
              alt="Near Future Laboratory" 
              className="h-10 w-auto opacity-80 mix-blend-multiply"
            />
          </div>
        </header>
        <ToastProvider>
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
