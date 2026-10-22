import {readSourceHtml} from './marketplaces.mjs';
import {rscText,objectAt} from './reference-parsers.mjs';
import {extractOfferISBN} from './isbn.mjs';
// Read only the requested item, never recommendation cards or the full page.
export function parseVintedDetail(html,url){
 const id=new URL(url).pathname.match(/^\/items\/(\d+)/)?.[1];if(!id)throw Error('INVALID_VINTED_ITEM');
 const data=rscText(html),candidates=[];
 for(const m of data.matchAll(/"(?:item|itemDetails|itemDto|itemDTO|itemData|product)"\s*:\s*\{/g)){
  const item=objectAt(data,m.index+m[0].length-1);if(String(item?.id??item?.itemId)!==id)continue;
  const {isbn,isbn_10,isbn_13,description,attributes,parameters}=item;
  candidates.push({isbn,isbn_10,isbn_13,description,attributes,parameters});
 }
 // Product JSON-LD must explicitly identify this item's URL.
 for(const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))try{
  const root=JSON.parse(m[1]);for(const p of [root,...(root['@graph']||[])]){
   if(!['Product','Book'].includes(p['@type']))continue;
   const link=p.url||p.offers?.url;if(!link||new URL(link,url).pathname.match(/^\/items\/(\d+)/)?.[1]!==id)continue;
   candidates.push({isbn:p.isbn,isbn_13:p.gtin13,description:p.description,parameters:p.additionalProperty});
  }
 }catch{}
 const evidence=extractOfferISBN({parameters:candidates});
 return {isbn:evidence.isbn,isbnDetection:evidence,recognized:candidates.length>0};
}
export async function readVintedISBN(url,options={}){
 const u=new URL(url);if(u.protocol!=='https:'||!['www.vinted.pl','vinted.pl'].includes(u.hostname)||!/^\/items\/\d+/.test(u.pathname)||u.port||u.username||u.password)throw Error('INVALID_VINTED_ITEM');
 const html=await readSourceHtml(url,{...options,source:'Vinted'});return parseVintedDetail(html,url);
}

// Small batches bound execution time. A blocked detail read never becomes a successful empty read.
export async function enrichVintedBatch(offers,options={}){
 const read=options.reader||readVintedISBN,out=[];
 for(const offer of offers){
  const known=extractOfferISBN(offer);if(known.status==='valid'){out.push(offer);continue;}
  let detail;try{detail=await read(offer.url,options);}catch(e){
   if(e.status===404||e.status===410){out.push({...offer,description:[offer.description,'ISBN: strona oferty niedostępna (HTTP '+e.status+').'].filter(Boolean).join('\n')});continue;}
   throw e;
  }
  if(detail.recognized===false)throw Error('VINTED_DETAIL_SCHEMA_UNRECOGNIZED');
  const raw=detail.isbnDetection?.observations||[];
  const observed=raw.length?{parameters:{...(offer.parameters||{}),'Odczyt ISBN':raw.map(o=>'ISBN: '+o.value).join('\n')}}:{};
  out.push({...offer,...observed,...(detail.isbn?{isbn:detail.isbn,isbnEvidence:'Vinted — szczegóły konkretnej oferty'}:{}),description:[offer.description,detail.isbn?'ISBN odczytany ze szczegółów oferty.':detail.isbnDetection?.status==='missing'?'Sprawdzono szczegóły oferty: ISBN nie podano.':'ISBN w szczegółach wymaga kontroli: '+detail.isbnDetection?.status+'.'].filter(Boolean).join('\n')});
 }
 return out;
}
