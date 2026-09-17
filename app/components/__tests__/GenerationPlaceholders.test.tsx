import { render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";

import {
  CreativeGenerationProgress,
  GeneratingImagePlaceholder,
  getCreativeGenerationPhases,
} from "../GeneratingImagePlaceholder";
import { MessagePartHandler } from "../MessagePartHandler";

describe("creative generation progress", () => {
  it("maps real tool events to truthful image phases", () => {
    expect(
      getCreativeGenerationPhases("image", "input-streaming").map(
        ({ label, status }) => [label, status],
      ),
    ).toEqual([
      ["Brief analysis", "active"],
      ["Art direction", "pending"],
      ["Model preparation and generation", "pending"],
      ["Output check", "pending"],
      ["Delivery", "pending"],
    ]);

    expect(
      getCreativeGenerationPhases("image", "input-available").map(
        ({ status }) => status,
      ),
    ).toEqual(["done", "done", "active", "pending", "pending"]);
  });

  it("uses a motion-specific video plan without inventing sub-job progress", () => {
    const phases = getCreativeGenerationPhases("video", "input-available");

    expect(phases[1]).toMatchObject({
      label: "Motion plan",
      status: "done",
    });
    expect(phases.filter(({ status }) => status === "active")).toEqual([
      expect.objectContaining({ id: "generation" }),
    ]);
    expect(phases.slice(3).map(({ status }) => status)).toEqual([
      "pending",
      "pending",
    ]);
  });

  it("uses reduced-motion-safe active indicators and accessible live state", () => {
    const { container } = render(<GeneratingImagePlaceholder />);

    const status = screen.getByRole("status", { name: "Creating image" });
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveAccessibleDescription("This can take a moment.");

    const scan = screen.getByTestId("creative-run-scan");
    const activeIndicator = screen.getByTestId("creative-run-active-indicator");
    expect(scan).toHaveClass("motion-reduce:animate-none");
    expect(activeIndicator).toHaveClass(
      "motion-safe:animate-spin",
      "motion-reduce:animate-none",
    );
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0);
    expect(container.querySelectorAll(".animate-spin")).toHaveLength(0);
    expect(
      container.querySelector('[data-phase="generation"]'),
    ).toHaveAttribute("data-status", "active");
    expect(container).not.toHaveTextContent(/\d+%/);
    expect(container.innerHTML).not.toMatch(/(?:sky|blue|cyan)-/);
  });

  it("uses a safe brief and allowlisted aspect ratio from the image tool", () => {
    render(
      <GeneratingImagePlaceholder
        brief={"  A quiet architectural portrait\nwith soft daylight.  "}
        aspectRatio="16:9"
      />,
    );

    const status = screen.getByRole("status", { name: "Creating image" });
    expect(status).toHaveClass("aspect-video", "max-w-[640px]");
    expect(status).toHaveAccessibleDescription(
      "A quiet architectural portrait with soft daylight.",
    );
  });

  it("falls back safely when progress metadata is malformed", () => {
    const { container } = render(
      <GeneratingImagePlaceholder
        brief={{ text: "Do not render this object" }}
        aspectRatio="16:9 bg-red-500"
      />,
    );

    const status = screen.getByRole("status", { name: "Creating image" });
    expect(status).toHaveClass("aspect-square", "max-w-lg");
    expect(status).toHaveAccessibleDescription("This can take a moment.");
    expect(container.innerHTML).not.toContain("bg-red-500");
  });

  it("wires image-tool metadata into progress and the completed large frame", () => {
    const input = {
      brief: "A calm editorial landscape in winter light",
      aspectRatio: "16:9",
    };
    const progressPart = {
      type: "tool-generate_image",
      state: "input-available",
      toolCallId: "image-1",
      input,
    };
    const message = {
      id: "assistant-image-1",
      role: "assistant",
      parts: [progressPart],
    } as unknown as UIMessage;

    const progress = render(
      <MessagePartHandler
        message={message}
        part={progressPart}
        partIndex={0}
        status="ready"
      />,
    );

    expect(
      screen.getByRole("status", { name: "Creating image" }),
    ).toHaveAccessibleDescription(input.brief);
    expect(screen.getByRole("status", { name: "Creating image" })).toHaveClass(
      "aspect-video",
    );

    progress.unmount();

    const completedPart = {
      ...progressPart,
      state: "output-available",
      output: {
        url: "https://images.example.com/generated.png",
        mediaType: "image/png",
      },
    };
    const completed = render(
      <MessagePartHandler
        message={{ ...message, parts: [completedPart] } as unknown as UIMessage}
        part={completedPart}
        partIndex={0}
        status="ready"
      />,
    );

    const image = screen.getByRole("img", { name: input.brief });
    const frame = completed.container.firstElementChild;
    const openButton = screen.getByRole("button", {
      name: `View ${input.brief} in full size`,
    });

    expect(frame).toHaveClass(
      "max-w-[640px]",
      "rounded-xl",
      "bg-muted/25",
      "ring-1",
      "ring-inset",
    );
    expect(frame).not.toHaveClass("border", "p-1");
    expect(openButton).toHaveClass("cursor-zoom-in", "rounded-[inherit]");
    expect(frame).toHaveClass("aspect-video");
    expect(image).not.toHaveClass("rounded-[3px]");
  });

  it("wires only the public video brief and safe layout into progress", () => {
    const secretPrompt =
      "PRIVATE PRODUCTION PROMPT with provider routing and internal references";
    const input = {
      brief: "A slow cinematic orbit around a glass sculpture",
      prompt: secretPrompt,
      aspectRatio: "9:16",
      generateAudio: true,
    };
    const progressPart = {
      type: "tool-generate_video",
      state: "input-available",
      toolCallId: "video-1",
      input,
    };
    const message = {
      id: "assistant-video-1",
      role: "assistant",
      parts: [progressPart],
    } as unknown as UIMessage;
    const { container } = render(
      <MessagePartHandler
        message={message}
        part={progressPart}
        partIndex={0}
        status="streaming"
      />,
    );

    const status = screen.getByRole("status", { name: "Rendering video" });
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAccessibleDescription(input.brief);
    expect(status).toHaveClass("aspect-[9/16]", "max-w-[22rem]");
    expect(
      screen.getByText(/Preparing the model, frames, and motion/i),
    ).toBeVisible();
    expect(container).not.toHaveTextContent(secretPrompt);
    expect(container).not.toHaveTextContent(/audio/i);
    expect(container.innerHTML).not.toMatch(/(?:sky|blue|cyan)-/);
  });

  it("renders a completed run as done and no longer busy", () => {
    const { container } = render(
      <CreativeGenerationProgress kind="video" state="output-available" />,
    );

    expect(screen.getByRole("status", { name: "Video ready" })).toHaveAttribute(
      "aria-busy",
      "false",
    );
    expect(container.querySelectorAll('[data-status="done"]')).toHaveLength(5);
    expect(
      screen.queryByTestId("creative-run-active-indicator"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("creative-run-scan")).not.toBeInTheDocument();
  });

  it("renders a stopped run as an accessible error without active motion", () => {
    const { container } = render(
      <CreativeGenerationProgress
        errorMessage="The provider did not return a supported file."
        kind="image"
        state="output-error"
      />,
    );

    const alert = screen.getByRole("alert", {
      name: "Image generation stopped",
    });
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(alert).toHaveAttribute("aria-busy", "false");
    expect(alert).toHaveAccessibleDescription(
      "This can take a moment. The provider did not return a supported file.",
    );
    expect(
      container.querySelector('[data-phase="generation"]'),
    ).toHaveAttribute("data-status", "error");
    expect(
      screen.queryByTestId("creative-run-active-indicator"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("creative-run-scan")).not.toBeInTheDocument();
  });
});
