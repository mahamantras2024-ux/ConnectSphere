import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import App from '../../frontend/src/App';
import {AuthProvider} from '../../frontend/src/context/AuthContext';
import {api} from '../../frontend/src/api/client';
import {readAttachment} from '../../frontend/src/components/EventAttachments';
vi.mock('../../frontend/src/api/client',()=>({api:{get:vi.fn(),post:vi.fn(),put:vi.fn(),delete:vi.fn()}}));
const event={id:1,name:'Workshop',purpose:'Community learning',status:'draft',is_draft:true,coordinator_id:null,organiser_id:2,proposed_date:'2090-01-01',proposed_start_time:'10:00',proposed_end_time:'11:00',expected_attendance:10,registration_required:false,accessibility_requirements:[],attachments:{}};
/** Keeps app routing/auth real while controlling only network responses. */
function open(path='/organizer/dashboard'){localStorage.setItem('cs_token','test');render(<MemoryRouter initialEntries={[path]}><AuthProvider><App/></AuthProvider></MemoryRouter>);}
beforeEach(()=>{localStorage.clear();vi.resetAllMocks();api.get.mockImplementation(async path=>path==='/auth/me'?{user:{id:2,role:'event_organiser',full_name:'Alice'}}:path==='/events'?{events:[event]}:{event});});
afterEach(cleanup);
// AC1: row placement reflects persisted draft and assignment state, not invented client state.
it('Workflow AC1 - dashboard separates draft submitted and assigned rows',async()=>{
 api.get.mockImplementation(async path=>path==='/auth/me'?{user:{id:2,role:'event_organiser'}}:{events:[event,{...event,id:2,name:'Submitted event',status:'submitted',is_draft:false},{...event,id:3,name:'Assigned event',status:'submitted',is_draft:false,coordinator_id:4}]});
 open();await screen.findByRole('heading',{name:'Drafts'});
 for(const [section,name]of [['Drafts','Workshop'],['Submitted','Submitted event'],['In progress','Assigned event']])expect(within(screen.getByRole('region',{name:section})).getByRole('heading',{name})).toBeTruthy();
 expect(screen.getAllByRole('button',{name:'Delete draft'})).toHaveLength(1);
});
// AC3/AC4: cancelling sends nothing; confirming deletes once and displays persisted success.
it('Workflow AC3 AC4 - draft deletion confirms before and after success',async()=>{
 api.delete.mockResolvedValue({message:'Draft deleted.'});open();fireEvent.click(await screen.findByRole('button',{name:'Delete draft'}));
 expect(api.delete).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(screen.queryByRole('dialog')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Delete draft'}));fireEvent.click(screen.getByRole('button',{name:'Confirm'}));
 await screen.findByText('Draft deleted.');expect(api.delete).toHaveBeenCalledWith('/events/1/draft','test');expect(screen.queryByRole('heading',{name:'Workshop'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Continue'}));expect(screen.queryByRole('dialog')).toBeNull();
});
// AC3/AC4: existing drafts retain identity and move out of Drafts after explicit confirmation.
it('Workflow AC3 AC4 - submits existing draft into submitted section',async()=>{
 api.post.mockResolvedValue({event:{...event,status:'submitted',is_draft:false},message:'Event request submitted.'});open();fireEvent.click(await screen.findByRole('button',{name:'Submit draft'}));
 expect(api.post).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Confirm'}));await screen.findByText('Event request submitted.');
 expect(api.post).toHaveBeenCalledWith('/events/1/submit',{},'test');expect(within(screen.getByRole('region',{name:'Submitted'})).getByRole('heading',{name:'Workshop'})).toBeTruthy();
});
// AC2/AC4: blank drafts bypass submission requirements and still require review before any write.
it('Workflow AC2 AC4 - saves an incomplete draft only after confirmation',async()=>{
 api.post.mockResolvedValue({event:{...event,name:'',proposed_date:null,proposed_start_time:null,proposed_end_time:null,expected_attendance:null},message:'Draft saved.'});open('/organizer/events/new');
 fireEvent.click(await screen.findByRole('button',{name:'Save as draft'}));await screen.findByRole('dialog',{name:'Confirm save this draft'});
 expect(api.post).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Confirm'}));await screen.findByText('Draft saved.');
 expect(api.post.mock.calls[0][1]).toMatchObject({name:'',proposedDate:'',isDraft:true,expectedAttendance:null});
});
// AC2: browser requirements reject incomplete direct submission, while retaining the draft action.
it('Workflow AC2 - requires date times and attendance for submission',async()=>{
 open('/organizer/events/new');const button=await screen.findByRole('button',{name:'Submit'});expect(button.form.checkValidity()).toBe(false);
 fireEvent.click(button);expect(api.post).not.toHaveBeenCalled();expect(screen.queryByRole('dialog')).toBeNull();
 for(const [label,value]of [['Event name','Workshop'],['Proposed date','2090-01-01'],['Start time','10:00'],['End time','11:00'],['Expected attendance','1']])fireEvent.change(screen.getByLabelText(label),{target:{value}});
 expect(button.form.checkValidity()).toBe(true);fireEvent.click(button);expect(await screen.findByRole('dialog',{name:'Confirm submit this event request'})).toBeTruthy();
});
// AC5: a real FileReader preserves document bytes; excluded accessibility has no upload control.
it('Workflow AC5 - attaches document alongside purpose without accessibility upload',async()=>{
 open('/organizer/events/new');await screen.findByRole('heading',{name:'New event request'});
 fireEvent.change(screen.getByLabelText('Purpose'),{target:{value:'Community learning'}});
 fireEvent.change(screen.getByLabelText('Purpose attachment'),{target:{files:[new File(['%PDF-contents'],'plan.pdf',{type:'application/pdf'})]}});
 expect(await screen.findByRole('link',{name:'plan.pdf'})).toBeTruthy();expect(screen.queryByLabelText('Accessibility needs attachment')).toBeNull();
 expect(screen.getByLabelText('Purpose').value).toBe('Community learning');fireEvent.click(screen.getByRole('button',{name:'Remove Purpose attachment'}));expect(screen.queryByRole('link',{name:'plan.pdf'})).toBeNull();
});
// AC5: unsupported or oversized files cannot enter the event payload.
it('Workflow AC5 - rejects unsupported and oversized files before reading',async()=>{
 await expect(readAttachment(new File(['text'],'plan.exe'))).rejects.toThrow(/PNG/);
 await expect(readAttachment(new File([new Uint8Array(2*1024*1024+1)],'plan.pdf'))).rejects.toThrow(/2 MB/);
});

// AC4: failed draft actions preserve the persisted row and can be cancelled without claiming success.
it.each(['delete','submit'])('Workflow AC4 - failed draft %s preserves row and allows cancellation',async action=>{
 (action==='delete'?api.delete:api.post).mockRejectedValue(new Error('Offline'));open();
 fireEvent.click(await screen.findByRole('button',{name:action==='delete'?'Delete draft':'Submit draft'}));
 fireEvent.click(screen.getByRole('button',{name:'Confirm'}));expect((await screen.findByRole('alert')).textContent).toBe('Offline');
 expect(within(screen.getByRole('region',{name:'Drafts'})).getByRole('heading',{name:'Workshop'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Close dialog'}));expect(screen.queryByRole('dialog')).toBeNull();
});
// AC4: creation confirmation can be dismissed before saving, including keyboard dismissal.
it('Workflow AC4 - cancels drafting before a write',async()=>{
 open('/organizer/events/new');fireEvent.click(await screen.findByRole('button',{name:'Save as draft'}));fireEvent.keyDown(document,{key:'Escape'});
 expect(screen.queryByRole('dialog')).toBeNull();expect(api.post).not.toHaveBeenCalled();
});
// AC4/AC5: uploaded changes use the same confirmation flow and preserve the original file until persisted.
it('Workflow AC4 AC5 - confirms attachment updates and removal',async()=>{
 const file={name:'old.pdf',type:'application/pdf',data:btoa('%PDF-old')};
 api.get.mockImplementation(async path=>path==='/auth/me'?{user:{id:2,role:'event_organiser'}}:{event:{...event,attachments:{purpose:file}}});
 api.put.mockResolvedValue({event:{...event,attachments:{purpose:{name:'new.pdf',type:'application/pdf',data:btoa('%PDF-new')}}},message:'Files saved.'});
 open('/organizer/events/1');await screen.findByRole('link',{name:'old.pdf'});
 fireEvent.change(screen.getByLabelText('Purpose attachment'),{target:{files:[new File(['%PDF-new'],'new.pdf',{type:'application/pdf'})]}});
 await screen.findByRole('link',{name:'new.pdf'});fireEvent.click(screen.getByRole('button',{name:'Save attachments'}));
 expect(api.put).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Confirm'}));await screen.findByText('Files saved.');
 expect(api.put).toHaveBeenCalledWith('/events/1/non-critical',{attachments:{purpose:{name:'new.pdf',data:btoa('%PDF-new')}}},'test');
 fireEvent.click(screen.getByRole('button',{name:'Continue'}));fireEvent.click(screen.getByRole('button',{name:'Remove Purpose attachment'}));
 expect(screen.queryByRole('link',{name:'new.pdf'})).toBeNull();
});
// AC5: invalid file selection displays a useful error without adding a file to the request.
it('Workflow AC5 - invalid upload and cancelled picker preserve the written answer',async()=>{
 open('/organizer/events/new');await screen.findByLabelText('Purpose attachment');
 fireEvent.change(screen.getByLabelText('Purpose'),{target:{value:'Community learning'}});
 fireEvent.change(screen.getByLabelText('Purpose attachment'),{target:{files:[]}});
 fireEvent.change(screen.getByLabelText('Purpose attachment'),{target:{files:[new File(['invalid'],'file.exe')]}});
 expect((await screen.findByRole('alert')).textContent).toContain('2 MB');expect(screen.queryByRole('link',{name:'file.exe'})).toBeNull();expect(screen.getByLabelText('Purpose').value).toBe('Community learning');
});
// AC5: FileReader failure is a true browser boundary failure, rather than a fabricated API success.
it('Workflow AC5 - reports file read failure',async()=>{
 const original=globalThis.FileReader;
 class FailedReader {readAsDataURL(){this.onerror();}}
 globalThis.FileReader=FailedReader;
 try{await expect(readAttachment(new File(['%PDF-'],'file.pdf'))).rejects.toThrow('Unable to read this file.');}finally{globalThis.FileReader=original;}
});
// AC4: slow writes keep the review dialog open when the user tries to dismiss it.
it('Workflow AC4 - pending draft write blocks dismissal and repeated confirmation',async()=>{
 let finish;api.delete.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));open();
 fireEvent.click(await screen.findByRole('button',{name:'Delete draft'}));fireEvent.click(screen.getByRole('button',{name:'Confirm'}));
 fireEvent.click(screen.getByRole('button',{name:'Close dialog'}));expect(screen.getByRole('dialog')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Saving…'}));expect(api.delete).toHaveBeenCalledTimes(1);
 finish({message:'Draft deleted.'});await screen.findByText('Draft deleted.');
});
// AC4: nested confirmation handles Escape without closing the organiser's underlying event drawer.
it('Workflow AC4 - nested update confirmation closes before event details',async()=>{
 open();fireEvent.click(await screen.findByRole('link',{name:'View details'}));await screen.findByRole('dialog',{name:'Event details'});
 fireEvent.click(await screen.findByRole('button',{name:'Edit Purpose'}));fireEvent.click(screen.getByRole('button',{name:'Save changes'}));
 expect(screen.getAllByRole('dialog')).toHaveLength(2);fireEvent.keyDown(document,{key:'Escape'});
 expect(screen.getByRole('dialog',{name:'Event details'})).toBeTruthy();expect(api.put).not.toHaveBeenCalled();
});
// AC3: submitting one draft must preserve unrelated rows when merging the API result.
it('Workflow AC1 AC3 - submission preserves other drafts and completed history',async()=>{
 api.get.mockImplementation(async path=>path==='/auth/me'?{user:{id:2,role:'event_organiser'}}:{events:[event,{...event,id:2,name:'Other draft'},{...event,id:3,name:'Completed event',is_draft:false,status:'completed',coordinator_id:4}]});
 api.post.mockResolvedValue({event:{...event,is_draft:false,status:'submitted'},message:'Submitted.'});open();await screen.findByRole('heading',{name:'Workshop'});
 fireEvent.click(within(screen.getByRole('heading',{name:'Workshop'}).closest('li')).getByRole('button',{name:'Submit draft'}));fireEvent.click(screen.getByRole('button',{name:'Confirm'}));await screen.findByText('Submitted.');
 expect(within(screen.getByRole('region',{name:'Drafts'})).getByRole('heading',{name:'Other draft'})).toBeTruthy();
 expect(within(screen.getByRole('region',{name:'Submitted'})).getByRole('heading',{name:'Completed event'})).toBeTruthy();
});
// AC5: a coordinator can read attachment details included in a pending critical change without rendering raw objects.
it('Workflow AC5 - coordinator inbox renders proposed attachment names',async()=>{
 api.get.mockImplementation(async path=>path==='/auth/me'?{user:{id:4,role:'event_coordinator'}}:path==='/events'?{events:[]}:path==='/events/change-requests'?{changeRequests:[{id:1,event_id:1,event_name:'Workshop',requested_changes:{attachments:{purpose:{name:'plan.pdf',type:'application/pdf',size:5,data:btoa('%PDF-')}}}}]}:{event});
 open('/coordinator/dashboard');const download=await screen.findByRole('link',{name:'plan.pdf'});expect(download.getAttribute('href')).toBe(`data:application/pdf;base64,${btoa('%PDF-')}`);expect(download.getAttribute('download')).toBe('plan.pdf');
});
// AC4: navigating away while nested confirmation is open must not leave the page scroll-locked.
it('Workflow AC4 - nested dialog unmount restores background scrolling',async()=>{
 document.body.style.overflow='auto';open();fireEvent.click(await screen.findByRole('link',{name:'View details'}));
 fireEvent.click(await screen.findByRole('button',{name:'Edit Purpose'}));fireEvent.click(screen.getByRole('button',{name:'Save changes'}));
 expect(document.body.style.overflow).toBe('hidden');cleanup();expect(document.body.style.overflow).toBe('auto');document.body.style.overflow='';
});
// AC5: the browser must accept the exact advertised limit; a client off-by-one must not reject valid uploads.
it.each([2*1024*1024-1,2*1024*1024,2*1024*1024+1])('Workflow AC5 - browser file byte boundary %s',async size=>{
 const bytes=new Uint8Array(size);bytes.set([37,80,68,70,45]);const file=new File([bytes],'boundary.pdf',{type:'application/pdf'});
 if(size>2*1024*1024)await expect(readAttachment(file)).rejects.toThrow('2 MB');
 else expect(atob((await readAttachment(file)).data).length).toBe(size);
});
