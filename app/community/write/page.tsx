import { Suspense } from 'react';
import CommunityWrite from '../../../components/community-write';

export const metadata = {
    title: '글 작성 | FeedAI 커뮤니티',
    description: '커뮤니티 글 작성 및 수정',
};

export default async function CommunityWritePage({
    searchParams,
}: {
    searchParams: Promise<{ edit?: string }>;
}) {
    const sp = await searchParams;
    const editId = sp?.edit;

    return (
        <Suspense fallback={
            <div className="community-container">
                <div className="community-loading-state">
                    <div className="community-spinner" />
                    <p>로딩 중…</p>
                </div>
            </div>
        }>
            <CommunityWrite editId={editId} />
        </Suspense>
    );
}
