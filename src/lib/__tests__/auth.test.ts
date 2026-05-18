// @vitest-environment node
import { describe, test, expect, vi, beforeEach } from "vitest";
import { SignJWT, jwtVerify } from "jose";

vi.mock("server-only", () => ({}));

const mockCookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve(mockCookieStore)),
}));

import { createSession, getSession, deleteSession, verifySession } from "@/lib/auth";

const TEST_SECRET = new TextEncoder().encode("development-secret-key");
const COOKIE_NAME = "auth-token";

async function makeToken(payload: Record<string, unknown>, expiresIn = "7d") {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresIn)
    .setIssuedAt()
    .sign(TEST_SECRET);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createSession", () => {
  test("sets a cookie with the correct name", async () => {
    await createSession("user-1", "user@example.com");

    expect(mockCookieStore.set).toHaveBeenCalledOnce();
    const [name] = mockCookieStore.set.mock.calls[0];
    expect(name).toBe(COOKIE_NAME);
  });

  test("cookie value is a valid signed JWT containing userId and email", async () => {
    await createSession("user-1", "user@example.com");

    const [, token] = mockCookieStore.set.mock.calls[0];
    const { payload } = await jwtVerify(token, TEST_SECRET);
    expect(payload.userId).toBe("user-1");
    expect(payload.email).toBe("user@example.com");
  });

  test("sets httpOnly cookie with lax sameSite", async () => {
    await createSession("user-1", "user@example.com");

    const [, , options] = mockCookieStore.set.mock.calls[0];
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
  });

  test("cookie expires in approximately 7 days", async () => {
    const before = Date.now();
    await createSession("user-1", "user@example.com");
    const after = Date.now();

    const [, , options] = mockCookieStore.set.mock.calls[0];
    const expiresMs = options.expires instanceof Date
      ? options.expires.getTime()
      : 0;

    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(expiresMs).toBeGreaterThanOrEqual(before + sevenDaysMs - 1000);
    expect(expiresMs).toBeLessThanOrEqual(after + sevenDaysMs + 1000);
  });
});

describe("getSession", () => {
  test("returns null when no cookie exists", async () => {
    mockCookieStore.get.mockReturnValue(undefined);

    const session = await getSession();
    expect(session).toBeNull();
  });

  test("returns null when cookie contains an invalid JWT", async () => {
    mockCookieStore.get.mockReturnValue({ value: "not-a-valid-token" });

    const session = await getSession();
    expect(session).toBeNull();
  });

  test("returns null when JWT is expired", async () => {
    const token = await makeToken(
      { userId: "user-1", email: "user@example.com" },
      "-1s"
    );
    mockCookieStore.get.mockReturnValue({ value: token });

    const session = await getSession();
    expect(session).toBeNull();
  });

  test("returns session payload for a valid JWT", async () => {
    const token = await makeToken({ userId: "user-1", email: "user@example.com" });
    mockCookieStore.get.mockReturnValue({ value: token });

    const session = await getSession();
    expect(session?.userId).toBe("user-1");
    expect(session?.email).toBe("user@example.com");
  });

  test("reads from the correct cookie name", async () => {
    mockCookieStore.get.mockReturnValue(undefined);

    await getSession();
    expect(mockCookieStore.get).toHaveBeenCalledWith(COOKIE_NAME);
  });
});

describe("deleteSession", () => {
  test("deletes the auth cookie by name", async () => {
    await deleteSession();
    expect(mockCookieStore.delete).toHaveBeenCalledOnce();
    expect(mockCookieStore.delete).toHaveBeenCalledWith(COOKIE_NAME);
  });
});

describe("verifySession", () => {
  test("returns null when request has no auth cookie", async () => {
    const request = { cookies: { get: () => undefined } } as any;

    const session = await verifySession(request);
    expect(session).toBeNull();
  });

  test("returns null when JWT in request is invalid", async () => {
    const request = {
      cookies: { get: () => ({ value: "invalid-token" }) },
    } as any;

    const session = await verifySession(request);
    expect(session).toBeNull();
  });

  test("returns null when JWT in request is expired", async () => {
    const token = await makeToken(
      { userId: "user-1", email: "user@example.com" },
      "-1s"
    );
    const request = { cookies: { get: () => ({ value: token }) } } as any;

    const session = await verifySession(request);
    expect(session).toBeNull();
  });

  test("returns session payload for a valid JWT in request", async () => {
    const token = await makeToken({ userId: "user-1", email: "user@example.com" });
    const request = { cookies: { get: () => ({ value: token }) } } as any;

    const session = await verifySession(request);
    expect(session?.userId).toBe("user-1");
    expect(session?.email).toBe("user@example.com");
  });

  test("reads the correct cookie name from the request", async () => {
    const getCookie = vi.fn((name: string) =>
      name === COOKIE_NAME ? { value: "invalid" } : undefined
    );
    const request = { cookies: { get: getCookie } } as any;

    await verifySession(request);
    expect(getCookie).toHaveBeenCalledWith(COOKIE_NAME);
  });
});
