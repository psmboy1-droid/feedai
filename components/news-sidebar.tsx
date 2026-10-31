'use client';
import { useEffect, useRef, useState } from 'react';
import {
    Rss,
    Bookmark,
    Plus,
    Newspaper,
    Trash2,
    X,
    ChevronDown,
    ChevronUp,
    ChevronRight,
    UserRound,
    Coins,
    Zap,
    Pencil,
    Loader2
} from 'lucide-react';
import { AccountPanel, useNewsAccount } from './news-account';
import { type Feed } from '../lib/news-config';
import AlertModal from './AlertModal';

type Props = {
    mobile: boolean;
    feeds: Feed[];
    articleCount: number;
    savedCount: number;
    view?: string;
    cat?: string;
    source?: string;
    errors?: Record<string, string>;
    select: (view: string, category?: string, source?: string) => void;
    onAdd: () => void;
    onDelete: (id: string) => void;
    onUpdateFeed?: (updated: Feed) => void;
    onClose: () => void;
};

export default function NewsSidebar({
    mobile,
    feeds,
    articleCount,
    savedCount,
    view = '',
    cat = '',
    source = '',
    errors = {},
    select,
    onAdd,
    onDelete,
    onUpdateFeed,
    onClose
}: Props) {
    const { user, tokens, subscription } = useNewsAccount();
    const [sourcesExpanded, setSourcesExpanded] = useState(false);
    const dialogRef = useRef<HTMLDialogElement>(null);
    const [pendingDelete, setPendingDelete] = useState<Feed | null>(null);

    // ⚡ 즉시 발송 상태
    const [firingId, setFiringId] = useState<string | null>(null);

    // ✏️ 시그널 수정 모달 상태
    const [editingFeed, setEditingFeed] = useState<Feed | null>(null);
    const [editName, setEditName] = useState('');
    const [editFrequency, setEditFrequency] = useState('360');
    const [editAiPromptCode, setEditAiPromptCode] = useState('DEFAULT');
    const [editCustomPrompt, setEditCustomPrompt] = useState('');
    const [isSavingEdit, setIsSavingEdit] = useState(false);

    // 공통 코드 옵션
    const [frequencyOptions, setFrequencyOptions] = useState<{ code_value: string; display_name: string }[]>([
        { code_value: '60', display_name: '1시간 간격' },
        { code_value: '180', display_name: '3시간 간격' },
        { code_value: '360', display_name: '6시간 간격' },
        { code_value: '720', display_name: '12시간 간격' },
        { code_value: '1440', display_name: '24시간 간격' }
    ]);
    const [promptOptions, setPromptOptions] = useState<{ code_value: string; display_name: string }[]>([
        { code_value: 'DEFAULT', display_name: '✨ 기본 3줄 인사이트 요약' },
        { code_value: 'CUSTOM', display_name: '나만의 커스텀 명령 (PRO)' }
    ]);

    // 🎨 피드AI 전용 모달 알림창 상태
    const [alertState, setAlertState] = useState<{
        isOpen: boolean;
        message: string;
        type: 'error' | 'success' | 'info';
    }>({
        isOpen: false,
        message: '',
        type: 'info'
    });

    const showAlert = (message: string, type: 'error' | 'success' | 'info' = 'info') => {
        setAlertState({ isOpen: true, message, type });
    };

    useEffect(() => {
        fetch('/api/common-codes')
            .then(res => res.json())
            .then((data: any) => {
                if (data.frequencies && Array.isArray(data.frequencies)) {
                    setFrequencyOptions(data.frequencies);
                }
                if (data.prompts && Array.isArray(data.prompts)) {
                    setPromptOptions(data.prompts);
                }
            })
            .catch(() => {});
    }, []);

    // ⚡ 텔레그램 즉시 발송 핸들러
    const handleFireSignal = async (f: Feed) => {
        if (!user) {
            showAlert('로그인 후 이용해 주세요.', 'info');
            return;
        }
        if (firingId) return;

        setFiringId(f.id);
        try {
            const res = await fetch('/api/fire-signal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: user.id, feedUrl: f.url })
            });
            const data: any = await res.json();
            if (data.success) {
                showAlert(`✅ [${f.name}]\n${data.message || '텔레그램 발송 완료'}`, 'success');
            } else {
                showAlert(`⚠️ [${f.name}] 발송 실패:\n${data.message || '텔레그램 연동 상태 또는 RSS 피드를 확인해 주세요.'}`, 'error');
            }
        } catch (err: any) {
            showAlert(`🚨 발송 통신 에러: ${err.message || '잠시 후 다시 시도해 주세요.'}`, 'error');
        } finally {
            setFiringId(null);
        }
    };

    // ✏️ 시그널 수정 모달 열기
    const openEditModal = async (f: Feed) => {
        setEditingFeed(f);
        setEditName(f.name);
        setEditFrequency((f as any).frequency || '360');
        setEditAiPromptCode((f as any).aiPromptCode || 'DEFAULT');
        setEditCustomPrompt((f as any).customPrompt || '');

        // DB에서 최신 시그널 설정값 조회 (새로고침 없이도 항상 최신 동기화)
        const effectiveUserId = user?.id;
        if (effectiveUserId) {
            try {
                const res = await fetch(`/api/signals?userId=${encodeURIComponent(effectiveUserId)}`);
                const data: any = await res.json();
                if (data.signals && Array.isArray(data.signals)) {
                    const match = data.signals.find((s: any) => 
                        s.feed_url === f.url || 
                        (s.id && (s.id === (f as any).signalId || s.id === f.id))
                    );
                    if (match) {
                        setEditName(match.category_name || f.name);
                        setEditFrequency(match.frequency || '360');
                        setEditAiPromptCode(match.ai_prompt_code || 'DEFAULT');
                        setEditCustomPrompt(match.custom_prompt || '');
                    }
                }
            } catch {}
        }
    };

    // 💾 시그널 수정 저장
    const handleSaveEdit = async () => {
        if (!editingFeed) return;
        if (!editName.trim()) {
            showAlert('시그널 명칭을 입력해 주세요.', 'error');
            return;
        }

        setIsSavingEdit(true);
        try {
            const res = await fetch('/api/edit-signal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: (editingFeed as any).signalId || editingFeed.id,
                    feedUrl: editingFeed.url,
                    categoryName: editName.trim(),
                    frequency: editFrequency,
                    aiPromptCode: editAiPromptCode,
                    customPrompt: editCustomPrompt.trim(),
                    userId: user?.id
                })
            });
            const data: any = await res.json();
            if (data.success) {
                const updated = {
                    ...editingFeed,
                    name: editName.trim(),
                    frequency: editFrequency,
                    aiPromptCode: editAiPromptCode,
                    customPrompt: editCustomPrompt.trim(),
                    signalId: data.signalId || (editingFeed as any).signalId
                };
                onUpdateFeed?.(updated);
                setEditingFeed(null);
                showAlert('✅ 시그널 설정이 저장되었습니다.', 'success');
            } else {
                showAlert(`수정 실패: ${data.error || '잠시 후 다시 시도해 주세요.'}`, 'error');
            }
        } catch (e: any) {
            showAlert(`통신 오류: ${e.message}`, 'error');
        } finally {
            setIsSavingEdit(false);
        }
    };

    return (
        <aside className={mobile ? 'sidebar show' : 'sidebar'}>
            <a className="brand" href={user ? '/my-feed' : '/'} aria-label="피드AI 홈">
                <span className="brand-icon">
                    <Rss size={21} />
                </span>
                피드AI
            </a>
            <button className="sidebar-close" aria-label="메뉴 닫기" onClick={onClose}>
                <X size={18} />
            </button>
            <section className="sidebar-profile" aria-label="내 계정">
                <div className="sidebar-profile-identity">
                    <span className="sidebar-profile-name" title={user?.name}>
                        {user ? user.name : '나의 피드 공간'}
                    </span>
                    {user && (
                        <span
                            className={'sidebar-profile-plan plan-' + subscription.plan}
                            aria-label={'현재 요금제 ' + subscription.limits.name}
                        >
                            {subscription.limits.name}
                        </span>
                    )}
                </div>
                {user && (
                    <div
                        className="sidebar-profile-credits"
                        aria-label={'남은 분석 크레딧 ' + (tokens ?? '확인 중')}
                        title="기사 AI 분석 1회에 1개 사용"
                        aria-live="polite"
                    >
                        <span>
                            <Coins size={14} aria-hidden="true" /> 크레딧
                        </span>
                        <strong>
                            {tokens === null ? '…' : tokens.toLocaleString()}
                            <small>개</small>
                        </strong>
                    </div>
                )}
                {user ? (
                    <a className="sidebar-profile-link" href="/mypage" onClick={onClose}>
                        <span>
                            <UserRound size={15} aria-hidden="true" />
                            마이페이지
                        </span>
                        <ChevronRight size={14} aria-hidden="true" />
                    </a>
                ) : (
                    <a className="sidebar-profile-link" href="/login?return_to=%2Fmy-feed" target="_top">
                        <span>
                            <UserRound size={15} aria-hidden="true" />
                            로그인
                        </span>
                        <ChevronRight size={14} aria-hidden="true" />
                    </a>
                )}
            </section>
            <nav>
                <button
                    className={view === 'news' && cat === '전체' && !source ? 'nav active' : 'nav'}
                    onClick={() => select('news')}
                >
                    <Newspaper size={18} /> 전체 피드 <span>{articleCount}</span>
                </button>
                <button className={view === 'saved' ? 'nav active' : 'nav'} onClick={() => select('saved')}>
                    <Bookmark size={18} /> 저장 <span>{savedCount}</span>
                </button>
            </nav>
            {user && (
                <button className="add-source" onClick={onAdd}>
                    <Plus size={16} /> RSS 추가
                </button>
            )}

            <div className="sources" id="sidebar-feed-sources">
                {(sourcesExpanded ? feeds : feeds.slice(0, 7)).map(f => (
                    <div className="source-row" key={f.id} style={{ display: 'flex', alignItems: 'center' }}>
                        <button
                            className={source === f.id ? 'source selected' : 'source'}
                            onClick={() => select('news', '전체', f.id)}
                            style={{ flex: 1, minWidth: 0 }}
                        >
                            <span className="source-letter">{f.name.slice(0, 1)}</span>
                            <span>{f.name}</span>
                            <i className={errors[f.id] ? 'status error' : 'status'} />
                        </button>
                        {user && (
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '2px',
                                    marginLeft: 'auto',
                                    flexShrink: 0
                                }}
                            >
                                {/* ⚡ 텔레그램 즉시 발송 */}
                                <button
                                    type="button"
                                    disabled={firingId === f.id}
                                    onClick={e => {
                                        e.stopPropagation();
                                        handleFireSignal(f);
                                    }}
                                    title="텔레그램 즉시 발송"
                                    style={{
                                        border: 'none',
                                        background: 'none',
                                        padding: '4px',
                                        borderRadius: '4px',
                                        color: firingId === f.id ? '#2563eb' : '#eab308',
                                        cursor: firingId === f.id ? 'wait' : 'pointer',
                                        opacity: firingId === f.id ? 1 : 0.7,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                                    onMouseLeave={e =>
                                        (e.currentTarget.style.opacity = firingId === f.id ? '1' : '0.7')
                                    }
                                >
                                    {firingId === f.id ? (
                                        <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                                    ) : (
                                        <Zap size={13} />
                                    )}
                                </button>

                                {/* ✏️ 시그널 설정 수정 */}
                                <button
                                    type="button"
                                    onClick={e => {
                                        e.stopPropagation();
                                        openEditModal(f);
                                    }}
                                    title="시그널 설정 수정"
                                    style={{
                                        border: 'none',
                                        background: 'none',
                                        padding: '4px',
                                        borderRadius: '4px',
                                        color: '#64748b',
                                        cursor: 'pointer',
                                        opacity: 0.7,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                                    onMouseLeave={e => (e.currentTarget.style.opacity = '0.7')}
                                >
                                    <Pencil size={13} />
                                </button>

                                {/* 🗑️ 삭제 */}
                                <button
                                    type="button"
                                    className="delete"
                                    aria-label={f.name + ' 삭제'}
                                    title="피드 및 시그널 삭제"
                                    onClick={e => {
                                        e.stopPropagation();
                                        setPendingDelete(f);
                                        dialogRef.current?.showModal();
                                    }}
                                    style={{
                                        border: 'none',
                                        background: 'none',
                                        padding: '4px',
                                        borderRadius: '4px',
                                        color: '#94a3b8',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}
                                >
                                    <Trash2 size={13} />
                                </button>
                            </div>
                        )}
                    </div>
                ))}
                {feeds.length > 7 && (
                    <button
                        type="button"
                        className="sources-toggle"
                        aria-expanded={sourcesExpanded}
                        aria-controls="sidebar-feed-sources"
                        onClick={() => setSourcesExpanded(expanded => !expanded)}
                    >
                        {sourcesExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                        <span>{sourcesExpanded ? '접기' : '더보기'}</span>
                        {!sourcesExpanded && <small>{feeds.length - 7}</small>}
                    </button>
                )}
            </div>

            <AccountPanel />

            {/* 🗑️ 삭제 확인 다이얼로그 */}
            <dialog
                ref={dialogRef}
                className="feed-delete-dialog"
                aria-labelledby="feed-delete-title"
                aria-describedby="feed-delete-name"
                onClose={() => setPendingDelete(null)}
            >
                <h2 id="feed-delete-title">삭제 하시겠습니까?</h2>
                <p id="feed-delete-name">{pendingDelete?.name}</p>
                <div className="feed-delete-actions">
                    <button
                        type="button"
                        className="feed-delete-yes"
                        onClick={() => {
                            if (pendingDelete) {
                                onDelete(pendingDelete.id);
                                dialogRef.current?.close();
                            }
                        }}
                    >
                        네
                    </button>
                    <button type="button" autoFocus onClick={() => dialogRef.current?.close()}>
                        아니오
                    </button>
                </div>
            </dialog>

            {/* ✏️ 시그널 수정 모달 */}
            {editingFeed && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        backgroundColor: 'rgba(15, 23, 42, 0.6)',
                        zIndex: 9999,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '20px'
                    }}
                    onClick={() => setEditingFeed(null)}
                >
                    <div
                        style={{
                            backgroundColor: '#ffffff',
                            borderRadius: '16px',
                            padding: '24px',
                            maxWidth: '480px',
                            width: '100%',
                            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
                            position: 'relative'
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        <div
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginBottom: '16px'
                            }}
                        >
                            <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700 }}>시그널 설정 수정</h3>
                            <button
                                type="button"
                                onClick={() => setEditingFeed(null)}
                                style={{
                                    border: 'none',
                                    background: 'none',
                                    color: '#64748b',
                                    cursor: 'pointer'
                                }}
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <label style={{ display: 'block', marginBottom: '14px', fontSize: '13px', fontWeight: 600 }}>
                            시그널 명칭 (피드 이름)
                            <input
                                required
                                value={editName}
                                onChange={e => setEditName(e.target.value)}
                                style={{
                                    display: 'block',
                                    width: '100%',
                                    marginTop: '6px',
                                    padding: '10px',
                                    borderRadius: '8px',
                                    border: '1px solid #cbd5e1',
                                    fontSize: '13px'
                                }}
                            />
                        </label>

                        <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
                            <label style={{ flex: 1, fontSize: '13px', fontWeight: 600 }}>
                                발송 스케줄 (주기)
                                <select
                                    value={editFrequency}
                                    onChange={e => setEditFrequency(e.target.value)}
                                    style={{
                                        display: 'block',
                                        width: '100%',
                                        marginTop: '6px',
                                        padding: '10px',
                                        borderRadius: '8px',
                                        border: '1px solid #cbd5e1',
                                        fontSize: '13px'
                                    }}
                                >
                                    {frequencyOptions.map(opt => (
                                        <option key={opt.code_value} value={opt.code_value}>
                                            {opt.display_name}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <label style={{ flex: 1, fontSize: '13px', fontWeight: 600 }}>
                                AI 브리핑 컨셉 (템플릿)
                                <select
                                    value={editAiPromptCode}
                                    onChange={e => setEditAiPromptCode(e.target.value)}
                                    style={{
                                        display: 'block',
                                        width: '100%',
                                        marginTop: '6px',
                                        padding: '10px',
                                        borderRadius: '8px',
                                        border: '1px solid #cbd5e1',
                                        fontSize: '13px'
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

                        {editAiPromptCode === 'CUSTOM' && (
                            <label style={{ display: 'block', marginBottom: '14px', fontSize: '13px', fontWeight: 600 }}>
                                커스텀 AI 프롬프트
                                <textarea
                                    value={editCustomPrompt}
                                    onChange={e => setEditCustomPrompt(e.target.value)}
                                    placeholder="예: IT/AI 관련 소식만 요약해 줘."
                                    style={{
                                        display: 'block',
                                        width: '100%',
                                        minHeight: '70px',
                                        marginTop: '6px',
                                        padding: '10px',
                                        borderRadius: '8px',
                                        border: '1px solid #cbd5e1',
                                        fontSize: '13px',
                                        resize: 'vertical'
                                    }}
                                />
                            </label>
                        )}

                        <label style={{ display: 'block', marginBottom: '18px', fontSize: '12px', color: '#64748b' }}>
                            RSS 주소
                            <input
                                readOnly
                                value={editingFeed.url}
                                style={{
                                    display: 'block',
                                    width: '100%',
                                    marginTop: '4px',
                                    padding: '8px 10px',
                                    borderRadius: '6px',
                                    border: '1px solid #e2e8f0',
                                    backgroundColor: '#f8fafc',
                                    color: '#64748b',
                                    fontSize: '11px'
                                }}
                            />
                        </label>

                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button
                                type="button"
                                onClick={() => setEditingFeed(null)}
                                style={{
                                    padding: '10px 16px',
                                    borderRadius: '8px',
                                    border: '1px solid #cbd5e1',
                                    background: '#ffffff',
                                    fontWeight: 600,
                                    fontSize: '13px',
                                    cursor: 'pointer'
                                }}
                            >
                                취소
                            </button>
                            <button
                                type="button"
                                disabled={isSavingEdit}
                                onClick={handleSaveEdit}
                                style={{
                                    padding: '10px 20px',
                                    borderRadius: '8px',
                                    border: 'none',
                                    background: '#2563eb',
                                    color: '#ffffff',
                                    fontWeight: 700,
                                    fontSize: '13px',
                                    cursor: isSavingEdit ? 'wait' : 'pointer'
                                }}
                            >
                                {isSavingEdit ? '저장 중…' : '설정 저장'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 🎨 피드AI 전용 모달 알림창 */}
            <AlertModal
                isOpen={alertState.isOpen}
                message={alertState.message}
                type={alertState.type}
                onClose={() => setAlertState(prev => ({ ...prev, isOpen: false }))}
            />
        </aside>
    );
}
