import { useEffect, useState } from "react";
import { signingDate } from "../supabase/functions/_shared/date";
export function useSigningDate() {
  const [today, setToday] = useState(() => signingDate());
  useEffect(() => {
    const timer = setInterval(() => setToday(signingDate()), 30000);
    return () => clearInterval(timer);
  }, []);
  return today;
}
