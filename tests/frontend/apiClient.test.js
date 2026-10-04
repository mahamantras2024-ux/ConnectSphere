// File: Tests actual HTTP serialization, bearer authentication and error handling used by Sprint 1 screens.
import { afterEach, expect, it, vi } from 'vitest';
import { api, API_BASE_URL } from '../../frontend/src/api/client';
afterEach(() => {vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('uses an explicitly configured API URL',async()=>{
 vi.stubEnv('VITE_API_URL','https://api.example.test/api');vi.resetModules();
 const configured=await import('../../frontend/src/api/client');expect(configured.API_BASE_URL).toBe('https://api.example.test/api');
});
it('uses the local API default when no URL is configured',async()=>{
 vi.stubEnv('VITE_API_URL','');vi.resetModules();const configured=await import('../../frontend/src/api/client');expect(configured.API_BASE_URL).toBe('http://localhost:4000/api');
});
it('sends GET, POST, PUT and DELETE with the correct method, payload and session', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, headers: new Headers({ 'content-type':'application/json' }), json: async () => ({ saved: true }) });
  vi.stubGlobal('fetch', fetcher);
  for (const [method, call] of [['GET', () => api.get('/venues','session')], ['POST', () => api.post('/auth/register',{ role:'attendee' },'session')], ['PUT', () => api.put('/venues/1',{ capacity:90 },'session')], ['DELETE', () => api.delete('/venues/1','session')]]) {
    expect(await call()).toEqual({ saved:true });
    expect(fetcher.mock.lastCall[1].method).toBe(method);
    expect(fetcher.mock.lastCall[1].headers.Authorization).toBe('Bearer session');
    expect(fetcher.mock.lastCall[0].startsWith(API_BASE_URL)).toBe(true);
  }
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ role:'attendee' });
  expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({ capacity:90 });
});
it('handles successful text and missing content-type responses without inventing JSON', async () => {
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ ok:true, headers:new Headers(), text:async () => 'healthy' }));
  expect(await api.get('/health')).toBe('healthy');
  expect(fetch.mock.lastCall[1].headers.Authorization).toBeUndefined();
  expect(fetch.mock.lastCall[1].body).toBeUndefined();
});
it('preserves server status, message and booking details and handles empty/text errors safely', async () => {
  for (const [data, message] of [[{message:'Record unavailable',code:'BOOKING_IMPACT'},'Record unavailable'],[null,'Something went wrong. Please try again.'],['Unavailable','Something went wrong. Please try again.']]) {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ ok:false,status:503,headers:new Headers({'content-type':typeof data==='string'?'text/plain':'application/json'}),json:async () => data,text:async () => data }));
    await expect(api.get('/events')).rejects.toMatchObject({message,status:503,details:data});
  }
});
