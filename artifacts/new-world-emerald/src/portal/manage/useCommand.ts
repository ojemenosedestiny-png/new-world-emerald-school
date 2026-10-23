import { useQueryClient } from "@tanstack/react-query";
import { useManagePortal, getGetPortalManagementQueryKey, type PortalCommand } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "../lib";

export function useCommand() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const m = useManagePortal();
  const run = async (command: PortalCommand, success: string) => {
    try {
      const res = await m.mutateAsync({ data: command });
      toast({ title: success, description: res.message && res.message !== success ? res.message : undefined });
      await queryClient.invalidateQueries({ queryKey: getGetPortalManagementQueryKey() });
      return true;
    } catch (e) {
      toast({ variant: "destructive", title: "Not saved", description: errorMessage(e) });
      return false;
    }
  };
  return { run, pending: m.isPending };
}

export type ClassItem = { id?: number; name: string };
export function className(classes: ClassItem[], id: number) {
  return classes.find((c) => c.id === id)?.name ?? "Class " + id;
}
