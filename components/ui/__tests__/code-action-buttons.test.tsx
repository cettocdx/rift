import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CodeActionButtons } from "../code-action-buttons";
import { TooltipProvider } from "../tooltip";

it("copies original code without changing indentation or trailing newlines", async () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  const content = "    return 'Türkçe'\n\n";
  render(
    <TooltipProvider>
      <CodeActionButtons content={content} isWrapped onToggleWrap={() => {}} />
    </TooltipProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy", exact: true }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(content));
});
