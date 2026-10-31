import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSupabaseServer } from '../../../lib/supabase';
import { getChatGPTUser } from '../../chatgpt-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
    const user = await getChatGPTUser();
    const cookieStore = await cookies();
    const userId = user?.userId || cookieStore.get('userId')?.value;
    const userEmail = user?.email || cookieStore.get('userEmail')?.value;

    if (!userId) {
        return NextResponse.json({ user: null });
    }

    try {
        const supabase = getSupabaseServer();

        // 1. news_accounts 계정 정보 및 profiles 테이블(is_admin, tier, tokens) 조회
        const [{ data: account }, { data: profile }] = await Promise.all([
            supabase
                .from('news_accounts')
                .select('state, tokens, revision, display_name')
                .eq('user_id', userId)
                .maybeSingle(),
            supabase
                .from('profiles')
                .select('is_admin, tokens, tier')
                .eq('id', userId)
                .maybeSingle()
        ]);

        let state = { feeds: [] as any[], saved: [] as any[], read: [] as any[] };
        if (account?.state) {
            try {
                const parsed = typeof account.state === 'string' ? JSON.parse(account.state) : account.state;
                state = {
                    feeds: Array.isArray(parsed.feeds) ? parsed.feeds : [],
                    saved: Array.isArray(parsed.saved) ? parsed.saved : [],
                    read: Array.isArray(parsed.read) ? parsed.read : []
                };
            } catch {}
        }

        // 2. rss_signals 테이블에 등록된 시그널들도 피드 목록에 누락되지 않도록 동기화 병합
        const { data: signals } = await supabase
            .from('rss_signals')
            .select('*')
            .eq('user_id', userId);

        if (signals && signals.length > 0) {
            const existingMap = new Map<string, any>(state.feeds.map((f: any) => [f.url, f]));
            for (const sig of signals) {
                const existing = existingMap.get(sig.feed_url);
                if (existing) {
                    existing.signalId = sig.id;
                    if (sig.frequency) existing.frequency = sig.frequency;
                    if (sig.ai_prompt_code) existing.aiPromptCode = sig.ai_prompt_code;
                    if (sig.custom_prompt !== undefined) existing.customPrompt = sig.custom_prompt;
                    if (sig.category_name && (!existing.name || existing.name === '새 피드')) {
                        existing.name = sig.category_name;
                    }
                } else {
                    state.feeds.push({
                        id: sig.id || crypto.randomUUID(),
                        name: sig.category_name || '시그널 피드',
                        url: sig.feed_url,
                        category: '시그널',
                        signalId: sig.id,
                        frequency: sig.frequency,
                        aiPromptCode: sig.ai_prompt_code,
                        customPrompt: sig.custom_prompt
                    });
                    existingMap.set(sig.feed_url, sig);
                }
            }
        }

        const isAdmin = profile?.is_admin === true;

        return NextResponse.json({
            user: {
                id: userId,
                name: account?.display_name || user?.displayName || userEmail?.split('@')[0] || 'User',
                admin: isAdmin
            },
            state,
            revision: account?.revision || 1,
            tokens: account?.tokens ?? profile?.tokens ?? 100
        });
    } catch (e: any) {
        console.error('계정 정보 조회 에러:', e);
        return NextResponse.json({
            user: {
                id: userId,
                name: user?.displayName || userEmail?.split('@')[0] || 'User',
                admin: false
            },
            state: { feeds: [], saved: [], read: [] },
            revision: 1,
            tokens: 100
        });
    }
}

export async function PUT(request: Request) {
    try {
        const user = await getChatGPTUser();
        const cookieStore = await cookies();
        const userId = user?.userId || cookieStore.get('userId')?.value;

        if (!userId) {
            return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
        }

        const body: any = await request.json().catch(() => ({}));
        const supabase = getSupabaseServer();
        const now = new Date().toISOString();

        if (body.state) {
            const { error } = await supabase
                .from('news_accounts')
                .upsert({
                    user_id: userId,
                    state: JSON.stringify(body.state),
                    revision: (body.revision || 1) + 1,
                    updated_at: now
                }, { onConflict: 'user_id' });

            if (error) throw error;
        }

        return NextResponse.json({
            success: true,
            revision: (body.revision || 1) + 1
        });
    } catch (e: any) {
        console.error('계정 상태 저장 에러:', e);
        return NextResponse.json({ error: '상태 저장 실패' }, { status: 500 });
    }
}
