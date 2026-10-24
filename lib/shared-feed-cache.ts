import {isRecentFeedArticle} from './feed-window';
import {getDb} from '../db';
const pending=new Map<string,Promise<Response>>();
let hotBytes=0;
const hot=new Map<string,{until:number;payload:string}>();
const response=(payload:string)=>{const data=JSON.parse(payload);if(Array.isArray(data.items))data.items=data.items.filter((article:{date:string|null})=>isRecentFeedArticle(article));const status=data.__httpStatus||200;delete data.__httpStatus;return Response.json(data,{status,headers:{'Cache-Control':'private, max-age=60'}})};
export async function sharedFeed(raw:string,load:()=>Promise<Response>,ttl=300000):Promise<Response>{
 const url=new URL(raw);url.hash='';const key=url.href;
 const hit=hot.get(key);if(hit&&hit.until>Date.now())return response(hit.payload);
 const existing=pending.get(key);if(existing)return (await existing).clone();
 const task=(async()=>{const db=getDb().$client,now=Date.now();
 const row=await db.prepare('SELECT * FROM feed_cache WHERE url=?').bind(key).first<{payload:string;expires_at:number}>();
 const remember=(payload:string,expires:number)=>{const previous=hot.get(key);if(previous){hotBytes-=previous.payload.length*2;hot.delete(key)}while(hot.size&&(hot.size>=500||hotBytes+payload.length*2>8*1024*1024)){const oldest=hot.keys().next().value!;hotBytes-=hot.get(oldest)!.payload.length*2;hot.delete(oldest)}hotBytes+=payload.length*2;hot.set(key,{payload,until:Math.min(expires,Date.now()+60000)});return response(payload)};
 if(row?.payload&&row.expires_at>now)return remember(row.payload,row.expires_at);
 const lock=crypto.randomUUID();await db.prepare("INSERT INTO feed_cache (url,lock_id,lock_until) VALUES (?,?,?) ON CONFLICT(url) DO UPDATE SET lock_id=excluded.lock_id,lock_until=excluded.lock_until WHERE feed_cache.lock_until<? AND feed_cache.expires_at<?").bind(key,lock,now+60000,now,now).run();
 const claimed=await db.prepare('SELECT lock_id FROM feed_cache WHERE url=?').bind(key).first<{lock_id:string}>();
 if(claimed?.lock_id!==lock){if(row?.payload&&row.expires_at>now-1800000)return remember(row.payload,now+5000);
 for(let i=0;i<5;i++){await new Promise(r=>setTimeout(r,200));const fresh=await db.prepare('SELECT payload,expires_at FROM feed_cache WHERE url=?').bind(key).first<{payload:string;expires_at:number}>();if(fresh?.payload&&fresh.expires_at>Date.now())return remember(fresh.payload,fresh.expires_at)}
 return Response.json({error:'피드를 수집 중입니다. 잠시 후 다시 시도해 주세요.'},{status:503,headers:{'Retry-After':'5'}})}
 try{const result=await load();if(!result.ok){if(row?.payload&&row.expires_at>now-1800000){await db.prepare('UPDATE feed_cache SET expires_at=?,lock_until=0 WHERE url=? AND lock_id=?').bind(now+30000,key,lock).run();return remember(row.payload,now+30000)}const payload=JSON.stringify({...(await result.json() as Record<string,unknown>),__httpStatus:result.status});await db.prepare('UPDATE feed_cache SET payload=?,expires_at=? WHERE url=? AND lock_id=?').bind(payload,now+30000,key,lock).run();return remember(payload,now+30000)}
 const payload=await result.text(),expires=Date.now()+ttl;await db.prepare('UPDATE feed_cache SET payload=?,expires_at=?,lock_until=0 WHERE url=? AND lock_id=?').bind(payload,expires,key,lock).run();return remember(payload,expires);
 }finally{await db.prepare('UPDATE feed_cache SET lock_until=0 WHERE url=? AND lock_id=?').bind(key,lock).run()}
 })();pending.set(key,task);try{return (await task).clone()}finally{pending.delete(key)}
}
