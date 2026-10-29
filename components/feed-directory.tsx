'use client';
import { socialAccount } from '../lib/social-parser';
import { useNewsAccount } from './news-account';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
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

export default function FeedDirectory({
    feeds,
    onAdd,
    onClose,
    categories,
}: {
    feeds: Feed[];
    onAdd: (feed: Feed) => void;
    onClose: () => void;
    categories: string[];
}) {
    const { subscription, user } = useNewsAccount();
    const [catalog, setCatalog] = useState<CatalogFeed[]>([]);
    const [catalogError, setCatalogError] = useState('');
    const [loading, setLoading] = useState(true);
    const countries = [...new Set(catalog.map(f => f.country))].sort((a, b) =>
        a === '대한민국' ? -1 : b === '대한민국' ? 1 : a.localeCompare(b, 'ko')
    );
    const [labels, setLabels] = useState<string[]>([...catalogCategories]);

    // [피드AI & TELE-DESK] AI 스케줄, 프롬프트, 수신 채널 상태
    const [targetChannel, setTargetChannel] = useState<'telegram' | 'discord' | 'email'>('telegram');
    const [frequencyOptions, setFrequencyOptions] = useState<any[]>([
        { code_value: '360', display_name: '6시간 간격' },
    ]);
    const [promptOptions, setPromptOptions] = useState<any[]>([
        { code_value: 'DEFAULT', display_name: '기본 3줄 인사이트 요약' },
        { code_value: 'CUSTOM', display_name: '나만의 커스텀 명령 (PRO)' },
    ]);
    const [frequency, setFrequency] = useState('360');
    const [aiPromptCode, setAiPromptCode] = useState('DEFAULT');
    const [customPrompt, setCustomPrompt] = useState('');

    // [텔레그램 연동 상태 및 모달 제어]
    const [tgChatId, setTgChatId] = useState('');
    const [tgInputId, setTgInputId] = useState('');
    const [hasTelegramLinked, setHasTelegramLinked] = useState(false);
    const [showChannelModal, setShowChannelModal] = useState(false);
    const [autoLinkWaiting, setAutoLinkWaiting] = useState(false);
    const [savingChannel, setSavingChannel] = useState(false);
    const tgPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const isLinkedRef = useRef(false);

    const effectiveUserId =
        user?.id || (process.env.NODE_ENV === 'development' ? 'local_seedy' : '');

    // 유저의 텔레그램 연동 정보 조회
    const checkTelegramStatus = useCallback(async () => {
        if (!effectiveUserId) return;
        try {
            const res = await fetch(
                '/api/check-telegram?userId=' + encodeURIComponent(effectiveUserId),
                { cache: 'no-store' }
            );
            
            // ★ 수정된 부분: TypeScript에게 data의 형태(타입)를 강제로 알려줌
            const data = (await res.json()) as { success: boolean; chatId?: string };
            
            if (data.success && data.chatId) {
                setTgChatId(data.chatId);
                setTgInputId(data.chatId);
                setHasTelegramLinked(true);
            } else {
                setTgChatId('');
                setHasTelegramLinked(false);
            }
        } catch (e) {
            console.warn('텔레그램 상태 확인 실패:', e);
        }
    }, [effectiveUserId]);

    useEffect(() => {
        void checkTelegramStatus();
        const onFocus = () => void checkTelegramStatus();
        window.addEventListener('focus', onFocus);
        return () => {
            window.removeEventListener('focus', onFocus);
            if (tgPollRef.current) clearInterval(tgPollRef.current);
        };
    }, [checkTelegramStatus]);

    async function loadCatalog() {
        setLoading(true);
        setCatalogError('');
        try {
            const { data: catData, error: catErr } = await supabase
                .from('shared_categories')
                .select('name')
                .eq('deleted', false)
                .order('name');
            if (catErr) throw catErr;
            const loadedCategories = catData?.map(c => c.name) || [...catalogCategories];

            const { data: feedData, error: feedErr } = await supabase
                .from('shared_feeds')
                .select('*')
                .eq('deleted', false)
                .eq('enabled', true)
                .order('name');
            if (feedErr) throw feedErr;

            const formattedItems = (feedData || []).map(f => ({
                id: f.id,
                name: f.name,
                url: f.url,
                country: f.country,
                category: f.category,
                language: f.language,
                kind: f.kind,
                enabled: f.enabled,
                deleted: f.deleted,
                verifiedAt: f.verified_at,
                revision: f.revision,
                itemCount: f.item_count || 0,
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
            } catch (ce) {
                console.warn('공통 코드를 아직 불러올 수 없습니다.', ce);
            }
        } catch (e) {
            setCatalogError(e instanceof Error ? e.message : '목록을 불러오지 못했습니다.');
        } finally {
            setLoading(false);
        }
    }
    useEffect(() => {
        void loadCatalog();
    }, []);

    const [tab, setTab] = useState('browse'),
        [query, setQuery] = useState(''),
        [country, setCountry] = useState('전체 국가'),
        [category, setCategory] = useState('전체 카테고리'),
        [sort, setSort] = useState('publisher'),
        [busy, setBusy] = useState(''),
        [notice, setNotice] = useState(''),
        [rowError, setRowError] = useState(''),
        [error, setError] = useState(''),
        [name, setName] = useState(''),
        [url, setUrl] = useState(''),
        [manualCategory, setManualCategory] = useState('국내');

    const closeRef = useRef(onClose);
    closeRef.current = onClose;
    const dialog = useRef<HTMLElement>(null);
    const pending = useRef(false);
    const added = useRef(new Set<string>());

    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
        function key(e: KeyboardEvent) {
            if (e.key === 'Escape') {
                if (showChannelModal) setShowChannelModal(false);
                else closeRef.current();
            }
        }
        document.addEventListener('keydown', key);
        return () => {
            document.removeEventListener('keydown', key);
            previous?.focus();
        };
    }, [showChannelModal]);

    useEffect(() => {
        if (labels.length && !labels.includes(manualCategory)) setManualCategory(labels[0]);
    }, [labels, manualCategory]);

    const subscribed = useMemo(() => new Set(feeds.map(f => canonical(f.url))), [feeds]);
    const results = useMemo(
        () =>
            catalog
                .filter(
                    f =>
                        (country === '전체 국가' || f.country === country) &&
                        (category === '전체 카테고리' || f.category === category) &&
                        `${f.name} ${f.country} ${f.category} ${f.language} ${f.url}`
                            .toLowerCase()
                            .includes(query.toLowerCase())
                )
                .sort((a, b) =>
                    sort === 'country'
                        ? a.country.localeCompare(b.country, 'ko') || a.name.localeCompare(b.name)
                        : sort === 'name'
                          ? a.name.localeCompare(b.name, 'ko')
                          : 0
                ),
        [catalog, query, country, category, sort]
    );

    // 🚀 URL이 인스타나 X로 이미 변환되었는지 감지하는 상태값 (지우면 다시 활성화됨)
    const isConvertedSns = url.includes('/rss/instagram/') || url.includes('/rss/twitter/');

    // 🚀 DB(shared_categories)에서 '소셜' 카테고리를 동적으로 찾는 함수
    const findSnsCategory = () => {
        const allCategories = [...categories, ...labels];
        return (
            allCategories.find(c => c === '소셜' || c === '소셜 미디어' || c === 'SNS') ||
            manualCategory
        );
    };

    // 📸 인스타그램 변환 핸들러 (입력창이 비어있으면 프롬프트 팝업 호출)
    const handleInstaConvert = () => {
        if (isConvertedSns) return;
        let rawInput = url.trim();
        if (!rawInput) {
            const prompted = window.prompt(
                'RSS로 변환할 인스타그램 계정 아이디를 입력하세요.\n(예: going_to_the_moon, zuck 등)'
            );
            if (!prompted || !prompted.trim()) return;
            rawInput = prompted.trim();
        }
        let cleanName = rawInput.replace(/^@/, '');
        if (cleanName.includes('instagram.com/')) {
            cleanName = cleanName.split('instagram.com/')[1].split('/')[0].split('?')[0];
        }
        if (cleanName) {
            setUrl(`${window.location.origin}/rss/instagram/${cleanName}`);
            setName(`${cleanName} 인스타 브리핑`);
            setManualCategory(findSnsCategory());
        }
    };

    // 𝕏 X(트위터) 변환 핸들러 (입력창이 비어있으면 프롬프트 팝업 호출)
    const handleTwitterConvert = () => {
        if (isConvertedSns) return;
        let rawInput = url.trim();
        if (!rawInput) {
            const prompted = window.prompt(
                '시그널 디스틸러로 변환할 X(트위터) 계정 아이디를 입력하세요.\n(예: elonmusk, nasa 등)'
            );
            if (!prompted || !prompted.trim()) return;
            rawInput = prompted.trim();
        }
        let cleanName = rawInput.replace(/^@/, '');
        if (cleanName.match(/(x|twitter)\.com\//)) {
            cleanName = cleanName.split(/(?:x|twitter)\.com\//)[1].split('/')[0].split('?')[0];
        }
        if (cleanName) {
            setUrl(`${window.location.origin}/rss/twitter/${cleanName}`);
            setName(`${cleanName} X(트위터) 브리핑`);
            setManualCategory(findSnsCategory());
        }
    };

    // 🤖 텔레그램 1초 자동 연동 실행
    const openTelegramAutoLink = () => {
        if (!effectiveUserId) {
            alert('로그인 후 이용해 주세요.');
            return;
        }
        isLinkedRef.current = false;
        setAutoLinkWaiting(true);

        window.open(
            'https://t.me/teledesksignal_bot?start=' + encodeURIComponent(effectiveUserId),
            '_blank'
        );

        if (tgPollRef.current) clearInterval(tgPollRef.current);
        let checkCount = 0;

        tgPollRef.current = setInterval(async () => {
            if (isLinkedRef.current) return;
            checkCount++;
            if (checkCount > 60) {
                if (tgPollRef.current) clearInterval(tgPollRef.current);
                setAutoLinkWaiting(false);
                alert('연동 대기 시간이 초과되었습니다. 다시 시도해 주세요.');
                return;
            }
            try {
                const res = await fetch(
                    '/api/check-telegram?userId=' + encodeURIComponent(effectiveUserId),
                    { cache: 'no-store' }
                );
                const data = (await res.json()) as { success: boolean; chatId?: string };
                if (!isLinkedRef.current && data.success && data.chatId) {
                    isLinkedRef.current = true;
                    if (tgPollRef.current) clearInterval(tgPollRef.current);
                    setTgChatId(data.chatId);
                    setTgInputId(data.chatId);
                    setHasTelegramLinked(true);
                    setAutoLinkWaiting(false);
                    setShowChannelModal(false);
                    alert('✅ 텔레그램 자동 연동이 완료되었습니다!');
                }
            } catch (err) {
                console.error('연동 상태 확인 중 오류:', err);
            }
        }, 2000);
    };

    // 💾 텔레그램 Chat ID 수동 저장 -> /api/telegram 으로 직접 전송!
    const saveChannelSettings = async () => {
        if (!effectiveUserId) {
            alert('로그인이 필요합니다.');
            return;
        }
        setSavingChannel(true);
        try {
            const res = await fetch('/api/telegram', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: effectiveUserId, chatId: tgInputId.trim() }),
            });
            const result = (await res.json()) as { success: boolean; error?: string };
            if (result.success) {
                const updated = tgInputId.trim();
                setTgChatId(updated);
                setHasTelegramLinked(updated !== '');
                setShowChannelModal(false);
                alert(
                    updated
                        ? '✅ 채널 연동 정보가 저장되었습니다.'
                        : '연동이 해제되었습니다.'
                );
            } else {
                alert(result.error || '설정 저장에 실패했습니다.');
            }
        } catch (e) {
            alert('통신 오류가 발생했습니다.');
        } finally {
            setSavingChannel(false);
        }
    };

    async function subscribe(f: {
        id: string;
        name: string;
        url: string;
        category: string;
        country?: string;
    }) {
        if (pending.current) return;

        // 🚀 1. 직접 등록(manual)일 때 텔레그램이 미연동 상태라면 설정 모달을 먼저 띄워 유도!
        if (f.id === 'manual' && !hasTelegramLinked) {
            alert('알림을 수신할 Telegram Chat ID를 먼저 연동해 주세요.');
            setTgInputId(tgChatId);
            setShowChannelModal(true);
            return;
        }

        const limit = subscription?.limits?.feeds || 9999;
        const currentPlan = subscription?.plan || 'pro';

        if (feeds.length >= limit) {
            setError('요금제 제한에 도달했습니다.');
            setRowError(f.id);
            return;
        }
        if (
            f.id === 'manual' &&
            currentPlan === 'free' &&
            feeds.filter(x => !catalog.some(c => canonical(c.url) === canonical(x.url))).length >= 1
        ) {
            setError('Free는 커스텀 피드를 1개만 등록할 수 있습니다.');
            setRowError(f.id);
            return;
        }

        let normalized = canonical(f.url);
        if (subscribed.has(normalized) || added.current.has(normalized)) {
            setNotice('이미 구독 중인 피드입니다.');
            return;
        }

        pending.current = true;
        setBusy(f.id);
        setError('');
        setRowError('');
        setNotice('');
        try {
            let processUrl = f.url.trim();

            if (!processUrl.startsWith('http') && !processUrl.startsWith('https')) {
                alert(
                    '🚨 URL 형식이 아닙니다. 인스타 또는 X 계정이라면 입력창 우측의 [📷 인스타 변환] 또는 [𝕏 X 변환] 버튼을 먼저 눌러서 주소를 완성해 주세요!'
                );
                throw new Error('URL 변환이 필요합니다.');
            }

            const r = await fetch('/api/feed?url=' + encodeURIComponent(processUrl));
            const d: any = await r.json();

            if (!r.ok) throw new Error(d.error || '피드를 확인하지 못했습니다.');

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
                        body: JSON.stringify({
                            userId: effectiveUserId,
                            feedUrl: finalFeedUrl,
                            categoryName: finalName,
                            frequency,
                            targetChannel,
                            aiPromptCode,
                            customPrompt,
                        }),
                    });
                } catch (err) {
                    console.error('알림 설정 연동 실패:', err);
                }
            }

            setNotice(finalName + ' 소스를 추가했습니다.' + (d.notice ? ' ' + d.notice : ''));
            if (f.id === 'manual') {
                setName('');
                setUrl('');
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : '등록 실패');
            setRowError(f.id);
        } finally {
            pending.current = false;
            setBusy('');
        }
    }

    return (
        <div className="modal-backdrop directory-backdrop" onClick={onClose}>
            <section
                ref={dialog}
                className="feed-directory"
                role="dialog"
                aria-modal="true"
                aria-labelledby="directory-title"
                onClick={e => e.stopPropagation()}
                style={{ position: 'relative' }}
            >
                <header className="directory-header">
                    <div className="directory-heading">
                        <span className="brand-icon">
                            <Rss size={21} />
                        </span>
                        <div>
                            <h2 id="directory-title">피드 소스 찾기</h2>
                            <p>
                                {countries.filter(c => c !== '글로벌').length}개 국가·지역 ·{' '}
                                {catalog.length}개 RSS 피드
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="directory-close" aria-label="닫기">
                        <X size={21} />
                    </button>
                </header>

                <div className="directory-tabs">
                    <button
                        className={tab === 'browse' ? 'selected' : ''}
                        onClick={() => {
                            setTab('browse');
                            setError('');
                        }}
                    >
                        <Globe size={15} /> 세계 RSS 목록
                    </button>
                    <button
                        className={tab === 'manual' ? 'selected' : ''}
                        onClick={() => {
                            setTab('manual');
                            setError('');
                        }}
                    >
                        <Plus size={15} /> 주소 직접 등록
                    </button>
                </div>

                {tab === 'browse' ? (
                    <>
                        <div className="directory-controls">
                            <label className="directory-search">
                                <Search size={17} />
                                <input
                                    aria-label="피드 검색"
                                    placeholder="언론사, 국가, 주제 검색 또는 RSS URL 입력"
                                    value={query}
                                    onChange={e => setQuery(e.target.value)}
                                />
                                {query && (
                                    <button onClick={() => setQuery('')} aria-label="검색 지우기">
                                        <X size={15} />
                                    </button>
                                )}
                            </label>
                            <div className="directory-filters">
                                <select
                                    aria-label="국가"
                                    value={country}
                                    onChange={e => setCountry(e.target.value)}
                                >
                                    <option>전체 국가</option>
                                    {countries.map(c => (
                                        <option key={c}>{c}</option>
                                    ))}
                                </select>
                                <select
                                    aria-label="카테고리"
                                    value={category}
                                    onChange={e => setCategory(e.target.value)}
                                >
                                    <option>전체 카테고리</option>
                                    {labels.map(c => (
                                        <option key={c}>{c}</option>
                                    ))}
                                </select>
                                <select
                                    aria-label="정렬"
                                    value={sort}
                                    onChange={e => setSort(e.target.value)}
                                >
                                    <option value="publisher">기본순</option>
                                    <option value="name">이름순</option>
                                    <option value="country">국가순</option>
                                </select>
                            </div>
                            <div className="directory-result-count">
                                <span>
                                    검색 결과 <b>{results.length}</b>
                                </span>
                                <span>구독 시 연결 확인</span>
                            </div>
                        </div>
                        <div className="directory-results">
                            {loading && (
                                <p className="directory-note" role="status">
                                    공용 목록을 불러오는 중…
                                </p>
                            )}
                            {catalogError && (
                                <p className="directory-error" role="alert">
                                    {catalogError} <button onClick={loadCatalog}>다시 시도</button>
                                </p>
                            )}
                            {results.map(f => {
                                const isAdded = subscribed.has(canonical(f.url));
                                return (
                                    <div key={f.id} className="directory-item">
                                        <span
                                            className={
                                                'publisher-mark ' +
                                                (f.kind === '뉴스 모음' ? 'aggregate' : '')
                                            }
                                        >
                                            {f.kind === '뉴스 모음' ? (
                                                <Globe size={18} />
                                            ) : (
                                                f.name.slice(0, 2).toUpperCase()
                                            )}
                                        </span>
                                        <div className="directory-item-info">
                                            <h3>{f.name}</h3>
                                            <p>
                                                {f.country} · {f.category} · {f.language}
                                                <span>
                                                    {f.kind === '뉴스 모음' ? '피드 모음' : f.kind}
                                                </span>
                                            </p>
                                            {rowError === f.id && error && (
                                                <p className="directory-error" role="alert">
                                                    {error}
                                                </p>
                                            )}
                                        </div>
                                        <button
                                            disabled={!!busy || isAdded}
                                            className={
                                                isAdded
                                                    ? 'subscribe-button subscribed'
                                                    : 'subscribe-button'
                                            }
                                            onClick={() => subscribe(f)}
                                            aria-label={f.name + (isAdded ? ' 구독 중' : ' 구독하기')}
                                        >
                                            {busy === f.id ? (
                                                <LoaderCircle size={15} className="spin" />
                                            ) : isAdded ? (
                                                <Check size={15} />
                                            ) : (
                                                <Plus size={15} />
                                            )}
                                            <span>
                                                {busy === f.id
                                                    ? '확인 중'
                                                    : isAdded
                                                      ? '구독 중'
                                                      : '구독'}
                                            </span>
                                        </button>
                                    </div>
                                );
                            })}
                            {!loading && !catalogError && !results.length && (
                                <div className="directory-empty">
                                    <Search size={29} />
                                    <h3>일치하는 피드가 없습니다</h3>
                                    <p>
                                        다른 국가·카테고리로 검색하거나 RSS 주소를 직접 등록해
                                        주세요.
                                    </p>
                                    <button
                                        onClick={() => {
                                            setTab('manual');
                                            if (/^https?:\/\//i.test(query)) setUrl(query);
                                        }}
                                    >
                                        RSS 직접 등록
                                    </button>
                                </div>
                            )}
                        </div>
                        <p className="directory-note">
                            관리자가 제공하는 공용 RSS 목록입니다. 원하는 소스를 선택해 구독하면 내
                            피드에 추가됩니다.
                        </p>
                    </>
                ) : (
                    <form
                        className="directory-manual"
                        onSubmit={e => {
                            e.preventDefault();
                            subscribe({ id: 'manual', name, url, category: manualCategory });
                        }}
                    >
                        {/* 상단 타이틀 및 알림 채널 연동 상태 배지 */}
                        <div
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'flex-start',
                                gap: '12px',
                                marginBottom: '12px',
                            }}
                        >
                            <div>
                                <h3 style={{ margin: 0 }}>RSS·인스타그램·X 계정으로 연결하세요</h3>
                                <p style={{ margin: '4px 0 0 0' }}>
                                    RSS 주소 또는 공개 SNS 계정 주소를 입력하세요. AI 요약 브리핑과
                                    피드 수집이 동시에 등록됩니다.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setTgInputId(tgChatId);
                                    setShowChannelModal(true);
                                }}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '7px 14px',
                                    borderRadius: '8px',
                                    fontSize: '12px',
                                    fontWeight: 700,
                                    whiteSpace: 'nowrap',
                                    cursor: 'pointer',
                                    border: hasTelegramLinked
                                        ? '1px solid #6ee7b7'
                                        : '1px solid #fda4af',
                                    backgroundColor: hasTelegramLinked ? '#ecfdf5' : '#fff1f2',
                                    color: hasTelegramLinked ? '#047857' : '#e11d48',
                                }}
                            >
                                알림 채널 연동 {hasTelegramLinked ? '🟢' : '🔴'}
                            </button>
                        </div>

                        {/* 1. 수신 플랫폼 */}
                        <div style={{ marginBottom: '16px' }}>
                            <span
                                style={{
                                    display: 'block',
                                    fontSize: '13px',
                                    fontWeight: 600,
                                    marginBottom: '8px',
                                    color: '#334155',
                                }}
                            >
                                1. 수신 플랫폼
                            </span>
                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                <button
                                    type="button"
                                    onClick={() => setTargetChannel('telegram')}
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        padding: '9px 16px',
                                        borderRadius: '10px',
                                        fontSize: '13px',
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        border:
                                            targetChannel === 'telegram'
                                                ? '2px solid #2563eb'
                                                : '2px solid #e2e8f0',
                                        backgroundColor:
                                            targetChannel === 'telegram' ? '#eff6ff' : '#ffffff',
                                        color:
                                            targetChannel === 'telegram' ? '#1d4ed8' : '#64748b',
                                    }}
                                >
                                    <svg
                                        style={{ width: '15px', height: '15px', fill: '#3b82f6' }}
                                        viewBox="0 0 24 24"
                                    >
                                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.19-.08-.05-.19-.02-.27 0-.12.03-1.96 1.25-5.54 3.67-.52.36-1 .53-1.42.52-.47-.01-1.37-.26-2.03-.48-.82-.27-1.47-.41-1.41-.87.03-.24.36-.48.98-.74 3.85-1.68 6.42-2.78 7.71-3.32 3.67-1.52 4.43-1.79 4.92-1.79.11 0 .36.03.49.13.11.08.14.19.15.28-.01.05.01.14 0 .18z" />
                                    </svg>
                                    텔레그램
                                </button>

                                <button
                                    type="button"
                                    onClick={() =>
                                        alert('디스코드 웹훅 연동은 추후 지원될 PRO 기능입니다.')
                                    }
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        padding: '9px 16px',
                                        borderRadius: '10px',
                                        fontSize: '13px',
                                        fontWeight: 700,
                                        cursor: 'not-allowed',
                                        border: '2px solid #f1f5f9',
                                        backgroundColor: '#f8fafc',
                                        color: '#94a3b8',
                                    }}
                                >
                                    디스코드{' '}
                                    <span
                                        style={{
                                            backgroundColor: '#e2e8f0',
                                            color: '#64748b',
                                            fontSize: '10px',
                                            padding: '2px 6px',
                                            borderRadius: '4px',
                                            fontWeight: 800,
                                        }}
                                    >
                                        PRO
                                    </span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() =>
                                        alert('이메일 뉴스레터 발송은 추후 지원될 PRO 기능입니다.')
                                    }
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        padding: '9px 16px',
                                        borderRadius: '10px',
                                        fontSize: '13px',
                                        fontWeight: 700,
                                        cursor: 'not-allowed',
                                        border: '2px solid #f1f5f9',
                                        backgroundColor: '#f8fafc',
                                        color: '#94a3b8',
                                    }}
                                >
                                    이메일{' '}
                                    <span
                                        style={{
                                            backgroundColor: '#e2e8f0',
                                            color: '#64748b',
                                            fontSize: '10px',
                                            padding: '2px 6px',
                                            borderRadius: '4px',
                                            fontWeight: 800,
                                        }}
                                    >
                                        PRO
                                    </span>
                                </button>
                            </div>
                        </div>

                        {/* 2. 발송 스케줄 & 3. AI 브리핑 컨셉 */}
                        <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
                            <label style={{ flex: 1 }}>
                                2. 발송 스케줄 (AI 브리핑)
                                <select
                                    value={frequency}
                                    onChange={e => setFrequency(e.target.value)}
                                    style={{
                                        width: '100%',
                                        marginTop: '6px',
                                        padding: '10px',
                                        borderRadius: '8px',
                                        border: '1px solid #cbd5e1',
                                    }}
                                >
                                    {frequencyOptions.map(opt => (
                                        <option key={opt.code_value} value={opt.code_value}>
                                            {opt.display_name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label style={{ flex: 1 }}>
                                3. AI 브리핑 컨셉 (템플릿)
                                <select
                                    value={aiPromptCode}
                                    onChange={e => setAiPromptCode(e.target.value)}
                                    style={{
                                        width: '100%',
                                        marginTop: '6px',
                                        padding: '10px',
                                        borderRadius: '8px',
                                        border: '1px solid #bfdbfe',
                                        backgroundColor: '#eff6ff',
                                        color: '#1e40af',
                                        fontWeight: 600,
                                    }}
                                >
                                    {promptOptions.map(opt => (
                                        <option key={opt.code_value} value={opt.code_value}>
                                            {opt.display_name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </div>

                        {aiPromptCode === 'CUSTOM' && (
                            <label style={{ display: 'block', marginBottom: '16px' }}>
                                커스텀 AI 프롬프트 입력
                                <textarea
                                    required
                                    value={customPrompt}
                                    onChange={e => setCustomPrompt(e.target.value)}
                                    placeholder="예: '일론 머스크'와 관련된 내용만 요약해 주고, 마지막에 🚀 이모티콘을 달아줘."
                                    style={{
                                        width: '100%',
                                        minHeight: '80px',
                                        marginTop: '6px',
                                        padding: '10px',
                                        borderRadius: '8px',
                                        border: '1px solid #cbd5e1',
                                        resize: 'vertical',
                                    }}
                                />
                            </label>
                        )}

                        {/* 4. 데이터 소스 URL (RSS) */}
                        <label style={{ display: 'block', marginBottom: '16px' }}>
                            4. 데이터 소스 URL (RSS)
                            <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                                <input
                                    required
                                    type="text"
                                    value={url}
                                    onChange={e => setUrl(e.target.value)}
                                    placeholder="https://news.google.com/rss/... (우측 버튼 클릭 시 아이디로 자동 생성)"
                                    style={{
                                        flex: 1,
                                        padding: '10px',
                                        borderRadius: '8px',
                                        border: '1px solid #cbd5e1',
                                        margin: 0,
                                    }}
                                />

                                <button
                                    type="button"
                                    disabled={isConvertedSns}
                                    onClick={handleInstaConvert}
                                    style={{
                                        backgroundColor: '#fce7f3',
                                        color: '#be185d',
                                        border: '1px solid #fbcfe8',
                                        padding: '0 14px',
                                        borderRadius: '8px',
                                        fontWeight: 700,
                                        fontSize: '13px',
                                        whiteSpace: 'nowrap',
                                        cursor: isConvertedSns ? 'not-allowed' : 'pointer',
                                        opacity: isConvertedSns ? 0.45 : 1,
                                    }}
                                >
                                    📷 인스타 변환
                                </button>

                                <button
                                    type="button"
                                    disabled={isConvertedSns}
                                    onClick={handleTwitterConvert}
                                    style={{
                                        backgroundColor: '#0f1419',
                                        color: '#ffffff',
                                        border: 'none',
                                        padding: '0 14px',
                                        borderRadius: '8px',
                                        fontWeight: 700,
                                        fontSize: '13px',
                                        whiteSpace: 'nowrap',
                                        cursor: isConvertedSns ? 'not-allowed' : 'pointer',
                                        opacity: isConvertedSns ? 0.45 : 1,
                                    }}
                                >
                                    𝕏 X 변환
                                </button>
                            </div>
                        </label>

                        {/* 5. 시그널 명칭 (소스 이름) & 카테고리 */}
                        <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
                            <label style={{ flex: 2 }}>
                                5. 시그널 명칭 (소스 이름)
                                <input
                                    required
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    placeholder="예: elonmusk X(트위터) 브리핑"
                                    maxLength={60}
                                    style={{
                                        width: '100%',
                                        marginTop: '6px',
                                        padding: '10px',
                                        borderRadius: '8px',
                                        border: '1px solid #cbd5e1',
                                    }}
                                />
                            </label>

                            <label style={{ flex: 1 }}>
                                카테고리 분류
                                <select
                                    value={manualCategory}
                                    onChange={e => setManualCategory(e.target.value)}
                                    style={{
                                        width: '100%',
                                        marginTop: '6px',
                                        padding: '10px',
                                        borderRadius: '8px',
                                        border: '1px solid #cbd5e1',
                                    }}
                                >
                                    {Array.from(new Set([...categories, ...labels]))
                                        .filter(c => c !== '전체')
                                        .map(c => (
                                            <option key={c}>{c}</option>
                                        ))}
                                </select>
                            </label>
                        </div>

                        {rowError === 'manual' && error && (
                            <p
                                className="directory-error"
                                role="alert"
                                style={{ marginTop: '12px' }}
                            >
                                {error}
                            </p>
                        )}

                        <button
                            className="submit"
                            disabled={!!busy}
                            style={{
                                width: '100%',
                                marginTop: '12px',
                                padding: '14px',
                                borderRadius: '10px',
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                                gap: '6px',
                                fontWeight: 700,
                            }}
                        >
                            {busy ? '시그널 및 피드 확인 중…' : '시그널 활성화 (피드 소스 추가)'}
                            {!busy && <Plus size={17} />}
                        </button>
                        <small style={{ display: 'block', marginTop: '12px', color: '#64748b' }}>
                            RSS·Atom과 공개 인스타그램·X 계정 주소를 지원합니다. 알림 채널(텔레그램)이
                            연동되어 있어야 실시간 브리핑을 수신할 수 있습니다.
                        </small>
                    </form>
                )}

                <footer className="directory-footer">
                    <span role="status">{notice || '관심 있는 소스를 골라 구독하세요.'}</span>
                    <button type="button" onClick={onClose}>
                        완료
                    </button>
                </footer>

                {/* 🔔 알림 채널 설정 서브 모달 */}
                {showChannelModal && (
                    <div
                        onClick={() => setShowChannelModal(false)}
                        style={{
                            position: 'fixed',
                            inset: 0,
                            backgroundColor: 'rgba(15, 23, 42, 0.6)',
                            backdropFilter: 'blur(4px)',
                            zIndex: 9999,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '16px',
                        }}
                    >
                        <div
                            onClick={e => e.stopPropagation()}
                            style={{
                                backgroundColor: '#ffffff',
                                borderRadius: '24px',
                                maxWidth: '480px',
                                width: '100%',
                                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                                border: '1px solid #f1f5f9',
                                overflow: 'hidden',
                            }}
                        >
                            <div
                                style={{
                                    backgroundColor: '#f8fafc',
                                    padding: '20px 24px',
                                    borderBottom: '1px solid #f1f5f9',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                }}
                            >
                                <h3
                                    style={{
                                        margin: 0,
                                        fontSize: '18px',
                                        fontWeight: 800,
                                        color: '#0f172a',
                                    }}
                                >
                                    알림 채널 설정
                                </h3>
                                <button
                                    type="button"
                                    onClick={() => setShowChannelModal(false)}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        color: '#94a3b8',
                                        cursor: 'pointer',
                                    }}
                                >
                                    <X size={22} />
                                </button>
                            </div>

                            <div style={{ padding: '28px 24px' }}>
                                {/* 1. 텔레그램 Chat ID */}
                                <div style={{ marginBottom: '22px' }}>
                                    <label
                                        style={{
                                            display: 'block',
                                            fontSize: '14px',
                                            fontWeight: 700,
                                            color: '#334155',
                                            marginBottom: '8px',
                                        }}
                                    >
                                        텔레그램 Chat ID
                                    </label>
                                    <input
                                        type="text"
                                        value={tgInputId}
                                        onChange={e => setTgInputId(e.target.value)}
                                        placeholder="예: 8568727012 (비워두면 연동 해제)"
                                        style={{
                                            width: '100%',
                                            padding: '12px 14px',
                                            borderRadius: '12px',
                                            backgroundColor: '#f8fafc',
                                            border: '1px solid #e2e8f0',
                                            fontSize: '14px',
                                            fontFamily: 'monospace',
                                        }}
                                    />
                                    <p
                                        style={{
                                            fontSize: '11px',
                                            color: '#94a3b8',
                                            marginTop: '6px',
                                            marginBottom: '12px',
                                        }}
                                    >
                                        TELE-DESK 봇과 대화하여 얻은 고유 ID를 입력해 주십시오.
                                    </p>

                                    <button
                                        type="button"
                                        onClick={openTelegramAutoLink}
                                        style={{
                                            width: '100%',
                                            padding: '11px 16px',
                                            borderRadius: '12px',
                                            backgroundColor: '#ecfdf5',
                                            border: '1px solid #a7f3d0',
                                            color: '#047857',
                                            fontSize: '12px',
                                            fontWeight: 700,
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '6px',
                                        }}
                                    >
                                        {autoLinkWaiting
                                            ? '⏳ 텔레그램에서 [시작]을 눌러주세요...'
                                            : '🤖 ID 복사 필요 없어요! 텔레그램 1초 만에 자동 연동하기'}
                                    </button>
                                </div>

                                {/* 2. 디스코드 Webhook URL (PRO) */}
                                <div style={{ marginBottom: '20px', opacity: 0.55 }}>
                                    <label
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            fontSize: '14px',
                                            fontWeight: 700,
                                            color: '#334155',
                                            marginBottom: '8px',
                                        }}
                                    >
                                        디스코드 Webhook URL
                                        <span
                                            style={{
                                                backgroundColor: '#e2e8f0',
                                                color: '#64748b',
                                                fontSize: '10px',
                                                padding: '2px 6px',
                                                borderRadius: '4px',
                                                fontWeight: 800,
                                            }}
                                        >
                                            PRO
                                        </span>
                                    </label>
                                    <input
                                        type="text"
                                        disabled
                                        placeholder="https://discord.com/api/webhooks/..."
                                        style={{
                                            width: '100%',
                                            padding: '12px 14px',
                                            borderRadius: '12px',
                                            backgroundColor: '#f1f5f9',
                                            border: '1px solid #e2e8f0',
                                            fontSize: '14px',
                                            fontFamily: 'monospace',
                                        }}
                                    />
                                </div>

                                {/* 3. 이메일 수신 주소 (PRO) */}
                                <div style={{ opacity: 0.55 }}>
                                    <label
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            fontSize: '14px',
                                            fontWeight: 700,
                                            color: '#334155',
                                            marginBottom: '8px',
                                        }}
                                    >
                                        이메일 수신 주소
                                        <span
                                            style={{
                                                backgroundColor: '#e2e8f0',
                                                color: '#64748b',
                                                fontSize: '10px',
                                                padding: '2px 6px',
                                                borderRadius: '4px',
                                                fontWeight: 800,
                                            }}
                                        >
                                            PRO
                                        </span>
                                    </label>
                                    <input
                                        type="email"
                                        disabled
                                        placeholder="example@email.com"
                                        style={{
                                            width: '100%',
                                            padding: '12px 14px',
                                            borderRadius: '12px',
                                            backgroundColor: '#f1f5f9',
                                            border: '1px solid #e2e8f0',
                                            fontSize: '14px',
                                        }}
                                    />
                                </div>
                            </div>

                            <div
                                style={{
                                    padding: '16px 24px',
                                    backgroundColor: '#f8fafc',
                                    borderTop: '1px solid #f1f5f9',
                                    display: 'flex',
                                    justifyContent: 'flex-end',
                                    gap: '10px',
                                }}
                            >
                                <button
                                    type="button"
                                    onClick={() => setShowChannelModal(false)}
                                    style={{
                                        padding: '10px 18px',
                                        borderRadius: '12px',
                                        border: 'none',
                                        backgroundColor: 'transparent',
                                        color: '#64748b',
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                    }}
                                >
                                    취소
                                </button>
                                <button
                                    type="button"
                                    disabled={savingChannel}
                                    onClick={saveChannelSettings}
                                    style={{
                                        padding: '10px 20px',
                                        borderRadius: '12px',
                                        border: 'none',
                                        backgroundColor: '#0f172a',
                                        color: '#ffffff',
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                    }}
                                >
                                    {savingChannel ? '저장 중…' : '설정 저장'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}