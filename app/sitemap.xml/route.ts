import {publicSeo} from '../../lib/seo-settings';
import {sitemapText} from '../../lib/seo-config';
export const dynamic='force-dynamic';
export async function GET(){return new Response(sitemapText(await publicSeo()),{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'no-store'}})}
