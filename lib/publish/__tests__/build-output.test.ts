import {
  contentTypeFor,
  isPublishablePath,
  listBuildOutputCommand,
  shellQuote,
} from "../build-output";

describe("build output rules", () => {
  it("types the files a built web app actually contains", () => {
    expect(contentTypeFor("index.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeFor("assets/index-a1b2.js")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(contentTypeFor("og.jpg")).toBe("image/jpeg");
    expect(contentTypeFor("car.glb")).toBe("model/gltf-binary");
    expect(contentTypeFor("physics.wasm")).toBe("application/wasm");
    // An unknown extension must not be guessed into something executable.
    expect(contentTypeFor("weird.qqq")).toBe("application/octet-stream");
  });

  it("refuses to publish secrets a bundler copied into the output", () => {
    // Vite copies everything in `public/` verbatim, so a stray .env landing in
    // dist/ is an ordinary accident — and publishing it would put it on the
    // open web under the user's own domain.
    expect(isPublishablePath(".env")).toBe(false);
    expect(isPublishablePath(".env.local")).toBe(false);
    expect(isPublishablePath("nested/.env.production")).toBe(false);
    expect(isPublishablePath(".git/config")).toBe(false);
    expect(isPublishablePath("node_modules/react/index.js")).toBe(false);
  });

  it("refuses paths that climb out of the output directory", () => {
    expect(isPublishablePath("../../etc/passwd")).toBe(false);
    expect(isPublishablePath("assets/../../secret")).toBe(false);
    expect(isPublishablePath("/etc/passwd")).toBe(false);
    expect(isPublishablePath("")).toBe(false);
  });

  it("publishes ordinary build output", () => {
    expect(isPublishablePath("index.html")).toBe(true);
    expect(isPublishablePath("assets/index-a1b2.js")).toBe(true);
    expect(isPublishablePath("models/car.glb")).toBe(true);
  });

  it("quotes paths so a directory name cannot become a command", () => {
    expect(shellQuote("/home/user/my app")).toBe("'/home/user/my app'");
    expect(shellQuote("/tmp/x'; rm -rf /")).toBe(`'/tmp/x'\\''; rm -rf /'`);
    expect(listBuildOutputCommand("/home/user/a'b")).toContain(
      `cd '/home/user/a'\\''b'`,
    );
  });
});
