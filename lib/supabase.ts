import { createClient } from '@supabase/supabase-js';

// 이제 진짜 열쇠가 무엇인지 알았으니 다시 환경변수로 안전하게 가려줍니다!
export const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);