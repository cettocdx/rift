import {render,screen,fireEvent} from '@testing-library/react';
import {ToolApprovalCard} from '../ToolApprovalRequests';
import type {Id} from '@/convex/_generated/dataModel';
const base={_id:'approval-1' as Id<'tool_approvals'>,toolName:'delegate_task',expiresAt:123};
test('readable approval preserves full content and keeps exact payload available',()=>{
 const preview=JSON.stringify({agentId:'quality',task:'Check every audio control.',context:'Keep existing shortcuts.',extra:{unknown:'must remain visible'}});
 const decide=jest.fn();render(<ToolApprovalCard request={{...base,preview}} onRespond={decide}/>);
 expect(screen.getByText('Check every audio control.')).toBeVisible();expect(screen.getByText('Keep existing shortcuts.')).toBeVisible();
 const details=screen.getByText('Technical details').closest('details')!;
 expect(details.textContent).toContain(preview);expect(screen.getByText(/"unknown": "must remain visible"/)).toBeInTheDocument();
 expect(decide).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Allow once'}));expect(decide).toHaveBeenCalledWith('approval-1',true);
});
test('malformed or truncated previews remain intact and busy decisions are disabled',()=>{
 const preview='{"command":"printf hello", "rest":';const decide=jest.fn();render(<ToolApprovalCard request={{...base,preview}} busy onRespond={decide}/>);
 expect(screen.getByText(preview)).toBeVisible();expect(screen.queryByText('Technical details')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Allow once'}));expect(decide).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Deny'})).toBeDisabled();
});
