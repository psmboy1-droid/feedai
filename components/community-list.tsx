'use client';

import React, { useState, useEffect } from 'react';
import TopMenu from './top-menu';
import CommunityTabs, { BoardType } from './community-tabs';
import {
    Flame,
    MessageCircle,
    Eye,
    Heart,
    Lock,
    Pin,
    Image as ImageIcon,
    Video as VideoIcon,
    Search,
    PenSquare,
    ChevronLeft,
    ChevronRight,
    AlertCircle,
} from 'lucide-react';
import { useNewsAccount } from './news-account';

export interface CommunityPostItem {
    id: string;
    board_type: 'free' | 'suggestions';
    title: string;
    content?: string;
    image_urls?: string[];
    video_url?: string | null;
    author_name: string;
    author_id: string;
    is_secret: boolean;
    is_notice: boolean;
    status?: 'received' | 'reviewing' | 'completed' | 'hold' | null;
    view_count: number;
    like_count: number;
    comment_count: number;
    created_at: string;
    updated_at: string;
    is_masked?: boolean;
    hot_score?: number;
}

interface CommunityListProps {
    board: BoardType;
}

function formatDate(iso: string): string {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        const diffSec = Math.floor(diffMs / 1000);
        const diffMin = Math.floor(diffSec / 60);
        const diffHour = Math.floor(diffMin / 60);
        const diffDay = Math.floor(diffHour / 24);

        if (diffMin < 1) return '방금 전';
        if (diffMin < 60) return `${diffMin}분 전`;
        if (diffHour < 24) return `${diffHour}시간 전`;
        if (diffDay < 7) return `${diffDay}일 전`;

        return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
    } catch {
        return '';
    }
}

function getStatusBadge(status?: string | null) {
    switch (status) {
        case 'received':
            return <span className="community-status-badge status-received">접수</span>;
        case 'reviewing':
            return <span className="community-status-badge status-reviewing">검토중</span>;
        case 'completed':
            return <span className="community-status-badge status-completed">반영완료</span>;
        case 'hold':
            return <span className="community-status-badge status-hold">보류</span>;
        default:
            return <span className="community-status-badge status-received">접수</span>;
    }
}

