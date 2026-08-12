import { PrismaClient, Branch } from '@prisma/client';

export interface CreateBranchInput {
  companyId: string;
  code: string;
  name: string;
  address?: string;
  gstin?: string;
  phone?: string;
  state?: string;
  invoicePrefix?: string;
  logoPath?: string;
}

export interface UpdateBranchInput {
  name?: string;
  address?: string;
  gstin?: string;
  phone?: string;
  state?: string;
  invoicePrefix?: string;
  logoPath?: string;
  isActive?: boolean;
}

export class BranchService {
  public static async getAllBranches(prisma: PrismaClient): Promise<Branch[]> {
    return prisma.branch.findMany({
      where: { isDeleted: false },
      orderBy: { createdAt: 'asc' }
    });
  }

  public static async getBranchById(prisma: PrismaClient, branchId: string): Promise<Branch | null> {
    return prisma.branch.findFirst({
      where: { id: branchId, isDeleted: false }
    });
  }

  public static async deleteBranch(prisma: PrismaClient, branchId: string): Promise<{ softDeleted: boolean }> {
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      include: { company: true }
    });
    if (!branch) throw new Error(`Branch ${branchId} not found`);

    // Minimum Active Branch Constraint
    const activeBranchesCount = await prisma.branch.count({ where: { isDeleted: false } });
    if (activeBranchesCount <= 1) {
      throw new Error("At least one branch must remain active in the system.");
    }

    // Re-assign default branch if HQ is deleted
    if (branch.company.defaultBranchId === branch.id) {
      const nextHQ = await prisma.branch.findFirst({
        where: { id: { not: branchId }, isDeleted: false }
      });
      if (nextHQ) {
        await prisma.company.update({
          where: { id: branch.company.id },
          data: { defaultBranchId: nextHQ.id }
        });
      }
    }

    // Check for dependent data: Sales Invoices, Active Inventory, or Customer Records
    const salesCount = await prisma.sale.count({ where: { branchId } });
    const inventoryCount = await prisma.branchInventory.count({ where: { branchId, quantityMilli: { gt: 0 } } });
    const customerCount = await prisma.customer.count({ where: { defaultBranchId: branchId } });
    const purchaseCount = await prisma.purchase.count({ where: { branchId } });
    const expenseCount = await prisma.expense.count({ where: { branchId } });

    const hasDependencies = salesCount > 0 || inventoryCount > 0 || customerCount > 0 || purchaseCount > 0 || expenseCount > 0;

    if (hasDependencies) {
      // Soft Delete
      await prisma.branch.update({
        where: { id: branchId },
        data: { isDeleted: true, isActive: false }
      });
      await prisma.auditLog.create({
        data: {
          action: 'BRANCH_SOFT_DELETED',
          entityType: 'Branch',
          entityId: branchId,
          detailsJson: JSON.stringify({ name: branch.name, code: branch.code, reason: 'has_dependencies' })
        }
      });
      return { softDeleted: true };
    } else {
      // Hard Delete
      try {
        await prisma.invoiceSequence.deleteMany({ where: { branchId } });
        await prisma.branchInventory.deleteMany({ where: { branchId } });
        await prisma.productBranchBarcode.deleteMany({ where: { branchId } });
        await prisma.branch.delete({ where: { id: branchId } });

        await prisma.auditLog.create({
          data: {
            action: 'BRANCH_HARD_DELETED',
            entityType: 'Branch',
            entityId: branchId,
            detailsJson: JSON.stringify({ name: branch.name, code: branch.code })
          }
        });
        return { softDeleted: false };
      } catch (err: any) {
        // Fallback to soft delete if key constraints hit
        await prisma.branch.update({
          where: { id: branchId },
          data: { isDeleted: true, isActive: false }
        });
        await prisma.auditLog.create({
          data: {
            action: 'BRANCH_SOFT_DELETED',
            entityType: 'Branch',
            entityId: branchId,
            detailsJson: JSON.stringify({ name: branch.name, code: branch.code, reason: 'fk_constraint_fallback', error: err.message })
          }
        });
        return { softDeleted: true };
      }
    }
  }

  public static async createBranch(prisma: PrismaClient, input: CreateBranchInput): Promise<Branch> {
    const branch = await prisma.branch.create({
      data: {
        companyId: input.companyId,
        code: input.code.toUpperCase().trim(),
        name: input.name.trim(),
        address: input.address?.trim(),
        gstin: input.gstin?.toUpperCase().trim(),
        phone: input.phone?.trim(),
        state: input.state?.trim(),
        invoicePrefix: input.invoicePrefix?.trim() || `INV-${input.code.toUpperCase()}-`,
        logoPath: input.logoPath,
        isActive: true
      }
    });

    await prisma.auditLog.create({
      data: {
        action: 'BRANCH_CREATED',
        entityType: 'Branch',
        entityId: branch.id,
        detailsJson: JSON.stringify({ name: branch.name, code: branch.code, gstin: branch.gstin })
      }
    });

    return branch;
  }

  public static async updateBranch(prisma: PrismaClient, branchId: string, input: UpdateBranchInput): Promise<Branch> {
    const existing = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!existing) throw new Error(`Branch ${branchId} not found`);

    const updated = await prisma.branch.update({
      where: { id: branchId },
      data: {
        name: input.name !== undefined ? input.name.trim() : existing.name,
        address: input.address !== undefined ? input.address.trim() : existing.address,
        gstin: input.gstin !== undefined ? input.gstin.toUpperCase().trim() : existing.gstin,
        phone: input.phone !== undefined ? input.phone.trim() : existing.phone,
        state: input.state !== undefined ? input.state.trim() : existing.state,
        invoicePrefix: input.invoicePrefix !== undefined ? input.invoicePrefix.trim() : existing.invoicePrefix,
        logoPath: input.logoPath !== undefined ? input.logoPath : existing.logoPath,
        isActive: input.isActive !== undefined ? input.isActive : existing.isActive
      }
    });

    await prisma.auditLog.create({
      data: {
        action: 'BRANCH_UPDATED',
        entityType: 'Branch',
        entityId: updated.id,
        detailsJson: JSON.stringify({ name: updated.name, code: updated.code, gstin: updated.gstin })
      }
    });

    return updated;
  }

  /**
   * Transactional Invoice Sequence Generator
   * Safely increments and reserves the next invoice number per branch & prefix
   */
  public static async reserveNextInvoiceNumber(
    prisma: PrismaClient,
    branchId: string,
    prefixOverride?: string
  ): Promise<{ invoiceNumber: string; sequenceNumber: number }> {
    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw new Error(`Branch ${branchId} not found`);

    const prefix = prefixOverride || branch.invoicePrefix || 'INV-';

    const run = async (tx: any) => {
      let sequence = await tx.invoiceSequence.findUnique({
        where: {
          branchId_prefix: { branchId, prefix }
        }
      });

      if (!sequence) {
        sequence = await tx.invoiceSequence.create({
          data: {
            branchId,
            prefix,
            nextNumber: 1
          }
        });
      }

      const currentNumber = sequence.nextNumber;

      // Increment sequence for next transaction
      await tx.invoiceSequence.update({
        where: { id: sequence.id },
        data: { nextNumber: currentNumber + 1 }
      });

      const paddedStr = String(currentNumber).padStart(4, '0');
      const invoiceNumber = `${prefix}${paddedStr}`;

      return { invoiceNumber, sequenceNumber: currentNumber };
    };

    if (typeof (prisma as any).$transaction === 'function') {
      return (prisma as any).$transaction(run);
    } else {
      return run(prisma);
    }
  }

  public static async getActiveBranch(prisma?: PrismaClient): Promise<Branch | null> {
    if (!prisma) {
      if (typeof window !== 'undefined') {
        const boundId = localStorage.getItem('boundBranchId');
        if (boundId) {
          const b = await (window as any).alumfab?.getBranchById(boundId);
          if (b) return b;
        }
        const branches = await (window as any).alumfab?.getAllBranches();
        if (branches && branches.length > 0) {
          // Find default headquarters first, otherwise first active branch
          const companyInfo = await (window as any).alumfab?.getCompany();
          const defaultBranchId = companyInfo?.company?.defaultBranchId;
          const mainBranch = branches.find((br: any) => br.id === defaultBranchId);
          return mainBranch || branches[0];
        }
      }
      return null;
    }

    const company = await prisma.company.findFirst();
    if (company && company.defaultBranchId) {
      const defaultBranch = await prisma.branch.findUnique({
        where: { id: company.defaultBranchId }
      });
      if (defaultBranch && !defaultBranch.isDeleted) {
        return defaultBranch;
      }
    }
    return prisma.branch.findFirst({
      where: { isDeleted: false, isActive: true },
      orderBy: { createdAt: 'asc' }
    });
  }
}
