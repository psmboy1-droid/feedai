/**
 * dopamine-collector.ts
 * 유튜브 / 틱톡 / 인스타그램 국가별 최대 100위 수집 엔진
 * Supabase `trending_videos` 테이블에 upsert
 */

import { getSupabaseServer } from './supabase';

export type Platform = 'youtube' | 'tiktok' | 'instagram';
export type Country  = 'KR' | 'US' | 'JP';
export type VideoType = 'shorts' | 'video';

export interface TrendingVideo {
    video_id:      string;   // `${원본ID}_${country}`
    title:         string;
    thumbnail_url: string;
    platform:      Platform;
    country:       Country;
    play_url:      string;
    rank_order:    number;
    video_type:    VideoType;
}

/** RapidAPI 키 셔플 목록 가져오기 */
function getShuffledRapidApiKeys(): string[] {
    const keys = [
        process.env.RAPIDAPI_KEY_1,
        process.env.RAPIDAPI_KEY_2,
        process.env.RAPIDAPI_KEY_3,
        process.env.RAPIDAPI_KEY_4,
    ].filter(Boolean) as string[];
    if (!keys.length) throw new Error('RapidAPI 키가 설정되지 않았습니다.');

    const shuffled = [...keys];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/** RapidAPI 키 자동 로테이션 및 재시도 호출 헬퍼 (401, 403, 429 시 다음 키로 재시도) */
async function fetchRapidApiWithRetry(
    url: string,
    options: {
        method?: string;
        headers: Record<string, string>;
        body?: string;
        signal?: AbortSignal;
    }
): Promise<Response> {
    const keys = getShuffledRapidApiKeys();
    let lastRes: Response | undefined;
    let lastErr: unknown;

    for (const key of keys) {
        try {
            const res = await fetch(url, {
                ...options,
                headers: {
                    ...options.headers,
                    'x-rapidapi-key': key,
                },
            });
            if ([401, 403, 429].includes(res.status)) {
                lastRes = res;
                continue; // 키 한도/권한 문제 시 다음 키로 재시도
            }
            return res;
        } catch (err) {
            lastErr = err;
        }
    }

    if (lastRes) return lastRes;
    throw lastErr || new Error('RapidAPI 요청 실패');
}

/** HTML 엔티티 디코딩 (&quot;, &#39;, &apos;, &amp;, &lt;, &gt;, &#123; 등) */
export function decodeHtmlEntities(text: string): string {
    if (!text || typeof text !== 'string') return '';
    return text
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#(\d+);/g, (_, dec) => {
            const code = parseInt(dec, 10);
            return Number.isFinite(code) ? String.fromCharCode(code) : _;
        })
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
            const code = parseInt(hex, 16);
            return Number.isFinite(code) ? String.fromCharCode(code) : _;
        })
        .replace(/&amp;/g, '&');
}

/** 제목 정제 (HTML 엔티티 디코딩 및 이모지 안전 슬라이스) */
function safeTitle(raw: string | null | undefined, maxChars = 30, removeEmoji = false): string {
    if (!raw) return '';
    const decoded = decodeHtmlEntities(raw);
    const cleaned = decoded.replace(/\0/g, '').trim();
    if (removeEmoji) {
        return Array.from(cleaned).slice(0, maxChars).join('');
    }
    return cleaned.slice(0, 200);
}

