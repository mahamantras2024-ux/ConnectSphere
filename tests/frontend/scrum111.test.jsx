// SCRUM-111: real controls and effect/session boundaries; only HTTP is substituted.
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import SafetyRereviewPanel from '../../frontend/src/pages/events/SafetyRereviewPanel';
import {api} from '../../frontend/src/api/client';
vi.mock('../../frontend/src/api/client',()=>({api:{get:vi.fn(),post:vi.fn()}}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
const rejection={id:1,kind:'review',outcome:'rejected',notes:'Fire exit blocked.',actor:'Safety Officer',recorded_at:'2031-01-01T00:00:00Z'};
const pending={history:[rejection],required:true,canResubmit:true,blocked:null};
/** Controlled promises expose late responses while the same component remains mounted. */
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
it('SCRUM-111 AC1 AC2 AC4 - coordinator sees rejection reasons and resubmits without a required correction note',async()=>{
 const changed=vi.fn();api.get.mockResolvedValueOnce(pending).mockResolvedValue({history:[rejection,{id:2,kind:'resubmission',actor:'Coordinator',recorded_at:'2031-01-02T00:00:00Z'}],required:false});
 const saved=deferred();api.post.mockReturnValue(saved.promise);
 render(<SafetyRereviewPanel eventId={1} token="session" onSubmitted={changed}/>);
 expect(await screen.findByText('Reason: Fire exit blocked.')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Submit for safety re-review'}));
 expect(screen.getByRole('button',{name:'Submitting…'})).toBeDisabled();
 await act(async()=>saved.resolve({}));
 expect(await screen.findByText('Submitted for safety re-review')).toBeInTheDocument();
 expect(screen.getByText('Reason: Fire exit blocked.')).toBeInTheDocument();
 expect(api.post).toHaveBeenCalledWith('/events/1/safety-resubmissions',{},'session');expect(changed).toHaveBeenCalledTimes(1);
});
it('SCRUM-111 AC2 AC3 - incomplete arrangements disable submission and explain the blocker',async()=>{
 api.get.mockResolvedValue({...pending,canResubmit:false,blocked:'Confirm the replacement venue first.'});
 render(<SafetyRereviewPanel eventId={1} token="session"/>);
 expect(await screen.findByRole('button',{name:'Submit for safety re-review'})).toBeDisabled();
 expect(screen.getByText('Confirm the replacement venue first.')).toBeInTheDocument();expect(api.post).not.toHaveBeenCalled();
});
for(const failure of [new Error('Assignment changed.'),{}])it(`SCRUM-111 AC2 - failed resubmission preserves history and permits retry (${failure.message||'fallback'})`,async()=>{
 api.get.mockResolvedValue(pending);api.post.mockRejectedValue(failure);
 render(<SafetyRereviewPanel eventId={1} token="session"/>);fireEvent.click(await screen.findByRole('button',{name:'Submit for safety re-review'}));
 expect(await screen.findByRole('alert')).toHaveTextContent(failure.message||'Unable to submit for safety re-review.');
 expect(screen.getByText('Reason: Fire exit blocked.')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Submit for safety re-review'})).not.toBeDisabled();
});
for(const failure of [new Error('Offline'),{}])it(`SCRUM-111 AC4 - history load failure is visible (${failure.message||'fallback'})`,async()=>{
 api.get.mockRejectedValue(failure);render(<SafetyRereviewPanel eventId={1} token="session"/>);
 expect(await screen.findByRole('alert')).toHaveTextContent(failure.message||'Unable to load safety review history.');
});
it('SCRUM-111 AC4 - invalid history cannot be mistaken for an empty review trail',async()=>{
 api.get.mockResolvedValue({});render(<SafetyRereviewPanel eventId={1} token="session"/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Safety review history is unavailable.');
});
it('SCRUM-111 AC4 - complete history shows rejection, resubmission, requested changes and later pass',async()=>{
 api.get.mockResolvedValue({history:[rejection,{...rejection,id:2,kind:'resubmission',notes:null},{...rejection,id:3,outcome:'changes_requested',notes:'Revise layout'},{...rejection,id:4,outcome:'approved',notes:null}],required:false});
 render(<SafetyRereviewPanel eventId={1} token="session"/>);
 expect(await screen.findByText('Passed')).toBeInTheDocument();expect(screen.getByText('Rejected')).toBeInTheDocument();expect(screen.getByText('Changes requested')).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Submit for safety re-review'})).toBeNull();
});
for(const outcome of ['success','failure'])it(`SCRUM-111 AC4 - an old session's late history ${outcome} cannot replace current history`,async()=>{
 const old=deferred();api.get.mockReturnValueOnce(old.promise).mockResolvedValue({history:[],required:false});
 const view=render(<SafetyRereviewPanel eventId={1} token="old"/>);
 view.rerender(<SafetyRereviewPanel eventId={2} token="new"/>);expect(await screen.findByText('No safety reviews recorded yet.')).toBeInTheDocument();
 await act(async()=>outcome==='success'?old.resolve(pending):old.reject(new Error('Old private error')));
 expect(screen.queryByText('Reason: Fire exit blocked.')).toBeNull();expect(screen.queryByText('Old private error')).toBeNull();
});
for(const outcome of ['success','failure'])it(`SCRUM-111 AC2 AC4 - a late submission ${outcome} cannot affect the next event`,async()=>{
 const old=deferred(),changed=vi.fn();api.get.mockResolvedValue(pending);api.post.mockReturnValue(old.promise);
 const view=render(<SafetyRereviewPanel eventId={1} token="old" onSubmitted={changed}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Submit for safety re-review'}));
 api.get.mockResolvedValue({history:[],required:false});view.rerender(<SafetyRereviewPanel eventId={2} token="new" onSubmitted={changed}/>);
 await screen.findByText('No safety reviews recorded yet.');
 await act(async()=>outcome==='success'?old.resolve({}):old.reject(new Error('Private old submission error')));
 expect(changed).not.toHaveBeenCalled();expect(screen.queryByText('Private old submission error')).toBeNull();
});
it('SCRUM-111 AC2 AC3 - successful submission without a parent callback still reloads history',async()=>{
 api.get.mockResolvedValueOnce(pending).mockResolvedValue({history:[],required:false});api.post.mockResolvedValue({});
 render(<SafetyRereviewPanel eventId={1} token="session"/>);
 fireEvent.click(await screen.findByRole('button',{name:'Submit for safety re-review'}));
 expect(await screen.findByText('No safety reviews recorded yet.')).toBeInTheDocument();
});

// Exercise the actual decision-panel integration, while retaining the existing authentication context contract.
vi.mock('../../frontend/src/context/AuthContext',()=>({useAuth:()=>({token:'session',user:{id:8,role:'event_coordinator'}})}));
import EventDecisionSection from '../../frontend/src/pages/events/EventDecisionSection';
it('SCRUM-111 AC1 AC2 AC3 AC4 - event review displays recovery and refreshes readiness after submission',async()=>{
 let submitted=false;
 api.get.mockImplementation(async path=>path.endsWith('safety-review-history')?{...pending,required:!submitted}:{
  status:'planning',outcome:{decision:'approved',decidedBy:'Coordinator',decidedAt:'2030-01-01T00:00:00Z'},
  readiness:[],allowed:{approved:false,rejected:false},blocked:{approved:{message:'Already decided'},rejected:{message:'Already decided'}},
  safetyCheck:submitted?null:{outcome:'rejected',checked_at:'2031-01-01T00:00:00Z'},safetyResubmissionRequired:!submitted,
  transitions:[{status:'confirmed',blocked:{code:'SAFETY_NOT_COMPLETED',message:'Fresh safety clearance is required.'}}]});
 api.post.mockImplementation(async()=>{submitted=true;return{};});
 render(<EventDecisionSection event={{id:1,status:'planning',coordinator_id:8}} onDecided={vi.fn()}/>);
 expect(await screen.findByRole('button',{name:'Submit for safety re-review'})).toBeEnabled();
 expect(screen.getByRole('button',{name:'Confirm event'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Submit for safety re-review'}));
 await act(async()=>{});
 expect(screen.queryByRole('button',{name:'Submit for safety re-review'})).toBeNull();
 expect(screen.getByRole('button',{name:'Confirm event'})).toBeDisabled();
 expect(api.get.mock.calls.filter(([path])=>path==='/events/1/decision').length).toBeGreaterThan(1);
});
