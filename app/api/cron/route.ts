import { NextResponse } from 'next/server';
import { getSupabaseServer } from '../../../lib/supabase';
import Parser from 'rss-parser';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';

const supabase = getSupabaseServer();
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const parser = new Parser({
    customFields: { item: ['enclosure', 'content', 'contentSnippet', 'description'] }
});

function extractCleanBody(item: any): string {
    const raw = item.contentSnippet || item.content || item.description || '';
    return raw
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]*>?/gm, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 350);
}

export async function GET(req: Request) {
    // 💡 보안: 외부에서 무단 호출로 AI 요금 과금을 방지하기 위해 CRON_SECRET을 다각도로 검증 (Bearer / x-cron-secret / Query ?key=)
    const secret = process.env.CRON_SECRET;
    const { searchParams } = new URL(req.url);
    const authHeader = req.headers.get('authorization');
    const bearerKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const headerKey = req.headers.get('x-cron-secret');
    const queryKey = searchParams.get('key');
    const providedKey = bearerKey || headerKey || queryKey;

    if (!secret || providedKey !== secret) {
        return new Response('Unauthorized', { status: 401 });
    }

    try {
        // 1. 활성화된 시그널과 유저 텔레그램 설정을 각각 안전하게 조회
        const [{ data: signals, error: sigErr }, { data: allSettings, error: setErr }] = await Promise.all([
            supabase.from('rss_signals').select('*').eq('is_active', true),
            supabase.from('user_settings').select('user_id, telegram_chat_id')
        ]);

        if (sigErr || setErr || !signals) throw new Error('DB 조회 실패');

        const chatIdMap: Record<string, string> = {};
        if (allSettings) {
            allSettings.forEach(s => {
                if (s.user_id && s.telegram_chat_id) chatIdMap[s.user_id] = s.telegram_chat_id;
            });
        }

        // 2. 프롬프트 공통코드 캐싱
        const { data: prompts } = await supabase
            .from('common_codes')
            .select('code_value, ref_value')
            .eq('group_code', 'AI_PROMPT');
        const promptMap: Record<string, string> = {};
        if (prompts) prompts.forEach(p => (promptMap[p.code_value] = p.ref_value));

        const now = new Date();
        let sentCount = 0;

        for (const sig of signals) {
            const chatId = chatIdMap[sig.user_id];
            if (!chatId) continue;

            const freqMins = parseInt(sig.frequency, 10) || 360;
            const lastFired = sig.last_fired_at ? new Date(sig.last_fired_at) : new Date(0);

            // 설정된 주기가 아직 안 지났으면 패스
            if ((now.getTime() - lastFired.getTime()) / 60000 < freqMins) continue;

            try {
                const feed = await parser.parseURL(sig.feed_url);
                const allItems = feed.items || [];
                if (allItems.length === 0) continue;

                // 🚀 마지막 발송 시간(lastFired) 이후에 새로 올라온 글만 골라냄 (중복 발송 방지, 최대 3건)
                const newArticles = allItems
                    .filter(item => {
                        const pubDate = item.isoDate || item.pubDate;
                        if (!pubDate) return false;
                        return new Date(pubDate).getTime() > lastFired.getTime();
                    })
                    .slice(0, 3);

                // 새로 올라온 글이 없다면 발송하지 않고 점검 시각만 갱신한 뒤 패스
                if (newArticles.length === 0) {
                    await supabase
                        .from('rss_signals')
                        .update({ last_fired_at: now.toISOString() })
                        .eq('id', sig.id);
                    continue;
                }

                const basePrompt =
                    promptMap[sig.ai_prompt_code] ||
                    promptMap['DEFAULT'] ||
                    '다음 게시물들의 제목과 본문을 읽고 핵심 내용을 3줄로 요약해 줘.';
                const finalPrompt =
                    sig.ai_prompt_code === 'CUSTOM' && sig.custom_prompt ? sig.custom_prompt : basePrompt;

                let aiSummary = 'AI 요약본 생성 실패';
                try {
                    const articlesText = newArticles
                        .map((a, idx) => `[게시물 ${idx + 1}]\n제목: ${a.title || ''}\n본문: ${extractCleanBody(a)}`)
                        .join('\n\n');

                    const promptContent = `${finalPrompt}\n\n${articlesText}`;
                    const aiResponse = await openai.chat.completions.create({
                        model: 'gpt-4o-mini',
                        messages: [{ role: 'user', content: promptContent }],
                        max_tokens: 350,
                        temperature: 0.5
                    });
                    aiSummary = aiResponse.choices[0].message.content || aiSummary;
                } catch (e) {
                    console.error('Cron AI Error:', e);
                }

                const sourceName = sig.category_name || feed.title;
                let message = `📰 <b>[AI 자동 브리핑] ${sourceName} (신규 ${newArticles.length}건)</b>\n\n💡 <b>AI 리포트</b>\n${aiSummary}\n\n🔗 <b>원문 링크</b>\n`;
                newArticles.forEach((item, idx) => {
                    message += `${idx + 1}. <a href="${item.link}">${item.title}</a>\n`;
                });

                let firstImageUrl = null;
                for (const item of newArticles) {
                    if (item.enclosure?.url) {
                        firstImageUrl = item.enclosure.url;
                        break;
                    }
                    const htmlContent = (item as any).content || (item as any).description || '';
                    const imgMatch = htmlContent.match(/<img[^>]+src="([^">]+)"/);
                    if (imgMatch) {
                        firstImageUrl = imgMatch[1];
                        break;
                    }
                }

                if (firstImageUrl) {
                    const captionText = message.length > 1000 ? message.substring(0, 1000) + '...' : message;
                    await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chat_id: chatId, photo: firstImageUrl, caption: captionText, parse_mode: 'HTML' })
                    });
                } else {
                    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML', disable_web_page_preview: true })
                    });
                }

                // 성공 시 발송 시간 업데이트
                await supabase
                    .from('rss_signals')
                    .update({ last_fired_at: now.toISOString() })
                    .eq('id', sig.id);
                sentCount++;

            } catch (parseError) {
                console.error(`피드 파싱 실패: ${sig.feed_url}`);
            }
        }
        
        return NextResponse.json({ success: true, sentCount, message: '스케줄 점검 완료' });
    } catch (e: any) {
        console.error('[Cron Error]', e);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}

export const POST = GET;
