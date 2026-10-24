import {isRssAdmin} from '../../../lib/rss-admin';
import BillingAdmin from '../../../components/billing-admin';
export const dynamic='force-dynamic';
export default async function Page(){if(!await isRssAdmin())return <div className="admin-page">관리자 전용입니다.</div>;return <BillingAdmin/>}
