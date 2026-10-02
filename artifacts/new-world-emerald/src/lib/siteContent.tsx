import React, { useEffect, useSyncExternalStore } from "react";
import { getGetSiteContentQueryKey, useGetSiteContent } from "@workspace/api-client-react";

let values: Record<string, string> = {};
let revision = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function resolveSchoolContent(key: string, fallback: string): string {
  return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
}

export function useSchoolContentRevision() {
  return useSyncExternalStore(subscribe, () => revision, () => 0);
}

export function isSchoolSectionVisible(name: string) {
  return resolveSchoolContent(`visibility.${name}`, "true") !== "false";
}

export function SiteContentRuntime({ children }: { children: React.ReactNode }) {
  const query = useGetSiteContent({ query: { queryKey: getGetSiteContentQueryKey(), staleTime: 15000, refetchInterval: 30000 } });
  useEffect(() => {
    if (!query.data) return;
    values = query.data.values;
    revision++;
    listeners.forEach((listener) => listener());
  }, [query.data]);
  return <>{query.isError && <p role="status" className="bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">Some website updates are temporarily unavailable. Please refresh or contact the school.</p>}{children}</>;
}