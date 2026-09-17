import { archiveMessage } from '../archive-message';
import { getConvexClient } from '../convex-client';
jest.mock('../convex-client', () => ({ getConvexClient: jest.fn() }));
jest.mock('@/convex/_generated/api', () => ({api: {s3Actions: {generateSandboxUploadUrlAction: 'upload'}, fileActions: {saveSandboxGeneratedFile: 'save'}}}));
describe('full message archive', () => {
  const action = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    (getConvexClient as jest.Mock).mockReturnValue({action});
    global.fetch = jest.fn();
  });
  it('stores the exact original before returning an attachment', async () => {
    action.mockResolvedValueOnce({backend:'convex',uploadUrl:'https://storage.example/upload'})
      .mockResolvedValueOnce({fileId:'file-1',url:'https://storage.example/file',tokens:0});
    (fetch as jest.Mock).mockResolvedValue({ok:true,json:async()=>({storageId:'storage-1'})});
    const message = {id:'run-1',role:'assistant' as const,parts:[{type:'text' as const,text:'ğ🙂'.repeat(400000)}]};
    const file = await archiveMessage({message,userId:'user-1',serviceKey:'test-key'});
    expect(JSON.parse((fetch as jest.Mock).mock.calls[0][1].body)).toEqual(message);
    expect(file).toMatchObject({type:'file',fileId:'file-1',mediaType:'application/json'});
    expect(action.mock.calls[1][1]).toMatchObject({storageId:'storage-1',userId:'user-1'});
  });
  it('does not return a dangling reference when upload fails', async () => {
    action.mockResolvedValueOnce({backend:'s3',uploadUrl:'https://storage.example/upload',s3Key:'key'});
    (fetch as jest.Mock).mockResolvedValue({ok:false,status:503});
    await expect(archiveMessage({message:{id:'x',role:'assistant',parts:[]},userId:'u',serviceKey:'k'})).rejects.toThrow('503');
    expect(action).toHaveBeenCalledTimes(1);
  });
});
