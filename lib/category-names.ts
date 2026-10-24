export function categoryName(name:string){return name.normalize('NFKC').trim().replace(/\s+/g,' ')}
export function categoryKey(name:string){return categoryName(name).toLowerCase()}
export function resolveCategory(name:string,mapping:Record<string,string>){return mapping[categoryKey(name)]||name}
