import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '../../../lib/supabase';

export const dynamic = 'force-dynamic';

const BOT_UA_REGEX = /(bot|crawler|spider|slurp|scan|scanning|verification|feedai|headless|python|curl|wget|httpclient|urllib|aiohttp|nikto|sqlmap|nmap|zgrab|masscan|paloaltonetworks|lighthouse|pagespeed)/i;

export async function POST(request: NextRequest) {
    // 1. 개발 환경 및 로컬 접속 필터링
    const host = request.headers.get('host') || '';
    const hostName = host.split(':')[0].toLowerCase();

    if (process.env.NODE_ENV !== 'production' || hostName === 'localhost' || hostName === '127.0.0.1') {
        return NextResponse.json({ counted: false, reason: 'dev' });
    }

    // 2. Origin 또는 Referer 검증 (실제 운영 호스트와 일치 확인)
    const origin = request.headers.get('origin');
    const referer = request.headers.get('referer');
    let originMatches = false;
    let refererMatches = false;

    if (origin) {
        try {
            const originUrl = new URL(origin);
            if (originUrl.host.toLowerCase() === host.toLowerCase()) {
                originMatches = true;
            }
        } catch {}
    }

    if (referer) {
        try {
            const refererUrl = new URL(referer);
            if (refererUrl.host.toLowerCase() === host.toLowerCase()) {
                refererMatches = true;
            }
        } catch {}
    }

    if (!originMatches && !refererMatches) {
        return NextResponse.json({ counted: false, reason: 'invalid_origin' });
    }

    // 3. User-Agent 검사 (스캐너, 봇, 라이브러리, 구형 위장 UA 차단)
    const userAgent = request.headers.get('user-agent') || '';
    if (!userAgent || BOT_UA_REGEX.test(userAgent) || userAgent.includes('iPhone OS 13_2_3')) {
        return NextResponse.json({ counted: false, reason: 'bot' });
    }

    // 4. 한국시간(KST, UTC+9) 오늘 날짜 계산 및 쿠키 중복 확인
    const now = new Date();
    const kstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const todayKst = kstDate.toISOString().slice(0, 10);

    const visitedCookie = request.cookies.get('feedai_visited_date')?.value;
    if (visitedCookie === todayKst) {
        return NextResponse.json({ counted: false });
    }

    // 5. 클라이언트 실제 IP 추출 및 유효성 검사
    const forwardedFor = request.headers.get('x-forwarded-for');
    const ip = request.headers.get('cf-connecting-ip') ||
               (forwardedFor ? forwardedFor.split(',')[0].trim() : '') ||
               request.headers.get('x-real-ip') ||
               '';

    if (!ip || ip === 'unknown' || ip === '127.0.0.1' || ip === '::1') {
        return NextResponse.json({ counted: false, reason: 'invalid_ip' });
    }

    // 6. Supabase visit_logs 테이블에서 오늘(KST 00:00:00 이후) 이미 기록된 IP인지 조회
    const kstMidnightIso = new Date(`${todayKst}T00:00:00+09:00`).toISOString();
    const supabase = getSupabaseServer();

    try {
        const { count, error: countError } = await supabase
            .from('visit_logs')
            .select('*', { count: 'exact', head: true })
            .eq('ip_address', ip)
            .gte('visited_at', kstMidnightIso);

        if (!countError && (count ?? 0) > 0) {
            // 이미 오늘 기록된 IP면 DB 추가 없이 쿠키만 세팅하여 반환 (봇/스크립트 중복 집계 원천 차단)
            const response = NextResponse.json({ counted: false, already_recorded: true });
            response.cookies.set('feedai_visited_date', todayKst, {
                maxAge: 86400,
                path: '/',
                httpOnly: true,
                sameSite: 'lax',
                secure: true,
            });
            return response;
        }

        // 7. 오늘 첫 방문일 때만 1건 INSERT
        const { error: insertError } = await supabase
            .from('visit_logs')
            .insert([{
                ip_address: ip,
                user_agent: userAgent.slice(0, 500),
            }]);

        if (insertError) {
            console.error('방문 로그 저장 실패:', insertError.message);
        }

        const response = NextResponse.json({ counted: true });
        response.cookies.set('feedai_visited_date', todayKst, {
            maxAge: 86400,
            path: '/',
            httpOnly: true,
            sameSite: 'lax',
            secure: true,
        });
        return response;
    } catch (err) {
        console.error('방문 로깅 처리 에러:', err);
        return NextResponse.json({ counted: false, error: 'internal_error' }, { status: 500 });
    }
}
