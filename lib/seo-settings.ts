import {eq} from 'drizzle-orm';
import {getDb} from '../db';
import {seoSettings} from '../db/schema';
import {defaultSeo,seoSchema,type SeoSettings} from './seo-config';
export async function readSeo(){const [row]=await getDb().select().from(seoSettings).where(eq(seoSettings.id,'site'));return {settings:row?seoSchema.parse(JSON.parse(row.settings)):defaultSeo,updatedAt:row?.updatedAt||null}}
export async function publicSeo(){try{return (await readSeo()).settings}catch{return defaultSeo}}
export async function saveSeo(settings:SeoSettings){const now=new Date().toISOString();await getDb().insert(seoSettings).values({id:'site',settings:JSON.stringify(settings),updatedAt:now}).onConflictDoUpdate({target:seoSettings.id,set:{settings:JSON.stringify(settings),updatedAt:now}});return now}
