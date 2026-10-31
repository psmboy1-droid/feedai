import { getSupabaseServer } from './supabase';
import { PLANS, effectivePlan, creditPeriod, creditDate, accruedCreditPeriods, type Membership } from './plans';

export async function membership(userId: string) {
    const supabase = getSupabaseServer();
    const { data: row } = await supabase
        .from('news_accounts')
        .select('state, tokens, member_revision, deleted_at')
        .eq('user_id', userId)
        .maybeSingle();

    if (!row || row.deleted_at) {
        throw Error('회원 계정을 찾을 수 없습니다.');
    }

    let stateObj: any = {};
    try {
        stateObj = typeof row.state === 'string' ? JSON.parse(row.state) : (row.state || {});
    } catch {
        stateObj = {};
    }

    const raw = stateObj._membership as Membership | undefined;
    const plan = effectivePlan(raw);
    const now = Date.now();
    const expiry = Date.parse(raw?.expiresAt || '');
    const end = new Date(expiry + 9 * 3600000);
    const today = new Date(now + 9 * 3600000);
    const months = Number.isFinite(expiry)
        ? Math.max(1, (end.getUTCFullYear() - today.getUTCFullYear()) * 12 + end.getUTCMonth() - today.getUTCMonth() + 1)
        : 1;
    const legacyAnchor = Number.isFinite(expiry) ? new Date(creditDate(expiry, -months)).toISOString() : new Date(now).toISOString();
    const period = creditPeriod(raw?.creditAnchor || legacyAnchor, now);
    const changed = !raw || raw.plan !== plan;
    const grant = raw ? accruedCreditPeriods(raw, now) * PLANS[raw.plan].credits : 0;
    const renew = !!raw?.creditPeriodEnd && Date.parse(raw.creditPeriodEnd) <= now;

    if (changed || !raw?.creditPeriodEnd || renew) {
        const next: Membership = {
            plan,
            expiresAt: plan === 'free' ? '' : (raw?.expiresAt || ''),
            creditMonth: '',
            ...period
        };
        stateObj._membership = next;

        const updateData: any = {
            state: JSON.stringify(stateObj),
            member_revision: (row.member_revision || 0) + 1,
            updated_at: new Date().toISOString()
        };

        if (!raw) {
            updateData.tokens = 0;
        } else if (grant > 0) {
            updateData.tokens = (row.tokens || 0) + grant;
        }

        await supabase
            .from('news_accounts')
            .update(updateData)
            .eq('user_id', userId);

        return { ...next, limits: PLANS[plan] };
    }

    return { ...raw, limits: PLANS[plan] };
}
