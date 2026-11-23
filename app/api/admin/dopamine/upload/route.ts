/**
 * /api/admin/dopamine/upload/route.ts
 * R2 파일 업로드 전용 API — 6단계 보안 방어
 */

import { isRssAdmin } from '../../../../../lib/rss-admin';
import { getSupabaseServer } from '../../../../../lib/supabase';
import { uploadToR2, getR2StorageStats, MAX_R2_BYTES, deleteFromR2ByUrl } from '../../../../../lib/r2';

export const dynamic = 'force-dynamic';

const reply = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

// ─── 매직 바이트 허용 목록 ─────────────────────────────────────────────────
function detectMimeFromBytes(buf: Uint8Array): { mime: string; ext: string; isVideo: boolean } | null {
    const b = buf;

    // JPEG: FF D8 FF
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) {
        return { mime: 'image/jpeg', ext: 'jpg', isVideo: false };
    }
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) {
        return { mime: 'image/png', ext: 'png', isVideo: false };
    }
    // GIF: 47 49 46 38 (GIF8)
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
        return { mime: 'image/gif', ext: 'gif', isVideo: false };
    }
    // WebP: RIFF ....WEBP (offset 0: 52 49 46 46, offset 8: 57 45 42 50)
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
        return { mime: 'image/webp', ext: 'webp', isVideo: false };
    }
    // MP4/MOV: ftyp 시그니처가 offset 4에 존재 (66 74 79 70)
    if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
        return { mime: 'video/mp4', ext: 'mp4', isVideo: true };
    }
    // WebM: 1A 45 DF A3
    if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) {
        return { mime: 'video/webm', ext: 'webm', isVideo: true };
    }

    return null; // SVG, HTML 등 허용 외 형식
}

// ─── POST ─────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
    // [1] 관리자 RBAC 검증 (DB profiles.is_admin 기반)
    if (!await isRssAdmin()) return reply({ error: '관리자만 접근할 수 있습니다.' }, 403);

    // [1] CSRF 검증
    const origin = req.headers.get('origin');
    const reqOrigin = new URL(req.url).origin;
    if (origin !== reqOrigin) return reply({ error: '허용되지 않은 요청입니다.' }, 403);

    // [2] multipart/form-data 파싱
    let formData: FormData;
    try {
        formData = await req.formData();
    } catch {
        return reply({ error: '파일 파싱에 실패했습니다.' }, 400);
    }

    const fileEntry = formData.get('file');
    const kind = (formData.get('kind') as string | null) ?? 'media';

    if (!(fileEntry instanceof File)) {
        return reply({ error: 'file 필드가 없습니다.' }, 400);
    }
    if (!['media', 'thumbnail'].includes(kind)) {
        return reply({ error: 'kind는 media 또는 thumbnail이어야 합니다.' }, 400);
    }

    const file = fileEntry as File;

    // [3] 매직 바이트 검증 (파일 앞 16바이트)
    const headerSlice = await file.slice(0, 16).arrayBuffer();
    const headerBytes = new Uint8Array(headerSlice);
    const detected = detectMimeFromBytes(headerBytes);

    if (!detected) {
        return reply({ error: '허용되지 않는 파일 형식입니다. JPEG, PNG, WebP, GIF, MP4, WebM만 허용됩니다.' }, 400);
    }

    // 썸네일(kind=thumbnail)은 동영상 불허
    if (kind === 'thumbnail' && detected.isVideo) {
        return reply({ error: '썸네일은 이미지(JPEG/PNG/WebP/GIF)만 허용됩니다.' }, 400);
    }

    // [4] 파일 크기 제한
    const IMAGE_MAX = 5 * 1024 * 1024;   // 5 MB
    const VIDEO_MAX = 30 * 1024 * 1024;  // 30 MB
    const sizeLimit = detected.isVideo ? VIDEO_MAX : IMAGE_MAX;

    if (file.size > sizeLimit) {
        const mb = (sizeLimit / 1024 / 1024).toFixed(0);
        return reply({ error: `파일 크기 초과: ${detected.isVideo ? '동영상' : '이미지'}는 최대 ${mb}MB까지 허용됩니다.` }, 413);
    }

    // [5] 9.5GB 누적 용량 제한
    const supabase = getSupabaseServer();
    const stats = await getR2StorageStats(supabase);

    if (stats.totalBytes + file.size > MAX_R2_BYTES) {
        return reply({
            error: '무료 저장소 한도(9.5GB)에 도달해 업로드를 차단했습니다. 기존 광고 파일을 삭제해 주세요.',
        }, 507);
    }

    // [6] 안전한 랜덤 파일명 생성 (사용자 원본 파일명 미사용)
    const now = new Date();
    const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const key = `ads/${yyyymm}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${detected.ext}`;

    // 업로드 실행
    const arrayBuffer = await file.arrayBuffer();
    let publicUrl: string;
    try {
        publicUrl = await uploadToR2({ key, body: arrayBuffer, contentType: detected.mime });
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'R2 업로드 오류';
        return reply({ error: msg }, 502);
    }

    // DB r2_media_files 기록 — 실패 시 R2 파일 롤백 삭제
    const { error: dbErr } = await supabase.from('r2_media_files').insert({
        object_key:   key,
        public_url:   publicUrl,
        category:     'dopamine_ad',
        content_type: detected.mime,
        file_size:    file.size,
    });

    if (dbErr) {
        // 롤백
        await deleteFromR2ByUrl(supabase, publicUrl).catch(() => {});
        return reply({ error: `DB 저장 실패: ${dbErr.message}` }, 500);
    }

    const updatedStats = await getR2StorageStats(supabase);

    return reply({
        url:       publicUrl,
        key,
        mediaType: detected.isVideo ? 'video' : 'image',
        fileSize:  file.size,
        storage:   updatedStats,
    }, 201);
}
