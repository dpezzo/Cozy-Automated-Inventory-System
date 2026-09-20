import { describe, it, expect, vi, beforeEach } from "vitest";

const findUserByEmail = vi.fn();
const findUserById = vi.fn();
const createUserMock = vi.fn();
const updateUserMock = vi.fn();
const deleteUserMock = vi.fn();
const insertAuditLog = vi.fn();

vi.mock("../db", () => ({
  getRepository: () => ({
    findUserByEmail,
    findUserById,
    createUser: createUserMock,
    updateUser: updateUserMock,
    deleteUser: deleteUserMock,
    insertAuditLog,
  }),
}));

function existingUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "u1",
    email: "member@example.com",
    passwordHash: null,
    role: "member",
    googleId: null,
    displayName: null,
    isActive: true,
    ...overrides,
  };
}

describe("userService", () => {
  beforeEach(() => {
    findUserByEmail.mockReset();
    findUserById.mockReset();
    createUserMock.mockReset();
    updateUserMock.mockReset();
    deleteUserMock.mockReset();
    insertAuditLog.mockReset();
  });

  describe("createUser", () => {
    it("rejects a malformed email", async () => {
      const { createUser } = await import("./userService");
      await expect(createUser({ email: "not-an-email", role: "member" }, "actor-1")).rejects.toMatchObject({
        code: "INVALID_EMAIL",
      });
      expect(createUserMock).not.toHaveBeenCalled();
    });

    it("rejects a duplicate email", async () => {
      findUserByEmail.mockResolvedValue(existingUser());
      const { createUser } = await import("./userService");
      await expect(createUser({ email: "member@example.com", role: "member" }, "actor-1")).rejects.toMatchObject({
        code: "EMAIL_IN_USE",
      });
      expect(createUserMock).not.toHaveBeenCalled();
    });

    it("creates a Google-only user with no password and writes an audit log entry", async () => {
      findUserByEmail.mockResolvedValue(null);
      createUserMock.mockResolvedValue(existingUser({ id: "u2" }));
      const { createUser } = await import("./userService");
      const user = await createUser({ email: "new@example.com", role: "member" }, "actor-1");
      expect(user.id).toBe("u2");
      expect(createUserMock).toHaveBeenCalledWith(
        expect.objectContaining({ email: "new@example.com", role: "member", passwordHash: null }),
      );
      expect(insertAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "USER_CREATED", actorId: "actor-1" }));
    });
  });

  describe("updateUser self-protection", () => {
    it("rejects an admin demoting themselves to member", async () => {
      const { updateUser } = await import("./userService");
      await expect(updateUser("actor-1", { role: "member" }, "actor-1")).rejects.toMatchObject({
        code: "SELF_DEMOTION_FORBIDDEN",
      });
      expect(updateUserMock).not.toHaveBeenCalled();
    });

    it("rejects an admin deactivating themselves", async () => {
      const { updateUser } = await import("./userService");
      await expect(updateUser("actor-1", { isActive: false }, "actor-1")).rejects.toMatchObject({
        code: "SELF_DEACTIVATION_FORBIDDEN",
      });
      expect(updateUserMock).not.toHaveBeenCalled();
    });

    it("allows updating a different user", async () => {
      findUserById.mockResolvedValue(existingUser());
      updateUserMock.mockResolvedValue(existingUser({ role: "admin" }));
      const { updateUser } = await import("./userService");
      const result = await updateUser("u1", { role: "admin" }, "actor-1");
      expect(result.role).toBe("admin");
      expect(insertAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "USER_UPDATED" }));
    });

    it("rejects updating a user that does not exist", async () => {
      findUserById.mockResolvedValue(null);
      const { updateUser } = await import("./userService");
      await expect(updateUser("ghost", { role: "admin" }, "actor-1")).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
    });
  });

  describe("deactivateUser", () => {
    it("rejects deactivating yourself", async () => {
      const { deactivateUser } = await import("./userService");
      await expect(deactivateUser("actor-1", "actor-1")).rejects.toMatchObject({ code: "SELF_DEACTIVATION_FORBIDDEN" });
      expect(deleteUserMock).not.toHaveBeenCalled();
    });

    it("soft-deletes another user and logs it", async () => {
      findUserById.mockResolvedValue(existingUser());
      const { deactivateUser } = await import("./userService");
      await deactivateUser("u1", "actor-1");
      expect(deleteUserMock).toHaveBeenCalledWith("u1");
      expect(insertAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "USER_DEACTIVATED" }));
    });
  });
});
