import { prisma } from './database';

export interface BranchDTO {
  id?: string;
  companyId?: string;
  name: string;
  address?: string;
  gstin?: string;
  phone?: string;
  state?: string;
  invoicePrefix?: string;
  logoPath?: string;
  isActive?: boolean;
}

export class BranchService {
  /**
   * Get central Company Master record
   */
  static async getCompany() {
    let company = await prisma.company.findFirst();
    if (!company) {
      company = await prisma.company.create({
        data: {
          companyName: 'ALUMFAB'
        }
      });
    }
    return company;
  }

  /**
   * Get list of all branches
   */
  static async getAllBranches() {
    return prisma.branch.findMany({
      orderBy: { createdAt: 'asc' }
    });
  }

  /**
   * Get Active Branch context
   */
  static async getActiveBranch(): Promise<any> {
    let branch = await prisma.branch.findFirst({
      where: { isActive: true }
    });

    if (!branch) {
      const company = await this.getCompany();
      branch = await prisma.branch.create({
        data: {
          companyId: company.id,
          name: 'Surat Main Store',
          address: 'Plot 42, Industrial Area, Surat, Gujarat',
          gstin: '24AAACA0000A1Z5',
          phone: '+91 98765 43210',
          state: 'Gujarat',
          invoicePrefix: 'SRT-INV-'
        }
      });

      // Ensure sequence counter exists
      await prisma.invoiceSequence.upsert({
        where: {
          branchId_prefix: {
            branchId: branch.id,
            prefix: branch.invoicePrefix
          }
        },
        update: {},
        create: {
          branchId: branch.id,
          prefix: branch.invoicePrefix,
          nextNumber: 1
        }
      });
    }

    return branch;
  }

  /**
   * Create or Update Branch details
   */
  static async saveBranch(data: BranchDTO) {
    const company = await this.getCompany();
    
    // Normalize GSTIN to UPPERCASE
    const cleanGstin = data.gstin ? data.gstin.trim().toUpperCase() : null;

    if (data.id) {
      return prisma.branch.update({
        where: { id: data.id },
        data: {
          name: data.name,
          address: data.address,
          gstin: cleanGstin,
          phone: data.phone,
          state: data.state,
          invoicePrefix: data.invoicePrefix || 'ALF-INV-',
          logoPath: data.logoPath
        }
      });
    } else {
      const newBranch = await prisma.branch.create({
        data: {
          companyId: company.id,
          name: data.name,
          address: data.address,
          gstin: cleanGstin,
          phone: data.phone,
          state: data.state,
          invoicePrefix: data.invoicePrefix || 'ALF-INV-',
          logoPath: data.logoPath
        }
      });

      // Create sequence counter
      await prisma.invoiceSequence.create({
        data: {
          branchId: newBranch.id,
          prefix: newBranch.invoicePrefix,
          nextNumber: 1
        }
      });

      return newBranch;
    }
  }

  /**
   * Soft-deactivate Branch (isActive = false)
   */
  static async deactivateBranch(branchId: string) {
    return prisma.branch.update({
      where: { id: branchId },
      data: { isActive: false }
    });
  }

  /**
   * Resolve active Logo image path (Branch -> Company -> null)
   */
  static async resolveLogoPath(branchId: string): Promise<string | null> {
    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    if (branch && branch.logoPath) return branch.logoPath;

    const company = await this.getCompany();
    if (company && company.defaultLogoPath) return company.defaultLogoPath;

    return null;
  }
}
