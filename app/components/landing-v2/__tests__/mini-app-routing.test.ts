import { BUILD_RUNS, routePrompt } from "../mini-app-surfaces";

/**
 * The demo has to answer the question it was asked.
 *
 * The hero's input invites the visitor to "build, fix or investigate", and the
 * frame below has five surfaces. Getting a code diff back after asking for a
 * security audit is a wrong answer, not a near miss — and it is the kind of
 * wrong answer that reads as "this is a canned animation", which is exactly the
 * impression the frame exists to defeat.
 *
 * Two real failures this locks out, both found by typing into the live page:
 *
 *  1. "audit my server for exposed services" ran the rate-limiting scenario,
 *     because the first matcher took the first run containing any of its terms
 *     and `server` appeared in that run's list. One incidental shared word
 *     outvoted the verb the sentence was built around.
 *  2. Every prompt landed on Build, so "investigate" — one of the three verbs
 *     the placeholder promises — had nowhere to go.
 */
describe("mini app routing", () => {
  it.each([
    "audit my server for exposed services",
    "scan this host",
    "check the site for vulnerabilities",
    "investigate what is exposed",
  ])("sends %p to the workbench", (prompt) => {
    expect(routePrompt(prompt).surface).toBe("workbench");
  });

  it.each([
    "render a product film",
    "make me an image of a car",
    "generate a video of the product",
  ])("sends %p to studio", (prompt) => {
    expect(routePrompt(prompt).surface).toBe("studio");
  });

  it.each([
    ["the pricing test is failing, find out why and fix it", "test"],
    ["build a gravity simulation with bouncing balls", "game"],
    ["add rate limiting to the public API", "api"],
  ])("runs %p as the %p scenario", (prompt, id) => {
    const route = routePrompt(prompt);
    expect(route.surface).toBe("build");
    expect(route.run?.id).toBe(id);
  });

  it("scores every term rather than stopping at the first hit", () => {
    // "server" belongs to the api run and nothing else in this sentence does,
    // so a first-match scan picks api. The verb has to win instead.
    expect(routePrompt("audit my server").surface).toBe("workbench");

    // Two api terms beat one game term.
    const mixed = routePrompt("build rate limiting for the api endpoint");
    expect(mixed.run?.id).toBe("api");
  });

  it("always returns something runnable", () => {
    for (const prompt of ["hello", "", "??", "merhaba"]) {
      const route = routePrompt(prompt);
      if (route.surface === "build") {
        expect(route.run).toBeDefined();
        expect(BUILD_RUNS).toContain(route.run);
      }
    }
  });
});
