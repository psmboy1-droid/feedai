import { NextResponse } from 'next/server';
import { getSupabaseServer } from '../../../lib/supabase';
import { getChatGPTUser } from '../../chatgpt-auth';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const DeleteSignalSchema = z.object({
    id: z.string().optional(),
    feedUrl: z.string().optional(),
    userId: z.string().optional(),
});

export async function POST(req: Request) {
    try {
        const user = await getChatGPTUser();
        const body = await req.json().catch(() => ({}));
        const parsed = DeleteSignalSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json({ success: false, error: '잘못된 요청입니다.' }, { status: 400 });
        }

        const { id, feedUrl } = parsed.data;
        const userId = user?.userId || parsed.data.userId;

        if (!userId) {
            return NextResponse.json({ success: false, error: '로그인이 필요합니다.' }, { status: 401 });
        }

        if (!id && !feedUrl) {
            return NextResponse.json({ success: false, error: '삭제할 시그널 ID 또는 URL이 필요합니다.' }, { status: 400 });
        }

        const supabase = getSupabaseServer();
        let query = supabase.from('rss_signals').delete().eq('user_id', userId);

        if (id) {
            query = query.eq('id', id);
        } else if (feedUrl) {
            query = query.eq('feed_url', feedUrl);
        }

        const { error } = await query;
        if (error) throw error;

        // Also sync news_accounts state if feedUrl is provided
        if (feedUrl) {
            const { data: account } = await supabase
                .from('news_accounts')
                .select('state')
                .eq('user_id', userId)
                .maybeSingle();

            if (account?.state) {
                try {
                    const parsedState = typeof account.state === 'string' ? JSON.parse(account.state) : account.state;
                    if (Array.isArray(parsedState.feeds)) {
                        parsedState.feeds = parsedState.feeds.filter((f: any) => f.url !== feedUrl && f.id !== id);
                        await supabase
                            .from('news_accounts')
                            .update({
                                state: JSON.stringify(parsedState),
                                updated_at: new Date().toISOString()
                            })
                            .eq('user_id', userId);
                    }
                } catch {}
            }
        }

        return NextResponse.json({
            success: true,
            message: '시그널이 삭제되었습니다.'
        });
    } catch (e: any) {
        console.error('시그널 삭제 에러:', e);
        return NextResponse.json(
            { success: false, error: e.message || '시그널 삭제에 실패했습니다.' },
            { status: 500 }
        );
    }
}

