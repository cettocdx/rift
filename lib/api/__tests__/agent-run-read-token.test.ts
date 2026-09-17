/** @jest-environment node */
jest.mock("@trigger.dev/core/v3", () => ({
  apiClientManager: {},
  generateJWT: jest.fn(),
}));
import { createRunReadTokenFactory } from "../agent-run-read-token";
const setup = () => {
  let clock = 0;
  let client = {
    accessToken: "secret-test",
    baseUrl: "https://api.example",
    generateJWTClaims: jest.fn(async () => ({ sub: "env-test", pub: true })),
  };
  const sign = jest.fn(async (args: unknown) => JSON.stringify(args));
  const create = createRunReadTokenFactory({
    getClient: () => client,
    sign,
    now: () => clock,
  });
  return {
    create,
    sign,
    get client() {
      return client;
    },
    rotate() {
      client = {
        ...client,
        accessToken: "rotated-test",
        generateJWTClaims: jest.fn(async () => ({
          sub: "env-other",
          pub: true,
        })),
      };
    },
    advance() {
      clock += 60001;
    },
  };
};
it("shares environment discovery but signs separate read-only tokens for each run", async () => {
  const test = setup();
  await Promise.all([test.create("run_a"), test.create("run_b")]);
  expect(test.client.generateJWTClaims).toHaveBeenCalledTimes(1);
  expect(test.sign.mock.calls.map(([arg]) => arg)).toEqual([
    {
      secretKey: "secret-test",
      payload: { sub: "env-test", pub: true, scopes: ["read:runs:run_a"] },
      expirationTime: "6h",
    },
    {
      secretKey: "secret-test",
      payload: { sub: "env-test", pub: true, scopes: ["read:runs:run_b"] },
      expirationTime: "6h",
    },
  ]);
});
it("refreshes expired environment claims", async () => {
  const test = setup();
  await test.create("run_a");
  test.advance();
  await test.create("run_b");
  expect(test.client.generateJWTClaims).toHaveBeenCalledTimes(2);
});
it("never reuses claims across credential rotation", async () => {
  const test = setup();
  await test.create("run_a");
  test.rotate();
  await test.create("run_b");
  expect(test.sign).toHaveBeenLastCalledWith(
    expect.objectContaining({
      secretKey: "rotated-test",
      payload: { sub: "env-other", pub: true, scopes: ["read:runs:run_b"] },
    }),
  );
});
it("does not sign on a discovery failure and allows the next request to retry", async () => {
  const test = setup();
  test.client.generateJWTClaims.mockRejectedValueOnce(new Error("offline"));
  await expect(test.create("run_a")).rejects.toThrow("offline");
  expect(test.sign).not.toHaveBeenCalled();
  await test.create("run_b");
  expect(test.client.generateJWTClaims).toHaveBeenCalledTimes(2);
});

it("does not sign malformed discovery claims and retries on the next call", async () => {
  const test = setup();
  test.client.generateJWTClaims.mockResolvedValueOnce({} as never);
  await expect(test.create("run_a")).rejects.toThrow(
    "Invalid Trigger environment claims",
  );
  expect(test.sign).not.toHaveBeenCalled();
  await test.create("run_b");
  expect(test.client.generateJWTClaims).toHaveBeenCalledTimes(2);
});
it("does not reuse claims after switching the API host", async () => {
  const test = setup();
  await test.create("run_a");
  test.client.baseUrl = "https://another.example";
  await test.create("run_b");
  expect(test.client.generateJWTClaims).toHaveBeenCalledTimes(2);
});

it("prepares discovery without signing and shares it with later run tokens", async () => {
  const test = setup();
  await test.create.prepare();
  expect(test.sign).not.toHaveBeenCalled();
  await test.create("run_a");
  expect(test.client.generateJWTClaims).toHaveBeenCalledTimes(1);
  expect(test.sign).toHaveBeenCalledTimes(1);
});
it("revalidates credentials after preparation", async () => {
  const test = setup();
  await test.create.prepare();
  test.rotate();
  await test.create("run_a");
  expect(test.sign).toHaveBeenCalledWith(expect.objectContaining({secretKey:"rotated-test"}));
});
