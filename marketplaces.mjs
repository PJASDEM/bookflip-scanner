import {bibliographicMetadata} from './isbn.mjs';
import {createHash} from 'node:crypto';
import {setTimeout as wait} from 'node:timers/promises';
import {parseVinted,parseAllegroListing,parseOlx,rscText,objectAt} from './reference-parsers.mjs';
const sources={Vinted:{host:'www.vinted.pl',path:'/items/'},'Allegro Lokalnie':{host:'allegrolokalnie.pl',path:'/oferta/'},OLX:{host:'www.olx.pl',path:'/d/oferta/'}};
const norm=s=>String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ł/g,'l').replace(/[^a-z0-9]+/g,' ').trim();
export function acceptsBook(task,title){const n=norm(title);if(/\b(ebook|e book|epub|mobi|audiobook|audio book|stl|figurka|figurki|figurek|miniatures?|unpainted|sprue|dvd|cd|gra pc|gra ps5|gra ps4|gra komputerowa|karty|naklejki|zakladka|bookmark)\b/.test(n))return false;if(task.mode==='watchlist'){const needle=norm(task.title);return needle.length>0&&n.includes(needle);}if(task.source==='Allegro Lokalnie')return /warcraft|warhammer|horus|herezja/i.test(n)&&/ksiaz|book|powies|novel|tom|omnibus|horus|herezja|abnett|mcneill|golden|knaak|komiks|manga/.test(n);return true;}
export function searchUrl(task){if(!sources[task.source]||task.host!==sources[task.source].host)throw Error('UNTRUSTED_MARKETPLACE_TASK');const query=task.mode==='watchlist'?task.title:task.category==='Warcraft'?'Warcraft':'Warhammer';if(task.source==='Vinted'){const u=new URL('https://www.vinted.pl/catalog/2312-books');u.searchParams.set('search_text',query);if(task.paginationVersion===1){if(!Number.isInteger(task.page)||task.page<1||task.page>10000)throw Error('INVALID_VINTED_PAGE');u.searchParams.set('page',String(task.page));}return u.href;}if(task.paginationVersion===1&&(!Number.isInteger(task.page)||task.page<1||task.page>10000))throw Error('INVALID_MARKETPLACE_PAGE');const u=new URL(task.source==='Allegro Lokalnie'?'https://allegrolokalnie.pl/oferty/q/'+encodeURIComponent(task.mode==='watchlist'?query:query+' książki'):'https://www.olx.pl/muzyka-edukacja/ksiazki/q-'+encodeURIComponent(query)+'/');if(task.paginationVersion===1&&task.page>1)u.searchParams.set('page',String(task.page));return u.href;}
export function retryAfterSeconds(header,now=Date.now()){
 const text=String(header||'').trim(),seconds=/^\d+$/.test(text)?Number(text):(Date.parse(text)-now)/1000;
 return Number.isFinite(seconds)&&seconds>=0?Math.min(86400,Math.max(30,Math.ceil(seconds))):30;
}
const lastReads=new Map();
const sourceChallenge=html=>/verify (?:that )?you are human|access denied|just a moment\.\.\.|attention required|<title>[^<]*(?:captcha|verification)|potwierd[zź],? [zż]e jeste[sś] cz[lł]owiekiem/i.test(html)||html.length<100000&&/captcha|datadome.*challenge/i.test(html);
async function readBody(response,limit=4000000){
 if(!response.body)return '';
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Error('SOURCE_TOO_LARGE');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const buffer=new Uint8Array(size);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}return new TextDecoder().decode(buffer);
}
export async function readSourceHtml(raw,{fetcher=fetch,source,pause=wait,now=Date.now}={}){
 const config=sources[source];if(!config)throw Error('UNTRUSTED_MARKETPLACE_TASK');const allowed=h=>h===config.host||h===config.host.replace(/^www\./,'');let url=new URL(raw);const signal=AbortSignal.timeout(18000);
 for(let hop=0;hop<4;hop++){
  if(url.protocol!=='https:'||!allowed(url.hostname)||url.username||url.password||url.port)throw Error('UNSAFE_SOURCE_REDIRECT');
  await pause(Math.max(0,(lastReads.get(source)||0)+2000-now()),undefined,{signal});lastReads.set(source,now());
  const response=await fetcher(url,{headers:{Accept:'text/html','User-Agent':'BookFlip/1.0 (book price comparison)'},redirect:'manual',signal});
  if([403,429].includes(response.status)){
   const retryAfter=retryAfterSeconds(response.headers.get('retry-after'),now());
   if(response.status===403){let html;try{html=await readBody(response,100000);}catch{throw Object.assign(Error('SOURCE_FORBIDDEN_UNREADABLE'),{blocked:true,status:403,retryAfter});}if(sourceChallenge(html))throw Object.assign(Error('SOURCE_CAPTCHA'),{blocked:true,status:403,retryAfter});}
   else await response.body?.cancel();
   throw Object.assign(Error('SOURCE_HTTP_'+response.status),{status:response.status,blocked:false,retryable:true,retryAfter});
  }
  if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');await response.body?.cancel();if(!location)throw Error('SOURCE_REDIRECT_MISSING');url=new URL(location,url);continue;}
  if(!response.ok){await response.body?.cancel();throw Object.assign(Error('SOURCE_HTTP_'+response.status),{status:response.status});}
  if(!/text\/html|application\/xhtml/i.test(response.headers.get('content-type')||'')){await response.body?.cancel();throw Error('SOURCE_NOT_HTML');}
  const html=await readBody(response);
  if(sourceChallenge(html))throw Object.assign(Error('SOURCE_CAPTCHA'),{blocked:true});
  return html;
 }throw Error('SOURCE_REDIRECT_LIMIT');
}
export function parseMarketplace(html,task,observedAt=new Date().toISOString(),limit=20){
 searchUrl(task);const book={accept:title=>acceptsBook(task,title)};let rows;
 try{if(task.source==='Vinted')rows=parseVinted(html,book,observedAt);else if(task.source==='Allegro Lokalnie')rows=parseAllegroListing(html,book,observedAt);else{
  let recognized=false;for(const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{const d=JSON.parse(m[1]);if(Array.isArray(d.offers?.offers))recognized=true;}catch{}}
  if(!recognized)throw Error('UNRECOGNIZED_MARKETPLACE_DATA');rows=parseOlx(html,book,observedAt);
 }}catch(e){if(e.message==='UNRECOGNIZED_MARKETPLACE_DATA')throw e;throw Error('UNRECOGNIZED_MARKETPLACE_DATA');}
 const out=[],seen=new Set();for(const row of rows){if(row.available===false&&row.availabilityKnown!==false)continue;let u;try{u=new URL(row.url);}catch{continue;}if(u.protocol!=='https:'||![task.host,task.host.replace(/^www\./,'')].includes(u.hostname)||u.username||u.password||u.port||!u.pathname.startsWith(sources[task.source].path))continue;
  if(task.source==='Vinted'&&!/^\/items\/\d+/.test(u.pathname))continue;
  u.search='';u.hash='';if(seen.has(u.href))continue;seen.add(u.href);const price=Math.round(row.price*100);if(!Number.isSafeInteger(price)||price<=0||price>100000000)continue;
  out.push({...bibliographicMetadata(row),title:row.title.slice(0,500),url:u.href,price,observedAt,activeConfirmed:false,priceConfirmed:false,availability:'unconfirmed',priceEvidence:'marketplace_listing'});if(out.length===limit)break;
 }return out;
}
export function vintedPageInfo(html,task){
 const page=task.page||1,data=rscText(html),ids=[];
 for(const m of data.matchAll(/"productItem"\s*:\s*\{/g)){const p=objectAt(data,m.index+m[0].length-1);if(p?.url)ids.push(p.url);}
 const digest=createHash('sha256').update(JSON.stringify([...new Set(ids)])).digest('hex');
 for(const m of data.matchAll(/"pagination"\s*:\s*\{/g)){const p=objectAt(data,m.index+m[0].length-1);if(!p)continue;const current=p.currentPage??p.current_page,total=p.totalPages??p.total_pages;if(Number.isInteger(current)&&Number.isInteger(total)&&current>0&&total>=current){if(current!==page)throw Error('VINTED_PAGE_NOT_MATCHED');return{page,digest,state:current<total?'more':'end',nextPage:current<total?current+1:null,totalPages:total};}}
 const current=new URL(searchUrl(task));
 for(const m of html.matchAll(/<(?:a|link)\b([^>]*)>/gi)){const attrs=m[1];if(!/\bnext\b|nast[eę]pn/i.test(attrs)||/aria-disabled=["']true|\bdisabled\b/i.test(attrs))continue;const href=attrs.match(/\bhref=["']([^"']+)["']/i)?.[1];if(!href)continue;try{const u=new URL(href.replace(/&amp;/g,'&'),current);if(u.origin===current.origin&&u.pathname===current.pathname&&u.searchParams.get('search_text')===current.searchParams.get('search_text')&&Number(u.searchParams.get('page'))===page+1)return{page,digest,state:'more',nextPage:page+1};}catch{}}
 return{page,digest,state:'unknown',nextPage:null};
}
export function marketplacePageInfo(html,task,offers){
 if(task.source==='Vinted')return vintedPageInfo(html,task);
 const current=new URL(searchUrl(task)),page=task.page||1;
 const digest=createHash('sha256').update(JSON.stringify(offers.map(o=>o.url))).digest('hex');
 let ended=false;
 for(const m of html.matchAll(/<(?:a|link|button)\b([^>]*)>([^<]*)/gi)){
  const attrs=m[1],label=m[2];if(!/\brel=["'][^"']*\bnext\b|\baria-label=["'][^"']*(?:next|nast[eę]pn)/i.test(attrs)&&!/^\s*(?:next|nast[eę]pn)/i.test(label))continue;
  if(/aria-disabled=["']true|\bdisabled(?:[\s=>]|$)/i.test(attrs)){ended=true;continue;}
  const href=attrs.match(/\bhref=["']([^"']+)["']/i)?.[1];if(!href)continue;
  try{const u=new URL(href.replace(/&amp;/g,'&'),current),next=Number(u.searchParams.get('page'));u.searchParams.delete('page');const base=new URL(current);base.searchParams.delete('page');u.searchParams.sort();base.searchParams.sort();
   if(!u.username&&!u.password&&u.href===base.href&&next===page+1)return{page,digest,state:'more',nextPage:next};
  }catch{}
 }
 return{page,digest,state:ended?'end':'unknown',nextPage:null};
}
export async function scanMarketplace(task,options={}){
 const html=await readSourceHtml(searchUrl(task),{...options,source:task.source}),paginated=task.paginationVersion===1;
 const offers=parseMarketplace(html,task,new Date().toISOString(),paginated?5001:20);if(offers.length>5000)throw Error('MARKETPLACE_PAGE_TOO_LARGE');
 const pagination=paginated?{...marketplacePageInfo(html,task,offers),total:offers.length}:undefined;
 return{offers,pagination,coverage:paginated?`${task.source}: strona ${task.page}, ${offers.length} pasujących wpisów. Cała odczytana strona zapisywana partiami. ${pagination.state==='end'?'Źródło wskazało koniec wyników.':pagination.state==='more'?'Potwierdzono kolejną stronę.':'Nie rozpoznano kolejnej strony; zakres niepełny.'} Dostępność, wydanie i koszty wymagają sprawdzenia. Zmiany kolejności mogą powodować pominięcia.`:'Jedna strona wyszukiwania, maksymalnie 20 kandydatów. Dostępność, cena szczegółowa, wydanie i koszty wymagają sprawdzenia. Zakres niepełny.'};
}

