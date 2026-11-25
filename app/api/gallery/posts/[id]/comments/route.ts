import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { isRssAdmin } from '@/lib/rss-admin';
import { getSupabaseServer } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const reply = (body: unknown, status = 200) =>
    NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

const commentSchema = z.object({
    content: z.string().trim().min(1, '댓글 내용을 입력해 주세요.').max(1000, '댓글은 1000자 이내여야 합니다.'),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;

        // 1. 로그인 확인
        const user = await getChatGPTUser();
        if (!user || !user.userId) {
            return reply({ error: '로그인 후 댓글을 작성할 수 있습니다.' }, 401);
        }

        // 2. CSRF Same-Origin 검증
        const origin = req.headers.get('origin');
        const reqOrigin = new URL(req.url).origin;
        if (origin !== reqOrigin) {
            return reply({ error: '허용되지 않은 요청입니다.' }, 403);
        }

        const supabase = getSupabaseServer();
        const isAdmin = await isRssAdmin();

        // 3. 게시글 존재 확인
        const { data: post, error: findError } = await supabase
            .from('gallery_posts')
            .select('id')
            .eq('id', id)
            .maybeSingle();

        if (findError || !post) {
            return reply({ error: '게시글을 찾을 수 없습니다.' }, 404);
        }

        // 4. 입력값 파싱 (Zod)
        let bodyJson: unknown;
        try {
            bodyJson = await req.json();
        } catch {
            return reply({ error: '잘못된 입력입니다.' }, 400);
        }

        const parsed = commentSchema.safeParse(bodyJson);
        if (!parsed.success) {
            const firstErr = parsed.error.issues[0]?.message || '댓글 내용을 확인해 주세요.';
            return reply({ error: firstErr }, 400);
        }

        // 5. 작성자 이름 조회
        const { data: profile } = await supabase
            .from('profiles')
            .select('name')
            .eq('id', user.userId)
            .maybeSingle();

        const authorName = profile?.name || user.displayName || user.email?.split('@')[0] || '익명 회원';

        // 6. 댓글 저장
        const { data: comment, error: insertError } = await supabase
            .from('gallery_comments')
            .insert([{
                post_id: id,
                author_id: user.userId,
                author_name: authorName,
                content: parsed.data.content,
                is_admin_reply: isAdmin,
            }])
            .select()
            .single();

        if (insertError) {
            console.error('갤러리 댓글 저장 에러:', insertError.message);
            return reply({ error: '댓글 등록에 실패했습니다.' }, 500);
        }

        // 7. comment_count 정확한 count로 동기화
        const { count: exactComments } = await supabase
            .from('gallery_comments')
            .select('*', { count: 'exact', head: true })
            .eq('post_id', id);

        const comment_count = exactComments ?? 0;
        await supabase
            .from('gallery_posts')
            .update({ comment_count })
            .eq('id', id);

        return reply({
            comment,
            comment_count,
            message: '댓글이 등록되었습니다.',
        }, 201);
    } catch (err) {
        console.error('갤러리 댓글 작성 처리 에러:', err);
        return reply({ error: '댓글 작성 중 오류가 발생했습니다.' }, 500);
    }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const url = new URL(req.url);
        const commentId = url.searchParams.get('commentId')?.trim();

        if (!commentId) {
            return reply({ error: '삭제할 댓글 ID(commentId)가 필요합니다.' }, 400);
        }

        // 1. 로그인 확인
        const user = await getChatGPTUser();
        if (!user || !user.userId) {
            return reply({ error: '로그인이 필요합니다.' }, 401);
        }

        // 2. CSRF Same-Origin 검증
        const origin = req.headers.get('origin');
        const reqOrigin = url.origin;
        if (origin !== reqOrigin) {
            return reply({ error: '허용되지 않은 요청입니다.' }, 403);
        }

        const supabase = getSupabaseServer();
        const isAdmin = await isRssAdmin();

        // 3. 댓글 존재 확인
        const { data: comment, error: findError } = await supabase
            .from('gallery_comments')
            .select('*')
            .eq('id', commentId)
            .eq('post_id', id)
            .maybeSingle();

        if (findError || !comment) {
            return reply({ error: '삭제할 댓글을 찾을 수 없습니다.' }, 404);
        }

        // 4. 삭제 권한 확인 (댓글 작성자 또는 관리자)
        const isAuthor = comment.author_id === user.userId;
        if (!isAuthor && !isAdmin) {
            return reply({ error: '댓글을 삭제할 권한이 없습니다.' }, 403);
        }

        // 5. 댓글 삭제
        const { error: delError } = await supabase
            .from('gallery_comments')
            .delete()
            .eq('id', commentId)
            .eq('post_id', id);

        if (delError) {
            console.error('갤러리 댓글 삭제 에러:', delError.message);
            return reply({ error: '댓글 삭제에 실패했습니다.' }, 500);
        }

        // 6. comment_count 정확한 count로 동기화
        const { count: exactComments } = await supabase
            .from('gallery_comments')
            .select('*', { count: 'exact', head: true })
            .eq('post_id', id);

        const comment_count = exactComments ?? 0;
        await supabase
            .from('gallery_posts')
            .update({ comment_count })
            .eq('id', id);

        return reply({
            message: '댓글이 삭제되었습니다.',
            comment_count,
        });
    } catch (err) {
        console.error('갤러리 댓글 삭제 처리 에러:', err);
        return reply({ error: '댓글 삭제 중 오류가 발생했습니다.' }, 500);
    }
}
