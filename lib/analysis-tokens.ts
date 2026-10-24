import {membership} from './membership';
import {getDb} from '../db';
type Ticket={id:string;user_id:string;request_hash:string;claim:string;status:string;job_id:string;result:string;created_at:string};
export async function ensureTokenAccount(userId:string){const db=getDb().$client,now=new Date().toISOString();const exists=await db.prepare('SELECT user_id FROM news_accounts WHERE user_id=?').bind(userId).first();if(!exists)await db.prepare('INSERT INTO news_accounts (user_id,state,created_at,updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO NOTHING').bind(userId,JSON.stringify({feeds:[],saved:[],read:[]}),now,now).run();const expired=await db.prepare("SELECT id FROM analysis_requests WHERE user_id=? AND status='reserved' AND created_at<?").bind(userId,new Date(Date.now()-120000).toISOString()).all<{id:string}>();for(const row of expired.results)await refundToken(row.id,userId)}
export async function tokenBalance(userId:string){await membership(userId);const row=await getDb().$client.prepare('SELECT tokens FROM news_accounts WHERE user_id=?').bind(userId).first<{tokens:number}>();return row?.tokens??0}
export async function ticket(id:string,userId:string){return getDb().$client.prepare('SELECT * FROM analysis_requests WHERE id=? AND user_id=?').bind(id,userId).first<Ticket>()}
export async function reserveToken(userId:string,requestId:string,requestHash:string){await ensureTokenAccount(userId);await membership(userId);const db=getDb().$client,id=userId+':'+requestId,claim=crypto.randomUUID(),now=new Date().toISOString();
 await db.batch([
 db.prepare("INSERT INTO analysis_requests (id,user_id,request_hash,claim,status,created_at) SELECT ?,?,?,?,'reserved',? FROM news_accounts WHERE user_id=? AND deleted_at='' AND tokens>0 AND NOT EXISTS (SELECT 1 FROM analysis_requests WHERE user_id=? AND status='reserved') ON CONFLICT(id) DO NOTHING").bind(id,userId,requestHash,claim,now,userId,userId),
 db.prepare("UPDATE news_accounts SET tokens=tokens-1 WHERE user_id=? AND tokens>0 AND EXISTS (SELECT 1 FROM analysis_requests WHERE id=? AND claim=? AND status='reserved')").bind(userId,id,claim)
 ]);
 const row=await ticket(id,userId);return {row,claimed:row?.claim===claim};
}
export async function refundToken(id:string,userId:string){await membership(userId);const db=getDb().$client;await db.batch([
 db.prepare("UPDATE news_accounts SET tokens=tokens+1 WHERE user_id=? AND deleted_at='' AND EXISTS (SELECT 1 FROM analysis_requests WHERE id=? AND user_id=? AND status IN ('reserved','queued','in_progress'))").bind(userId,id,userId),
 db.prepare("UPDATE analysis_requests SET status='refunded' WHERE id=? AND user_id=? AND status IN ('reserved','queued','in_progress')").bind(id,userId)
 ])}
export async function saveTicket(id:string,userId:string,jobId:string,status:string,result=''){await getDb().$client.prepare("UPDATE analysis_requests SET job_id=?,status=?,result=? WHERE id=? AND user_id=? AND status!='refunded'").bind(jobId,status,result,id,userId).run()}
export async function jobTicket(jobId:string,userId:string){return getDb().$client.prepare('SELECT * FROM analysis_requests WHERE job_id=? AND user_id=?').bind(jobId,userId).first<Ticket>()}
