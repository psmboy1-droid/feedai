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
  created_at: string;
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
  });
  if (!parsed.success) {
    return Response.json({ error: '잘못된 요청 파라미터입니다.' }, { status: 400 });
  }
  const { platform, country, videoType } = parsed.data;
  const activeVideoType = platform === 'youtube' ? (videoType ?? 'shorts') : 'shorts';

  try {
    const supabase = getSupabaseServer();

    // 1) 노출 설정 (display_limit)
    const { data: settings } = await supabase
      .from('dopamine_settings')
      .select('display_limit')
      .eq('platform', platform)
      .eq('country', country)
      .maybeSingle();

    const displayLimit = Math.min(100, Math.max(1, settings?.display_limit ?? 100));

    // 2) 영상 목록 (YouTube인 경우 video_type 일치 조건 추가)
    let videoQuery = supabase
      .from('trending_videos')
      .select('*')
      .eq('platform', platform)
      .eq('country', country);

    if (platform === 'youtube') {
      videoQuery = videoQuery.eq('video_type', activeVideoType);
    }

    const { data: videos, error: videoErr } = await videoQuery
      .order('rank_order', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(displayLimit);

    if (videoErr) throw new Error(videoErr.message);

    // 3) 활성 광고 — 플랫폼 일치 & (국가 일치 OR 'ALL')
    const { data: ads } = await supabase
      .from('dopamine_ads')
      .select('*')
      .eq('platform', platform)
      .eq('is_active', true)
      .or(`country.eq.${country},country.eq.ALL`)
      .order('slot_position', { ascending: true });

    // 4) 광고 병합
    const videoList: VideoItem[] = (videos ?? []).map((v, i) => ({
      ...v,
      isAd: false as const,
      displayRank: i + 1,
    }));

    const merged: FeedItem[] = [...videoList];

    for (const ad of (ads ?? [])) {
      const idx = Math.max(0, ad.slot_position - 1); // 0-based
      const insertAt = Math.min(idx, merged.length);  // 범위 초과 시 맨 뒤
      merged.splice(insertAt, 0, {
        ...ad,
        isAd: true as const,
        displayRank: insertAt + 1,
      });
    }

    // displayRank 재계산 & displayLimit 절단
    const items: FeedItem[] = merged
      .slice(0, displayLimit + (ads?.length ?? 0)) // 광고 포함 길이 허용
      .map((item, i) => ({ ...item, displayRank: i + 1 }));

    return Response.json(
      {
        items,
        total:        videos?.length ?? 0,
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
