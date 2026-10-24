import {getDb} from '../db';
import {DOPAMINE_HOUR,fetchYoutubeFeed,type FeedVideo,type DopamineVideo} from './dopamine-feed';
export type DopamineSource={id:string;name:string;url:string;country:string;kind:string;enabled:number;revision:number;last_checked_at:number;next_check_at:number;lock_id:string;lock_until:number;error:string;created_at:number};
export async function saveFeedVideos(source:DopamineSource,items:FeedVideo[],claim:string){const db=getDb().$client,now=Date.now();
 const writes=items.map(v=>db.prepare("INSERT INTO dopamine_videos(id,source_id,video_id,title,channel,published_at,kind) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM dopamine_sources WHERE id=? AND lock_id=? AND enabled=1) ON CONFLICT(id) DO UPDATE SET title=excluded.title,channel=excluded.channel,published_at=excluded.published_at,kind=excluded.kind").bind(source.id+':'+v.videoId,source.id,v.videoId,v.title,v.channel,v.publishedAt,v.kind,source.id,claim));
 writes.push(db.prepare("DELETE FROM dopamine_videos WHERE source_id=? AND id NOT IN (SELECT id FROM dopamine_videos WHERE source_id=? ORDER BY published_at DESC LIMIT 120)").bind(source.id,source.id));
 writes.push(db.prepare("UPDATE dopamine_sources SET last_checked_at=?,next_check_at=?,error='',lock_until=0 WHERE id=? AND lock_id=? AND enabled=1").bind(now,now+DOPAMINE_HOUR,source.id,claim));
 await db.batch(writes);
}
export async function refreshDopamineSource(source:DopamineSource,force=false){const db=getDb().$client,now=Date.now(),claim=crypto.randomUUID();
 const locked=await db.prepare('UPDATE dopamine_sources SET lock_id=?,lock_until=? WHERE id=? AND enabled=1 AND lock_until<? AND (?=1 OR next_check_at<=?) RETURNING id').bind(claim,now+30000,source.id,now,force?1:0,now).first();if(!locked)return;
 try{await saveFeedVideos(source,await fetchYoutubeFeed(source.url),claim)}catch(e){await db.prepare('UPDATE dopamine_sources SET error=?,next_check_at=?,lock_until=0 WHERE id=? AND lock_id=?').bind(e instanceof Error?e.message:'피드 수집 실패',now+300000,source.id,claim).run()}
}
let localRefresh:Promise<void>|null=null;
export async function refreshDueDopamine(country:string){if(localRefresh)return localRefresh;localRefresh=(async()=>{const rows=await getDb().$client.prepare('SELECT * FROM dopamine_sources WHERE enabled=1 AND country=? AND next_check_at<=? AND lock_until<? ORDER BY next_check_at,id LIMIT 6').bind(country,Date.now(),Date.now()).all<DopamineSource>();for(let i=0;i<rows.results.length;i+=3)await Promise.all(rows.results.slice(i,i+3).map(s=>refreshDopamineSource(s)))})();try{await localRefresh}finally{localRefresh=null}}
export async function dopamineListing(country:string){const db=getDb().$client;const rows=await db.prepare("SELECT v.id,v.source_id AS sourceId,v.video_id AS videoId,v.title,v.channel,v.published_at AS publishedAt,CASE WHEN v.override_kind!='' THEN v.override_kind WHEN s.kind!='auto' THEN s.kind ELSE v.kind END AS kind FROM dopamine_videos v JOIN dopamine_sources s ON s.id=v.source_id WHERE s.enabled=1 AND s.country=? ORDER BY v.published_at DESC,v.id LIMIT 360").bind(country).all<DopamineVideo>();
 const seen=new Set<string>(),videos=rows.results.filter(v=>{if(seen.has(v.videoId))return false;seen.add(v.videoId);return true});
 const status=await db.prepare('SELECT COUNT(*) AS sourceCount,COALESCE(MAX(last_checked_at),0) AS checkedAt,COALESCE(MIN(next_check_at),0) AS nextCheckAt,SUM(CASE WHEN error!=\'\' THEN 1 ELSE 0 END) AS failedSources FROM dopamine_sources WHERE enabled=1 AND country=?').bind(country).first();const pending=await db.prepare('SELECT COUNT(*) AS pendingSources FROM dopamine_sources WHERE enabled=1 AND country=? AND next_check_at<=?').bind(country,Date.now()).first();return {videos,...status,...pending};
}