export function CommunityList({ board }: CommunityListProps) {
    const { user } = useNewsAccount();
    const [posts, setPosts] = useState<CommunityPostItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [currentQuery, setCurrentQuery] = useState('');

    const pageSize = 20;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    useEffect(() => {
        let live = true;
        setLoading(true);
        setError('');

        const params = new URLSearchParams();
        params.set('board', board);
        params.set('page', String(page));
        if (currentQuery) params.set('q', currentQuery);

        fetch(`/api/community/posts?${params.toString()}`, { cache: 'no-store' })
            .then(async (res) => {
                if (!res.ok) {
                    const d: any = await res.json().catch(() => ({}));
                    throw new Error(d.error || '게시글 목록을 불러오지 못했습니다.');
                }
                return res.json();
            })
            .then((data: any) => {
                if (live) {
                    setPosts(data.posts || []);
                    setTotal(data.total || 0);
                    setLoading(false);
                }
            })
            .catch((err) => {
                if (live) {
                    setError(err.message || '네트워크 오류가 발생했습니다.');
                    setLoading(false);
                }
            });

        return () => {
            live = false;
        };
    }, [board, page, currentQuery]);

    function handleSearch(e: React.FormEvent) {
        e.preventDefault();
        setPage(1);
        setCurrentQuery(searchQuery.trim());
    }

    const writeHref = board === 'suggestions'
        ? '/community/write?board=suggestions'
        : '/community/write?board=free';

    const writeLabel = board === 'suggestions'
        ? '건의 작성'
        : board === 'hot'
        ? '자유 게시판에 글쓰기'
        : '글쓰기';

    return (
        <div className="community-container">
            <header className="topbar">
                <TopMenu />
            </header>

            <main className="community-main">
                {/* 1. 상단 탭 네비게이션 */}
                <div className="community-header-bar">
                    <CommunityTabs currentBoard={board} />
                    <div className="community-header-actions">
                        <a href={writeHref} className="community-btn community-btn-primary">
                            <PenSquare size={16} />
                            <span>{writeLabel}</span>
                        </a>
                    </div>
                </div>

                {/* 2. 게시판 안내 및 설명 */}
                <div className="community-board-desc">
                    {board === 'hot' && (
                        <p>
                            <Flame size={16} className="icon-flame" />
                            최근 7일간 추천과 댓글이 가장 많은 <b>인기글 20선</b>입니다.
                        </p>
                    )}
                    {board === 'free' && (
                        <p>피드AI 회원들과 자유롭게 이야기를 나누는 공간입니다. (이미지 첨부 및 유튜브 영상 링크 지원)</p>
                    )}
                    {board === 'suggestions' && (
                        <p>서비스 기능 건의나 문의사항을 남겨주시면 관리자가 검토 후 진행 상황을 안내해 드립니다.</p>
                    )}
                </div>

                {/* 3. 검색바 (자유/건의 게시판) */}
                {board !== 'hot' && (
                    <form className="community-search-form" onSubmit={handleSearch}>
                        <div className="community-search-input-wrap">
                            <Search size={16} className="search-icon" />
                            <input
                                type="text"
                                placeholder="제목 또는 내용 검색"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                maxLength={100}
                            />
                            {searchQuery && (
                                <button
                                    type="button"
                                    className="clear-btn"
                                    onClick={() => {
                                        setSearchQuery('');
                                        setCurrentQuery('');
                                        setPage(1);
                                    }}
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                        <button type="submit" className="community-btn community-btn-search">
                            검색
                        </button>
                    </form>
                )}

                {/* 4. 에러 메시지 */}
                {error && (
                    <div className="community-error-banner" role="alert">
                        <AlertCircle size={18} />
                        <span>{error}</span>
                    </div>
                )}

                {/* 5. 로딩 표시 */}
                {loading && (
                    <div className="community-loading-state">
                        <div className="community-spinner" />
                        <p>게시글을 불러오는 중입니다…</p>
                    </div>
                )}

                {/* 6. 목록 테이블 / 카드 뷰 */}
                {!loading && !error && posts.length === 0 && (
                    <div className="community-empty-state">
                        <MessageCircle size={40} className="empty-icon" />
                        <h3>등록된 게시글이 없습니다.</h3>
                        <p>{currentQuery ? '검색 조건에 맞는 게시글이 없습니다.' : '첫 번째 글을 작성해 보세요!'}</p>
                        <a href={writeHref} className="community-btn community-btn-primary">
                            <PenSquare size={16} />
                            <span>{writeLabel}</span>
                        </a>
                    </div>
                )}

                {!loading && !error && posts.length > 0 && (
                    <div className="community-table-wrap">
                        <table className="community-table">
                            <thead>
                                <tr>
                                    {board === 'hot' ? (
                                        <th className="col-rank">순위</th>
                                    ) : (
                                        <th className="col-num">번호</th>
                                    )}
                                    {board === 'suggestions' && <th className="col-status">상태</th>}
                                    <th className="col-title">제목</th>
                                    <th className="col-author">작성자</th>
                                    <th className="col-date">작성일</th>
                                    <th className="col-views">조회</th>
                                    <th className="col-likes">추천</th>
                                </tr>
                            </thead>
                            <tbody>
                                {posts.map((post, index) => {
                                    const rankNum = index + 1;
                                    const hasImages = Array.isArray(post.image_urls) && post.image_urls.length > 0;
                                    const hasVideo = !!post.video_url;

                                    return (
                                        <tr
                                            key={post.id}
                                            className={`community-row ${post.is_notice ? 'notice-row' : ''}`}
                                        >
                                            {/* 번호 / 순위 */}
                                            {board === 'hot' ? (
                                                <td className="col-rank">
                                                    <span className={`rank-badge rank-${rankNum <= 3 ? rankNum : 'normal'}`}>
                                                        {rankNum}
                                                    </span>
                                                </td>
                                            ) : (
                                                <td className="col-num">
                                                    {post.is_notice ? (
                                                        <span className="notice-badge">공지</span>
                                                    ) : (
                                                        total - ((page - 1) * pageSize + index)
                                                    )}
                                                </td>
                                            )}

                                            {/* 건의 게시판 처리 상태 */}
                                            {board === 'suggestions' && (
                                                <td className="col-status">
                                                    {getStatusBadge(post.status)}
                                                </td>
                                            )}

                                            {/* 제목 */}
                                            <td className="col-title">
                                                <a href={`/community/${post.id}`} className="post-title-link">
                                                    {post.is_notice && <Pin size={13} className="pin-icon" />}
                                                    {post.is_secret && <Lock size={13} className="lock-icon" />}
                                                    <span className={`title-text ${post.is_masked ? 'masked-title' : ''}`}>
                                                        {post.title}
                                                    </span>

                                                    {/* 미디어 아이콘 */}
                                                    {hasImages && !post.is_masked && (
                                                        <span className="media-badge" title={`첨부 이미지 ${post.image_urls?.length}개`}>
                                                            <ImageIcon size={13} />
                                                        </span>
                                                    )}
                                                    {hasVideo && !post.is_masked && (
                                                        <span className="media-badge media-video" title="영상 링크 포함">
                                                            <VideoIcon size={13} />
                                                        </span>
                                                    )}

                                                    {/* 댓글 수 배지 */}
                                                    {(post.comment_count || 0) > 0 && (
                                                        <span className="comment-badge">
                                                            [{post.comment_count}]
                                                        </span>
                                                    )}
                                                </a>
                                            </td>

                                            {/* 작성자 */}
                                            <td className="col-author">
                                                <span className="author-name">{post.author_name}</span>
                                            </td>

                                            {/* 작성일 */}
                                            <td className="col-date">
                                                <span title={post.created_at}>{formatDate(post.created_at)}</span>
                                            </td>

                                            {/* 조회수 */}
                                            <td className="col-views">
                                                <span>{post.view_count || 0}</span>
                                            </td>

                                            {/* 추천수 */}
                                            <td className="col-likes">
                                                <span className={`like-num ${(post.like_count || 0) > 0 ? 'highlight-like' : ''}`}>
                                                    {post.like_count || 0}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* 7. 페이지네이션 (자유/건의 게시판) */}
                {board !== 'hot' && totalPages > 1 && (
                    <div className="community-pagination">
                        <button
                            type="button"
                            className="page-btn"
                            disabled={page <= 1}
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            aria-label="이전 페이지"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        {Array.from({ length: totalPages }, (_, i) => i + 1)
                            .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                            .map((p, idx, arr) => {
                                const prev = arr[idx - 1];
                                return (
                                    <React.Fragment key={p}>
                                        {prev && p - prev > 1 && <span className="page-ellipsis">…</span>}
                                        <button
                                            type="button"
                                            className={`page-btn ${page === p ? 'active' : ''}`}
                                            onClick={() => setPage(p)}
                                        >
                                            {p}
                                        </button>
                                    </React.Fragment>
                                );
                            })}
                        <button
                            type="button"
                            className="page-btn"
                            disabled={page >= totalPages}
                            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                            aria-label="다음 페이지"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                )}
            </main>
        </div>
    );
}

export default CommunityList;
