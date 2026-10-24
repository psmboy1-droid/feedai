export async function resolve(specifier,context,next){
 if(specifier==='cloudflare:workers')return {url:'data:text/javascript,'+encodeURIComponent('export const env=new Proxy({}, {get:(_, key)=>globalThis.TEST_ENV[key]});'),shortCircuit:true};
 try{return await next(specifier,context)}catch(e){if(specifier.startsWith('.')){for(const suffix of ['.ts','/index.ts']){try{return await next(specifier+suffix,context)}catch{}}}throw e}
}
