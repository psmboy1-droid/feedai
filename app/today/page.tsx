import {requireChatGPTUser} from '../chatgpt-auth';
import {privateRobots} from '../../lib/seo-config';
import TodaySummary from '../../components/today-summary';
export const dynamic='force-dynamic';
export const metadata={title:'Today AI 요약 | 피드AI',robots:privateRobots,alternates:{canonical:null}};
export default async function Page(){await requireChatGPTUser('/today');return <TodaySummary/>}
