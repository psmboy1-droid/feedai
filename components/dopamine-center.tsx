'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, RefreshCw, ArrowUpRight, Camera as Instagram, Music2, Play as Youtube } from 'lucide-react';
import TopMenu from './top-menu';
import { useNewsAccount } from './news-account';
import {
  extractInstagramRawPk,
  instagramPkToShortcode,
  instagramPostUrl,
  isInstagramOeValid,
  isLegacyInstagramR2Mp4Url,
} from '@/lib/instagram-url';

// ─── 타입 ─────────────────────────────────────────────────────────────────
type Platform = 'youtube' | 'instagram' | 'tiktok';
type Country  = 'KR' | 'US' | 'JP';
type VideoType = 'shorts' | 'video';

interface VideoItem {
  id: string;
  video_id: string;
  title: string;
  thumbnail_url: string;
  platform: Platform;
  country: Country;
  play_url: string;
  rank_order: number;
  isAd: false;
  displayRank: number;
}

interface AdItem {
  id: string;
  platform: Platform;
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

interface ApiResponse {
  items: FeedItem[];
  total: number;
  displayLimit: number;
  checkedAt: number;
  error?: string;
}

// ─── 상수 ──────────────────────────────────────────────────────────────────
const COUNTRIES: [Country, string][] = [['KR', '한국'], ['US', '미국'], ['JP', '일본']];
const PAGE_SIZE = 18;

// ─── HTML 엔티티 디코더 ───────────────────────────────────────────────────
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

// ─── YouTube 썸네일 컴포넌트 ───────────────────────────────────────────────
function VideoThumbnail({ videoId, isShorts }: { videoId: string; isShorts?: boolean }) {
  const [attempt, setAttempt] = useState(0);
  const variants = isShorts
    ? ['oar2.jpg', 'maxresdefault.jpg', 'sddefault.jpg', 'hqdefault.jpg']
    : ['maxresdefault.jpg', 'sddefault.jpg', 'hqdefault.jpg'];
  function fallback() { setAttempt(cur => cur + 1); }
  if (attempt >= variants.length) return <span className="dopamine-thumbnail-missing">썸네일 이미지 없음</span>;
  return (
    <img
      key={attempt}
      src={`https://i.ytimg.com/vi/${videoId}/${variants[attempt]}`}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={fallback}
      onLoad={ev => {
        const img = ev.currentTarget;
        if (img.naturalWidth <= 120 || img.naturalHeight <= 90) fallback();
      }}
    />
  );
}

// ─── 카드: YouTube ────────────────────────────────────────────────────────
function YoutubeCard({ item, playing, onPlay, isWide }: {
  item: VideoItem;
  playing: string;
  onPlay: (id: string) => void;
  isWide?: boolean;
}) {
  // video_id 형식: "rawId_KR" — 접미사 제거
  const rawId = item.video_id.replace(/_[A-Z]{2}$/, '');
  const isPlaying = playing === item.video_id;
  const decodedTitle = decodeHtmlEntities(item.title);

  return (
    <article className="dopamine-card">
      <div className="dopamine-media">
        {isPlaying ? (
          <iframe
            title={decodedTitle}
            src={`https://www.youtube-nocookie.com/embed/${rawId}?autoplay=1&rel=0`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button
            className="dopamine-play"
            onClick={() => onPlay(item.video_id)}
            aria-label={`${decodedTitle} 재생`}
          >
            <VideoThumbnail videoId={rawId} isShorts={!isWide} />
            <span className="dopamine-play-symbol"><Play size={32} fill="currentColor" /></span>
            <span className="dopamine-kind">{isWide ? 'YouTube' : 'Shorts'}</span>
          </button>
        )}
      </div>
      {decodedTitle && <p className="dopamine-card-title">{decodedTitle}</p>}
    </article>
  );
}

// ─── 카드: Instagram ──────────────────────────────────────────────────────
function InstagramCard({
  item,
  playing,
  onPlay,
}: {
  item: VideoItem;
  playing: string;
  onPlay: (id: string) => void;
}) {
  const [thumbError, setThumbError] = useState(false);
  const [currentPlayUrl, setCurrentPlayUrl] = useState(item.play_url || '');
  const [refreshing, setRefreshing] = useState(false);
  const [forceRefreshed, setForceRefreshed] = useState(false);
  const [failedPermanent, setFailedPermanent] = useState(false);

  useEffect(() => {
    setCurrentPlayUrl(item.play_url || '');
    setForceRefreshed(false);
    setFailedPermanent(false);
    setRefreshing(false);
    setThumbError(false);
  }, [item.video_id, item.play_url]);

  const decodedTitle = decodeHtmlEntities(item.title);
  const isPlaying = playing === item.video_id;

  const postUrl = instagramPostUrl(item.video_id);
  const hasValidShortcode = Boolean(instagramPkToShortcode(extractInstagramRawPk(item.video_id)));
  const canPlayOrRefresh = (Boolean(currentPlayUrl) || hasValidShortcode) && !failedPermanent;

  async function requestRefresh(force: boolean): Promise<string | null> {
    setRefreshing(true);
    try {
      const res = await fetch('/api/dopamine/instagram/refresh', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ video_id: item.video_id, force }),
      });
      const text = await res.text();
      let payload: { play_url?: string; error?: string } = {};
      try {
        payload = text ? (JSON.parse(text) as { play_url?: string; error?: string }) : {};
      } catch {
        payload = {};
      }
      if (!res.ok || !payload.play_url) {
        return null;
      }
      setCurrentPlayUrl(payload.play_url);
      return payload.play_url;
    } catch {
      return null;
    } finally {
      setRefreshing(false);
    }
  }

  async function handlePlayClick() {
    if (refreshing) return;

    // 1) oe 만료 5분 이상 남았거나 기존 R2 .mp4 URL이면 즉시 재생
    if (
      currentPlayUrl &&
      (isInstagramOeValid(currentPlayUrl, 300) || isLegacyInstagramR2Mp4Url(currentPlayUrl))
    ) {
      onPlay(item.video_id);
      return;
    }

    // 2) oe가 만료됐거나 URL이 비어 있으면 온디맨드 갱신 후 즉시 재생
    const refreshedUrl = await requestRefresh(false);
    if (refreshedUrl) {
      onPlay(item.video_id);
    } else {
      setFailedPermanent(true);
    }
  }

  async function handleVideoError() {
    if (refreshing) return;
    // 3) 재생 중 오류 시 카드당 최대 1회 강제 갱신 후 재시도
    if (!forceRefreshed) {
      setForceRefreshed(true);
      const refreshedUrl = await requestRefresh(true);
      if (refreshedUrl) {
        return;
      }
    }
    // 4) 1회 강제 갱신 후에도 실패하면 원본 릴스 링크 fallback UI 전환
    setFailedPermanent(true);
  }

  return (
    <article className="dopamine-card dopamine-card-social">
      <div className="dopamine-media">
        {!canPlayOrRefresh ? (
          <a
            href={postUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="dopamine-play dopamine-external-link"
            aria-label={`${decodedTitle || '인스타그램 릴스'} 인스타그램에서 보기`}
          >
            {item.thumbnail_url && !thumbError ? (
              <img
                src={item.thumbnail_url}
                alt={decodedTitle}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() => setThumbError(true)}
              />
            ) : (
              <span className="dopamine-thumbnail-missing">인스타그램에서 보기 ↗</span>
            )}
            <span className="dopamine-play-symbol"><ArrowUpRight size={28} /></span>
            <span className="dopamine-kind">인스타그램 ↗</span>
          </a>
        ) : isPlaying && currentPlayUrl && !refreshing ? (
          <video
            key={currentPlayUrl}
            src={currentPlayUrl}
            poster={item.thumbnail_url && !thumbError ? item.thumbnail_url : undefined}
            controls
            autoPlay
            playsInline
            preload="auto"
            onError={() => { void handleVideoError(); }}
          />
        ) : (
          <button
            type="button"
            className="dopamine-play"
            disabled={refreshing}
            onClick={() => { void handlePlayClick(); }}
            aria-label={refreshing ? '영상 주소를 불러오는 중' : `${decodedTitle || '인스타그램 릴스'} 재생`}
          >
            {item.thumbnail_url && !thumbError ? (
              <img
                src={item.thumbnail_url}
                alt={decodedTitle}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() => setThumbError(true)}
              />
            ) : (
              <span className="dopamine-thumbnail-missing">썸네일 로드 불가 · 클릭해 재생</span>
            )}
            <span className="dopamine-play-symbol">
              {refreshing ? <RefreshCw size={28} className="spin" /> : <Play size={32} fill="currentColor" />}
            </span>
            <span className="dopamine-kind">{refreshing ? '불러오는 중…' : '인스타그램'}</span>
          </button>
        )}
      </div>
      {decodedTitle && (
        <p className="dopamine-card-title">
          <a
            href={postUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="인스타그램 원본 보기"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}
          >
            <span>{decodedTitle}</span>
            <span style={{ fontSize: '11px', opacity: 0.7, flexShrink: 0 }}>↗</span>
          </a>
        </p>
      )}
    </article>
  );
}

