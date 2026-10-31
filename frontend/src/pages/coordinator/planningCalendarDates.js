/** Native month controls and bookmarked URLs must identify a real month in the supported four-digit year range. */
export function validMonth(value){return typeof value==='string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0,4))>0;}

/** Builds a stable six-week month grid using UTC only for date arithmetic, avoiding device-local DST changes. */
export function monthGrid(month){
  const first=new Date(`${month}-01T00:00:00Z`);
  const beginning=first.getTime()-first.getUTCDay()*86400000;
  return Array.from({length:42},(_,index)=>{
    const instant=new Date(beginning+index*86400000);
    const key=`${String(instant.getUTCFullYear()).padStart(4,'0')}-${String(instant.getUTCMonth()+1).padStart(2,'0')}-${String(instant.getUTCDate()).padStart(2,'0')}`;
    return {date:key,day:instant.getUTCDate(),inMonth:key.slice(0,7)===month};
  });
}

/** Moves one month while clamping at native month-input limits, including December/January rollover. */
export function shiftMonth(month,delta){
  const [year,number]=month.split('-').map(Number);
  const index=Math.min(9999*12-1,Math.max(0,(year-1)*12+number-1+delta));
  return `${String(Math.floor(index/12)+1).padStart(4,'0')}-${String(index%12+1).padStart(2,'0')}`;
}

/** Uses half-open Singapore day boundaries so an event ending exactly at midnight does not occupy the next day. */
export function eventsOnDate(date,events){
  const start=Date.parse(`${date}T00:00:00+08:00`),end=start+86400000;
  return events.filter(event=>Date.parse(event.starts_at)<end && Date.parse(event.ends_at)>start);
}
