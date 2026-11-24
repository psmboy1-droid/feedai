'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import TopMenu from './top-menu';
import {
    ArrowLeft,
    Heart,
    Eye,
    MessageCircle,
    Lock,
    Pin,
    ExternalLink,
    Trash2,
    Edit3,
    AlertCircle,
    Send,
    CheckCircle,
} from 'lucide-react';
import { useNewsAccount } from './news-account';
import { CommunityPostItem } from './community-list';

interface CommentItem {
    id: string;
    post_id: string;
    author_id: string;
    author_name: string;
    content: string;
    is_admin_reply: boolean;
    created_at: string;
}

interface CommunityDetailProps {
    postId: string;
}

// 유튜브 URL 파싱 헬퍼 (일반 영상 vs 쇼츠 감지)
function parseYoutube(url: string): { videoId: string; isShorts: boolean } | null {
    if (!url) return null;
    try {
        const u = new URL(url);
        // 쇼츠 링크
        if (u.pathname.includes('/shorts/')) {
            const parts = u.pathname.split('/');
            const idx = parts.indexOf('shorts');
            if (idx !== -1 && parts[idx + 1]) {
                return { videoId: parts[idx + 1].split('?')[0], isShorts: true };
            }
        }
        // youtu.be 단축 링크
        if (u.hostname === 'youtu.be') {
            const id = u.pathname.slice(1).split('?')[0];
            if (id) return { videoId: id, isShorts: false };
        }
        // youtube.com/watch?v=
        if (u.searchParams.has('v')) {
            const id = u.searchParams.get('v');
            if (id) return { videoId: id, isShorts: false };
        }
        // embed 링크
        if (u.pathname.includes('/embed/')) {
            const parts = u.pathname.split('/embed/');
            if (parts[1]) return { videoId: parts[1].split('?')[0], isShorts: false };
        }
    } catch {}
    return null;
}

function formatDate(iso: string): string {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch {
        return '';
    }
}

