import { getChatGPTUser } from '../app/chatgpt-auth';
import { getSupabaseServer } from './supabase';

/**
 * 🛡️ 관리자 권한(is_admin) 검증 함수
 * Supabase profiles 테이블의 is_admin 컬럼이 true인 경우에만 관리자로 인정합니다.
 */
export async function isRssAdmin(): Promise<boolean> {
    try {
        const user = await getChatGPTUser();
        if (!user || !user.userId) return false;

        const supabase = getSupabaseServer();
        const { data, error } = await supabase
            .from('profiles')
            .select('is_admin')
            .eq('id', user.userId)
            .maybeSingle();

        if (error) {
            console.error('관리자 권한 조회 실패:', error.message);
            return false;
        }

        return data?.is_admin === true;
    } catch (error) {
        return false;
    }
}

/**
 * 이메일 기반 관리자 확인 (호환용)
 */
export async function isAdminEmail(email: string | null | undefined): Promise<boolean> {
    if (!email) return false;
    try {
        const supabase = getSupabaseServer();
        const { data: authData } = await supabase.auth.admin.listUsers();
        const targetUser = authData?.users?.find(u => u.email === email);
        if (!targetUser) return false;

        const { data } = await supabase
            .from('profiles')
            .select('is_admin')
            .eq('id', targetUser.id)
            .maybeSingle();

        return data?.is_admin === true;
    } catch {
        return false;
    }
}
