import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

const findUserByEmail = vi.fn();

vi.mock("./db", () => ({
  getRepository: () => ({ findUserByEmail }),
}));

function fakeRes() {
  const res: Partial<Response> & { statusCode?: number; body?: unknown } = {};
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res as Response;
  });
  res.json = vi.fn((body: unknown) => {
    res.body = body;
    return res as Response;
  });
  return res as Response & { statusCode?: number; body?: unknown };
}

describe("requireAuth", () => {
  it("rejects a request with no session userId", async () => {
    const { requireAuth } = await import("./auth");
    const req = { session: {} } as Request;
    const res = fakeRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next when a session userId is present", async () => {
    const { requireAuth } = await import("./auth");
    const req = { session: { userId: "u1" } } as Request;
    const res = fakeRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe("requireAdmin", () => {
  it("returns 403 for a non-admin session", async () => {
    const { requireAdmin } = await import("./auth");
    const req = { session: { userId: "u1", role: "member" } } as Request;
    const res = fakeRes();
    const next = vi.fn();
    requireAdmin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "FORBIDDEN", message: "Admin access required." });
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next for an admin session", async () => {
    const { requireAdmin } = await import("./auth");
    const req = { session: { userId: "u1", role: "admin" } } as Request;
    const res = fakeRes();
    const next = vi.fn();
    requireAdmin(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe("verifyCredentials", () => {
  beforeEach(() => {
    findUserByEmail.mockReset();
  });

  it("rejects a deactivated user without leaking that the account exists", async () => {
    findUserByEmail.mockResolvedValue({
      id: "u1",
      email: "a@example.com",
      passwordHash: "$2a$12$abcdefghijklmnopqrstuuvwxyzabcdefghijklmnopqrstuvwx",
      role: "member",
      googleId: null,
      displayName: null,
      isActive: false,
    });
    const { verifyCredentials } = await import("./auth");
    const result = await verifyCredentials("a@example.com", "whatever");
    expect(result).toBeNull();
  });

  it("rejects a Google-only user (no password hash) attempting password login", async () => {
    findUserByEmail.mockResolvedValue({
      id: "u1",
      email: "a@example.com",
      passwordHash: null,
      role: "member",
      googleId: "google-sub-1",
      displayName: null,
      isActive: true,
    });
    const { verifyCredentials } = await import("./auth");
    const result = await verifyCredentials("a@example.com", "whatever");
    expect(result).toBeNull();
  });

  it("returns null for an unknown email", async () => {
    findUserByEmail.mockResolvedValue(null);
    const { verifyCredentials } = await import("./auth");
    const result = await verifyCredentials("nobody@example.com", "whatever");
    expect(result).toBeNull();
  });
});
