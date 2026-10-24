import {privateRobots} from '../../lib/seo-config';
import {requireChatGPTUser} from '../chatgpt-auth';
import MyPage from '../../components/my-page';
export const metadata={robots:privateRobots,alternates:{canonical:null}};
export const dynamic='force-dynamic';
export default async function MemberPage(){await requireChatGPTUser('/mypage');return <MyPage/>}
