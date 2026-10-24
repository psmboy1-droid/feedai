import {eq} from 'drizzle-orm';
import {getDb} from '../db';
import {aiPrompts} from '../db/schema';
import {INVESTMENT_PROMPT} from './investment-prompt';
import {TODAY_BRIEF_PROMPT} from './today-brief';
export const defaultPrompts={summary:TODAY_BRIEF_PROMPT,analysis:INVESTMENT_PROMPT};
export async function readAiPrompts(){const [row]=await getDb().select().from(aiPrompts).where(eq(aiPrompts.id,'global'));return row?{summary:row.summary,analysis:row.analysis,revision:row.revision,updatedAt:row.updatedAt}:{...defaultPrompts,revision:0,updatedAt:null}}
