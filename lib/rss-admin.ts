import { getChatGPTUser } from '../app/chatgpt-auth';
import { createClient } from '@supabase/supabase-js';

const getAdminSupabase = () => createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function isAdminEmail(email: string | null | undefined): Promise<boolean> {
    if (!email) return false;
    try {
        const supabase = getAdminSupabase();
        const { data: authData } = await supabase.auth.admin.listUsers();
        const targetUser = authData.users.find(u => u.email === email);
        if (!targetUser) return false;

        const { data } = await supabase
            .from('profiles')
            .select('is_admin')
            .eq('id', targetUser.id)
            .single();

        return data?.is_admin === true;
    } catch {
        return false;
    }
}

export async function isRssAdmin(): Promise<boolean> {
    try {
        // [정석 아키텍처] 1. 로컬 개발 환경(PC) 전용 하이패스
        // 로컬에서는 ChatGPT 세션이 null이 되므로, 실서버 DB를 오염시키지 않고 개발할 수 있도록 권한을 부여합니다.
        if (process.env.NODE_ENV === 'development') {
            console.log('💡 [로컬 개발 모드] 관리자 권한 자동 부여 (실서버 영향 0%)');
            return true;
        }

        // [정석 아키텍처] 2. 실서버(Linux) 환경
        // 실서버에 배포되는 순간 위 코드는 무시되고, 오직 실제 유저와 Supabase DB만을 철저하게 검증합니다.
        const user = await getChatGPTUser();
        if (!user || !user.email) return false; 

        return await isAdminEmail(user.email);
    } catch (error) {
        return false;
    }
}