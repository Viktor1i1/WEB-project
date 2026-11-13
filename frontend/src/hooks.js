import { useEffect, useRef } from 'react';

export function usePolling(fn, ms) {
  const saved = useRef(fn);
  useEffect(() => { saved.current = fn; });
  useEffect(() => {
    const run = () => Promise.resolve(saved.current()).catch(() => {});
    run();
    const id = setInterval(run, ms);
    return () => clearInterval(id);
  }, [ms]);
}
