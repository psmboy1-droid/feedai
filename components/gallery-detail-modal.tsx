'use client';

import React, { useState, useEffect } from 'react';
import {
    X,
    Heart,
    Eye,
    MessageCircle,
    Edit3,
    Trash2,
    Send,
    AlertCircle,
    Loader2,
    ExternalLink,
} from 'lucide-react';
import { GALLERY_CATEGORIES } from '../lib/gallery-config';
import {
    formatFullDate,
    formatRelativeDate,
    type GalleryPostItem,
    type GalleryCommentItem,
} from './gallery-types';

interface GalleryDetailModalProps {
    postId: string;
    currentUser: { id: string; name: string; admin?: boolean } | null;
    onClose: () => void;
    onEdit: (post: GalleryPostItem) => void;
    onDeleted: (postId: string) => void;
    onLikeChanged: (postId: string, liked: boolean, likeCount: number) => void;
    onCommentCountChanged: (postId: string, commentCount: number) => void;
    onViewed: (postId: string, viewCount: number) => void;
}

export default function GalleryDetailModal({
    postId,
    currentUser,
    onClose,
    onEdit,
    onDeleted,
    onLikeChanged,
    onCommentCountChanged,
    onViewed,
}: GalleryDetailModalProps) {
    const [post, setPost] = useState<GalleryPostItem | null>(null);
    const [comments, setComments] = useState<GalleryCommentItem[]>([]);
    const [likedByMe, setLikedByMe] = useState(false);
    const [canEdit, setCanEdit] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [liking, setLiking] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const [commentText, setCommentText] = useState('');
    const [submittingComment, setSubmittingComment] = useState(false);
    const [commentError, setCommentError] = useState('');

    // ESC 키 닫기 및 바디 스크롤 잠금
    useEffect(() => {
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape' && !deleting) {
                onClose();
            }
        }
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.body.style.overflow = prevOverflow;
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose, deleting]);

    // 상세 데이터 로드
    useEffect(() => {
        let live = true;
        setLoading(true);
        setError('');

        fetch(`/api/gallery/posts/${postId}`, { cache: 'no-store' })
            .then(async (res) => {
                const data: any = await res.json().catch(() => ({}));
                if (!res.ok) {
                    throw new Error(data.error || '게시글을 불러오지 못했습니다.');
                }
                return data;
            })
            .then((data: any) => {
                if (!live) return;
                setPost(data.post);
                setComments(data.comments || []);
                setLikedByMe(Boolean(data.likedByMe));
                setCanEdit(Boolean(data.canEdit));
                setIsAdmin(Boolean(data.isAdmin));
                setLoading(false);

                if (data.post && typeof data.post.view_count === 'number') {
                    onViewed(postId, data.post.view_count);
                }
            })
            .catch((err: any) => {
                if (!live) return;
                setError(err?.message || '게시글을 불러오는 중 오류가 발생했습니다.');
                setLoading(false);
            });

        return () => {
            live = false;
        };
    }, [postId]);

    async function handleToggleLike() {
        if (!currentUser) {
            if (window.confirm('로그인 후 좋아요를 누를 수 있습니다. 로그인 페이지로 이동할까요?')) {
                window.location.href = '/login?return_to=/gallery';
            }
            return;
        }
        if (liking || !post) return;
        setLiking(true);

        try {
            const res = await fetch(`/api/gallery/posts/${postId}/like`, {
                method: 'POST',
            });
            const data: any = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || '좋아요 처리에 실패했습니다.');
            }

            const newLiked = Boolean(data.liked);
            const newCount = Number(data.like_count ?? 0);
            setLikedByMe(newLiked);
            setPost((prev) => (prev ? { ...prev, like_count: newCount } : prev));
            onLikeChanged(postId, newLiked, newCount);
        } catch (err: any) {
            alert(err?.message || '좋아요 처리 중 오류가 발생했습니다.');
        } finally {
            setLiking(false);
        }
    }

    async function handleDeletePost() {
        if (!post || deleting) return;
        if (!window.confirm('정말 이 게시물을 삭제하시겠습니까? 첨부된 이미지도 함께 삭제되며 복구할 수 없습니다.')) {
            return;
        }

        setDeleting(true);
        try {
            const res = await fetch(`/api/gallery/posts/${postId}`, {
                method: 'DELETE',
            });
            const data: any = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || '게시물 삭제에 실패했습니다.');
            }

            onDeleted(postId);
        } catch (err: any) {
            alert(err?.message || '삭제 중 오류가 발생했습니다.');
            setDeleting(false);
        }
    }

    async function handleCommentSubmit(e: React.FormEvent) {
        e.preventDefault();
        setCommentError('');

        if (!currentUser) {
            if (window.confirm('로그인 후 댓글을 작성할 수 있습니다. 로그인 페이지로 이동할까요?')) {
                window.location.href = '/login?return_to=/gallery';
            }
            return;
        }

        const trimmed = commentText.trim();
        if (!trimmed) {
            setCommentError('댓글 내용을 입력해 주세요.');
            return;
        }
        if (submittingComment) return;

        setSubmittingComment(true);
        try {
            const res = await fetch(`/api/gallery/posts/${postId}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: trimmed }),
            });
            const data: any = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || '댓글 등록에 실패했습니다.');
            }

            if (data.comment) {
                setComments((prev) => [...prev, data.comment]);
            }
            setCommentText('');
            const newCount = Number(data.comment_count ?? comments.length + 1);
            setPost((prev) => (prev ? { ...prev, comment_count: newCount } : prev));
            onCommentCountChanged(postId, newCount);
        } catch (err: any) {
            setCommentError(err?.message || '댓글 등록 중 오류가 발생했습니다.');
        } finally {
            setSubmittingComment(false);
        }
    }

    async function handleDeleteComment(commentId: string) {
        if (!window.confirm('이 댓글을 삭제하시겠습니까?')) return;

        try {
            const res = await fetch(
                `/api/gallery/posts/${postId}/comments?commentId=${encodeURIComponent(commentId)}`,
                { method: 'DELETE' }
            );
            const data: any = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || '댓글 삭제에 실패했습니다.');
            }

            setComments((prev) => prev.filter((c) => c.id !== commentId));
            const newCount = Number(data.comment_count ?? Math.max(0, comments.length - 1));
            setPost((prev) => (prev ? { ...prev, comment_count: newCount } : prev));
            onCommentCountChanged(postId, newCount);
        } catch (err: any) {
            alert(err?.message || '댓글 삭제 중 오류가 발생했습니다.');
        }
    }

    const images = Array.isArray(post?.image_urls) ? post.image_urls : [];

    return (
        <div
            className="gallery-modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-label={post?.title || '갤러리 상세 보기'}
            onClick={(e) => {
                if (e.target === e.currentTarget && !deleting) {
                    onClose();
                }
            }}
        >
            <div className="gallery-modal-box gallery-detail-modal">
                <header className="gallery-modal-header">
                    <div className="gallery-detail-header-left">
                        {post && (
                            <span className="gallery-cat-badge">
                                {GALLERY_CATEGORIES[post.category] || post.category}
                            </span>
                        )}
                        <span className="gallery-modal-header-title">
                            {loading ? '불러오는 중…' : post?.title || '갤러리 게시물'}
                        </span>
                    </div>
                    <button
                        type="button"
                        className="gallery-modal-close"
                        onClick={onClose}
                        disabled={deleting}
                        aria-label="닫기"
                    >
                        <X size={20} />
                    </button>
                </header>

                <div className="gallery-detail-scroll">
                    {loading && (
                        <div className="gallery-modal-loading">
                            <Loader2 size={28} className="gallery-spin" />
                            <p>이미지와 댓글을 불러오는 중입니다…</p>
                        </div>
                    )}

                    {!loading && error && (
                        <div className="community-error-banner" role="alert">
                            <AlertCircle size={18} />
                            <span>{error}</span>
                        </div>
                    )}

                    {!loading && !error && post && (
                        <>
                            {/* 제목 및 메타 정보 */}
                            <div className="gallery-detail-meta-wrap">
                                <h1 className="gallery-detail-title">{post.title}</h1>
                                <div className="gallery-detail-meta-row">
                                    <div className="gallery-detail-author-info">
                                        <strong>{post.author_name}</strong>
                                        <span>·</span>
                                        <time dateTime={post.created_at}>{formatFullDate(post.created_at)}</time>
                                    </div>
                                    <div className="gallery-detail-stats">
                                        <span><Eye size={14} /> {post.view_count}</span>
                                        <span><Heart size={14} /> {post.like_count}</span>
                                        <span><MessageCircle size={14} /> {post.comment_count}</span>
                                    </div>
                                </div>
                            </div>

                            {/* 이미지 본문 (원본 비율 100% 유지, 크롭 없음) */}
                            {images.length > 0 && (
                                <div className="gallery-detail-images">
                                    {images.map((url, idx) => (
                                        <div key={url + idx} className="gallery-detail-image-item">
                                            <div className="gallery-detail-image-box">
                                                <img
                                                    src={url}
                                                    alt={`${post.title} (${idx + 1})`}
                                                    referrerPolicy="no-referrer"
                                                />
                                            </div>
                                            <div className="gallery-detail-image-meta">
                                                {images.length > 1 && (
                                                    <span className="gallery-detail-img-count">
                                                        {idx + 1} / {images.length}
                                                    </span>
                                                )}
                                                <a
                                                    href={url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="gallery-detail-raw-link"
                                                    title="새 창에서 원본 이미지 열기"
                                                >
                                                    <ExternalLink size={13} /> 원본
                                                </a>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* 본문 설명 */}
                            {post.content && (
                                <div className="gallery-detail-content">{post.content}</div>
                            )}

                            {/* 좋아요 및 수정/삭제 액션 바 */}
                            <div className="gallery-detail-actions-bar">
                                <button
                                    type="button"
                                    className={`like-action-btn ${likedByMe ? 'liked' : ''}`}
                                    onClick={handleToggleLike}
                                    disabled={liking}
                                >
                                    <Heart size={18} fill={likedByMe ? 'currentColor' : 'none'} />
                                    <span>좋아요 {post.like_count}</span>
                                </button>

                                {canEdit && (
                                    <div className="post-manage-actions">
                                        <button
                                            type="button"
                                            className="manage-btn edit-btn"
                                            onClick={() => onEdit(post)}
                                            disabled={deleting}
                                        >
                                            <Edit3 size={14} /> 수정
                                        </button>
                                        <button
                                            type="button"
                                            className="manage-btn delete-btn"
                                            onClick={handleDeletePost}
                                            disabled={deleting}
                                        >
                                            <Trash2 size={14} /> {deleting ? '삭제 중…' : '삭제'}
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* 댓글 섹션 */}
                            <section className="gallery-detail-comments">
                                <h3>
                                    댓글 <span>{post.comment_count}</span>
                                </h3>

                                {currentUser ? (
                                    <form onSubmit={handleCommentSubmit} className="comment-write-form">
                                        <textarea
                                            className="comment-textarea"
                                            rows={3}
                                            maxLength={1000}
                                            placeholder="따뜻한 댓글을 남겨보세요…"
                                            value={commentText}
                                            onChange={(e) => setCommentText(e.target.value)}
                                        />
                                        <div className="comment-form-bottom">
                                            {commentError && (
                                                <span className="comment-error">{commentError}</span>
                                            )}
                                            <span className="comment-length">{commentText.length}/1000</span>
                                            <button
                                                type="submit"
                                                className="community-btn community-btn-primary comment-submit-btn"
                                                disabled={submittingComment}
                                            >
                                                <Send size={14} />
                                                <span>{submittingComment ? '등록 중…' : '댓글 등록'}</span>
                                            </button>
                                        </div>
                                    </form>
                                ) : (
                                    <div className="comment-login-notice">
                                        <p>로그인 후 댓글을 작성할 수 있습니다.</p>
                                        <a
                                            href="/login?return_to=/gallery"
                                            className="community-btn community-btn-secondary"
                                        >
                                            로그인하기
                                        </a>
                                    </div>
                                )}

                                <div className="comments-list">
                                    {comments.length === 0 ? (
                                        <p className="no-comments-msg">
                                            아직 댓글이 없습니다. 첫 번째 댓글을 남겨보세요!
                                        </p>
                                    ) : (
                                        comments.map((c) => {
                                            const canDeleteComment =
                                                Boolean(currentUser?.id && c.author_id === currentUser.id) || isAdmin;
                                            return (
                                                <div
                                                    key={c.id}
                                                    className={`comment-item ${c.is_admin_reply ? 'admin-comment' : ''}`}
                                                >
                                                    <div className="comment-header">
                                                        <div className="comment-author-info">
                                                            <span className="comment-author-name">{c.author_name}</span>
                                                            {c.is_admin_reply && (
                                                                <span className="admin-reply-badge">관리자</span>
                                                            )}
                                                            <span className="comment-date">
                                                                {formatRelativeDate(c.created_at)}
                                                            </span>
                                                        </div>
                                                        {canDeleteComment && (
                                                            <button
                                                                type="button"
                                                                className="comment-delete-btn"
                                                                onClick={() => handleDeleteComment(c.id)}
                                                                aria-label="댓글 삭제"
                                                                title="댓글 삭제"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="comment-body" style={{ whiteSpace: 'pre-wrap' }}>
                                                        {c.content}
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </section>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
