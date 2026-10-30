import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CreateQueueModal } from "./CreateQueueModal";

export function Navbar() {
  const navigate = useNavigate();
  const [user, setUser] = useState<{ id: string; email?: string | undefined; fullName?: string | undefined } | null>(null);
  const [activeQueue, setActiveQueue] = useState<{ id: string; title: string } | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadUser() {
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();

      if (!authUser) {
        setUser(null);
        setActiveQueue(null);
        return;
      }

      const fullName =
        (authUser.user_metadata?.["full_name"] as string | undefined) ||
        (authUser.user_metadata?.["name"] as string | undefined) ||
        "";

      setUser({
        id: authUser.id,
        email: authUser.email,
        fullName: fullName || authUser.email?.split("@")[0] || "Operator",
      });

      // Fetch active queue for this operator
      const { data: op } = await supabase
        .from("operators")
        .select("queue_id")
        .eq("id", authUser.id)
        .maybeSingle();

      if (op?.queue_id) {
        const { data: q } = await supabase
          .from("queues")
          .select("id, title")
          .eq("id", op.queue_id)
          .maybeSingle();

        if (q) {
          setActiveQueue({ id: q.id, title: q.title });
        } else {
          setActiveQueue(null);
        }
      } else {
        setActiveQueue(null);
      }
    }

    loadUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      loadUser();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    setUser(null);
    setActiveQueue(null);
    setDropdownOpen(false);
    navigate({ to: "/" });
    window.location.reload();
  }

  const initial = (user?.fullName || user?.email || "O").charAt(0).toUpperCase();

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-[#E8E5DF] bg-[#FBF9F5] transition-colors">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          {/* Brand Left */}
          <Link to="/" className="flex items-center gap-3">
            <span className="font-mono text-xl font-black tracking-tight text-[#111111]">Q</span>
            <div className="h-3.5 w-px bg-[#E8E5DF]" />
            <span className="font-mono text-xs uppercase tracking-wider text-[#666666]">
              Virtual Queue Engine
            </span>
          </Link>

          {/* Right Cluster */}
          {user ? (
            /* State B: Authenticated Operator */
            <div className="flex items-center gap-3 sm:gap-4">
              {/* Active Queue Live Indicator Badge */}
              {activeQueue && (
                <Link
                  to="/operator/dashboard"
                  className="hidden md:flex items-center gap-2 rounded-full border border-[#E8E5DF] bg-[#FFFFFF] px-3 py-1 font-mono text-xs text-[#111111] hover:border-[#111111] transition-colors"
                  title="Current Active Queue"
                >
                  <span className="h-2 w-2 rounded-full bg-[#30A46C] animate-pulse" />
                  <span className="max-w-[140px] truncate font-medium">{activeQueue.title}</span>
                </Link>
              )}

              {/* + New Queue Button */}
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="hidden sm:inline-flex items-center border border-[#E8E5DF] bg-[#FFFFFF] px-3.5 py-1.5 font-mono text-xs font-semibold text-[#111111] hover:bg-[#F4F1EA] transition-colors"
              >
                + New Queue
              </button>

              {/* Dashboard Direct Route */}
              <Link
                to="/operator/dashboard"
                className="font-mono text-xs font-semibold uppercase tracking-wider text-[#444444] hover:text-[#111111] transition-colors"
              >
                Dashboard
              </Link>

              {/* User Avatar with Refined Menu Dropdown */}
              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-[#111111] font-mono text-xs font-semibold text-[#FBF9F5] hover:opacity-90 transition-opacity focus:outline-none"
                  aria-label="User menu"
                  aria-expanded={dropdownOpen}
                >
                  {initial}
                </button>

                {dropdownOpen && (
                  <div className="absolute right-0 mt-2 w-64 border border-[#E8E5DF] bg-[#FFFFFF] py-2 shadow-lg z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                    <div className="border-b border-[#E8E5DF] px-4 py-2.5">
                      <p className="font-mono text-xs font-bold text-[#111111] truncate">
                        {user.fullName}
                      </p>
                      <p className="font-mono text-[11px] text-[#666666] truncate mt-0.5">
                        {user.email}
                      </p>
                    </div>

                    <div className="py-1">
                      <Link
                        to="/operator/dashboard"
                        onClick={() => setDropdownOpen(false)}
                        className="block px-4 py-2 font-mono text-xs text-[#111111] hover:bg-[#FBF9F5]"
                      >
                        Operator Console
                      </Link>

                      <button
                        type="button"
                        onClick={() => {
                          setDropdownOpen(false);
                          setIsModalOpen(true);
                        }}
                        className="w-full text-left px-4 py-2 font-mono text-xs text-[#111111] hover:bg-[#FBF9F5]"
                      >
                        Create New Queue
                      </button>

                      {activeQueue && (
                        <Link
                          to="/display/$queueId"
                          params={{ queueId: activeQueue.id }}
                          target="_blank"
                          onClick={() => setDropdownOpen(false)}
                          className="block px-4 py-2 font-mono text-xs text-[#111111] hover:bg-[#FBF9F5]"
                        >
                          Lobby TV Display ↗
                        </Link>
                      )}
                    </div>

                    <div className="border-t border-[#E8E5DF] pt-1">
                      <button
                        type="button"
                        onClick={handleSignOut}
                        className="w-full text-left px-4 py-2 font-mono text-xs text-[#E5484D] hover:bg-[#FBF9F5]"
                      >
                        Sign Out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* State A: Logged Out Guest */
            <div className="flex items-center gap-4 sm:gap-6">
              <Link
                to="/operator/login"
                className="font-mono text-xs md:text-sm font-medium text-[#444444] hover:text-[#111111] transition-colors"
              >
                Sign In
              </Link>
              <Link
                to="/operator/login"
                search={{ mode: "signup" }}
                className="rounded-full bg-[#111111] px-4 py-2 font-mono text-xs font-medium text-[#FBF9F5] hover:bg-black transition-colors"
              >
                Deploy a Queue →
              </Link>
            </div>
          )}
        </div>
      </header>

      <CreateQueueModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => {
          navigate({ to: "/operator/dashboard" });
          window.location.reload();
        }}
      />
    </>
  );
}
