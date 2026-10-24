import { GET } from '../../app/api/feed/route';
import { queuedAi } from '../../lib/ai-queue';
import { reserveToken, refundToken } from '../../lib/analysis-tokens';
import { sharedFeed as one } from '../../lib/shared-feed-cache';
import { sharedFeed as other } from '../../lib/shared-feed-cache.ts?isolate=two';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const sql = new DatabaseSync(':memory:');
let reads = 0, writes = 0, dbMs = 0;
for (const f of readdirSync('./drizzle').filter(x => x.endsWith('.sql')).sort())
    sql.exec(readFileSync('./drizzle/' + f, 'utf8'));
let batchTail = Promise.resolve();
const db = { prepare(query) { return { args: [], bind(...args) { this.args = args; return this; }, async first() { reads++; const t = performance.now(); const row = sql.prepare(query).get(...this.args); dbMs += performance.now() - t; return row || null; }, async all() { reads++; const t = performance.now(); const results = sql.prepare(query).all(...this.args); dbMs += performance.now() - t; return { results, success: true, meta: {} }; }, async run() { writes++; const t = performance.now(); const r = sql.prepare(query).run(...this.args); dbMs += performance.now() - t; return { success: true, meta: { changes: r.changes } }; }, async raw() { reads++; return sql.prepare(query).all(...this.args).map(r => Object.values(r)); } }; }, async batch(statements) { const previous = batchTail; let release; batchTail = new Promise(r => release = r); await previous; sql.exec('BEGIN'); try {
        const r = [];
        for (const s of statements)
            r.push(await s.run());
        sql.exec('COMMIT');
        return r;
    }
    catch (e) {
        sql.exec('ROLLBACK');
        throw e;
    }
    finally {
        release();
    } } };
globalThis.TEST_ENV = { DB: db };
process.env.OPENAI_API_KEY = 'mock-only';
async function moduleOf(path) { const m = await import(path); return m.default || m; }
async function main() {
    let upstreamCalls = 0, aiStarts = 0;
    let finish = false;
    let clock = Date.now();
    const realNow = Date.now;
    Date.now = () => clock;
    globalThis.fetch = async (input, init) => { const url = String(input); if (url.includes('api.openai.com')) {
        if (init?.method === 'POST') {
            aiStarts++;
            return Response.json({ id: 'resp_mock_' + aiStarts, status: 'in_progress', created_at: Date.now() / 1000 });
        }
        return Response.json({ id: url.split('/').pop(), status: finish ? 'completed' : 'in_progress', output: [] });
    } upstreamCalls++; await new Promise(r => setTimeout(r, 5)); return new Response(`<rss><channel><title>test</title><item><title>news</title><link>https://example.com/a</link><pubDate>${new Date(Date.now()).toUTCString()}</pubDate></item></channel></rss>`); };
    for (const n of [100, 1000, 10000]) {
        upstreamCalls = 0;
        const latencies = [];
        const start = performance.now(), before = dbMs;
        const rs = await Promise.all(Array.from({ length: n }, async () => { const t = performance.now(); const r = await GET(new Request('https://test.example/api/feed?url=' + encodeURIComponent('https://example.com/rss-' + n))); const body=await r.json();assert.equal(body.items.length,1,'Recent RSS article must survive shared-cache filtering'); latencies.push(performance.now() - t); return r.status; }));
        latencies.sort((a, b) => a - b);
        assert(rs.every(s => s === 200));
        assert.equal(upstreamCalls, 1);
        console.log(JSON.stringify({ scenario: 'same-feed-cold', clients: n, upstreamCalls, errors: 0, totalMs: Math.round(performance.now() - start), p95Ms: Math.round(latencies[Math.floor(n * .95)]), sqliteMs: Number((dbMs - before).toFixed(2)) }));
    }
    // A second module instance bypasses isolate-local caches and exercises the D1 lock.
    let cross = 0;
    const load = async () => { cross++; await new Promise(r => setTimeout(r, 20)); return Response.json({ items: [] }); };
    await Promise.all([one('https://example.com/cross', load), other('https://example.com/cross', load)]);
    assert.equal(cross, 1);
    const jobs = [];
    for (let i = 0; i < 30; i++) {
        const job = await queuedAi('user' + i, '', { model: 'mock', input: 'test' });
        jobs.push(job);
        sql.prepare("INSERT INTO analysis_requests(id,user_id,request_hash,claim,status,job_id,created_at) VALUES (?,?,?,?,'queued',?,?)").run('test' + i, 'user' + i, 'hash', 'claim', job.id, new Date().toISOString());
    }
    for (let i = 0; i < 15; i++) {
        await queuedAi('user' + i, '/' + jobs[i].id);
        clock += 1010;
    }
    assert.equal(aiStarts, 10);
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM ai_queue WHERE status='in_progress'").get().n, 10);
    await assert.rejects(() => queuedAi('wrong', '/' + jobs[0].id));
    finish = true;
    sql.exec("UPDATE ai_queue SET check_after=0");
    clock += 1010;
    await queuedAi('user0', '/' + jobs[0].id);
    assert(aiStarts <= 11);
    process.env.AI_MAX_CONCURRENT = '100';
    for (let i = 0; i < 25; i++) {
        clock += 1010;
        await queuedAi('user29', '/' + jobs[29].id);
    }
    assert.equal(aiStarts, 20);
    clock += 60001;
    await queuedAi('user29', '/' + jobs[29].id);
    assert.equal(aiStarts, 21);
    Date.now = realNow;
    const ticket = await reserveToken('token-user', crypto.randomUUID(), 'hash');
    assert(ticket.claimed);
    await Promise.all([refundToken(ticket.row.id, 'token-user'), refundToken(ticket.row.id, 'token-user')]);
    assert.equal(sql.prepare("SELECT tokens FROM news_accounts WHERE user_id='token-user'").get().tokens, 100);
    sql.prepare("INSERT INTO news_accounts(user_id,state,created_at,updated_at) VALUES ('patch',?,?,?)").run(JSON.stringify({ feeds: [{ id: 'preserved' }], read: [], saved: [] }), 'now', 'now');
    sql.prepare("UPDATE news_accounts SET state=json_set(state,?,json(?)),revision=revision+1 WHERE user_id=? AND revision=?").run('$.read', JSON.stringify(['url']), 'patch', 0);
    assert.deepEqual(JSON.parse(String(sql.prepare("SELECT state FROM news_accounts WHERE user_id='patch'").get().state)).feeds, [{ id: 'preserved' }]);
    await queuedAi('owner-limit','',{input:'one'});await queuedAi('owner-limit','',{input:'two'});await assert.rejects(()=>queuedAi('owner-limit','',{input:'three'}));
let rejected=0;for(let i=0;i<1100;i++){try{await queuedAi('burst'+i,'',{input:'bounded'})}catch{rejected++}}assert(rejected>0);assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM ai_queue WHERE status='waiting'").get().n,1000);
let errorFetches=0;const errorLoad=async()=>{errorFetches++;return Response.json({error:'mock source failure'},{status:400})};assert.equal((await one('https://example.com/error',errorLoad)).status,400);assert.equal((await one('https://example.com/error',errorLoad)).status,400);assert.equal(errorFetches,1);
console.log(JSON.stringify({ crossIsolateRSSFetches: cross, globalConcurrencyLimit: 10, aiStartsBeforeCompletion: 10, startsPerMinuteLimit: 20, ownershipCheck: 'passed', refundOnce: 'passed', partialUpdate: 'passed', reads, writes }));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
