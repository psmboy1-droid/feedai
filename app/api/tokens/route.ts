import {membership} from '../../../lib/membership';
import {isDeletedMember} from '../../../lib/members';
import {getDb} from '../../../db';
import {getChatGPTUser} from '../../chatgpt-auth';
import {ensureTokenAccount,tokenBalance} from '../../../lib/analysis-tokens';

export const dynamic = 'force-dynamic';

export async function GET() {
    // 🚀 핵심 해결책: 로컬 개발 환경(development)일 때는 DB 조회(503 에러 원인)를 무시하고, 무조건 PRO 요금제로 통과시킵니다.
    if (process.env.NODE_ENV === 'development') {
        return Response.json({
            subscription: { plan: 'pro', limits: { name: 'PRO', feeds: 9999 } },
            name: '박승민 (Local Pro)', 
            tokens: 9999
        }, { headers: { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie' } });
    }

    const user = await getChatGPTUser();
    if (!user) return Response.json({error: '로그인이 필요합니다.'}, {status: 401});

    try {
        const subscription = await membership(user.userId);
        let row = await getDb().$client.prepare('SELECT display_name,tokens,deleted_at FROM news_accounts WHERE user_id=?').bind(user.userId).first<{display_name:string;tokens:number;deleted_at:string}>();
        
        if (row?.deleted_at) return Response.json({error: '삭제된 회원 계정입니다.'}, {status: 403});
        
        if (!row) {
            await ensureTokenAccount(user.userId);
            row = await getDb().$client.prepare('SELECT display_name,tokens,deleted_at FROM news_accounts WHERE user_id=?').bind(user.userId).first<{display_name:string;tokens:number;deleted_at:string}>();
        }
        
        return Response.json({
            subscription,
            name: row?.display_name || user.displayName,
            tokens: row?.tokens ?? 0
        }, { headers: { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie' } });

    } catch (error) {
        // 💡 실서버에서 DB 쿼리 실패 시 원인을 파악할 수 있도록 서버 로그 추가
        console.error('❌ /api/tokens DB 조회 실패:', error);
        return Response.json({error: '크레딧 잔액을 불러오지 못했습니다.'}, {status: 503});
    }
}