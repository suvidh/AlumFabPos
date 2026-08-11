import React, { createContext, useContext, useState, ReactNode } from 'react';

export interface UserSession {
  id: string;
  username: string;
  name: string;
  role: 'ADMIN' | 'MANAGER' | 'CASHIER';
  email: string;
  branchId: string;
  permissions: string[];
  isAuthenticated: boolean;
  loginTime: string;
}

export const MOCK_ADMIN_USER: UserSession = {
  id: 'usr_admin_001',
  username: 'admin',
  name: 'System Administrator',
  role: 'ADMIN',
  email: 'admin@alumfab.local',
  branchId: 'branch_surat_main',
  permissions: ['ALL', 'POS_BILLING', 'INVENTORY_MANAGE', 'REPORTS_VIEW', 'SETTINGS_EDIT'],
  isAuthenticated: true,
  loginTime: new Date().toISOString()
};

interface UserContextType {
  user: UserSession;
  setUser: React.Dispatch<React.SetStateAction<UserSession>>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Inject mock admin user payload on initialization
  const [user, setUser] = useState<UserSession>(MOCK_ADMIN_USER);

  return (
    <UserContext.Provider value={{ user, setUser }}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = (): UserContextType => {
  const context = useContext(UserContext);
  if (!context) {
    // Fallback to mock admin user to prevent null reference errors
    return {
      user: MOCK_ADMIN_USER,
      setUser: () => {}
    };
  }
  return context;
};
