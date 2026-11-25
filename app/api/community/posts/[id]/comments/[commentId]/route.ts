import { NextRequest, NextResponse } from 'next/server';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { isRssAdmin } from '@/lib/rss-admin';
import { getSupabaseServer } from '@/lib/supabase';
import { isSameOrigin } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

const reply = (body: unknown, status = 200) =>
    NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string; commentId: string }> }
) {
    try {
        const { id, commentId } = await params;

        // 1. 로그인 확인
        const user = await getChatGPTUser();
        if (!user || !user.userId) {
            return reply({ error: '로그인이 필요합니다.' }, 401);
        }

        // 2. CSRF Same-Origin 검증
        if (!isSameOrigin(req)) {
            return reply({ error: '허용되지 않은 요청입니다.' }, 403);
        }

        const supabase = getSupabaseServer();
        const isAdmin = await isRssAdmin();

        // 3. 댓글 존재 확인
        const { data: comment, error: findError } = await supabase
            .from('community_comments')
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
        await supabase
            .from('community_comments')
            .delete()
            .eq('id', commentId);

        // 6. comment_count 정확한 count로 동기화
        const { count: commentCount } = await supabase
            .from('community_comments')
            .select('*', { count: 'exact', head: true })
            .eq('post_id', id);

        const newCount = commentCount ?? 0;
        await supabase
            .from('community_posts')
            .update({ comment_count: newCount })
            .eq('id', id);

        return reply({
            message: '댓글이 삭제되었습니다.',
            commentCount: newCount,
        });
    } catch (err) {
        console.error('댓글 삭제 처리 에러:', err);
        return reply({ error: '댓글 삭제 중 오류가 발생했습니다.' }, 500);
    }
}
