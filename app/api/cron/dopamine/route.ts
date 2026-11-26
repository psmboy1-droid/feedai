import { NextResponse } from 'next/server';
import { collectTrending, collectAll, type Platform, type Country } from '@/lib/dopamine-collector';

export const dynamic = 'force-dynamic';

const COUNTRIES: Country[] = ['KR', 'US', 'JP'];

export async function GET(req: Request) {
    // 1. CRON_SECRET 다각도 검증 (Bearer 헤더 / x-cron-secret 헤더 / URL 쿼리 ?key=)
    const secret = process.env.CRON_SECRET;
    const { searchParams } = new URL(req.url);
    const authHeader = req.headers.get('authorization');
    const bearerKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const headerKey = req.headers.get('x-cron-secret');
    const queryKey = searchParams.get('key');
    const providedKey = bearerKey || headerKey || queryKey;

    if (!secret || providedKey !== secret) {
        return new Response('Unauthorized', { status: 401 });
    }

    // 2. 플랫폼 파라미터 파싱 (기본값: tiktok)
    const rawPlatform = (searchParams.get('platform') || 'tiktok').toLowerCase();
    const validPlatforms: (Platform | 'all')[] = ['tiktok', 'instagram', 'youtube', 'all'];
    const platform = validPlatforms.includes(rawPlatform as any)
        ? (rawPlatform as Platform | 'all')
        : 'tiktok';

    try {
        // 3. 'all'인 경우 전체 플랫폼 × 국가 일괄 수집
        if (platform === 'all') {
            const results = await collectAll();
            return NextResponse.json({ ok: true, platform: 'all', results });
        }

        // 4. 특정 플랫폼인 경우: RapidAPI 429(Rate Limit) 방지를 위해 국가별 순차(for...of) 실행
        const results: { platform: Platform; country: Country; count: number; error?: string }[] = [];

        for (const country of COUNTRIES) {
            try {
                const res = await collectTrending(platform, country);
                results.push({ platform, country, ...res });
            } catch (err: any) {
                results.push({
                    platform,
                    country,
                    count: 0,
                    error: err instanceof Error ? err.message : '수집 중 오류 발생',
                });
            }
        }

        return NextResponse.json({ ok: true, platform, results });
    } catch (e: any) {
        console.error('[Cron Dopamine Error]', e);
        return NextResponse.json(
            { ok: false, error: e instanceof Error ? e.message : '도파민 자동 수집 실패' },
            { status: 500 }
        );
    }
}

export const POST = GET;
