// SCRUM-85: retain business context while enforcing PostgreSQL's character-based title limit.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {insertNotifications}=require('../../backend/src/services/notificationService');
const prefixes=[['AC1','Event assigned: '],['AC4','Equipment reservation confirmed: '],['AC4','Reserved equipment unavailable: '],['AC4','Replacement equipment suggested: '],['AC6','Venue unavailable: '],
 ['AC7','Venue hold expiring: '],['AC7','Venue hold expired: '],['AC9','Pending reviews: ']];
for(const [ac,prefix] of prefixes)for(const length of [254,255,256]){
 test(`SCRUM-85 ${ac} - stores ${length}-character ${prefix.trim()} title within the 255-character boundary`,async()=>{
  // Arrange: expected lengths come from the database limit, independently of the production implementation.
  const title=prefix+'x'.repeat(length-prefix.length), calls=[];
  const db={async query(sql,values){calls.push(values);return {rows:[]};}};
  // Act: execute the shared insert path; only PostgreSQL transport is replaced.
  await insertNotifications(db,[{userId:1,eventId:2,changeRequestId:null,type:'event_details_changed',title,message:'Full context',details:{}}]);
  // Assert: below/at remain unchanged; above is capped without changing other notification fields.
  assert.equal(calls[0][4][0],prefix+'x'.repeat(Math.min(length,255)-prefix.length));
  assert.equal(calls[0][5][0],'Full context');
 });
}
test('SCRUM-85 AC1 AC4 AC6 AC7 AC9 - Unicode titles are capped independently in a mixed notification batch',async()=>{
 // Arrange: each valid 255-character event name contains surrogate pairs in JavaScript.
 const notes=prefixes.map(([,prefix],i)=>({userId:i+1,eventId:i+1,changeRequestId:null,type:'event_details_changed',
  title:prefix+'😀'.repeat(255),message:'Full event name: '+'😀'.repeat(255),details:{kind:'regression'}}));
 notes.push({...notes[0],title:'Short event'});
 let inserted;
 // Act: preserve one batch rather than imitating transaction behavior.
 await insertNotifications({async query(sql,values){inserted=values;return {rows:[]};}},notes);
 // Assert: a UTF-16 slice would cut characters or over-truncate; PostgreSQL counts Unicode code points.
 for(let i=0;i<prefixes.length;i++)assert.equal(inserted[4][i],prefixes[i][1]+'😀'.repeat(255-prefixes[i][1].length));
 assert.equal(inserted[4].at(-1),'Short event');
 assert.deepEqual(inserted[5],notes.map(note=>note.message));
 assert.deepEqual(inserted[0],[...prefixes.map((_,i)=>i+1),1]);
});
