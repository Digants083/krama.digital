import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useQueue } from "@/context/QueueContext";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Users, SkipForward, ArrowRightCircle, RefreshCw, Clock, QrCode, Calendar, Play, Square } from "lucide-react";

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
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    const clinicStr = localStorage.getItem("clinic_id");
    if (clinicStr) {
      setClinicId(clinicStr);
      fetchQueueForClinic(clinicStr);
    }
  }, [fetchQueueForClinic]);

  useEffect(() => {
    if (!clinicId) return;

    const interval = setInterval(() => {
      fetchQueueForClinic(clinicId);
    }, 15000);

    return () => clearInterval(interval);
  }, [clinicId, fetchQueueForClinic]);

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
      if (clinicId) fetchQueueForClinic(clinicId);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const walkinCount = queue.filter((p) => p.source === "walkin").length;

  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  useEffect(() => {
    if (clinicId) {
      fetchTimeSlots();
    }
  }, [clinicId]);

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
      const response = await fetch(`http://localhost:8000/auth/clinic/time-slots?clinic_id=${clinicId}`);
      if (response.ok) {
        const data = await response.json();
        const slots = data.slots || [];
        setTimeSlots(slots);

        // Auto-logout: check if current time is past all slot end times
        if (isClinicActive && slots.length > 0) {
          const now = new Date();
          const currentMinutes = now.getHours() * 60 + now.getMinutes();

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
            handleDeactivate();
          } else {
            // Also check 15 minutes before last OPEN slot ends (existing logic)
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
              handleDeactivate();
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
      fetch(`http://localhost:8000/auth/clinic/active-status?clinic_id=${clinicId}`)
        .then(res => res.json())
        .then(data => setIsClinicActive(data.is_active || false))
        .catch(console.error);
    }
  }, [clinicId]);

  const handleActivate = async () => {
    setActivating(true);
    try {
      const response = await fetch("http://localhost:8000/auth/clinic/set-active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinic_id: clinicId, is_active: true })
      });
      if (response.ok) {
        setIsClinicActive(true);
      }
    } catch (error) {
      console.error("Error activating clinic:", error);
    } finally {
      setActivating(false);
    }
  };

  const handleDeactivate = async () => {
    setActivating(true);
    try {
      const response = await fetch("http://localhost:8000/auth/clinic/set-active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinic_id: clinicId, is_active: false })
      });
      if (response.ok) {
        setIsClinicActive(false);
      }
    } catch (error) {
      console.error("Error deactivating clinic:", error);
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

  // Check if current time is past the viewing slot's start time
  const canServeInCurrentSlot = () => {
    if (viewingSlotId === null || timeSlots.length === 0) return false;
    
    const slotIndex = viewingSlotId - 1; // Convert to 0-based index
    if (slotIndex < 0 || slotIndex >= timeSlots.length) return false;
    
    const slot = timeSlots[slotIndex];
    const slotStartHour = slot.time_range[0];
    
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTimeDecimal = currentHour + currentMinute / 60.0;
    
    // Can serve if current time is >= slot start time
    return currentTimeDecimal >= slotStartHour;
  };

  const isServingAllowedForViewingSlot =
    viewingSlotId !== null && activeSlotId !== null && viewingSlotId === activeSlotId;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
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
                disabled={activating || isClinicActive || allSlotsExpired()}
                className="bg-green-500 hover:bg-green-600 text-white px-6 py-2.5 rounded-lg font-medium shadow-md hover:shadow-lg transition-all"
              >
                <Play className="h-4 w-4 mr-2" />
                Start
              </Button>
              <Button
                onClick={handleDeactivate}
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
                  {timeSlots.map((slot, index) => (
                    <div
                      key={index}
                      className={`border-2 rounded-xl p-4 transition-all ${
                        slot.is_open ? 'bg-gradient-to-r from-green-50 to-white border-green-200' : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold text-slate-800">{slot.slot_name.replace('Time ', 'Session ')}</h3>
                          <p className="text-sm text-slate-500 font-medium">
                            {formatTimeRange(slot.time_range)}
                          </p>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${slot.is_open ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>
                          {slot.is_open ? 'Open' : 'Closed'}
                        </span>
                      </div>
                    </div>
                  ))}
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
            </div>
            <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-5 text-center">
              <div className="bg-[#FFC107]/20 w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2">
                <ArrowRightCircle className="h-5 w-5 text-[#FFC107]" />
              </div>
              <p className="text-xs text-slate-500 font-medium mb-1">Completed</p>
              <p className="text-3xl font-bold text-[#FFC107]">{completedCount}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-5 text-center">
              <div className="bg-[#00555A]/10 w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2">
                <Clock className="h-5 w-5 text-[#00555A]" />
              </div>
              <p className="text-xs text-slate-500 font-medium mb-1">Now Serving</p>
              <p className="text-3xl font-bold text-[#00555A]">{currentServing ? 1 : 0}</p>
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
              {typeof viewingSlotId === "number" && (
                <span className="ml-2 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                  Slot {viewingSlotId}
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
                      <span className="text-xs text-slate-500 font-bold bg-slate-100 px-2 py-1 rounded-full">#{i + 1}</span>
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
