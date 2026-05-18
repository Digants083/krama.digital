import { useEffect, useRef } from "react";
import { apiUrl } from "@/lib/api";

export function useQueueRealtime(clinicId: string | null | undefined, onQueueEvent: () => void) {
  const callbackRef = useRef(onQueueEvent);
  useEffect(() => {
    callbackRef.current = onQueueEvent;
  }, [onQueueEvent]);

  useEffect(() => {
    if (!clinicId || typeof EventSource === "undefined") return;

    const source = new EventSource(apiUrl(`/api/realtime/queue-events?clinic_id=${encodeURIComponent(clinicId)}`));
    source.addEventListener("queue", () => callbackRef.current());
    source.onerror = () => {
      source.close();
    };

    return () => source.close();
  }, [clinicId]);
}
