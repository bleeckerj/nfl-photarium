import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from '@/components/Toast';

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
      <body className="overscroll-none" suppressHydrationWarning>
        <ToastProvider>
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
