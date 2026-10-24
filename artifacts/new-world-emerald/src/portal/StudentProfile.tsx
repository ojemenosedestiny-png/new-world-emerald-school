import { useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetMyPhoto, getGetMyPhotoQueryKey, useUploadMyPhoto, type PortalSession } from "@workspace/api-client-react";
import { BadgeCheck, Camera, Clock, GraduationCap, IdCard, KeyRound } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PasswordChange } from "./PasswordChange";
import { errorMessage } from "./lib";
import { Avatar, preparePhoto } from "./photos";

/** The student's own details, profile photo (approved by staff) and password. */
export function StudentProfile({ session, className }: { session: PortalSession; className: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const photo = useGetMyPhoto({ query: { queryKey: getGetMyPhotoQueryKey() } });
  const upload = useUploadMyPhoto();
  const input = useRef<HTMLInputElement>(null);
  const rows: [typeof IdCard, string, string][] = [
    [IdCard, "Student ID", session.studentId ?? ""],
    [GraduationCap, "Class", className || "-"],
    [BadgeCheck, "Account", "Active"],
  ];
  const choose = async (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!file) return;
    try {
      const blob = await preparePhoto(file, 800);
      const next = await upload.mutateAsync({ data: blob });
      queryClient.setQueryData(getGetMyPhotoQueryKey(), next);
      toast({ title: "Photo sent", description: "Your teacher or the school office will check it before it appears." });
    } catch (e) { toast({ variant: "destructive", title: "Photo not uploaded", description: errorMessage(e) }); }
  };
  const p = photo.data;
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 lg:px-0">
      <section className="portal-card overflow-hidden" data-testid="panel-profile">
        <div className="portal-hero flex items-center gap-4 px-6 py-6">
          <Avatar name={session.name} photoId={p?.photoId} size={72} className="bg-[hsl(41_72%_52%)] text-[hsl(205_40%_10%)] ring-4 ring-white/25" />
          <div className="min-w-0 flex-1"><p className="truncate font-serif text-2xl font-semibold">{session.name}</p><p className="text-sm text-white/75">New World Emerald student</p></div>
        </div>
        <div className="flex flex-col gap-3 border-b border-[hsl(var(--p-line))] px-6 py-4 sm:flex-row sm:items-center" data-testid="panel-photo">
          <div className="min-w-0 flex-1 text-sm">
            {p?.pendingPhotoId ? <p className="flex items-center gap-2 font-semibold text-[hsl(var(--p-gold-ink))]" data-testid="text-photo-pending"><Clock size={15} /> New photo waiting for approval</p>
              : <p className="font-semibold">Profile photo</p>}
            <p className="text-xs text-[hsl(var(--p-ink)/0.6)]">{p && !p.uploadsEnabled ? "Photo uploads are not switched on yet. Ask the school office." : "Use a clear, recent photo of your face. Staff approve it before it shows."}</p>
          </div>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void choose(e.target.files?.[0])} data-testid="input-photo" />
          <button type="button" className="portal-btn-ghost shrink-0" disabled={!p?.uploadsEnabled || upload.isPending} onClick={() => input.current?.click()} data-testid="button-upload-photo">
            <Camera size={15} /> {upload.isPending ? "Uploading..." : p?.photoId || p?.pendingPhotoId ? "Change photo" : "Add photo"}
          </button>
        </div>
        <dl className="divide-y divide-[hsl(var(--p-line))]">
          {rows.map(([Icon, label, value]) => (
            <div key={label} className="flex items-center gap-3 px-6 py-3.5">
              <Icon size={17} className="text-[hsl(var(--p-emerald))]" aria-hidden="true" />
              <dt className="w-28 text-sm text-[hsl(var(--p-ink)/0.6)]">{label}</dt>
              <dd className={"min-w-0 flex-1 truncate font-semibold " + (label === "Student ID" ? "font-mono" : "")}>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="border-t border-[hsl(var(--p-line))] px-6 py-3 text-xs text-[hsl(var(--p-ink)/0.55)]">To correct your name or class, contact the school office.</p>
      </section>
      <section className="portal-card p-6" aria-labelledby="pw-heading">
        <h2 id="pw-heading" className="mb-4 flex items-center gap-2 text-lg font-semibold"><KeyRound size={18} className="text-[hsl(var(--p-emerald))]" /> Change password</h2>
        <PasswordChange required={false} />
      </section>
    </div>
  );
}
