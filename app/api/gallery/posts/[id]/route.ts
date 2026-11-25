import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { isRssAdmin } from '@/lib/rss-admin';
import { getSupabaseServer } from '@/lib/supabase';
import { deleteFromR2ByUrl } from '@/lib/r2';
import { isValidGalleryCategory } from '@/lib/gallery-config';

export const dynamic = 'force-dynamic';

const reply = (body: unknown, status = 200) =>
    NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

const patchSchema = z.object({
    title: z.string().trim().min(1, '제목을 입력해 주세요.').max(150, '제목은 150자 이내여야 합니다.').optional(),
    category: z.string().refine(isValidGalleryCategory, '올바른 카테고리를 선택해 주세요.').optional(),
    content: z.string().trim().max(2000, '설명은 2000자 이내여야 합니다.').optional(),
    image_urls: z
        .array(z.string().url('올바른 이미지 URL이 아닙니다.'))
        .min(1, '이미지는 최소 1장 이상 첨부해야 합니다.')
        .max(5, '이미지는 최대 5장까지 첨부할 수 있습니다.')
        .optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const user = await getChatGPTUser();
        const isAdmin = await isRssAdmin();
        const supabase = getSupabaseServer();

        // 1. 게시글 단건 조회
        const { data: post, error } = await supabase
            .from('gallery_posts')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (error || !post) {
            return reply({ error: '게시글을 찾을 수 없습니다.' }, 404);
        }

        // 2. 조회수 증가 (1시간 쿠키 기반 중복 방지, RPC 실패해도 조회는 정상 응답)
        const cookieName = `gallery_viewed_${id}`;
        const hasViewed = req.cookies.has(cookieName);
        let currentViews = post.view_count || 0;

        if (!hasViewed) {
            try {
                const { error: rpcErr } = await supabase.rpc('increment_gallery_view', { p_post_id: id });
                if (!rpcErr) {
                    currentViews += 1;
                }
            } catch {
                // RPC 호출 실패 시에도 정상 응답 유지
            }
        }

        // 3. 댓글 목록 조회 (오래된 순)
        const { data: comments } = await supabase
            .from('gallery_comments')
            .select('*')
            .eq('post_id', id)
            .order('created_at', { ascending: true });

        // 4. 현재 유저 좋아요 여부 조회
        let likedByMe = false;
        if (user?.userId) {
            const { count: likeCount } = await supabase
                .from('gallery_likes')
                .select('*', { count: 'exact', head: true })
                .eq('post_id', id)
                .eq('user_id', user.userId);
            likedByMe = (likeCount ?? 0) > 0;
        }

        const isAuthor = Boolean(user?.userId && post.author_id === user.userId);
        const canEdit = isAuthor || isAdmin;

        const response = NextResponse.json({
            post: {
                ...post,
                view_count: currentViews,
            },
            comments: comments || [],
            likedByMe,
            canEdit,
            currentUserId: user?.userId || null,
            isAdmin,
        }, { headers: { 'Cache-Control': 'private, no-store' } });

        if (!hasViewed) {
            response.cookies.set(cookieName, '1', {
                path: '/',
                maxAge: 3600, // 1시간
                sameSite: 'lax',
            });
        }

        return response;
    } catch (err) {
        console.error('갤러리 게시글 상세 조회 에러:', err);
        return reply({ error: '게시글을 불러오지 못했습니다.' }, 500);
    }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;

        // 1. 회원 인증
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

        const supabase = getSupabaseServer();
        const isAdmin = await isRssAdmin();

        // 3. 기존 게시글 조회
        const { data: post, error: findError } = await supabase
            .from('gallery_posts')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (findError || !post) {
            return reply({ error: '수정할 게시글을 찾을 수 없습니다.' }, 404);
        }

        // 4. 권한 검사 (작성자 본인 또는 관리자)
        const isAuthor = post.author_id === user.userId;
        if (!isAuthor && !isAdmin) {
            return reply({ error: '게시글을 수정할 권한이 없습니다.' }, 403);
        }

        // 5. 입력값 파싱 및 검증
        let bodyJson: unknown;
        try {
            bodyJson = await req.json();
        } catch {
            return reply({ error: '잘못된 입력입니다.' }, 400);
        }

        const parsed = patchSchema.safeParse(bodyJson);
        if (!parsed.success) {
            const firstErr = parsed.error.issues[0]?.message || '입력값을 확인해 주세요.';
            return reply({ error: firstErr }, 400);
        }

        const d = parsed.data;
        const updates: Record<string, any> = {
            updated_at: new Date().toISOString(),
        };

        if (d.title !== undefined) updates.title = d.title;
        if (d.category !== undefined) updates.category = d.category;
        if (d.content !== undefined) updates.content = d.content;

        if (d.image_urls !== undefined) {
            const r2PublicUrl = (process.env.R2_PUBLIC_URL || '').trim().replace(/\/+$/, '');
            if (r2PublicUrl) {
                for (const imgUrl of d.image_urls) {
                    if (!imgUrl.startsWith(r2PublicUrl + '/')) {
                        return reply({ error: '첨부 이미지는 FeedAI 업로더를 통해 업로드된 파일만 등록할 수 있습니다.' }, 400);
                    }
                }
            }

            const oldImages: string[] = Array.isArray(post.image_urls) ? post.image_urls : [];
            const newImages: string[] = d.image_urls;
            const removedImages = oldImages.filter((url) => !newImages.includes(url));

            for (const removedUrl of removedImages) {
                await deleteFromR2ByUrl(supabase, removedUrl).catch((e) => {
                    console.error('R2 이미지 정리 실패:', e);
                });
            }

            updates.image_urls = newImages;
        }

        const { data: updatedPost, error: updateError } = await supabase
            .from('gallery_posts')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (updateError) {
            console.error('갤러리 게시글 수정 실패:', updateError.message);
            return reply({ error: '게시글 수정에 실패했습니다.' }, 500);
        }

        return reply({ message: '게시글이 수정되었습니다.', post: updatedPost });
    } catch (err) {
        console.error('갤러리 게시글 수정 처리 에러:', err);
        return reply({ error: '게시글 수정 중 오류가 발생했습니다.' }, 500);
    }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;

        // 1. 회원 인증
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

        const supabase = getSupabaseServer();
        const isAdmin = await isRssAdmin();

        // 3. 기존 게시글 조회
        const { data: post, error: findError } = await supabase
            .from('gallery_posts')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (findError || !post) {
            return reply({ error: '삭제할 게시글을 찾을 수 없습니다.' }, 404);
        }

        // 4. 삭제 권한 검증 (작성자 본인 또는 관리자)
        const isAuthor = post.author_id === user.userId;
        if (!isAuthor && !isAdmin) {
            return reply({ error: '게시글을 삭제할 권한이 없습니다.' }, 403);
        }

        // 5. 게시글에 첨부된 모든 이미지 R2 및 DB 정리
        const images: string[] = Array.isArray(post.image_urls) ? post.image_urls : [];
        for (const imgUrl of images) {
            if (typeof imgUrl === 'string') {
                await deleteFromR2ByUrl(supabase, imgUrl).catch((e) => {
                    console.error('R2 이미지 삭제 실패:', e);
                });
            }
        }

        // 6. DB 게시글 및 관련 데이터 삭제
        await Promise.all([
            supabase.from('gallery_comments').delete().eq('post_id', id),
            supabase.from('gallery_likes').delete().eq('post_id', id),
            supabase.from('gallery_posts').delete().eq('id', id),
        ]);

        return reply({ message: '게시글이 삭제되었습니다.' });
    } catch (err) {
        console.error('갤러리 게시글 삭제 처리 에러:', err);
        return reply({ error: '게시글 삭제 중 오류가 발생했습니다.' }, 500);
    }
}
