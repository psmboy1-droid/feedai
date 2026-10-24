import {publicSeo} from '../../lib/seo-settings';
import {robotsText} from '../../lib/seo-config';
export const dynamic='force-dynamic';
export async function GET(){return new Response(robotsText(await publicSeo()),{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}})}
