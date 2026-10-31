import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const supabase = (supabaseUrl && supabaseKey)
    ? createClient(supabaseUrl, supabaseKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        }
    })
    : null;

// 정적 자산 및 악의적 스캐너 패턴 필터
const STATIC_EXTENSIONS = /\.(png|jpe?g|gif|svg|ico|webp|avif|css|js|mjs|map|woff2?|ttf|eot|mp4|webm|mp3|txt|xml|json)$/i;
const BOT_UA_REGEX = /(bot|crawler|spider|slurp|feedfetcher|mediapartners|headless|python|curl|wget|httpclient|urllib|aiohttp|nikto|sqlmap|nmap|zgrab|masscan)/i;
const MALICIOUS_PATH_REGEX = /(\/wp-admin|\/wp-login|\/wp-content|\/wp-includes|\/\.env|\/\.git|\/xmlrpc|\/phpmyadmin|\.php$|\.asp$|\.aspx$|\.jsp$)/i;

// 인메모리 IP 캐시 (쿠키 차단 봇/스크립트의 초당 수십 회 INSERT 공격 방어)
const recentIps = new Map<string, number>();
const IP_CACHE_TTL = 60 * 60 * 1000; // 1시간 캐시

function cleanExpiredIps(now: number) {
    if (recentIps.size > 2000) {
        for (const [key, timestamp] of recentIps.entries()) {
            if (now - timestamp > IP_CACHE_TTL) {
                recentIps.delete(key);
            }
        }
    }
}

export async function middleware(request: NextRequest) {
    const pathname = request.nextUrl.pathname;

    // 1. 악의적인 봇 프로브(wp-admin, .env, .php 등) 차단 및 DB 로깅 차단
    if (MALICIOUS_PATH_REGEX.test(pathname)) {
        return new NextResponse('Not Found', { status: 404 });
    }

    // 2. 정적 자산 파일 요청은 로깅 제외
    if (STATIC_EXTENSIONS.test(pathname)) {
        return NextResponse.next();
    }

    // 3. 브라우저 쿠키(24시간 도장) 확인 - 이미 오늘 방문한 일반 유저는 DB 접근 없이 즉시 응답
    if (request.cookies.has('feedai_visited_today')) {
        return NextResponse.next();
    }

    // 4. 봇/크롤러/스캐너 User-Agent 필터링 (스캐너의 UA 조작 및 자동화 툴 차단)
    const userAgent = request.headers.get('user-agent') || '';
    if (!userAgent || userAgent === 'unknown' || userAgent.startsWith('http://') || userAgent.startsWith('https://') || BOT_UA_REGEX.test(userAgent)) {
        return NextResponse.next();
    }

    // 5. 클라이언트 실제 IP 추출
    const ip = request.headers.get('cf-connecting-ip') ||
               request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
               request.headers.get('x-real-ip') ||
               'unknown';

    const response = NextResponse.next();

    // 6. IP 기반 인메모리 캐시 확인 (쿠키 저장을 거부하는 스크립트의 무차별 INSERT 방어)
    const now = Date.now();
    const lastVisit = recentIps.get(ip);
    if (lastVisit && (now - lastVisit) < IP_CACHE_TTL) {
        response.cookies.set('feedai_visited_today', 'true', {
            maxAge: 86400,
            path: '/',
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production'
        });
        return response;
    }

    recentIps.set(ip, now);
    cleanExpiredIps(now);

    // 7. Supabase DB에 일일 첫 방문 기록 1회 추가
    if (supabase) {
        try {
            const { error } = await supabase.from('visit_logs').insert([{
                ip_address: ip,
                user_agent: userAgent.slice(0, 500)
            }]);

            if (!error) {
                response.cookies.set('feedai_visited_today', 'true', {
                    maxAge: 86400,
                    path: '/',
                    httpOnly: true,
                    sameSite: 'lax',
                    secure: process.env.NODE_ENV === 'production'
                });
            } else {
                console.error('❌ 방문 로그 저장 실패:', error.message);
            }
        } catch (err) {
            console.error('❌ 방문 로그 처리 에러:', err);
        }
    }

    return response;
}

export const config = {
    matcher: [
        '/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
    ],
};
