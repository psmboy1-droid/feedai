import { isRssAdmin } from '../../../../lib/rss-admin';
import { readAiPrompts, defaultPrompts } from '../../../../lib/ai-prompts';
import { getSupabaseServer } from '../../../../lib/supabase';

export const dynamic = 'force-dynamic';
const reply = (data: unknown, status = 200) =>
    Response.json(data, {
        status,
        headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' }
    });

export async function GET() {
    if (!(await isRssAdmin())) return reply({ error: '관리자만 접근할 수 있습니다.' }, 403);
    try {
        return reply({ settings: await readAiPrompts(), defaults: defaultPrompts });
    } catch {
        return reply({ error: '프롬프트를 불러오지 못했습니다.' }, 503);
    }
}

export async function PUT(req: Request) {
    if (!(await isRssAdmin())) return reply({ error: '관리자만 접근할 수 있습니다.' }, 403);
    if (req.headers.get('origin') !== new URL(req.url).origin)
        return reply({ error: '허용되지 않은 요청입니다.' }, 403);
    try {
        const raw = await req.text();
        if (raw.length > 110000) return reply({ error: '입력이 너무 깁니다.' }, 400);
        let d;
        try {
            d = JSON.parse(raw);
        } catch {
            return reply({ error: '잘못된 입력입니다.' }, 400);
        }
        if (
            !d ||
            !Number.isSafeInteger(d.revision) ||
            d.revision < 0 ||
            !['summary', 'analysis'].every(
                k => typeof d[k] === 'string' && d[k].trim().length > 0 && d[k].length <= 50000
            )
        )
            return reply({ error: '각 프롬프트는 1~50,000자로 입력해 주세요.' }, 400);

        const values = {
            id: 'global',
            summary: d.summary.trim(),
            analysis: d.analysis.trim(),
            revision: d.revision + 1,
            updated_at: new Date().toISOString()
        };

        const supabase = getSupabaseServer();
        const { data: saved, error } = await supabase
            .from('ai_prompts')
            .upsert(values)
            .select()
            .single();

        if (error || !saved) {
            return reply(
                { error: '다른 창에서 설정이 변경되었습니다. 페이지를 새로고침한 후 다시 수정해 주세요.' },
                409
            );
        }

        const { id, ...settings } = saved;
        return reply({
            settings: {
                summary: settings.summary,
                analysis: settings.analysis,
                revision: settings.revision,
                updatedAt: settings.updated_at
            },
            message: '프롬프트를 저장했습니다. 새로 생성하는 AI 요약과 분석부터 적용됩니다.'
        });
    } catch {
        return reply({ error: '프롬프트를 저장하지 못했습니다.' }, 503);
    }
}
