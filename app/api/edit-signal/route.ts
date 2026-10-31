import { NextResponse } from 'next/server';
import { getSupabaseServer } from '../../../lib/supabase';
import { getChatGPTUser } from '../../chatgpt-auth';
import { cookies } from 'next/headers';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const EditSignalSchema = z.object({
    id: z.string().optional(),
    feedUrl: z.string().min(1, '피드 URL이 필요합니다.'),
    categoryName: z.string().min(1, '시그널 명칭이 필요합니다.'),
    frequency: z.string().optional().default('360'),
    aiPromptCode: z.string().optional().default('DEFAULT'),
    customPrompt: z.string().optional().default(''),
    userId: z.string().optional(),
});

export async function POST(req: Request) {
    try {
        const user = await getChatGPTUser();
        const cookieStore = await cookies();
        const body: any = await req.json().catch(() => ({}));
        const parsed = EditSignalSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json(
                { success: false, error: parsed.error.issues[0]?.message || '입력값 오류' },
                { status: 400 }
            );
        }

        const { id, feedUrl, categoryName, frequency, aiPromptCode, customPrompt } = parsed.data;
        const userId = user?.userId || body.userId || cookieStore.get('userId')?.value;

        if (!userId) {
            return NextResponse.json(
                { success: false, error: '로그인이 필요합니다.' },
                { status: 401 }
            );
        }

        const supabase = getSupabaseServer();
        const now = new Date().toISOString();

        // 1. rss_signals 테이블에서 기존 시그널 검색 (id 또는 feed_url 기준)
        let targetSignalId: string | number | null = null;

        if (id) {
            const { data: byId } = await supabase
                .from('rss_signals')
                .select('id')
                .eq('id', id)
                .eq('user_id', userId)
                .maybeSingle();
            if (byId?.id) {
                targetSignalId = byId.id;
            }
        }

        if (!targetSignalId) {
            const { data: byUrl } = await supabase
                .from('rss_signals')
                .select('id')
                .eq('feed_url', feedUrl)
                .eq('user_id', userId)
                .maybeSingle();
            if (byUrl?.id) {
                targetSignalId = byUrl.id;
            }
        }

        if (targetSignalId) {
            const { error: updateErr } = await supabase
                .from('rss_signals')
                .update({
                    category_name: categoryName,
                    feed_url: feedUrl,
                    frequency,
                    ai_prompt_code: aiPromptCode,
                    custom_prompt: customPrompt,
                    updated_at: now
                })
                .eq('id', targetSignalId)
                .eq('user_id', userId);

            if (updateErr) throw updateErr;
        } else {
            // 없는 경우 새로 생성 (보존적 upsert)
            const { data: inserted, error: insertErr } = await supabase
                .from('rss_signals')
                .insert({
                    user_id: userId,
                    feed_url: feedUrl,
                    category_name: categoryName,
                    frequency,
                    ai_prompt_code: aiPromptCode,
                    custom_prompt: customPrompt,
                    target_channel: 'telegram',
                    is_active: true
                })
                .select('id')
                .single();

            if (insertErr) throw insertErr;
            if (inserted) targetSignalId = inserted.id;
        }

        // 2. news_accounts.state 내 feeds 배열도 동기화하여 화면 새로고침 시에도 완벽 유지
        const { data: accountData } = await supabase
            .from('news_accounts')
            .select('state, revision')
            .eq('user_id', userId)
            .maybeSingle();

        if (accountData?.state) {
            try {
                const state = typeof accountData.state === 'string'
                    ? JSON.parse(accountData.state)
                    : accountData.state;

                if (state.feeds && Array.isArray(state.feeds)) {
                    let changed = false;
                    for (const f of state.feeds) {
                        if (f.url === feedUrl || (id && f.id === id)) {
                            f.name = categoryName;
                            f.frequency = frequency;
                            f.aiPromptCode = aiPromptCode;
                            f.customPrompt = customPrompt;
                            if (targetSignalId) f.signalId = targetSignalId;
                            changed = true;
                        }
                    }

                    if (changed) {
                        await supabase
                            .from('news_accounts')
                            .update({
                                state: JSON.stringify(state),
                                revision: (accountData.revision || 1) + 1,
                                updated_at: now
                            })
                            .eq('user_id', userId);
                    }
                }
            } catch (err) {
                console.error('news_accounts 상태 동기화 경고:', err);
            }
        }

        return NextResponse.json({
            success: true,
            message: '시그널 설정이 저장되었습니다.',
            signalId: targetSignalId
        });
    } catch (e: any) {
        console.error('시그널 수정 에러:', e);
        return NextResponse.json(
            { success: false, error: e.message || '시그널 수정에 실패했습니다.' },
            { status: 500 }
        );
    }
}
