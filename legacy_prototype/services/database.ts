import { PrismaClient } from '@prisma/client';

// Shared Prisma Client instance for offline desktop application
export const prisma = new PrismaClient();
