'use client';

import React, { useState, useEffect, useCallback } from 'react';
import TopMenu from './top-menu';
import {
    Flame,
    Grid,
    Search,
    Plus,
    Heart,
    MessageCircle,
    Eye,
    Image as ImageIcon,
    Layers,
    AlertCircle,
    X,
} from 'lucide-react';
import { useNewsAccount } from './news-account';
import { GALLERY_CATEGORIES, GALLERY_CATEGORY_KEYS, type GalleryCategory } from '../lib/gallery-config';
import { formatRelativeDate, type GalleryPostItem } from './gallery-types';
import GalleryDetailModal from './gallery-detail-modal';
import GalleryWriteModal from './gallery-write-modal';

type GalleryTab = 'all' | 'hot';
type CategoryFilter = 'all' | GalleryCategory;

export function GalleryBoard() {
    const { user } = useNewsAccount();

    const [tab, setTab] = useState<GalleryTab>('all');
    const [category, setCategory] = useState<CategoryFilter>('all');
    const [searchInput, setSearchInput] = useState('');
    const [currentQuery, setCurrentQuery] = useState('');
    const [page, setPage] = useState(1);

    const [posts, setPosts] = useState<GalleryPostItem[]>([]);
    const [total, setTotal] = useState(0);
    const [likedPostIds, setLikedPostIds] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState('');

    // 모달 상태
    const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
    const [writeModalOpen, setWriteModalOpen] = useState(false);
    const [editingPost, setEditingPost] = useState<GalleryPostItem | null>(null);

    const limit = 20;

    const fetchPosts = useCallback(async (targetPage: number, append: boolean) => {
        if (append) {
            setLoadingMore(true);
        } else {
            setLoading(true);
        }
        setError('');

        try {
            const params = new URLSearchParams();
            params.set('tab', tab);
            params.set('category', category);
            params.set('page', String(targetPage));
            params.set('limit', String(limit));
            if (currentQuery) {
                params.set('q', currentQuery);
            }

            const res = await fetch(`/api/gallery/posts?${params.toString()}`, {
                cache: 'no-store',
            });
            const data: any = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || '갤러리 목록을 불러오지 못했습니다.');
            }

            const fetchedPosts: GalleryPostItem[] = data.posts || [];
            const fetchedLikes: string[] = data.likedPostIds || [];

            if (append) {
                setPosts((prev) => {
                    const existingIds = new Set(prev.map((p) => p.id));
                    return [...prev, ...fetchedPosts.filter((p) => !existingIds.has(p.id))];
                });
                setLikedPostIds((prev) => Array.from(new Set([...prev, ...fetchedLikes])));
            } else {
                setPosts(fetchedPosts);
                setLikedPostIds(fetchedLikes);
            }

            setTotal(Number(data.total ?? fetchedPosts.length));
        } catch (err: any) {
            setError(err?.message || '네트워크 오류가 발생했습니다.');
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, [tab, category, currentQuery]);

    useEffect(() => {
        setPage(1);
        void fetchPosts(1, false);
    }, [fetchPosts]);

    function handleLoadMore() {
        if (loadingMore || posts.length >= total) return;
        const nextPage = page + 1;
        setPage(nextPage);
        void fetchPosts(nextPage, true);
    }

    function handleSearchSubmit(e: React.FormEvent) {
        e.preventDefault();
        setCurrentQuery(searchInput.trim());
    }

    function handleClearSearch() {
        setSearchInput('');
        setCurrentQuery('');
    }

    function handleClickWrite() {
        if (!user) {
            if (window.confirm('로그인 후 사진을 올릴 수 있습니다. 로그인 페이지로 이동할까요?')) {
                window.location.href = '/login?return_to=/gallery';
            }
            return;
        }
        setEditingPost(null);
        setWriteModalOpen(true);
    }

    // 상세 모달 이벤트 동기화 콜백
    function handleLikeChanged(postId: string, liked: boolean, likeCount: number) {
        setPosts((prev) =>
            prev.map((p) => (p.id === postId ? { ...p, like_count: likeCount } : p))
        );
        setLikedPostIds((prev) =>
            liked
                ? prev.includes(postId)
                    ? prev
                    : [...prev, postId]
                : prev.filter((id) => id !== postId)
        );
    }

    function handleCommentCountChanged(postId: string, commentCount: number) {
        setPosts((prev) =>
            prev.map((p) => (p.id === postId ? { ...p, comment_count: commentCount } : p))
        );
    }

    function handleViewed(postId: string, viewCount: number) {
        setPosts((prev) =>
            prev.map((p) => (p.id === postId ? { ...p, view_count: viewCount } : p))
        );
    }

    function handleDeleted(postId: string) {
        setPosts((prev) => prev.filter((p) => p.id !== postId));
        setTotal((prev) => Math.max(0, prev - 1));
        setSelectedPostId(null);
    }

    function handleEditFromDetail(post: GalleryPostItem) {
        setSelectedPostId(null);
        setEditingPost(post);
        setWriteModalOpen(true);
    }

    function handleSaved(savedPost: GalleryPostItem, isEdit: boolean) {
        setWriteModalOpen(false);
        setEditingPost(null);

        if (isEdit) {
            setPosts((prev) => prev.map((p) => (p.id === savedPost.id ? savedPost : p)));
            setSelectedPostId(savedPost.id);
        } else {
            if (tab === 'all' && (category === 'all' || category === savedPost.category) && !currentQuery) {
                setPosts((prev) => [savedPost, ...prev]);
                setTotal((prev) => prev + 1);
            } else {
                setTab('all');
                setCategory('all');
                setSearchInput('');
                setCurrentQuery('');
            }
        }
    }

    const canLoadMore = tab === 'all' && posts.length < total;

    return (
        <div className="gallery-container">
            <header className="topbar">
                <TopMenu />
            </header>

            <main className="gallery-main">
                {/* 1. 상단 탭 & 사진 올리기 */}
                <div className="gallery-header-bar">
                    <div className="gallery-tabs" role="tablist" aria-label="갤러리 정렬 탭">
                        <button
                            type="button"
                            role="tab"
                            aria-selected={tab === 'all'}
                            className={`gallery-tab-item ${tab === 'all' ? 'active' : ''}`}
                            onClick={() => setTab('all')}
                        >
                            <Grid size={16} />
                            <span>전체</span>
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={tab === 'hot'}
                            className={`gallery-tab-item ${tab === 'hot' ? 'active' : ''}`}
                            onClick={() => setTab('hot')}
                        >
                            <Flame size={16} className="icon-flame" />
                            <span>인기(HOT)</span>
                        </button>
                    </div>

                    <button
                        type="button"
                        className="community-btn community-btn-primary gallery-write-btn"
                        onClick={handleClickWrite}
                    >
                        <Plus size={16} />
                        <span>사진 올리기</span>
                    </button>
                </div>

                {/* 2. 카테고리 필터 & 검색창 */}
                <div className="gallery-filter-bar">
                    <div className="gallery-category-pills" role="group" aria-label="카테고리 필터">
                        <button
                            type="button"
                            className={`gallery-cat-pill ${category === 'all' ? 'active' : ''}`}
                            onClick={() => setCategory('all')}
                        >
                            전체
                        </button>
                        {GALLERY_CATEGORY_KEYS.map((key) => (
                            <button
                                key={key}
                                type="button"
                                className={`gallery-cat-pill ${category === key ? 'active' : ''}`}
                                onClick={() => setCategory(key)}
                            >
                                {GALLERY_CATEGORIES[key]}
                            </button>
                        ))}
                    </div>

                    <form className="gallery-search-form" onSubmit={handleSearchSubmit}>
                        <div className="community-search-input-wrap">
                            <Search size={15} className="search-icon" />
                            <input
                                type="text"
                                placeholder="제목·내용 검색"
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                maxLength={100}
                            />
                            {searchInput && (
                                <button
                                    type="button"
                                    className="clear-btn"
                                    onClick={handleClearSearch}
                                    aria-label="검색어 지우기"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                        <button type="submit" className="community-btn community-btn-search">
                            검색
                        </button>
                    </form>
                </div>

                {/* HOT 안내 배너 */}
                {tab === 'hot' && (
                    <div className="community-board-desc gallery-hot-banner">
                        <p>
                            <Flame size={16} className="icon-flame" />
                            최근 7일간 좋아요·댓글·조회수를 합산한 <b>인기 갤러리 TOP 20</b>입니다.
                        </p>
                    </div>
                )}

                {/* 3. 에러 배너 */}
                {error && (
                    <div className="community-error-banner" role="alert">
                        <AlertCircle size={18} />
                        <span>{error}</span>
                    </div>
                )}

                {/* 4. 초기 로딩 스피너 */}
                {loading && (
                    <div className="community-loading-state">
                        <div className="community-spinner" />
                        <p>갤러리를 불러오는 중입니다…</p>
                    </div>
                )}

                {/* 5. 빈 상태 */}
                {!loading && !error && posts.length === 0 && (
                    <div className="community-empty-state">
                        <ImageIcon size={40} className="empty-icon" />
                        <h3>등록된 사진이 없습니다.</h3>
                        <p>
                            {currentQuery
                                ? '검색 조건에 맞는 게시물이 없습니다.'
                                : '가장 먼저 멋진 이미지나 짤을 공유해 보세요!'}
                        </p>
                        <button
                            type="button"
                            className="community-btn community-btn-primary"
                            onClick={handleClickWrite}
                        >
                            <Plus size={16} />
                            <span>사진 올리기</span>
                        </button>
                    </div>
                )}

                {/* 6. 반응형 카드 그리드 */}
                {!loading && !error && posts.length > 0 && (
                    <div className="gallery-grid">
                        {posts.map((post) => {
                            const images = Array.isArray(post.image_urls) ? post.image_urls : [];
                            const firstImg = images[0];
                            const isLiked = likedPostIds.includes(post.id);

                            return (
                                <article
                                    key={post.id}
                                    className="gallery-card"
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setSelectedPostId(post.id)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            setSelectedPostId(post.id);
                                        }
                                    }}
                                >
                                    <div className="gallery-card-thumb">
                                        {firstImg ? (
                                            <img
                                                src={firstImg}
                                                alt={post.title}
                                                loading="lazy"
                                                referrerPolicy="no-referrer"
                                            />
                                        ) : (
                                            <div className="gallery-card-thumb-fallback">
                                                <ImageIcon size={28} />
                                            </div>
                                        )}

                                        <span className="gallery-card-cat-badge">
                                            {GALLERY_CATEGORIES[post.category] || post.category}
                                        </span>

                                        {images.length > 1 && (
                                            <span className="gallery-card-multi-badge">
                                                <Layers size={11} /> +{images.length - 1}
                                            </span>
                                        )}
                                    </div>

                                    <div className="gallery-card-body">
                                        <h2 className="gallery-card-title">{post.title}</h2>
                                        <div className="gallery-card-meta">
                                            <span className="gallery-card-author">{post.author_name}</span>
                                            <span>·</span>
                                            <time dateTime={post.created_at}>
                                                {formatRelativeDate(post.created_at)}
                                            </time>
                                        </div>
                                        <div className="gallery-card-stats">
                                            <span className={`gallery-card-stat ${isLiked ? 'liked' : ''}`}>
                                                <Heart
                                                    size={13}
                                                    fill={isLiked ? 'currentColor' : 'none'}
                                                />
                                                {post.like_count}
                                            </span>
                                            <span className="gallery-card-stat">
                                                <MessageCircle size={13} />
                                                {post.comment_count}
                                            </span>
                                            <span className="gallery-card-stat">
                                                <Eye size={13} />
                                                {post.view_count}
                                            </span>
                                        </div>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                )}

                {/* 7. 더 보기 버튼 */}
                {!loading && canLoadMore && (
                    <div className="gallery-load-more-wrap">
                        <button
                            type="button"
                            className="community-btn community-btn-secondary gallery-load-more-btn"
                            onClick={handleLoadMore}
                            disabled={loadingMore}
                        >
                            {loadingMore
                                ? '불러오는 중…'
                                : `더 보기 (${posts.length} / ${total})`}
                        </button>
                    </div>
                )}
            </main>

            {/* 상세 보기 모달 */}
            {selectedPostId && (
                <GalleryDetailModal
                    postId={selectedPostId}
                    currentUser={user}
                    onClose={() => setSelectedPostId(null)}
                    onEdit={handleEditFromDetail}
                    onDeleted={handleDeleted}
                    onLikeChanged={handleLikeChanged}
                    onCommentCountChanged={handleCommentCountChanged}
                    onViewed={handleViewed}
                />
            )}

            {/* 사진 올리기 / 수정 모달 */}
            {writeModalOpen && (
                <GalleryWriteModal
                    editingPost={editingPost}
                    onClose={() => {
                        setWriteModalOpen(false);
                        setEditingPost(null);
                    }}
                    onSaved={handleSaved}
                />
            )}
        </div>
    );
}

export default GalleryBoard;
