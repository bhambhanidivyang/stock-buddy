"use client";

import { getMarketSession, isMarketOpen, type MarketSession } from "@/lib/market-clock";
import { useEffect, useState } from "react";

export function useMarketOpen(pollMs = 15_000) {
  const [open, setOpen] = useState(() => isMarketOpen());
  const [session, setSession] = useState<MarketSession>(() => getMarketSession());

  useEffect(() => {
    function tick() {
      setOpen(isMarketOpen());
      setSession(getMarketSession());
    }

    tick();
    const id = window.setInterval(tick, pollMs);
    return () => window.clearInterval(id);
  }, [pollMs]);

  return { open, session };
}
