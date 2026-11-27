'use client';
import { useEffect, useRef, useState } from 'react';

// ─── 타입 ─────────────────────────────────────────────────────────────────
type Platform = 'youtube' | 'tiktok' | 'instagram';
type Country  = 'KR' | 'US' | 'JP';
type CountryAll = 'KR' | 'US' | 'JP' | 'ALL';
type MediaType = 'image' | 'video';

interface Setting {
  id?: string;
  platform: Platform;
  country: Country;
  search_keyword: string;
  display_limit: number;
}

interface Ad {
  id: string;
  platform: Platform;
  country: CountryAll;
  slot_position: number;
  media_type: MediaType;
  title: string;
  media_url: string;
  thumbnail_url: string;
  link_url: string;
  is_active: boolean;
  created_at?: string;
}

interface StorageStats {
  totalBytes: number;
  fileCount:  number;
  limitBytes: number;
}

interface AdminData {
  settings:    Setting[];
  ads:         Ad[];
  videoCounts: Record<string, number>;
  storage?:    StorageStats;
}

const PLATFORMS: Platform[] = ['youtube', 'tiktok', 'instagram'];
const COUNTRIES: Country[]  = ['KR', 'US', 'JP'];
const PLATFORM_LABEL: Record<Platform, string> = { youtube: 'YouTube', tiktok: 'TikTok', instagram: '인스타그램' };
const COUNTRY_LABEL:  Record<Country,  string> = { KR: '한국', US: '미국', JP: '일본' };

const IMG_MAX   = 5  * 1024 * 1024;  // 5 MB
const VIDEO_MAX = 30 * 1024 * 1024;  // 30 MB

const defaultAd = (): Omit<Ad, 'id' | 'created_at'> => ({
  platform:      'youtube',
  country:       'KR',
  slot_position: 3,
  media_type:    'image',
  title:         '',
  media_url:     '',
  thumbnail_url: '',
  link_url:      '',
  is_active:     true,
});

function fmtBytes(b: number) {
  if (b < 1024)                return `${b} B`;
  if (b < 1024 * 1024)         return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function isVideoUrl(url: string) {
  return /\.(mp4|webm|mov)(\?|$)/i.test(url);
}
function isImageUrl(url: string) {
  return /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url);
}

/** HTML 등 비-JSON 오류 응답에서도 Unexpected token '<' 대신 읽기 쉬운 에러 반환 */
async function parseAdminJson<T extends { error?: string }>(
  r: Response,
  fallbackMsg: string
): Promise<T> {
  const text = await r.text();
  if (!text) {
    if (!r.ok) throw new Error(`${fallbackMsg} (HTTP ${r.status})`);
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`서버 응답 오류 (HTTP ${r.status}): 올바르지 않은 응답 형식입니다.`);
  }
}

// ─── 저장소 사용량 바 ─────────────────────────────────────────────────────
function StorageBar({ storage }: { storage: StorageStats | undefined }) {
  if (!storage) return null;
  const pct  = storage.limitBytes > 0 ? (storage.totalBytes / storage.limitBytes) * 100 : 0;
  const warn = pct >= 95 ? 'danger' : pct >= 80 ? 'warn' : '';
  return (
    <div className={`dopamine-storage-bar ${warn}`}>
      <div className="dopamine-storage-track">
        <div className="dopamine-storage-fill" style={{ width: `${Math.min(pct, 100).toFixed(1)}%` }} />
      </div>
      <span>
        R2 저장소: <strong>{fmtBytes(storage.totalBytes)}</strong> / {fmtBytes(storage.limitBytes)}
        {' '}({pct.toFixed(1)}%) · 파일 {storage.fileCount}개
      </span>
    </div>
  );
}

// ─── 미디어 미리보기 ──────────────────────────────────────────────────────
function MediaPreview({ url }: { url: string }) {
  if (!url) return null;
  if (isVideoUrl(url)) {
    return (
      <div className="dopamine-media-preview">
        <video src={url} muted playsInline controls />
      </div>
    );
  }
  if (isImageUrl(url) || url.startsWith('http')) {
    return (
      <div className="dopamine-media-preview">
        <img src={url} alt="미리보기" referrerPolicy="no-referrer" />
      </div>
    );
  }
  return null;
}

