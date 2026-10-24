import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptsBook, retryAfterSeconds} from './marketplaces.mjs';

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
