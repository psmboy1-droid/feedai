import {getChatGPTUser} from '../app/chatgpt-auth';
export function isAdminEmail(email:string|null|undefined){if(!email)return false;const normalized=email.trim().toLowerCase();return [process.env.RSS_ADMIN_EMAIL||'',process.env.RSS_ADDITIONAL_ADMIN_EMAILS||''].flatMap(value=>value.split(/[,;\n]/)).map(value=>value.trim().toLowerCase()).filter(Boolean).includes(normalized)}
export async function isRssAdmin(){const user=await getChatGPTUser();return Boolean(user&&isAdminEmail(user.email))}
