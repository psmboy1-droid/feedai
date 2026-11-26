/**
 * Same-Origin CSRF 검증 유틸
 * - Cloudflare / Nginx 리버스 프록시 SSL 오프로딩 및 호스트 헤더 환경 대응
 */
export function isSameOrigin(req: Request): boolean {
    const originHeader = req.headers.get('origin');
    const refererHeader = req.headers.get('referer');

    let candidate = originHeader;

    if (!candidate && refererHeader) {
        try {
            candidate = new URL(refererHeader).origin;
        } catch {
            return false;
        }
    }

    // origin과 referer가 모두 없는 경우 sec-fetch-site 헤더로 검증
    if (!candidate) {
        return req.headers.get('sec-fetch-site') === 'same-origin';
    }

    let originUrl: URL;
    try {
        originUrl = new URL(candidate);
    } catch {
        return false;
    }

    const originHostname = originUrl.hostname.toLowerCase();
    const originHost = originUrl.host.toLowerCase();

    // 1) feedaix.com 또는 www.feedaix.com (HTTPS 필수)
    if (
        originUrl.protocol === 'https:' &&
        (originHostname === 'feedaix.com' || originHostname === 'www.feedaix.com')
    ) {
        return true;
    }

    // 2) 허용 호스트 목록 수집 (소문자 Set)
    const allowedHosts = new Set<string>();

    const xForwardedHost = req.headers.get('x-forwarded-host');
    if (xForwardedHost) {
        const first = xForwardedHost.split(',')[0].trim().toLowerCase();
        if (first) {
            allowedHosts.add(first);
        }
    }

    const host = req.headers.get('host');
    if (host) {
        const trimmedHost = host.trim().toLowerCase();
        if (trimmedHost) {
            allowedHosts.add(trimmedHost);
        }
    }

    try {
        const reqHost = new URL(req.url).host.toLowerCase();
        if (reqHost) {
            allowedHosts.add(reqHost);
        }
    } catch {
        // req.url 파싱 실패 시 무시
    }

    // 3) allowedHosts 일치 및 HTTPS / 로컬 개발 환경 검증
    const isLocal = originHostname === 'localhost' || originHostname === '127.0.0.1';
    if (allowedHosts.has(originHost) && (originUrl.protocol === 'https:' || isLocal)) {
        return true;
    }

    // 4) 그 외 모든 경우 차단
    return false;
}
