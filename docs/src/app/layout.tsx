import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Provider } from '@/components/provider';
import './global.css';

const inter = Inter({
  subsets: ['latin'],
});

// Only affects absolute-URL resolution for OG/Twitter meta tags — the app
// itself is also served from historical-satellite.iconem.com, but there's no
// single "canonical" domain to prefer over the other for this purpose.
export const metadata: Metadata = {
  metadataBase: new URL('https://terrain-viewer.iconem.com/docs/'),
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