/** ISO 8601 재생시간(PT1M30S 등)을 초 단위로 변환 */
export function parseIsoDurationToSeconds(iso: string): number {
    if (!iso || typeof iso !== 'string') return 0;
    const match = iso.match(/P(?:([0-9]+)D)?T(?:([0-9]+)H)?(?:([0-9]+)M)?(?:([0-9]+)S)?/i);
    if (!match) return 0;
    const days    = parseInt(match[1] || '0', 10);
    const hours   = parseInt(match[2] || '0', 10);
    const minutes = parseInt(match[3] || '0', 10);
    const seconds = parseInt(match[4] || '0', 10);
    return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

// ─────────────────────────────────────────
// 1. YouTube (쇼츠 & 일반 영상 각각 최대 limit개 수집)
// ─────────────────────────────────────────
async function collectYoutube(keyword: string, country: Country, limit: number): Promise<TrendingVideo[]> {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) throw new Error('YOUTUBE_API_KEY가 설정되지 않았습니다.');

    const seenIds = new Set<string>();
    const shortsVideos: TrendingVideo[] = [];

    // 1) 쇼츠 수집 (videoDuration = 'short', q = `${keyword} #shorts`)
    const shortsSearchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    shortsSearchUrl.searchParams.set('part', 'snippet');
    shortsSearchUrl.searchParams.set('type', 'video');
    shortsSearchUrl.searchParams.set('q', `${keyword} #shorts`);
    shortsSearchUrl.searchParams.set('videoDuration', 'short');
    shortsSearchUrl.searchParams.set('regionCode', country);
    shortsSearchUrl.searchParams.set('maxResults', String(Math.min(50, Math.max(limit * 2, 30))));
    shortsSearchUrl.searchParams.set('key', apiKey);

    const shortsRes = await fetch(shortsSearchUrl.toString(), { signal: AbortSignal.timeout(15000) });
    if (!shortsRes.ok) throw new Error(`YouTube Shorts Search API 오류: ${shortsRes.status}`);
    const shortsData = await shortsRes.json() as any;
    const shortsItems: any[] = shortsData.items || [];

    const candidateShorts: { videoId: string; item: any }[] = [];
    for (const item of shortsItems) {
        const videoId = item.id?.videoId;
        if (!videoId) continue;
        const compositeId = `${videoId}_${country}`;
        if (seenIds.has(compositeId)) continue;
        candidateShorts.push({ videoId, item });
    }

    // candidateShorts의 실제 재생시간 조회 (youtube/v3/videos?part=contentDetails)
    const durationMap = new Map<string, number>();
    if (candidateShorts.length > 0) {
        const vUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
        vUrl.searchParams.set('part', 'contentDetails');
        vUrl.searchParams.set('id', candidateShorts.map(c => c.videoId).join(','));
        vUrl.searchParams.set('key', apiKey);

        const vRes = await fetch(vUrl.toString(), { signal: AbortSignal.timeout(15000) });
        if (vRes.ok) {
            const vData = await vRes.json() as any;
            for (const v of (vData.items || [])) {
                if (v.id && v.contentDetails?.duration) {
                    durationMap.set(v.id, parseIsoDurationToSeconds(v.contentDetails.duration));
                }
            }
        }
    }

    // 재생시간 1 ~ 65초 우선 채택, 모자라면 66 ~ 180초 중 제목에 #shorts 또는 쇼츠 포함 시 보충
    const tier1: { videoId: string; item: any }[] = [];
    const tier2: { videoId: string; item: any }[] = [];

    for (const cand of candidateShorts) {
        const sec = durationMap.get(cand.videoId) ?? 0;
        const title = cand.item.snippet?.title || '';
        if (sec >= 1 && sec <= 65) {
            tier1.push(cand);
        } else if (sec >= 66 && sec <= 180) {
            if (/#shorts/i.test(title) || /쇼츠/i.test(title)) {
                tier2.push(cand);
            }
        }
    }

    const selectedShorts = [...tier1, ...tier2].slice(0, limit);
    for (let i = 0; i < selectedShorts.length; i++) {
        const cand = selectedShorts[i];
        const compositeId = `${cand.videoId}_${country}`;
        seenIds.add(compositeId);
        shortsVideos.push({
            video_id:      compositeId,
            title:         safeTitle(cand.item.snippet?.title),
            thumbnail_url: `https://i.ytimg.com/vi/${cand.videoId}/maxresdefault.jpg`,
            platform:      'youtube',
            country,
            play_url:      `https://www.youtube.com/embed/${cand.videoId}`,
            rank_order:    i + 1,
            video_type:    'shorts',
        });
    }

    // 2) 일반 영상 수집 (videoDuration = 'medium' 4~20분, q = keyword)
    const regularVideos: TrendingVideo[] = [];
    let pageToken: string | undefined;

    while (regularVideos.length < limit) {
        const remaining = limit - regularVideos.length;
        const maxResults = Math.min(50, remaining);
        const url = new URL('https://www.googleapis.com/youtube/v3/search');
        url.searchParams.set('part', 'snippet');
        url.searchParams.set('type', 'video');
        url.searchParams.set('videoDuration', 'medium');
        url.searchParams.set('q', keyword);
        url.searchParams.set('regionCode', country);
        url.searchParams.set('maxResults', String(maxResults));
        url.searchParams.set('key', apiKey);
        if (pageToken) url.searchParams.set('pageToken', pageToken);

        const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`YouTube Search API 오류: ${res.status}`);
        const data = await res.json() as any;

        const items: any[] = data.items || [];
        for (const item of items) {
            if (regularVideos.length >= limit) break;
            const videoId = item.id?.videoId;
            if (!videoId) continue;
            const compositeId = `${videoId}_${country}`;
            if (seenIds.has(compositeId)) continue;
            seenIds.add(compositeId);

            regularVideos.push({
                video_id:      compositeId,
                title:         safeTitle(item.snippet?.title),
                thumbnail_url: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
                platform:      'youtube',
                country,
                play_url:      `https://www.youtube.com/embed/${videoId}`,
                rank_order:    regularVideos.length + 1,
                video_type:    'video',
            });
        }

        pageToken = data.nextPageToken;
        if (!pageToken || regularVideos.length >= limit) break;
    }

    return [...shortsVideos, ...regularVideos];
}

