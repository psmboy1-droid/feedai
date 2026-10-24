import {sqliteTable,text,integer,index} from 'drizzle-orm/sqlite-core';
export const newsAccounts=sqliteTable('news_accounts',{
 userId:text('user_id').primaryKey(),
 displayName:text('display_name').notNull().default(''),email:text('email').notNull().default(''),
 memberRevision:integer('member_revision').notNull().default(0),deletedAt:text('deleted_at').notNull().default(''),
 state:text('state').notNull(),
 tokens:integer('tokens').notNull().default(100),
 revision:integer('revision').notNull().default(0),
 createdAt:text('created_at').notNull(),
 updatedAt:text('updated_at').notNull(),
});
export const sharedFeeds=sqliteTable('shared_feeds',{
 id:text('id').primaryKey(),
 name:text('name').notNull(),
 url:text('url').notNull().unique(),
 country:text('country').notNull(),
 category:text('category').notNull(),
 language:text('language').notNull(),
 kind:text('kind').notNull(),
 verifiedAt:text('verified_at').notNull(),
 itemCount:integer('item_count').notNull(),
 deleted:integer('deleted',{mode:'boolean'}).notNull().default(false),
 enabled:integer('enabled',{mode:'boolean'}).notNull().default(true),
 revision:integer('revision').notNull().default(1),
});
export const sharedCategories=sqliteTable('shared_categories',{
 deleted:integer('deleted',{mode:'boolean'}).notNull().default(false),
 replacement:text('replacement').notNull().default(''),
 key:text('key').primaryKey(),
 name:text('name').notNull(),
 createdAt:text('created_at').notNull(),
});
export const aiSettings=sqliteTable('ai_settings',{
 id:text('id').primaryKey(),
 ciphertext:text('ciphertext').notNull(),
 iv:text('iv').notNull(),
 updatedAt:text('updated_at').notNull(),
});

export const seoSettings=sqliteTable('seo_settings',{
 id:text('id').primaryKey(),
 settings:text('settings').notNull(),
 updatedAt:text('updated_at').notNull(),
});

export const todayBriefs=sqliteTable('today_briefs',{
 userId:text('user_id').primaryKey(),feedKey:text('feed_key').notNull(),requestId:text('request_id').notNull(),
 status:text('status').notNull(),jobId:text('job_id').notNull().default(''),
 snapshot:text('snapshot').notNull().default(''),result:text('result').notNull().default(''),error:text('error').notNull().default(''),
 createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
});

export const aiPrompts=sqliteTable('ai_prompts',{
 id:text('id').primaryKey(),summary:text('summary').notNull(),analysis:text('analysis').notNull(),
 revision:integer('revision').notNull().default(1),updatedAt:text('updated_at').notNull(),
});

export const analysisRequests=sqliteTable('analysis_requests',{
 id:text('id').primaryKey(),userId:text('user_id').notNull(),requestHash:text('request_hash').notNull(),claim:text('claim').notNull(),
 status:text('status').notNull(),jobId:text('job_id').notNull().default(''),result:text('result').notNull().default(''),createdAt:text('created_at').notNull(),
},t=>[index('analysis_requests_user_status').on(t.userId,t.status,t.createdAt),index('analysis_requests_user_job').on(t.userId,t.jobId)]);

export const feedCache=sqliteTable('feed_cache',{
 url:text('url').primaryKey(),payload:text('payload').notNull().default(''),expiresAt:integer('expires_at').notNull().default(0),
 lockId:text('lock_id').notNull().default(''),lockUntil:integer('lock_until').notNull().default(0),
});
export const aiQueue=sqliteTable('ai_queue',{
 id:text('id').primaryKey(),owner:text('owner').notNull(),status:text('status').notNull(),body:text('body').notNull(),
 upstreamId:text('upstream_id').notNull().default(''),response:text('response').notNull().default(''),
 createdAt:integer('created_at').notNull(),startedAt:integer('started_at').notNull().default(0),
 checkAfter:integer('check_after').notNull().default(0),leaseUntil:integer('lease_until').notNull().default(0),
},t=>[index('ai_queue_status_created').on(t.status,t.createdAt),index('ai_queue_started').on(t.startedAt),index('ai_queue_owner_status').on(t.owner,t.status)]);

