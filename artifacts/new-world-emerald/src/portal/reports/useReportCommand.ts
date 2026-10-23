import { useQueryClient } from "@tanstack/react-query";
import { useManageReports, type ReportCommand } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "../lib";

export function useReportCommand() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const m = useManageReports();
  const run = async (command: ReportCommand, success: string) => {
    try {
      await m.mutateAsync({ data: command });
      toast({ title: success });
      await queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === "/api/portal/reports/manage" });
      return true;
    } catch (e) {
      toast({ variant: "destructive", title: "Not saved", description: errorMessage(e) });
      return false;
    }
  };
  return { run, pending: m.isPending };
}
