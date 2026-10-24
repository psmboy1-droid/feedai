import {getDb} from '../db';
import {resolveApiKey} from './ai-key';
type Job={id:string;owner:string;status:string;body:string;upstream_id:string;response:string;created_at:number;started_at:number;check_after:number;lease_until:number};
const terminal=['completed','failed','cancelled','incomplete'];
function limit(name:string,fallback:number,max:number){const n=Number(process.env[name]);return Number.isInteger(n)&&n>0?Math.min(n,max):fallback}
async function upstream(path:string,body?:unknown){const key=await resolveApiKey();const r=await fetch('https://api.openai.com/v1/responses'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'manual',signal:AbortSignal.timeout(25000)});if(!r.ok){await r.body?.cancel();const error=Object.assign(Error('AI 서비스 응답 오류 ('+r.status+')'),{definitive:true});throw error}return r.json() as Promise<any>}
const failed=(id:string)=>({id,status:'failed',error:{message:'AI 요청이 실패했거나 처리 시간을 초과했습니다.'}});
let nextDispatch=0;
async function maintain(){const db=getDb().$client,now=Date.now();if(now<nextDispatch)return;nextDispatch=now+1000;
 const gate=crypto.randomUUID();await db.prepare("INSERT INTO feed_cache(url,lock_id,lock_until) VALUES ('internal:ai-dispatch',?,?) ON CONFLICT(url) DO UPDATE SET lock_id=excluded.lock_id,lock_until=excluded.lock_until WHERE feed_cache.lock_until<?").bind(gate,now+1000,now).run();const lease=await db.prepare("SELECT lock_id FROM feed_cache WHERE url='internal:ai-dispatch'").first<{lock_id:string}>();if(lease?.lock_id!==gate)return;
 const due=await db.prepare("SELECT * FROM ai_queue WHERE status IN ('in_progress','queued_upstream') AND check_after<=? AND lease_until<? ORDER BY check_after LIMIT 2").bind(now,now).all<Job>();for(const job of due.results)await check(job);
 await db.prepare("UPDATE ai_queue SET status='cancelled',body='' WHERE status='waiting' AND owner IN (SELECT user_id FROM news_accounts WHERE deleted_at!='')").run();
 // Uncertain starts retain their slot until an operator reconciles them: never silently retry a potentially accepted API request.
 await db.prepare("UPDATE ai_queue SET status='uncertain',body='' WHERE status='starting' AND started_at<?").bind(now-1800000).run();
 await db.prepare("UPDATE ai_queue SET status='failed',body='' WHERE status='waiting' AND created_at<?").bind(now-3600000).run();
 await db.prepare("DELETE FROM ai_queue WHERE id IN (SELECT id FROM ai_queue WHERE status IN ('completed','failed','cancelled','incomplete') AND created_at<? LIMIT 20)").bind(now-7*86400000).run();
 const candidate=await db.prepare("SELECT id FROM ai_queue WHERE status='waiting' AND (EXISTS (SELECT 1 FROM analysis_requests WHERE job_id=ai_queue.id AND user_id=ai_queue.owner AND status!='refunded') OR EXISTS (SELECT 1 FROM today_briefs WHERE job_id=ai_queue.id AND user_id=ai_queue.owner)) ORDER BY created_at,id LIMIT 1").first<{id:string}>();if(!candidate)return;
 const claim=await db.prepare("UPDATE ai_queue SET status='starting',started_at=?,lease_until=? WHERE id=? AND status='waiting' AND (SELECT COUNT(*) FROM ai_queue WHERE status IN ('starting','in_progress','queued_upstream','uncertain'))<? AND (SELECT COUNT(*) FROM ai_queue WHERE started_at>?)<? RETURNING *").bind(now,now+30000,candidate.id,limit('AI_MAX_CONCURRENT',10,100),now-60000,limit('AI_STARTS_PER_MINUTE',20,1000)).first<Job>();if(!claim)return;
 try{const data=await upstream('',JSON.parse(claim.body));if(!/^resp_[a-zA-Z0-9_-]{1,200}$/.test(data.id||''))throw Error('Invalid AI response');await db.prepare("UPDATE ai_queue SET status=?,upstream_id=?,response=CASE WHEN EXISTS (SELECT 1 FROM news_accounts WHERE user_id=ai_queue.owner AND deleted_at!='') THEN '' ELSE ? END,body=?,check_after=?,lease_until=0 WHERE id=?").bind(terminal.includes(data.status)?data.status:data.status==='queued'?'queued_upstream':'in_progress',data.id,JSON.stringify(data),'',Date.now()+15000,claim.id).run()}
 catch(e){const definitive=Boolean((e as {definitive?:boolean}).definitive);await db.prepare('UPDATE ai_queue SET status=?,response=?,body=? WHERE id=?').bind(definitive?'failed':'starting',JSON.stringify(definitive?failed(claim.id):{id:claim.id,status:'in_progress'}),'',claim.id).run()}
}
export async function queuedAi(owner:string,path:string,body?:unknown){const db=getDb().$client;
 if(body){const id='queue_'+crypto.randomUUID().replaceAll('-','');const admitted=await db.prepare("INSERT INTO ai_queue (id,owner,status,body,created_at) SELECT ?,?,'waiting',?,? WHERE (SELECT COUNT(*) FROM ai_queue WHERE status='waiting')<1000 AND (SELECT COUNT(*) FROM ai_queue WHERE owner=? AND status IN ('waiting','starting','in_progress','queued_upstream'))<2 RETURNING id").bind(id,owner,JSON.stringify(body),Date.now(),owner).first();if(!admitted)throw Error('AI 대기열이 가득 찼거나 진행 중인 요청이 있습니다. 잠시 후 다시 시도해 주세요.');return {id,status:'queued',created_at:Date.now()/1000}}
 const id=decodeURIComponent(path.replace(/^\//,''));if(!id.startsWith('queue_'))return upstream(path);
 let row=await db.prepare('SELECT * FROM ai_queue WHERE id=? AND owner=?').bind(id,owner).first<Job>();if(!row)throw Error('AI 요청을 찾을 수 없습니다.');
 await maintain();row=(await db.prepare('SELECT * FROM ai_queue WHERE id=? AND owner=?').bind(id,owner).first<Job>())!;
 if(row.status==='uncertain')return failed(id);
 if(terminal.includes(row.status))return row.response?{...JSON.parse(row.response),id,status:row.status}:failed(id);
 if(row.upstream_id&&row.check_after<=Date.now())await check(row);
 row=(await db.prepare('SELECT * FROM ai_queue WHERE id=? AND owner=?').bind(id,owner).first<Job>())!;
 if(terminal.includes(row.status))return row.response?{...JSON.parse(row.response),id,status:row.status}:failed(id);
 return row.response?{...JSON.parse(row.response),id,status:row.status==='waiting'?'queued':'in_progress'}:{id,status:row.status==='waiting'?'queued':'in_progress',created_at:row.created_at/1000};
}

async function check(row:Job){const db=getDb().$client,id=row.id;
 const claim=await db.prepare("UPDATE ai_queue SET check_after=?,lease_until=? WHERE id=? AND status IN ('in_progress','queued_upstream') AND check_after<=? AND lease_until<? RETURNING id").bind(Date.now()+15000,Date.now()+30000,id,Date.now(),Date.now()).first();
 if(!claim)return;
 try{const data=await upstream('/'+encodeURIComponent(row.upstream_id));await db.prepare("UPDATE ai_queue SET status=?,response=CASE WHEN EXISTS (SELECT 1 FROM news_accounts WHERE user_id=ai_queue.owner AND deleted_at!='') THEN '' ELSE ? END,lease_until=0 WHERE id=?").bind(terminal.includes(data.status)?data.status:data.status==='queued'?'queued_upstream':'in_progress',JSON.stringify(data),id).run()}
 catch{await db.prepare('UPDATE ai_queue SET lease_until=0 WHERE id=?').bind(id).run()}
}

export async function processAiQueue(){await maintain()}
