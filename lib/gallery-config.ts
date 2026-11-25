export const GALLERY_CATEGORIES = {
    humor: '유머·짤',
    ai: 'AI·아트',
    info: '정보·차트',
    daily: '일상',
} as const;

export type GalleryCategory = keyof typeof GALLERY_CATEGORIES;

export const GALLERY_CATEGORY_KEYS = Object.keys(GALLERY_CATEGORIES) as GalleryCategory[];

export function isValidGalleryCategory(v: string): v is GalleryCategory {
    return Object.prototype.hasOwnProperty.call(GALLERY_CATEGORIES, v);
}
