import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useQueue } from "@/context/QueueContext";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Users, SkipForward, ArrowRightCircle, RefreshCw, Clock, QrCode, Calendar, Play, Square, MoveRight } from "lucide-react";

interface TimeSlot {
  slot_name: string;
  time_range: number[];
  is_open: boolean;
}

// Convert 24-hour to 12-hour format for display
const formatTimeRange = (timeRange: number[]) => {
  const convertHour = (h: number) => {
    if (h === 0) return { hour: 12, ampm: "AM" };
    if (h === 12) return { hour: 12, ampm: "PM" };
    if (h > 12) return { hour: h - 12, ampm: "PM" };
    return { hour: h, ampm: "AM" };
  };
  const start = convertHour(timeRange[0]);
  const end = convertHour(timeRange[1]);
  return `${start.hour}:00 ${start.ampm} - ${end.hour}:00 ${end.ampm}`;
};


const SourceBadge = ({ source }: { source: string }) => {
  const map: Record<string, { label: string; className: string }> = {
    walkin:  { label: "Walk-in",  className: "bg-[#FFC107]/20 text-[#7A5800]" },
    online:  { label: "Online",   className: "bg-[#00555A]/10 text-[#00555A]" },
    desk:    { label: "Desk",     className: "bg-slate-100 text-slate-600" },
  };
  const style = map[source] ?? map.desk;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${style.className}`}>
      {source === "walkin" && <QrCode className="h-3 w-3" />}
      {style.label}
    </span>
  );
};

const ClinicControlQueue = () => {
  const {
    queue,
    nextPatient,
    completePatient,
    skipPatient,
    currentToken,
    completedCount,
    totalToday,
    currentServing,
    fetchQueueForClinic,
    activeSlotId,
    viewingSlotId,
  } = useQueue();

  const [clinicId, setClinicId] = useState("");
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isClinicActive, setIsClinicActive] = useState(false);
  const [manualStopLocked, setManualStopLocked] = useState(false);
  const [activating, setActivating] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [pushingToken, setPushingToken] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    const clinicStr = localStorage.getItem("clinic_id");
    if (clinicStr) {
      setClinicId(clinicStr);
      fetchQueueForClinic(clinicStr, selectedSlotId, currentServing?.startTime);
    }
  }, [fetchQueueForClinic, selectedSlotId, currentServing?.startTime]);

  useEffect(() => {
    if (!clinicId) return;

    const interval = setInterval(() => {
      fetchQueueForClinic(clinicId, selectedSlotId, currentServing?.startTime);
    }, 15000);

    return () => clearInterval(interval);
  }, [clinicId, fetchQueueForClinic, selectedSlotId, currentServing?.startTime]);

  useEffect(() => {
    if (currentServing?.startTime) {
      const interval = setInterval(() => {
        const diff = Math.floor(
          (new Date().getTime() - new Date(currentServing.startTime!).getTime()) / 1000
        );
        setElapsedTime(diff);
      }, 1000);
      return () => clearInterval(interval);
    } else {
      setElapsedTime(0);
    }
  }, [currentServing]);

  const handleRefreshQueue = () => {
    if (
      window.confirm(
        "Refresh the queue? This will reload today's data from the server."
      )
    ) {
      if (clinicId) fetchQueueForClinic(clinicId, selectedSlotId, currentServing?.startTime);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const walkinCount = queue.filter((p) => p.source === "walkin").length;

  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [slotStatus, setSlotStatus] = useState<string[]>([]); // "open" or "close" for each slot
  const [loadingSlots, setLoadingSlots] = useState(false);

  useEffect(() => {
    if (clinicId) {
      fetchTimeSlots();
    }
  }, [clinicId]);

  useEffect(() => {
    if (viewingSlotId !== null && selectedSlotId === null) {
      setSelectedSlotId(viewingSlotId);
    }
  }, [viewingSlotId, selectedSlotId]);

  useEffect(() => {
    if (!clinicId) return;

    const interval = setInterval(() => {
      fetchTimeSlots();
    }, 60000);

    return () => clearInterval(interval);
  }, [clinicId]);

  const fetchTimeSlots = async () => {
    setLoadingSlots(true);
    try {
      const response = await fetch(`/api/auth/clinic/time-slots?clinic_id=${clinicId}`);
      if (response.ok) {
        const data = await response.json();
        const slots = data.slots || [];
        setTimeSlots(slots);
        setSlotStatus(data.slot || []); // Set the slot status array (open/close)

        // Auto-logout: check if current time is past all slot end times
        if (isClinicActive && slots.length > 0) {
          const now = new Date();
          const currentMinutes = now.getHours() * 60 + now.getMinutes();

          // Check if there are future slots available today
          const hasFutureSlots = () => {
            for (const slot of slots) {
              if (!slot.is_open) continue;

              const endMinutes = slot.time_range[1] * 60;
              if (currentMinutes < endMinutes) {
                return true; // There are future slots
              }
            }
            return false; // No future slots
          };

          // Only auto-deactivate if no future slots available
          if (!hasFutureSlots()) {
            // Check if all slots have expired
            let allExpired = true;
            for (const slot of slots) {
              if (slot.is_open) {
                const endMinutes = slot.time_range[1] * 60;
                if (currentMinutes < endMinutes) {
                  allExpired = false;
                  break;
                }
              }
            }

            // If all slots expired, auto deactivate
            if (allExpired) {
              handleDeactivate(false);
            } else {
              // Also check 15 minutes before last OPEN slot ends
              let latestEndMinutes = 0;
              for (const slot of slots) {
                if (slot.is_open) {
                  const endMinutes = slot.time_range[1] * 60;
                  if (endMinutes > latestEndMinutes) {
                    latestEndMinutes = endMinutes;
                  }
                }
              }

              // If current time is past (end - 15min), auto deactivate
              const cutoffMinutes = latestEndMinutes - 15;
              if (currentMinutes >= cutoffMinutes && latestEndMinutes > 0) {
                handleDeactivate(false);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Error fetching time slots:", error);
    } finally {
      setLoadingSlots(false);
    }
  };

  useEffect(() => {
    if (clinicId) {
      fetch(`/api/auth/clinic/active-status?clinic_id=${clinicId}`)
        .then(res => res.json())
        .then(data => {
          setIsClinicActive(data.is_active || false);
          setManualStopLocked(data.manual_stop_locked || false);
        })
        .catch(console.error);
    }
  }, [clinicId]);

  const handleActivate = async () => {
    setActivating(true);
    try {
      const response = await fetch("/api/auth/clinic/set-active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinic_id: clinicId, is_active: true })
      });
      if (response.ok) {
        setIsClinicActive(true);
        setManualStopLocked(false);
        setMessage({ text: "Clinic is now live.", type: "success" });
        fetchTimeSlots();
      } else {
        const error = await response.json().catch(() => ({}));
        setMessage({ text: error.detail || "Could not start clinic.", type: "error" });
      }
    } catch (error) {
      console.error("Error activating clinic:", error);
      setMessage({ text: "Network error while starting clinic.", type: "error" });
    } finally {
      setActivating(false);
    }
  };

  const handleDeactivate = async (manualStop = true) => {
    setActivating(true);
    try {
      const response = await fetch("/api/auth/clinic/set-active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinic_id: clinicId, is_active: false, manual_stop: manualStop })
      });
      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        setIsClinicActive(false);
        setManualStopLocked(data.manual_stop_date ? manualStop : false);
        setMessage({
          text: manualStop ? "Clinic is offline for today." : "Clinic is now offline.",
          type: "success"
        });
      } else {
        const error = await response.json().catch(() => ({}));
        setMessage({ text: error.detail || "Could not stop clinic.", type: "error" });
      }
    } catch (error) {
      console.error("Error deactivating clinic:", error);
      setMessage({ text: "Network error while stopping clinic.", type: "error" });
    } finally {
      setActivating(false);
    }
  };

  const totalTodayReal = completedCount + queue.length + (currentServing ? 1 : 0);

  // Check if all slots have expired
  const allSlotsExpired = () => {
    if (timeSlots.length === 0) return true;
    
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    
    for (const slot of timeSlots) {
      if (slot.is_open) {
        const endMinutes = slot.time_range[1] * 60;
        if (currentMinutes < endMinutes) {
          return false;
        }
      }
    }
    return true;
  };

  const canActivateNow = () => {
    if (timeSlots.length === 0) return false;
    const slot1Start = timeSlots[0]?.time_range?.[0];
    if (typeof slot1Start !== "number") return false;

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const slot1StartMinutes = slot1Start * 60;
    const activationThresholdMinutes = slot1StartMinutes - 45;

    let latestEndMinutes = 0;
    for (const slot of timeSlots) {
      if (slot.is_open) {
        const endMinutes = slot.time_range[1] * 60;
        if (endMinutes > latestEndMinutes) {
          latestEndMinutes = endMinutes;
        }
      }
    }

    if (latestEndMinutes <= 0) return false;

    const cutoffMinutes = latestEndMinutes - 15;

    return currentMinutes >= activationThresholdMinutes &&
      currentMinutes < cutoffMinutes;
  };

  // Check if current time is past the viewing slot's start time
  const canServeInCurrentSlot = () => {
    if (timeSlots.length === 0) return false;

    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTimeDecimal = currentHour + currentMinute / 60.0;

    // Check if can serve in ANY available slot
    for (const slot of timeSlots) {
      if (!slot.is_open) continue;

      const [startHour, endHour] = slot.time_range;

      // Can serve if current time is >= (slot start - 7.5 minutes)
      const startThreshold = startHour - 7.5 / 60; // 7.5 minutes in hours
      if (currentTimeDecimal >= startThreshold && currentTimeDecimal < endHour) {
        return true;
      }
    }

    // Can serve if there are patients in queue (even after all slot end times)
    if (queue.length > 0) {
      return true;
    }

    return false;
  };

  // Check if a slot is currently available based on time and status
  const isSlotCurrentlyAvailable = (slot: TimeSlot, index: number): boolean => {
    // Check if slot is marked as "close" in the slotStatus array
    if (slotStatus[index] === "close") return false;
    
    if (!slot.is_open) return false;

    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTimeDecimal = currentHour + currentMinute / 60.0;

    const [startHour, endHour] = slot.time_range;

    // Slot is available if it's open and end time hasn't passed yet
    // (can be in the past, current, or future - as long as not expired)
    return currentTimeDecimal < endHour;
  };

  const isServingAllowedForViewingSlot =
    (selectedSlotId ?? viewingSlotId) !== null &&
    activeSlotId !== null &&
    (selectedSlotId ?? viewingSlotId) === activeSlotId;

  const currentSlotLabelId = selectedSlotId ?? viewingSlotId;

  const handleSlotSelect = (slotId: number) => {
    setSelectedSlotId(slotId);
    if (clinicId) {
      fetchQueueForClinic(clinicId, slotId, currentServing?.startTime);
    }
  };

  const pushPatientToNextSlot = async (appointmentId: number, token: string, source: string) => {
    if (!window.confirm(`Push patient ${token} to the next available slot? They will be added to the end of the queue and receive an email notification.`)) {
      return;
    }

    setPushingToken(token);
    try {
      const response = await fetch("/api/auth/clinic/push-patient-to-next-slot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinic_id: clinicId,
          appointment_id: appointmentId,
          source: source
        })
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({
          text: data.action === "auto_finished"
            ? `Patient was in last slot - marked as not served`
            : `Patient ${token} pushed to next slot`,
          type: "success"
        });
        // Refresh the queue
        if (clinicId) {
          fetchQueueForClinic(clinicId, selectedSlotId, currentServing?.startTime);
        }
      } else {
        setMessage({ text: data.detail || "Failed to push patient", type: "error" });
      }
    } catch (error) {
      console.error("Error pushing patient:", error);
      setMessage({ text: "Network error while pushing patient", type: "error" });
    } finally {
      setPushingToken(null);
    }
  };

  // Check if a patient's slot has expired (for showing push button)
  const isPatientSlotExpired = (patientSlotId: number | null | undefined): boolean => {
    if (patientSlotId == null || timeSlots.length === 0) return false;

    const slotIndex = patientSlotId - 1;
    if (slotIndex < 0 || slotIndex >= timeSlots.length) return false;

    const slot = timeSlots[slotIndex];
    if (!slot || !Array.isArray(slot.time_range) || slot.time_range.length < 2) {
      return false;
    }
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTimeDecimal = currentHour + currentMinute / 60.0;

    const slotEnd = slot.time_range[1];
    return currentTimeDecimal >= slotEnd;
  };

  // Check if patient is in the last slot
  const isPatientInLastSlot = (patientSlotId: number | null): boolean => {
    if (patientSlotId === null || timeSlots.length === 0) return false;
    return patientSlotId >= timeSlots.length;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {message && (
        <div
          className={`fixed right-4 top-20 z-50 rounded-full px-4 py-2 text-sm shadow-lg ${
            message.type === "success" ? "bg-[#00555A] text-white" : "bg-red-600 text-white"
          }`}
        >
          {message.text}
        </div>
      )}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200 shadow-sm">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Link to="/clinic" className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="text-xl font-bold text-slate-800">Queue Control</h1>
              <p className="text-xs text-slate-500">Manage your clinic's patient queue</p>
            </div>
          </div>
          <Button
            variant="outline"
            className="border-slate-300 text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-lg font-medium transition-all"
            onClick={handleRefreshQueue}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        {/* Clinic Status Card */}
        <div className={`rounded-2xl p-5 mb-6 flex items-center justify-between shadow-lg border-2 transition-all ${
            isClinicActive 
              ? "bg-gradient-to-r from-green-50 to-white border-green-200" 
              : "bg-gradient-to-r from-slate-50 to-white border-slate-200"
          }`}>
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${isClinicActive ? 'bg-green-100' : 'bg-slate-100'}`}>
                {isClinicActive ? (
                  <div className="w-4 h-4 bg-green-500 rounded-full animate-pulse"></div>
                ) : (
                  <Clock className="h-6 w-6 text-slate-400" />
                )}
              </div>
              <div>
                <span className={`text-lg font-bold ${isClinicActive ? "text-green-700" : "text-slate-600"}`}>
                  {isClinicActive ? "Clinic is Live" : "Clinic is Offline"}
                </span>
                <p className="text-sm text-slate-500">{isClinicActive ? "Accepting patients" : "Not accepting patients"}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button
                onClick={handleActivate}
                disabled={activating || isClinicActive || manualStopLocked || allSlotsExpired() || !canActivateNow()}
                className="bg-green-500 hover:bg-green-600 text-white px-6 py-2.5 rounded-lg font-medium shadow-md hover:shadow-lg transition-all"
              >
                <Play className="h-4 w-4 mr-2" />
                Start
              </Button>
              <Button
                onClick={() => handleDeactivate(true)}
                disabled={activating || !isClinicActive}
                variant="outline"
                className="border-red-300 text-red-500 hover:bg-red-50 px-6 py-2.5 rounded-lg font-medium transition-all"
              >
                <Square className="h-4 w-4 mr-2" />
                Stop
              </Button>
            </div>
          </div>

          {/* Time Slots Card */}
          <div className="bg-white rounded-2xl shadow-lg border border-slate-100 overflow-hidden mb-6">
            <div className="bg-gradient-to-r from-slate-50 to-white px-5 py-4 border-b border-slate-100 flex items-center gap-2">
              <Calendar className="h-5 w-5 text-[#00555A]" />
              <h2 className="font-semibold text-slate-800">Today's Time Slots</h2>
            </div>
            <div className="p-5">
              {loadingSlots ? (
                <div className="text-center py-6">
                  <div className="animate-spin h-6 w-6 border-2 border-[#00555A] border-t-transparent rounded-full mx-auto"></div>
                  <p className="text-sm text-slate-500 mt-2">Loading slots...</p>
                </div>
              ) : timeSlots.length === 0 ? (
                <div className="text-center py-6">
                  <div className="bg-slate-100 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Clock className="h-6 w-6 text-slate-400" />
                  </div>
                  <p className="text-sm text-slate-600 mb-2">No time slots configured.</p>
                  <Link to="/clinic/manage-time" className="text-[#00555A] text-sm font-medium hover:underline">
                    Set up time slots →
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {timeSlots.map((slot, index) => {
                    const isCurrentlyAvailable = isSlotCurrentlyAvailable(slot, index);
                    const isSlotClosed = slotStatus[index] === "close";
                    const isExpired = !isCurrentlyAvailable && !isSlotClosed && slot.is_open;
                    return (
                      <button
                        type="button"
                        key={index}
                        onClick={() => handleSlotSelect(index + 1)}
                        className={`border-2 rounded-xl p-4 transition-all ${
                          currentSlotLabelId === index + 1
                            ? "bg-gradient-to-r from-[#00555A]/10 to-white border-[#00555A] shadow-md"
                            : isCurrentlyAvailable
                              ? "bg-gradient-to-r from-green-50 to-white border-green-200"
                              : "bg-slate-50 border-slate-200"
                        }`}
                        disabled={isSlotClosed || !slot.is_open || isExpired}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="font-semibold text-slate-800">{slot.slot_name.replace('Time ', 'Session ')}</h3>
                            <p className="text-sm text-slate-500 font-medium">
                              {formatTimeRange(slot.time_range)}
                            </p>
                          </div>
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${isExpired ? 'bg-red-100 text-red-700' : isCurrentlyAvailable ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>
                            {isExpired ? 'Expired' : (isSlotClosed ? 'Not Available' : (isCurrentlyAvailable ? 'Available' : 'Unavailable'))}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-5 text-center">
              <div className="bg-slate-100 w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2">
                <Users className="h-5 w-5 text-slate-600" />
              </div>
              <p className="text-xs text-slate-500 font-medium mb-1">In Queue</p>
              <p className="text-3xl font-bold text-slate-800">{queue.length}</p>
              {currentSlotLabelId && (
                <p className="text-xs text-slate-400 mt-1">Slot {currentSlotLabelId}</p>
              )}
            </div>
            <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-5 text-center">
              <div className="bg-[#FFC107]/20 w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2">
                <ArrowRightCircle className="h-5 w-5 text-[#FFC107]" />
              </div>
              <p className="text-xs text-slate-500 font-medium mb-1">Completed</p>
              <p className="text-3xl font-bold text-[#FFC107]">{completedCount}</p>
              {currentSlotLabelId && (
                <p className="text-xs text-slate-400 mt-1">Slot {currentSlotLabelId}</p>
              )}
            </div>
            <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-5 text-center">
              <div className="bg-[#00555A]/10 w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2">
                <Clock className="h-5 w-5 text-[#00555A]" />
              </div>
              <p className="text-xs text-slate-500 font-medium mb-1">Now Serving</p>
              <p className="text-3xl font-bold text-[#00555A]">{currentServing ? 1 : 0}</p>
              {currentSlotLabelId && (
                <p className="text-xs text-slate-400 mt-1">Slot {currentSlotLabelId}</p>
              )}
            </div>
          </div>

          {/* Current Patient Card */}
          <div className="bg-white rounded-2xl shadow-lg border border-slate-100 overflow-hidden mb-6">
            <div className="bg-gradient-to-r from-[#00555A] to-[#006e78] px-6 py-4">
              <p className="text-white font-semibold text-center">
                {currentServing ? "Now Serving" : queue.length > 0 ? "Next to Serve" : "No Patient"}
              </p>
            </div>
            <div className="p-6 text-center">
              {currentServing ? (
                <>
                  <div className="text-6xl font-extrabold text-slate-800 mb-4">{currentServing.token}</div>
                  <div className="bg-gradient-to-r from-green-50 to-white border-2 border-green-200 rounded-xl p-4">
                    <div className="flex items-center justify-center gap-2 flex-wrap mb-2">
                      <p className="font-semibold text-slate-800 text-lg">
                        {currentServing.patientName}
                      </p>
                      <SourceBadge source={
                        queue.find((q) => q.token === currentServing.token)?.source || "online"
                      } />
                    </div>
                    <div className="flex items-center justify-center gap-2 text-sm text-slate-600">
                      <Clock className="h-4 w-4" />
                      <span>Elapsed: {formatTime(elapsedTime)}</span>
                    </div>
                  </div>
                </>
              ) : queue.length > 0 ? (
                <>
                  <div className="text-6xl font-extrabold text-slate-800 mb-4">{queue[0].token}</div>
                  <div className="bg-gradient-to-r from-[#00555A]/5 to-[#00555A]/10 border-2 border-[#00555A]/20 rounded-xl p-4">
                    <div className="flex items-center justify-center gap-2 flex-wrap mb-2">
                      <p className="font-semibold text-slate-800 text-lg">
                        {queue[0].name}
                      </p>
                      <SourceBadge source={queue[0].source} />
                    </div>
                    {queue[0].phone && (
                      <p className="text-xs text-slate-500">{queue[0].phone}</p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-6xl font-extrabold text-slate-300 mb-4">--</div>
                  <p className="text-slate-500">No patients in queue</p>
                </>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-4 mb-6">
            <Button
              className={`flex-1 hover:opacity-90 rounded-xl transition-all duration-200 py-3 font-semibold shadow-md hover:shadow-lg ${
                currentServing
                  ? "bg-[#FFC107] text-[#0F172A]"
                  : "bg-[#00555A] text-white hover:bg-[#00494F]"
              }`}
              onClick={() => currentServing ? completePatient() : nextPatient()}
              disabled={
                (!currentServing && queue.length === 0) ||
                (!currentServing && queue.length > 0 && !canServeInCurrentSlot())
              }
            >
              <ArrowRightCircle className="mr-2 h-5 w-5" />
              {currentServing ? "Completed" : "Next Patient"}
            </Button>
              <Button
                variant="outline"
                className="flex-1 border-slate-300 text-slate-600 hover:bg-slate-100 rounded-xl transition-all duration-200 py-3 font-semibold"
                onClick={() => skipPatient()}
                disabled={queue.length === 0 || !canServeInCurrentSlot()}
              >
                <SkipForward className="mr-2 h-5 w-5" />
                Skip
              </Button>
          </div>

          {/* Waiting Queue */}
          <div className="bg-white rounded-2xl shadow-lg border border-slate-100 overflow-hidden">
            <div className="bg-gradient-to-r from-slate-50 to-white px-5 py-4 border-b border-slate-100 flex items-center gap-2">
              <Users size={18} className="text-[#00555A]" />
              <h2 className="font-semibold text-slate-800">Waiting Queue</h2>
              {typeof currentSlotLabelId === "number" && (
                <span className="ml-2 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                  Slot {currentSlotLabelId}
                  {!isServingAllowedForViewingSlot && " (Upcoming)"}
                </span>
              )}
              {walkinCount > 0 && (
                <span className="ml-auto flex items-center gap-1 text-xs text-[#7A5800] bg-[#FFC107]/20 px-2 py-1 rounded-full">
                  <QrCode className="h-3 w-3" />
                  {walkinCount} walk-in{walkinCount > 1 ? "s" : ""}
                </span>
              )}
            </div>
            <div className="p-4">
              {queue.length === 0 ? (
                <div className="text-center py-8">
                  <div className="bg-slate-100 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Users className="h-6 w-6 text-slate-400" />
                  </div>
                  <p className="text-slate-500">No patients in queue</p>
                </div>
              ) : null}
              {queue.length > 0 && (
                <div className="space-y-3">
                  {queue.map((p, i) => (
                    <div
                      key={p.token}
                      className={`flex justify-between items-center rounded-xl px-4 py-3 border-2 transition-all hover:shadow-md ${
                        p.source === "walkin"
                          ? "bg-gradient-to-r from-[#FFC107]/10 to-white border-[#FFC107]/30"
                          : "bg-slate-50 border-transparent"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm ${
                          p.source === "walkin" ? "bg-[#FFC107]/20 text-[#7A5800]" : "bg-[#00555A]/10 text-[#00555A]"
                        }`}>
                          {p.token}
                        </div>
                        <div>
                          <p className="font-semibold text-slate-800">
                            {p.name}
                          </p>
                          {p.source === "walkin" ? (
                            p.phone && (
                              <p className="text-xs text-slate-500">{p.phone}</p>
                            )
                          ) : (
                            <>
                              {p.phone && (
                                <p className="text-xs text-slate-500">{p.phone}</p>
                              )}
                              {p.patient_email && (
                                <p className="text-xs text-slate-400">{p.patient_email}</p>
                              )}
                            </>
                          )}
                        </div>
                        <SourceBadge source={p.source} />
                      </div>
                      <div className="flex items-center gap-2">
                        {isPatientSlotExpired(p.slot_id) && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs border-amber-300 text-amber-700 hover:bg-amber-50"
                            onClick={() => pushPatientToNextSlot(p.appointment_id, p.token, p.source)}
                            disabled={pushingToken === p.token}
                          >
                            <MoveRight className="h-3 w-3 mr-1" />
                            {isPatientInLastSlot(p.slot_id) ? "Not Served" : "Push"}
                          </Button>
                        )}
                        <span className="text-xs text-slate-500 font-bold bg-slate-100 px-2 py-1 rounded-full">#{i + 1}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
      </main>
    </div>
  );
};

export default ClinicControlQueue;
