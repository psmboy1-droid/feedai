import { membership } from '../../../lib/membership';
import { isDeletedMember } from '../../../lib/members';
import { getSupabaseServer } from '../../../lib/supabase';
import { getChatGPTUser } from '../../chatgpt-auth';
import { ensureTokenAccount } from '../../../lib/analysis-tokens';

export const dynamic = 'force-dynamic';

export async function GET() {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });

    try {
        if (await isDeletedMember(user.userId)) {
            return Response.json({ error: '삭제된 회원 계정입니다.' }, { status: 403 });
        }

        const supabase = getSupabaseServer();
        let { data: row } = await supabase
            .from('news_accounts')
            .select('display_name, tokens, deleted_at')
            .eq('user_id', user.userId)
            .maybeSingle();

        if (row?.deleted_at) {
            return Response.json({ error: '삭제된 회원 계정입니다.' }, { status: 403 });
        }

        if (!row) {
            await ensureTokenAccount(user.userId);
            const { data: fresh } = await supabase
                .from('news_accounts')
                .select('display_name, tokens, deleted_at')
                .eq('user_id', user.userId)
                .maybeSingle();
            row = fresh;
        }

        let subscription;
        try {
            subscription = await membership(user.userId);
        } catch {
            subscription = { plan: 'free', limits: { name: 'Free', feeds: 10 } };
        }

        return Response.json({
            subscription,
            name: row?.display_name || user.displayName,
            tokens: row?.tokens ?? 100
        }, { headers: { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie' } });

    } catch (error) {
        console.error('❌ /api/tokens 조회 실패:', error);
        return Response.json({ error: '크레딧 잔액을 불러오지 못했습니다.' }, { status: 503 });
    }
}
