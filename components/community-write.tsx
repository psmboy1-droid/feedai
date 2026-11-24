'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import TopMenu from './top-menu';
import {
    ArrowLeft,
    UploadCloud,
    X,
    Lock,
    Pin,
    AlertCircle,
    CheckCircle2,
    Video,
    Image as ImageIcon,
    Info,
} from 'lucide-react';
import { useNewsAccount } from './news-account';

interface CommunityWriteProps {
    editId?: string;
}

export function CommunityWrite({ editId }: CommunityWriteProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const initialBoard = (searchParams?.get('board') === 'suggestions' ? 'suggestions' : 'free') as 'free' | 'suggestions';

    const { user, ready } = useNewsAccount();
    const [boardType, setBoardType] = useState<'free' | 'suggestions'>(initialBoard);
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [imageUrls, setImageUrls] = useState<string[]>([]);
    const [videoUrl, setVideoUrl] = useState('');
    const [isSecret, setIsSecret] = useState(false);
    const [isNotice, setIsNotice] = useState(false);

    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState('');
    const [initialLoading, setInitialLoading] = useState(!!editId);

    const fileInputRef = useRef<HTMLInputElement>(null);

    // 수정 모드일 때 기존 데이터 불러오기
    useEffect(() => {
        if (!editId) return;

        let live = true;
        fetch(`/api/community/posts/${editId}`, { cache: 'no-store' })
            .then(async (res) => {
                if (!res.ok) {
                    const d: any = await res.json().catch(() => ({}));
                    throw new Error(d.error || '게시글 정보를 불러오지 못했습니다.');
                }
                return res.json();
            })
            .then((data: any) => {
                if (live && data.post) {
                    const p = data.post;
                    setBoardType(p.board_type);
                    setTitle(p.title || '');
                    setContent(p.content || '');
                    setImageUrls(Array.isArray(p.image_urls) ? p.image_urls : []);
                    setVideoUrl(p.video_url || '');
                    setIsSecret(!!p.is_secret);
                    setIsNotice(!!p.is_notice);
                    setInitialLoading(false);
                }
            })
            .catch((err) => {
                if (live) {
                    setSubmitError(err.message || '게시글 로딩 실패');
                    setInitialLoading(false);
                }
            });

        return () => {
            live = false;
        };
    }, [editId]);

    // 파일 선택 및 R2 업로드 핸들러
    async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        setUploadError('');

        // 1. 첨부 개수 확인 (최대 5장)
        if (imageUrls.length + files.length > 5) {
            setUploadError(`이미지는 최대 5장까지 첨부할 수 있습니다. (현재 ${imageUrls.length}장 등록됨)`);
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
        }

        // 2. 파일당 5MB 검사
        const MAX_SIZE = 5 * 1024 * 1024;
        for (const file of files) {
            if (file.size > MAX_SIZE) {
                setUploadError(`파일 [${file.name}]의 용량이 5MB를 초과합니다.`);
                if (fileInputRef.current) fileInputRef.current.value = '';
                return;
            }
        }

        setUploading(true);

        const uploadedList: string[] = [];
        for (const file of files) {
            try {
                const formData = new FormData();
                formData.append('file', file);

                const res = await fetch('/api/community/upload', {
                    method: 'POST',
                    body: formData,
                });

                const data: any = await res.json();
                if (!res.ok) {
                    throw new Error(data.error || '업로드에 실패했습니다.');
                }

                if (data.url) {
                    uploadedList.push(data.url);
                }
            } catch (err: any) {
                setUploadError(err.message || '이미지 업로드 중 오류가 발생했습니다.');
                break;
            }
        }

        if (uploadedList.length > 0) {
            setImageUrls((prev) => [...prev, ...uploadedList]);
        }

        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    }

    // 이미지 삭제 핸들러
    function handleRemoveImage(indexToRemove: number) {
        setImageUrls((prev) => prev.filter((_, idx) => idx !== indexToRemove));
    }

    // 폼 제출
    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setSubmitError('');

        if (!title.trim()) {
            setSubmitError('제목을 입력해 주세요.');
            return;
        }
        if (!content.trim()) {
            setSubmitError('내용을 입력해 주세요.');
            return;
        }

        setSubmitting(true);

        try {
            const payload = {
                board_type: boardType,
                title: title.trim(),
                content: content.trim(),
                image_urls: imageUrls,
                video_url: videoUrl.trim() || null,
                is_secret: boardType === 'suggestions' ? isSecret : false,
                is_notice: user?.admin ? isNotice : false,
            };

            const endpoint = editId ? `/api/community/posts/${editId}` : '/api/community/posts';
            const method = editId ? 'PATCH' : 'POST';

            const res = await fetch(endpoint, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const data: any = await res.json();
            if (!res.ok) {
                throw new Error(data.error || '저장에 실패했습니다.');
            }

            const targetId = editId || data.post?.id;
            if (targetId) {
                router.push(`/community/${targetId}`);
            } else {
                router.push(`/community/${boardType}`);
            }
        } catch (err: any) {
            setSubmitError(err.message || '저장 중 오류가 발생했습니다.');
            setSubmitting(false);
        }
    }

    if (!ready || initialLoading) {
        return (
            <div className="community-container">
                <header className="topbar"><TopMenu /></header>
                <div className="community-loading-state">
                    <div className="community-spinner" />
                    <p>페이지를 준비 중입니다…</p>
                </div>
            </div>
        );
    }

    if (!user) {
        return (
            <div className="community-container">
                <header className="topbar"><TopMenu /></header>
                <div className="community-empty-state">
                    <Lock size={40} className="empty-icon icon-blue" />
                    <h3>로그인이 필요한 서비스입니다</h3>
                    <p>커뮤니티 글을 작성하려면 먼저 로그인해 주세요.</p>
                    <a href="/login" className="community-btn community-btn-primary">
                        로그인하기
                    </a>
                </div>
            </div>
        );
    }

    return (
        <div className="community-container">
            <header className="topbar">
                <TopMenu />
            </header>

            <main className="community-write-main">
                {/* 상단 네비게이션 헤더 */}
                <div className="community-write-header">
                    <button
                        type="button"
                        className="community-btn community-btn-text"
                        onClick={() => router.back()}
                    >
                        <ArrowLeft size={16} />
                        <span>뒤로가기</span>
                    </button>
                    <h1>{editId ? '게시글 수정' : '새 글 작성'}</h1>
                    <span className="user-badge">{user.name} 님</span>
                </div>

                {submitError && (
                    <div className="community-error-banner" role="alert">
                        <AlertCircle size={18} />
                        <span>{submitError}</span>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="community-write-form">
                    {/* 게시판 선택 및 옵션 */}
                    <div className="community-form-row form-options-row">
                        <div className="form-group board-select-group">
                            <label htmlFor="boardSelect">게시판 선택</label>
                            <select
                                id="boardSelect"
                                value={boardType}
                                onChange={(e) => setBoardType(e.target.value as 'free' | 'suggestions')}
                                disabled={!!editId}
                                className="community-select"
                            >
                                <option value="free">자유 게시판</option>
                                <option value="suggestions">건의 게시판</option>
                            </select>
                        </div>

                        <div className="form-checkboxes">
                            {boardType === 'suggestions' && (
                                <label className="community-checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={isSecret}
                                        onChange={(e) => setIsSecret(e.target.checked)}
                                    />
                                    <Lock size={14} className="checkbox-icon" />
                                    <span>비밀글로 작성 (작성자와 관리자만 확인 가능)</span>
                                </label>
                            )}

                            {user.admin && (
                                <label className="community-checkbox-label notice-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={isNotice}
                                        onChange={(e) => setIsNotice(e.target.checked)}
                                    />
                                    <Pin size={14} className="checkbox-icon" />
                                    <span>공지글로 상단 고정 (관리자 전용)</span>
                                </label>
                            )}
                        </div>
                    </div>

                    {/* 제목 입력 */}
                    <div className="form-group">
                        <label htmlFor="postTitle">제목</label>
                        <input
                            id="postTitle"
                            type="text"
                            placeholder="제목을 입력하세요 (최대 150자)"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            maxLength={150}
                            className="community-input"
                            required
                        />
                    </div>

                    {/* 본문 입력 */}
                    <div className="form-group">
                        <label htmlFor="postContent">내용</label>
                        <textarea
                            id="postContent"
                            placeholder="타인을 비방하거나 명예를 훼손하는 글은 제재될 수 있습니다."
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            maxLength={10000}
                            rows={12}
                            className="community-textarea"
                            required
                        />
                        <div className="textarea-counter">{content.length} / 10,000자</div>
                    </div>

                    {/* 영상 링크 입력 */}
                    <div className="form-group">
                        <label htmlFor="videoUrl" className="community-field-label">
                            <span className="field-label-icon">
                                <Video size={14} />
                            </span>
                            <span>영상 링크 (선택)</span>
                        </label>
                        <input
                            id="videoUrl"
                            type="url"
                            placeholder="YouTube(일반/쇼츠) 등 https:// 링크를 입력하세요"
                            value={videoUrl}
                            onChange={(e) => setVideoUrl(e.target.value)}
                            className="community-input"
                        />
                        <small className="form-hint">
                            유튜브 쇼츠 및 일반 영상은 게시글에 자동 임베드 플레이어로 표시됩니다.
                        </small>
                    </div>

                    {/* 이미지 첨부 섹션 */}
                    <div className="form-group image-upload-group">
                        <label className="community-field-label">
                            <span className="field-label-icon">
                                <ImageIcon size={14} />
                            </span>
                            <span>이미지 첨부 (최대 5장)</span>
                        </label>

                        {/* 안내 문구 (요구사항 필수 명시) */}
                        <p className="upload-notice-banner">
                            <Info size={15} className="notice-icon" />
                            <span>이미지는 최대 5장(장당 5MB 이하), 영상은 링크로만 등록 가능합니다.</span>
                        </p>

                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            multiple
                            style={{ display: 'none' }}
                            onChange={handleFileSelect}
                            disabled={uploading || imageUrls.length >= 5}
                        />

                        {imageUrls.length < 5 && (
                            <button
                                type="button"
                                className="upload-trigger-btn"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploading}
                            >
                                <UploadCloud size={20} />
                                <span>{uploading ? '이미지 업로드 중…' : '이미지 파일 추가 (JPEG, PNG, WebP, GIF)'}</span>
                            </button>
                        )}

                        {uploadError && (
                            <p className="upload-error-text">
                                <AlertCircle size={14} />
                                <span>{uploadError}</span>
                            </p>
                        )}

                        {/* 미리보기 목록 */}
                        {imageUrls.length > 0 && (
                            <div className="image-preview-grid">
                                {imageUrls.map((url, idx) => (
                                    <div key={url} className="image-preview-item">
                                        <img src={url} alt={`첨부 이미지 ${idx + 1}`} referrerPolicy="no-referrer" />
                                        <button
                                            type="button"
                                            className="remove-img-btn"
                                            onClick={() => handleRemoveImage(idx)}
                                            title="이미지 삭제"
                                        >
                                            <X size={14} />
                                        </button>
                                        <span className="img-index">{idx + 1}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* 하단 버튼 바 */}
                    <div className="community-form-actions">
                        <button
                            type="button"
                            className="community-btn community-btn-secondary"
                            onClick={() => router.back()}
                            disabled={submitting}
                        >
                            취소
                        </button>
                        <button
                            type="submit"
                            className="community-btn community-btn-primary"
                            disabled={submitting || uploading}
                        >
                            {submitting ? '저장 중…' : editId ? '수정 완료' : '등록하기'}
                        </button>
                    </div>
                </form>
            </main>
        </div>
    );
}

export default CommunityWrite;