// ─── 카드: TikTok ─────────────────────────────────────────────────────────
function TiktokCard({
  item,
  playing,
  onPlay,
}: {
  item: VideoItem;
  playing: string;
  onPlay: (id: string) => void;
}) {
  const rawId = item.video_id.replace(/_[A-Z]{2}$/, '');
  const decodedTitle = decodeHtmlEntities(item.title);
  const isPlaying = playing === item.video_id;
  const [thumbError, setThumbError] = useState(false);

  // 영구 외부 틱톡 영상 페이지 링크
  const pageUrl = item.play_url?.includes('tiktok.com/@')
    ? item.play_url
    : `https://www.tiktok.com/video/${rawId}`;

  return (
    <article className="dopamine-card dopamine-card-social">
      <div className="dopamine-media">
        {isPlaying ? (
          <iframe
            title={decodedTitle}
            src={`https://www.tiktok.com/player/v1/${rawId}?autoplay=1`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button
            className="dopamine-play"
            onClick={() => onPlay(item.video_id)}
            aria-label={`${decodedTitle} 재생`}
          >
            {item.thumbnail_url && !thumbError ? (
              <img
                src={item.thumbnail_url}
                alt={decodedTitle}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() => setThumbError(true)}
              />
            ) : (
              <span className="dopamine-thumbnail-missing">썸네일 로드 불가 · 클릭해 재생</span>
            )}
            <span className="dopamine-play-symbol"><Play size={32} fill="currentColor" /></span>
            <span className="dopamine-kind">TikTok</span>
          </button>
        )}
      </div>
      {decodedTitle && (
        <p className="dopamine-card-title">
          <a
            href={pageUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="TikTok에서 원본 보기"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}
          >
            <span>{decodedTitle}</span>
            <span style={{ fontSize: '11px', opacity: 0.7, flexShrink: 0 }}>↗</span>
          </a>
        </p>
      )}
    </article>
  );
}

