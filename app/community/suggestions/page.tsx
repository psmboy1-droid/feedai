import CommunityList from '../../../components/community-list';

export const metadata = {
    title: '건의 게시판 | FeedAI 커뮤니티',
    description: '피드AI 서비스 건의 및 개선 요청',
};

export default function CommunitySuggestionsPage() {
    return <CommunityList board="suggestions" />;
}