export function CommunityDetail({ postId }: CommunityDetailProps) {
    const router = useRouter();
    const { user } = useNewsAccount();

    const [post, setPost] = useState<CommunityPostItem | null>(null);
    const [comments, setComments] = useState<CommentItem[]>([]);
    const [likedByMe, setLikedByMe] = useState(false);
    const [likeCount, setLikeCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [isSecretBlocked, setIsSecretBlocked] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);

    // 댓글 작성 state
    const [commentContent, setCommentContent] = useState('');
    const [submittingComment, setSubmittingComment] = useState(false);
    const [commentError, setCommentError] = useState('');

    // 상태 변경 state (건의 게시판 관리자용)
    const [statusUpdating, setStatusUpdating] = useState(false);

    // 모달 이미지 확대
    const [zoomImage, setZoomImage] = useState<string | null>(null);

    function loadPost() {
        setLoading(true);
        setError('');
        setIsSecretBlocked(false);

        fetch(`/api/community/posts/${postId}`, { cache: 'no-store' })
            .then(async (res) => {
                const data: any = await res.json().catch(() => ({}));
                if (!res.ok) {
                    if (res.status === 403 && data.isSecret) {
                        setIsSecretBlocked(true);
                    }
                    throw new Error(data.error || '게시글을 불러오지 못했습니다.');
                }
                return data;
            })
            .then((data: any) => {
                setPost(data.post);
                setComments(data.comments || []);
                setLikedByMe(!!data.likedByMe);
                setLikeCount(data.post?.like_count || 0);
                setIsAdmin(!!data.isAdmin);
                setLoading(false);
            })
            .catch((err: any) => {
                setError(err.message || '오류가 발생했습니다.');
                setLoading(false);
            });
    }

    useEffect(() => {
        loadPost();
    }, [postId]);

    // 추천 토글
    async function handleToggleLike() {
        if (!user) {
            alert('로그인 후 추천할 수 있습니다.');
            return;
        }

        try {
            const res = await fetch(`/api/community/posts/${postId}/like`, {
                method: 'POST',
            });
            const data: any = await res.json();
            if (!res.ok) throw new Error(data.error || '추천 처리에 실패했습니다.');

            setLikedByMe(data.liked);
            setLikeCount(data.likeCount);
        } catch (err: any) {
            alert(err.message || '추천 처리 중 오류가 발생했습니다.');
        }
    }

    // 게시글 삭제
    async function handleDeletePost() {
        if (!window.confirm('정말 이 게시글을 삭제하시겠습니까? 삭제된 글과 첨부 이미지는 복구할 수 없습니다.')) {
            return;
        }

        try {
            const res = await fetch(`/api/community/posts/${postId}`, {
                method: 'DELETE',
            });
            const data: any = await res.json();
            if (!res.ok) throw new Error(data.error || '게시글 삭제에 실패했습니다.');

            alert('게시글이 삭제되었습니다.');
            router.push(`/community/${post?.board_type || 'free'}`);
        } catch (err: any) {
            alert(err.message || '게시글 삭제 중 오류가 발생했습니다.');
        }
    }

    // 건의 게시판 처리 상태 변경 (관리자 전용)
    async function handleStatusChange(newStatus: string) {
        if (!isAdmin) return;
        setStatusUpdating(true);

        try {
            const res = await fetch(`/api/community/posts/${postId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            });
            const data: any = await res.json();
            if (!res.ok) throw new Error(data.error || '상태 변경에 실패했습니다.');

            setPost((prev) => prev ? { ...prev, status: newStatus as any } : null);
        } catch (err: any) {
            alert(err.message || '상태 변경 오류');
        } finally {
            setStatusUpdating(false);
        }
    }

    // 댓글 등록
    async function handleCommentSubmit(e: React.FormEvent) {
        e.preventDefault();
        setCommentError('');

        if (!commentContent.trim()) {
            setCommentError('댓글 내용을 입력해 주세요.');
            return;
        }

        setSubmittingComment(true);

        try {
            const res = await fetch(`/api/community/posts/${postId}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: commentContent.trim() }),
            });

            const data: any = await res.json();
            if (!res.ok) throw new Error(data.error || '댓글 등록에 실패했습니다.');

            setComments((prev) => [...prev, data.comment]);
            setCommentContent('');
            if (post) {
                setPost({ ...post, comment_count: data.commentCount });
            }
        } catch (err: any) {
            setCommentError(err.message || '댓글 등록 중 오류가 발생했습니다.');
        } finally {
            setSubmittingComment(false);
        }
    }

    // 댓글 삭제
    async function handleDeleteComment(commentId: string) {
        if (!window.confirm('댓글을 삭제하시겠습니까?')) return;

        try {
            const res = await fetch(`/api/community/posts/${postId}/comments/${commentId}`, {
                method: 'DELETE',
            });
            const data: any = await res.json();
            if (!res.ok) throw new Error(data.error || '댓글 삭제에 실패했습니다.');

            setComments((prev) => prev.filter((c) => c.id !== commentId));
            if (post) {
                setPost({ ...post, comment_count: data.commentCount });
            }
        } catch (err: any) {
            alert(err.message || '댓글 삭제 중 오류가 발생했습니다.');
        }
    }

    const isAuthor = user?.id && post?.author_id === user.id;
    const canManagePost = isAuthor || isAdmin;
    const youtubeInfo = post?.video_url ? parseYoutube(post.video_url) : null;

    return (
        <div className="community-container">
            <header className="topbar">
                <TopMenu />
            </header>

            <main className="community-detail-main">
                {/* 상단 뒤로가기 버튼 */}
                <div className="community-detail-top-bar">
                    <button
                        type="button"
                        className="community-btn community-btn-text"
                        onClick={() => router.push(`/community/${post?.board_type || 'free'}`)}
                    >
                        <ArrowLeft size={16} />
                        <span>목록으로 돌아가기</span>
                    </button>
                    {post && (
                        <span className="board-badge-tag">
                            {post.board_type === 'suggestions' ? '건의 게시판' : '자유 게시판'}
                        </span>
                    )}
                </div>

                {/* 로딩 표시 */}
                {loading && (
                    <div className="community-loading-state">
                        <div className="community-spinner" />
                        <p>게시글을 불러오는 중입니다…</p>
                    </div>
                )}

                {/* 비밀글 차단 안내 */}
                {!loading && isSecretBlocked && (
                    <div className="community-empty-state">
                        <Lock size={44} className="empty-icon icon-amber" />
                        <h3>비밀글입니다</h3>
                        <p>작성자와 사이트 관리자만 열람할 수 있는 비공개 건의글입니다.</p>
                        <button
                            type="button"
                            className="community-btn community-btn-secondary"
                            onClick={() => router.push('/community/suggestions')}
                        >
                            건의 게시판 목록으로 이동
                        </button>
                    </div>
                )}

                {/* 일반 에러 안내 */}
                {!loading && error && !isSecretBlocked && (
                    <div className="community-error-banner" role="alert">
                        <AlertCircle size={18} />
                        <span>{error}</span>
                    </div>
                )}

                {/* 게시글 본문 카드 */}
                {!loading && post && !isSecretBlocked && (
                    <article className="community-post-card">
                        {/* 헤더: 제목, 작성자, 메타 정보 */}
                        <header className="community-post-header">
                            <div className="post-header-badges">
                                {post.is_notice && <span className="notice-badge">공지</span>}
                                {post.is_secret && (
                                    <span className="secret-badge">
                                        <Lock size={12} className="lock-icon" />
                                        비밀글
                                    </span>
                                )}
                                {post.board_type === 'suggestions' && (
                                    <span className={`community-status-badge status-${post.status || 'received'}`}>
                                        상태: {post.status === 'completed' ? '반영완료' : post.status === 'reviewing' ? '검토중' : post.status === 'hold' ? '보류' : '접수'}
                                    </span>
                                )}
                            </div>

                            <h1 className="community-post-title">{post.title}</h1>

                            <div className="community-post-meta">
                                <div className="meta-left">
                                    <span className="meta-author">{post.author_name}</span>
                                    <span className="meta-divider">·</span>
                                    <span className="meta-date">{formatDate(post.created_at)}</span>
                                </div>
                                <div className="meta-right">
                                    <span className="meta-stat" title="조회수">
                                        <Eye size={14} /> {post.view_count || 0}
                                    </span>
                                    <span className="meta-stat" title="추천수">
                                        <Heart size={14} className="icon-heart" /> {likeCount}
                                    </span>
                                    <span className="meta-stat" title="댓글수">
                                        <MessageCircle size={14} className="icon-blue" /> {comments.length}
                                    </span>
                                </div>
                            </div>

                            {/* 건의 게시판: 관리자 전용 진행 상태 변경 드롭다운 */}
                            {post.board_type === 'suggestions' && isAdmin && (
                                <div className="admin-status-control-bar">
                                    <span className="admin-badge">관리자 기능</span>
                                    <label htmlFor="adminStatusSelect">건의 처리 상태 변경:</label>
                                    <select
                                        id="adminStatusSelect"
                                        value={post.status || 'received'}
                                        onChange={(e) => handleStatusChange(e.target.value)}
                                        disabled={statusUpdating}
                                        className="admin-status-select"
                                    >
                                        <option value="received">접수</option>
                                        <option value="reviewing">검토중</option>
                                        <option value="completed">반영완료</option>
                                        <option value="hold">보류</option>
                                    </select>
                                    {statusUpdating && <span className="updating-text">변경 저장 중…</span>}
                                </div>
                            )}
                        </header>

                        {/* 본문 텍스트 */}
                        <div className="community-post-content">
                            {(post.content || '').split('\n').map((line, i) => (
                                <p key={i}>{line || '\u00A0'}</p>
                            ))}
                        </div>

                        {/* 첨부 영상 플레이어 / 링크 카드 */}
                        {post.video_url && (
                            <div className="community-video-section">
                                {youtubeInfo ? (
                                    <div className={`community-youtube-wrapper ${youtubeInfo.isShorts ? 'aspect-shorts' : 'aspect-normal'}`}>
                                        <iframe
                                            src={`https://www.youtube-nocookie.com/embed/${youtubeInfo.videoId}`}
                                            title="YouTube 영상 플레이어"
                                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                            allowFullScreen
                                        />
                                    </div>
                                ) : (
                                    <a
                                        href={post.video_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="community-external-video-card"
                                    >
                                        <div>
                                            <strong>외부 영상 링크</strong>
                                            <span>{post.video_url}</span>
                                        </div>
                                        <span className="link-action">외부 영상 보러가기 ↗</span>
                                    </a>
                                )}
                            </div>
                        )}

                        {/* 첨부 이미지 갤러리 */}
                        {Array.isArray(post.image_urls) && post.image_urls.length > 0 && (
                            <div className="community-post-images">
                                <h3>첨부 이미지 ({post.image_urls.length})</h3>
                                <div className="post-images-grid">
                                    {post.image_urls.map((imgUrl, idx) => (
                                        <div
                                            key={imgUrl}
                                            className="post-image-box"
                                            onClick={() => setZoomImage(imgUrl)}
                                            title="클릭하여 원본 크게 보기"
                                        >
                                            <img src={imgUrl} alt={`첨부 이미지 ${idx + 1}`} loading="lazy" referrerPolicy="no-referrer" />
                                            <span className="zoom-hint">원본 보기</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* 추천 버튼 & 작성자 수정/삭제 버튼 */}
                        <div className="community-post-footer-actions">
                            <button
                                type="button"
                                className={`like-action-btn ${likedByMe ? 'liked' : ''}`}
                                onClick={handleToggleLike}
                                title={likedByMe ? '추천 취소' : '추천하기'}
                            >
                                <Heart size={20} fill={likedByMe ? '#ef4444' : 'none'} />
                                <span>추천 {likeCount}</span>
                            </button>

                            {canManagePost && (
                                <div className="post-manage-actions">
                                    <a
                                        href={`/community/write?edit=${post.id}`}
                                        className="manage-btn edit-btn"
                                    >
                                        <Edit3 size={15} />
                                        <span>수정</span>
                                    </a>
                                    <button
                                        type="button"
                                        className="manage-btn delete-btn"
                                        onClick={handleDeletePost}
                                    >
                                        <Trash2 size={15} />
                                        <span>삭제</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    </article>
                )}

                {/* 댓글 영역 */}
                {!loading && post && !isSecretBlocked && (
                    <section className="community-comments-section">
                        <h2>
                            <MessageCircle size={18} className="icon-blue" />
                            댓글 <span>({comments.length})</span>
                        </h2>

                        {/* 댓글 입력 폼 */}
                        {user ? (
                            <form onSubmit={handleCommentSubmit} className="comment-write-form">
                                <textarea
                                    placeholder="댓글을 작성해 주세요. (타인을 존중하는 건전한 대화를 부탁드립니다.)"
                                    value={commentContent}
                                    onChange={(e) => setCommentContent(e.target.value)}
                                    maxLength={2000}
                                    rows={3}
                                    className="comment-textarea"
                                />
                                <div className="comment-form-bottom">
                                    {commentError && <span className="comment-error">{commentError}</span>}
                                    <span className="comment-length">{commentContent.length} / 2,000자</span>
                                    <button
                                        type="submit"
                                        className="community-btn community-btn-primary comment-submit-btn"
                                        disabled={submittingComment || !commentContent.trim()}
                                    >
                                        <Send size={14} />
                                        <span>{submittingComment ? '등록 중…' : '댓글 등록'}</span>
                                    </button>
                                </div>
                            </form>
                        ) : (
                            <div className="comment-login-notice">
                                <p>댓글을 작성하려면 로그인이 필요합니다.</p>
                                <a href="/login" className="community-btn community-btn-secondary">
                                    로그인하기
                                </a>
                            </div>
                        )}

                        {/* 댓글 목록 */}
                        <div className="comments-list">
                            {comments.length === 0 ? (
                                <p className="no-comments-msg">아직 작성된 댓글이 없습니다. 첫 댓글을 남겨보세요!</p>
                            ) : (
                                comments.map((comment) => {
                                    const canDeleteComment = isAdmin || (user?.id && comment.author_id === user.id);
                                    return (
                                        <div
                                            key={comment.id}
                                            className={`comment-item ${comment.is_admin_reply ? 'admin-comment' : ''}`}
                                        >
                                            <div className="comment-header">
                                                <div className="comment-author-info">
                                                    <span className="comment-author-name">{comment.author_name}</span>
                                                    {comment.is_admin_reply && (
                                                        <span className="admin-reply-badge">관리자</span>
                                                    )}
                                                    <span className="comment-date">{formatDate(comment.created_at)}</span>
                                                </div>
                                                {canDeleteComment && (
                                                    <button
                                                        type="button"
                                                        className="comment-delete-btn"
                                                        onClick={() => handleDeleteComment(comment.id)}
                                                        title="댓글 삭제"
                                                    >
                                                        <Trash2 size={13} />
                                                    </button>
                                                )}
                                            </div>
                                            <div className="comment-body">
                                                {comment.content.split('\n').map((line, idx) => (
                                                    <p key={idx}>{line || '\u00A0'}</p>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </section>
                )}

                {/* 이미지 원본 확대 모달 */}
                {zoomImage && (
                    <div className="image-zoom-overlay" onClick={() => setZoomImage(null)}>
                        <div className="image-zoom-content" onClick={(e) => e.stopPropagation()}>
                            <img src={zoomImage} alt="원본 이미지 확대" referrerPolicy="no-referrer" />
                            <div className="image-zoom-actions">
                                <a
                                    href={zoomImage}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="community-btn community-btn-secondary"
                                >
                                    새 창에서 원본 열기 <ExternalLink size={14} />
                                </a>
                                <button
                                    type="button"
                                    className="community-btn community-btn-primary"
                                    onClick={() => setZoomImage(null)}
                                >
                                    닫기
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

export default CommunityDetail;
