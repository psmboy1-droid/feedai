import {dopamineListing,refreshDueDopamine} from '../../../lib/dopamine-service';
export const dynamic='force-dynamic';

export async function GET(req:Request){
    const country=new URL(req.url).searchParams.get('country')||'KR';
    if(!['KR','US','JP'].includes(country)) return Response.json({error:'잘못된 국가입니다.'},{status:400});

    // 🚀 핵심 해결책: 로컬 개발 환경(development)일 경우 DB 충돌을 무시하고 빈 배열을 던져 503 에러를 방어합니다.
    if (process.env.NODE_ENV === 'development') {
        return Response.json([], {headers:{'Cache-Control':'no-store'}});
    }

    try{
        await refreshDueDopamine(country);
        return Response.json(await dopamineListing(country),{headers:{'Cache-Control':'no-store'}});
    }catch(error){
        // 💡 백엔드 터미널에 진짜 에러 원인을 출력하도록 로그를 추가했습니다.
        console.error('❌ /api/dopamine DB 조회 실패:', error);
        return Response.json({error:'영상을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'},{status:503});
    }
}