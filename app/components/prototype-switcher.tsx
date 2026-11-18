// PROTOTYPE — throwaway. Floating bar that cycles `?variant=` on the current route.
import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function PrototypeSwitcher({
  variants,
  extraToggles = [],
}: {
  variants: { key: string; name: string }[];
  extraToggles?: { param: string; label: string }[];
}) {
  const [params, setParams] = useSearchParams();
  const current = params.get("variant") ?? variants[0].key;
  const index = Math.max(
    0,
    variants.findIndex((v) => v.key === current)
  );

  function go(delta: number) {
    const next = variants[(index + delta + variants.length) % variants.length];
    setParams(
      (p) => {
        p.set("variant", next.key);
        return p;
      },
      { replace: true, preventScrollReset: true }
    );
  }

  function toggle(param: string) {
    setParams(
      (p) => {
        if (p.get(param)) p.delete(param);
        else p.set(param, "1");
        return p;
      },
      { replace: true, preventScrollReset: true }
    );
  }

  // Sticky across navigation: real links drop the search param, so restore it.
  useEffect(() => {
    const saved = localStorage.getItem("prototype-variant");
    if (!params.get("variant") && saved && saved !== variants[0].key) {
      setParams((p) => { p.set("variant", saved); return p; }, { replace: true, preventScrollReset: true });
    } else if (params.get("variant")) {
      localStorage.setItem("prototype-variant", current);
    }
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (process.env.NODE_ENV === "production") return null;

  const v = variants[index];
  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-full bg-black px-2 py-1.5 text-sm text-white shadow-2xl ring-2 ring-yellow-400">
      <button onClick={() => go(-1)} className="rounded-full p-1 hover:bg-white/20">
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-48 text-center font-mono">
        {v.key} ({v.name})
      </span>
      <button onClick={() => go(1)} className="rounded-full p-1 hover:bg-white/20">
        <ChevronRight className="size-4" />
      </button>
      {extraToggles.map((t) => (
        <button
          key={t.param}
          onClick={() => toggle(t.param)}
          className={
            "rounded-full px-2 py-0.5 font-mono text-xs " +
            (params.get(t.param) ? "bg-yellow-400 text-black" : "bg-white/15")
          }
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
