import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Company, Branch } from '@prisma/client';

export interface AppConfigState {
  company: {
    id: string;
    name: string;
    legalName: string;
    centralGstin: string;
    phone: string;
    stateJurisdiction: string;
    registeredAddress: string;
    defaultBranchId: string;
  } | null;
  activeBoundBranch: {
    id: string;
    branchName: string;
    branchCode: string;
    branchGstin: string;
    invoicePrefix: string;
    phone: string;
    state: string;
    address: string;
    isHeadquarters: boolean;
  } | null;
  branchesList: Branch[];
  updateCompany: (data: Partial<Company>) => Promise<void>;
  updateBranch: (branchId: string, data: Partial<Branch>) => Promise<void>;
  bindActiveBranch: (branchId: string) => Promise<void>;
  fetchInitialConfig: () => Promise<void>;
}

const POSConfigContext = createContext<AppConfigState | undefined>(undefined);

export const POSConfigProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [company, setCompany] = useState<AppConfigState['company']>(null);
  const [activeBoundBranch, setActiveBoundBranch] = useState<AppConfigState['activeBoundBranch']>(null);
  const [branchesList, setBranchesList] = useState<Branch[]>([]);

  const fetchInitialConfig = async () => {
    if (window.alumfab) {
      try {
        const { company: comp } = await window.alumfab.getCompany();
        const branches = await window.alumfab.getAllBranches();

        // 1. Map Company details
        const mappedCompany: AppConfigState['company'] = comp
          ? {
              id: comp.id,
              name: comp.name,
              legalName: comp.legalName || comp.name,
              centralGstin: comp.taxId || '',
              phone: comp.phone || '',
              stateJurisdiction: comp.state || '',
              registeredAddress: comp.address || '',
              defaultBranchId: comp.defaultBranchId || ''
            }
          : null;

        // 2. Resolve Active Scoped Bound Branch
        const boundId = localStorage.getItem('boundBranchId');
        let selectedBranch = branches.find(b => b.id === boundId);
        if (!selectedBranch && comp?.defaultBranchId) {
          selectedBranch = branches.find(b => b.id === comp.defaultBranchId);
        }
        if (!selectedBranch && branches.length > 0) {
          selectedBranch = branches[0];
        }

        const mappedActiveBranch: AppConfigState['activeBoundBranch'] = selectedBranch
          ? {
              id: selectedBranch.id,
              branchName: selectedBranch.name,
              branchCode: selectedBranch.code,
              branchGstin: selectedBranch.gstin || '',
              invoicePrefix: selectedBranch.invoicePrefix || '',
              phone: selectedBranch.phone || '',
              state: selectedBranch.state || '',
              address: selectedBranch.address || '',
              isHeadquarters: selectedBranch.id === comp?.defaultBranchId
            }
          : null;

        setCompany(mappedCompany);
        setActiveBoundBranch(mappedActiveBranch);
        setBranchesList(branches);

        if (selectedBranch) {
          localStorage.setItem('boundBranchId', selectedBranch.id);
        }
      } catch (e) {
        console.error('Failed to load POS Config:', e);
      }
    }
  };

  const updateCompany = async (data: Partial<Company>) => {
    if (window.alumfab && company?.id) {
      await window.alumfab.updateCompany(company.id, data);
      await fetchInitialConfig();
      window.dispatchEvent(new Event('pos-config-changed'));
    }
  };

  const updateBranch = async (branchId: string, data: Partial<Branch>) => {
    if (window.alumfab) {
      await window.alumfab.updateBranch(branchId, data as any);
      await fetchInitialConfig();
      window.dispatchEvent(new Event('pos-config-changed'));
    }
  };

  const bindActiveBranch = async (branchId: string) => {
    localStorage.setItem('boundBranchId', branchId);
    await fetchInitialConfig();
    window.dispatchEvent(new Event('pos-config-changed'));
  };

  useEffect(() => {
    fetchInitialConfig();

    const listener = () => {
      fetchInitialConfig();
    };
    window.addEventListener('pos-config-changed', listener);
    return () => {
      window.removeEventListener('pos-config-changed', listener);
    };
  }, []);

  return (
    <POSConfigContext.Provider
      value={{
        company,
        activeBoundBranch,
        branchesList,
        updateCompany,
        updateBranch,
        bindActiveBranch,
        fetchInitialConfig
      }}
    >
      {children}
    </POSConfigContext.Provider>
  );
};

export const usePOSConfigStore = (): AppConfigState => {
  const context = useContext(POSConfigContext);
  if (!context) {
    throw new Error('usePOSConfigStore must be used within a POSConfigProvider');
  }
  return context;
};
