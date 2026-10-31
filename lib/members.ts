import { getSupabaseServer } from './supabase';

export async function isDeletedMember(userId: string) {
    try {
        const supabase = getSupabaseServer();
        const { data } = await supabase
            .from('news_accounts')
            .select('deleted_at')
            .eq('user_id', userId)
            .maybeSingle();

        return Boolean(data?.deleted_at);
    } catch {
        return false;
    }
}

export async function touchMember(user: { userId: string; displayName: string; email: string }) {
    try {
        const supabase = getSupabaseServer();
        const now = new Date().toISOString();

        const { data: existing } = await supabase
            .from('news_accounts')
            .select('user_id, display_name, email, deleted_at')
            .eq('user_id', user.userId)
            .maybeSingle();

        if (!existing) {
            await supabase.from('news_accounts').insert({
                user_id: user.userId,
                display_name: user.displayName,
                email: user.email,
                state: JSON.stringify({ feeds: [], saved: [], read: [] }),
                created_at: now,
                updated_at: now
            });
        } else if (!existing.deleted_at && (existing.email !== user.email || !existing.display_name)) {
            await supabase.from('news_accounts').update({
                display_name: existing.display_name || user.displayName,
                email: user.email,
                updated_at: now
            }).eq('user_id', user.userId);
        }
    } catch (e) {
        console.error('touchMember Supabase 에러:', e);
    }
}
