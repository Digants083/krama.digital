import { useState, useEffect } from "react";

import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";

import { ArrowLeft, Clock, Save, Plus, Trash2, Users } from "lucide-react";



interface Slot {

  slot_name: string;

  time_range: number[];  // [start_hour, end_hour] e.g., [8, 11]

  is_open: boolean;

}



const MAX_SLOTS = 3;

// Generate 12-hour time options
const generateTimeOptions = () => {
  const times = [];
  for (let h = 1; h <= 12; h++) {
    times.push({ value: h, label: `${h}:00` });
  }
  return times;
};

const timeOptions = generateTimeOptions();



const ClinicManageTime = () => {

  const [slots, setSlots] = useState<Slot[]>([]);

  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);

  const [saved, setSaved] = useState(false);

  const [showAddForm, setShowAddForm] = useState(false);

  

  // Form state for new slot - using 12-hour format
  const [newSlot, setNewSlot] = useState({
    slot_name: "",
    start_hour: 8,
    start_ampm: "AM",
    end_hour: 11,
    end_ampm: "AM"
  });



  const clinicId = localStorage.getItem("clinic_id");



  const fetchTimeSlots = async () => {

    if (!clinicId) return;

    

    try {

      const response = await fetch(`/api/auth/clinic/time-slots?clinic_id=${clinicId}`);

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

    fetchTimeSlots();

  }, [clinicId]);



  // Convert 12-hour to 24-hour format
  const convertTo24Hour = (hour: number, ampm: string) => {
    if (ampm === "AM") {
      return hour === 12 ? 0 : hour;
    } else {
      return hour === 12 ? 12 : hour + 12;
    }
  };

  // Convert 24-hour to 12-hour format for display
  const convertTo12Hour = (hour24: number) => {
    return {
      hour: hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24,
      ampm: hour24 >= 12 ? "PM" : "AM"
    };
  };

  const addTimeSlot = async () => {

    if (!clinicId) return;

    if (slots.length >= MAX_SLOTS) return;

    // Convert 12-hour to 24-hour for backend
    const startHour24 = convertTo24Hour(newSlot.start_hour, newSlot.start_ampm);
    const endHour24 = convertTo24Hour(newSlot.end_hour, newSlot.end_ampm);

    // Validate: end must be after start
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

          slot_name: newSlot.slot_name,

          time_range: [startHour24, endHour24]

        }),

      });

      

      if (response.ok) {

        setShowAddForm(false);

        setNewSlot({ slot_name: "", start_hour: 8, start_ampm: "AM", end_hour: 11, end_ampm: "AM" });

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

    try {

      console.log(`Setting slot ${slotIndex} to ${isOpen ? 'open' : 'close'}`);

      const response = await fetch(`/api/auth/clinic/time-slots/${slotIndex}`, {

        method: "PUT",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({ 

          clinic_id: clinicId, 

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



  const formatTime = (time: string) => {

    const [hours, minutes] = time.split(":");

    const hour = parseInt(hours);

    const ampm = hour >= 12 ? "PM" : "AM";

    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;

    return `${displayHour}:${minutes} ${ampm}`;

  };



  return (

    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">

      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200 shadow-sm">

        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4">

          <div className="flex items-center gap-3">

            <Link to="/clinic" className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors">

              <ArrowLeft className="h-5 w-5" />

            </Link>

            <div>

              <h1 className="text-xl font-bold text-slate-800">Manage Time Slots</h1>

              <p className="text-xs text-slate-500">Set your clinic's operating hours</p>

            </div>

          </div>

          <Button

            onClick={() => setShowAddForm(true)}

            disabled={slots.length >= MAX_SLOTS}

            className="bg-[#00555A] hover:bg-[#00494F] text-white px-5 py-2 rounded-lg font-medium shadow-md hover:shadow-lg transition-all"

          >

            <Plus className="mr-2 h-4 w-4" />

            Add Slot

          </Button>

        </div>

      </header>



      <main className="mx-auto max-w-4xl px-4 py-8">

        {/* Add New Slot Form */}

        {showAddForm && (

          <div className="bg-white rounded-2xl shadow-lg p-6 mb-6 border border-slate-100 overflow-hidden">

            <div className="bg-gradient-to-r from-[#00555A] to-[#006e78] -mx-6 -mt-6 px-6 py-4 mb-6">

              <h2 className="text-lg font-semibold text-white flex items-center gap-2">

                <Clock className="h-5 w-5" />

                Add New Time Slot

              </h2>

            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">

              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">

                <label className="block text-sm font-medium text-slate-700 mb-2">Slot Name</label>

                <select

                  title="Select slot name"

                  value={newSlot.slot_name}

                  onChange={(e) => setNewSlot({ ...newSlot, slot_name: e.target.value })}

                  className="w-full border border-slate-300 rounded-lg px-4 py-2.5 focus:outline-none focus:border-[#00555A] focus:ring-2 focus:ring-[#00555A]/20 bg-white transition-all"

                >

                  <option value="">Select slot...</option>

                  {!slots.find(s => s.slot_name === "Time 1") && <option value="Time 1">Morning Session</option>}

                  {!slots.find(s => s.slot_name === "Time 2") && <option value="Time 2">Afternoon Session</option>}

                  {!slots.find(s => s.slot_name === "Time 3") && <option value="Time 3">Evening Session</option>}

                </select>

              </div>

              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">

                <label className="block text-sm font-medium text-slate-700 mb-2">Start Time</label>

                <div className="flex gap-2">

                  <select

                    title="Start hour"

                    value={newSlot.start_hour}

                    onChange={(e) => setNewSlot({ ...newSlot, start_hour: parseInt(e.target.value) })}

                    className="flex-1 border border-slate-300 rounded-lg px-3 py-2.5 focus:outline-none focus:border-[#00555A] focus:ring-2 focus:ring-[#00555A]/20 bg-white transition-all"

                  >

                    {timeOptions.map(t => (

                      <option key={t.value} value={t.value}>{t.label}</option>

                    ))}

                  </select>

                  <select

                    title="Start AM/PM"

                    value={newSlot.start_ampm}

                    onChange={(e) => setNewSlot({ ...newSlot, start_ampm: e.target.value })}

                    className="w-20 border border-slate-300 rounded-lg px-2 py-2.5 focus:outline-none focus:border-[#00555A] focus:ring-2 focus:ring-[#00555A]/20 bg-white transition-all font-medium"

                  >

                    <option value="AM">AM</option>

                    <option value="PM">PM</option>

                  </select>

                </div>

              </div>

              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">

                <label className="block text-sm font-medium text-slate-700 mb-2">End Time</label>

                <div className="flex gap-2">

                  <select

                    title="End hour"

                    value={newSlot.end_hour}

                    onChange={(e) => setNewSlot({ ...newSlot, end_hour: parseInt(e.target.value) })}

                    className="flex-1 border border-slate-300 rounded-lg px-3 py-2.5 focus:outline-none focus:border-[#00555A] focus:ring-2 focus:ring-[#00555A]/20 bg-white transition-all"

                  >

                    {timeOptions.map(t => (

                      <option key={t.value} value={t.value}>{t.label}</option>

                    ))}

                  </select>

                  <select

                    title="End AM/PM"

                    value={newSlot.end_ampm}

                    onChange={(e) => setNewSlot({ ...newSlot, end_ampm: e.target.value })}

                    className="w-20 border border-slate-300 rounded-lg px-2 py-2.5 focus:outline-none focus:border-[#00555A] focus:ring-2 focus:ring-[#00555A]/20 bg-white transition-all font-medium"

                  >

                    <option value="AM">AM</option>

                    <option value="PM">PM</option>

                  </select>

                </div>

              </div>

            </div>

            <div className="flex gap-3 pt-2">

              <Button

                onClick={addTimeSlot}

                disabled={saving}

                className="bg-[#00555A] hover:bg-[#00494F] text-white px-6 py-2.5 rounded-lg font-medium shadow-md hover:shadow-lg transition-all"

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

                className="border-slate-300 text-slate-600 hover:bg-slate-100 px-6 py-2.5 rounded-lg font-medium transition-all"

              >

                Cancel

              </Button>

            </div>

          </div>

        )}



        {/* Time Slots List */}

        <div className="bg-white rounded-2xl shadow-lg border border-slate-100 overflow-hidden">

          <div className="bg-gradient-to-r from-slate-50 to-white px-6 py-4 border-b border-slate-100">

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

              <div className="bg-slate-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">

                <Clock className="h-8 w-8 text-slate-400" />

              </div>

              <p className="text-lg font-medium text-slate-700 mb-2">No time slots set up yet</p>

              <p className="text-sm text-slate-500 max-w-sm mx-auto">Click "Add Slot" to create your first time slot and start accepting appointments.</p>

            </div>

          ) : (

            <div className="space-y-4">

              {slots.map((slot, index) => (

                <div

                  key={index}

                  className={`border-2 rounded-xl p-5 transition-all hover:shadow-md ${slot.is_open ? 'bg-gradient-to-r from-green-50 to-white border-green-200' : 'bg-gradient-to-r from-red-50 to-white border-red-200'}`}

                >

                  <div className="flex items-center justify-between">

                    <div className="flex items-center gap-4">

                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${slot.is_open ? 'bg-green-100' : 'bg-red-100'}`}>

                        <Clock className={`h-6 w-6 ${slot.is_open ? 'text-green-600' : 'text-red-500'}`} />

                      </div>

                      <div>

                        <h3 className="font-semibold text-slate-800 text-lg">{slot.slot_name.replace('Time ', 'Session ')}</h3>

                        <p className="text-sm text-slate-500 font-medium">

                          {(() => {

                            const start = convertTo12Hour(slot.time_range[0]);

                            const end = convertTo12Hour(slot.time_range[1]);

                            return `${start.hour}:00 ${start.ampm} - ${end.hour}:00 ${end.ampm}`;

                          })()}

                        </p>

                      </div>

                    </div>

                    <div className="flex items-center gap-3">

                      {/* Toggle Button - shows Open when closed, Close when open */}

                      <button

                        title={slot.is_open ? 'Close slot' : 'Open slot'}

                        onClick={() => toggleSlotStatus(index, !slot.is_open)}

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

                        onClick={() => deleteTimeSlot(index)}

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

            <li>• Add time slots for different sessions (Morning, Afternoon, Evening)</li>

            <li>• Click Open/Close to control slot availability for bookings</li>

            <li>• Patients will see available slots when booking</li>

          </ul>

        </div>

      </main>

    </div>

  );

};



export default ClinicManageTime;

