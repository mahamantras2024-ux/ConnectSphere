import {Link,useLocation,useSearchParams} from 'react-router-dom';
import {useAuth} from '../../context/AuthContext';
import PageIntro from '../../components/PageIntro';
import useLiveResource from '../../hooks/useLiveResource';
import {validMonth,monthGrid,shiftMonth,eventsOnDate} from './planningCalendarDates';
import './PlanningCalendar.css';

/** Event schedules are displayed in the venue city's fixed Singapore time zone, independently of device settings. */
function eventTime(value){return new Date(value).toLocaleTimeString('en-GB',{timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit'});}

/** A dedicated read-only calendar for assigned events; no availability or resource-reservation APIs are called. */
export default function PlanningCalendar(){
  const {token}=useAuth();const [params,setParams]=useSearchParams();const location=useLocation();
  const requested=params.get('month');
  const month=validMonth(requested)?requested:new Date(Date.now()+8*3600000).toISOString().slice(0,7);
  const {data,loading,error,refresh}=useLiveResource(`/events/planning-calendar?month=${month}`,token);
  const cells=monthGrid(month);
  const title=new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-SG',{month:'long',year:'numeric',timeZone:'UTC'});
  /** Keep month selection bookmarkable and preserve the last valid choice if the native control is cleared. */
  function selectMonth(value){if(validMonth(value))setParams({month:value});}
  return <div className="page planning-calendar-page">
    <PageIntro title="Planning calendar" eyebrow="Assigned events" description="Your assigned event schedules, together in Singapore time."/>
    <section className="record-card planning-calendar-shell" aria-label="Event planning calendar">
      <div className="planning-calendar-toolbar"><h2>{title}</h2><div className="planning-calendar-controls">
        <button className="button-secondary" aria-label="Previous month" disabled={month==='0001-01'} onClick={()=>selectMonth(shiftMonth(month,-1))}>←</button>
        <label>Planning month<input type="month" min="0001-01" max="9999-12" value={month} onChange={event=>selectMonth(event.target.value)}/></label>
        <button className="button-secondary" aria-label="Next month" disabled={month==='9999-12'} onClick={()=>selectMonth(shiftMonth(month,1))}>→</button>
      </div></div>
      <p className="muted">All times are Singapore time (UTC+08:00).</p>
      {loading && <p role="status">Loading assigned schedules…</p>}
      {error && <div role="alert"><p>{error}{data && ' Showing the last loaded schedule.'}</p><button className="button-secondary" onClick={refresh}>Retry calendar</button></div>}
      {data && <>
        <p>{data.events.length===0?'No assigned events scheduled this month.':`Scheduled assigned events: ${data.events.length}`}</p>
        <div className="planning-calendar-scroll"><table className="planning-calendar-table" aria-label={`${title} assigned event schedule`}>
          <thead><tr>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day=><th key={day} scope="col">{day}</th>)}</tr></thead>
          <tbody>{Array.from({length:6},(_,week)=><tr key={week}>{cells.slice(week*7,week*7+7).map(cell=><td key={cell.date} aria-label={cell.date} className={cell.inMonth?'':'planning-day-outside'}>
            <time dateTime={cell.date} className="planning-day-number">{cell.day}</time>
            {cell.inMonth && eventsOnDate(cell.date,data.events).map(event=><Link className="planning-event" data-status={event.status} key={event.id}
              state={{returnTo:location.pathname+location.search}} to={`/events/${event.id}`}>
              <strong>{event.name}</strong><span>{eventTime(event.starts_at)}–{eventTime(event.ends_at)}</span><small>{event.status}</small>
            </Link>)}
          </td>)}</tr>)}</tbody>
        </table></div>
      </>}
    </section>
  </div>;
}
