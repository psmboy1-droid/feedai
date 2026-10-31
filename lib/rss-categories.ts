import { getSupabaseServer } from './supabase';
import { catalogCategories } from './shared-catalog';
import { categoryKey } from './category-names';
export { categoryName, categoryKey } from './category-names';

export async function categoryConfig() {
    try {
        const supabase = getSupabaseServer();
        const { data: rows } = await supabase
            .from('shared_categories')
            .select('*')
            .order('created_at', { ascending: true })
            .order('name', { ascending: true });

        const categoryList = rows || [];
        const active = new Map<string, string>(catalogCategories.map(n => [categoryKey(n), n]));
        for (const r of categoryList) {
            if (r.deleted) active.delete(r.key);
            else active.set(r.key, r.name);
        }
        const redirects = new Map(categoryList.filter(r => r.deleted).map(r => [r.key, r.replacement]));
        const mapping: Record<string, string> = Object.create(null);
        for (const key of [...active.keys(), ...redirects.keys()]) {
            let current = key;
            const seen = new Set<string>();
            while (redirects.has(current) && !seen.has(current)) {
                seen.add(current);
                current = categoryKey(redirects.get(current)!);
            }
            mapping[key] = active.get(current) || [...active.values()][0] || '종합';
        }
        return { categories: [...active.values()], mapping };
    } catch {
        const active = new Map<string, string>(catalogCategories.map(n => [categoryKey(n), n]));
        const mapping: Record<string, string> = Object.create(null);
        for (const key of active.keys()) mapping[key] = active.get(key) || '종합';
        return { categories: [...active.values()], mapping };
    }
}

export async function listCategories() {
    return (await categoryConfig()).categories;
}
