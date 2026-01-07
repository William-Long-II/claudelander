import { useState, useEffect, useCallback } from 'react';
import { ShareUser } from '../../shared/types';

interface SharingState {
  user: ShareUser | null;
  isLoading: boolean;
}

export function useSharing() {
  const [state, setState] = useState<SharingState>({
    user: null,
    isLoading: true,
  });

  // Load initial auth state from main process (tokens are stored securely there)
  useEffect(() => {
    const loadUser = async () => {
      try {
        // Get current user from main process (auth state is restored from secure storage)
        const user = await window.electronAPI.getUser();
        setState({ user, isLoading: false });
      } catch (e) {
        console.error('Failed to get auth state:', e);
        setState({ user: null, isLoading: false });
      }
    };

    loadUser();

    // Listen for auth changes from main process
    const unsubscribeAuthChanged = window.electronAPI.onAuthChanged((data: any) => {
      setState({ user: data.user, isLoading: false });
      // Token is now managed securely in main process - don't store in renderer
    });

    const unsubscribeAuthError = window.electronAPI.onAuthError((data: any) => {
      console.error('Auth error:', data.error);
      setState({ user: null, isLoading: false });
    });

    // Cleanup listeners on unmount
    return () => {
      unsubscribeAuthChanged?.();
      unsubscribeAuthError?.();
    };
  }, []);

  const login = useCallback(() => {
    window.electronAPI.login();
  }, []);

  const logout = useCallback(() => {
    window.electronAPI.logout();
    // Token cleanup is handled in main process
    setState({ user: null, isLoading: false });
  }, []);

  return {
    user: state.user,
    isLoading: state.isLoading,
    isAuthenticated: state.user !== null,
    login,
    logout,
  };
}
