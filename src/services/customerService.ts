import { PrismaClient, Customer, CustomerLedger } from '@prisma/client';
import { UnitNormalizer } from './unitNormalizer';

export interface CreateCustomerInput {
  name: string;
  phone?: string;
  email?: string;
  gstin?: string;
  state?: string;
  address?: string;
  notes?: string;
  defaultBranchId?: string;
  creditLimitRupees?: number;
  outstandingBalanceRupees?: number;
}

export class CustomerService {
  public static async getAllCustomers(prisma: PrismaClient, includeInactive = false): Promise<Customer[]> {
    return prisma.customer.findMany({
      where: {
        isDeleted: false,
        ...(includeInactive ? {} : { isActive: true })
      },
      include: { defaultBranch: true },
      orderBy: { name: 'asc' }
    });
  }

  public static async createCustomer(prisma: PrismaClient, input: CreateCustomerInput): Promise<Customer> {
    return prisma.customer.create({
      data: {
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
        gstin: input.gstin?.toUpperCase().trim() || null,
        state: input.state?.trim() || null,
        address: input.address?.trim() || null,
        notes: input.notes?.trim() || null,
        defaultBranchId: input.defaultBranchId || null,
        creditLimitPaise: input.creditLimitRupees !== undefined ? UnitNormalizer.toPaise(input.creditLimitRupees) : 0,
        outstandingBalancePaise: input.outstandingBalanceRupees !== undefined ? UnitNormalizer.toPaise(input.outstandingBalanceRupees) : 0,
        isActive: true,
        isDeleted: false
      }
    });
  }

