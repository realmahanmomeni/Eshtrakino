import { supplierManager } from "./SupplierManager";
import { CanbosoAdapter } from "./adapters/CanbosoAdapter";
import { QuantumVaultAdapter } from "./quantumvault/QuantumVaultAdapter";

// Primary digital supplier: Canboso Telegram Buyer API
supplierManager.registerAdapter(new CanbosoAdapter());
// Second supplier: Quantum (QuantumVault Store API). Purchase stays on the adapter only.
supplierManager.registerAdapter(new QuantumVaultAdapter());

export { supplierManager };
export * from "./SupplierAdapter";
export { canbosoAdapter } from "./adapters/CanbosoAdapter";
export { canbosoSyncService, CANBOSO_SUPPLIER_NAME } from "./CanbosoSyncService";
export { canbosoDispatchService } from "./CanbosoDispatchService";
export { quantumVaultAdapter } from "./quantumvault/QuantumVaultAdapter";
export { quantumSyncService } from "./QuantumSyncService";
export { QUANTUM_SUPPLIER_NAME } from "./quantumvault/quantumCatalog";
