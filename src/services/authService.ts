import crypto from 'crypto';
import { PrismaClient, User } from '@prisma/client';

export class AuthService {
  /**
   * Hashes a password using PBKDF2 with a random salt.
   */
  public static hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
  }

  /**
   * Verifies if a password matches the stored salt:hash combination.
   */
  public static verifyPassword(password: string, storedHash: string): boolean {
    const parts = storedHash.split(':');
    if (parts.length !== 2) return false;
    const [salt, hash] = parts;
    const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(verifyHash, 'hex'));
  }

  /**
   * Seed default Admin account if no users exist.
   */
  public static async seedDefaultAdmin(prisma: PrismaClient): Promise<User | null> {
    const count = await prisma.user.count();
    if (count > 0) return null;

    const defaultUsername = 'admin';
    const defaultPassword = 'admin123';
    const passwordHash = this.hashPassword(defaultPassword);

    const user = await prisma.user.create({
      data: {
        username: defaultUsername,
        passwordHash
      }
    });

    return user;
  }

  /**
   * Authenticate admin login.
   */
  public static async login(prisma: PrismaClient, username: string, password: string): Promise<Omit<User, 'passwordHash'>> {
    const user = await prisma.user.findUnique({
      where: { username: username.toLowerCase().trim() }
    });

    if (!user) {
      throw new Error('Invalid username or password');
    }

    const isValid = this.verifyPassword(password, user.passwordHash);
    if (!isValid) {
      throw new Error('Invalid username or password');
    }

    const { passwordHash, ...safeUser } = user;
    return safeUser;
  }

  /**
   * Update password.
   */
  public static async updatePassword(
    prisma: PrismaClient,
    userId: string,
    oldPassword: string,
    newPassword: string
  ): Promise<boolean> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    const isValid = this.verifyPassword(oldPassword, user.passwordHash);
    if (!isValid) {
      throw new Error('Incorrect current password');
    }

    const passwordHash = this.hashPassword(newPassword);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash }
    });

    return true;
  }
}
