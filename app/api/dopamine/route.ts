import {dopamineListing,refreshDueDopamine} from '../../../lib/dopamine-service';
export const dynamic='force-dynamic';
export async function GET(req:Request){const country=new URL(req.url).searchParams.get('country')||'KR';if(!['KR','US','JP'].includes(country))return Response.json({error:'잘못된 국가입니다.'},{status:400});try{await refreshDueDopamine(country);return Response.json(await dopamineListing(country),{headers:{'Cache-Control':'no-store'}})}catch{return Response.json({error:'영상을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'},{status:503})}}
