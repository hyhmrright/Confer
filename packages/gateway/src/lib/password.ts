// Argon2id, loaded on first use: it is a native module only the credential
// routes need.

export async function hashPassword(password: string): Promise<string> {
  const argon2 = await import('argon2');
  return argon2.hash(password);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  const argon2 = await import('argon2');
  return argon2.verify(hash, password);
}
