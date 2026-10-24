import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import assert from 'node:assert/strict';
const exports={},env={RSS_ADMIN_EMAIL:'owner@example.test',RSS_ADDITIONAL_ADMIN_EMAILS:' Added@example.test ; second@example.test\nthird@example.test'},session={user:null};
vm.runInNewContext(ts.transpile(fs.readFileSync('lib/rss-admin.ts','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}),{exports,process:{env},require:()=>({getChatGPTUser:async()=>session.user})});
let checks=0;const ok=value=>{assert.ok(value);checks++};
for(const email of ['owner@example.test','OWNER@example.test','added@example.test',' Added@Example.test ','second@example.test','third@example.test'])ok(exports.isAdminEmail(email));
for(const email of [undefined,null,'',' ','unlisted@example.test','added@example.test.attacker.test','prefixadded@example.test'])ok(!exports.isAdminEmail(email));
ok(!await exports.isRssAdmin());session.user={email:'added@example.test'};ok(await exports.isRssAdmin());session.user={email:'unlisted@example.test'};ok(!await exports.isRssAdmin());env.RSS_ADDITIONAL_ADMIN_EMAILS='';ok(exports.isAdminEmail('owner@example.test'));ok(!exports.isAdminEmail('added@example.test'));delete env.RSS_ADMIN_EMAIL;ok(!exports.isAdminEmail('owner@example.test'));
console.log(checks+' administrator allowlist and authentication checks passed');
