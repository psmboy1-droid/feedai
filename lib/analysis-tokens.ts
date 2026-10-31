import { membership } from './membership';
import { getSupabaseServer } from './supabase';

export type Ticket = {
    id: string;
    user_id: string;
    request_hash: string;
    claim: string;
    status: string;
    job_id: string;
    result: string;
    created_at: string;
};

export async function ensureTokenAccount(userId: string) {
    const supabase = getSupabaseServer();
    const now = new Date().toISOString();

    const { data: exists } = await supabase
        .from('news_accounts')
        .select('user_id')
        .eq('user_id', userId)
        .maybeSingle();

    if (!exists) {
        await supabase.from('news_accounts').insert({
            user_id: userId,
            state: JSON.stringify({ feeds: [], saved: [], read: [] }),
            tokens: 100,
            created_at: now,
            updated_at: now
        });
    }

    const twoMinutesAgo = new Date(Date.now() - 120000).toISOString();
    const { data: expired } = await supabase
        .from('analysis_requests')
        .select('id')
        .eq('user_id', userId)
        .eq('status', 'reserved')
        .lt('created_at', twoMinutesAgo);

    if (expired && expired.length > 0) {
        for (const row of expired) {
            await refundToken(row.id, userId);
        }
    }
}

export async function tokenBalance(userId: string) {
    try {
        await membership(userId);
    } catch {}
    const supabase = getSupabaseServer();
    const { data: row } = await supabase
        .from('news_accounts')
        .select('tokens')
        .eq('user_id', userId)
        .maybeSingle();

    return row?.tokens ?? 0;
}

export async function ticket(id: string, userId: string): Promise<Ticket | null> {
    const supabase = getSupabaseServer();
    const { data } = await supabase
        .from('analysis_requests')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();
    return data;
}

export async function reserveToken(userId: string, requestId: string, requestHash: string) {
    await ensureTokenAccount(userId);
    try {
        await membership(userId);
    } catch {}

    const supabase = getSupabaseServer();
    const id = userId + ':' + requestId;
    const claim = crypto.randomUUID();
    const now = new Date().toISOString();

    const { data: account } = await supabase
        .from('news_accounts')
        .select('tokens, deleted_at')
        .eq('user_id', userId)
        .maybeSingle();

    if (!account || account.deleted_at || (account.tokens ?? 0) <= 0) {
        return { row: null, claimed: false };
    }

    const { data: activeReserved } = await supabase
        .from('analysis_requests')
        .select('id')
        .eq('user_id', userId)
        .eq('status', 'reserved')
        .maybeSingle();

    if (activeReserved) {
        return { row: null, claimed: false };
    }

    const { error: insertErr } = await supabase
        .from('analysis_requests')
        .insert({
            id,
            user_id: userId,
            request_hash: requestHash,
            claim,
            status: 'reserved',
            created_at: now
        });

    if (insertErr) {
        const existing = await ticket(id, userId);
        return { row: existing, claimed: existing?.claim === claim };
    }

    await supabase
        .from('news_accounts')
        .update({
            tokens: Math.max(0, (account.tokens ?? 0) - 1),
            updated_at: now
        })
        .eq('user_id', userId);

    const row = await ticket(id, userId);
    return { row, claimed: row?.claim === claim };
}

export async function refundToken(id: string, userId: string) {
    try {
        await membership(userId);
    } catch {}

    const supabase = getSupabaseServer();
    const { data: currentReq } = await supabase
        .from('analysis_requests')
        .select('status')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();

    if (currentReq && ['reserved', 'queued', 'in_progress'].includes(currentReq.status)) {
        await supabase
            .from('analysis_requests')
            .update({ status: 'refunded' })
            .eq('id', id)
            .eq('user_id', userId);

        const { data: account } = await supabase
            .from('news_accounts')
            .select('tokens')
            .eq('user_id', userId)
            .maybeSingle();

        if (account) {
            await supabase
                .from('news_accounts')
                .update({
                    tokens: (account.tokens ?? 0) + 1,
                    updated_at: new Date().toISOString()
                })
                .eq('user_id', userId);
        }
    }
}

export async function saveTicket(id: string, userId: string, jobId: string, status: string, result = '') {
    const supabase = getSupabaseServer();
    await supabase
        .from('analysis_requests')
        .update({
            job_id: jobId,
            status,
            result
        })
        .eq('id', id)
        .eq('user_id', userId)
        .neq('status', 'refunded');
}

export async function jobTicket(jobId: string, userId: string): Promise<Ticket | null> {
    const supabase = getSupabaseServer();
    const { data } = await supabase
        .from('analysis_requests')
        .select('*')
        .eq('job_id', jobId)
        .eq('user_id', userId)
        .maybeSingle();
    return data;
}