// ─── 컴포넌트 ──────────────────────────────────────────────────────────────
export default function DopamineAdmin() {
  const [tab, setTab]           = useState<0 | 1>(0);
  const [data, setData]         = useState<AdminData | null>(null);
  const [busy, setBusy]         = useState(false);
  const [uploading, setUploading] = useState<'media' | 'thumb' | null>(null);
  const [error, setError]       = useState('');
  const [notice, setNotice]     = useState('');
  const [loaded, setLoaded]     = useState(false);
  const [collectingKey, setCollectingKey] = useState('');
  const [adForm, setAdForm]     = useState(defaultAd());
  const [editingAd, setEditingAd] = useState<Ad | null>(null);
  const mounted = useRef(true);
  const mediaFileRef = useRef<HTMLInputElement>(null);
  const thumbFileRef = useRef<HTMLInputElement>(null);

  const [settingsLocal, setSettingsLocal] = useState<Record<string, { keyword: string; limit: number }>>({});

  async function load() {
    try {
      const r = await fetch('/api/admin/dopamine', { cache: 'no-store' });
      const d = await parseAdminJson<AdminData & { error?: string }>(r, '불러오기 실패');
      if (!r.ok) throw new Error(d.error || `불러오기 실패 (HTTP ${r.status})`);
      if (mounted.current) {
        setData(d);
        const map: Record<string, { keyword: string; limit: number }> = {};
        for (const p of PLATFORMS) {
          for (const c of COUNTRIES) {
            const key = `${p}_${c}`;
            const found = (d.settings || []).find(s => s.platform === p && s.country === c);
            map[key] = { keyword: found?.search_keyword ?? '', limit: found?.display_limit ?? 20 };
          }
        }
        setSettingsLocal(map);
        setLoaded(true);
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : '불러오기 실패');
    }
  }

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, []);

  function flash(msg: string, isErr = false) {
    if (isErr) { setError(msg); setNotice(''); }
    else { setNotice(msg); setError(''); }
  }

  // ─── 설정 저장 ──────────────────────────────────────────────
  async function saveSetting(platform: Platform, country: Country) {
    const key   = `${platform}_${country}`;
    const local = settingsLocal[key];
    if (!local) return;
    setBusy(true);
    try {
      const trimmedKeyword = local.keyword.trim();
      const r = await fetch('/api/admin/dopamine', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ platform, country, search_keyword: trimmedKeyword, display_limit: local.limit }),
      });
      const d = await parseAdminJson<{ message?: string; error?: string }>(r, '저장 실패');
      if (!r.ok) throw new Error(d.error || `저장 실패 (HTTP ${r.status})`);
      flash(d.message || '저장했습니다.');
      // 전체 GET 재조회 없이 클라이언트 settings 상태만 즉시 갱신
      setSettingsLocal(prev => ({
        ...prev,
        [key]: { keyword: trimmedKeyword, limit: local.limit },
      }));
      setData(prev => {
        if (!prev) return prev;
        const idx = prev.settings.findIndex(s => s.platform === platform && s.country === country);
        const updatedSetting: Setting = {
          ...(idx >= 0 ? prev.settings[idx] : {}),
          platform,
          country,
          search_keyword: trimmedKeyword,
          display_limit: local.limit,
        };
        const nextSettings = idx >= 0
          ? prev.settings.map((s, i) => (i === idx ? updatedSetting : s))
          : [...prev.settings, updatedSetting];
        return { ...prev, settings: nextSettings };
      });
    } catch (e) { flash(e instanceof Error ? e.message : '저장 실패', true); }
    finally { if (mounted.current) setBusy(false); }
  }

  // ─── 개별 / 전체 수집 ─────────────────────────────────────
  async function collectOne(platform: Platform, country: Country) {
    const key = `${platform}_${country}`;
    setCollectingKey(key); setBusy(true);
    try {
      const r = await fetch('/api/admin/dopamine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body:   JSON.stringify({ action: 'collect', platform, country }),
      });
      const d = await parseAdminJson<{ message?: string; error?: string }>(r, '수집 실패');
      if (!r.ok) throw new Error(d.error || `수집 실패 (HTTP ${r.status})`);
      flash(d.message || '수집 완료');
      await load();
    } catch (e) { flash(e instanceof Error ? e.message : '수집 실패', true); }
    finally { setCollectingKey(''); if (mounted.current) setBusy(false); }
  }

  async function collectAllNow() {
    setCollectingKey('all'); setBusy(true);
    try {
      const r = await fetch('/api/admin/dopamine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body:   JSON.stringify({ action: 'collect' }),
      });
      const d = await parseAdminJson<{ message?: string; error?: string }>(r, '전체 수집 실패');
      if (!r.ok) throw new Error(d.error || `전체 수집 실패 (HTTP ${r.status})`);
      flash(d.message || '전체 수집 완료');
      await load();
    } catch (e) { flash(e instanceof Error ? e.message : '전체 수집 실패', true); }
    finally { setCollectingKey(''); if (mounted.current) setBusy(false); }
  }

  // ─── 파일 업로드 ───────────────────────────────────────────
  async function handleFileUpload(file: File, kind: 'media' | 'thumb') {
    const isVideo = file.type.startsWith('video/');
    const limit   = isVideo ? VIDEO_MAX : IMG_MAX;
    if (file.size > limit) {
      flash(`파일이 너무 큽니다. ${isVideo ? '동영상 30MB' : '이미지 5MB'} 이하로 선택해 주세요.`, true);
      return;
    }

    setUploading(kind);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', kind === 'thumb' ? 'thumbnail' : 'media');

      const r = await fetch('/api/admin/dopamine/upload', { method: 'POST', body: fd });
      const d = await parseAdminJson<{ url?: string; mediaType?: 'image' | 'video'; error?: string }>(r, '업로드 실패');

      if (!r.ok) throw new Error(d.error || `업로드 실패 (HTTP ${r.status})`);
      if (!d.url) throw new Error('URL을 받지 못했습니다.');

      if (kind === 'media') {
        setAdForm(f => ({
          ...f,
          media_url:  d.url!,
          media_type: d.mediaType ?? f.media_type,
        }));
      } else {
        setAdForm(f => ({ ...f, thumbnail_url: d.url! }));
      }

      flash('파일을 업로드했습니다.');
      await load(); // 저장소 사용량 갱신
    } catch (e) {
      flash(e instanceof Error ? e.message : '업로드 실패', true);
    } finally {
      if (mounted.current) setUploading(null);
      // 같은 파일 재선택 허용
      if (mediaFileRef.current) mediaFileRef.current.value = '';
      if (thumbFileRef.current) thumbFileRef.current.value = '';
    }
  }

  // ─── 광고 CRUD ─────────────────────────────────────────────
  async function submitAd(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (editingAd) {
        const r = await fetch('/api/admin/dopamine', {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ id: editingAd.id, ...adForm }),
        });
        const d = await parseAdminJson<{ message?: string; error?: string }>(r, '수정 실패');
        if (!r.ok) throw new Error(d.error || `수정 실패 (HTTP ${r.status})`);
        flash(d.message || '광고를 수정했습니다.');
      } else {
        const r = await fetch('/api/admin/dopamine', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ action: 'create_ad', ...adForm }),
        });
        const d = await parseAdminJson<{ message?: string; error?: string }>(r, '등록 실패');
        if (!r.ok) throw new Error(d.error || `등록 실패 (HTTP ${r.status})`);
        flash(d.message || '광고를 등록했습니다.');
      }
      setEditingAd(null); setAdForm(defaultAd());
      await load();
    } catch (e) { flash(e instanceof Error ? e.message : '요청 실패', true); }
    finally { if (mounted.current) setBusy(false); }
  }

  async function toggleAd(ad: Ad) {
    setBusy(true);
    try {
      const r = await fetch('/api/admin/dopamine', {
        method:  'PATCH', headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id: ad.id, is_active: !ad.is_active }),
      });
      const d = await parseAdminJson<{ message?: string; error?: string }>(r, '변경 실패');
      if (!r.ok) throw new Error(d.error || `변경 실패 (HTTP ${r.status})`);
      await load();
    } catch (e) { flash(e instanceof Error ? e.message : '변경 실패', true); }
    finally { if (mounted.current) setBusy(false); }
  }

  async function deleteAd(id: string) {
    if (!window.confirm('이 광고를 삭제하시겠습니까?')) return;
    setBusy(true);
    try {
      const r = await fetch('/api/admin/dopamine', {
        method:  'DELETE', headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id }),
      });
      const d = await parseAdminJson<{ message?: string; error?: string }>(r, '삭제 실패');
      if (!r.ok) throw new Error(d.error || `삭제 실패 (HTTP ${r.status})`);
      flash(d.message || '삭제했습니다.');
      await load();
    } catch (e) { flash(e instanceof Error ? e.message : '삭제 실패', true); }
    finally { if (mounted.current) setBusy(false); }
  }

  function editAd(ad: Ad) {
    setEditingAd(ad);
    setAdForm({
      platform: ad.platform, country: ad.country, slot_position: ad.slot_position,
      media_type: ad.media_type, title: ad.title, media_url: ad.media_url,
      thumbnail_url: ad.media_type === 'image' ? '' : ad.thumbnail_url,
      link_url: ad.link_url, is_active: ad.is_active,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const storageAtLimit = data?.storage
    ? (data.storage.totalBytes / data.storage.limitBytes) >= 0.95
    : false;

  // ─── 렌더 ───────────────────────────────────────────────────────────────
  return (
    <div className="admin-page dopamine-admin">
      <header className="admin-heading">
        <div>
          <a href="/admin">관리자 페이지</a>
          <p className="eyebrow">DOPAMINE CENTER</p>
          <h1>도파민 센터 관리</h1>
          <p>YouTube · TikTok · 인스타그램 국가별 트렌딩 수집 및 광고 슬롯을 관리합니다.</p>
        </div>
        <a href="/dopamine">도파민 센터 바로가기 →</a>
      </header>

      {/* 탭 헤더 */}
      <nav className="dopamine-admin-tabs" aria-label="관리 탭">
        <button type="button" className={tab === 0 ? 'selected' : ''} onClick={() => setTab(0)} aria-pressed={tab === 0}>
          수집·노출 설정
        </button>
        <button type="button" className={tab === 1 ? 'selected' : ''} onClick={() => setTab(1)} aria-pressed={tab === 1}>
          광고 슬롯 관리
        </button>
      </nav>

      {error  && <p role="alert"  className="admin-error">{error}</p>}
      {notice && <p role="status" className="dopamine-admin-notice">{notice}</p>}

      {/* ─── 탭 1: 수집·노출 설정 ─────────────────────────────── */}
      {tab === 0 && (
        <section>
          <div className="dopamine-admin-toolbar">
            <h2>플랫폼 × 국가별 설정</h2>
            <button type="button" className="refresh" disabled={busy} onClick={collectAllNow}>
              {collectingKey === 'all' ? '전체 수집 중…' : '⟳ 전체 지금 수집'}
            </button>
          </div>

          {!loaded && !error && <p>불러오는 중…</p>}

          {loaded && (
            <div className="dopamine-settings-grid">
              {PLATFORMS.map(platform =>
                COUNTRIES.map(country => {
                  const key        = `${platform}_${country}`;
                  const local      = settingsLocal[key] ?? { keyword: '', limit: 20 };
                  const videoCount = data?.videoCounts?.[key] ?? 0;
                  const isCollecting = collectingKey === key;
                  return (
                    <div key={key} className="dopamine-setting-row">
                      <div className="dopamine-setting-header">
                        <strong>{PLATFORM_LABEL[platform]}</strong>
                        <span className="dopamine-country-badge">{COUNTRY_LABEL[country]}</span>
                        <span className="dopamine-video-count">저장된 영상: {videoCount}개</span>
                      </div>
                      <div className="dopamine-setting-fields">
                        <label>
                          검색어
                          <input type="text" maxLength={200} value={local.keyword} placeholder="예: 한국 트렌딩"
                            onChange={e => setSettingsLocal(prev => ({ ...prev, [key]: { ...prev[key], keyword: e.target.value } }))} />
                        </label>
                        <label>
                          노출 수 (1~100)
                          <input type="number" min={1} max={100} value={local.limit}
                            onChange={e => setSettingsLocal(prev => ({ ...prev, [key]: { ...prev[key], limit: Math.min(100, Math.max(1, Number(e.target.value))) } }))} />
                        </label>
                      </div>
                      <div className="dopamine-admin-actions">
                        <button type="button" disabled={busy} onClick={() => saveSetting(platform, country)}>저장</button>
                        <button type="button" className="refresh" disabled={busy} onClick={() => collectOne(platform, country)}>
                          {isCollecting ? '수집 중…' : '지금 수집'}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </section>
      )}

      {/* ─── 탭 2: 광고 슬롯 관리 ────────────────────────────── */}
      {tab === 1 && (
        <section>
          {/* R2 저장소 사용량 바 */}
          <StorageBar storage={data?.storage} />

          <h2>{editingAd ? '광고 수정' : '광고 등록'}</h2>
          <form className="dopamine-ad-form" onSubmit={submitAd}>
            <div className="dopamine-ad-form-row">
              <label>
                플랫폼
                <select value={adForm.platform} onChange={e => setAdForm(f => ({ ...f, platform: e.target.value as Platform }))}>
                  <option value="youtube">YouTube</option>
                  <option value="tiktok">TikTok</option>
                  <option value="instagram">인스타그램</option>
                </select>
              </label>
              <label>
                국가
                <select value={adForm.country} onChange={e => setAdForm(f => ({ ...f, country: e.target.value as CountryAll }))}>
                  <option value="KR">한국</option>
                  <option value="US">미국</option>
                  <option value="JP">일본</option>
                  <option value="ALL">전체(ALL)</option>
                </select>
              </label>
              <label>
                삽입 순번
                <input type="number" min={1} value={adForm.slot_position}
                  onChange={e => setAdForm(f => ({ ...f, slot_position: Math.max(1, Number(e.target.value)) }))} />
              </label>
              <label>
                타입
                <select
                  value={adForm.media_type}
                  onChange={e => {
                    const nextType = e.target.value as MediaType;
                    setAdForm(f => ({
                      ...f,
                      media_type: nextType,
                      thumbnail_url: nextType === 'image' ? '' : f.thumbnail_url,
                    }));
                  }}
                >
                  <option value="image">이미지</option>
                  <option value="video">동영상</option>
                </select>
              </label>
            </div>

            <label>
              제목
              <input required maxLength={200} type="text" value={adForm.title} placeholder="광고 제목"
                onChange={e => setAdForm(f => ({ ...f, title: e.target.value }))} />
            </label>

            {/* 메인 미디어 URL (이미지/동영상 분기) */}
            <label>{adForm.media_type === 'image' ? '광고 이미지 URL' : '광고 영상 URL'}</label>
            <div className="dopamine-upload-row">
              <input
                required
                type="url"
                value={adForm.media_url}
                placeholder="https://... 또는 오른쪽 버튼으로 업로드"
                onChange={e => setAdForm(f => ({ ...f, media_url: e.target.value }))}
              />
              <button
                type="button"
                className="dopamine-upload-btn"
                disabled={!!uploading || storageAtLimit}
                onClick={() => mediaFileRef.current?.click()}
                title={storageAtLimit ? '저장소 한도(9.5GB) 초과로 업로드 불가' : ''}
              >
                {uploading === 'media'
                  ? '업로드 중…'
                  : adForm.media_type === 'image'
                  ? '이미지 업로드'
                  : '영상 업로드'}
              </button>
              <input
                ref={mediaFileRef}
                type="file"
                accept={
                  adForm.media_type === 'image'
                    ? 'image/jpeg,image/png,image/webp,image/gif'
                    : 'video/mp4,video/webm,video/quicktime'
                }
                style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) void handleFileUpload(f, 'media'); }}
              />
            </div>
            {adForm.media_url && <MediaPreview url={adForm.media_url} />}

            {/* 동영상 광고일 때만 썸네일 URL 입력칸 노출 */}
            {adForm.media_type === 'video' && (
              <>
                <label>썸네일 URL (선택)</label>
                <div className="dopamine-upload-row">
                  <input
                    type="url"
                    value={adForm.thumbnail_url}
                    placeholder="https://... (비워두면 영상 첫 프레임 또는 기본 썸네일 사용)"
                    onChange={e => setAdForm(f => ({ ...f, thumbnail_url: e.target.value }))}
                  />
                  <button
                    type="button"
                    className="dopamine-upload-btn"
                    disabled={!!uploading || storageAtLimit}
                    onClick={() => thumbFileRef.current?.click()}
                    title={storageAtLimit ? '저장소 한도(9.5GB) 초과로 업로드 불가' : ''}
                  >
                    {uploading === 'thumb' ? '업로드 중…' : '이미지 업로드'}
                  </button>
                  <input
                    ref={thumbFileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) void handleFileUpload(f, 'thumb'); }}
                  />
                </div>
                {adForm.thumbnail_url && <MediaPreview url={adForm.thumbnail_url} />}
              </>
            )}

            <label>
              클릭 이동 링크
              <input required type="url" value={adForm.link_url} placeholder="https://..."
                onChange={e => setAdForm(f => ({ ...f, link_url: e.target.value }))} />
            </label>

            <label className="dopamine-check">
              <input type="checkbox" checked={adForm.is_active} onChange={e => setAdForm(f => ({ ...f, is_active: e.target.checked }))} />
              활성화
            </label>

            <div className="dopamine-admin-actions">
              <button type="submit" className="refresh" disabled={busy || !!uploading}>
                {busy ? '처리 중…' : editingAd ? '광고 수정 저장' : '광고 등록'}
              </button>
              {editingAd && (
                <button type="button" disabled={busy} onClick={() => { setEditingAd(null); setAdForm(defaultAd()); }}>
                  취소
                </button>
              )}
            </div>
          </form>

          <h2>광고 목록 <small>{data?.ads.length ?? 0}개</small></h2>
          {!loaded && <p>불러오는 중…</p>}
          {loaded && !data?.ads.length && <p>등록된 광고가 없습니다.</p>}

          <div className="dopamine-ad-list">
            {(data?.ads ?? []).map(ad => {
              const thumbUrl = ad.thumbnail_url || (ad.media_type === 'image' ? ad.media_url : '');
              return (
                <div key={ad.id} className="dopamine-ad-row">
                  {thumbUrl && (
                    <img
                      src={thumbUrl}
                      alt={ad.title}
                      referrerPolicy="no-referrer"
                      style={{
                        width: '48px',
                        height: '48px',
                        objectFit: 'cover',
                        borderRadius: '6px',
                        flexShrink: 0,
                        border: '1px solid #dce2eb',
                      }}
                    />
                  )}
                  <div className="dopamine-ad-info">
                    <strong>{ad.title}</strong>
                    <span className="dopamine-ad-meta">
                      {PLATFORM_LABEL[ad.platform]} · {ad.country} · {ad.slot_position}번 슬롯 · {ad.media_type === 'image' ? '이미지' : '동영상'}
                    </span>
                    <span className="dopamine-source-url">{ad.media_url}</span>
                  </div>
                  <div className="dopamine-admin-actions">
                    <button type="button" className={ad.is_active ? 'dopamine-toggle-on' : 'dopamine-toggle-off'}
                      disabled={busy} onClick={() => toggleAd(ad)} title={ad.is_active ? '비활성화' : '활성화'}>
                      {ad.is_active ? 'ON' : 'OFF'}
                    </button>
                    <button type="button" disabled={busy} onClick={() => editAd(ad)}>수정</button>
                    <button type="button" className="dopamine-delete" disabled={busy} onClick={() => deleteAd(ad.id)}>삭제</button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
