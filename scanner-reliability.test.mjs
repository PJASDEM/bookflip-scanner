import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptsBook, retryAfterSeconds} from './marketplaces.mjs';
import {parseVintedDetail, enrichVintedBatch} from './vinted-detail.mjs';

test('empty watchlist query cannot accept arbitrary listings', () => {
 const task={mode:'watchlist',title:'',source:'Vinted'};
 assert.equal(acceptsBook(task,'Unrelated listing'),false);
 assert.equal(acceptsBook({...task,title:'   '},'Warhammer novel'),false);
});
test('watchlist still recognizes normalized book titles', () => {
 const task={mode:'watchlist',title:'Łowca',source:'OLX'};
 assert.equal(acceptsBook(task,'Książka Lowca'),true);
});
test('Retry-After stays within bounded cooldown', () => {
 assert.equal(retryAfterSeconds('0',0),30);
 assert.equal(retryAfterSeconds('120',0),120);
 assert.equal(retryAfterSeconds('999999999',0),86400);
 assert.equal(retryAfterSeconds('invalid',0),30);
});

test('Vinted detail extracts ISBN from matching item JSON-LD with array types', () => {
 const url='https://www.vinted.pl/items/10506576818-a-z-popiolow-zrodzi-sie-ogien-sabaa-tahir';
 const html='<script type="application/ld+json">'+JSON.stringify({'@type':['Product','Book'],url,gtin13:'9788367551809'})+'</script>';
 const parsed=parseVintedDetail(html,url);
 assert.equal(parsed.recognized,true);
 assert.equal(parsed.isbn,'9788367551809');
});
test('Vinted detail does not take ISBN from another item', () => {
 const url='https://www.vinted.pl/items/10506576818-a-z-popiolow-zrodzi-sie-ogien-sabaa-tahir';
 const html='<script type="application/ld+json">'+JSON.stringify({'@type':'Book',url:'https://www.vinted.pl/items/99999999-another-book',isbn:'9788367551809'})+'</script>';
 const parsed=parseVintedDetail(html,url);
 assert.equal(parsed.recognized,false);
 assert.equal(parsed.isbn,null);
});

test('Vinted reads nested ISBN only for matching item ID in RSC payload', () => {
 const url='https://www.vinted.pl/items/10506576818-a-z-popiolow-zrodzi-sie-ogien-sabaa-tahir';
 const payload=JSON.stringify([1,JSON.stringify({item:{id:10506576818,attributes:[{name:'ISBN',value:'9788367551809'}]},recommended:{item:{id:123456789,isbn:'9788320000000'}}})]);
 const html='<script>self.__next_f.push('+payload+')</script>';
 const parsed=parseVintedDetail(html,url);
 assert.equal(parsed.isbn,'9788367551809');
 assert.equal(parsed.isbnStatus,'found');
});
test('Vinted does not accept ISBN from a different item in RSC', () => {
 const url='https://www.vinted.pl/items/10506576818-test';
 const payload=JSON.stringify([1,JSON.stringify({item:{id:123456789,isbn:'9788367551809'}})]);
 const parsed=parseVintedDetail('<script>self.__next_f.push('+payload+')</script>',url);
 assert.equal(parsed.isbn,null);
 assert.equal(parsed.isbnStatus,'schema_unrecognized');
});
test('Vinted enrich continues after unrecognized detail schema',async()=>{
 const offers=[{url:'https://www.vinted.pl/items/10506576818-test',title:'Książka'}];
 const result=await enrichVintedBatch(offers,{reader:async()=>({recognized:false})});
 assert.equal(result.length,1);
 assert.match(result[0].description,/nie rozpoznano struktury/);
 assert.equal(result[0].isbn,undefined);
});
