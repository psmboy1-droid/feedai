import type { GalleryCategory } from '../lib/gallery-config';

export interface GalleryPostItem {
    id: string;
    category: GalleryCategory;
    title: string;
    content: string;
    image_urls: string[];
    author_id: string;
    author_name: string;
    view_count: number;
    like_count: number;
    comment_count: number;
    created_at: string;
    updated_at: string;
    hot_score?: number;
}

export interface GalleryCommentItem {
    id: string;
    post_id: string;
    author_id: string;
    author_name: string;
    content: string;
    is_admin_reply: boolean;
    created_at: string;
}

export function formatRelativeDate(iso: string): string {
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

export function formatFullDate(iso: string): string {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch {
        return '';
    }
}
