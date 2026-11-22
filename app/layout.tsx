import type { Metadata } from 'next';
import Script from 'next/script';
import { publicSeo } from '../lib/seo-settings';
import { seoMetadata } from '../lib/seo-config';
import './globals.css';
import { NewsAccountProvider } from '../components/news-account';
import WorkspaceShell from '../components/workspace-shell';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return seoMetadata(await publicSeo());
}

const GA_MEASUREMENT_ID = 'G-ZJYBHCY1MV';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        {process.env.NODE_ENV === 'production' && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
              strategy="afterInteractive"
            />
            <Script id="google-analytics" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${GA_MEASUREMENT_ID}');
              `}
            </Script>
          </>
        )}
        <NewsAccountProvider>
          <WorkspaceShell>{children}</WorkspaceShell>
        </NewsAccountProvider>
      </body>
    </html>
  );
}
