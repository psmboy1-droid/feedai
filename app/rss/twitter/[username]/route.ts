import RSS from 'rss';
import axios from 'axios';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: { username: string } }) {
    const username = params.username;
    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = request.headers.get('x-forwarded-proto') || 'http';

    const feed = new RSS({
        title: `[TELE-DESK] ${username} 님의 X (트위터)`,
        description: 'TELE-DESK 시그널 디스틸러 - 오리지널 인사이트 정제 피드',
        feed_url: `${protocol}://${host}/rss/twitter/${username}`,
        site_url: `https://x.com/${username}`
    });

    const rapidApiKeys = [
        process.env.RAPIDAPI_KEY_1,
        process.env.RAPIDAPI_KEY_2,
        process.env.RAPIDAPI_KEY_3,
        process.env.RAPIDAPI_KEY_4
    ].filter(Boolean);

    let tweets = [];
    let fetchSuccess = false;

    for (let i = 0; i < rapidApiKeys.length; i++) {
        try {
            console.log(`[X 디스틸러] ${i + 1}번째 API 키로 접속 시도 중...`);
            const response = await axios.get("https://twitter-api45.p.rapidapi.com/timeline.php", {
                params: { screenname: username },
                headers: {
                    "x-rapidapi-key": rapidApiKeys[i] as string, 
                    "x-rapidapi-host": "twitter-api45.p.rapidapi.com"
                },
                timeout: 30000 
            });

            fetchSuccess = true;
            console.log(`✅ [성공] ${i + 1}번째 API 키로 X 타임라인 획득!`);
            tweets = response.data?.timeline || response.data?.tweets || (Array.isArray(response.data) ? response.data : []);
            break; 
        } catch (error: any) {
            console.error(`⚠️ ${i + 1}번째 키 실패:`, error.response?.status || error.message);
        }
    }

    if (fetchSuccess) {
        if (tweets.length > 0) {
            // 💡 노이즈 캔슬링: 리트윗, 남에게 쓴 멘션 제외!
            const originalTweets = tweets.filter((tweet: any) => {
                const text = tweet.text || tweet.display_text || '';
                const isRT = text.startsWith('RT @') || tweet.retweeted_status; 
                const isReplyToOther = tweet.in_reply_to_screen_name && tweet.in_reply_to_screen_name.toLowerCase() !== username.toLowerCase();
                return !isRT && !isReplyToOther; 
            });

            if (originalTweets.length > 0) {
                originalTweets.forEach((tweet: any) => {
                    const rawText = tweet.display_text || tweet.text || "내용 없음";
                    const safeTitle = Array.from(rawText).slice(0, 20).join('').replace(/\0/g, '') + '...';
                    const tweetId = tweet.id || tweet.rest_id || '';
                    const badge = tweet.replies > 0 ? "[THREAD]" : "[ORIGINAL]";

                    feed.item({
                        title: `${badge} ${safeTitle}`,
                        description: `<p>${rawText}</p>`,
                        url: tweetId ? `https://x.com/${username}/status/${tweetId}` : `https://x.com/${username}`,
                        date: tweet.created_at ? new Date(tweet.created_at) : new Date()
                    });
                });
            } else {
                feed.item({
                    title: "[NO DATA] 오리지널 인사이트 없음",
                    description: `작성한 오리지널 트윗이 없습니다. (리트윗/멘션만 존재함)`,
                    url: `https://x.com/${username}`,
                    date: new Date()
                });
            }
        } else {
            feed.item({
                title: "[NO DATA] 수집된 피드가 없습니다",
                description: `등록된 트윗이 존재하지 않거나 비공개(Protected) 상태입니다.`,
                url: `https://x.com/${username}`,
                date: new Date()
            });
        }
    } else {
        feed.item({
            title: "[SYSTEM NOTICE] X(트위터) 연동 지연",
            description: "현재 일일 연동 한도를 초과하여 X(트위터) 데이터를 수집하지 못했습니다. 잠시 후 다시 시도됩니다.",
            url: `https://x.com/${username}`,
            date: new Date()
        });
    }

    // 🔥 잘려나갔던 최하단 XML 응답 처리 부분 완벽 복구!
    return new Response(feed.xml({ indent: true }), {
        status: 200,
        headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 's-maxage=60, stale-while-revalidate'
        }
    });
}