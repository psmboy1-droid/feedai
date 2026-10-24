import type { Metadata } from 'next';
import {publicSeo} from '../lib/seo-settings';
import {seoMetadata} from '../lib/seo-config';
import './globals.css';
import {NewsAccountProvider} from '../components/news-account';
import WorkspaceShell from '../components/workspace-shell';
export const dynamic='force-dynamic';
export async function generateMetadata():Promise<Metadata>{return seoMetadata(await publicSeo())}
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="ko"><body><NewsAccountProvider><WorkspaceShell>{children}</WorkspaceShell></NewsAccountProvider></body></html>}
