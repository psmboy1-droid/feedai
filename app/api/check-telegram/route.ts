import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const QuerySchema = z.object({
    userId: z.string().min(1, 'userId가 필요합니다.'),
});

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const parsed = QuerySchema.safeParse({
            userId: searchParams.get('userId') || '',
        });

        if (!parsed.success) {
            return NextResponse.json({ success: false });
        }

        const { userId } = parsed.data;

        // ✅ 기존 getDb() 대신 Supabase의 user_settings 테이블 직접 조회
        const { data, error } = await supabase
            .from('user_settings')
            .select('telegram_chat_id')
            .eq('user_id', userId)
            .maybeSingle();

        if (error) throw error;

        const chatId = data?.telegram_chat_id;

        if (chatId) {
            return NextResponse.json({ success: true, chatId });
        } else {
            return NextResponse.json({ success: false });
        }
    } catch (error) {
        console.error('텔레그램 연동 확인 에러:', error);
        return NextResponse.json({ success: false }, { status: 500 });
    }
}