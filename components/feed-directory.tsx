'use client';
import { socialAccount } from '../lib/social-parser';
import { useNewsAccount } from './news-account';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Globe, LoaderCircle, Plus, Rss, Search, X } from 'lucide-react';
import { catalogCategories, type CatalogFeed } from '../lib/shared-catalog';
import { supabase } from '../lib/supabase'; 

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
    
    // [피드AI] AI 스케줄 및 프롬프트 상태
    const [frequencyOptions, setFrequencyOptions] = useState<any[]>([{ code_value: '360', display_name: '6시간 간격' }]);
    const [promptOptions, setPromptOptions] = useState<any[]>([
        { code_value: 'DEFAULT', display_name: '기본 3줄 인사이트 요약' },
        { code_value: 'CUSTOM', display_name: '나만의 커스텀 명령 (PRO)' }
    ]);
    const [frequency, setFrequency] = useState('360');
    const [aiPromptCode, setAiPromptCode] = useState('DEFAULT');
    const [customPrompt, setCustomPrompt] = useState('');

    async function loadCatalog() {
        setLoading(true); setCatalogError('');
        try {
            const { data: catData, error: catErr } = await supabase.from('shared_categories').select('name').eq('deleted', false).order('name');
            if (catErr) throw catErr;
            const loadedCategories = catData?.map(c => c.name) || [...catalogCategories];

            const { data: feedData, error: feedErr } = await supabase.from('shared_feeds').select('*').eq('deleted', false).eq('enabled', true).order('name');
            if (feedErr) throw feedErr;

            const formattedItems = (feedData || []).map(f => ({
                id: f.id, name: f.name, url: f.url, country: f.country, category: f.category,
                language: f.language, kind: f.kind, enabled: f.enabled, deleted: f.deleted,
                verifiedAt: f.verified_at, revision: f.revision, itemCount: f.item_count || 0
            }));

            setCatalog(formattedItems);
            setLabels(loadedCategories.length > 0 ? loadedCategories : [...catalogCategories]);
            
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

    // 🚀 URL이 인스타나 X로 이미 변환되었는지 감지하는 상태값 (지우면 다시 활성화됨)
    const isConvertedSns = url.includes('/rss/instagram/') || url.includes('/rss/twitter/');

    // 🚀 DB(shared_categories)나 기존 공통 설정에 '소셜', '소셜 미디어', 'SNS' 카테고리가 있는지 찾아내는 함수
    const findSnsCategory = () => {
        const allCategories = [...categories, ...labels];
        return allCategories.find(c => c === '소셜' || c === '소셜 미디어' || c === 'SNS') || manualCategory;
    };

    async function subscribe(f: { id: string; name: string; url: string; category: string; country?: string }) {
        if (pending.current) return;
        
        const limit = subscription?.limits?.feeds || 9999; 
        const currentPlan = subscription?.plan || 'pro'; 

        if (feeds.length >= limit) { setError('요금제 제한에 도달했습니다.'); setRowError(f.id); return; }
        if (f.id === 'manual' && currentPlan === 'free' && feeds.filter(x => !catalog.some(c => canonical(c.url) === canonical(x.url))).length >= 1) { setError('Free는 커스텀 피드를 1개만 등록할 수 있습니다.'); setRowError(f.id); return; }
        
        let normalized = canonical(f.url);
        if (subscribed.has(normalized) || added.current.has(normalized)) { setNotice('이미 구독 중인 피드입니다.'); return; }
        
        pending.current = true; setBusy(f.id); setError(''); setRowError(''); setNotice('');
        try {
            let processUrl = f.url.trim();

            if (!processUrl.startsWith('http') && !processUrl.startsWith('https')) {
                alert("🚨 URL 형식이 아닙니다. 인스타 또는 X 계정이라면 입력창 우측의 [📷 인스타 변환] 또는 [𝕏 X 변환] 버튼을 먼저 눌러서 주소를 완성해 주세요!");
                throw new Error('URL 변환이 필요합니다.');
            }

            const r = await fetch('/api/feed?url=' + encodeURIComponent(processUrl));
            const d: any = await r.json();
            
            if (!r.ok) throw new Error(d.error || '피드를 확인하지 못했습니다.');
            
            // 💡 0개 차단 로직 끄기 (빈 피드라도 저장 허용)
            // if (!Array.isArray(d.items) || !d.items.length) throw new Error('현재 읽을 수 있는 기사가 없는 피드입니다.');
            
            const target = f.category;
            const finalFeedUrl = d.feedUrl || processUrl; 
            const finalName = f.name.trim() || d.title || '새 피드';
            
            onAdd({ id: crypto.randomUUID(), name: finalName, url: finalFeedUrl, category: target });
            added.current.add(normalized);

            if (f.id === 'manual') {
                try {
                    await fetch('/api/add-signal', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ feedUrl: finalFeedUrl, categoryName: finalName, frequency, aiPromptCode, customPrompt })
                    });
                } catch (err) { console.error("알림 설정 연동 실패:", err); }
            }

            setNotice((finalName) + ' 소스를 추가했습니다.' + (d.notice ? ' ' + d.notice : ''));
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

                <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
                    <label style={{ flex: 1 }}>발송 스케줄 (AI 브리핑)
                        <select value={frequency} onChange={e => setFrequency(e.target.value)} style={{ width: '100%', marginTop: '6px', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                            {frequencyOptions.map(opt => <option key={opt.code_value} value={opt.code_value}>{opt.display_name}</option>)}
                        </select>
                    </label>
                    <label style={{ flex: 1 }}>AI 브리핑 컨셉
                        <select value={aiPromptCode} onChange={e => setAiPromptCode(e.target.value)} style={{ width: '100%', marginTop: '6px', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                            {promptOptions.map(opt => <option key={opt.code_value} value={opt.code_value}>{opt.display_name}</option>)}
                        </select>
                    </label>
                </div>

                {aiPromptCode === 'CUSTOM' && (
                    <label style={{ display: 'block', marginBottom: '16px' }}>커스텀 AI 프롬프트 입력
                        <textarea
                            required value={customPrompt} onChange={e => setCustomPrompt(e.target.value)}
                            placeholder="예: '일론 머스크'와 관련된 내용만 요약해 줘."
                            style={{ width: '100%', minHeight: '80px', marginTop: '6px', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', resize: 'vertical' }}
                        />
                    </label>
                )}

                <label style={{ display: 'block', marginBottom: '16px' }}>소스 이름
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="예: 나의 경제 피드" maxLength={60} style={{ width: '100%', marginTop: '6px', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}/>
                </label>

                <label style={{ display: 'block', marginBottom: '16px' }}>RSS 또는 SNS 계정 주소
                    <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                        <input required type="text" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/rss" style={{ flex: 1, padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', margin: 0 }}/>
                        
                        {/* 🚀 인스타 변환 버튼 */}
                        <button type="button" disabled={isConvertedSns} onClick={() => {
                            let val = url.trim().replace(/^@/, '');
                            if(val.includes('instagram.com/')) val = val.split('instagram.com/')[1].split('/')[0].split('?')[0];
                            if(val) {
                                setUrl(`${window.location.origin}/rss/instagram/${val}`);
                                setManualCategory(findSnsCategory()); // 하드코딩 제거: DB에 있는 소셜 카테고리를 찾아 동적 세팅
                            }
                        }} style={{ backgroundColor: '#fce7f3', color: '#be185d', border: 'none', padding: '0 12px', borderRadius: '6px', fontWeight: '600', fontSize: '13px', whiteSpace: 'nowrap', cursor: isConvertedSns ? 'not-allowed' : 'pointer', opacity: isConvertedSns ? 0.5 : 1 }}>📷 인스타 변환</button>
                        
                        {/* 🚀 X 변환 버튼 */}
                        <button type="button" disabled={isConvertedSns} onClick={() => {
                            let val = url.trim().replace(/^@/, '');
                            if(val.match(/(x|twitter)\.com\//)) val = val.split(/(?:x|twitter)\.com\//)[1].split('/')[0].split('?')[0];
                            if(val) {
                                setUrl(`${window.location.origin}/rss/twitter/${val}`);
                                setManualCategory(findSnsCategory()); // 하드코딩 제거
                            }
                        }} style={{ backgroundColor: '#0f1419', color: '#ffffff', border: 'none', padding: '0 12px', borderRadius: '6px', fontWeight: '600', fontSize: '13px', whiteSpace: 'nowrap', cursor: isConvertedSns ? 'not-allowed' : 'pointer', opacity: isConvertedSns ? 0.5 : 1 }}>𝕏 X 변환</button>
                    </div>
                </label>

                <label style={{ display: 'block', marginBottom: '16px' }}>카테고리
                    <select value={manualCategory} onChange={e => setManualCategory(e.target.value)} style={{ width: '100%', marginTop: '6px', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                        {/* 하드코딩 제거: 오로지 DB와 설정에서 가져온 카테고리만 뿌려줍니다 */}
                        {Array.from(new Set([...categories, ...labels])).filter(c => c !== '전체').map(c => <option key={c}>{c}</option>)}
                    </select>
                </label>

                {rowError === 'manual' && error && <p className="directory-error" role="alert" style={{ marginTop: '12px' }}>{error}</p>}

                <button className="submit" disabled={!!busy} style={{ width: '100%', marginTop: '16px', padding: '14px', borderRadius: '6px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px' }}>
                    {busy ? '피드 확인 중…' : '피드 소스 추가'}{!busy && <Plus size={17}/>}
                </button>
                <small style={{ display: 'block', marginTop: '12px', color: '#64748b' }}>RSS·Atom과 공개 인스타그램·X 계정 주소를 지원합니다. SNS는 시험 운영 중이며 로그인 요구·접근 제한 시 등록할 수 없습니다.</small>
            </form>
            }
            <footer className="directory-footer">
                <span role="status">{notice || '관심 있는 소스를 골라 구독하세요.'}</span>
                <button type="button" onClick={onClose}>완료</button>
            </footer>
        </section>
    </div>
    );
}