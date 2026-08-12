import { PrismaClient, Company, Branch } from '@prisma/client';

export class CompanyService {
  /**
   * Get or auto-seed Single Company profile and Main Branch
   */
  public static async getCompany(prisma: PrismaClient): Promise<{ company: Company; defaultBranch: Branch | null }> {
    let company = await prisma.company.findFirst({
      include: { branches: true }
    });

    if (!company) {
      // Seed default Single Company Profile
      //
      // Registered business details below are taken directly from the ALUMFAB
      // dealer letterhead / delivery challan — this is a single-tenant app
      // built for this business, so the real GSTIN/phone/address are the
      // correct defaults rather than placeholders to fill in later. They can
      // still be edited from Settings if they ever change.
      company = await prisma.company.create({
        data: {
          name: 'ALUMFAB Bulk Aluminium Hardware',
          legalName: 'ALUMFAB Hardware & Aluminium Pvt Ltd',
          taxId: '24ABOPK8064H1ZD', // GSTIN
          phone: '9824157960',
          email: 'teamalumfab@gmail.com',
          state: 'Gujarat',
          address: 'Shop No. 2, Kalindi Apartment, Nr. Sharda Hospital Circle, Majura Gate Road, Surat - 395002',
          isActive: true,
          branches: {
            create: {
              code: 'MAIN',
              name: 'Main Head Office & Central Depot',
              invoicePrefix: 'INV-MAIN-',
              address: 'Shop No. 2, Kalindi Apartment, Nr. Sharda Hospital Circle, Majura Gate Road, Surat - 395002',
              gstin: '24ABOPK8064H1ZD',
              phone: '9824157960',
              state: 'Gujarat',
              isActive: true
            }
          }
        },
        include: { branches: true }
      });

      // Update defaultBranchId
      if (company.branches.length > 0) {
        const mainBranch = company.branches[0];
        company = await prisma.company.update({
          where: { id: company.id },
          data: { defaultBranchId: mainBranch.id },
          include: { branches: true }
        });
      }
    }

    const defaultBranch = company.branches.find(b => b.id === company?.defaultBranchId) || company.branches[0] || null;

    return { company, defaultBranch };
  }

  /**
   * Update Single Company details
   */
  public static async updateCompany(prisma: PrismaClient, companyId: string, data: Partial<Company>): Promise<Company> {
    return prisma.company.update({
      where: { id: companyId },
      data: {
        name: data.name,
        legalName: data.legalName,
        taxId: data.taxId,
        phone: data.phone,
        email: data.email,
        state: data.state,
        address: data.address,
        defaultLogoPath: data.defaultLogoPath
      }
    });
  }
}
