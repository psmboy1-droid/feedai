-- ─────────────────────────────────────────────────────────────
-- FeedAI Community Schema (PostgreSQL / Supabase)
-- ─────────────────────────────────────────────────────────────

-- 1. community_posts 테이블
CREATE TABLE IF NOT EXISTS public.community_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    board_type VARCHAR(20) NOT NULL, -- 'free', 'suggestions'
    title VARCHAR(150) NOT NULL,
    content TEXT NOT NULL,
    image_urls JSONB DEFAULT '[]'::jsonb,
    video_url TEXT,
    author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    author_name VARCHAR(100) NOT NULL,
    is_secret BOOLEAN DEFAULT false,
    is_notice BOOLEAN DEFAULT false,
    status VARCHAR(20) DEFAULT 'received', -- 'received', 'reviewing', 'completed', 'hold'
    view_count INTEGER DEFAULT 0,
    like_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_community_posts_board ON public.community_posts (board_type, is_notice DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_posts_author ON public.community_posts (author_id);

-- 2. community_comments 테이블
CREATE TABLE IF NOT EXISTS public.community_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    author_name VARCHAR(100) NOT NULL,
    content TEXT NOT NULL,
    is_admin_reply BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_community_comments_post ON public.community_comments (post_id, created_at ASC);

-- 3. community_likes 테이블
CREATE TABLE IF NOT EXISTS public.community_likes (
    post_id UUID NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (post_id, user_id)
);

-- 4. 조회수 증가 RPC 함수
CREATE OR REPLACE FUNCTION increment_community_view(post_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE public.community_posts
    SET view_count = view_count + 1
    WHERE id = post_id;
END;
$$ LANGUAGE plpgsql;
