import {isRssAdmin} from '../../../../lib/rss-admin';
import {apiKeyRecord,hasApiKey,resolveApiKey,saveApiKey,verifyApiKey} from '../../../../lib/ai-key';
export const dynamic='force-dynamic';
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}});
export async function GET(){if(!await isRssAdmin())return reply({error:'관리자만 접근할 수 있습니다.'},403);try{const row=await apiKeyRecord();return reply({configured:await hasApiKey(),updatedAt:row?.updatedAt||null,model:process.env.OPENAI_ANALYSIS_MODEL||'gpt-5.4'})}catch{return reply({error:'API 설정을 불러오지 못했습니다.'},503)}}
export async function POST(req:Request){if(!await isRssAdmin())return reply({error:'관리자만 접근할 수 있습니다.'},403);if(req.headers.get('origin')!==new URL(req.url).origin)return reply({error:'허용되지 않은 요청입니다.'},403);try{const text=await req.text();if(text.length>3000)return reply({error:'입력이 너무 깁니다.'},400);let d;try{d=JSON.parse(text)}catch{return reply({error:'잘못된 입력입니다.'},400)}if(!d||!['save','test','delete'].includes(d.action))return reply({error:'잘못된 요청입니다.'},400);
 if(d.action==='delete'){await saveApiKey('');return reply({message:'사이트의 API 연결을 삭제했습니다. OpenAI에서 키 자체를 폐기하려면 Platform에서 삭제해 주세요.'})}
 if(d.action==='save'){const key=typeof d.key==='string'?d.key.trim():'';if(!/^sk-[A-Za-z0-9_-]{20,2000}$/.test(key))return reply({error:'올바른 OpenAI API 키를 입력해 주세요.'},400);await verifyApiKey(key);await saveApiKey(key);return reply({message:'인증 확인 후 API 키를 암호화해 저장했습니다.'})}
 await verifyApiKey(await resolveApiKey());return reply({message:'API 인증 및 Models 조회를 확인했습니다. 피드 분석 권한·사용 가능 크레딧은 실제 분석 시 확인됩니다.'});
 }catch(e){const message=e instanceof Error?e.message:'';const safe=['서버에서 OpenAI에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.','OpenAI가 예상하지 않은 주소 이동을 반환했습니다. 서버 연결 설정을 확인해 주세요.','서버 암호화 설정을 확인해 주세요.','저장된 API 키가 없습니다.','OpenAI 연결이 지연되었습니다. 다시 시도해 주세요.','API 키 인증에 실패했습니다. 키를 확인해 주세요.','API 키의 Models 읽기 권한을 확인해 주세요.','OpenAI 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.','OpenAI 연결 확인에 실패했습니다.'];return reply({error:safe.includes(message)?message:'API 설정을 처리하지 못했습니다. 다시 시도해 주세요.'},502)}
}
