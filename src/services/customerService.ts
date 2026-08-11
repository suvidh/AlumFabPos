import { PrismaClient, Customer } from '@prisma/client';

export interface CreateCustomerInput {
  name: string;
  phone?: string;
  gstin?: string;
  state?: string;
  address?: string;
  notes?: string;
}

export class CustomerService {
  public static async getAllCustomers(prisma: PrismaClient, includeInactive = false): Promise<Customer[]> {
    return prisma.customer.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { name: 'asc' }
    });
  }

  public static async createCustomer(prisma: PrismaClient, input: CreateCustomerInput): Promise<Customer> {
    return prisma.customer.create({
      data: {
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
        gstin: input.gstin?.toUpperCase().trim() || null,
        state: input.state?.trim() || null,
        address: input.address?.trim() || null,
        notes: input.notes?.trim() || null,
        isActive: true
      }
    });
  }

  public static async updateCustomer(
    prisma: PrismaClient,
    customerId: string,
    input: Partial<CreateCustomerInput> & { isActive?: boolean }
  ): Promise<Customer> {
    return prisma.customer.update({
      where: { id: customerId },
      data: {
        ...(input.name !== undefined && { name: input.name.trim() }),
        ...(input.phone !== undefined && { phone: input.phone?.trim() || null }),
        ...(input.gstin !== undefined && { gstin: input.gstin?.toUpperCase().trim() || null }),
        ...(input.state !== undefined && { state: input.state?.trim() || null }),
        ...(input.address !== undefined && { address: input.address?.trim() || null }),
        ...(input.notes !== undefined && { notes: input.notes?.trim() || null }),
        ...(input.isActive !== undefined && { isActive: input.isActive })
      }
    });
  }

  public static async seedDefaultCustomer(prisma: PrismaClient): Promise<Customer> {
    let customer = await prisma.customer.findFirst({
      where: { name: 'Walk-in Retail Customer' }
    });

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          name: 'Walk-in Retail Customer',
          phone: undefined,
          state: undefined,
          address: 'Local Counter Customer',
          isActive: true
        }
      });
    }

    return customer;
  }
}
