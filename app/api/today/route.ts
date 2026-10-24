import {briefFailure} from '../../../lib/today-brief';
import {reserveToken,refundToken,saveTicket} from '../../../lib/analysis-tokens';
import {isDeletedMember} from '../../../lib/members';
import {and,eq} from 'drizzle-orm';
import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {todayBriefs} from '../../../db/schema';
import {hasApiKey} from '../../../lib/ai-key';
import {accountFeeds,feedFingerprint,briefRow,briefView,isBriefFresh,updateBrief,collectBrief,startSummary,summaryApi,completedBrief} from '../../../lib/today-brief-service';
export const dynamic='force-dynamic';
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}});
export async function GET(){const user=await getChatGPTUser();if(!user)return reply({error:'로그인이 필요합니다.'},401);if(await isDeletedMember(user.userId))return reply({error:'삭제된 회원 계정입니다.'},403);try{
 const feeds=await accountFeeds(user.userId);if(!feeds.length)return reply({status:'no_feeds'});const key=await feedFingerprint(feeds);const row=await briefRow(user.userId);
 if(!row||row.feedKey!==key)return reply({status:await hasApiKey()?'idle':'unconfigured'});
 if((['queued','in_progress'].includes(row.status)||row.status==='failed'&&row.error==='AI 요약 형식을 확인하지 못했습니다. 다시 생성해 주세요.')&&row.jobId){
  if(row.status!=='failed'&&Date.now()-Date.parse(row.createdAt)>3900000){await refundToken(user.userId+':'+row.requestId,user.userId);await updateBrief(user.userId,row.requestId,{status:'failed',error:'요약 생성 시간이 초과되었습니다. 다시 시도해 주세요.'});return reply({status:'failed',error:'요약 생성 시간이 초과되었습니다. 다시 시도해 주세요.'})}
  try{const job=await summaryApi(user.userId,'/'+encodeURIComponent(row.jobId));if(job.status==='completed'){let result:string|undefined;try{result=completedBrief(job.text,JSON.parse(row.snapshot))}catch(e){await refundToken(user.userId+':'+row.requestId,user.userId);await updateBrief(user.userId,row.requestId,{status:'failed',error:briefFailure(e)})}if(result!==undefined)await updateBrief(user.userId,row.requestId,{status:'completed',result,error:''})}else if(job.error||['failed','cancelled','incomplete'].includes(job.status)){await updateBrief(user.userId,row.requestId,{status:'failed',error:'AI 요약을 완료하지 못했습니다. 다시 시도해 주세요.'})}else await updateBrief(user.userId,row.requestId,{status:job.status==='queued'?'queued':'in_progress'});
  }catch(e){return reply({...briefView(row),error:e instanceof Error?e.message:'요약 조회 실패'},502)}
 }
 if(row.status==='collecting'&&Date.now()-Date.parse(row.createdAt)>120000)await updateBrief(user.userId,row.requestId,{status:'failed',error:'기사 수집 시간이 초과되었습니다. 다시 시도해 주세요.'});
 const latest=await briefRow(user.userId);if(latest&&['failed','no_news'].includes(latest.status))await refundToken(user.userId+':'+latest.requestId,user.userId);if(latest?.status==='completed')await saveTicket(user.userId+':'+latest.requestId,user.userId,latest.jobId,'completed');return reply({...briefView(latest!),stale:!isBriefFresh(latest!,key),configured:await hasApiKey()});
 }catch{return reply({error:'개인 요약을 불러오지 못했습니다.'},503)}}
export async function POST(req:Request){const user=await getChatGPTUser();if(!user)return reply({error:'로그인이 필요합니다.'},401);if(await isDeletedMember(user.userId))return reply({error:'삭제된 회원 계정입니다.'},403);if(req.headers.get('origin')!==new URL(req.url).origin)return reply({error:'허용되지 않은 요청입니다.'},403);
 
 let chargedId='',requestId='';try{
 const feeds=await accountFeeds(user.userId);if(!feeds.length)return reply({status:'no_feeds'});if(!await hasApiKey())return reply({status:'unconfigured',error:'관리자가 AI API를 연결하면 요약을 생성할 수 있습니다.'},503);
 const key=await feedFingerprint(feeds),old=await briefRow(user.userId);const age=old?Date.now()-Date.parse(old.createdAt):Infinity;
 if(old&&old.feedKey===key&&((['completed','no_news'].includes(old.status)&&isBriefFresh(old,key))||(['collecting','queued','in_progress'].includes(old.status)&&age<3900000)))return reply(briefView(old));
 if(old&&age<60000)return reply({error:'잠시 후 다시 시도해 주세요.'},429);
 requestId=crypto.randomUUID();const now=new Date().toISOString(),data={userId:user.userId,feedKey:key,requestId,status:'collecting',jobId:'',snapshot:'',result:'',error:'',createdAt:now,updatedAt:now};
 const locked=old?await getDb().update(todayBriefs).set(data).where(and(eq(todayBriefs.userId,user.userId),eq(todayBriefs.requestId,old.requestId))).returning():await getDb().insert(todayBriefs).values(data).onConflictDoNothing().returning();
 if(!locked.length)return reply({status:'collecting'},202);
 const snapshot=await collectBrief(feeds);await updateBrief(user.userId,requestId,{snapshot:JSON.stringify(snapshot)});
 if(!snapshot.articles.length){const failed=snapshot.failedFeeds.length===snapshot.feedCount;await updateBrief(user.userId,requestId,{status:failed?'failed':'no_news',error:failed?'구독 피드를 수집하지 못했습니다. RSS 연결을 확인하고 다시 시도해 주세요.':''});return reply(briefView((await briefRow(user.userId))!))}
 const reserved=await reserveToken(user.userId,requestId,'summary:'+key);if(!reserved.claimed||!reserved.row)throw Error('AI 크레딧이 부족하거나 다른 요청을 접수 중입니다.');chargedId=reserved.row.id;
 const job=await startSummary(user.userId,snapshot);if(!/^(resp_|queue_)[a-zA-Z0-9_-]{1,200}$/.test(job.id||''))throw Error('AI 요약 요청을 확인하지 못했습니다.');
 if(job.error)throw Error(job.error);const completed=job.status==='completed';let result='';if(completed)try{result=completedBrief(job.text,snapshot)}catch(e){throw Error(briefFailure(e))}await updateBrief(user.userId,requestId,{jobId:job.id,status:completed?'completed':job.status==='queued'?'queued':'in_progress',result});await saveTicket(chargedId,user.userId,job.id,completed?'completed':'in_progress');return reply(briefView((await briefRow(user.userId))!),completed?200:202);
 }catch(e){if(chargedId)await refundToken(chargedId,user.userId);const message=e instanceof Error?e.message:'요약 생성 실패';const safe=/^(AI |관리자)/.test(message)?message:'개인 요약을 생성하지 못했습니다. 다시 시도해 주세요.';if(requestId)try{await updateBrief(user.userId,requestId,{status:'failed',error:safe})}catch{}return reply({status:'failed',error:safe},502)}
}
