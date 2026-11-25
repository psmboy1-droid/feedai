import type { Metadata } from 'next';
import { publicSeo } from '../lib/seo-settings';
import { seoMetadata } from '../lib/seo-config';
import './globals.css';
import { VisitTracker } from '../components/visit-tracker';
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
      <head>
        {process.env.NODE_ENV === 'production' && (
          <>
            <script
              async
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
            />
            <script
              dangerouslySetInnerHTML={{
                __html: `
                  window.dataLayer = window.dataLayer || [];
                  function gtag(){dataLayer.push(arguments);}
                  gtag('js', new Date());
                  gtag('config', '${GA_MEASUREMENT_ID}');
                `,
              }}
            />
          </>
        )}
      </head>
      <body>
        <VisitTracker />
        <NewsAccountProvider>
          <WorkspaceShell>{children}</WorkspaceShell>
        </NewsAccountProvider>
      </body>
    </html>
  );
}
