import {membership} from '../../../lib/membership';
import {isDeletedMember} from '../../../lib/members';
import {getDb} from '../../../db';
import {getChatGPTUser} from '../../chatgpt-auth';
import {ensureTokenAccount,tokenBalance} from '../../../lib/analysis-tokens';
export const dynamic='force-dynamic';
export async function GET(){const user=await getChatGPTUser();if(!user)return Response.json({error:'로그인이 필요합니다.'},{status:401});try{const subscription=await membership(user.userId);let row=await getDb().$client.prepare('SELECT display_name,tokens,deleted_at FROM news_accounts WHERE user_id=?').bind(user.userId).first<{display_name:string;tokens:number;deleted_at:string}>();if(row?.deleted_at)return Response.json({error:'삭제된 회원 계정입니다.'},{status:403});if(!row){await ensureTokenAccount(user.userId);row=await getDb().$client.prepare('SELECT display_name,tokens,deleted_at FROM news_accounts WHERE user_id=?').bind(user.userId).first<{display_name:string;tokens:number;deleted_at:string}>()}return Response.json({subscription,name:row?.display_name||user.displayName,tokens:row?.tokens??0},{headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}})}catch{return Response.json({error:'크레딧 잔액을 불러오지 못했습니다.'},{status:503})}}
