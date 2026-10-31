import { NextResponse } from 'next/server';
import { getSupabaseServer } from '../../../lib/supabase';
import { getChatGPTUser } from '../../chatgpt-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    try {
        const user = await getChatGPTUser();
        const { searchParams } = new URL(req.url);
        const userId = user?.userId || searchParams.get('userId');

        if (!userId) {
            return NextResponse.json({ signals: [] });
        }

        const supabase = getSupabaseServer();
        const { data: signals, error } = await supabase
            .from('rss_signals')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        return NextResponse.json({
            success: true,
            signals: signals || []
        }, {
            headers: { 'Cache-Control': 'private, no-store' }
        });
    } catch (e: any) {
        console.error('시그널 목록 조회 에러:', e);
        return NextResponse.json({ success: false, error: e.message, signals: [] }, { status: 500 });
    }
}

