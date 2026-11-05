// Approved stage-group AC7: retain real card/assignment state while the HTTP boundary supplies live snapshots.
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import CoordinatorEventCards from '../../frontend/src/pages/coordinator/CoordinatorEventCards';
import { api } from '../../frontend/src/api/client';
vi.mock('../../frontend/src/api/client', () => ({ api: { put: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const props = { token: 'session', staff: [{ id: 8, full_name: 'Tom' }], onSaved: vi.fn(), returnTo: '/coordinator', grouped: true };
/** The parent supplies current router state exactly as EventList does; only browser-history buttons are test helpers. */
function RoutedCards({events}) {
  const location = useLocation(), navigate = useNavigate();
  return <><CoordinatorEventCards {...props} events={events} returnTo={location.pathname+location.search}/>
    <output aria-label="Current route">{location.pathname+location.search}</output>
    <button onClick={()=>navigate(-1)}>Browser back</button><button onClick={()=>navigate(1)}>Browser forward</button></>;
}
/** A real router preserves links and filter history; rerender supplies a new external polling snapshot. */
function cards(events, path='/coordinator/dashboard') { return <MemoryRouter initialEntries={[path]}><RoutedCards events={events}/></MemoryRouter>; }
/** Query the user-facing label independently of its changing count. */
function tab(label) { return screen.getByRole('tab', {name:new RegExp('^'+label+'\\b')}); }

it('Dashboard AC7 - preserves the flat ordinary event list and its legacy missing-value fallbacks', () => {
  // Arrange / Act: grouping belongs to the dashboard; another event-list entry point keeps its existing presentation.
  render(<MemoryRouter><CoordinatorEventCards events={[{ id: 5 }]} returnTo="/events" /></MemoryRouter>);
  // Assert: missing legacy fields remain readable and no status disclosure is introduced outside the dashboard.
  expect(screen.getByRole('heading', { name: 'Untitled Event' })).toBeVisible();
  expect(screen.getByText('Draft')).toBeVisible();
  expect(screen.getByText('No purpose provided')).toBeVisible();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: /View details/ })).toHaveAttribute('href', '/events/5');
});

it('Coordinator tabs AC1 AC2 - partitions every lifecycle once with the five agreed labels and counts', () => {
  // Arrange: reversed records prevent API order from masquerading as workflow order; cancelled/legacy records must stay reachable.
  const statuses = ['submitted','under_review','approved','planning','confirmed','completed','rejected','cancelled','draft','legacy'];
  render(cards([...statuses.map((status,id)=>({id,name:`Event ${status}`,status})).reverse(),{id:20,name:'Flagged draft',status:'completed',is_draft:true}]));
  const expected = [['Draft',['Event draft','Flagged draft']],['Submitted',['Event legacy','Event cancelled','Event submitted']],
    ['In progress',['Event confirmed','Event planning','Event approved','Event under_review']],['Completed',['Event completed']],['Rejected',['Event rejected']]];
  expect(screen.getAllByRole('tab').map(item=>item.textContent)).toEqual(['Draft 2','Submitted 3','In progress 4','Completed 1','Rejected 1']);
  // Act / Assert: exactly one accessible panel exposes only the independently specified records for each stage.
  for(const [label,names] of expected){
    fireEvent.click(tab(label));
    expect(tab(label)).toHaveAttribute('aria-selected','true');
    expect(within(screen.getByRole('tabpanel')).getAllByRole('heading',{level:3}).map(item=>item.textContent)).toEqual(names);
    expect(screen.getAllByRole('tab').filter(item=>item.getAttribute('aria-selected')==='true')).toHaveLength(1);
  }
});

it('Coordinator tabs AC3 AC4 - preserves an unsaved assignment across tab switches and a live move into Completed', () => {
  const event={id:3,name:'Forum',status:'planning',technical_support_required:true,technical_support_staff:[]};
  const other={id:4,name:'Other',status:'completed'};
  const view=render(cards([event,other]));
  const original=screen.getByRole('heading',{name:'Forum'}).closest('article');
  fireEvent.click(within(original).getByRole('checkbox',{name:'Tom'}));
  fireEvent.click(tab('Completed'));fireEvent.click(tab('In progress'));
  expect(within(original).getByRole('checkbox',{name:'Tom'})).toBeChecked();
  // A real status refresh can empty the selected category; retain that explicit selection and the mounted card's draft.
  view.rerender(cards([{...event,status:'completed'},other]));
  expect(tab('In progress')).toHaveAttribute('aria-selected','true');
  expect(screen.getByText('No in progress events.')).toBeVisible();
  expect(within(tab('Completed')).getByText('2')).toBeVisible();
  fireEvent.click(tab('Completed'));
  const moved=screen.getByRole('heading',{name:'Forum'}).closest('article');
  expect(moved).toBe(original);
  expect(within(moved).getByRole('checkbox',{name:'Tom'})).toBeChecked();
  expect(within(moved).getByRole('button',{name:'Assign staff'})).toBeEnabled();
});

it('Coordinator tabs AC3 AC5 - supports keyboard wrapping and bookmarked stages with Back and Forward', () => {
  render(cards([], '/coordinator/dashboard?stage=invalid&keep=1'));
  expect(tab('Draft')).toHaveAttribute('aria-selected','true');
  expect(screen.getByText('No draft events.')).toBeVisible();
  // Keyboard activation follows the organiser pattern and retains unrelated URL parameters.
  const keys=[['ArrowLeft','Rejected'],['ArrowRight','Draft'],['End','Rejected'],['Home','Draft'],['ArrowRight','Submitted']];
  for(const [key,label] of keys){fireEvent.keyDown(screen.getByRole('tab',{selected:true}),{key});expect(tab(label)).toHaveFocus();expect(tab(label)).toHaveAttribute('aria-selected','true');}
  fireEvent.keyDown(tab('Submitted'),{key:'Tab'});
  expect(tab('Submitted')).toHaveAttribute('aria-selected','true');
  expect(screen.getAllByRole('tab').filter(item=>item.tabIndex===0)).toHaveLength(1);
  expect(screen.getByLabelText('Current route')).toHaveTextContent('/coordinator/dashboard?stage=submitted&keep=1');
  fireEvent.click(screen.getByRole('button',{name:'Browser back'}));expect(tab('Draft')).toHaveAttribute('aria-selected','true');
  fireEvent.click(screen.getByRole('button',{name:'Browser forward'}));expect(tab('Submitted')).toHaveAttribute('aria-selected','true');
});

it('Coordinator tabs AC2 AC5 - defaults to the first populated stage and honours an explicitly empty bookmark', () => {
  const events=[{id:1,name:'Review',status:'under_review'}];
  render(cards(events));expect(tab('In progress')).toHaveAttribute('aria-selected','true');
  cleanup();
  render(cards(events,'/coordinator/dashboard?stage=rejected'));
  expect(tab('Rejected')).toHaveAttribute('aria-selected','true');
  expect(screen.getByText('No rejected events.')).toBeVisible();
});

it('Coordinator tabs AC4 - a pending assignment finishes once after switching tabs and receiving a new stage', async () => {
  let finish;api.put.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const event={id:3,name:'Forum',status:'submitted',technical_support_required:true,technical_support_staff:[]};
  const view=render(cards([event]));
  const card=screen.getByRole('heading',{name:'Forum'}).closest('article');
  fireEvent.click(within(card).getByRole('checkbox',{name:'Tom'}));fireEvent.click(within(card).getByRole('button',{name:'Assign staff'}));
  fireEvent.click(tab('In progress'));view.rerender(cards([{...event,status:'planning'}]));
  expect(within(card).getByRole('button',{name:'Saving…'})).toBeDisabled();
  await act(async()=>{finish({message:'Saved'});});
  await waitFor(()=>expect(within(card).getByRole('button',{name:'Assignment saved'})).toBeVisible());
  expect(api.put).toHaveBeenCalledTimes(1);
  expect(api.put).toHaveBeenCalledWith('/events/3/technical-support-assignment',{staffIds:[8]},'session');
  expect(props.onSaved).toHaveBeenCalledWith(3,[{id:8,full_name:'Tom'}]);
});