export const dopamineSources=sqliteTable('dopamine_sources',{
 id:text('id').primaryKey(),name:text('name').notNull(),url:text('url').notNull().unique(),country:text('country').notNull().default('KR'),
 kind:text('kind').notNull().default('auto'),enabled:integer('enabled').notNull().default(1),revision:integer('revision').notNull().default(1),
 lastCheckedAt:integer('last_checked_at').notNull().default(0),nextCheckAt:integer('next_check_at').notNull().default(0),
 lockId:text('lock_id').notNull().default(''),lockUntil:integer('lock_until').notNull().default(0),error:text('error').notNull().default(''),createdAt:integer('created_at').notNull(),
},t=>[index('dopamine_sources_due').on(t.enabled,t.nextCheckAt)]);
export const dopamineVideos=sqliteTable('dopamine_videos',{
 id:text('id').primaryKey(),sourceId:text('source_id').notNull(),videoId:text('video_id').notNull(),title:text('title').notNull(),
 channel:text('channel').notNull(),publishedAt:integer('published_at').notNull(),kind:text('kind').notNull(),overrideKind:text('override_kind').notNull().default(''),
},t=>[index('dopamine_videos_source_date').on(t.sourceId,t.publishedAt)]);

export const billingSubscriptions=sqliteTable('billing_subscriptions',{
 userId:text('user_id').primaryKey(),customerKey:text('customer_key').notNull().unique(),plan:text('plan').notNull(),mode:text('mode').notNull(),status:text('status').notNull(),
 secret:text('secret').notNull().default(''),nonce:text('nonce').notNull(),nonceExpires:integer('nonce_expires').notNull(),consentAt:text('consent_at').notNull(),
 nextCharge:integer('next_charge').notNull().default(0),anchor:integer('anchor').notNull().default(0),cycle:integer('cycle').notNull().default(0),cancelAtEnd:integer('cancel_at_end').notNull().default(0),
 lockUntil:integer('lock_until').notNull().default(0),lastError:text('last_error').notNull().default(''),createdAt:text('created_at').notNull(),
});
export const billingOrders=sqliteTable('billing_orders',{
 id:text('id').primaryKey(),userId:text('user_id').notNull(),plan:text('plan').notNull(),mode:text('mode').notNull(),amount:integer('amount').notNull(),status:text('status').notNull(),
 periodStart:integer('period_start').notNull(),periodEnd:integer('period_end').notNull(),paymentKey:text('payment_key').notNull().default(''),receiptUrl:text('receipt_url').notNull().default(''),
 createdAt:text('created_at').notNull(),lastError:text('last_error').notNull().default(''),
},t=>[index('billing_orders_user_created').on(t.userId,t.createdAt)]);

export const socialAccounts=sqliteTable('social_accounts',{
 id:text('id').primaryKey(),url:text('url').notNull().unique(),platform:text('platform').notNull(),handle:text('handle').notNull(),status:text('status').notNull().default('pending'),error:text('error').notNull().default(''),lastSuccess:integer('last_success').notNull().default(0),nextCheck:integer('next_check').notNull().default(0),lockUntil:integer('lock_until').notNull().default(0),lockId:text('lock_id').notNull().default(''),
});
export const socialPosts=sqliteTable('social_posts',{
 id:text('id').primaryKey(),accountId:text('account_id').notNull(),url:text('url').notNull().unique(),body:text('body').notNull(),publishedAt:integer('published_at').notNull(),media:text('media').notNull(),status:text('status').notNull(),
},t=>[index('social_posts_account_date').on(t.accountId,t.publishedAt)]);
export const socialSnapshots=sqliteTable('social_snapshots',{
 id:text('id').primaryKey(),userId:text('user_id').notNull(),accountId:text('account_id').notNull(),payload:text('payload').notNull(),nextCheck:integer('next_check').notNull(),createdAt:integer('created_at').notNull().default(0),
});
