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
      orderBy: { createdAt: 'asc' }
    });
  }

  public static async getBranchById(prisma: PrismaClient, branchId: string): Promise<Branch | null> {
    return prisma.branch.findUnique({
      where: { id: branchId }
    });
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
}
