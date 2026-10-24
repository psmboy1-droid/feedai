import {isRssAdmin} from '../../../../lib/rss-admin';
import {readSeo,saveSeo} from '../../../../lib/seo-settings';
import {seoSchema} from '../../../../lib/seo-config';
export const dynamic='force-dynamic';
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}});
export async function GET(){if(!await isRssAdmin())return reply({error:'관리자만 접근할 수 있습니다.'},403);try{return reply(await readSeo())}catch{return reply({error:'SEO 설정을 불러오지 못했습니다.'},503)}}
export async function PUT(req:Request){if(!await isRssAdmin())return reply({error:'관리자만 접근할 수 있습니다.'},403);if(req.headers.get('origin')!==new URL(req.url).origin)return reply({error:'허용되지 않은 요청입니다.'},403);try{const text=await req.text();if(text.length>10000)return reply({error:'입력 크기를 줄여 주세요.'},413);let body;try{body=JSON.parse(text)}catch{return reply({error:'잘못된 입력입니다.'},400)}const parsed=seoSchema.safeParse(body);if(!parsed.success)return reply({error:'제목·설명과 URL 형식을 확인해 주세요. 대표 주소에는 경로나 검색 조건을 넣을 수 없습니다.'},400);const updatedAt=await saveSeo(parsed.data);return reply({settings:parsed.data,updatedAt,message:'SEO 설정을 저장했습니다. 새로 여는 페이지부터 적용됩니다.'})}catch{return reply({error:'SEO 설정을 저장하지 못했습니다.'},503)}}
