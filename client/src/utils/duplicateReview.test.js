import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewShortcut, applyReviewDelta, nextReviewId } from './duplicateReview.js';

test('shortcuts isolate text input, dialogs, composition and native button Space', () => {
  assert.equal(reviewShortcut({key:'r',target:{closest:()=>true}}),null);
  assert.equal(reviewShortcut({key:'r',isComposing:true}),null);
  assert.equal(reviewShortcut({key:'r',ctrlKey:true}),null);
  assert.equal(reviewShortcut({key:'Enter'}),null);
  assert.equal(reviewShortcut({key:'Enter',shiftKey:true}),'apply');
  assert.equal(reviewShortcut({key:'Enter',shiftKey:true,repeat:true}),null);
  assert.equal(reviewShortcut({key:'ArrowRight',repeat:true}),'next');
  assert.equal(reviewShortcut({key:'3'}),2);
  assert.equal(reviewShortcut({key:' ',target:{closest:(q)=>q.startsWith('button')}}),null);
});

test('server deltas retain the next group without skipping or rebuilding the queue', () => {
  const groups = [{id:'a'}, {id:'b'}, {id:'c'}, {id:'d'}];
  const delta = {removedGroupIds:['b','c'],updatedGroups:[{id:'b2'}]};
  assert.deepEqual(applyReviewDelta({groups},delta).groups.map(g=>g.id),['a','d','b2']);
  assert.equal(nextReviewId(groups,'b',delta),'d');
  assert.equal(nextReviewId(groups,'a',delta),'a');
  assert.equal(nextReviewId([{id:'b'}],'b',delta),'b2');
  assert.equal(nextReviewId([{id:'b'}],'b',{removedGroupIds:['b']}),null);
});
