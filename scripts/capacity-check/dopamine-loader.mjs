import {resolve as baseResolve} from './cloudflare-loader.mjs';
export async function resolve(specifier,context,next){
 if(specifier==='next/headers')return {url:'data:text/javascript,'+encodeURIComponent('export async function headers(){return globalThis.DOPAMINE_TEST_HEADERS||new Headers()}'),shortCircuit:true};
 if(specifier==='next/navigation')return {url:'data:text/javascript,'+encodeURIComponent('export function redirect(){throw Error("redirect")}'),shortCircuit:true};
 return baseResolve(specifier,context,next);
}
