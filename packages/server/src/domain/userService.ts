import bcrypt from "bcryptjs";
import { getRepository, type UserRecord, type UserRole } from "../db";
import { ValidationError } from "../errors";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CreateUserRequest {
  email: string;
  role: UserRole;
  displayName?: string | null;
  password?: string;
}

export async function listUsers(): Promise<UserRecord[]> {
  return getRepository().listUsers();
}

export async function createUser(input: CreateUserRequest, actorId: string): Promise<UserRecord> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new ValidationError("INVALID_EMAIL", "A valid email address is required.");
  }
  if (input.role !== "admin" && input.role !== "member") {
    throw new ValidationError("INVALID_ROLE", "role must be 'admin' or 'member'.");
  }
  const repo = getRepository();
  const existing = await repo.findUserByEmail(email);
  if (existing) {
    throw new ValidationError("EMAIL_IN_USE", "A user with that email already exists.");
  }
  const passwordHash = input.password ? await bcrypt.hash(input.password, 12) : null;
  const user = await repo.createUser({
    email,
    role: input.role,
    displayName: input.displayName ?? null,
    passwordHash,
  });
  await repo.insertAuditLog({
    actorId,
    action: "USER_CREATED",
    entityType: "user",
    entityId: user.id,
    details: { email: user.email, role: user.role },
  });
  return user;
}

export interface UpdateUserRequest {
  role?: UserRole;
  isActive?: boolean;
  displayName?: string | null;
}

/** Prevents an admin from demoting or deactivating their own account, which would lock everyone out with no admin left to fix it. */
function assertNotSelfLockout(targetId: string, actorId: string, patch: UpdateUserRequest): void {
  if (targetId !== actorId) return;
  if (patch.role === "member") {
    throw new ValidationError("SELF_DEMOTION_FORBIDDEN", "You cannot remove your own admin access.");
  }
  if (patch.isActive === false) {
    throw new ValidationError("SELF_DEACTIVATION_FORBIDDEN", "You cannot deactivate your own account.");
  }
}

export async function updateUser(targetId: string, patch: UpdateUserRequest, actorId: string): Promise<UserRecord> {
  assertNotSelfLockout(targetId, actorId, patch);
  const repo = getRepository();
  const existing = await repo.findUserById(targetId);
  if (!existing) {
    throw new ValidationError("USER_NOT_FOUND", "User not found.");
  }
  const user = await repo.updateUser(targetId, {
    role: patch.role,
    isActive: patch.isActive,
    displayName: patch.displayName,
  });
  await repo.insertAuditLog({
    actorId,
    action: "USER_UPDATED",
    entityType: "user",
    entityId: user.id,
    details: { ...patch },
  });
  return user;
}

export async function deactivateUser(targetId: string, actorId: string): Promise<void> {
  assertNotSelfLockout(targetId, actorId, { isActive: false });
  const repo = getRepository();
  const existing = await repo.findUserById(targetId);
  if (!existing) {
    throw new ValidationError("USER_NOT_FOUND", "User not found.");
  }
  await repo.deleteUser(targetId);
  await repo.insertAuditLog({
    actorId,
    action: "USER_DEACTIVATED",
    entityType: "user",
    entityId: targetId,
  });
}
