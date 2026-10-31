import '@testing-library/jest-dom/vitest';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import PlanningCalendar from '../../frontend/src/pages/coordinator/PlanningCalendar';
import {validMonth,monthGrid,shiftMonth,eventsOnDate} from '../../frontend/src/pages/coordinator/planningCalendarDates';
import {api} from '../../frontend/src/api/client';
vi.mock('../../frontend/src/api/client',()=>({api:{get:vi.fn()}}));
vi.mock('../../frontend/src/context/AuthContext',()=>({useAuth:()=>({token:'coordinator'})}));
const event={id:7,name:'Workshop',status:'planning',starts_at:'2030-11-01T02:00:00Z',ends_at:'2030-11-01T03:00:00Z'};
beforeEach(()=>{vi.resetAllMocks();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2030-11-15T04:00:00Z'));api.get.mockResolvedValue({events:[event]});});
afterEach(()=>{cleanup();vi.useRealTimers();});
/** Uses actual routing/search parameters; only the authenticated network boundary is controlled. */
function open(path='/coordinator/planning-calendar?month=2030-11'){return render(<MemoryRouter initialEntries={[path]}><PlanningCalendar/></MemoryRouter>);}
it('Planning calendar AC1 AC3 - assigned schedules appear in a dedicated Singapore-time month calendar',async()=>{
  // Arrange / Act: the month is a bookmarked URL and loading must not imply that no events exist.
  open();expect(screen.getByRole('status')).toHaveTextContent('Loading assigned schedules');
  const link=await screen.findByRole('link',{name:/Workshop/});
  // Assert: time conversion is explicit and the page calls no venue/equipment availability resource.
  expect(link).toHaveAttribute('href','/events/7');expect(link).toHaveTextContent('10:00–11:00');
  expect(within(screen.getByRole('cell',{name:'2030-11-01'})).getByRole('link',{name:/Workshop/})).toBeVisible();
  expect(screen.getByText('All times are Singapore time (UTC+08:00).')).toBeVisible();
  expect(api.get).toHaveBeenCalledWith('/events/planning-calendar?month=2030-11','coordinator');
  expect(api.get.mock.calls.every(([path])=>path.startsWith('/events/planning-calendar?month='))).toBe(true);
});
it('Planning calendar AC1 - month navigation and direct selection preserve independent month boundaries',async()=>{
  // Arrange: an empty assigned calendar remains a valid month view, never a resource-availability statement.
  api.get.mockResolvedValue({events:[]});open();await screen.findByText('No assigned events scheduled this month.');
  // Act / Assert: next, previous and year-crossing month selection update the scoped URL/API.
  fireEvent.click(screen.getByRole('button',{name:'Next month'}));
  expect(await screen.findByRole('heading',{name:'December 2030'})).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Previous month'}));
  expect(await screen.findByRole('heading',{name:'November 2030'})).toBeVisible();
  fireEvent.change(screen.getByLabelText('Planning month'),{target:{value:'2031-01'}});
  expect(await screen.findByRole('heading',{name:'January 2031'})).toBeVisible();
  fireEvent.change(screen.getByLabelText('Planning month'),{target:{value:''}});
  expect(screen.getByLabelText('Planning month')).toHaveValue('2031-01');
  expect(screen.queryByRole('link',{name:/Workshop/})).not.toBeInTheDocument();
});
it('Planning calendar AC1 - missing or malformed URL month safely defaults to the current Singapore month',async()=>{
  // Arrange / Act: invalid bookmarks must not crash date formatting or query an invalid month.
  open('/coordinator/planning-calendar?month=bad');
  expect(await screen.findByRole('link',{name:/Workshop/})).toBeVisible();
  // Assert: use a deterministic local-calendar month independently of the computer's time zone.
  expect(screen.getByLabelText('Planning month')).toHaveValue('2030-11');
});
for(const [instant,month] of [['2030-10-31T15:59:59.999Z','2030-10'],['2030-10-31T16:00:00.000Z','2030-11'],['2030-10-31T16:00:00.001Z','2030-11']]){
  it(`Planning calendar AC1 - current month boundary in Singapore at ${instant}`,async()=>{
    // Arrange: Singapore changes month eight hours before UTC; probe immediately below/at/above midnight.
    vi.setSystemTime(new Date(instant));api.get.mockResolvedValue({events:[]});
    // Act / Assert: both the native control and requested scope use the Singapore month, not the device's UTC month.
    open('/coordinator/planning-calendar');
    expect(screen.getByLabelText('Planning month')).toHaveValue(month);
    await screen.findByText('No assigned events scheduled this month.');
    expect(api.get).toHaveBeenCalledWith(`/events/planning-calendar?month=${month}`,'coordinator');
  });
}
it('Planning calendar AC1 - month input limits prevent navigation outside four-digit years',async()=>{
  // Arrange / Act / Assert: clamping is visible at both boundaries rather than producing invalid requests.
  api.get.mockResolvedValue({events:[]});open('/coordinator/planning-calendar?month=0001-01');
  expect(screen.getByRole('button',{name:'Previous month'})).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Planning month'),{target:{value:'9999-12'}});
  expect(screen.getByRole('button',{name:'Next month'})).toBeDisabled();
  await screen.findByText('No assigned events scheduled this month.');
});
it('Planning calendar AC1 AC2 - a failed load is explicit and retry cannot manufacture an empty assigned calendar',async()=>{
  // Arrange: a network failure is not evidence that there are no assigned events.
  api.get.mockRejectedValue(new Error('Calendar unavailable'));open();
  expect(await screen.findByRole('alert')).toHaveTextContent('Calendar unavailable');
  expect(screen.queryByText('No assigned events scheduled this month.')).not.toBeInTheDocument();
  // Act / Assert: retry reads the same protected endpoint and displays only its returned schedules.
  api.get.mockResolvedValue({events:[event]});fireEvent.click(screen.getByRole('button',{name:'Retry calendar'}));
  expect(await screen.findByRole('link',{name:/Workshop/})).toBeVisible();
});
it('Planning calendar AC1 - transient refresh failure labels the retained same-session schedule as stale',async()=>{
  // Arrange: retaining a last-known schedule is useful only if its failed refresh is made explicit.
  open();await screen.findByRole('link',{name:/Workshop/});
  api.get.mockRejectedValue(new Error('Connection lost'));
  // Act / Assert: focus-triggered refresh keeps the same-session snapshot with a visible stale-data warning.
  fireEvent.focus(window);
  expect(await screen.findByRole('alert')).toHaveTextContent('Showing the last loaded schedule.');
  expect(screen.getByRole('link',{name:/Workshop/})).toBeVisible();
});
it('Planning calendar AC1 - month grid includes leap day and uses actual low years rather than 1900 offsets',()=>{
  // Arrange / Act / Assert: expected dates are literal calendar facts, not a copy of the implementation's arithmetic.
  const november=monthGrid('2030-11');expect(november).toHaveLength(42);
  expect(november[0].date).toBe('2030-10-27');expect(november[41].date).toBe('2030-12-07');
  expect(monthGrid('2032-02').some(cell=>cell.date==='2032-02-29'&&cell.inMonth)).toBe(true);
  expect(monthGrid('0001-01').find(cell=>cell.inMonth&&cell.day===1).date).toBe('0001-01-01');
  expect(shiftMonth('2030-12',1)).toBe('2031-01');expect(shiftMonth('2031-01',-1)).toBe('2030-12');
  expect(shiftMonth('0001-01',-1)).toBe('0001-01');expect(shiftMonth('9999-12',1)).toBe('9999-12');
  for(const value of [null,'bad','0000-12','2030-13'])expect(validMonth(value)).toBe(false);
});
for(const offset of [-1,0,1])it(`Planning calendar AC1 - event end at Singapore midnight offset ${offset}ms`,()=>{
  // Arrange: event starts on the previous day; only an end after midnight intersects the selected day.
  const midnight=Date.parse('2030-11-01T00:00:00+08:00');
  const row={...event,starts_at:new Date(midnight-3600000).toISOString(),ends_at:new Date(midnight+offset).toISOString()};
  // Act / Assert: half-open intervals do not render an event on the day it merely touches at its end.
  expect(eventsOnDate('2030-11-01',[row]).length).toBe(offset>0?1:0);
});
for(const offset of [-1,0,1])it(`Planning calendar AC1 - event start at next Singapore midnight offset ${offset}ms`,()=>{
  // Arrange: an event belongs to today only if it starts before the following midnight.
  const midnight=Date.parse('2030-11-02T00:00:00+08:00');
  const row={...event,starts_at:new Date(midnight+offset).toISOString(),ends_at:new Date(midnight+3600000).toISOString()};
  // Act / Assert: an adjacent next-day schedule never bleeds into this day's calendar cell.
  expect(eventsOnDate('2030-11-01',[row]).length).toBe(offset<0?1:0);
});