// ─────────────────────────────────────────
// 2. TikTok
// ─────────────────────────────────────────
async function collectTiktok(keyword: string, country: Country, limit: number): Promise<TrendingVideo[]> {
    const videos: TrendingVideo[] = [];
    const seenIds = new Set<string>();
    let cursor = 0;
    let page = 0;

    while (videos.length < limit && page < 4) {
        const params = new URLSearchParams({
            keywords:     keyword,
            region:       country.toLowerCase(),
            count:        '30',
            cursor:       String(cursor),
            publish_time: '0',
            sort_type:    '0',
        });

        const res = await fetchRapidApiWithRetry(
            `https://tiktok-scraper7.p.rapidapi.com/feed/search?${params.toString()}`,
            {
                headers: {
                    'x-rapidapi-host': 'tiktok-scraper7.p.rapidapi.com',
                    'X-Forwarded-For': '211.36.150.150',
                    'Accept-Language': 'ko-KR,ko;q=0.9',
                },
                signal: AbortSignal.timeout(15000),
            }
        );

        if (!res.ok) {
            if (page === 0) {
                const errText = await res.text().catch(() => '');
                throw new Error(`TikTok API 오류 (${res.status}): ${errText.slice(0, 200)}`);
            }
            break;
        }

        const data = await res.json() as any;

        // data.data.videos or data.data or data 안전 추출
        const rawItems = data?.data?.videos ?? data?.data ?? data;
        const items: any[] = Array.isArray(rawItems) ? rawItems : [];

        for (const item of items) {
            if (videos.length >= limit) break;
            const rawId = item.video_id || item.aweme_id || item.id || '';
            if (!rawId) continue;

            const videoUrl = item.play || item.video_url || item.video?.playAddr || '';
            if (!videoUrl) continue;

            const compositeId = `${rawId}_${country}`;
            if (seenIds.has(compositeId)) continue;
            seenIds.add(compositeId);

            const thumb = item.cover || item.origin_cover || '';
            videos.push({
                video_id:      compositeId,
                title:         safeTitle(item.title || item.desc, 30, true),
                thumbnail_url: thumb,
                platform:      'tiktok',
                country,
                play_url:      videoUrl,
                rank_order:    videos.length + 1,
                video_type:    'shorts',
            });
        }

        const hasMore = Boolean(data?.data?.hasMore ?? data?.hasMore);
        const nextCursor = Number(data?.data?.cursor ?? data?.cursor ?? 0);

        if (!hasMore || nextCursor === cursor || nextCursor === 0) break;
        cursor = nextCursor;
        page++;
    }

    return videos.map((v, i) => ({ ...v, rank_order: i + 1 }));
}

// ─────────────────────────────────────────
// 3. Instagram (릴스 추출)
// ─────────────────────────────────────────
function extractReels(
    node: any,
    results: TrendingVideo[],
    seenIds: Set<string>,
    country: Country,
    limit: number
): void {
    if (!node || results.length >= limit) return;
    if (Array.isArray(node)) {
        for (const child of node) extractReels(child, results, seenIds, country, limit);
        return;
    }
    if (typeof node !== 'object') return;

    // 릴스 판별
    if (
        (node.media_type === 2 || node.feed_type === 'clips') &&
        (node.progressive_download_url || node.video_versions?.[0]?.url)
    ) {
        const rawId    = node.pk || node.id || '';
        const videoUrl = node.progressive_download_url || node.video_versions?.[0]?.url || '';
        const rawTitle = node.caption?.text || '';
        const thumb    = node.image_versions2?.candidates?.[0]?.url || '';
        const compositeId = `${rawId}_${country}`;

        if (rawId && videoUrl && !seenIds.has(compositeId)) {
            seenIds.add(compositeId);
            results.push({
                video_id:      compositeId,
                title:         safeTitle(rawTitle, 30, true),
                thumbnail_url: thumb,
                platform:      'instagram',
                country,
                play_url:      videoUrl,
                rank_order:    results.length + 1,
                video_type:    'shorts',
            });
        }
    }

    // 재귀 탐색
    for (const val of Object.values(node)) {
        if (results.length >= limit) break;
        if (Array.isArray(val) || (typeof val === 'object' && val !== null)) {
            extractReels(val, results, seenIds, country, limit);
        }
    }
}