// ─── 카드: 광고 ───────────────────────────────────────────────────────────
function AdCard({ item }: { item: AdItem }) {
  const isYoutubeUrl = item.media_url.includes('youtube.com') || item.media_url.includes('youtu.be');

  // YouTube 임베드 URL 정제
  let ytEmbedUrl = item.media_url;
  if (isYoutubeUrl) {
    if (item.media_url.includes('watch?v=')) {
      const v = new URL(item.media_url).searchParams.get('v');
      ytEmbedUrl = `https://www.youtube-nocookie.com/embed/${v}`;
    } else if (item.media_url.includes('youtu.be/')) {
      const v = item.media_url.split('youtu.be/')[1]?.split('?')[0];
      ytEmbedUrl = `https://www.youtube-nocookie.com/embed/${v}`;
    }
  }

  const isVideo = item.media_type === 'video';
  const decodedTitle = decodeHtmlEntities(item.title);

  return (
    <article className="dopamine-card dopamine-card-ad">
      <div className="dopamine-media">
        {/* 모든 카드와 동일하게 첫 번째 자식을 .dopamine-media로 통일하고, AD 배지는 내부 좌상단 오버레이 */}
        <span className="dopamine-ad-badge">AD</span>

        {/* 동영상 광고일 때 우측 상단 바로가기 CTA 칩 */}
        {isVideo && item.link_url && (
          <a
            className="dopamine-ad-cta"
            href={item.link_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            바로가기 ↗
          </a>
        )}

        {!isVideo ? (
          // 이미지 광고: 블러 배경 + 원본 비율 중앙 배치
          item.link_url ? (
            <a
              href={item.link_url}
              target="_blank"
              rel="noopener noreferrer"
              className="dopamine-ad-link"
            >
              <img
                className="dopamine-ad-bg"
                src={item.media_url}
                alt=""
                aria-hidden
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
              />
              <img
                className="dopamine-ad-img"
                src={item.media_url}
                alt={decodedTitle}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
              />
            </a>
          ) : (
            <div className="dopamine-ad-link">
              <img
                className="dopamine-ad-bg"
                src={item.media_url}
                alt=""
                aria-hidden
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
              />
              <img
                className="dopamine-ad-img"
                src={item.media_url}
                alt={decodedTitle}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
              />
            </div>
          )
        ) : isYoutubeUrl ? (
          <iframe
            title={decodedTitle}
            src={ytEmbedUrl}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : (
          <video
            className="dopamine-ad-video"
            src={item.media_url}
            poster={item.thumbnail_url || undefined}
            controls
            playsInline
            preload="metadata"
          />
        )}
      </div>

      {decodedTitle && (
        <p className="dopamine-card-title">
          {item.link_url ? (
            <a href={item.link_url} target="_blank" rel="noopener noreferrer">
              {decodedTitle}
            </a>
          ) : (
            decodedTitle
          )}
        </p>
      )}
    </article>
  );
}

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────
export default function DopamineCenter({ platform = 'youtube' }: { platform?: Platform }) {
  const account = useNewsAccount();
  const [country, setCountry] = useState<Country>('KR');
  const [videoType, setVideoType] = useState<VideoType>('shorts');
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [playing, setPlaying] = useState('');
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const mounted = useRef(true);

  // 국가/플랫폼/비디오타입 변경 시 초기화
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setPlaying('');
  }, [country, platform, videoType]);

  // 데이터 로드 (AbortController 적용으로 탭/국가 빠른 전환 시 이전 요청 즉각 취소)
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    setData(null);
    setError('');
    setLoading(true);

    async function fetchFeedOnce(): Promise<ApiResponse> {
      const url = platform === 'youtube'
        ? `/api/dopamine?platform=youtube&country=${country}&videoType=${videoType}`
        : `/api/dopamine?platform=${platform}&country=${country}`;
      const r = await fetch(url, { cache: 'no-store', signal: controller.signal });
      const text = await r.text();

      const trimmed = text.trimStart();
      const looksLikeHtml = trimmed.startsWith('<') || /^<!doctype/i.test(trimmed);
      let parsed: ApiResponse | null = null;

      if (!looksLikeHtml && text) {
        try {
          parsed = JSON.parse(text) as ApiResponse;
        } catch {
          parsed = null;
        }
      }

      if (!r.ok) {
        const message =
          parsed?.error ||
          (r.status >= 500
            ? `서버 응답이 일시적으로 불안정합니다. (HTTP ${r.status}) 잠시 후 다시 시도해 주세요.`
            : `콘텐츠를 불러오지 못했습니다. (HTTP ${r.status})`);
        const err = new Error(message) as Error & { retryable?: boolean };
        err.retryable = r.status >= 500 && r.status <= 599;
        throw err;
      }

      if (!parsed) {
        const err = new Error('일시적인 서버 응답 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.') as Error & {
          retryable?: boolean;
        };
        err.retryable = true;
        throw err;
      }

      return parsed;
    }

    async function load() {
      try {
        let d: ApiResponse;
        try {
          d = await fetchFeedOnce();
        } catch (firstErr) {
          if (controller.signal.aborted) return;
          if (firstErr instanceof Error && firstErr.name === 'AbortError') return;

          const isRetryable =
            (firstErr as { retryable?: boolean })?.retryable === true ||
            firstErr instanceof TypeError;

          if (!isRetryable) throw firstErr;

          // 일시적인 5xx(Cloudflare 520 포함) 또는 네트워크 오류 시 600ms 후 자동 1회 재시도
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 600);
            controller.signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
              },
              { once: true }
            );
          });

          if (controller.signal.aborted) return;
          d = await fetchFeedOnce();
        }

        if (!controller.signal.aborted) {
          setData(d);
          setError('');
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          if (e instanceof Error && e.name === 'AbortError') return;
          setError(
            e instanceof Error
              ? e.message
              : '콘텐츠를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      controller.abort();
      mounted.current = false;
    };
  }, [country, platform, videoType, retry]);

  // 무한 스크롤 — IntersectionObserver
  const allItems = data?.items ?? [];
  const visibleItems = allItems.slice(0, visibleCount);
  const hasMore = visibleCount < allItems.length;

  const loadMore = useCallback(() => {
    setVisibleCount(prev => Math.min(prev + PAGE_SIZE, allItems.length));
  }, [allItems.length]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting && hasMore) loadMore();
    }, { rootMargin: '200px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loadMore]);

  const countryLabel = COUNTRIES.find(([id]) => id === country)?.[1] ?? country;
  const platformLabel = platform === 'youtube' ? 'YouTube' : platform === 'instagram' ? '인스타그램' : 'TikTok';
  const PlatformIcon = platform === 'youtube' ? Youtube : platform === 'instagram' ? Instagram : Music2;
  const isWide = platform === 'youtube' && videoType === 'video';

  return (
    <div className="dopamine-page">
      <header className="topbar"><TopMenu /></header>
      <main className="dopamine-main">

        {/* 소개 헤더 */}
        <div className="dopamine-intro">
          <div>
            <p>TAKE A LITTLE BREAK</p>
            <h1>도파민 센터<span>지금 가장 핫한 콘텐츠.</span></h1>
          </div>
          {account.user?.admin && (
            <a className="dopamine-admin-link" href="/admin/dopamine">
              도파민 센터 관리 <ArrowUpRight size={14} />
            </a>
          )}
        </div>

        {/* 국가 탭 */}
        <nav className="dopamine-country" aria-label="국가별 콘텐츠">
          {COUNTRIES.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={country === id ? 'selected' : ''}
              onClick={() => setCountry(id)}
              aria-pressed={country === id}
            >
              {label}
            </button>
          ))}
        </nav>

        {/* 플랫폼 탭 */}
        <nav className="dopamine-platform" aria-label="플랫폼 선택">
          <a href="/dopamine" className={platform === 'youtube' ? 'selected' : ''} aria-current={platform === 'youtube' ? 'page' : undefined}>
            <Youtube size={20} /> YouTube
          </a>
          <a href="/dopamine/instagram" className={platform === 'instagram' ? 'selected' : ''} aria-current={platform === 'instagram' ? 'page' : undefined}>
            <Instagram size={20} /> 인스타그램
          </a>
          <a href="/dopamine/tiktok" className={platform === 'tiktok' ? 'selected' : ''} aria-current={platform === 'tiktok' ? 'page' : undefined}>
            <Music2 size={20} /> 틱톡
          </a>
        </nav>

        {/* YouTube 서브 탭 (쇼츠 / 일반 영상) */}
        {platform === 'youtube' && (
          <nav className="dopamine-subtabs" aria-label="YouTube 영상 유형 선택">
            <button
              type="button"
              className={videoType === 'shorts' ? 'selected' : ''}
              onClick={() => setVideoType('shorts')}
              aria-pressed={videoType === 'shorts'}
            >
              쇼츠
            </button>
            <button
              type="button"
              className={videoType === 'video' ? 'selected' : ''}
              onClick={() => setVideoType('video')}
              aria-pressed={videoType === 'video'}
            >
              일반 영상
            </button>
          </nav>
        )}

        {/* 로딩 */}
        {loading && !data && (
          <div className="dopamine-empty" role="status">
            <RefreshCw className="spin" />
            <h2>콘텐츠를 불러오는 중…</h2>
          </div>
        )}

        {/* 에러 */}
        {error && (
          <div className="dopamine-error" role="alert">
            {error}
            <button onClick={() => setRetry(n => n + 1)}>다시 시도</button>
          </div>
        )}

        {/* 비어있음 */}
        {!loading && !error && allItems.length === 0 && (
          <section className="dopamine-empty">
            <PlatformIcon size={38} />
            <h2>{countryLabel} {platformLabel}</h2>
            <p>아직 등록되거나 수집된 콘텐츠가 없습니다.</p>
            {account.user?.admin && <a href="/admin/dopamine">관리자에서 수집 시작하기</a>}
          </section>
        )}

        {/* 피드 그리드 */}
        {visibleItems.length > 0 && (
          <div className="dopamine-feed">
            <div className={isWide ? 'dopamine-grid dopamine-grid-flat dopamine-grid-wide' : 'dopamine-grid dopamine-grid-flat'}>
              {visibleItems.map(item => {
                if (item.isAd) {
                  return <AdCard key={`ad-${item.id}`} item={item} />;
                }
                if (item.platform === 'youtube') {
                  return (
                    <YoutubeCard
                      key={item.id}
                      item={item}
                      playing={playing}
                      onPlay={setPlaying}
                      isWide={isWide}
                    />
                  );
                }
                if (item.platform === 'tiktok') {
                  return (
                    <TiktokCard
                      key={item.id}
                      item={item}
                      playing={playing}
                      onPlay={setPlaying}
                    />
                  );
                }
                if (item.platform === 'instagram') {
                  return (
                    <InstagramCard
                      key={item.id}
                      item={item}
                      playing={playing}
                      onPlay={setPlaying}
                    />
                  );
                }
                // 그 외 플랫폼 (추후 확장용 — 현재 미사용)
                return null;
              })}
            </div>

            {/* 무한 스크롤 감지 sentinel */}
            <div ref={sentinelRef} style={{ height: 1 }} aria-hidden />

            {/* 수동 더보기 버튼 */}
            {hasMore && (
              <div className="dopamine-load-more">
                <button type="button" onClick={loadMore}>
                  더보기 ({visibleCount}/{allItems.length})
                </button>
              </div>
            )}
          </div>
        )}

        <p className="dopamine-footnote">
          콘텐츠는 각 플랫폼에서 재생됩니다. 재생이 어려울 경우 해당 플랫폼에서 직접 시청해 주세요.
        </p>
      </main>
    </div>
  );
}
