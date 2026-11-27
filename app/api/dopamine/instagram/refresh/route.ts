/**
 * /api/dopamine/instagram/refresh
 * 인스타그램 릴스 단건 영상 URL 온디맨드 갱신 + DB 공유 캐시 API
 */

import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase';
import { extractInstagramMp4Url, fetchRapidApiWithRetry } from '@/lib/dopamine-collector';
import {
    extractInstagramRawPk,
    instagramPostUrl,
    isInstagramOeValid,
} from '@/lib/instagram-url';

export const dynamic = 'force-dynamic';

const refreshSchema = z.object({
    video_id: z.string().trim().min(1).max(128),
    force:    z.boolean().optional().default(false),
});

interface RefreshOutcome {
    status:       number;
    play_url?:    string;
    refreshed?:   boolean;
    error?:       string;
    fallback_url?: string;
}

const COOLDOWN_MS = 60_000;
const MIN_VALID_REMAINING_SECONDS = 300; // 5분

// 동일 video_id 동시 요청 병합(in-flight deduplication) 및 최근 60초 쿨다운
const inFlightRefreshes = new Map<string, Promise<RefreshOutcome>>();
const lastRefreshAt = new Map<string, number>();

function recordCooldown(videoId: string) {
    if (lastRefreshAt.size > 1000) {
        const cutoff = Date.now() - COOLDOWN_MS;
        for (const [k, ts] of lastRefreshAt.entries()) {
            if (ts < cutoff) lastRefreshAt.delete(k);
        }
    }
    lastRefreshAt.set(videoId, Date.now());
}

const reply = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function POST(req: Request) {
    let parsedBody: z.infer<typeof refreshSchema>;
    try {
        const raw = await req.text();
        if (raw.length > 2048) {
            return reply({ error: '요청 용량이 너무 큽니다.' }, 400);
        }
        parsedBody = refreshSchema.parse(JSON.parse(raw));
    } catch {
        return reply({ error: '잘못된 요청 형식입니다.' }, 400);
    }

    const { video_id: videoId, force } = parsedBody;
    const rawPk = extractInstagramRawPk(videoId);
    const fallbackUrl = instagramPostUrl(videoId);

    if (!/^\d+$/.test(rawPk) || rawPk === '0') {
        return reply({ error: '유효하지 않은 video_id 형식입니다.', fallback_url: fallbackUrl }, 400);
    }

    const supabase = getSupabaseServer();

    // 1. DB에 실제 존재하는 인스타그램 항목인지 선조회 (임의 ID 호출 악용 차단)
    const { data: existing, error: dbErr } = await supabase
        .from('trending_videos')
        .select('video_id, play_url')
        .eq('video_id', videoId)
        .eq('platform', 'instagram')
        .maybeSingle();

    if (dbErr) {
        return reply({ error: '영상 정보를 조회하지 못했습니다.' }, 500);
    }
    if (!existing) {
        return reply({ error: '존재하지 않는 인스타그램 영상입니다.' }, 404);
    }

    const currentPlayUrl = existing.play_url || '';

    // 2. force !== true 이고 oe 만료까지 5분 이상 남은 유효 URL이면 외부 API 호출 없이 즉시 반환
    if (!force && isInstagramOeValid(currentPlayUrl, MIN_VALID_REMAINING_SECONDS)) {
        return reply({ play_url: currentPlayUrl, refreshed: false }, 200);
    }

    // 3. 진행 중인 동일 video_id 갱신 요청이 있으면 해당 Promise 결과를 공유
    const existingInFlight = inFlightRefreshes.get(videoId);
    if (existingInFlight) {
        const outcome = await existingInFlight;
        return reply(
            outcome.play_url
                ? { play_url: outcome.play_url, refreshed: outcome.refreshed ?? true }
                : { error: outcome.error, fallback_url: outcome.fallback_url ?? fallbackUrl },
            outcome.status
        );
    }

    // 4. 최근 60초 내 이미 외부 API 갱신을 시도한 경우 쿼터 보호
    const lastTs = lastRefreshAt.get(videoId);
    if (lastTs && Date.now() - lastTs < COOLDOWN_MS) {
        if (isInstagramOeValid(currentPlayUrl, 60)) {
            return reply({ play_url: currentPlayUrl, refreshed: false }, 200);
        }
        return reply(
            {
                error: '잠시 후 다시 시도해 주세요.',
                fallback_url: fallbackUrl,
            },
            429
        );
    }

    // 5. StarAPI 단건 조회 → DB play_url 갱신 (in-flight 등록)
    const job = (async (): Promise<RefreshOutcome> => {
        try {
            const res = await fetchRapidApiWithRetry(
                'https://starapi1.p.rapidapi.com/instagram/media/get_info',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type':    'application/json',
                        'x-rapidapi-host': 'starapi1.p.rapidapi.com',
                    },
                    body: JSON.stringify({ id: rawPk }),
                    signal: AbortSignal.timeout(10_000),
                }
            );

            recordCooldown(videoId);

            if (!res.ok) {
                return {
                    status:       res.status === 404 ? 404 : 502,
                    error:        `인스타그램 원본 영상을 불러올 수 없습니다. (${res.status})`,
                    fallback_url: fallbackUrl,
                };
            }

            const data = (await res.json()) as any;
            const item = data?.response?.body?.items?.[0] ?? data?.items?.[0];
            const freshUrl = extractInstagramMp4Url(item);

            if (!freshUrl) {
                return {
                    status:       404,
                    error:        '삭제되었거나 비공개 처리된 인스타그램 릴스입니다.',
                    fallback_url: fallbackUrl,
                };
            }

            const { error: updateErr } = await supabase
                .from('trending_videos')
                .update({ play_url: freshUrl })
                .eq('video_id', videoId)
                .eq('platform', 'instagram');

            if (updateErr) {
                console.warn('[Instagram Refresh] DB 업데이트 경고:', updateErr.message);
            }

            return {
                status:    200,
                play_url:  freshUrl,
                refreshed: true,
            };
        } catch (err) {
            recordCooldown(videoId);
            return {
                status:       502,
                error:        err instanceof Error ? err.message : '영상 URL 갱신에 실패했습니다.',
                fallback_url: fallbackUrl,
            };
        } finally {
            inFlightRefreshes.delete(videoId);
        }
    })();

    inFlightRefreshes.set(videoId, job);
    const outcome = await job;

    return reply(
        outcome.play_url
            ? { play_url: outcome.play_url, refreshed: outcome.refreshed ?? true }
            : { error: outcome.error, fallback_url: outcome.fallback_url ?? fallbackUrl },
        outcome.status
    );
}