  public static async updateCustomer(
    prisma: PrismaClient,
    customerId: string,
    input: Partial<CreateCustomerInput> & { isActive?: boolean; isDeleted?: boolean }
  ): Promise<Customer> {
    return prisma.customer.update({
      where: { id: customerId },
      data: {
        ...(input.name !== undefined && { name: input.name.trim() }),
        ...(input.phone !== undefined && { phone: input.phone?.trim() || null }),
        ...(input.email !== undefined && { email: input.email?.trim() || null }),
        ...(input.gstin !== undefined && { gstin: input.gstin?.toUpperCase().trim() || null }),
        ...(input.state !== undefined && { state: input.state?.trim() || null }),
        ...(input.address !== undefined && { address: input.address?.trim() || null }),
        ...(input.notes !== undefined && { notes: input.notes?.trim() || null }),
        ...(input.defaultBranchId !== undefined && { defaultBranchId: input.defaultBranchId || null }),
        ...(input.creditLimitRupees !== undefined && { creditLimitPaise: UnitNormalizer.toPaise(input.creditLimitRupees) }),
        ...(input.outstandingBalanceRupees !== undefined && { outstandingBalancePaise: UnitNormalizer.toPaise(input.outstandingBalanceRupees) }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        ...(input.isDeleted !== undefined && { isDeleted: input.isDeleted })
      }
    });
  }

  public static async deleteCustomer(prisma: PrismaClient, customerId: string): Promise<Customer> {
    return prisma.customer.update({
      where: { id: customerId },
      data: { isDeleted: true }
    });
  }

  public static async getCustomerById(prisma: PrismaClient, customerId: string): Promise<Customer | null> {
    return prisma.customer.findFirst({
      where: { id: customerId, isDeleted: false },
      include: { defaultBranch: true }
    });
  }

  /**
   * Credit Control Check Method
   * Returns validation status and detailed limit status
   */
  public static async CanApproveCreditSale(
    prisma: PrismaClient,
    customerId: string,
    saleAmountRupees: number
  ): Promise<{ allowed: boolean; reason?: string; currentBalanceRupees: number; creditLimitRupees: number }> {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, isDeleted: false }
    });

    if (!customer) {
      throw new Error(`Customer with ID ${customerId} not found.`);
    }

    const saleAmountPaise = UnitNormalizer.toPaise(saleAmountRupees);
    const potentialBalancePaise = customer.outstandingBalancePaise + saleAmountPaise;
    const allowed = potentialBalancePaise <= customer.creditLimitPaise;

    let reason: string | undefined;
    if (!allowed) {
      const excessRupees = UnitNormalizer.fromPaise(potentialBalancePaise - customer.creditLimitPaise);
      reason = `Credit limit exceeded. Sale of ₹${saleAmountRupees} would push balance to ₹${UnitNormalizer.fromPaise(potentialBalancePaise)}, exceeding the credit limit of ₹${UnitNormalizer.fromPaise(customer.creditLimitPaise)} by ₹${excessRupees}.`;
    }

    return {
      allowed,
      reason,
      currentBalanceRupees: UnitNormalizer.fromPaise(customer.outstandingBalancePaise),
      creditLimitRupees: UnitNormalizer.fromPaise(customer.creditLimitPaise)
    };
  }

  /**
   * Concurrency-safe Allocation of Credit Sale
   * wraps availability check and balance update in an atomic transaction
   */
  public static async allocateCreditSale(
    prisma: PrismaClient,
    customerId: string,
    saleAmountRupees: number,
    referenceId?: string,
    notes?: string
  ): Promise<{ customer: Customer; ledgerItem: CustomerLedger }> {
    const saleAmountPaise = UnitNormalizer.toPaise(saleAmountRupees);

    if (saleAmountPaise <= 0) {
      throw new Error("Credit sale amount must be greater than zero.");
    }

    const run = async (tx: any) => {
      // 1. Fetch current status inside transaction to lock out stale read values
      const customer = await tx.customer.findFirst({
        where: { id: customerId, isDeleted: false }
      });

      if (!customer) {
        throw new Error(`Customer with ID ${customerId} not found.`);
      }

      // 2. Assert availability inside transaction
      const potentialBalancePaise = customer.outstandingBalancePaise + saleAmountPaise;
      if (potentialBalancePaise > customer.creditLimitPaise) {
        const excessRupees = UnitNormalizer.fromPaise(potentialBalancePaise - customer.creditLimitPaise);
        throw new Error(`Credit limit exceeded. Transaction rolled back. Limit: ₹${UnitNormalizer.fromPaise(customer.creditLimitPaise)}, Potential Balance: ₹${UnitNormalizer.fromPaise(potentialBalancePaise)} (Exceeds limit by ₹${excessRupees}).`);
      }

      // 3. Mutate balance
      const updatedCustomer = await tx.customer.update({
        where: { id: customerId },
        data: {
          outstandingBalancePaise: potentialBalancePaise
        }
      });

      // 4. Create Ledger credit sale entry (positive amount increases outstanding debt)
      const ledgerItem = await tx.customerLedger.create({
        data: {
          customerId,
          transactionType: 'CREDIT_SALE',
          amountPaise: saleAmountPaise,
          referenceId: referenceId || null,
          notes: notes || `Credit Sale Reference: ${referenceId || 'N/A'}`
        }
      });

      return { customer: updatedCustomer, ledgerItem };
    };

    if (typeof (prisma as any).$transaction === 'function') {
      return (prisma as any).$transaction(run);
    } else {
      return run(prisma);
    }
  }

  /**
   * Customer Payment Receipt Processing
   * Atomically reduces customer's balance and creates a matching ledger record (negative value reduces debt)
   */
  public static async processPaymentReceipt(
    prisma: PrismaClient,
    customerId: string,
    paymentAmountRupees: number,
    paymentMethod: 'CASH' | 'CHEQUE' | 'BANK_TRANSFER' | string,
    referenceId?: string,
    notes?: string
  ): Promise<{ customer: Customer; ledgerItem: CustomerLedger }> {
    const paymentAmountPaise = UnitNormalizer.toPaise(paymentAmountRupees);

    if (paymentAmountPaise <= 0) {
      throw new Error("Payment amount must be greater than zero.");
    }

    const run = async (tx: any) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, isDeleted: false }
      });

      if (!customer) {
        throw new Error(`Customer with ID ${customerId} not found.`);
      }

      // Mutate balance (subtract payment amount from outstanding balance)
      const newBalancePaise = customer.outstandingBalancePaise - paymentAmountPaise;

      const updatedCustomer = await tx.customer.update({
        where: { id: customerId },
        data: {
          outstandingBalancePaise: newBalancePaise
        }
      });

      // Create Ledger payment entry (negative amount decreases outstanding debt)
      const ledgerItem = await tx.customerLedger.create({
        data: {
          customerId,
          transactionType: 'PAYMENT_RECEIVED',
          amountPaise: -paymentAmountPaise,
          paymentMethod,
          referenceId: referenceId || null,
          notes: notes || `Payment Received via ${paymentMethod}`
        }
      });

      return { customer: updatedCustomer, ledgerItem };
    };

    if (typeof (prisma as any).$transaction === 'function') {
      return (prisma as any).$transaction(run);
    } else {
      return run(prisma);
    }
  }

  /**
   * Retrieves all ledger history for a specific customer
   */
  public static async getCustomerLedger(prisma: PrismaClient, customerId: string): Promise<CustomerLedger[]> {
    return prisma.customerLedger.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' }
    });
  }

  public static async seedDefaultCustomer(prisma: PrismaClient): Promise<Customer> {
    let customer = await prisma.customer.findFirst({
      where: { name: 'Walk-in Retail Customer', isDeleted: false }
    });

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          name: 'Walk-in Retail Customer',
          phone: undefined,
          email: null,
          state: undefined,
          address: 'Local Counter Customer',
          creditLimitPaise: 0,
          outstandingBalancePaise: 0,
          isActive: true,
          isDeleted: false
        }
      });
    }

    return customer;
  }
}
