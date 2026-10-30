import { useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface CreateQueueModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (queueId?: string) => void;
}

export function CreateQueueModal({ isOpen, onClose, onSuccess }: CreateQueueModalProps) {
  const navigate = useNavigate();
  const [queueName, setQueueName] = useState("");
  const [operatorEmails, setOperatorEmails] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!queueName.trim()) return;

    setErrorMsg(null);
    setBusy(true);

    const emails = operatorEmails
      .split(",")
      .map((em) => em.trim())
      .filter((em) => em.length > 0);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      sessionStorage.setItem(
        "q_pending_queue",
        JSON.stringify({ title: queueName.trim(), emails }),
      );
      setBusy(false);
      onClose();
      navigate({ to: "/operator/login" });
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)(
        "create_queue_with_operators",
        {
          p_title: queueName.trim(),
          p_operator_emails: emails,
        },
      );

      setBusy(false);

      if (error) {
        setErrorMsg(error.message);
        return;
      }

      sessionStorage.removeItem("q_pending_queue");
      toast.success("Queue created successfully");
      setQueueName("");
      setOperatorEmails("");
      onClose();

      if (onSuccess) {
        onSuccess(data);
      } else {
        navigate({ to: "/operator/dashboard" });
      }
    } catch (err: unknown) {
      setBusy(false);
      setErrorMsg(err instanceof Error ? err.message : "Failed to create queue.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#111111]/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg border border-[#E8E5DF] bg-[#FFFFFF] p-6 sm:p-8 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#E8E5DF] pb-4">
          <div>
            <h2 className="font-mono text-lg font-bold text-[#111111]">Deploy New Queue</h2>
            <p className="font-mono text-xs text-[#666666] mt-0.5">
              Set up a live queue hopper with dynamic buffers
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#666666] hover:text-[#111111] font-mono text-xl leading-none p-1"
            aria-label="Close modal"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div>
            <label
              htmlFor="modalQueueName"
              className="block font-mono text-xs font-semibold uppercase text-[#111111]"
            >
              Queue Name <span className="text-[#E5484D]">*</span>
            </label>
            <input
              id="modalQueueName"
              type="text"
              required
              autoFocus
              maxLength={100}
              value={queueName}
              onChange={(e) => setQueueName(e.target.value)}
              placeholder="e.g. Student Affairs Verification, Registry Intake"
              className="mt-1.5 h-11 w-full border border-[#E8E5DF] bg-[#FBF9F5] px-3.5 font-mono text-xs md:text-sm text-[#111111] outline-none placeholder:text-[#999999] focus:border-[#111111]"
            />
          </div>

          <div>
            <label
              htmlFor="modalOperatorEmails"
              className="block font-mono text-xs font-semibold uppercase text-[#111111]"
            >
              Invite Operators (Optional)
            </label>
            <p className="font-mono text-[11px] text-[#666666] mt-0.5 mb-1.5">
              Comma-separated email addresses. Invited clerks get instant access upon login.
            </p>
            <input
              id="modalOperatorEmails"
              type="text"
              value={operatorEmails}
              onChange={(e) => setOperatorEmails(e.target.value)}
              placeholder="clerk1@venue.org, clerk2@venue.org"
              className="h-11 w-full border border-[#E8E5DF] bg-[#FBF9F5] px-3.5 font-mono text-xs md:text-sm text-[#111111] outline-none placeholder:text-[#999999] focus:border-[#111111]"
            />
          </div>

          {errorMsg && (
            <div className="border border-[#E5484D]/30 bg-[#E5484D]/10 p-3 font-mono text-xs text-[#E5484D]">
              {errorMsg}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="h-11 px-5 border border-[#E8E5DF] bg-[#FFFFFF] font-mono text-xs font-semibold text-[#666666] hover:text-[#111111]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !queueName.trim()}
              className="h-11 px-6 bg-[#111111] font-mono text-xs font-bold uppercase tracking-wider text-[#FBF9F5] transition-colors hover:bg-neutral-800 disabled:opacity-40"
            >
              {busy ? "Creating…" : "Create Queue →"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
