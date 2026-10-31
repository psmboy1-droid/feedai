import { getSupabaseServer } from './supabase';
import { resolveApiKey } from './ai-key';

type Job = {
    id: string;
    owner: string;
    status: string;
    body: string;
    upstream_id: string;
    response: string;
    created_at: number;
    started_at: number;
    check_after: number;
    lease_until: number;
};

const terminal = ['completed', 'failed', 'cancelled', 'incomplete'];

function limit(name: string, fallback: number, max: number) {
    const n = Number(process.env[name]);
    return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}

async function upstream(path: string, body?: unknown) {
    const key = await resolveApiKey();
    const r = await fetch('https://api.openai.com/v1/responses' + path, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(25000)
    });
    if (!r.ok) {
        await r.body?.cancel();
        const error = Object.assign(Error('AI 서비스 응답 오류 (' + r.status + ')'), { definitive: true });
        throw error;
    }
    return r.json() as Promise<any>;
}

const failed = (id: string) => ({
    id,
    status: 'failed',
    error: { message: 'AI 요청이 실패했거나 처리 시간을 초과했습니다.' }
});
let nextDispatch = 0;

async function check(row: Job) {
    const supabase = getSupabaseServer();
    const now = Date.now();
    try {
        await supabase
            .from('ai_queue')
            .update({ check_after: now + 15000, lease_until: now + 30000 })
            .eq('id', row.id);

        const data = await upstream('/' + encodeURIComponent(row.upstream_id));
        const status = terminal.includes(data.status)
            ? data.status
            : data.status === 'queued'
            ? 'queued_upstream'
            : 'in_progress';
        await supabase
            .from('ai_queue')
            .update({
                status,
                response: JSON.stringify(data),
                lease_until: 0
            })
            .eq('id', row.id);
    } catch {
        await supabase.from('ai_queue').update({ lease_until: 0 }).eq('id', row.id);
    }
}

async function maintain() {
    const now = Date.now();
    if (now < nextDispatch) return;
    nextDispatch = now + 1000;

    const supabase = getSupabaseServer();

    try {
        const { data: due } = await supabase
            .from('ai_queue')
            .select('*')
            .in('status', ['in_progress', 'queued_upstream'])
            .lte('check_after', now)
            .lt('lease_until', now)
            .order('check_after', { ascending: true })
            .limit(2);

        if (due) {
            for (const job of due as Job[]) {
                await check(job);
            }
        }

        await supabase
            .from('ai_queue')
            .update({ status: 'failed', body: '' })
            .eq('status', 'waiting')
            .lt('created_at', now - 3600000);

        const { data: candidates } = await supabase
            .from('ai_queue')
            .select('*')
            .eq('status', 'waiting')
            .order('created_at', { ascending: true })
            .limit(1);

        if (!candidates || candidates.length === 0) return;
        const candidate = candidates[0] as Job;

        await supabase
            .from('ai_queue')
            .update({ status: 'starting', started_at: now, lease_until: now + 30000 })
            .eq('id', candidate.id);

        try {
            const data = await upstream('', JSON.parse(candidate.body));
            if (!/^resp_[a-zA-Z0-9_-]{1,200}$/.test(data.id || '')) throw Error('Invalid AI response');
            const status = terminal.includes(data.status)
                ? data.status
                : data.status === 'queued'
                ? 'queued_upstream'
                : 'in_progress';
            await supabase
                .from('ai_queue')
                .update({
                    status,
                    upstream_id: data.id,
                    response: JSON.stringify(data),
                    body: '',
                    check_after: Date.now() + 15000,
                    lease_until: 0
                })
                .eq('id', candidate.id);
        } catch (e) {
            const definitive = Boolean((e as { definitive?: boolean }).definitive);
            await supabase
                .from('ai_queue')
                .update({
                    status: definitive ? 'failed' : 'starting',
                    response: JSON.stringify(definitive ? failed(candidate.id) : { id: candidate.id, status: 'in_progress' }),
                    body: ''
                })
                .eq('id', candidate.id);
        }
    } catch {}
}

export async function queuedAi(owner: string, path: string, body?: unknown) {
    const supabase = getSupabaseServer();

    if (body) {
        const id = 'queue_' + crypto.randomUUID().replaceAll('-', '');
        const { error } = await supabase.from('ai_queue').insert({
            id,
            owner,
            status: 'waiting',
            body: JSON.stringify(body),
            created_at: Date.now()
        });
        if (error) throw Error('AI 대기열이 가득 찼거나 진행 중인 요청이 있습니다. 잠시 후 다시 시도해 주세요.');
        return { id, status: 'queued', created_at: Date.now() / 1000 };
    }

    const id = decodeURIComponent(path.replace(/^\//, ''));
    if (!id.startsWith('queue_')) return upstream(path);

    let { data: row } = await supabase.from('ai_queue').select('*').eq('id', id).eq('owner', owner).maybeSingle();
    if (!row) throw Error('AI 요청을 찾을 수 없습니다.');

    await maintain();
    const { data: updatedRow } = await supabase
        .from('ai_queue')
        .select('*')
        .eq('id', id)
        .eq('owner', owner)
        .maybeSingle();
    row = updatedRow || row;

    if (row.status === 'uncertain') return failed(id);
    if (terminal.includes(row.status))
        return row.response ? { ...JSON.parse(row.response), id, status: row.status } : failed(id);
    if (row.upstream_id && (row.check_after || 0) <= Date.now()) await check(row as Job);

    const { data: latestRow } = await supabase
        .from('ai_queue')
        .select('*')
        .eq('id', id)
        .eq('owner', owner)
        .maybeSingle();
    row = latestRow || row;

    if (terminal.includes(row.status))
        return row.response ? { ...JSON.parse(row.response), id, status: row.status } : failed(id);

    return row.response
        ? { ...JSON.parse(row.response), id, status: row.status === 'waiting' ? 'queued' : 'in_progress' }
        : {
              id,
              status: row.status === 'waiting' ? 'queued' : 'in_progress',
              created_at: (row.created_at || Date.now()) / 1000
          };
}

export async function processAiQueue() {
    await maintain();
}
