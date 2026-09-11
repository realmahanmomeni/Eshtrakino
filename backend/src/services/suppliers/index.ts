import { supplierManager } from "./SupplierManager";
import { QuantumVaultAdapter } from "./quantumvault/QuantumVaultAdapter";

// Register all adapters
supplierManager.registerAdapter(new QuantumVaultAdapter());

export { supplierManager };
export * from "./SupplierAdapter";