async function collectInstagram(keyword: string, country: Country, limit: number): Promise<TrendingVideo[]> {
    const videos: TrendingVideo[] = [];
    const seenIds = new Set<string>();
    let nextMaxId: string | undefined;
    let page = 0;

    while (page < 5 && videos.length < limit) {
        const body: Record<string, string> = { name: keyword, tab: 'top' };
        if (nextMaxId) body['next_max_id'] = nextMaxId;

        const res = await fetchRapidApiWithRetry('https://starapi1.p.rapidapi.com/instagram/hashtag/get_media', {
            method: 'POST',
            headers: {
                'content-type':    'application/json',
                'x-rapidapi-host': 'starapi1.p.rapidapi.com',
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(15000),
        });

        if (!res.ok) {
            if (page === 0) {
                const errText = await res.text().catch(() => '');
                throw new Error(`Instagram API 오류 (${res.status}): ${errText.slice(0, 200)}`);
            }
            break;
        }

        const data = await res.json() as any;
        extractReels(data, videos, seenIds, country, limit);

        const newNextMaxId = data?.next_max_id || data?.response?.body?.next_max_id || undefined;
        if (!newNextMaxId || newNextMaxId === nextMaxId) break;
        nextMaxId = newNextMaxId;
        page++;
    }

    return videos.map((v, i) => ({ ...v, rank_order: i + 1 }));
}

// ─────────────────────────────────────────
// 메인 수집 함수
// ─────────────────────────────────────────
export async function collectTrending(
    platform: Platform,
    country: Country
): Promise<{ count: number; error?: string }> {
    const supabase = getSupabaseServer();

    // dopamine_settings에서 keyword & limit 읽기
    const { data: settings } = await supabase
        .from('dopamine_settings')
        .select('search_keyword, display_limit')
        .eq('platform', platform)
        .eq('country', country)
        .maybeSingle();

    const keyword      = settings?.search_keyword || (platform === 'youtube' ? '인기' : platform === 'tiktok' ? '인기' : '인기');
    const displayLimit = Math.min(100, Math.max(1, settings?.display_limit ?? 20));

    let freshVideos: TrendingVideo[] = [];
    let errorMsg: string | undefined;

    try {
        if (platform === 'youtube')        freshVideos = await collectYoutube(keyword, country, displayLimit);
        else if (platform === 'tiktok')    freshVideos = await collectTiktok(keyword, country, displayLimit);
        else if (platform === 'instagram') freshVideos = await collectInstagram(keyword, country, displayLimit);
    } catch (e) {
        errorMsg = e instanceof Error ? e.message : '수집 실패';
    }

    // 1건 이상 수집 성공했을 때만 교체
    if (freshVideos.length > 0) {
        // Map을 이용한 최종 video_id 기준 중복 제거 및 video_type별 rank_order 순차 재부여
        const uniqueMap = new Map<string, TrendingVideo>();
        for (const video of freshVideos) {
            if (!uniqueMap.has(video.video_id)) {
                uniqueMap.set(video.video_id, video);
            }
        }

        // video_type별로 분리하여 각각 1부터 rank_order 부여 (쇼츠와 일반 영상 순번 분리)
        const shortsList: TrendingVideo[] = [];
        const videoList: TrendingVideo[] = [];
        for (const v of uniqueMap.values()) {
            if (v.video_type === 'video') {
                videoList.push(v);
            } else {
                shortsList.push(v);
            }
        }

        const finalVideos: TrendingVideo[] = [
            ...shortsList.map((v, idx) => ({ ...v, rank_order: idx + 1 })),
            ...videoList.map((v, idx) => ({ ...v, rank_order: idx + 1 })),
        ];

        // 기존 삭제 후 upsert
        await supabase
            .from('trending_videos')
            .delete()
            .eq('platform', platform)
            .eq('country', country);

        const { error: upsertErr } = await supabase
            .from('trending_videos')
            .upsert(finalVideos, { onConflict: 'video_id' });

        if (upsertErr) {
            return { count: 0, error: `저장 실패: ${upsertErr.message}` };
        }
        return { count: finalVideos.length };
    }

    return { count: 0, error: errorMsg || '수집된 영상이 없습니다.' };
}

/** 전체 플랫폼 × 국가 일괄 수집 */
export async function collectAll(): Promise<{ platform: Platform; country: Country; count: number; error?: string }[]> {
    const platforms: Platform[] = ['youtube', 'tiktok', 'instagram'];
    const countries: Country[]  = ['KR', 'US', 'JP'];
    const results = [];
    for (const platform of platforms) {
        for (const country of countries) {
            const r = await collectTrending(platform, country);
            results.push({ platform, country, ...r });
        }
    }
    return results;
}
