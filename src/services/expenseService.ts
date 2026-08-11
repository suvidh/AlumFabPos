import { PrismaClient, Expense } from '@prisma/client';
import { UnitNormalizer } from './unitNormalizer';

export interface CreateExpenseInput {
  branchId: string;
  categoryDescription: string;
  amountRupees: number;
  notes?: string;
}

export class ExpenseService {
  public static async createExpense(prisma: PrismaClient, input: CreateExpenseInput): Promise<Expense> {
    const amountPaise = UnitNormalizer.toPaise(input.amountRupees);
    return prisma.expense.create({
      data: {
        branchId: input.branchId,
        categoryDescription: input.categoryDescription.trim(),
        amountPaise,
        notes: input.notes?.trim() || null
      }
    });
  }

  public static async getAllExpenses(prisma: PrismaClient, branchId?: string): Promise<Expense[]> {
    return prisma.expense.findMany({
      where: branchId ? { branchId } : {},
      orderBy: { date: 'desc' }
    });
  }
}
