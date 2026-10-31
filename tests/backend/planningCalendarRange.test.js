const {test}=require('node:test');
const assert=require('node:assert/strict');
const {monthWindow}=require('../../backend/src/controllers/planningCalendarController');
for(const [month,end] of [['2030-11','2030-12'],['2030-12','2031-01'],['2032-02','2032-03'],['0001-01','0001-02'],['0002-01','0002-02'],['9998-12','9999-01'],['9999-12','10000-01']]){
  test(`Planning calendar AC1 - Singapore month window ${month}`,()=>{
    // Arrange / Act / Assert: month boundaries are event-local midnights, including leap years and year rollover.
    assert.deepEqual(monthWindow(month),{start:`${month}-01T00:00:00+08:00`,end:`${end}-01T00:00:00+08:00`});
  });
}
for(const month of [undefined,'','2030-00','2030-13','0000-12','10000-01','bad',['2030-11']])test(`Planning calendar AC1 AC2 - invalid month ${String(month)} is rejected`,()=>{
  // Arrange / Act / Assert: malformed query values must fail before any event query.
  assert.throws(()=>monthWindow(month),error=>error.status===400);
});
