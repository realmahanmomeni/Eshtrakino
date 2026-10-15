import { supplierManager } from "./SupplierManager";
import { CanbosoAdapter } from "./adapters/CanbosoAdapter";

// Primary digital supplier: Canboso Telegram Buyer API
supplierManager.registerAdapter(new CanbosoAdapter());

export { supplierManager };
export * from "./SupplierAdapter";
export { canbosoAdapter } from "./adapters/CanbosoAdapter";
export { canbosoSyncService, CANBOSO_SUPPLIER_NAME } from "./CanbosoSyncService";
export { canbosoDispatchService } from "./CanbosoDispatchService";
