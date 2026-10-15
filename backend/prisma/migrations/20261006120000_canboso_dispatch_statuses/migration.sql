-- Canboso semi-automated dispatch workflow
ALTER TYPE "SupplierOrderStatus" ADD VALUE IF NOT EXISTS 'PENDING_ADMIN_DISPATCH';
ALTER TYPE "SupplierOrderStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
