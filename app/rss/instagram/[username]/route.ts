import RSS from 'rss';
import axios from 'axios';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: { username: string } }) {
    const username = params.username;
    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = request.headers.get('x-forwarded-proto') || 'http';

    const feed = new RSS({
        title: `[TELE-DESK] ${username} 님의 인스타그램`,
        description: 'TELE-DESK 자체 생성 인스타그램 RSS 피드',
        feed_url: `${protocol}://${host}/rss/instagram/${username}`,
        site_url: `https://instagram.com/${username}`
    });

    const rapidApiKeys = [
        process.env.RAPIDAPI_KEY_1,
        process.env.RAPIDAPI_KEY_2,
        process.env.RAPIDAPI_KEY_3,
        process.env.RAPIDAPI_KEY_4
    ].filter(Boolean);

    let posts = [];
    let fetchSuccess = false;

    for (let i = 0; i < rapidApiKeys.length; i++) {
        try {
            console.log(`[인스타 크롤링] ${i + 1}번째 API 키로 접속 시도 중...`);
            const response = await axios.post("https://instagram-scraper-stable-api.p.rapidapi.com/get_ig_user_posts.php", 
                { username: username, username_or_url: username },
                {
                    headers: {
                        "Content-Type": "multipart/form-data",
                        "x-rapidapi-key": rapidApiKeys[i] as string, 
                        "x-rapidapi-host": "instagram-scraper-stable-api.p.rapidapi.com"
                    },
                    timeout: 30000 
                }
            );

            fetchSuccess = true;
            console.log(`✅ [성공] ${i + 1}번째 API 키로 데이터 획득!`);
            posts = response.data?.posts || response.data?.data?.items || [];
            break; 
        } catch (error: any) {
            console.error(`⚠️ ${i + 1}번째 키 실패:`, error.response?.status || error.message);
        }
    }

    if (fetchSuccess) {
        const postArray = Array.isArray(posts) ? posts : (posts.items || []);
        if (postArray.length > 0) {
            postArray.forEach((item: any) => {
                const node = item.node || item; 
                const mediaUrl = node.display_url || node.thumbnail_src || (node.image_versions2?.candidates?.[0]?.url) || '';
                const rawText = node.edge_media_to_caption?.edges?.[0]?.node?.text || node.caption?.text || node.text || "게시물 이미지/영상";
                const safeTitle = Array.from(rawText).slice(0, 30).join('').replace(/\0/g, '') + '...';
                const postCode = node.shortcode || node.code || '';

                feed.item({
                    title: safeTitle,
                    description: `<img src="${mediaUrl}" style="max-width:400px; border-radius:8px;"><br><br><p>${rawText}</p>`,
                    url: postCode ? `https://instagram.com/p/${postCode}/` : `https://instagram.com/${username}`,
                    date: new Date((node.taken_at_timestamp || node.taken_at || Date.now()/1000) * 1000)
                });
            });
        } else {
            feed.item({
                title: "[RESTRICTED] 비공개 계정 또는 게시물 없음",
                description: `계정이 비공개(Private) 상태이거나 수집된 게시물이 없습니다.`,
                url: `https://instagram.com/${username}`,
                date: new Date()
            });
        }
    } else {
        feed.item({
            title: "[SYSTEM NOTICE] 인스타그램 연동 지연",
            description: "현재 일일 연동 한도가 소진되었거나 API 서버 점검 중입니다.",
            url: `https://instagram.com/${username}`,
            date: new Date()
        });
    }

    return new Response(feed.xml({ indent: true }), {
        status: 200,
        headers: { 'Content-Type': 'text/xml; charset=utf-8' }
    });
}