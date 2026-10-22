import {setTimeout as wait} from 'node:timers/promises';
import {parseVinted,parseAllegroListing,parseOlx} from './reference-parsers.mjs';
const sources={Vinted:{host:'www.vinted.pl',path:'/items/'},'Allegro Lokalnie':{host:'allegrolokalnie.pl',path:'/oferta/'},OLX:{host:'www.olx.pl',path:'/d/oferta/'}};
const norm=s=>String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ł/g,'l').replace(/[^a-z0-9]+/g,' ').trim();
export function acceptsBook(task,title){const n=norm(title);if(/\b(ebook|e book|epub|mobi|audiobook|audio book|stl|figurka|figurki|figurek|miniatures?|unpainted|sprue|dvd|cd|gra pc|gra ps5|gra ps4|gra komputerowa|karty|naklejki|zakladka|bookmark)\b/.test(n))return false;if(task.mode==='watchlist')return n.includes(norm(task.title));if(task.source==='Allegro Lokalnie')return /warcraft|warhammer|horus|herezja/i.test(n)&&/ksiaz|book|powies|novel|tom|omnibus|horus|herezja|abnett|mcneill|golden|knaak|komiks|manga/.test(n);return true;}
export function searchUrl(task){if(!sources[task.source]||task.host!==sources[task.source].host)throw Error('UNTRUSTED_MARKETPLACE_TASK');const query=task.mode==='watchlist'?task.title:task.category==='Warcraft'?'Warcraft':'Warhammer';if(task.source==='Vinted')return 'https://www.vinted.pl/catalog/2312-books?search_text='+encodeURIComponent(query);if(task.source==='Allegro Lokalnie')return 'https://allegrolokalnie.pl/oferty/q/'+encodeURIComponent(task.mode==='watchlist'?query:query+' książki');return 'https://www.olx.pl/muzyka-edukacja/ksiazki/q-'+encodeURIComponent(query)+'/';}
const lastReads=new Map();
export async function readSourceHtml(raw,{fetcher=fetch,source,pause=wait,now=Date.now}={}){
 const config=sources[source];if(!config)throw Error('UNTRUSTED_MARKETPLACE_TASK');const allowed=h=>h===config.host||h===config.host.replace(/^www\./,'');let url=new URL(raw);const signal=AbortSignal.timeout(18000);
 for(let hop=0;hop<4;hop++){
  if(url.protocol!=='https:'||!allowed(url.hostname)||url.username||url.password||url.port)throw Error('UNSAFE_SOURCE_REDIRECT');
  await pause(Math.max(0,(lastReads.get(source)||0)+2000-now()),undefined,{signal});lastReads.set(source,now());
  const response=await fetcher(url,{headers:{Accept:'text/html','User-Agent':'BookFlip/1.0 (book price comparison)'},redirect:'manual',signal});
  if([403,429].includes(response.status)){await response.body?.cancel();throw Object.assign(Error('SOURCE_HTTP_'+response.status),{status:response.status,blocked:true});}
  if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');await response.body?.cancel();if(!location)throw Error('SOURCE_REDIRECT_MISSING');url=new URL(location,url);continue;}
  if(!response.ok){await response.body?.cancel();throw Object.assign(Error('SOURCE_HTTP_'+response.status),{status:response.status});}
  if(!/text\/html|application\/xhtml/i.test(response.headers.get('content-type')||'')){await response.body?.cancel();throw Error('SOURCE_NOT_HTML');}
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>4000000)throw Error('SOURCE_TOO_LARGE');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  const buffer=new Uint8Array(size);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}const html=new TextDecoder().decode(buffer);
  if(/verify (?:that )?you are human|access denied|just a moment\.\.\.|attention required|<title>[^<]*(?:captcha|verification)|potwierd[zź],? [zż]e jeste[sś] cz[lł]owiekiem/i.test(html)||html.length<100000&&/captcha|datadome.*challenge/i.test(html))throw Object.assign(Error('SOURCE_CAPTCHA'),{blocked:true});
  return html;
 }throw Error('SOURCE_REDIRECT_LIMIT');
}
export function parseMarketplace(html,task,observedAt=new Date().toISOString()){
 searchUrl(task);const book={accept:title=>acceptsBook(task,title)};let rows;
 try{if(task.source==='Vinted')rows=parseVinted(html,book,observedAt);else if(task.source==='Allegro Lokalnie')rows=parseAllegroListing(html,book,observedAt);else{
  let recognized=false;for(const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{const d=JSON.parse(m[1]);if(Array.isArray(d.offers?.offers))recognized=true;}catch{}}
  if(!recognized)throw Error('UNRECOGNIZED_MARKETPLACE_DATA');rows=parseOlx(html,book,observedAt);
 }}catch(e){if(e.message==='UNRECOGNIZED_MARKETPLACE_DATA')throw e;throw Error('UNRECOGNIZED_MARKETPLACE_DATA');}
 const out=[],seen=new Set();for(const row of rows){if(row.available===false)continue;let u;try{u=new URL(row.url);}catch{continue;}if(u.protocol!=='https:'||![task.host,task.host.replace(/^www\./,'')].includes(u.hostname)||u.username||u.password||u.port||!u.pathname.startsWith(sources[task.source].path))continue;
  if(task.source==='Vinted'&&!/^\/items\/\d+/.test(u.pathname))continue;
  u.search='';u.hash='';if(seen.has(u.href))continue;seen.add(u.href);const price=Math.round(row.price*100);if(!Number.isSafeInteger(price)||price<=0||price>100000000)continue;
  out.push({title:row.title.slice(0,500),url:u.href,price,observedAt,activeConfirmed:false,priceConfirmed:false,availability:'unconfirmed',priceEvidence:'marketplace_listing'});if(out.length===20)break;
 }return out;
}
export async function scanMarketplace(task,options={}){const html=await readSourceHtml(searchUrl(task),{...options,source:task.source});return{offers:parseMarketplace(html,task),coverage:'Bezpośredni czytnik HTML przeniesiony z Archiwum 40K. Jedna strona wyszukiwania, maksymalnie 20 pasujących wpisów. Cena z listy wyników; dostępność, cena szczegółowa, wydanie i pełne koszty wymagają sprawdzenia. Brak pełnego pokrycia portalu.'};}
