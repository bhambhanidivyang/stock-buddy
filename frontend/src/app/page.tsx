"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function HomePage() {
  const { user, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    router.replace(user ? "/statements" : "/login");
  }, [ready, user, router]);

  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-stone-500">
      Loading…
    </div>
  );
}
