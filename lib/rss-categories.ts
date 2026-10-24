import {getDb} from '../db';
import {sharedCategories} from '../db/schema';
import {catalogCategories} from './shared-catalog';
import {asc} from 'drizzle-orm';
import {categoryKey} from './category-names';
export {categoryName,categoryKey} from './category-names';
export async function categoryConfig(){
 const rows=await getDb().select().from(sharedCategories).orderBy(asc(sharedCategories.createdAt),asc(sharedCategories.name));
 const active=new Map<string,string>(catalogCategories.map(n=>[categoryKey(n),n]));
 for(const r of rows){if(r.deleted)active.delete(r.key);else active.set(r.key,r.name)}
 const redirects=new Map(rows.filter(r=>r.deleted).map(r=>[r.key,r.replacement]));
 const mapping:Record<string,string>=Object.create(null);
 for(const key of [...active.keys(),...redirects.keys()]){let current=key;const seen=new Set<string>();while(redirects.has(current)&&!seen.has(current)){seen.add(current);current=categoryKey(redirects.get(current)!)}mapping[key]=active.get(current)||[...active.values()][0]||'종합'}
 return {categories:[...active.values()],mapping};
}
export async function listCategories(){return (await categoryConfig()).categories}
