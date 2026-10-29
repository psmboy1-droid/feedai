import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const AddSignalSchema = z.object({
    userId: z.string().optional(),
    feedUrl: z.string().min(1, '피드 URL이 필요합니다.'),
    categoryName: z.string().min(1, '시그널 명칭이 필요합니다.'),
    frequency: z.string().optional().default('360'),
    targetChannel: z.string().optional().default('telegram'),
    aiPromptCode: z.string().optional().default('DEFAULT'),
    customPrompt: z.string().optional().default(''),
});

export async function POST(request: Request) {
    try {
        const rawBody = await request.json();
        console.log('📥 [TELE-DESK] 새로운 시그널 등록 요청:', rawBody);

        const parsed = AddSignalSchema.safeParse(rawBody);
        if (!parsed.success) {
            return NextResponse.json(
                { success: false, error: parsed.error.issues[0]?.message || '입력값 오류' },
                { status: 400 }
            );
        }

        const { userId, feedUrl, categoryName, frequency, targetChannel, aiPromptCode, customPrompt } = parsed.data;

        // ✅ 기존 "temp-user-id-0000" 대신 실제 로그인한 유저 ID 사용 (로컬 개발 시에는 local_seedy 허용)
        const finalUserId =
            userId && userId.trim() !== ''
                ? userId.trim()
                : process.env.NODE_ENV === 'development'
                  ? 'local_seedy'
                  : '';

        if (!finalUserId) {
            return NextResponse.json(
                { success: false, error: '로그인 세션 정보를 찾을 수 없습니다.' },
                { status: 401 }
            );
        }

        const { error } = await supabase.from('rss_signals').insert({
            user_id: finalUserId,
            feed_url: feedUrl,
            category_name: categoryName,
            frequency: frequency || '360',
            target_channel: targetChannel || 'telegram',
            ai_prompt_code: aiPromptCode || 'DEFAULT',
            custom_prompt: customPrompt || '',
            is_active: true,
        });

        if (error) {
            throw new Error(`DB 저장 실패: ${error.message}`);
        }

        return NextResponse.json(
            { success: true, message: '시그널이 완벽하게 등록되었습니다.' },
            { status: 200 }
        );
    } catch (error: any) {
        console.error('🚨 시그널 등록 에러:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}