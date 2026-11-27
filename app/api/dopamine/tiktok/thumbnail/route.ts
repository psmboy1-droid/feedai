/**
 * /api/dopamine/tiktok/thumbnail
 * 틱톡 썸네일 만료(403 등) 시 공식 oEmbed(무키)로 단건 갱신 + DB 공유 캐시 업데이트
 */

import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const requestSchema = z.object({
    video_id: z.string().trim().min(1).max(128),
});

interface ThumbnailOutcome {
    status:         number;
    thumbnail_url?: string;
    error?:         string;
}

const COOLDOWN_MS = 60_000;
const inFlightLookups = new Map<string, Promise<ThumbnailOutcome>>();
const lastAttemptAt = new Map<string, number>();

function recordCooldown(videoId: string) {
    if (lastAttemptAt.size > 1000) {
        const cutoff = Date.now() - COOLDOWN_MS;
        for (const [k, ts] of lastAttemptAt.entries()) {
            if (ts < cutoff) lastAttemptAt.delete(k);
        }
    }
    lastAttemptAt.set(videoId, Date.now());
}

const reply = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

async function fetchTiktokOembedThumb(videoUrl: string): Promise<string> {
    const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`;
    const res = await fetch(oembedUrl, {
        method: 'GET',
        headers: {
            'Accept':     'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) return '';
    const data = (await res.json()) as { thumbnail_url?: unknown };
    const thumb = typeof data?.thumbnail_url === 'string' ? data.thumbnail_url.trim() : '';
    return thumb.startsWith('https://') ? thumb : '';
}

export async function POST(req: Request) {
    let parsed: z.infer<typeof requestSchema>;
    try {
        const raw = await req.text();
        if (raw.length > 2048) return reply({ error: '요청 용량이 너무 큽니다.' }, 400);
        parsed = requestSchema.parse(JSON.parse(raw));
    } catch {
        return reply({ error: '잘못된 요청 형식입니다.' }, 400);
    }

    const { video_id: videoId } = parsed;
    const rawId = videoId.replace(/_[A-Z]{2}$/, '');
    if (!/^\d+$/.test(rawId)) {
        return reply({ error: '유효하지 않은 TikTok video_id입니다.' }, 400);
    }

    const supabase = getSupabaseServer();

    // 1. DB에 실제 존재하는 틱톡 항목인지 검증 (임의 외부 조회 악용 차단)
    const { data: existing, error: dbErr } = await supabase
        .from('trending_videos')
        .select('video_id, play_url, thumbnail_url')
        .eq('video_id', videoId)
        .eq('platform', 'tiktok')
        .maybeSingle();

    if (dbErr) {
        return reply({ error: '영상 정보를 조회하지 못했습니다.' }, 500);
    }
    if (!existing) {
        return reply({ error: '존재하지 않는 틱톡 영상입니다.' }, 404);
    }

    // 2. 동일 video_id 동시 요청 병합
    const existingInFlight = inFlightLookups.get(videoId);
    if (existingInFlight) {
        const outcome = await existingInFlight;
        return reply(
            outcome.thumbnail_url ? { thumbnail_url: outcome.thumbnail_url } : { error: outcome.error },
            outcome.status
        );
    }

    // 3. 최근 60초 내 이미 조회한 경우 쿨다운 보호
    const lastTs = lastAttemptAt.get(videoId);
    if (lastTs && Date.now() - lastTs < COOLDOWN_MS) {
        if (existing.thumbnail_url) {
            return reply({ thumbnail_url: existing.thumbnail_url, cached: true }, 200);
        }
        return reply({ error: '잠시 후 다시 시도해 주세요.' }, 429);
    }

    // 4. 공식 oEmbed 호출 후 DB thumbnail_url 백그라운드/비동기 갱신
    const job = (async (): Promise<ThumbnailOutcome> => {
        try {
            const primaryUrl = existing.play_url?.startsWith('https://www.tiktok.com/')
                ? existing.play_url
                : `https://www.tiktok.com/video/${rawId}`;
            const fallbackUrl = `https://www.tiktok.com/video/${rawId}`;

            let freshThumb = await fetchTiktokOembedThumb(primaryUrl);
            if (!freshThumb && primaryUrl !== fallbackUrl) {
                freshThumb = await fetchTiktokOembedThumb(fallbackUrl);
            }

            recordCooldown(videoId);

            if (!freshThumb) {
                return { status: 404, error: '틱톡 썸네일을 가져올 수 없습니다.' };
            }

            // DB 갱신 (실패해도 프론트 응답은 즉시 반환)
            if (freshThumb !== existing.thumbnail_url) {
                const { error: updateErr } = await supabase
                    .from('trending_videos')
                    .update({ thumbnail_url: freshThumb })
                    .eq('video_id', videoId)
                    .eq('platform', 'tiktok');

                if (updateErr) {
                    console.warn('[TikTok oEmbed] DB 썸네일 갱신 경고:', updateErr.message);
                }
            }

            return { status: 200, thumbnail_url: freshThumb };
        } catch (err) {
            recordCooldown(videoId);
            return {
                status: 502,
                error:  err instanceof Error ? err.message : '틱톡 썸네일 갱신 실패',
            };
        } finally {
            inFlightLookups.delete(videoId);
        }
    })();

    inFlightLookups.set(videoId, job);
    const outcome = await job;

    return reply(
        outcome.thumbnail_url ? { thumbnail_url: outcome.thumbnail_url } : { error: outcome.error },
        outcome.status
    );
}
