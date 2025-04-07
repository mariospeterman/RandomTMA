import { useState, useEffect, DependencyList } from 'react';

export function useAsyncInitialize<T>(
  initialize: () => Promise<T>,
  deps: DependencyList = []
): T | undefined {
  const [state, setState] = useState<T | undefined>();

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const result = await initialize();
        if (mounted) {
          setState(result);
        }
      } catch (error) {
        console.error('Error in useAsyncInitialize:', error);
      }
    })();

    return () => {
      mounted = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialize, ...deps]);

  return state;
}