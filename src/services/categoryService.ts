import { PrismaClient, Category } from '@prisma/client';

export class CategoryService {
  public static async getAllCategories(prisma: PrismaClient, includeInactive = false): Promise<Category[]> {
    return prisma.category.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { name: 'asc' }
    });
  }

  public static async createCategory(prisma: PrismaClient, name: string): Promise<Category> {
    return prisma.category.create({
      data: {
        name: name.trim(),
        isActive: true
      }
    });
  }

  public static async updateCategory(
    prisma: PrismaClient,
    categoryId: string,
    data: { name?: string; isActive?: boolean }
  ): Promise<Category> {
    return prisma.category.update({
      where: { id: categoryId },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.isActive !== undefined && { isActive: data.isActive })
      }
    });
  }
}
