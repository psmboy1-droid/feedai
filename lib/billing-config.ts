import {getDb} from '../db';
import {encryptApiKey,decryptApiKey} from './ai-key';
export type BillingConfig={mode:'test'|'live';clientKey:string;secretKey:string;enabled:boolean;revision:string};
export async function billingConfig():Promise<BillingConfig>{const row=await getDb().$client.prepare("SELECT ciphertext,iv FROM ai_settings WHERE id='toss-billing'").first<{ciphertext:string;iv:string}>();return row?JSON.parse(await decryptApiKey(row)):{mode:'test',clientKey:'',secretKey:'',enabled:false,revision:''}}
export async function saveBillingConfig(config:BillingConfig){const secret=await encryptApiKey(JSON.stringify(config));await getDb().$client.prepare("INSERT INTO ai_settings(id,ciphertext,iv,updated_at) VALUES('toss-billing',?,?,?) ON CONFLICT(id) DO UPDATE SET ciphertext=excluded.ciphertext,iv=excluded.iv,updated_at=excluded.updated_at").bind(secret.ciphertext,secret.iv,new Date().toISOString()).run()}
export async function schedulerReady(){const row=await getDb().$client.prepare("SELECT updated_at FROM ai_settings WHERE id='billing-scheduler'").first<{updated_at:string}>();return !!row&&Date.now()-Date.parse(row.updated_at)<48*3600000}
export async function billingReady(config:BillingConfig){return config.enabled&&!!config.clientKey&&!!config.secretKey&&(config.mode==='test'||await schedulerReady())}
