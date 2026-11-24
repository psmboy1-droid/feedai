import { NextRequest, NextResponse } from 'next/server';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getSupabaseServer } from '@/lib/supabase';
import { uploadToR2, getR2StorageStats, MAX_R2_BYTES, deleteFromR2ByUrl } from '@/lib/r2';

export const dynamic = 'force-dynamic';

const reply = (body: unknown, status = 200) =>
    NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

// 앞 16바이트 기반 순수 이미지 매직 바이트 판별 (동영상 및 실행 파일 절대 차단)
function detectImageMimeFromBytes(buf: Uint8Array): { mime: string; ext: string } | null {
    const b = buf;

    // JPEG: FF D8 FF
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) {
        return { mime: 'image/jpeg', ext: 'jpg' };
    }
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) {
        return { mime: 'image/png', ext: 'png' };
    }
    // GIF: 47 49 46 38 (GIF8)
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
        return { mime: 'image/gif', ext: 'gif' };
    }
    // WebP: RIFF ....WEBP (offset 0: 52 49 46 46, offset 8: 57 45 42 50)
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
        return { mime: 'image/webp', ext: 'webp' };
    }

    return null; // MP4, WebM, SVG, HTML 등은 일체 불허
}

export async function POST(req: NextRequest) {
    // 1. 회원 인증 검증 (비로그인 401)
    const user = await getChatGPTUser();
    if (!user || !user.userId) {
        return reply({ error: '로그인이 필요합니다.' }, 401);
    }

    // 2. CSRF Same-Origin 검증
    const origin = req.headers.get('origin');
    const reqOrigin = new URL(req.url).origin;
    if (origin !== reqOrigin) {
        return reply({ error: '허용되지 않은 요청입니다.' }, 403);
    }

    // 3. multipart/form-data 파싱
    let formData: FormData;
    try {
        formData = await req.formData();
    } catch {
        return reply({ error: '파일 파싱에 실패했습니다.' }, 400);
    }

    const fileEntry = formData.get('file');
    if (!(fileEntry instanceof File)) {
        return reply({ error: 'file 필드가 없습니다.' }, 400);
    }
    const file = fileEntry;

    // 4. 매직 바이트 검증 (앞 16바이트) - 이미지만 허용, 영상 절대 금지
    const headerSlice = await file.slice(0, 16).arrayBuffer();
    const headerBytes = new Uint8Array(headerSlice);
    const detected = detectImageMimeFromBytes(headerBytes);

    if (!detected) {
        return reply({
            error: '이미지 파일(JPEG, PNG, WebP, GIF)만 업로드할 수 있습니다. 동영상 및 허용되지 않은 파일 형식은 차단됩니다.',
        }, 400);
    }

    // 5. 파일 크기 제한 (최대 5MB)
    const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
    if (file.size > MAX_IMAGE_SIZE) {
        return reply({ error: '이미지 크기는 장당 최대 5MB까지 허용됩니다.' }, 413);
    }

    // 6. R2 9.5GB 누적 용량 체크
    const supabase = getSupabaseServer();
    const stats = await getR2StorageStats(supabase);
    if (stats.totalBytes + file.size > MAX_R2_BYTES) {
        return reply({
            error: '무료 저장소 한도(9.5GB)에 도달해 업로드를 차단했습니다.',
        }, 507);
    }

    // 7. 안전한 저장 경로 생성: community/YYYYMM/${Date.now()}-${uuid}.${ext}
    const now = new Date();
    const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const key = `community/${yyyymm}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${detected.ext}`;

    // 8. R2 업로드
    const arrayBuffer = await file.arrayBuffer();
    let publicUrl: string;
    try {
        publicUrl = await uploadToR2({
            key,
            body: arrayBuffer,
            contentType: detected.mime,
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'R2 업로드 오류';
        return reply({ error: msg }, 502);
    }

    // 9. r2_media_files 레코드 저장 (category: 'community')
    const { error: dbErr } = await supabase.from('r2_media_files').insert({
        object_key: key,
        public_url: publicUrl,
        category: 'community',
        content_type: detected.mime,
        file_size: file.size,
    });

    if (dbErr) {
        // 실패 시 R2 파일 롤백 삭제
        await deleteFromR2ByUrl(supabase, publicUrl).catch(() => {});
        return reply({ error: `DB 저장 실패: ${dbErr.message}` }, 500);
    }

    return reply({
        url: publicUrl,
        key,
        fileSize: file.size,
    }, 201);
}
