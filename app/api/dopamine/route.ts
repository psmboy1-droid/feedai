/**
 * /api/dopamine/route.ts
 * 도파민 센터 공개 API — Supabase 기반, 광고 순번 병합
 */

import { z } from 'zod';
import { getSupabaseServer } from '../../../lib/supabase';

export const dynamic = 'force-dynamic';

// ── Zod 검증 ──────────────────────────────────────────────────────────────
const querySchema = z.object({
  platform:  z.enum(['youtube', 'tiktok', 'instagram']).default('youtube'),
  country:   z.enum(['KR', 'US', 'JP']).default('KR'),
  videoType: z.enum(['shorts', 'video']).optional(),
  offset:    z.coerce.number().int().min(0).optional(),
  limit:     z.coerce.number().int().min(1).max(100).optional(),
});

// ── 타입 ───────────────────────────────────────────────────────────────────
interface VideoItem {
  id: string;
  video_id: string;
  title: string;
  thumbnail_url: string;
  platform: string;
  country: string;
  play_url: string;
  rank_order: number;
  isAd: false;
  displayRank: number;
}

interface AdItem {
  id: string;
  platform: string;
  country: string;
  slot_position: number;
  media_type: 'image' | 'video';
  title: string;
  media_url: string;
  thumbnail_url: string;
  link_url: string;
  is_active: boolean;
  isAd: true;
  displayRank: number;
}

type FeedItem = VideoItem | AdItem;

// ── GET ────────────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;

  // 쿼리 파라미터 검증
  const parsed = querySchema.safeParse({
    platform:  params.get('platform')  ?? undefined,
    country:   params.get('country')   ?? undefined,
    videoType: params.get('videoType') ?? undefined,
    offset:    params.get('offset')    ?? undefined,
    limit:     params.get('limit')     ?? undefined,
  });
  if (!parsed.success) {
    return Response.json({ error: '잘못된 요청 파라미터입니다.' }, { status: 400 });
  }
  const { platform, country, videoType, offset, limit } = parsed.data;
  const activeVideoType = platform === 'youtube' ? (videoType ?? 'shorts') : 'shorts';

  try {
    const supabase = getSupabaseServer();

    // 1) 영상 목록 쿼리 준비 (YouTube인 경우 video_type 일치 조건, 필요한 컬럼만 경량 조회)
    let videoQuery = supabase
      .from('trending_videos')
      .select('id, video_id, title, thumbnail_url, platform, country, play_url, rank_order')
      .eq('platform', platform)
      .eq('country', country);

    if (platform === 'youtube') {
      videoQuery = videoQuery.eq('video_type', activeVideoType);
    }

    // 2) 노출 설정, 영상 목록, 활성 광고를 Supabase DB에서 병렬 조회 (외부 API 수집 없음)
    const [settingsRes, videosRes, adsRes] = await Promise.all([
      supabase
        .from('dopamine_settings')
        .select('display_limit')
        .eq('platform', platform)
        .eq('country', country)
        .maybeSingle(),
      videoQuery
        .order('rank_order', { ascending: true })
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('dopamine_ads')
        .select('*')
        .eq('platform', platform)
        .eq('is_active', true)
        .or(`country.eq.${country},country.eq.ALL`)
        .order('slot_position', { ascending: true }),
    ]);

    if (videosRes.error) throw new Error(videosRes.error.message);

    const displayLimit = Math.min(100, Math.max(1, settingsRes.data?.display_limit ?? 100));
    const rawVideos = videosRes.data ?? [];

    // DB에 데이터가 없으면 외부 수집을 돌리지 않고 빈 배열을 즉시 반환
    if (rawVideos.length === 0) {
      return Response.json(
        {
          items: [],
          total: 0,
          displayLimit,
          videoType: activeVideoType,
          checkedAt: Date.now(),
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const videos = rawVideos.slice(0, displayLimit);
    const ads = adsRes.data ?? [];

    // 3) 광고 병합
    const videoList: VideoItem[] = videos.map((v, i) => ({
      ...v,
      isAd: false as const,
      displayRank: i + 1,
    }));

    const merged: FeedItem[] = [...videoList];

    for (const ad of ads) {
      const idx = Math.max(0, ad.slot_position - 1); // 0-based
      const insertAt = Math.min(idx, merged.length);  // 범위 초과 시 맨 뒤
      merged.splice(insertAt, 0, {
        ...ad,
        isAd: true as const,
        displayRank: insertAt + 1,
      });
    }

    // displayRank 재계산 & displayLimit 절단 (선택적 offset/limit 페이징 지원)
    const allItems: FeedItem[] = merged
      .slice(0, displayLimit + ads.length) // 광고 포함 길이 허용
      .map((item, i) => ({ ...item, displayRank: i + 1 }));

    const start = offset ?? 0;
    const items = limit !== undefined
      ? allItems.slice(start, start + limit)
      : allItems.slice(start);

    return Response.json(
      {
        items,
        total:        allItems.length,
        hasMore:      start + items.length < allItems.length,
        displayLimit,
        videoType:    activeVideoType,
        checkedAt:    Date.now(),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('/api/dopamine 오류:', err);
    return Response.json(
      { error: '콘텐츠를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 503 }
    );
  }
}
