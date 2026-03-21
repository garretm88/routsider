import bcrypt from "bcryptjs";
import { getRedis } from "./kv";

const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days in seconds

// ─── Types ───────────────────────────────────────────────

interface StoredUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
}

export interface SafeUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

interface Session {
  userId: string;
  createdAt: string;
}

// ─── Password helpers ────────────────────────────────────

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ─── User CRUD ───────────────────────────────────────────

function sanitize(user: StoredUser): SafeUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
  };
}

export async function countUsers(): Promise<number> {
  const kv = getRedis();
  const count = await kv.get<number>("user_count");
  return count ?? 0;
}

export async function getUserByEmail(
  email: string,
): Promise<StoredUser | null> {
  const kv = getRedis();
  const userId = await kv.get<string>(`user_email:${email.toLowerCase()}`);
  if (!userId) return null;
  return kv.get<StoredUser>(`user:${userId}`);
}

export async function createUser(
  email: string,
  password: string,
  name: string,
): Promise<SafeUser> {
  const kv = getRedis();

  const existing = await kv.get<string>(`user_email:${email.toLowerCase()}`);
  if (existing) {
    throw new Error("A user with that email already exists");
  }

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const createdAt = new Date().toISOString();

  const user: StoredUser = {
    id,
    email: email.toLowerCase(),
    name,
    passwordHash,
    createdAt,
  };

  // Atomic pipeline: store user, create email index, bump count
  const pipeline = kv.pipeline();
  pipeline.set(`user:${id}`, user);
  pipeline.set(`user_email:${email.toLowerCase()}`, id);
  pipeline.incr("user_count");
  await pipeline.exec();

  return sanitize(user);
}

// ─── Session management ──────────────────────────────────

export async function createSession(userId: string): Promise<string> {
  const kv = getRedis();
  const token = crypto.randomUUID();
  const session: Session = { userId, createdAt: new Date().toISOString() };
  await kv.set(`session:${token}`, session, { ex: SESSION_TTL });
  return token;
}

export async function validateSession(token: string): Promise<SafeUser | null> {
  const kv = getRedis();
  const session = await kv.get<Session>(`session:${token}`);
  if (!session) return null;

  const user = await kv.get<StoredUser>(`user:${session.userId}`);
  if (!user) return null;

  return sanitize(user);
}

export async function destroySession(token: string): Promise<void> {
  const kv = getRedis();
  await kv.del(`session:${token}`);
}
