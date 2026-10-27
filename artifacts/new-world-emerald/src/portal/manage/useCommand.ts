import { useQueryClient } from "@tanstack/react-query";
import { useManagePortal, getGetPortalManagementQueryKey, type PortalCommand } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "../lib";

export function useCommand() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const m = useManagePortal();
  /** Like run, but hands back the server's reply (for example a new Student ID), or null if it failed. */
  const runForResult = async (command: PortalCommand, success: string) => {
    try {
      const res = await m.mutateAsync({ data: command });
      toast({ title: success, description: res.message && res.message !== success ? res.message : undefined });
      await queryClient.invalidateQueries({ queryKey: getGetPortalManagementQueryKey() });
      return res;
    } catch (e) {
      toast({ variant: "destructive", title: "Not saved", description: errorMessage(e) });
      return null;
    }
  };
  const run = async (command: PortalCommand, success: string) => (await runForResult(command, success)) !== null;
  return { run, runForResult, pending: m.isPending };
}

export type ClassItem = { id?: number; name: string };
export function className(classes: ClassItem[], id: number) {
  return classes.find((c) => c.id === id)?.name ?? "Class " + id;
}
