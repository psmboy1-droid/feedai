import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// 악의적인 봇 프로브(.env, .git, wp-admin, php 등) 차단 패턴
const MALICIOUS_PATH_REGEX = /(\/wp-admin|\/wp-login|\/wp-content|\/wp-includes|\/\.env|\/\.git|\/xmlrpc|\/phpmyadmin|\.php$|\.asp$|\.aspx$|\.jsp$)/i;

export function middleware(request: NextRequest) {
    const pathname = request.nextUrl.pathname;

    // 악의적인 봇 프로브 차단 (404 반환)
    if (MALICIOUS_PATH_REGEX.test(pathname)) {
        return new NextResponse('Not Found', { status: 404 });
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        '/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
    ],
};
