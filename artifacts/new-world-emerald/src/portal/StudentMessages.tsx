import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMyMessages, getGetMyMessagesQueryKey, useSendMyMessage, useMarkMyMessagesRead,
  type MessageChannel,
} from "@workspace/api-client-react";
import { Building2, GraduationCap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ErrorPanel, Skeleton } from "./ui";
import { errorMessage } from "./lib";
import { ChatComposer, ChatMessages } from "./chat";

/** The student's two conversations: their class teacher and the school office. */
export function StudentMessages() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const q = useGetMyMessages({ query: { queryKey: getGetMyMessagesQueryKey(), refetchInterval: 20000 } });
  const send = useSendMyMessage();
  const markRead = useMarkMyMessagesRead();
  const [channel, setChannel] = useState<MessageChannel>("class");
  const thread = q.data?.threads.find((t) => t.channel === channel);
  const unread = thread?.unread ?? 0;

  // Opening a conversation (or a new reply arriving while it is open) marks the replies read.
  useEffect(() => {
    if (!unread || markRead.isPending) return;
    markRead.mutate({ data: { channel } }, { onSuccess: (d) => queryClient.setQueryData(getGetMyMessagesQueryKey(), d) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, unread]);

  if (q.isLoading) return <Skeleton className="h-80" />;
  if (q.isError || !q.data || !thread) return <ErrorPanel title="Messages could not load" message={errorMessage(q.error)} onRetry={() => q.refetch()} />;

  const onSend = async (body: string) => {
    try {
      queryClient.setQueryData(getGetMyMessagesQueryKey(), await send.mutateAsync({ data: { channel, body } }));
      return true;
    } catch (e) { toast({ variant: "destructive", title: "Message not sent", description: errorMessage(e) }); return false; }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Conversations">
        {q.data.threads.map((t) => {
          const Icon = t.channel === "office" ? Building2 : GraduationCap;
          const on = t.channel === channel;
          return (
            <button key={t.channel} type="button" role="tab" aria-selected={on} onClick={() => setChannel(t.channel)}
              className={"portal-card flex items-center gap-2.5 p-3 text-left " + (on ? "ring-2 ring-[hsl(var(--p-emerald))]" : "")} data-testid={`tab-thread-${t.channel}`}>
              <Icon size={18} className="shrink-0 text-[hsl(var(--p-emerald))]" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{t.title}</span>
              {t.unread > 0 && <span className="rounded-full bg-[hsl(var(--p-red))] px-2 text-xs font-bold text-white" data-testid={`badge-thread-${t.channel}`}>{t.unread}</span>}
            </button>
          );
        })}
      </div>
      <section className="portal-card overflow-hidden" aria-label={thread.title}>
        <ChatMessages messages={thread.messages} mine="student"
          empty={channel === "office" ? "Ask the school office about fees, forms, uniforms or anything else." : "Send your class teacher a message about school work or being away."} />
        <ChatComposer onSend={onSend} pending={send.isPending} placeholder={`Message ${thread.title.toLowerCase().startsWith("school") ? "the school office" : "your class teacher"}`} />
      </section>
      <p className="text-xs text-[hsl(var(--p-ink)/0.55)]">Messages are kept by the school. Be polite and do not share passwords.</p>
    </div>
  );
}
