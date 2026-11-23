/**
 * lib/r2.ts
 * Cloudflare R2 공용 유틸 — aws4fetch (S3-compatible)
 */

import { AwsClient } from 'aws4fetch';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── 상수 ──────────────────────────────────────────────────────────────────
export const MAX_R2_BYTES = Math.floor(9.5 * 1024 * 1024 * 1024); // 9.5 GB

function getCleanEndpoint(rawEndpoint: string, bucket: string): string {
    let clean = (rawEndpoint || '').trim().replace(/\/+$/, '');
    if (bucket) {
        const b = bucket.trim();
        if (clean.toLowerCase().endsWith(`/${b.toLowerCase()}`)) {
            clean = clean.slice(0, -(b.length + 1)).replace(/\/+$/, '');
        }
    }
    return clean;
}

function getEnv() {
    const rawEndpoint = process.env.R2_ENDPOINT          ?? '';
    const accessKey   = process.env.R2_ACCESS_KEY_ID     ?? '';
    const secretKey   = process.env.R2_SECRET_ACCESS_KEY  ?? '';
    const bucket      = (process.env.R2_BUCKET_NAME       ?? '').trim();
    const publicUrl   = (process.env.R2_PUBLIC_URL         ?? '').trim().replace(/\/+$/, '');
    const endpoint    = getCleanEndpoint(rawEndpoint, bucket);
    return { endpoint, accessKey, secretKey, bucket, publicUrl };
}

function makeClient() {
    const { accessKey, secretKey } = getEnv();
    return new AwsClient({
        accessKeyId:     accessKey,
        secretAccessKey: secretKey,
        service:         's3',
        region:          'auto',
    });
}

// ─── R2 저장소 사용량 조회 ─────────────────────────────────────────────────
export async function getR2StorageStats(supabase: SupabaseClient): Promise<{
    totalBytes: number;
    fileCount:  number;
    limitBytes: number;
}> {
    try {
        const { data, error } = await supabase.rpc('get_r2_storage_stats');
        if (error || !data) {
            return { totalBytes: 0, fileCount: 0, limitBytes: MAX_R2_BYTES };
        }
        return {
            totalBytes: Number(data.total_bytes  ?? 0),
            fileCount:  Number(data.file_count   ?? 0),
            limitBytes: MAX_R2_BYTES,
        };
    } catch {
        return { totalBytes: 0, fileCount: 0, limitBytes: MAX_R2_BYTES };
    }
}

// ─── R2 업로드 ─────────────────────────────────────────────────────────────
export async function uploadToR2(opts: {
    key:         string;
    body:        ArrayBuffer | Uint8Array;
    contentType: string;
}): Promise<string> {
    const { endpoint, bucket, publicUrl } = getEnv();
    const cleanEndpoint = endpoint.replace(/\/+$/, '');
    const url = `${cleanEndpoint}/${bucket}/${opts.key}`;

    const client = makeClient();
    const res = await client.fetch(url, {
        method:  'PUT',
        body:    opts.body as any,
        headers: {
            'Content-Type':           opts.contentType,
            'Cache-Control':          'public, max-age=31536000, immutable',
            'X-Content-Type-Options': 'nosniff',
        },
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`R2 업로드 실패 (${res.status}): ${text.slice(0, 200)}`);
    }

    return `${publicUrl.replace(/\/$/, '')}/${opts.key}`;
}

// ─── URL에서 R2 Object Key 추출 ───────────────────────────────────────────
export function extractR2KeyFromUrl(url: string): string | null {
    const { publicUrl } = getEnv();
    if (!publicUrl || !url) return null;
    const base = publicUrl.replace(/\/$/, '');
    if (!url.startsWith(base + '/')) return null;
    return url.slice(base.length + 1); // 앞의 '/' 포함 제거
}

// ─── R2 파일 삭제 (URL 기반) ──────────────────────────────────────────────
export async function deleteFromR2ByUrl(supabase: SupabaseClient, url: string): Promise<void> {
    const key = extractR2KeyFromUrl(url);
    if (!key) return; // 외부 URL은 무시

    const { endpoint, bucket } = getEnv();
    const cleanEndpoint = endpoint.replace(/\/+$/, '');
    const r2Url = `${cleanEndpoint}/${bucket}/${key}`;

    // R2 원본 파일 삭제
    try {
        const client = makeClient();
        const res = await client.fetch(r2Url, { method: 'DELETE' });
        if (!res.ok && res.status !== 404) {
            console.error(`[R2] DELETE 실패 (${res.status}): ${key}`);
        }
    } catch (err) {
        console.error('[R2] DELETE 오류:', err);
    }

    // r2_media_files 테이블 레코드 삭제
    try {
        await supabase.from('r2_media_files').delete().eq('object_key', key);
    } catch (err) {
        console.error('[R2] DB 레코드 삭제 오류:', err);
    }
}
