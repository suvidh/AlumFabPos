import { PrismaClient, Supplier } from '@prisma/client';

export interface CreateSupplierInput {
  name: string;
  phone?: string;
  address?: string;
  gstin?: string;
  notes?: string;
}

export class SupplierService {
  public static async getAllSuppliers(prisma: PrismaClient, includeInactive = false): Promise<Supplier[]> {
    return prisma.supplier.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { name: 'asc' }
    });
  }

  public static async getSupplierById(prisma: PrismaClient, supplierId: string): Promise<Supplier | null> {
    return prisma.supplier.findUnique({
      where: { id: supplierId }
    });
  }

  public static async createSupplier(prisma: PrismaClient, input: CreateSupplierInput): Promise<Supplier> {
    return prisma.supplier.create({
      data: {
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
        address: input.address?.trim() || null,
        gstin: input.gstin?.toUpperCase().trim() || null,
        notes: input.notes?.trim() || null,
        isActive: true
      }
    });
  }

  public static async updateSupplier(
    prisma: PrismaClient,
    supplierId: string,
    input: Partial<CreateSupplierInput> & { isActive?: boolean }
  ): Promise<Supplier> {
    return prisma.supplier.update({
      where: { id: supplierId },
      data: {
        ...(input.name !== undefined && { name: input.name.trim() }),
        ...(input.phone !== undefined && { phone: input.phone?.trim() || null }),
        ...(input.address !== undefined && { address: input.address?.trim() || null }),
        ...(input.gstin !== undefined && { gstin: input.gstin?.toUpperCase().trim() || null }),
        ...(input.notes !== undefined && { notes: input.notes?.trim() || null }),
        ...(input.isActive !== undefined && { isActive: input.isActive })
      }
    });
  }

  public static async seedDefaultSupplier(prisma: PrismaClient): Promise<Supplier> {
    let supplier = await prisma.supplier.findFirst({
      where: { name: 'Main Metal Extrusions Supplier' }
    });

    if (!supplier) {
      supplier = await prisma.supplier.create({
        data: {
          name: 'Main Metal Extrusions Supplier',
          phone: '+91 22222 22222',
          address: 'Aluminium Extrusion Industrial Estate, Gujarat',
          gstin: '24AAAAA0000A1Z5',
          notes: 'Standard primary vendor for aluminum lengths and hardware.',
          isActive: true
        }
      });
    }

    return supplier;
  }
}
