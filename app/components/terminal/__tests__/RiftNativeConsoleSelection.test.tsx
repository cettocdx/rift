import { render, screen } from "@testing-library/react";
import { RiftAgentConsole } from "../RiftAgentConsole";
import { isTauriEnvironment } from "@/app/hooks/useTauri";
const mockCloud = jest.fn(() => ({}));
jest.mock("../useRiftConsoleRuntime", () => ({
  useRiftConsoleRuntime: () => mockCloud(),
}));
jest.mock("../RiftConsoleView", () => ({
  RiftConsoleView: () => <div>Cloud console</div>,
}));
jest.mock("../RiftNativeConsole", () => ({
  RiftNativeConsole: () => <div>Native setup error</div>,
}));
jest.mock("@/app/hooks/useTauri", () => ({ isTauriEnvironment: jest.fn() }));
const originalFlag = process.env.NEXT_PUBLIC_RIFT_NATIVE_CONSOLE;
afterEach(() => {
  process.env.NEXT_PUBLIC_RIFT_NATIVE_CONSOLE = originalFlag;
  mockCloud.mockClear();
});
test("desktop native setup failure never mounts Cloud runtime", () => {
  process.env.NEXT_PUBLIC_RIFT_NATIVE_CONSOLE = "true";
  (isTauriEnvironment as jest.Mock).mockReturnValue(true);
  render(<RiftAgentConsole />);
  expect(screen.getByText("Native setup error")).toBeTruthy();
  expect(mockCloud).not.toHaveBeenCalled();
});
test("web stays on Cloud with native development switch enabled", () => {
  process.env.NEXT_PUBLIC_RIFT_NATIVE_CONSOLE = "true";
  (isTauriEnvironment as jest.Mock).mockReturnValue(false);
  render(<RiftAgentConsole />);
  expect(screen.getByText("Cloud console")).toBeTruthy();
  expect(mockCloud).toHaveBeenCalled();
});
