import { act, render } from '@testing-library/react';
import { useProKeyboardShortcuts } from '../useProKeyboardShortcuts';

const mockStop = jest.fn();
const mockListen = jest.fn().mockResolvedValue(mockStop);
jest.mock('@tauri-apps/api/event',()=>({listen:(...args:unknown[])=>mockListen(...args)}));
jest.mock('@/app/hooks/useTauri',()=>({isTauriEnvironment:()=>true}));
jest.mock('@/app/contexts/GlobalState',()=>({useGlobalState:()=>({toggleChatSidebar:jest.fn(), initializeNewChat:jest.fn(),closeSidebar:jest.fn(),toggleTerminalDock:jest.fn()})}));
jest.mock('@/app/hooks/useChatNavigation',()=>({useChatNavigation:()=>({goHome:jest.fn()})}));
jest.mock('@/app/components/settings/useSettingsNavigation',()=>({useSettingsNavigation:()=>({openSettings:jest.fn()})}));
function Harness(){useProKeyboardShortcuts();return null;}

test('native menu subscription remains stable while context callbacks change',async()=>{
 const view=render(<Harness/>);
 await act(async()=>{});
 expect(mockListen).toHaveBeenCalledTimes(1);
 for(let i=0;i<5;i++)view.rerender(<Harness/>);
 await act(async()=>{});
 expect(mockListen).toHaveBeenCalledTimes(1);
 expect(mockStop).not.toHaveBeenCalled();
 view.unmount();
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));});
 expect(mockStop).toHaveBeenCalledTimes(1);
});
