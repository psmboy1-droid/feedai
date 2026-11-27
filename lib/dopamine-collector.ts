/**
 * dopamine-collector.ts
 * 유튜브 / 틱톡 / 인스타그램 국가별 최대 100위 수집 엔진
 * Supabase `trending_videos` 테이블에 upsert
 */

import { getSupabaseServer } from './supabase';
import {
    DOPAMINE_INSTAGRAM_R2_PREFIX,
    MAX_R2_BYTES,
    deleteFromR2ByUrlWithPrefix,
    getR2StorageStats,
    isDopamineInstagramR2Url,
    isDopamineInstagramR2VideoUrl,
    uploadToR2,
} from './r2';

export type Platform = 'youtube' | 'tiktok' | 'instagram';
export type Country  = 'KR' | 'US' | 'JP';
export type VideoType = 'shorts' | 'video';

export interface CollectOptions {
    deadlineAt?: number;
}

export interface CollectResult {
    count:    number;
    error?:   string;
    partial?: boolean;
    skipped?: number;
}

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

/** RapidAPI 키 셔플 목록 가져오기 (RAPIDAPI_KEY 및 RAPIDAPI_KEY_1~4 포함, 중복 제거) */
function getShuffledRapidApiKeys(): string[] {
    const rawKeys = [
        process.env.RAPIDAPI_KEY,
        process.env.RAPIDAPI_KEY_1,
        process.env.RAPIDAPI_KEY_2,
        process.env.RAPIDAPI_KEY_3,
        process.env.RAPIDAPI_KEY_4,
    ].filter(Boolean) as string[];
    const keys = Array.from(new Set(rawKeys));
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
                console.warn(`[RapidAPI] 키 상태 (${res.status}), 다음 키로 자동 로테이션합니다.`);
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
    let shortsPageToken: string | undefined;
    let shortsPage = 0;

    // 1) 쇼츠 수집 (videoDuration = 'short', q = `${keyword} #shorts`, 최대 5페이지 또는 limit 달성 시까지)
    while (shortsVideos.length < limit && shortsPage < 5) {
        const remaining = limit - shortsVideos.length;
        const maxResults = Math.min(50, Math.max(remaining * 2, 30));
        const shortsSearchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
        shortsSearchUrl.searchParams.set('part', 'snippet');
        shortsSearchUrl.searchParams.set('type', 'video');
        shortsSearchUrl.searchParams.set('q', `${keyword} #shorts`);
        shortsSearchUrl.searchParams.set('videoDuration', 'short');
        shortsSearchUrl.searchParams.set('regionCode', country);
        shortsSearchUrl.searchParams.set('maxResults', String(maxResults));
        shortsSearchUrl.searchParams.set('key', apiKey);
        if (shortsPageToken) shortsSearchUrl.searchParams.set('pageToken', shortsPageToken);

        const shortsRes = await fetch(shortsSearchUrl.toString(), { signal: AbortSignal.timeout(15000) });
        if (!shortsRes.ok) {
            if (shortsPage === 0) {
                throw new Error(`YouTube Shorts Search API 오류: ${shortsRes.status}`);
            }
            break;
        }
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

        const selectedShorts = [...tier1, ...tier2];
        for (const cand of selectedShorts) {
            if (shortsVideos.length >= limit) break;
            const compositeId = `${cand.videoId}_${country}`;
            if (seenIds.has(compositeId)) continue;
            seenIds.add(compositeId);
            shortsVideos.push({
                video_id:      compositeId,
                title:         safeTitle(cand.item.snippet?.title),
                thumbnail_url: `https://i.ytimg.com/vi/${cand.videoId}/maxresdefault.jpg`,
                platform:      'youtube',
                country,
                play_url:      `https://www.youtube.com/embed/${cand.videoId}`,
                rank_order:    shortsVideos.length + 1,
                video_type:    'shorts',
            });
        }

        shortsPageToken = shortsData.nextPageToken;
        shortsPage++;
        if (!shortsPageToken || shortsVideos.length >= limit) break;
    }

    // 2) 일반 영상 수집 (videoDuration = 'medium' 4~20분, q = keyword)
    const regularVideos: TrendingVideo[] = [];
    let pageToken: string | undefined;
    let regularPage = 0;

    while (regularVideos.length < limit && regularPage < 5) {
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
        if (!res.ok) {
            if (regularPage === 0) {
                throw new Error(`YouTube Search API 오류: ${res.status}`);
            }
            break;
        }
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
        regularPage++;
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

    while (videos.length < limit && page < 5) {
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

            const compositeId = `${rawId}_${country}`;
            if (seenIds.has(compositeId)) continue;
            seenIds.add(compositeId);

            const authorHandle = item.author?.unique_id || item.author?.uniqueId || '';
            const permanentUrl = authorHandle
                ? `https://www.tiktok.com/@${authorHandle}/video/${rawId}`
                : `https://www.tiktok.com/video/${rawId}`;

            const thumb = item.cover || item.origin_cover || '';
            videos.push({
                video_id:      compositeId,
                title:         safeTitle(item.title || item.desc, 30, true),
                thumbnail_url: thumb,
                platform:      'tiktok',
                country,
                play_url:      permanentUrl,
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

const INSTAGRAM_CONCURRENCY      = 2;
const INSTAGRAM_VIDEO_TIMEOUT_MS = 15_000;
const INSTAGRAM_VIDEO_MAX_BYTES  = 15 * 1024 * 1024; // 15 MB
const INSTAGRAM_THUMB_TIMEOUT_MS = 10_000;
const INSTAGRAM_THUMB_MAX_BYTES  = 5 * 1024 * 1024;  // 5 MB
const DEFAULT_SOFT_BUDGET_MS     = 75_000;
const HARD_DEADLINE_EXTRA_MS     = 8_000;

function sanitizeR2Segment(raw: string): string {
    return (raw || 'item').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

function isValidMp4Bytes(bytes: Uint8Array, contentType: string): boolean {
    if (bytes.byteLength < 12) return false;
    // HTML/JSON/XML 오류 응답 차단
    if (
        contentType.startsWith('text/') ||
        contentType.includes('json') ||
        contentType.includes('xml') ||
        contentType.includes('html')
    ) {
        return false;
    }
    // MP4/MOV ftyp 박스(offset 4) 확인 또는 명시적 video/* 응답 허용
    const hasFtyp =
        bytes[4] === 0x66 &&
        bytes[5] === 0x74 &&
        bytes[6] === 0x79 &&
        bytes[7] === 0x70;
    return hasFtyp || contentType.startsWith('video/');
}

function detectImageFormat(bytes: Uint8Array, contentType: string): { mime: string; ext: string } | null {
    if (bytes.byteLength < 12) return null;
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return { mime: 'image/jpeg', ext: 'jpg' };
    }
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        return { mime: 'image/png', ext: 'png' };
    }
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
        return { mime: 'image/gif', ext: 'gif' };
    }
    if (
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    ) {
        return { mime: 'image/webp', ext: 'webp' };
    }
    if (contentType === 'image/jpeg' || contentType === 'image/jpg') return { mime: 'image/jpeg', ext: 'jpg' };
    if (contentType === 'image/png') return { mime: 'image/png', ext: 'png' };
    if (contentType === 'image/webp') return { mime: 'image/webp', ext: 'webp' };
    return null;
}

/** 스트리밍 다운로드 (타임아웃 + 바이트 상한 엄격 적용으로 1GB RAM 서버 보호) */
async function fetchBinaryWithLimit(
    url: string,
    opts: { maxBytes: number; timeoutMs: number }
): Promise<{ bytes: Uint8Array; contentType: string }> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
        throw new Error('허용되지 않은 미디어 URL 프로토콜입니다.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('다운로드 시간 초과')), opts.timeoutMs);

    try {
        const res = await fetch(url, {
            method: 'GET',
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept': '*/*',
            },
        });

        if (!res.ok) {
            throw new Error(`미디어 다운로드 실패 (${res.status})`);
        }

        const contentLengthHeader = res.headers.get('content-length');
        if (contentLengthHeader) {
            const declared = Number(contentLengthHeader);
            if (Number.isFinite(declared) && declared > opts.maxBytes) {
                await res.body?.cancel().catch(() => {});
                throw new Error(`용량 상한 초과 (${declared} > ${opts.maxBytes})`);
            }
        }

        const reader = res.body?.getReader();
        if (!reader) {
            throw new Error('빈 미디어 응답입니다.');
        }

        const chunks: Uint8Array[] = [];
        let totalBytes = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value || value.byteLength === 0) continue;

            totalBytes += value.byteLength;
            if (totalBytes > opts.maxBytes) {
                await reader.cancel().catch(() => {});
                controller.abort(new Error('용량 상한 초과'));
                throw new Error(`용량 상한 초과 (> ${opts.maxBytes} bytes)`);
            }
            chunks.push(value);
        }

        if (totalBytes === 0) {
            throw new Error('빈 미디어 파일입니다.');
        }

        const merged = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.byteLength;
        }

        const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        return { bytes: merged, contentType };
    } finally {
        clearTimeout(timer);
    }
}

async function recordInstagramR2File(
    supabase: ReturnType<typeof getSupabaseServer>,
    opts: { key: string; publicUrl: string; contentType: string; fileSize: number }
): Promise<void> {
    try {
        const { error } = await supabase.from('r2_media_files').insert({
            object_key:   opts.key,
            public_url:   opts.publicUrl,
            category:     'dopamine_instagram',
            content_type: opts.contentType,
            file_size:    opts.fileSize,
        });
        if (error) {
            console.warn('[Instagram R2] r2_media_files 기록 경고:', error.message);
        }
    } catch (err) {
        console.warn('[Instagram R2] r2_media_files 기록 예외:', err);
    }
}

async function uploadInstagramThumbnailToR2(
    supabase: ReturnType<typeof getSupabaseServer>,
    thumbUrl: string,
    country: Country,
    safeId: string,
    hardDeadlineAt: number
): Promise<string | null> {
    if (!thumbUrl) return null;
    const remainingMs = hardDeadlineAt - Date.now();
    if (remainingMs < 2_000) return null;

    const { bytes, contentType } = await fetchBinaryWithLimit(thumbUrl, {
        maxBytes:  INSTAGRAM_THUMB_MAX_BYTES,
        timeoutMs: Math.min(INSTAGRAM_THUMB_TIMEOUT_MS, remainingMs),
    });
    const imgInfo = detectImageFormat(bytes, contentType);
    if (!imgInfo) return null;

    const key = `${DOPAMINE_INSTAGRAM_R2_PREFIX}${country.toLowerCase()}/${safeId}-thumb-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${imgInfo.ext}`;
    const publicUrl = await uploadToR2({
        key,
        body:        bytes,
        contentType: imgInfo.mime,
    });
    await recordInstagramR2File(supabase, {
        key,
        publicUrl,
        contentType: imgInfo.mime,
        fileSize:    bytes.byteLength,
    });
    return publicUrl;
}

async function collectInstagram(
    keyword: string,
    country: Country,
    limit: number,
    softDeadlineAt?: number
): Promise<TrendingVideo[]> {
    const videos: TrendingVideo[] = [];
    const seenIds = new Set<string>();
    let nextMaxId: string | undefined;
    let page = 0;

    while (page < 7 && videos.length < limit) {
        if (softDeadlineAt && page > 0 && videos.length > 0 && Date.now() >= softDeadlineAt - 15_000) {
            break;
        }

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

async function collectAndSyncInstagram(
    supabase: ReturnType<typeof getSupabaseServer>,
    keyword: string,
    country: Country,
    displayLimit: number,
    softDeadlineAt: number
): Promise<CollectResult> {
    const hardDeadlineAt = softDeadlineAt + HARD_DEADLINE_EXTRA_MS;

    if (Date.now() >= softDeadlineAt) {
        return {
            count: 0,
            partial: true,
            error: '전체 실행 시간 제한(75초) 도달로 이번 국가는 기존 데이터를 유지합니다.',
        };
    }

    // 1. R2 저장소 전체 용량 확인
    const stats = await getR2StorageStats(supabase);
    if (stats.totalBytes >= MAX_R2_BYTES) {
        return { count: 0, error: 'R2 저장소 한도(9.5GB)에 도달해 업로드를 중단했습니다.' };
    }

    // 2. 기존 DB 레코드 선조회 (유효 R2 URL 재사용 + 교체 후 구파일 정리용)
    const { data: existingRows, error: existingErr } = await supabase
        .from('trending_videos')
        .select('video_id, play_url, thumbnail_url')
        .eq('platform', 'instagram')
        .eq('country', country);

    if (existingErr) {
        return { count: 0, error: `기존 데이터 조회 실패: ${existingErr.message}` };
    }

    const existingMap = new Map<string, { play_url: string; thumbnail_url: string }>();
    for (const row of existingRows ?? []) {
        existingMap.set(row.video_id, {
            play_url:      row.play_url || '',
            thumbnail_url: row.thumbnail_url || '',
        });
    }

    // 3. 외부 API로 후보 릴스 목록 수집 (스킵 여유분 포함 최대 100건)
    const candidateLimit = Math.min(100, displayLimit + Math.min(10, displayLimit));
    let candidates: TrendingVideo[] = [];
    try {
        candidates = await collectInstagram(keyword, country, candidateLimit, softDeadlineAt);
    } catch (e) {
        return { count: 0, error: e instanceof Error ? e.message : '인스타그램 수집 실패' };
    }

    if (candidates.length === 0) {
        return { count: 0, error: '수집된 인스타그램 영상이 없습니다.' };
    }

    // 4. 선 업로드 (동시 처리 최대 2개, 개별 15초/15MB 제한, 전체 75초 소프트 데드라인)
    const processedSlots: Array<TrendingVideo | null> = new Array(candidates.length).fill(null);
    const newlyUploadedUrls: string[] = [];
    let nextIdx = 0;
    let successCount = 0;
    let skippedCount = 0;
    let timedOut = false;
    let stopRequested = false;

    async function worker(): Promise<void> {
        while (!stopRequested) {
            if (Date.now() >= softDeadlineAt) {
                timedOut = true;
                stopRequested = true;
                break;
            }
            if (successCount >= displayLimit) {
                stopRequested = true;
                break;
            }

            const idx = nextIdx++;
            if (idx >= candidates.length) break;

            const cand = candidates[idx];
            const prev = existingMap.get(cand.video_id);
            const rawId = cand.video_id.replace(/_[A-Z]{2}$/, '');
            const safeId = sanitizeR2Segment(rawId);

            // (a) 기존 DB에 유효한 R2 .mp4 URL이 이미 있으면 재다운로드 없이 재사용
            if (prev && isDopamineInstagramR2VideoUrl(prev.play_url)) {
                let thumbUrl = prev.thumbnail_url;
                if (!thumbUrl || !isDopamineInstagramR2Url(thumbUrl)) {
                    if (cand.thumbnail_url && Date.now() < softDeadlineAt) {
                        try {
                            const uploadedThumb = await uploadInstagramThumbnailToR2(
                                supabase,
                                cand.thumbnail_url,
                                country,
                                safeId,
                                hardDeadlineAt
                            );
                            if (uploadedThumb) {
                                newlyUploadedUrls.push(uploadedThumb);
                                thumbUrl = uploadedThumb;
                            }
                        } catch {
                            // 썸네일 업로드 실패 시 기존 값 유지
                        }
                    }
                    if (!thumbUrl) thumbUrl = cand.thumbnail_url || '';
                }

                processedSlots[idx] = {
                    ...cand,
                    play_url:      prev.play_url,
                    thumbnail_url: thumbUrl,
                };
                successCount++;
                continue;
            }

            // (b) 신규 영상 다운로드(15초, 15MB 상한) → R2 전용 경로(dopamine/instagram/) 업로드
            const remainingHardMs = hardDeadlineAt - Date.now();
            if (remainingHardMs < 3_000) {
                timedOut = true;
                stopRequested = true;
                break;
            }

            try {
                const { bytes, contentType } = await fetchBinaryWithLimit(cand.play_url, {
                    maxBytes:  INSTAGRAM_VIDEO_MAX_BYTES,
                    timeoutMs: Math.min(INSTAGRAM_VIDEO_TIMEOUT_MS, remainingHardMs),
                });

                if (!isValidMp4Bytes(bytes, contentType)) {
                    throw new Error('유효한 MP4 영상 데이터가 아닙니다.');
                }

                const videoKey = `${DOPAMINE_INSTAGRAM_R2_PREFIX}${country.toLowerCase()}/${safeId}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.mp4`;
                const r2VideoUrl = await uploadToR2({
                    key:         videoKey,
                    body:        bytes,
                    contentType: 'video/mp4',
                });
                newlyUploadedUrls.push(r2VideoUrl);
                await recordInstagramR2File(supabase, {
                    key:         videoKey,
                    publicUrl:   r2VideoUrl,
                    contentType: 'video/mp4',
                    fileSize:    bytes.byteLength,
                });

                let r2ThumbUrl = cand.thumbnail_url || '';
                if (cand.thumbnail_url && Date.now() < hardDeadlineAt - 2_000) {
                    try {
                        const uploadedThumb = await uploadInstagramThumbnailToR2(
                            supabase,
                            cand.thumbnail_url,
                            country,
                            safeId,
                            hardDeadlineAt
                        );
                        if (uploadedThumb) {
                            newlyUploadedUrls.push(uploadedThumb);
                            r2ThumbUrl = uploadedThumb;
                        }
                    } catch (thumbErr) {
                        console.warn(`[Instagram R2] 썸네일 업로드 스킵 (${cand.video_id}):`, thumbErr instanceof Error ? thumbErr.message : thumbErr);
                    }
                }

                processedSlots[idx] = {
                    ...cand,
                    play_url:      r2VideoUrl,
                    thumbnail_url: r2ThumbUrl,
                };
                successCount++;
            } catch (itemErr) {
                skippedCount++;
                console.warn(
                    `[Instagram R2] 영상 스킵 (${cand.video_id}):`,
                    itemErr instanceof Error ? itemErr.message : itemErr
                );
            }
        }
    }

    const workerCount = Math.min(INSTAGRAM_CONCURRENCY, candidates.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    // 5. 최종 유효 R2 영상 목록 구성 (원본 순위 유지 + 중복 제거 + displayLimit 절단)
    const uniqueMap = new Map<string, TrendingVideo>();
    for (const slot of processedSlots) {
        if (!slot) continue;
        if (!uniqueMap.has(slot.video_id)) {
            uniqueMap.set(slot.video_id, slot);
        }
        if (uniqueMap.size >= displayLimit) break;
    }

    const finalVideos: TrendingVideo[] = Array.from(uniqueMap.values()).map((v, idx) => ({
        ...v,
        rank_order: idx + 1,
        video_type: 'shorts',
    }));

    // R2 확보 항목이 0건이면 기존 DB·기존 R2 파일을 절대 건드리지 않고 롤백 후 에러 반환
    if (finalVideos.length === 0) {
        for (const url of newlyUploadedUrls) {
            await deleteFromR2ByUrlWithPrefix(supabase, url, DOPAMINE_INSTAGRAM_R2_PREFIX).catch(() => {});
        }
        return {
            count:   0,
            partial: timedOut,
            skipped: skippedCount,
            error:   timedOut
                ? '실행 시간 제한으로 완료된 R2 영상이 없어 기존 데이터를 유지합니다.'
                : '인스타그램 영상 R2 업로드에 실패하여 기존 데이터를 유지합니다.',
        };
    }

    // 6. 후 DB 교체 (선 upsert → 후 미포함 구 레코드 삭제, 무중단 보장)
    const { error: upsertErr } = await supabase
        .from('trending_videos')
        .upsert(finalVideos, { onConflict: 'video_id' });

    if (upsertErr) {
        // DB 교체 실패 시 이번 배치에 새로 올린 R2 파일만 롤백 정리 (기존 DB/R2 보존)
        for (const url of newlyUploadedUrls) {
            await deleteFromR2ByUrlWithPrefix(supabase, url, DOPAMINE_INSTAGRAM_R2_PREFIX).catch(() => {});
        }
        return { count: 0, error: `저장 실패: ${upsertErr.message}` };
    }

    const newVideoIdSet = new Set(finalVideos.map(v => v.video_id));
    const staleVideoIds = (existingRows ?? [])
        .map(r => r.video_id)
        .filter(id => !newVideoIdSet.has(id));

    if (staleVideoIds.length > 0) {
        const { error: staleDelErr } = await supabase
            .from('trending_videos')
            .delete()
            .eq('platform', 'instagram')
            .eq('country', country)
            .in('video_id', staleVideoIds);

        if (staleDelErr) {
            console.warn('[Instagram R2] 구 DB 레코드 정리 경고:', staleDelErr.message);
        }
    }

    // 7. 마지막 구파일 삭제 (새 DB에 없는 항목 중 dopamine/instagram/ 키만 안전 삭제)
    const newReferencedUrls = new Set<string>();
    for (const v of finalVideos) {
        if (v.play_url) newReferencedUrls.add(v.play_url);
        if (v.thumbnail_url) newReferencedUrls.add(v.thumbnail_url);
    }

    const cleanupUrls = new Set<string>();
    for (const row of existingRows ?? []) {
        if (row.play_url && !newReferencedUrls.has(row.play_url) && isDopamineInstagramR2Url(row.play_url)) {
            cleanupUrls.add(row.play_url);
        }
        if (row.thumbnail_url && !newReferencedUrls.has(row.thumbnail_url) && isDopamineInstagramR2Url(row.thumbnail_url)) {
            cleanupUrls.add(row.thumbnail_url);
        }
    }
    // 동시성 2 처리로 displayLimit을 초과해 잘린 신규 업로드분도 함께 정리
    for (const uploadedUrl of newlyUploadedUrls) {
        if (!newReferencedUrls.has(uploadedUrl) && isDopamineInstagramR2Url(uploadedUrl)) {
            cleanupUrls.add(uploadedUrl);
        }
    }

    for (const oldUrl of cleanupUrls) {
        await deleteFromR2ByUrlWithPrefix(supabase, oldUrl, DOPAMINE_INSTAGRAM_R2_PREFIX).catch(() => {});
    }

    return {
        count:   finalVideos.length,
        partial: timedOut,
        skipped: skippedCount,
    };
}

// ─────────────────────────────────────────
// 메인 수집 함수
// ─────────────────────────────────────────
export async function collectTrending(
    platform: Platform,
    country: Country,
    options?: CollectOptions
): Promise<CollectResult> {
    const supabase = getSupabaseServer();

    // dopamine_settings에서 keyword & limit 읽기
    const { data: settings } = await supabase
        .from('dopamine_settings')
        .select('search_keyword, display_limit')
        .eq('platform', platform)
        .eq('country', country)
        .maybeSingle();

    const keyword      = settings?.search_keyword || '인기';
    const displayLimit = Math.min(100, Math.max(1, settings?.display_limit ?? 20));

    // 인스타그램은 R2 저장 + 무중단 교체 + 구파일 정리 전용 파이프라인 사용
    if (platform === 'instagram') {
        const softDeadlineAt = options?.deadlineAt ?? (Date.now() + DEFAULT_SOFT_BUDGET_MS);
        return collectAndSyncInstagram(supabase, keyword, country, displayLimit, softDeadlineAt);
    }

    let freshVideos: TrendingVideo[] = [];
    let errorMsg: string | undefined;

    try {
        if (platform === 'youtube')     freshVideos = await collectYoutube(keyword, country, displayLimit);
        else if (platform === 'tiktok') freshVideos = await collectTiktok(keyword, country, displayLimit);
    } catch (e) {
        errorMsg = e instanceof Error ? e.message : '수집 실패';
    }

    // 1건 이상 수집 성공했을 때만 교체 (유튜브·틱톡 기존 로직 유지)
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
export async function collectAll(
    options?: CollectOptions
): Promise<Array<{ platform: Platform; country: Country } & CollectResult>> {
    const platforms: Platform[] = ['youtube', 'tiktok', 'instagram'];
    const countries: Country[]  = ['KR', 'US', 'JP'];
    const deadlineAt = options?.deadlineAt ?? (Date.now() + DEFAULT_SOFT_BUDGET_MS);
    const results: Array<{ platform: Platform; country: Country } & CollectResult> = [];

    for (const platform of platforms) {
        for (const country of countries) {
            if (platform === 'instagram' && Date.now() >= deadlineAt) {
                results.push({
                    platform,
                    country,
                    count: 0,
                    partial: true,
                    error: '전체 실행 시간 제한(75초) 도달로 이번 항목은 기존 데이터를 유지합니다.',
                });
                continue;
            }
            const r = await collectTrending(platform, country, { deadlineAt });
            results.push({ platform, country, ...r });
        }
    }
    return results;
}
