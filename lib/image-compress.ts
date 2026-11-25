'use client';

const MAX_DIMENSION = 1600;
const WEBP_QUALITY = 0.82;
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB

function loadImageElement(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('이미지를 읽을 수 없습니다.'));
        };
        img.src = objectUrl;
    });
}

function getResizedDimensions(width: number, height: number): { width: number; height: number } {
    if (width <= MAX_DIMENSION && height <= MAX_DIMENSION) {
        return { width, height };
    }
    if (width >= height) {
        return {
            width: MAX_DIMENSION,
            height: Math.max(1, Math.round((height * MAX_DIMENSION) / width)),
        };
    }
    return {
        width: Math.max(1, Math.round((width * MAX_DIMENSION) / height)),
        height: MAX_DIMENSION,
    };
}

function toWebpFileName(originalName: string): string {
    const baseName = originalName.replace(/\.[^/.]+$/, '').trim() || 'image';
    return `${baseName}.webp`;
}

/**
 * 갤러리 업로드 전 클라이언트 측 이미지 자동 최적화 유틸:
 * - GIF: 애니메이션 보존을 위해 압축 없이 원본 반환 (5MB 초과는 에러 throw)
 * - 그 외 이미지: 최대 1600px 이하로 비율 유지 리사이징 후 WebP(0.82) 변환
 * - WebP 미지원 브라우저이거나 변환 후 용량이 더 커지면 원본 반환
 */
export async function compressImageForGallery(file: File): Promise<File> {
    if (file.type === 'image/gif') {
        if (file.size > MAX_FILE_BYTES) {
            throw new Error('GIF 이미지는 5MB 이하만 업로드할 수 있습니다.');
        }
        return file;
    }

    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return file;
    }

    let sourceWidth = 0;
    let sourceHeight = 0;
    let bitmap: ImageBitmap | null = null;
    let imgEl: HTMLImageElement | null = null;

    try {
        if (typeof createImageBitmap === 'function') {
            bitmap = await createImageBitmap(file);
            sourceWidth = bitmap.width;
            sourceHeight = bitmap.height;
        } else {
            imgEl = await loadImageElement(file);
            sourceWidth = imgEl.naturalWidth || imgEl.width;
            sourceHeight = imgEl.naturalHeight || imgEl.height;
        }
    } catch {
        // createImageBitmap 실패 시 Image 엘리먼트로 재시도
        try {
            imgEl = await loadImageElement(file);
            sourceWidth = imgEl.naturalWidth || imgEl.width;
            sourceHeight = imgEl.naturalHeight || imgEl.height;
        } catch {
            return file;
        }
    }

    if (!sourceWidth || !sourceHeight) {
        bitmap?.close();
        return file;
    }

    const { width, height } = getResizedDimensions(sourceWidth, sourceHeight);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
        bitmap?.close();
        return file;
    }

    ctx.drawImage((bitmap ?? imgEl) as CanvasImageSource, 0, 0, width, height);
    bitmap?.close();

    const blob = await new Promise<Blob | null>((resolve) => {
        try {
            canvas.toBlob((result) => resolve(result), 'image/webp', WEBP_QUALITY);
        } catch {
            resolve(null);
        }
    });

    // WebP 인코딩 미지원 브라우저이거나 압축 결과가 원본 이상이면 원본 반환
    if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) {
        return file;
    }

    return new File([blob], toWebpFileName(file.name), {
        type: 'image/webp',
        lastModified: Date.now(),
    });
}
