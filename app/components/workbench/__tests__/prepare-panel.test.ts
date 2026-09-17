const mockTerminal = jest.fn();
const mockDetail = jest.fn();
jest.mock('../WorkbenchDock', () => ({}));
jest.mock('../../terminal/TerminalDock', () => { mockTerminal(); return {}; });
jest.mock('../../ComputerSidebar', () => { mockDetail(); return {}; });
import { prepareWorkbenchPanel } from '../prepare-panel';
it('warms the real terminal without loading the unrelated detail renderer', async () => {
  prepareWorkbenchPanel('terminal');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(mockTerminal).toHaveBeenCalledTimes(1);
  expect(mockDetail).not.toHaveBeenCalled();
});
