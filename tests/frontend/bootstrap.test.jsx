// File: Verifies the browser entry point mounts the routed application with authentication and StrictMode.
import {expect,it,vi} from 'vitest';
const entry=vi.hoisted(()=>({render:vi.fn(),createRoot:vi.fn()}));
vi.mock('react-dom/client',()=>({default:{createRoot:entry.createRoot}}));
it('mounts the application in the root element',async()=>{
 const root=document.createElement('div');root.id='root';document.body.append(root);entry.createRoot.mockReturnValue({render:entry.render});
 await import('../../frontend/src/main.jsx');expect(entry.createRoot).toHaveBeenCalledWith(root);expect(entry.render).toHaveBeenCalledOnce();
 const tree=entry.render.mock.calls[0][0];expect(tree.props.children.type.name).toBe('AuthProvider');expect(tree.props.children.props.children.type.name).toBe('BrowserRouter');root.remove();
});
