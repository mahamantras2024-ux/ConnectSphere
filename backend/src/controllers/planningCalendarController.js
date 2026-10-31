const {pool}=require('../config/db');
/** Validates a month and returns half-open Singapore-local boundaries without relying on the server time zone. */
function monthWindow(month){
  if(typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||Number(month.slice(0,4))<1){
    throw Object.assign(new Error('Choose a valid planning month (YYYY-MM).'),{status:400});
  }
  const [year,number]=month.split('-').map(Number);
  const next=number===12?`${String(year+1).padStart(4,'0')}-01`:`${String(year).padStart(4,'0')}-${String(number+1).padStart(2,'0')}`;
  return {start:`${month}-01T00:00:00+08:00`,end:`${next}-01T00:00:00+08:00`};
}

/** Reads only the session Coordinator's assigned event schedules; venue/equipment availability is not part of this view. */
async function getPlanningCalendar(req,res){
  const range=monthWindow(req.query.month);
  const result=await pool.query(`WITH assigned AS (
    SELECT e.id,e.name,e.status,
      (e.proposed_date+e.proposed_start_time) AT TIME ZONE 'Asia/Singapore' AS starts_at,
      (e.proposed_date+e.proposed_end_time+CASE WHEN e.proposed_end_time<=e.proposed_start_time THEN interval '1 day' ELSE interval '0 day' END)
        AT TIME ZONE 'Asia/Singapore' AS ends_at
    FROM events e WHERE e.coordinator_id=$1 AND e.proposed_date IS NOT NULL
      AND e.proposed_start_time IS NOT NULL AND e.proposed_end_time IS NOT NULL
    ) SELECT id,name,status,starts_at,ends_at FROM assigned
      WHERE starts_at<$3::timestamptz AND ends_at>$2::timestamptz ORDER BY starts_at,id`,[req.user.id,range.start,range.end]);
  res.json({month:req.query.month,events:result.rows});
}
module.exports={monthWindow,getPlanningCalendar};
