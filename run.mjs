import {dispatchContinuation} from './continuation.mjs';
import {enrichVintedBatch} from './vinted-detail.mjs';
import {fetchFeed,selectOffers} from './feed.mjs';
import {sprzedajemyFeedUrl,parseSprzedajemyAtom} from './rss.mjs';
import {scanMarketplace} from './marketplaces.mjs';
const SITE='https://bookflip.karnol13.chatgpt.site';
const ENDPOINT=SITE+'/api/github-scanner';
const serviceToken=process.env.BOOKFLIP_SITES_ACCESS;
const stopAt=Date.now()+4*60000;
async function oidc(){const endpoint=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL||'');if(endpoint.protocol!=='https:'||!endpoint.hostname.endsWith('.actions.githubusercontent.com'))throw Error('OIDC_ENVIRONMENT_UNAVAILABLE');endpoint.searchParams.set('audience',ENDPOINT);const r=await fetch(endpoint,{headers:{Authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN},redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('OIDC_TOKEN_UNAVAILABLE');const d=await r.json();if(!d.value)throw Error('OIDC_TOKEN_UNAVAILABLE');return d.value;}
async function main(){if(!serviceToken)throw Error('BOOKFLIP_SITES_ACCESS_MISSING');const token=await oidc();let savedBatches=0;async function api(input){
 const body=input.action==='complete'?{...input,requestId:input.requestId||crypto.randomUUID()}:input;
 const retryable=['complete','status','process'].includes(body.action);
 for(let attempt=0;;attempt++){
  try{const r=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json','OAI-Sites-Authorization':'Bearer '+serviceToken,Authorization:'Bearer '+token},redirect:'error',body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
   const data=await r.json().catch(()=>{throw Object.assign(Error('INVALID_API_RESPONSE'),{transient:true});});
   if(!r.ok||data.error){console.error(JSON.stringify({httpStatus:r.status,code:data.error,traceId:data.traceId,action:body.action}));throw Object.assign(Error('SITE_HTTP_'+r.status),{transient:r.status>=500});}
   if(body.action==='complete')savedBatches++;return data;
  }catch(e){if(!retryable||e.transient===false||attempt>=2){const code=e.name==='TimeoutError'||e.name==='AbortError'?'SITE_REQUEST_TIMEOUT':/^[A-Z0-9_]+$/.test(e.message)?e.message:'SITE_CONNECTION_FAILED';console.error(JSON.stringify({error:code,action:body.action,attempt:attempt+1}));throw Error(code);}
   console.log(JSON.stringify({retry:body.action,attempt:attempt+1}));await new Promise(r=>setTimeout(r,2000*(attempt+1)));
  }
 }
}
 const before=await api({action:'ensure'});console.log(JSON.stringify({connection:'ok',active:before.active}));if(before.automatic===false){console.log('Automatic scanner is paused.');return;}let completed=0,blocked=0,failed=0,processed=0,waitingForRetry=false;
 runLoop: while(Date.now()<stopAt-20000){const claimed=await api({action:'claim'}),task=claimed.task;if(!task){
 const pending=(claimed.tasks||[]).filter(t=>t.status==='retry_wait'&&t.nextAttemptAt>Date.now());
 if(pending.length){const until=Math.min(...pending.map(t=>t.nextAttemptAt));waitingForRetry=true;console.log(JSON.stringify({waiting:'source_cooldown',retryAt:new Date(until).toISOString()}));await new Promise(r=>setTimeout(r,Math.min(30000,Math.max(1000,until-Date.now()),Math.max(1,stopAt-Date.now()-20000))));continue;}
 break;}waitingForRetry=false;if(task.adapter!=='marketplace_html'&&task.adapter!=='sprzedajemy_atom'&&(task.adapter!=='json_feed'||!task.feedUrl)){await api({action:'fail',taskId:task.id,leaseToken:task.leaseToken,kind:'blocked',message:'SOURCE_NOT_CONFIGURED: brak dopuszczonego feedu JSON. Skonfiguruj źródło na stronie BookFlip; nie uruchomiono scrapingu.'});blocked++;continue;}
 let offers,coverage,pagination;try{if(task.adapter==='marketplace_html'){const result=await scanMarketplace(task);offers=result.offers;coverage=result.coverage;pagination=result.pagination;}else if(task.adapter==='sprzedajemy_atom'){if(task.source!=='Sprzedajemy.pl'||task.host!=='sprzedajemy.pl')throw Error('UNTRUSTED_RSS_TASK');const feed=await fetchFeed(sprzedajemyFeedUrl(task),{format:'atom'});offers=parseSprzedajemyAtom(feed,task);}else{const feed=await fetchFeed(task.feedUrl);offers=selectOffers(feed,task);}}catch(e){const temporary=e.retryable===true||!e.blocked&&[500,502,503,504].includes(e.status)||!e.blocked&&/TIMEOUT|Timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND/.test(e.message);await api({action:'fail',taskId:task.id,leaseToken:task.leaseToken,kind:temporary?'temporary':'blocked',message:String(e.message).slice(0,200),retryAfterSeconds:e.retryAfter||300});failed++;continue;}
 if(pagination){
  let offset=task.pageOffset||0;
  if(offset>0&&task.pageDigest!==pagination.digest){await api({action:'complete',taskId:task.id,leaseToken:task.leaseToken,coverage,offers:[],pagination:{...pagination,offset,reset:true}});offset=0;}
  if(offset===0&&(task.pageDigests||[]).includes(pagination.digest)){await api({action:'complete',taskId:task.id,leaseToken:task.leaseToken,coverage,offers:[],pagination:{...pagination,offset:0}});completed++;continue;}
  do{if(Date.now()>stopAt-35000){await api({action:'yield',taskId:task.id,leaseToken:task.leaseToken});break runLoop;}let batch=offers.slice(offset,offset+3);try{batch=await enrichVintedBatch(batch);}catch(e){await api({action:'fail',taskId:task.id,leaseToken:task.leaseToken,kind:e.blocked?'blocked':e.retryable||e.status>=500||/TIMEOUT|Timeout|fetch failed/i.test(e.message)?'temporary':'invalid',message:String(e.message).slice(0,200),retryAfterSeconds:e.retryAfter||300});failed++;continue runLoop;}await api({action:'complete',taskId:task.id,leaseToken:task.leaseToken,coverage:coverage+' ISBN sprawdzany w szczegółach przed zapisem; partie po 3 oferty.',offers:batch,pagination:{...pagination,offset}});offset+=batch.length;if(offset>=offers.length)break;if(Date.now()>stopAt-5000){await api({action:'yield',taskId:task.id,leaseToken:task.leaseToken});break runLoop;}}while(true);
  console.log(JSON.stringify({source:'Vinted',page:pagination.page,entries:offers.length,nextPage:pagination.nextPage,state:pagination.state}));completed++;continue;
 }
 // Do not replay an uncertain completed write as a failure: status/lease resolves it on the next run.
 await api({action:'complete',taskId:task.id,leaseToken:task.leaseToken,coverage:coverage||(task.adapter==='sprzedajemy_atom'?'Publiczny kanał RSS/Atom Sprzedajemy.pl: jedna strona kanału, tylko kategoria Książki i Podręczniki, maksymalnie 20 pasujących ofert. Cena pochodzi z RSS; dostępność i cena na stronie wymagają sprawdzenia. Brak pełnego pokrycia portalu.':'Autoryzowany feed JSON odczytany przez GitHub Actions. Zakres ograniczony do treści feedu i maksymalnie 20 pasujących ofert; brak pełnego pokrycia portalu.'),offers});completed++;
 }
 if(Date.now()<stopAt-20000){try{await api({action:'enrich'});}catch{console.warn(JSON.stringify({bibliography:'deferred'}));}}
 const after=await api({action:'status'});console.log(JSON.stringify({completed,blocked,failed,processed,savedBatches,remaining:after.active,processing:after.processing}));
 const generation=Number(process.env.BOOKFLIP_CONTINUATION||0);if(after.automatic!==false&&((completed+processed+savedBatches)>0||waitingForRetry)&&after.active>0&&Number.isInteger(generation)&&generation>=0&&generation<20&&(!waitingForRetry||(after.tasks||[]).some(t=>t.status==='retry_wait'&&t.nextAttemptAt<=Date.now()+15*60000))){await dispatchContinuation(generation+1,process.env.GITHUB_TOKEN);}
}
main().catch(e=>{console.error(JSON.stringify({error:/^[A-Z0-9_]+$/.test(e.message)?e.message:'RUNNER_FAILED'}));process.exitCode=1;});
