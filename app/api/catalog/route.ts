import {resolveCategory} from '../../../lib/category-names';
import {categoryConfig,listCategories} from '../../../lib/rss-categories';
import {getDb} from '../../../db';
import {sharedFeeds} from '../../../db/schema';
import {isRssAdmin} from '../../../lib/rss-admin';
import {mergeCatalog,canonicalUrl,catalogCategories} from '../../../lib/shared-catalog';
import {GET as checkFeed} from '../feed/route';
import {and,eq} from 'drizzle-orm';
import {z} from 'zod';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}});
const schema=z.object({id:z.string().min(1).max(100).optional(),revision:z.number().int().nonnegative().optional(),name:z.string().trim().min(1).max(120),url:z.string().trim().max(4000).url().refine(s=>/^https?:\/\//i.test(s)),country:z.string().trim().min(1).max(60),category:z.string().trim().min(1).max(100),language:z.string().trim().min(1).max(60),kind:z.enum(['언론사 RSS','블로그·커뮤니티','공공기관 RSS','뉴스 모음','기타 RSS']),enabled:z.boolean()});
export async function GET(req:Request){try{const admin=await isRssAdmin();if(new URL(req.url).searchParams.get('manage')==='1'&&!admin)return reply({error:'관리자 계정으로 로그인해 주세요.'},403);const config=await categoryConfig();const items=mergeCatalog(await getDb().select().from(sharedFeeds)).map(f=>({...f,category:resolveCategory(f.category,config.mapping)}));return reply({admin,categories:await listCategories(),items:admin&&new URL(req.url).searchParams.get('manage')==='1'?items:items.filter(f=>f.enabled)})}catch{return reply({error:'공용 목록을 불러오지 못했습니다. 다시 시도해 주세요.'},503)}}
async function save(req:Request,editing:boolean){
 if(!await isRssAdmin())return reply({error:'관리자만 공용 목록을 변경할 수 있습니다.'},403);
 if(req.headers.get('origin')!==new URL(req.url).origin)return reply({error:'허용되지 않은 요청입니다.'},403);
 try{const raw=await req.text();if(raw.length>12000)return reply({error:'입력이 너무 깁니다.'},413);const p=schema.safeParse(JSON.parse(raw));if(!p.success)return reply({error:'이름·RSS 주소·국가·카테고리·언어를 확인해 주세요.'},400);const data=p.data;if(!(await listCategories()).includes(data.category))return reply({error:'등록된 카테고리를 선택해 주세요.'},400);const db=getDb();const rows=await db.select().from(sharedFeeds);const list=mergeCatalog(rows);const old=editing?list.find(f=>f.id===data.id):undefined;if(editing&&!old)return reply({error:'소스를 찾을 수 없습니다.'},404);if(editing&&data.revision!==old?.revision)return reply({error:'목록이 변경되었습니다. 새로고침 후 다시 수정해 주세요.'},409);
 const url=canonicalUrl(data.url);if(list.some(f=>f.id!==old?.id&&canonicalUrl(f.url)===url))return reply({error:'이미 공용 목록에 등록된 RSS 주소입니다. 기존 항목을 수정해 주세요.'},409);
 const restored=!editing?rows.find(f=>f.deleted&&canonicalUrl(f.url)===url):undefined;const stored=old||restored;
 let verifiedAt=old?.verifiedAt||'',itemCount=old?.itemCount||0;
 if(data.enabled){const checked=await checkFeed(new Request('https://internal.example/api/feed?url='+encodeURIComponent(url)));const result:any=await checked.json();if(!checked.ok||!result.items?.length)return reply({error:result.error||'현재 읽을 수 있는 기사가 없는 피드입니다.'},400);verifiedAt=new Date().toISOString();itemCount=result.items.length;}
 const item={...data,id:stored?.id||crypto.randomUUID(),deleted:false,url,verifiedAt,itemCount,revision:(stored?.revision||0)+1};
 if(rows.some(f=>f.id===stored?.id)){const updated=await db.update(sharedFeeds).set(item).where(and(eq(sharedFeeds.id,item.id),eq(sharedFeeds.revision,stored!.revision))).returning({id:sharedFeeds.id});if(!updated.length)return reply({error:'다른 수정이 저장되었습니다. 새로고침해 주세요.'},409)}else{await db.insert(sharedFeeds).values(item)}
 return reply({item},editing?200:201);
 }catch(e){if(String(e).includes('UNIQUE'))return reply({error:'동일 소스가 이미 등록되었습니다. 목록을 새로고침해 주세요.'},409);return reply({error:'저장하지 못했습니다. 입력 내용을 확인하고 다시 시도해 주세요.'},503)}
}
export async function POST(req:Request){return save(req,false)}
export async function PUT(req:Request){return save(req,true)}

export async function DELETE(req:Request){
 if(!await isRssAdmin())return reply({error:'관리자만 공용 목록을 변경할 수 있습니다.'},403);
 if(req.headers.get('origin')!==new URL(req.url).origin)return reply({error:'허용되지 않은 요청입니다.'},403);
 try{
  const raw=await req.text();if(raw.length>1000)return reply({error:'입력이 너무 깁니다.'},413);
  const p=z.object({id:z.string().min(1).max(100),revision:z.number().int().nonnegative()}).safeParse(JSON.parse(raw));
  if(!p.success)return reply({error:'삭제할 소스를 확인해 주세요.'},400);
  const db=getDb(),rows=await db.select().from(sharedFeeds),old=mergeCatalog(rows).find(f=>f.id===p.data.id);
  if(!old)return reply({error:'이미 삭제되었거나 소스를 찾을 수 없습니다.'},404);
  if(old.revision!==p.data.revision)return reply({error:'목록이 변경되었습니다. 새로고침 후 다시 삭제해 주세요.'},409);
  const item={...old,enabled:false,deleted:true,revision:old.revision+1};
  if(rows.some(f=>f.id===old.id)){
   const updated=await db.update(sharedFeeds).set(item).where(and(eq(sharedFeeds.id,old.id),eq(sharedFeeds.revision,old.revision))).returning({id:sharedFeeds.id});
   if(!updated.length)return reply({error:'목록이 변경되었습니다. 새로고침 후 다시 삭제해 주세요.'},409);
  }else{await db.insert(sharedFeeds).values(item)}
  return reply({id:old.id});
 }catch(e){if(String(e).includes('UNIQUE'))return reply({error:'목록이 변경되었습니다. 새로고침 후 다시 삭제해 주세요.'},409);return reply({error:'삭제하지 못했습니다. 다시 시도해 주세요.'},503)}
}
