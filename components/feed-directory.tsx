'use client';
import { socialAccount } from '../lib/social-parser';
import { useNewsAccount } from './news-account';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Globe, LoaderCircle, Plus, Rss, Search, X } from 'lucide-react';
import { catalogCategories, type CatalogFeed } from '../lib/shared-catalog';
import { supabase } from '../lib/supabase'; // 🚀 API를 거치지 않고 Supabase DB 직결

type Feed = { id: string; name: string; url: string; category: string };
function canonical(url: string) { 
    try { 
        const sns = socialAccount(url); 
        if (sns) return sns.url; 
        const u = new URL(url); 
        u.hash = ''; 
        u.searchParams.sort(); 
        return u.href.replace(/\/$/, ''); 
    } catch { 
        return url.trim(); 
    } 
}

export default function FeedDirectory({ feeds, onAdd, onClose, categories }: { feeds: Feed[]; onAdd: (feed: Feed) => void; onClose: () => void; categories: string[] }) {
    const { subscription } = useNewsAccount();
    const [catalog, setCatalog] = useState<CatalogFeed[]>([]);
    const [catalogError, setCatalogError] = useState('');
    const [loading, setLoading] = useState(true);
    const countries = [...new Set(catalog.map(f => f.country))].sort((a, b) => a === '대한민국' ? -1 : b === '대한민국' ? 1 : a.localeCompare(b, 'ko'));
    const [labels, setLabels] = useState<string[]>([...catalogCategories]);
    
    // 🚀 [피드AI] AI 스케줄 및 프롬프트 상태
    const [frequencyOptions, setFrequencyOptions] = useState<any[]>([{ code_value: '360', display_name: '6시간 간격' }]);
    const [promptOptions, setPromptOptions] = useState<any[]>([
        { code_value: 'DEFAULT', display_name: '✨ 기본 3줄 인사이트 요약' },
        { code_value: 'CUSTOM', display_name: '나만의 커스텀 명령 (PRO)' }
    ]);
    const [frequency, setFrequency] = useState('360');
    const [aiPromptCode, setAiPromptCode] = useState('DEFAULT');
    const [customPrompt, setCustomPrompt] = useState('');

    // 💡 Supabase에서 공용 피드와 카테고리를 실시간으로 불러옵니다
    async function loadCatalog() {
        setLoading(true); setCatalogError('');
        try {
            // 1. 활성화된 카테고리 로드
            const { data: catData, error: catErr } = await supabase.from('shared_categories').select('name').eq('deleted', false).order('name');
            if (catErr) throw catErr;
            const loadedCategories = catData?.map(c => c.name) || catalogCategories;

            // 2. 삭제되지 않고(공개 상태인) 피드만 로드
            const { data: feedData, error: feedErr } = await supabase.from('shared_feeds').select('*').eq('deleted', false).eq('enabled', true).order('name');
            if (feedErr) throw feedErr;

            const formattedItems = (feedData || []).map(f => ({
                id: f.id, name: f.name, url: f.url, country: f.country, category: f.category,
                language: f.language, kind: f.kind, enabled: f.enabled, deleted: f.deleted,
                verifiedAt: f.verified_at, revision: f.revision
            }));

            setCatalog(formattedItems);
            setLabels(loadedCategories.length > 0 ? loadedCategories : catalogCategories);
            
            // 💡 [피드AI] DB에서 공통 코드 불러오기 (에러 방어 포함)
            try {
                const codeRes = await fetch('/api/common-codes');
                if (codeRes.ok) {
                    const codeData: any = await codeRes.json();
                    if (codeData.frequencies?.length) setFrequencyOptions(codeData.frequencies);
                    if (codeData.prompts?.length) setPromptOptions(codeData.prompts);
                }
            } catch (ce) { console.warn('공통 코드를 아직 불러올 수 없습니다.', ce); }
            
        } catch (e) {
            setCatalogError(e instanceof Error ? e.message : '목록을 불러오지 못했습니다.');
        } finally {
            setLoading(false);
        }
    }
    useEffect(() => { void loadCatalog(); }, []);
    
    const [tab, setTab] = useState('browse'), [query, setQuery] = useState(''), [country, setCountry] = useState('전체 국가'), [category, setCategory] = useState('전체 카테고리'), [sort, setSort] = useState('publisher'), [busy, setBusy] = useState(''), [notice, setNotice] = useState(''), [rowError, setRowError] = useState(''), [error, setError] = useState(''), [name, setName] = useState(''), [url, setUrl] = useState(''), [manualCategory, setManualCategory] = useState('국내');
    const closeRef = useRef(onClose); closeRef.current = onClose;
    const dialog = useRef<HTMLElement>(null); const pending = useRef(false); const added = useRef(new Set<string>());

    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
        function key(e: KeyboardEvent) {
            if (e.key === 'Escape') closeRef.current();
            if (e.key === 'Tab') {
                const els = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,a[href]');
                if (!els?.length) return;
                const first = els[0], last = els[els.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            }
        }
        document.addEventListener('keydown', key);
        return () => { document.removeEventListener('keydown', key); previous?.focus(); };
    }, []);

    useEffect(() => { if (labels.length && !labels.includes(manualCategory)) setManualCategory(labels[0]); }, [labels, manualCategory]);

    const subscribed = useMemo(() => new Set(feeds.map(f => canonical(f.url))), [feeds]);
    const results = useMemo(() => catalog.filter(f => (country === '전체 국가' || f.country === country) && (category === '전체 카테고리' || f.category === category) && `${f.name} ${f.country} ${f.category} ${f.language} ${f.url}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === 'country' ? a.country.localeCompare(b.country, 'ko') || a.name.localeCompare(b.name) : sort === 'name' ? a.name.localeCompare(b.name, 'ko') : 0), [catalog, query, country, category, sort]);

    async function subscribe(f: { id: string; name: string; url: string; category: string; country?: string }) {
        if (pending.current) return;
        if (feeds.length >= subscription.limits.feeds) { setError(subscription.limits.name + ' 요금제는 피드를 최대 ' + subscription.limits.feeds + '개 등록할 수 있습니다.'); setRowError(f.id); return; }
        if (f.id === 'manual' && subscription.plan === 'free' && feeds.filter(x => !catalog.some(c => canonical(c.url) === canonical(x.url))).length >= 1) { setError('Free는 커스텀 피드를 1개만 등록할 수 있습니다.'); setRowError(f.id); return; }
        
        let normalized = canonical(f.url);
        if (subscribed.has(normalized) || added.current.has(normalized)) { setNotice('이미 구독 중인 피드입니다.'); return; }
        
        pending.current = true; setBusy(f.id); setError(''); setRowError(''); setNotice('');
        try {
            // 🚀 [피드AI] 스텔스 우회 로직: 인스타/X 주소가 들어오면 자체 RSS 엔진 경로로 토스
            let processUrl = f.url.trim();
            if (processUrl.includes('instagram.com/')) {
                const uname = processUrl.split('instagram.com/')[1].split('/')[0].split('?')[0];
                processUrl = `${window.location.origin}/rss/instagram/${uname}`;
            } else if (processUrl.match(/(x|twitter)\.com\//)) {
                const uname = processUrl.split(/(?:x|twitter)\.com\//)[1].split('/')[0].split('?')[0];
                processUrl = `${window.location.origin}/rss/twitter/${uname}`;
            }

            // 변환된 주소(processUrl)로 피드 검증 요청 (서버에서 XML 파싱 테스트)
            const r = await fetch('/api/feed?url=' + encodeURIComponent(processUrl));
            const d: any = await r.json();
            if (!r.ok) throw new Error(d.error || '피드를 확인하지 못했습니다.');
            if (!Array.isArray(d.items) || !d.items.length) throw new Error('현재 읽을 수 있는 기사가 없는 피드입니다.');
            
            const target = f.category;
            const finalFeedUrl = d.feedUrl || processUrl; 
            const finalName = f.name.trim() || d.title || '새 피드';
            
            // 전역 상태에 구독 추가 (Supabase 저장 트리거)
            onAdd({ id: crypto.randomUUID(), name: finalName, url: finalFeedUrl, category: target });
            added.current.add(normalized);

            // 🚀 [피드AI] AI 시그널 DB 등록 로직 (add-signal API 호출)
            if (f.id === 'manual') {
                try {
                    await fetch('/api/add-signal', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ feedUrl: finalFeedUrl, categoryName: finalName, frequency, aiPromptCode, customPrompt })
                    });
                } catch (err) { console.error("알림 설정 연동 실패:", err); }
            }

            setNotice((finalName) + ' 구독을 추가했습니다.' + (d.notice ? ' ' + d.notice : ''));
            if (f.id === 'manual') { setName(''); setUrl(''); }
        } catch (e) {
            setError(e instanceof Error ? e.message : '등록 실패');
            setRowError(f.id);
        } finally {
            pending.current = false; setBusy('');
        }
    }

    return (
    <div className="modal-backdrop directory-backdrop" onClick={onClose}>
        <section ref={dialog} className="feed-directory" role="dialog" aria-modal="true" aria-labelledby="directory-title" onClick={e => e.stopPropagation()}>
            <header className="directory-header">
                <div className="directory-heading">
                    <span className="brand-icon"><Rss size={21}/></span>
                    <div>
                        <h2 id="directory-title">피드 소스 찾기</h2>
                        <p>{countries.filter(c => c !== '글로벌').length}개 국가·지역 · {catalog.length}개 RSS 피드</p>
                    </div>
                </div>
                <button onClick={onClose} className="directory-close" aria-label="닫기"><X size={21}/></button>
            </header>
            <div className="directory-tabs">
                <button className={tab === 'browse' ? 'selected' : ''} onClick={() => { setTab('browse'); setError(''); }}><Globe size={15}/> 세계 RSS 목록</button>
                <button className={tab === 'manual' ? 'selected' : ''} onClick={() => { setTab('manual'); setError(''); }}><Plus size={15}/> 주소 직접 등록</button>
            </div>
            {tab === 'browse' ?
            <>
                <div className="directory-controls">
                    <label className="directory-search"><Search size={17}/><input aria-label="피드 검색" placeholder="언론사, 국가, 주제 검색 또는 RSS URL 입력" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button onClick={() => setQuery('')} aria-label="검색 지우기"><X size={15}/></button>}</label>
                    <div className="directory-filters">
                        <select aria-label="국가" value={country} onChange={e => setCountry(e.target.value)}><option>전체 국가</option>{countries.map(c => <option key={c}>{c}</option>)}</select>
                        <select aria-label="카테고리" value={category} onChange={e => setCategory(e.target.value)}><option>전체 카테고리</option>{labels.map(c => <option key={c}>{c}</option>)}</select>
                        <select aria-label="정렬" value={sort} onChange={e => setSort(e.target.value)}><option value="publisher">기본순</option><option value="name">이름순</option><option value="country">국가순</option></select>
                    </div>
                    <div className="directory-result-count"><span>검색 결과 <b>{results.length}</b></span><span>구독 시 연결 확인</span></div>
                </div>
                <div className="directory-results">
                    {loading && <p className="directory-note" role="status">공용 목록을 불러오는 중…</p>}
                    {catalogError && <p className="directory-error" role="alert">{catalogError} <button onClick={loadCatalog}>다시 시도</button></p>}
                    {results.map(f => {
                        const isAdded = subscribed.has(canonical(f.url));
                        return <div key={f.id} className="directory-item">
                            <span className={'publisher-mark ' + (f.kind === '뉴스 모음' ? 'aggregate' : '')}>{f.kind === '뉴스 모음' ? <Globe size={18}/> : f.name.slice(0, 2).toUpperCase()}</span>
                            <div className="directory-item-info">
                                <h3>{f.name}</h3><p>{f.country} · {f.category} · {f.language}<span>{f.kind === '뉴스 모음' ? '피드 모음' : f.kind}</span></p>
                                {rowError === f.id && error && <p className="directory-error" role="alert">{error}</p>}
                            </div>
                            <button disabled={!!busy || isAdded} className={isAdded ? 'subscribe-button subscribed' : 'subscribe-button'} onClick={() => subscribe(f)} aria-label={f.name + (isAdded ? ' 구독 중' : ' 구독하기')}>
                                {busy === f.id ? <LoaderCircle size={15} className="spin"/> : isAdded ? <Check size={15}/> : <Plus size={15}/>}<span>{busy === f.id ? '확인 중' : isAdded ? '구독 중' : '구독'}</span>
                            </button>
                        </div>
                    })}
                    {!loading && !catalogError && !results.length && <div className="directory-empty"><Search size={29}/><h3>일치하는 피드가 없습니다</h3><p>다른 국가·카테고리로 검색하거나 RSS 주소를 직접 등록해 주세요.</p><button onClick={() => { setTab('manual'); if (/^https?:\/\//i.test(query)) setUrl(query); }}>RSS 직접 등록</button></div>}
                </div>
                <p className="directory-note">관리자가 제공하는 공용 RSS 목록입니다. 원하는 소스를 선택해 구독하면 내 피드에 추가됩니다.</p>
            </>
            :
            <form className="directory-manual" onSubmit={e => { e.preventDefault(); subscribe({ id: 'manual', name, url, category: manualCategory }); }}>
                <h3>RSS·인스타그램·X 계정으로 연결하세요</h3>
                <p>RSS 주소 또는 공개 SNS 계정 주소를 입력하세요. 최근 48시간 게시물 수집을 확인한 후 등록합니다.</p>
                
                {/* 🚀 [피드AI] AI 설정 UI 융합 */}
                <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
                    <label style={{ flex: 1 }}>발송 스케줄 (AI 브리핑)
                        <select value={frequency} onChange={e => setFrequency(e.target.value)} style={{ marginTop: '6px', width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #e2e8f0', backgroundColor: '#f8fafc', color: '#475569', fontSize: '13px', outline: 'none' }}>
                            {frequencyOptions.map(opt => <option key={opt.code_value} value={opt.code_value}>{opt.display_name}</option>)}
                        </select>
                    </label>
                    <label style={{ flex: 1 }}>AI 브리핑 컨셉
                        <select value={aiPromptCode} onChange={e => setAiPromptCode(e.target.value)} style={{ marginTop: '6px', width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #e2e8f0', backgroundColor: '#f8fafc', color: '#475569', fontSize: '13px', outline: 'none' }}>
                            {promptOptions.map(opt => <option key={opt.code_value} value={opt.code_value}>{opt.display_name}</option>)}
                        </select>
                    </label>
                </div>

                {aiPromptCode === 'CUSTOM' && (
                    <label style={{ marginBottom: '16px', display: 'block' }}>커스텀 AI 프롬프트 입력
                        <textarea 
                            required value={customPrompt} onChange={e => setCustomPrompt(e.target.value)} 
                            placeholder="예: '일론 머스크'와 관련된 내용만 요약해 줘."
                            style={{ minHeight: '80px', padding: '10px', resize: 'vertical', width: '100%', boxSizing: 'border-box', marginTop: '6px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '13px', outline: 'none' }}
                        />
                    </label>
                )}

                <label>소스 이름<input value={name} onChange={e => setName(e.target.value)} placeholder="예: 나의 경제 피드" maxLength={60}/></label>
                <label>RSS 또는 SNS 계정 주소<input required type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/rss"/></label>
                <label>카테고리<select value={manualCategory} onChange={e => setManualCategory(e.target.value)}>{Array.from(new Set([...categories, ...labels])).filter(c => c !== '전체').map(c => <option key={c}>{c}</option>)}</select></label>
                {rowError === 'manual' && error && <p className="directory-error" role="alert">{error}</p>}
                <button className="submit" disabled={!!busy}>{busy ? '피드 확인 중…' : '피드 소스 추가'}<Plus size={17}/></button>
                <small>RSS·Atom과 공개 인스타그램·X 계정 주소를 지원합니다. SNS는 시험 운영 중이며 로그인 요구·접근 제한 시 등록할 수 없습니다. 영상 20MB·이미지 12MB 초과 또는 다운로드 제한 파일은 누락 상태로 표시됩니다.</small>
            </form>
            }
            <footer className="directory-footer"><span role="status">{notice || '관심 있는 소스를 골라 구독하세요.'}</span><button onClick={onClose}>완료</button></footer>
        </section>
    </div>
    );
}