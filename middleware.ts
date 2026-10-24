import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function middleware(request: NextRequest) {
    // 1. 이미 '방문 도장(쿠키)'을 받은 유저라면 DB 낭비 없이 즉시 화면 응답 (비용 방어)
    if (request.cookies.has('feedai_visited_today')) {
        return NextResponse.next();
    }

    const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';
    const response = NextResponse.next();

    try {
        // 2. 쿠키가 없는 '오늘 첫 방문자'만 DB에 1줄 기록
        const { error } = await supabase.from('visit_logs').insert([{
            ip_address: ip,
            user_agent: userAgent
        }]);

        if (!error) {
            // 3. DB 기록 성공 시, 브라우저에 24시간(86400초) 짜리 방문 도장(쿠키) 부착
            response.cookies.set('feedai_visited_today', 'true', {
                maxAge: 86400,
                httpOnly: true,
                sameSite: 'lax',
                secure: process.env.NODE_ENV === 'production'
            });
        } else {
            console.error('❌ DB 저장 실패:', error.message);
        }
    } catch (err) {
        console.error('❌ 시스템 에러:', err);
    }

    return response;
}

export const config = {
    matcher: [
        '/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
    ],
};