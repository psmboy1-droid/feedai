import {getDb} from '../../../../db';
import {isRssAdmin} from '../../../../lib/rss-admin';
import {runSocialCollection} from '../../../../lib/social-service';
export async function GET(){if(!await isRssAdmin())return Response.json({error:'관리자 권한이 필요합니다.'},{status:403});const rows=await getDb().$client.prepare('SELECT url,platform,handle,status,error,last_success,next_check FROM social_accounts ORDER BY last_success DESC LIMIT 100').all();return Response.json({items:rows.results},{headers:{'Cache-Control':'private, no-store'}})}
export async function POST(req:Request){if(!await isRssAdmin()||req.headers.get('origin')!==new URL(req.url).origin)return Response.json({error:'관리자 권한이 필요합니다.'},{status:403});return Response.json(await runSocialCollection())}
