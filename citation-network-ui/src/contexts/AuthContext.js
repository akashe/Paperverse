    // src/contexts/AuthContext.js
    import React, { useContext, useState, useEffect, createContext } from 'react';
    import { onAuthStateChanged } from 'firebase/auth';
    import { auth } from '../firebase';

    const AuthContext = createContext();

    export function useAuth() {
      return useContext(AuthContext);
    }

    export function AuthProvider({ children }) {
      const [currentUser, setCurrentUser] = useState(null);
      const [loading, setLoading] = useState(true);

      useEffect(() => {
        if (!auth) {
          setLoading(false);
          return;
        }
        const unsubscribe = onAuthStateChanged(auth, user => {
          setCurrentUser(user);
          setLoading(false);
        });
        return unsubscribe;
      }, []);

      const value = { currentUser };

      return (
        <AuthContext.Provider value={value}>
          {!loading && children}
        </AuthContext.Provider>
      );
    }