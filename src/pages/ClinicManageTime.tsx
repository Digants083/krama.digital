import { useState, useEffect } from "react";

import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";

import { ArrowLeft, Clock, Save, Plus, Trash2, Stethoscope, CheckCircle2 } from "lucide-react";
import { formatTimeRange } from "@/lib/timeFormat";



interface Slot {

  slot_name: string;

  time_range: number[];  // [start_hour, end_hour] e.g., [8, 11]

  is_open: boolean;
  slot_id?: number;
  doctor_id?: string;

}

interface DoctorOption {
  doctor_id: string;
  name: string;
  specialization?: string;
}



const MAX_SLOTS = 3;

// Hour options: 12, 1, 2, ..., 11
const hourOptions = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

// Minute options: only 00 and 30
const minuteOptions = [0, 30];

// AM/PM options
const ampmOptions = ['AM', 'PM'];



const ClinicManageTime = () => {

  const [slots, setSlots] = useState<Slot[]>([]);

  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);

  const [saved, setSaved] = useState(false);

  const [showAddForm, setShowAddForm] = useState(false);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState("");
  const [hasChosenDoctor, setHasChosenDoctor] = useState(false);
  const [loadingDoctors, setLoadingDoctors] = useState(true);

  

  // Form state for new slot - using hour : minute AM/PM format
  const [newSlot, setNewSlot] = useState({
    slot_name: "",
    start_hour: 8,
    start_minute: 0,
    start_ampm: "AM",
    end_hour: 11,
    end_minute: 0,
    end_ampm: "AM",
  });



  const clinicId = localStorage.getItem("clinic_id");

  const fetchDoctors = async () => {
    if (!clinicId) {
      setLoadingDoctors(false);
      return;
    }
    try {
      const response = await fetch(`/api/auth/clinic/doctors?clinic_id=${encodeURIComponent(clinicId)}`);
      if (!response.ok) return;
      const data = await response.json();
      const nextDoctors = data.doctors || [];
      setDoctors(nextDoctors);
    } catch (error) {
      console.error("Error fetching doctors:", error);
    } finally {
      setLoadingDoctors(false);
    }
  };

  const sortedSlots = slots
    .map((slot, originalIndex) => ({ slot, originalIndex }))
    .sort((a, b) => {
      const aStart = a.slot.time_range?.[0] ?? Number.POSITIVE_INFINITY;
      const bStart = b.slot.time_range?.[0] ?? Number.POSITIVE_INFINITY;
      return aStart - bStart;
    });



  const fetchTimeSlots = async () => {

    if (!clinicId || !selectedDoctorId) return;

    

    try {
      setLoading(true);

      const params = new URLSearchParams({ clinic_id: clinicId });
      if (selectedDoctorId) params.set("doctor_id", selectedDoctorId);
      const response = await fetch(`/api/auth/clinic/time-slots?${params.toString()}`);

      if (response.ok) {

        const data = await response.json();

        console.log("Fetched time slots:", data);

        // Use slot array from database to determine is_open status
        const slotArray = data.slot || [];
        const updatedSlots = (data.slots || []).map((s: any, idx: number) => ({
          ...s,
          is_open: slotArray[idx] === "open"
        }));

        setSlots(updatedSlots);

      }

    } catch (error) {

      console.error("Error fetching time slots:", error);

    } finally {

      setLoading(false);

    }

  };



  useEffect(() => {

    fetchDoctors();

  }, [clinicId]);

  useEffect(() => {
    if (hasChosenDoctor && selectedDoctorId) {
      fetchTimeSlots();
    }
  }, [hasChosenDoctor, selectedDoctorId]);



  // Convert stored time value to 24-hour format for backend
  const convertTo24Hour = (timeValue: number) => {
    return Math.floor(timeValue / 2);
  };

  const addTimeSlot = async () => {

    if (!clinicId || !selectedDoctorId) return;

    if (slots.length >= MAX_SLOTS) return;

    // Convert hour:minute:ampm to 24-hour for backend (supports overnight slots)
    const convertTo24 = (hour: number, minute: number, ampm: string) => {
      let h = hour === 12 ? 0 : hour;
      if (ampm === 'PM') h = hour === 12 ? 12 : hour + 12;
      // Handle overnight: if PM to AM transition (e.g., 11 PM to 2 AM), add 24
      return h + (minute / 60);
    };
    const startHour24 = convertTo24(newSlot.start_hour, newSlot.start_minute, newSlot.start_ampm);
    let endHour24 = convertTo24(newSlot.end_hour, newSlot.end_minute, newSlot.end_ampm);
    
    // If end time is less than start time, it means it crosses midnight (next day)
    if (endHour24 <= startHour24) {
      endHour24 += 24; // Add 24 hours for overnight slot
    }

    // Validate: end must be after start (now handles overnight)
    if (endHour24 <= startHour24) {
      alert("End time must be after start time");
      return;
    }

    setSaving(true);

    try {

      const response = await fetch("/api/auth/clinic/time-slots", {

        method: "POST",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({

          clinic_id: clinicId,
          doctor_id: selectedDoctorId,

          slot_name: newSlot.slot_name,

          time_range: [startHour24, endHour24]

        }),

      });

      

      if (response.ok) {

        setShowAddForm(false);

        setNewSlot({ slot_name: "", start_hour: 8, start_minute: 0, start_ampm: "AM", end_hour: 11, end_minute: 0, end_ampm: "AM" });

        fetchTimeSlots();

        setSaved(true);

        setTimeout(() => setSaved(false), 2000);

      }

    } catch (error) {

      console.error("Error adding time slot:", error);

    } finally {

      setSaving(false);

    }

  };



  const deleteTimeSlot = async (slotIndex: number) => {

    if (!clinicId || !selectedDoctorId) return;

    if (!confirm("Are you sure you want to delete this time slot?")) return;

    

    try {

      const response = await fetch(`/api/auth/clinic/time-slots/${slotIndex}?clinic_id=${clinicId}`, {

        method: "DELETE",

      });

      

      if (response.ok) {

        fetchTimeSlots();

      }

    } catch (error) {

      console.error("Error deleting time slot:", error);

    }

  };



  const toggleSlotStatus = async (slotIndex: number, isOpen: boolean) => {

    if (!clinicId || !selectedDoctorId) return;

    try {

      console.log(`Setting slot ${slotIndex} to ${isOpen ? 'open' : 'close'}`);

      const response = await fetch(`/api/auth/clinic/time-slots/${slotIndex}`, {

        method: "PUT",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({ 

          clinic_id: clinicId, 
          doctor_id: selectedDoctorId,

          is_open: isOpen,

          slot: isOpen ? "open" : "close"

        }),

      });

      

      if (response.ok) {

        const data = await response.json();

        console.log("Response:", data);

        fetchTimeSlots();

      } else {

        console.error("Failed to update slot status");

      }

    } catch (error) {

      console.error("Error updating slot status:", error);

    }

  };



  const selectedDoctor = doctors.find((doctor) => doctor.doctor_id === selectedDoctorId) || null;

  const chooseDoctor = (doctor: DoctorOption) => {
    setSelectedDoctorId(doctor.doctor_id);
    setHasChosenDoctor(true);
    setSlots([]);
    setShowAddForm(false);
    setLoading(true);
  };

  if (!hasChosenDoctor) {
    return (
      <div className="min-h-screen bg-transparent text-[#1f2522]">
        <header className="border-b border-white/60 bg-[#fbfaf7]/85 backdrop-blur-xl">
          <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-4 md:px-8">
            <Link to="/clinic" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f1efe8] text-[#4f5b56] transition hover:bg-[#e5e1d7]" aria-label="Back to clinic dashboard">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold text-[#202825]">Manage Time Slots</p>
              <p className="mt-1 truncate text-xs text-[#77756f]">{clinicId || "No clinic selected"}</p>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-4xl px-4 py-8 md:px-8">
          <div className="overflow-hidden rounded-2xl border border-white/70 bg-white/80 backdrop-blur shadow-sm">
            <div className="border-b border-[#e6ded3] bg-[#f6f1e8] p-5 md:p-7">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#dff4ea] text-[#1a5c4a]">
                  <Clock className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-[#202825]">Who is managing time?</p>
                  <p className="mt-2 text-sm text-[#77756f]">Choose a doctor profile to add, open, or close only that doctor's slots.</p>
                </div>
              </div>
            </div>

            <div className="p-5 md:p-7">
              {loadingDoctors ? (
                <div className="rounded-xl bg-[#f6f1e8] px-4 py-6 text-center text-sm text-[#77756f]">
                  Loading doctors...
                </div>
              ) : doctors.length === 0 ? (
                <div className="rounded-xl bg-[#f6f1e8] px-4 py-6 text-center text-sm text-[#77756f]">
                  No doctors found. Add a doctor from clinic profile first.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                  {doctors.map((doctor) => (
                    <button
                      key={doctor.doctor_id}
                      type="button"
                      onClick={() => chooseDoctor(doctor)}
                      className="group flex min-h-[132px] flex-col items-start justify-between rounded-xl border border-[#d8d1c6] bg-white p-3 text-left transition-all hover:border-[#1a5c4a] hover:bg-[#f4fbf8] hover:shadow-[0_18px_36px_-28px_rgba(26,92,74,0.75)] sm:min-h-[116px] sm:p-4"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e1f5ee] text-[#1a5c4a] sm:h-12 sm:w-12">
                        <Stethoscope className="h-5 w-5 sm:h-6 sm:w-6" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-[#202825] sm:text-base">{doctor.name}</p>
                        <p className="mt-1 truncate text-xs text-[#58645f] sm:text-sm">{doctor.specialization || "General Practice"}</p>
                        <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#1a5c4a]/10 px-2 py-1 text-[11px] font-bold text-[#1a5c4a] sm:mt-3 sm:gap-1.5 sm:px-2.5 sm:text-xs">
                          <Clock className="h-3.5 w-3.5" />
                          <span>Slots</span>
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (

    <div className="min-h-screen bg-transparent">

      <header className="sticky top-0 z-50 border-b border-white/60 bg-[#fbfaf7]/85 shadow-sm backdrop-blur-xl">

        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4">

          <div className="flex items-center gap-3">

            <Link to="/clinic" className="p-2 rounded-2xl bg-[#f6f1e8] hover:bg-[#e6ded3] text-slate-600 transition-colors">

              <ArrowLeft className="h-5 w-5" />

            </Link>

            <div>

              <h1 className="text-xl font-bold text-slate-800">Manage Time Slots</h1>

              <p className="text-xs text-slate-500">{selectedDoctor?.name || "Selected doctor"} time slots</p>

            </div>

          </div>

          <Button

            onClick={() => setShowAddForm(true)}

            disabled={slots.length >= MAX_SLOTS || !selectedDoctorId}

            className="bg-[#00555A] hover:bg-[#00494F] text-white px-5 py-2 rounded-2xl font-medium shadow-md hover:shadow-lg transition-all"

          >

            <Plus className="mr-2 h-4 w-4" />

            Add Slot

          </Button>

        </div>

      </header>



      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6 rounded-2xl border border-[#d9eadf] bg-[#f6f1e8] p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#e1f5ee] text-[#1a5c4a]">
                <Stethoscope className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-900">{selectedDoctor?.name || "Selected doctor"}</p>
                <p className="truncate text-xs text-slate-500">{selectedDoctor?.specialization || "General Practice"}</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#1a5c4a]/10 px-3 py-1.5 text-xs font-bold text-[#1a5c4a]">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Editing slots
            </span>
          </div>
        </div>

        {/* Add New Slot Form */}

        {showAddForm && (

          <div className="rounded-[26px] border border-white/70 bg-white/80 p-6 mb-6 shadow-[0_18px_54px_-42px_rgba(19,55,50,0.75)] backdrop-blur overflow-hidden">

            <div className="bg-gradient-to-r from-[#00555A] to-[#006e78] -mx-6 -mt-6 px-6 py-4 mb-6">

              <h2 className="text-lg font-semibold text-white flex items-center gap-2">

                <Clock className="h-5 w-5" />

                Add New Time Slot

              </h2>

            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">

              <div className="bg-[#f6f1e8] rounded-xl p-4 border border-[#e6ded3]">

                <label className="block text-sm font-medium text-slate-700 mb-2">Slot Name</label>

                <select

                  title="Select slot name"

                  value={newSlot.slot_name}

                  onChange={(e) => setNewSlot({ ...newSlot, slot_name: e.target.value })}

                  className="w-full border border-[#d8d1c6] rounded-2xl px-4 py-2.5 focus:outline-none focus:border-[#00555A] focus:ring-2 focus:ring-[#00555A]/20 bg-white/85 transition-all"

                >

                  <option value="">Select slot...</option>

                  {!slots.find(s => s.slot_name === "Time 1") && <option value="Time 1">Morning Session</option>}

                  {!slots.find(s => s.slot_name === "Time 2") && <option value="Time 2">Afternoon Session</option>}

                  {!slots.find(s => s.slot_name === "Time 3") && <option value="Time 3">Evening Session</option>}

                </select>

              </div>

              <div className="bg-[#f6f1e8] rounded-xl p-4 border border-[#e6ded3]">

                <label className="block text-sm font-medium text-slate-700 mb-2">Start Time</label>

                <div className="flex items-center gap-1">

                  <select

                    title="Start hour"

                    value={newSlot.start_hour}

                    onChange={(e) => setNewSlot({ ...newSlot, start_hour: parseInt(e.target.value) })}

                    className="flex-1 border border-[#d8d1c6] rounded-2xl px-3 py-2.5 focus:outline-none focus:border-[#00555A] focus:ring-2 focus:ring-[#00555A]/20 bg-white/85 text-lg font-semibold text-slate-800 cursor-pointer"

                  >

                    {hourOptions.map(h => (

                      <option key={h} value={h}>{h}</option>

                    ))}

                  </select>

                  <span className="text-2xl font-bold text-slate-400">:</span>

                  <select

                    title="Start minute"

                    value={newSlot.start_minute}

                    onChange={(e) => setNewSlot({ ...newSlot, start_minute: parseInt(e.target.value) })}

                    className="w-20 border border-[#d8d1c6] rounded-2xl px-2 py-2.5 focus:outline-none focus:border-[#00555A] focus:ring-2 focus:ring-[#00555A]/20 bg-white/85 text-lg font-semibold text-slate-800 cursor-pointer"

                  >

                    {minuteOptions.map(m => (

                      <option key={m} value={m}>{m.toString().padStart(2, '0')}</option>

                    ))}

                  </select>

                  <select

                    title="Start AM/PM"

                    value={newSlot.start_ampm}

                    onChange={(e) => setNewSlot({ ...newSlot, start_ampm: e.target.value })}

                    className="w-24 border border-[#d8d1c6] rounded-2xl px-2 py-2.5 focus:outline-none focus:border-[#00555A] focus:ring-2 focus:ring-[#00555A]/20 bg-white/85 text-lg font-semibold text-slate-800 cursor-pointer"

                  >

                    {ampmOptions.map(a => (

                      <option key={a} value={a}>{a}</option>

                    ))}

                  </select>

                </div>

              </div>

              <div className="bg-[#f6f1e8] rounded-xl p-4 border border-[#e6ded3]">

                <label className="block text-sm font-medium text-slate-700 mb-2">End Time</label>

                <div className="flex items-center gap-1">

                  <select

                    title="End hour"

                    value={newSlot.end_hour}

                    onChange={(e) => setNewSlot({ ...newSlot, end_hour: parseInt(e.target.value) })}

                    className="flex-1 border border-[#d8d1c6] rounded-2xl px-3 py-2.5 focus:outline-none focus:border-[#00555A] focus:ring-2 focus:ring-[#00555A]/20 bg-white/85 text-lg font-semibold text-slate-800 cursor-pointer"

                  >

                    {hourOptions.map(h => (

                      <option key={h} value={h}>{h}</option>

                    ))}

                  </select>

                  <span className="text-2xl font-bold text-slate-400">:</span>

                  <select

                    title="End minute"

                    value={newSlot.end_minute}

                    onChange={(e) => setNewSlot({ ...newSlot, end_minute: parseInt(e.target.value) })}

                    className="w-20 border border-[#d8d1c6] rounded-2xl px-2 py-2.5 focus:outline-none focus:border-[#00555A] focus:ring-2 focus:ring-[#00555A]/20 bg-white/85 text-lg font-semibold text-slate-800 cursor-pointer"

                  >

                    {minuteOptions.map(m => (

                      <option key={m} value={m}>{m.toString().padStart(2, '0')}</option>

                    ))}

                  </select>

                  <select

                    title="End AM/PM"

                    value={newSlot.end_ampm}

                    onChange={(e) => setNewSlot({ ...newSlot, end_ampm: e.target.value })}

                    className="w-24 border border-[#d8d1c6] rounded-2xl px-2 py-2.5 focus:outline-none focus:border-[#00555A] focus:ring-2 focus:ring-[#00555A]/20 bg-white/85 text-lg font-semibold text-slate-800 cursor-pointer"

                  >

                    {ampmOptions.map(a => (

                      <option key={a} value={a}>{a}</option>

                    ))}

                  </select>

                </div>

              </div>

            </div>

            <div className="flex gap-3 pt-2">

              <Button

                onClick={addTimeSlot}

                disabled={saving}

                className="bg-[#00555A] hover:bg-[#00494F] text-white px-6 py-2.5 rounded-2xl font-medium shadow-md hover:shadow-lg transition-all"

              >

                {saving ? (

                  <>

                    <Clock className="mr-2 h-4 w-4 animate-spin" />

                    Saving...

                  </>

                ) : (

                  <>

                    <Save className="mr-2 h-4 w-4" />

                    Save Slot

                  </>

                )}

              </Button>

              <Button

                variant="outline"

                onClick={() => setShowAddForm(false)}

                className="border-[#d8d1c6] text-slate-600 hover:bg-[#f6f1e8] px-6 py-2.5 rounded-2xl font-medium transition-all"

              >

                Cancel

              </Button>

            </div>

          </div>

        )}



        {/* Time Slots List */}

        <div className="rounded-[26px] border border-white/70 bg-white/80 shadow-[0_18px_54px_-42px_rgba(19,55,50,0.75)] backdrop-blur overflow-hidden">

          <div className="bg-[#f6f1e8] px-6 py-4 border-b border-[#e6ded3]">

            <div className="flex items-center justify-between">

              <div>

                <h2 className="text-lg font-semibold text-slate-800">Your Time Slots</h2>

                <p className="text-sm text-slate-500">{slots.length}/{MAX_SLOTS} slots configured</p>

              </div>

              <div className="bg-[#00555A]/10 text-[#00555A] px-3 py-1 rounded-full text-sm font-medium">

                {slots.filter(s => s.is_open).length} Active

              </div>

            </div>

          </div>

          <div className="p-6">

          {loading ? (

            <div className="text-center py-12">

              <div className="animate-spin h-8 w-8 border-4 border-[#00555A] border-t-transparent rounded-full mx-auto mb-3"></div>

              <p className="text-slate-500">Loading your time slots...</p>

            </div>

          ) : slots.length === 0 ? (

            <div className="text-center py-12">

              <div className="bg-[#f6f1e8] w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">

                <Clock className="h-8 w-8 text-slate-400" />

              </div>

              <p className="text-lg font-medium text-slate-700 mb-2">No time slots set up yet</p>

              <p className="text-sm text-slate-500 max-w-sm mx-auto">Click "Add Slot" to create your first time slot and start accepting appointments.</p>

            </div>

          ) : (

            <div className="space-y-4">

              {sortedSlots.map(({ slot, originalIndex }) => (

                <div

                  key={originalIndex}

                  className={`border-2 rounded-xl p-5 transition-all hover:shadow-md ${slot.is_open ? 'bg-gradient-to-r from-green-50 to-[#fbfaf7] border-green-200' : 'bg-gradient-to-r from-red-50 to-[#fbfaf7] border-red-200'}`}

                >

                  <div className="flex items-center justify-between">

                    <div className="flex items-center gap-4">

                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${slot.is_open ? 'bg-green-100' : 'bg-red-100'}`}>

                        <Clock className={`h-6 w-6 ${slot.is_open ? 'text-green-600' : 'text-red-500'}`} />

                      </div>

                      <div>

                        <h3 className="font-semibold text-slate-800 text-lg">{slot.slot_name.replace('Time ', 'Session ')}</h3>

                        <p className="text-sm text-slate-500 font-medium">

                          {formatTimeRange(slot.time_range)}

                        </p>

                      </div>

                    </div>

                    <div className="flex items-center gap-3">

                      {/* Toggle Button - shows Open when closed, Close when open */}

                      <button

                        title={slot.is_open ? 'Close slot' : 'Open slot'}

                        onClick={() => toggleSlotStatus((slot.slot_id || originalIndex + 1) - 1, !slot.is_open)}

                        className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow-md ${

                          slot.is_open 

                            ? 'bg-red-500 text-white hover:bg-red-600' 

                            : 'bg-green-500 text-white hover:bg-green-600'

                        }`}

                      >

                        {slot.is_open ? 'Close' : 'Open'}

                      </button>

                      <button

                        title="Delete slot"

                        onClick={() => deleteTimeSlot((slot.slot_id || originalIndex + 1) - 1)}

                        className="p-2.5 text-red-500 hover:bg-red-100 rounded-lg transition-colors"

                      >

                        <Trash2 className="h-5 w-5" />

                      </button>

                    </div>

                  </div>

                </div>

              ))}

            </div>

          )}

          </div>

        </div>



        {/* Instructions */}

        <div className="bg-gradient-to-r from-[#00555A]/5 to-[#00555A]/10 rounded-xl p-5 mt-6 border border-[#00555A]/20">

          <h3 className="font-semibold text-[#00555A] mb-2 flex items-center gap-2">

            <Clock className="h-4 w-4" />

            How it works:

          </h3>

          <ul className="text-sm text-slate-700 space-y-2 ml-6">

            <li>- Add time slots for different sessions (Morning, Afternoon, Evening)</li>

            <li>- Click Open/Close to control slot availability for bookings</li>

            <li>- Patients will see available slots when booking</li>

          </ul>

        </div>

      </main>

    </div>

  );

};



export default ClinicManageTime;

