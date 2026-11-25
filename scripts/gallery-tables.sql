-- ─────────────────────────────────────────────────────────────
-- FeedAI Gallery Schema (PostgreSQL / Supabase)
-- ─────────────────────────────────────────────────────────────

-- 1. gallery_posts 테이블
CREATE TABLE IF NOT EXISTS public.gallery_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(20) NOT NULL, -- 'humor', 'ai', 'info', 'daily'
    title VARCHAR(150) NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    image_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
    author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    author_name VARCHAR(100) NOT NULL,
    view_count INTEGER NOT NULL DEFAULT 0,
    like_count INTEGER NOT NULL DEFAULT 0,
    comment_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gallery_posts_created ON public.gallery_posts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gallery_posts_category_created ON public.gallery_posts (category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gallery_posts_author ON public.gallery_posts (author_id);

-- 2. gallery_comments 테이블
CREATE TABLE IF NOT EXISTS public.gallery_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES public.gallery_posts(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    author_name VARCHAR(100) NOT NULL,
    content TEXT NOT NULL,
    is_admin_reply BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gallery_comments_post ON public.gallery_comments (post_id, created_at ASC);

-- 3. gallery_likes 테이블
CREATE TABLE IF NOT EXISTS public.gallery_likes (
    post_id UUID NOT NULL REFERENCES public.gallery_posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, user_id)
);

-- 4. RLS(Row Level Security) 활성화 및 기본 정책
ALTER TABLE public.gallery_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gallery_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gallery_likes ENABLE ROW LEVEL SECURITY;

-- 누구나 읽기 가능 (서버 API는 Service Role Key를 통해 쓰기/삭제 처리)
DROP POLICY IF EXISTS "Public read gallery_posts" ON public.gallery_posts;
CREATE POLICY "Public read gallery_posts"
    ON public.gallery_posts FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Public read gallery_comments" ON public.gallery_comments;
CREATE POLICY "Public read gallery_comments"
    ON public.gallery_comments FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Public read gallery_likes" ON public.gallery_likes;
CREATE POLICY "Public read gallery_likes"
    ON public.gallery_likes FOR SELECT
    USING (true);

-- 5. 조회수 증가 RPC 함수
CREATE OR REPLACE FUNCTION increment_gallery_view(p_post_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE public.gallery_posts
    SET view_count = view_count + 1
    WHERE id = p_post_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
