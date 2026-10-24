import {requireChatGPTUser} from '../chatgpt-auth';
import BillingPage from '../../components/billing-page';
import {privateRobots} from '../../lib/seo-config';
export const metadata={robots:privateRobots,alternates:{canonical:null}};
export const dynamic='force-dynamic';
export default async function Page(){await requireChatGPTUser('/billing');return <BillingPage/>}
