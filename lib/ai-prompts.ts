import { getSupabaseServer } from './supabase';
import { INVESTMENT_PROMPT } from './investment-prompt';
import { TODAY_BRIEF_PROMPT } from './today-brief';

export const defaultPrompts = { summary: TODAY_BRIEF_PROMPT, analysis: INVESTMENT_PROMPT };

export async function readAiPrompts() {
    try {
        const supabase = getSupabaseServer();
        const { data: row } = await supabase.from('ai_prompts').select('*').eq('id', 'global').maybeSingle();
        return row ? {
            summary: row.summary,
            analysis: row.analysis,
            revision: row.revision,
            updatedAt: row.updated_at
        } : {
            ...defaultPrompts,
            revision: 0,
            updatedAt: null
        };
    } catch {
        return {
            ...defaultPrompts,
            revision: 0,
            updatedAt: null
        };
    }
}
