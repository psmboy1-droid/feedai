'use client';

import React, { useState, useEffect, useRef } from 'react';
import { X, UploadCloud, AlertCircle, Info, Loader2 } from 'lucide-react';
import { GALLERY_CATEGORIES, GALLERY_CATEGORY_KEYS, type GalleryCategory } from '../lib/gallery-config';
import { compressImageForGallery } from '../lib/image-compress';
import type { GalleryPostItem } from './gallery-types';

interface GalleryWriteModalProps {
    editingPost?: GalleryPostItem | null;
    onClose: () => void;
    onSaved: (post: GalleryPostItem, isEdit: boolean) => void;
}

export default function GalleryWriteModal({ editingPost, onClose, onSaved }: GalleryWriteModalProps) {
    const isEdit = Boolean(editingPost);
    const [category, setCategory] = useState<GalleryCategory>(editingPost?.category || 'humor');
    const [title, setTitle] = useState(editingPost?.title || '');
    const [content, setContent] = useState(editingPost?.content || '');
    const [imageUrls, setImageUrls] = useState<string[]>(
        Array.isArray(editingPost?.image_urls) ? editingPost.image_urls : []
    );

    const [uploading, setUploading] = useState(false);
    const [uploadStatus, setUploadStatus] = useState('');
    const [uploadError, setUploadError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState('');

    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape' && !uploading && !submitting) {
                onClose();
            }
        }
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.body.style.overflow = prevOverflow;
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose, uploading, submitting]);

    async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        setUploadError('');
        setSubmitError('');

        if (imageUrls.length + files.length > 5) {
            setUploadError(`이미지는 최대 5장까지 첨부할 수 있습니다. (현재 ${imageUrls.length}장 등록됨)`);
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
        }

        setUploading(true);
        const uploadedList: string[] = [];

        try {
            for (let i = 0; i < files.length; i++) {
                const rawFile = files[i];
                setUploadStatus(`이미지 최적화 및 업로드 중… (${i + 1}/${files.length})`);

                // 클라이언트 WebP 자동 압축 (GIF는 원본 유지, 5MB 초과 시 에러)
                const compressedFile = await compressImageForGallery(rawFile);

                const formData = new FormData();
                formData.append('file', compressedFile);

                const res = await fetch('/api/gallery/upload', {
                    method: 'POST',
                    body: formData,
                });

                const data: any = await res.json().catch(() => ({}));
                if (!res.ok) {
                    throw new Error(data.error || `파일 [${rawFile.name}] 업로드에 실패했습니다.`);
                }

                if (data.url) {
                    uploadedList.push(data.url);
                }
            }
        } catch (err: any) {
            setUploadError(err?.message || '이미지 업로드 중 오류가 발생했습니다.');
        } finally {
            if (uploadedList.length > 0) {
                setImageUrls((prev) => [...prev, ...uploadedList].slice(0, 5));
            }
            setUploading(false);
            setUploadStatus('');
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    }

    function handleRemoveImage(idxToRemove: number) {
        if (uploading || submitting) return;
        setImageUrls((prev) => prev.filter((_, idx) => idx !== idxToRemove));
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setSubmitError('');

        if (!title.trim()) {
            setSubmitError('제목을 입력해 주세요.');
            return;
        }
        if (imageUrls.length === 0) {
            setSubmitError('이미지를 최소 1장 이상 첨부해 주세요.');
            return;
        }
        if (uploading || submitting) return;

        setSubmitting(true);

        try {
            const payload = {
                category,
                title: title.trim(),
                content: content.trim(),
                image_urls: imageUrls,
            };

            const endpoint = isEdit && editingPost
                ? `/api/gallery/posts/${editingPost.id}`
                : '/api/gallery/posts';
            const method = isEdit ? 'PATCH' : 'POST';

            const res = await fetch(endpoint, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const data: any = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || '저장에 실패했습니다.');
            }

            if (data.post) {
                onSaved(data.post, isEdit);
            } else {
                onClose();
            }
        } catch (err: any) {
            setSubmitError(err?.message || '저장 중 오류가 발생했습니다.');
            setSubmitting(false);
        }
    }

    return (
        <div
            className="gallery-modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-label={isEdit ? '갤러리 게시물 수정' : '사진 올리기'}
            onClick={(e) => {
                if (e.target === e.currentTarget && !uploading && !submitting) {
                    onClose();
                }
            }}
        >
            <div className="gallery-modal-box gallery-write-modal">
                <header className="gallery-modal-header">
                    <h2>{isEdit ? '게시물 수정' : '사진 올리기'}</h2>
                    <button
                        type="button"
                        className="gallery-modal-close"
                        onClick={onClose}
                        disabled={uploading || submitting}
                        aria-label="닫기"
                    >
                        <X size={20} />
                    </button>
                </header>

                <form onSubmit={handleSubmit} className="gallery-write-body">
                    {submitError && (
                        <div className="community-error-banner" role="alert">
                            <AlertCircle size={16} />
                            <span>{submitError}</span>
                        </div>
                    )}

                    {/* 카테고리 선택 */}
                    <div className="gallery-form-field">
                        <label>카테고리 <span className="req">*</span></label>
                        <div className="gallery-write-cat-group">
                            {GALLERY_CATEGORY_KEYS.map((key) => (
                                <button
                                    key={key}
                                    type="button"
                                    className={`gallery-write-cat-btn ${category === key ? 'active' : ''}`}
                                    onClick={() => setCategory(key)}
                                >
                                    {GALLERY_CATEGORIES[key]}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 제목 */}
                    <div className="gallery-form-field">
                        <label htmlFor="gallery-title">
                            제목 <span className="req">*</span>
                            <small>{title.length}/150</small>
                        </label>
                        <input
                            id="gallery-title"
                            type="text"
                            maxLength={150}
                            placeholder="제목을 입력하세요"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            required
                        />
                    </div>

                    {/* 이미지 첨부 */}
                    <div className="gallery-form-field">
                        <label>
                            이미지 첨부 (최소 1장 ~ 최대 5장) <span className="req">*</span>
                            <small>{imageUrls.length}/5장</small>
                        </label>

                        <div className="gallery-upload-notice">
                            <Info size={15} />
                            <span>이미지 전용(최대 5장) · 업로드 시 자동으로 WebP 경량화되어 저장됩니다. (GIF 원본 유지)</span>
                        </div>

                        <div className="gallery-upload-controls">
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/jpeg,image/png,image/webp,image/gif"
                                multiple
                                onChange={handleFileSelect}
                                disabled={uploading || submitting || imageUrls.length >= 5}
                                style={{ display: 'none' }}
                            />
                            <button
                                type="button"
                                className="upload-trigger-btn"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploading || submitting || imageUrls.length >= 5}
                            >
                                {uploading ? (
                                    <>
                                        <Loader2 size={16} className="gallery-spin" />
                                        <span>{uploadStatus || '업로드 중…'}</span>
                                    </>
                                ) : (
                                    <>
                                        <UploadCloud size={16} />
                                        <span>사진 선택하기 ({imageUrls.length}/5)</span>
                                    </>
                                )}
                            </button>
                        </div>

                        {uploadError && (
                            <p className="gallery-upload-error" role="alert">
                                <AlertCircle size={14} /> {uploadError}
                            </p>
                        )}

                        {imageUrls.length > 0 && (
                            <div className="gallery-preview-grid">
                                {imageUrls.map((url, idx) => (
                                    <div key={url + idx} className="gallery-preview-item">
                                        <img
                                            src={url}
                                            alt={`첨부 이미지 ${idx + 1}`}
                                            referrerPolicy="no-referrer"
                                        />
                                        <span className={`gallery-preview-badge ${idx === 0 ? 'primary' : ''}`}>
                                            {idx === 0 ? '대표' : idx + 1}
                                        </span>
                                        <button
                                            type="button"
                                            className="gallery-preview-remove"
                                            onClick={() => handleRemoveImage(idx)}
                                            aria-label="이미지 제거"
                                            disabled={uploading || submitting}
                                        >
                                            <X size={13} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* 설명 (선택) */}
                    <div className="gallery-form-field">
                        <label htmlFor="gallery-content">
                            설명 (선택)
                            <small>{content.length}/2000</small>
                        </label>
                        <textarea
                            id="gallery-content"
                            rows={4}
                            maxLength={2000}
                            placeholder="이미지에 대한 설명이나 코멘트를 남겨보세요 (선택 사항)"
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                        />
                    </div>

                    <div className="gallery-write-actions">
                        <button
                            type="button"
                            className="community-btn community-btn-secondary"
                            onClick={onClose}
                            disabled={uploading || submitting}
                        >
                            취소
                        </button>
                        <button
                            type="submit"
                            className="community-btn community-btn-primary"
                            disabled={uploading || submitting}
                        >
                            {submitting
                                ? '저장 중…'
                                : isEdit
                                ? '수정 완료'
                                : '등록하기'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
