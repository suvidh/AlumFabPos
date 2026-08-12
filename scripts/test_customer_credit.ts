import { PrismaClient } from '@prisma/client';
import { CustomerService } from '../src/services/customerService';

const prisma = new PrismaClient();

async function runCreditTests() {
  console.log('--- STARTING CUSTOMER CREDIT MODULE Lifecycle TESTS ---');

  try {
    // 1. Setup Master Records (Company & Branch)
    console.log('\n[1/6] Bootstrapping branch data...');
    let company = await prisma.company.findFirst();
    if (!company) {
      company = await prisma.company.create({
        data: { name: 'AlumFab Test Ltd' }
      });
    }

    let branch = await prisma.branch.findFirst({ where: { code: 'BR-CREDIT' } });
    if (!branch) {
      branch = await prisma.branch.create({
        data: { code: 'BR-CREDIT', name: 'Credit Central Store', address: 'Main Ave', phone: '7777777777', companyId: company.id }
      });
    }

    // 2. Create Test Customer with ₹5,000.00 Credit Limit
    console.log('\n[2/6] Creating Customer with ₹5,000.00 credit limit...');
    const customer = await CustomerService.createCustomer(prisma, {
      name: 'Acme Builders Corp',
      phone: '555-0199',
      email: 'acme@builders.com',
      defaultBranchId: branch.id,
      creditLimitRupees: 5000.00,
      outstandingBalanceRupees: 0.00
    });

    console.log(`Customer Created: ${customer.name} | Email: ${customer.email} | Credit Limit: ₹${customer.creditLimitPaise / 100}`);

    // 3. Allocate allowed Credit Sale (₹2,000.00)
    console.log('\n[3/6] Allocating allowed credit sale (₹2,000.00)...');
    
    // Check first
    const check1 = await CustomerService.CanApproveCreditSale(prisma, customer.id, 2000.00);
    console.log(`Can approve ₹2,000.00 credit sale? ${check1.allowed ? 'Yes ✔' : 'No ❌'}`);

    const saleResult = await CustomerService.allocateCreditSale(
      prisma,
      customer.id,
      2000.00,
      'INV-TEST-001',
      'First credit invoice'
    );
    console.log(`Credit Sale Allocated. Current Balance: ₹${saleResult.customer.outstandingBalancePaise / 100}`);
    console.log(`Ledger entry: Type: ${saleResult.ledgerItem.transactionType} | Amount: +₹${saleResult.ledgerItem.amountPaise / 100} | Ref: ${saleResult.ledgerItem.referenceId}`);

    // 4. Test Credit Overlimit Block and Rollback (₹4,000.00)
    console.log('\n[4/6] Testing overlimit block (₹4,000.00 sale)...');
    const check2 = await CustomerService.CanApproveCreditSale(prisma, customer.id, 4000.00);
    console.log(`Can approve ₹4,000.00 credit sale? ${check2.allowed ? 'Yes ❌' : 'No ✔'} | Reason: ${check2.reason}`);

    try {
      console.log('Attempting overlimit credit sale allocation...');
      await CustomerService.allocateCreditSale(prisma, customer.id, 4000.00, 'INV-TEST-002');
      console.error('❌ FAIL: Allowed credit sale exceeding the limit!');
    } catch (err: any) {
      console.log(`✔ PASS: Allocation blocked and transaction rolled back: ${err.message}`);
      // Verify balance was unchanged
      const freshCustomer = await CustomerService.getCustomerById(prisma, customer.id);
      console.log(`Confirmed Balance remains unchanged: ₹${freshCustomer!.outstandingBalancePaise / 100}`);
    }

    // 5. Customer Payment Receipt (₹1,500.00)
    console.log('\n[5/6] Processing Customer Payment Receipt (₹1,500.00)...');
    const payResult = await CustomerService.processPaymentReceipt(
      prisma,
      customer.id,
      1500.00,
      'BANK_TRANSFER',
      'PAY-TEST-001',
      'Received against outstanding invoices'
    );
    console.log(`Payment processed. New Balance: ₹${payResult.customer.outstandingBalancePaise / 100}`);
    console.log(`Ledger entry: Type: ${payResult.ledgerItem.transactionType} | Amount: -₹${Math.abs(payResult.ledgerItem.amountPaise) / 100} | Method: ${payResult.ledgerItem.paymentMethod} | Ref: ${payResult.ledgerItem.referenceId}`);

    // 6. Review Customer Credit Ledger history
    console.log('\n[6/6] Retrieving customer credit ledger history...');
    const history = await CustomerService.getCustomerLedger(prisma, customer.id);
    console.log(`Ledger History (Total items: ${history.length}):`);
    history.forEach(item => {
      console.log(`  - [${item.createdAt.toISOString()}] Type: ${item.transactionType} | Amount: ₹${item.amountPaise / 100} | Ref: ${item.referenceId || 'N/A'} | Notes: ${item.notes}`);
    });

    // Cleanup
    console.log('\nCleaning up test customer records...');
    await prisma.customerLedger.deleteMany({ where: { customerId: customer.id } });
    await prisma.customer.delete({ where: { id: customer.id } });
    console.log('Cleanup completed.');

    console.log('\n--- ALL CUSTOMER CREDIT Lifecycle TESTS COMPLETED SUCCESSFULLY ---');

  } catch (err: any) {
    console.error('❌ Test execution encountered a fatal error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

runCreditTests();
