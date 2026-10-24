import {getDb} from '../db';
import {aiSettings} from '../db/schema';
import {eq} from 'drizzle-orm';
const ID='openai';
const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes));
const decode=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function encryptionKey(){const hex=process.env.AI_SETTINGS_ENCRYPTION_KEY;if(!hex||!/^[a-f0-9]{64}$/i.test(hex))throw Error('서버 암호화 설정을 확인해 주세요.');return crypto.subtle.importKey('raw',Uint8Array.from(hex.match(/../g)!,s=>parseInt(s,16)),{name:'AES-GCM'},false,['encrypt','decrypt'])}
export async function encryptApiKey(value:string){const iv=crypto.getRandomValues(new Uint8Array(12));const result=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('feedman:openai:v1')},await encryptionKey(),new TextEncoder().encode(value));return {ciphertext:encode(new Uint8Array(result)),iv:encode(iv)}}
export async function decryptApiKey(row:{ciphertext:string;iv:string}){if(!row.ciphertext)return '';const result=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(row.iv),additionalData:new TextEncoder().encode('feedman:openai:v1')},await encryptionKey(),decode(row.ciphertext));return new TextDecoder().decode(result)}
export async function apiKeyRecord(){const [row]=await getDb().select().from(aiSettings).where(eq(aiSettings.id,ID));return row}
export async function resolveApiKey(){const row=await apiKeyRecord();return row?decryptApiKey(row):process.env.OPENAI_API_KEY||''}
export async function hasApiKey(){const row=await apiKeyRecord();return row?Boolean(row.ciphertext):Boolean(process.env.OPENAI_API_KEY)}
export async function saveApiKey(key:string){const encrypted=key?await encryptApiKey(key):{ciphertext:'',iv:''};const data={...encrypted,updatedAt:new Date().toISOString()};await getDb().insert(aiSettings).values({id:ID,...data}).onConflictDoUpdate({target:aiSettings.id,set:data})}
export async function verifyApiKey(key:string){if(!key)throw Error('저장된 API 키가 없습니다.');let response:Response;try{response=await fetch('https://api.openai.com/v1/models',{headers:{Authorization:'Bearer '+key},redirect:'manual',signal:AbortSignal.timeout(15000)})}catch(e){const timeout=e instanceof Error&&(e.name==='TimeoutError'||e.name==='AbortError');throw Error(timeout?'OpenAI 연결이 지연되었습니다. 다시 시도해 주세요.':'서버에서 OpenAI에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.')}if(response.status>=300&&response.status<400){await response.body?.cancel();throw Error('OpenAI가 예상하지 않은 주소 이동을 반환했습니다. 서버 연결 설정을 확인해 주세요.')}if(!response.ok)throw Error(response.status===401?'API 키 인증에 실패했습니다. 키를 확인해 주세요.':response.status===403?'API 키의 Models 읽기 권한을 확인해 주세요.':response.status===429?'OpenAI 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.':'OpenAI 연결 확인에 실패했습니다.');await response.body?.cancel();}
