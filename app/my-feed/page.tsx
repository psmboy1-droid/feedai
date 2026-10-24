import {privateRobots} from '../../lib/seo-config';
export const metadata={robots:privateRobots,alternates:{canonical:null}};
import FeedPage from '../page';
import {requireChatGPTUser} from '../chatgpt-auth';
export const dynamic='force-dynamic';
export default async function MyFeedPage(){
 await requireChatGPTUser('/my-feed');
 return <FeedPage personal/>;
}
