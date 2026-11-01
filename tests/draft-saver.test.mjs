import test from 'node:test';
import assert from 'node:assert/strict';
import { DraftSaver } from '../src/draftSaver.ts';

test('draft saves serialize drag updates and advance revisions without losing the latest layout', async () => {
  let release;
  const gate = new Promise(resolve => release = resolve);
  const writes = [];
  const statuses = [];
  const saver = new DraftSaver([], 3, async (fields, revision) => {
    writes.push({ fields, revision });
    if (writes.length === 1) await gate;
    return revision + 1;
  }, value => statuses.push(value));
  saver.update([{x: 0.1}]);
  const flushing = saver.flush();
  saver.update([{x: 0.2}]);
  saver.update([{x: 0.3}]);
  release();
  await flushing;
  await saver.flush();
  assert.deepEqual(writes, [{fields:[{x:0.1}], revision:3}, {fields:[{x:0.3}], revision:4}]);
  assert.equal(saver.dirty, false);
  assert.equal(statuses.at(-1), 'Draft saved');
});

test('failed saves remain dirty, stop overwriting and allow explicit retry', async () => {
  let fail = true, calls = 0;
  const statuses = [];
  const saver = new DraftSaver([], 0, async () => { calls++; if(fail) throw new Error('Offline'); return 1; }, value => statuses.push(value));
  saver.update([1]);
  await assert.rejects(saver.flush(), /Offline/);
  saver.update([2]);
  await assert.rejects(saver.flush(), /Offline/);
  assert.equal(calls, 1);
  assert.equal(saver.dirty, true);
  assert.match(statuses.at(-1), /Draft not saved/);
  fail = false;
  await saver.retry();
  assert.equal(saver.dirty, false);
});

test('undoing a field during an in-flight save remains dirty until the undo is persisted', async () => {
 let release;
 const gate = new Promise(resolve=>release=resolve);
 const writes=[];
 const saver=new DraftSaver([],0,async(fields,revision)=>{
   writes.push(fields);
   if(writes.length===1) await gate;
   return revision+1;
 },()=>{});
 saver.update([1]);
 const saving=saver.flush();
 saver.update([]);
 assert.equal(saver.dirty,true);
 release();
 await saving;
 assert.deepEqual(writes,[[1],[]]);
 assert.equal(saver.dirty,false);
});

test('autosave waits two quiet seconds and reports success only for automatic writes', async (t) => {
 t.mock.timers.enable({apis:['setTimeout']});
 let writes=0, notices=0;
 const saver=new DraftSaver([],0,async(_,revision)=>{writes++;return revision+1;},()=>{},()=>notices++);
 assert.equal(notices,0);
 saver.update([1]);
 t.mock.timers.tick(1500);
 saver.update([2]);
 t.mock.timers.tick(1999);
 assert.equal(writes,0);
 t.mock.timers.tick(1);
 await saver.flush();
 assert.equal(writes,1);
 assert.equal(notices,1);
 saver.update([3]);
 await saver.flush();
 assert.equal(writes,2);
 assert.equal(notices,1);
});
