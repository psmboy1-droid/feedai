import { getSupabaseServer } from './supabase';
import { defaultSeo, seoSchema, type SeoSettings } from './seo-config';

export async function readSeo() {
    try {
        const supabase = getSupabaseServer();
        const { data: row } = await supabase.from('seo_settings').select('*').eq('id', 'site').maybeSingle();
        return {
            settings: row ? seoSchema.parse(JSON.parse(row.settings)) : defaultSeo,
            updatedAt: row?.updated_at || null
        };
    } catch {
        return { settings: defaultSeo, updatedAt: null };
    }
}

export async function publicSeo() {
    try {
        return (await readSeo()).settings;
    } catch {
        return defaultSeo;
    }
}

export async function saveSeo(settings: SeoSettings) {
    const now = new Date().toISOString();
    const supabase = getSupabaseServer();
    await supabase.from('seo_settings').upsert({
        id: 'site',
        settings: JSON.stringify(settings),
        updated_at: now
    });
    return now;
}
