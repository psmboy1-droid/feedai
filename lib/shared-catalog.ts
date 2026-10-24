import defaults from '../data/feed-catalog.json';
export const catalogCategories=['종합','국내','국제','경제','미국증시','AI·테크','과학','건강','스포츠','문화','코인'] as const;
export type CatalogFeed={id:string;name:string;url:string;country:string;category:string;language:string;kind:string;verifiedAt:string;itemCount:number;enabled:boolean;deleted?:boolean;revision:number};
export function canonicalUrl(raw:string){const u=new URL(raw.trim());u.hash='';u.searchParams.sort();return u.href.replace(/\/$/,'')}
export function mergeCatalog(rows:CatalogFeed[]):CatalogFeed[]{const map=new Map<string,CatalogFeed>(defaults.map(f=>[f.id,{...f,enabled:true,revision:0}]));for(const row of rows)map.set(row.id,row);return [...map.values()].filter(f=>!f.deleted)}
