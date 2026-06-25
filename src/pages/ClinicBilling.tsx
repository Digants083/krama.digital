import { type ChangeEvent, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  Banknote,
  CreditCard,
  Eye,
  EyeOff,
  FileText,
  Pencil,
  Plus,
  Printer,
  ReceiptText,
  Save,
  Search,
  Smartphone,
  Trash2,
} from "lucide-react";

type BillingTemplate = {
  clinic_name: string;
  clinic_address?: string;
  doctor_name?: string;
  contact_phone?: string;
  contact_email?: string;
  template_title: string;
  footer_note?: string;
  signature_text?: string;
  signature_image?: string;
};

type ServiceItem = {
  id: string;
  name: string;
  price: number;
  active?: boolean;
};

type BillItem = {
  name: string;
  price: number;
  quantity: number;
};

type SavedBill = {
  id: number;
  bill_id: string;
  patient_name: string;
  patient_phone?: string;
  token?: string;
  items: BillItem[];
  total_amount: number;
  payment_mode: string;
  template?: BillingTemplate;
  created_at?: string;
};

type PendingPatient = {
  id?: number;
  clinic_id?: string;
  token?: string;
  patient_name?: string;
  patient_phone?: string;
};

type HistoryPeriod = "today" | "7d" | "month" | "year" | "custom" | "all";

const emptyTemplate: BillingTemplate = {
  clinic_name: "Clinic",
  clinic_address: "",
  doctor_name: "",
  contact_phone: "",
  contact_email: "",
  template_title: "Clinic Bill",
  footer_note: "Thank you for visiting.",
  signature_text: "",
  signature_image: "",
};

const paymentModes = [
  { mode: "Cash", Icon: Banknote },
  { mode: "UPI", Icon: Smartphone },
  { mode: "Card", Icon: CreditCard },
  { mode: "Pay Later", Icon: ReceiptText },
];

const currency = (value: number) => `₹${Number(value || 0).toLocaleString("en-IN")}`;

const billingTabs = [
  { id: "bill", label: "Bill" },
  { id: "template", label: "Template" },
  { id: "services", label: "Service price" },
  { id: "history", label: "Bill history" },
] as const;

const historyPeriods: { id: HistoryPeriod; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
  { id: "custom", label: "Custom" },
  { id: "all", label: "All" },
];

const readPendingPatient = (): PendingPatient | null => {
  try {
    const raw = localStorage.getItem("krama_pending_bill_patient");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const hasTemplateSnapshot = (bill: SavedBill | null) => {
  const snapshot = bill?.template;
  if (!snapshot) return false;
  return Object.values(snapshot).some((value) => (
    typeof value === "string" ? value.trim().length > 0 : Boolean(value)
  ));
};

const dateInputValue = (date: Date) => date.toISOString().slice(0, 10);

const ClinicBilling = () => {
  const [searchParams] = useSearchParams();
  const clinicId = searchParams.get("clinic_id") || localStorage.getItem("clinic_id") || "";
  const [activePanel, setActivePanel] = useState<"bill" | "template" | "services" | "history">("bill");
  const [template, setTemplate] = useState<BillingTemplate>(emptyTemplate);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [history, setHistory] = useState<SavedBill[]>([]);
  const [viewedBill, setViewedBill] = useState<SavedBill | null>(null);
  const [historySearch, setHistorySearch] = useState("");
  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>("month");
  const [showRevenue, setShowRevenue] = useState(false);
  const [customFromDate, setCustomFromDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return dateInputValue(date);
  });
  const [customToDate, setCustomToDate] = useState(() => dateInputValue(new Date()));
  const [patientName, setPatientName] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [token, setToken] = useState("");
  const [appointmentId, setAppointmentId] = useState<number | null>(null);
  const [items, setItems] = useState<BillItem[]>([]);
  const [paymentMode, setPaymentMode] = useState("Cash");
  const [serviceName, setServiceName] = useState("");
  const [servicePrice, setServicePrice] = useState("");
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [pendingPatient, setPendingPatient] = useState<PendingPatient | null>(() => readPendingPatient());
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [saving, setSaving] = useState(false);
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isSigningRef = useRef(false);

  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [items],
  );
  const receiptTemplate = useMemo(() => {
    const sourceTemplate = hasTemplateSnapshot(viewedBill) ? viewedBill?.template : template;
    return { ...emptyTemplate, ...(sourceTemplate || {}) };
  }, [template, viewedBill]);
  const receiptItems = viewedBill?.items || items;
  const receiptTotal = viewedBill?.total_amount ?? total;
  const receiptPatientName = viewedBill?.patient_name || patientName;
  const receiptPatientPhone = viewedBill?.patient_phone || patientPhone;
  const receiptToken = viewedBill?.token || token;
  const receiptPaymentMode = viewedBill?.payment_mode || paymentMode;
  const receiptDate = viewedBill?.created_at ? new Date(viewedBill.created_at) : new Date();
  const receiptDateLabel = Number.isNaN(receiptDate.getTime())
    ? new Date().toLocaleDateString("en-IN")
    : receiptDate.toLocaleDateString("en-IN");
  const showingReceipt = activePanel === "bill" || (activePanel === "history" && !!viewedBill);
  const historyStats = useMemo(() => {
    const now = new Date();
    const selectedPeriodLabel = historyPeriods.find((period) => period.id === historyPeriod)?.label || "Month";
    const customFrom = customFromDate ? new Date(`${customFromDate}T00:00:00`) : null;
    const customTo = customToDate ? new Date(`${customToDate}T23:59:59`) : null;
    const isInSelectedPeriod = (billDate: Date) => {
      if (historyPeriod === "all") return true;
      if (historyPeriod === "today") return billDate.toDateString() === now.toDateString();
      if (historyPeriod === "7d") {
        const sevenDaysAgo = new Date(now);
        sevenDaysAgo.setDate(now.getDate() - 6);
        sevenDaysAgo.setHours(0, 0, 0, 0);
        return billDate >= sevenDaysAgo && billDate <= now;
      }
      if (historyPeriod === "year") return billDate.getFullYear() === now.getFullYear();
      if (historyPeriod === "custom") {
        if (customFrom && billDate < customFrom) return false;
        if (customTo && billDate > customTo) return false;
        return Boolean(customFrom || customTo);
      }
      return billDate.getMonth() === now.getMonth() && billDate.getFullYear() === now.getFullYear();
    };

    return history.reduce(
      (stats, bill) => {
        const billDate = bill.created_at ? new Date(bill.created_at) : null;
        const isValidDate = billDate && !Number.isNaN(billDate.getTime());
        const isSelectedPeriod = isValidDate && isInSelectedPeriod(billDate);
        const isToday = isValidDate
          && billDate.toDateString() === now.toDateString();

        if (isSelectedPeriod) {
          stats.periodRevenue += bill.total_amount || 0;
          stats.periodBills += 1;
        }
        if (isToday) {
          stats.todayRevenue += bill.total_amount || 0;
          stats.todayBills += 1;
        }
        stats.periodLabel = selectedPeriodLabel;
        return stats;
      },
      { periodRevenue: 0, periodBills: 0, todayRevenue: 0, todayBills: 0, periodLabel: selectedPeriodLabel },
    );
  }, [customFromDate, customToDate, history, historyPeriod]);
  const filteredHistory = useMemo(() => {
    const query = historySearch.trim().toLowerCase();
    if (!query) return history;
    return history.filter((bill) => [
      bill.patient_name,
      bill.patient_phone,
      bill.bill_id,
      bill.token,
    ].some((value) => String(value || "").toLowerCase().includes(query)));
  }, [history, historySearch]);
  const revenueText = (value: number) => showRevenue ? currency(value) : "••••";

  const showMessage = (text: string, type: "success" | "error" = "success") => {
    setMessage({ text, type });
    window.setTimeout(() => setMessage(null), 3500);
  };

  const hydratePatient = useCallback(() => {
    const pending = readPendingPatient();
    setPendingPatient(pending);
    const urlName = searchParams.get("patient_name") || searchParams.get("name");
    const urlPhone = searchParams.get("patient_phone") || searchParams.get("phone");
    const urlToken = searchParams.get("token");
    const urlAppointment = searchParams.get("appointment_id");

    if (urlName || pending?.patient_name) {
      setPatientName(urlName || pending?.patient_name || "");
      setPatientPhone(urlPhone || pending?.patient_phone || "");
      setToken(urlToken || pending?.token || "");
      const nextAppointmentId = Number(urlAppointment || pending?.id || 0);
      setAppointmentId(Number.isFinite(nextAppointmentId) && nextAppointmentId > 0 ? nextAppointmentId : null);
    }
  }, [searchParams]);

  const loadBilling = useCallback(async () => {
    if (!clinicId) return;
    try {
      const [templateRes, servicesRes, billsRes] = await Promise.all([
        fetch(apiUrl(`/api/billing/template?clinic_id=${encodeURIComponent(clinicId)}`)),
        fetch(apiUrl(`/api/billing/services?clinic_id=${encodeURIComponent(clinicId)}`)),
        fetch(apiUrl(`/api/billing/bills?clinic_id=${encodeURIComponent(clinicId)}`)),
      ]);
      if (templateRes.ok) setTemplate({ ...emptyTemplate, ...(await templateRes.json()) });
      if (servicesRes.ok) setServices(await servicesRes.json());
      if (billsRes.ok) setHistory(await billsRes.json());
    } catch {
      showMessage("Could not load billing data.", "error");
    }
  }, [clinicId]);

  useEffect(() => {
    hydratePatient();
    void loadBilling();
  }, [hydratePatient, loadBilling]);

  useEffect(() => {
    if (activePanel !== "template") return;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!template.signature_image) return;

    const image = new Image();
    image.onload = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = template.signature_image;
  }, [activePanel, template.signature_image]);

  const addServiceToBill = (service: ServiceItem) => {
    setViewedBill(null);
    setItems((current) => {
      const existing = current.find((item) => item.name.toLowerCase() === service.name.toLowerCase());
      if (!existing) {
        return [...current, { name: service.name, price: service.price, quantity: 1 }];
      }
      return current.map((item) =>
        item.name.toLowerCase() === service.name.toLowerCase()
          ? { ...item, quantity: item.quantity + 1 }
          : item,
      );
    });
  };

  const fillPatient = (patient: PendingPatient) => {
    setViewedBill(null);
    setPatientName(patient.patient_name || "");
    setPatientPhone(patient.patient_phone || "");
    setToken(patient.token || "");
    setAppointmentId(patient.id && patient.id > 0 ? patient.id : null);
    setActivePanel("bill");
  };

  const canvasHasInk = (canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d");
    if (!context) return false;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 0) return true;
    }
    return false;
  };

  const saveTemplate = async () => {
    if (!clinicId) return showMessage("Clinic login not found.", "error");
    try {
      const canvas = signatureCanvasRef.current;
      const signatureImage = canvas && canvasHasInk(canvas)
        ? canvas.toDataURL("image/png")
        : template.signature_image || "";
      const templateToSave = { ...template, signature_image: signatureImage, signature_text: "" };
      const response = await fetch(apiUrl("/api/billing/template"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinic_id: clinicId, ...templateToSave }),
      });
      if (!response.ok) throw new Error("save failed");
      setTemplate(await response.json());
      showMessage("Template saved.");
    } catch {
      showMessage("Could not save template.", "error");
    }
  };

  const saveService = async () => {
    if (!clinicId) return showMessage("Clinic login not found.", "error");
    const price = Number(servicePrice);
    if (!serviceName.trim() || !Number.isFinite(price)) {
      showMessage("Enter service name and price.", "error");
      return;
    }
    try {
      const response = await fetch(
        apiUrl(editingServiceId ? `/api/billing/services/${editingServiceId}` : "/api/billing/services"),
        {
          method: editingServiceId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clinic_id: clinicId, name: serviceName, price, active: true }),
        },
      );
      if (!response.ok) throw new Error("save failed");
      setServiceName("");
      setServicePrice("");
      setEditingServiceId(null);
      await loadBilling();
      showMessage("Service saved.");
    } catch {
      showMessage("Could not save service.", "error");
    }
  };

  const removeService = async (serviceId: string) => {
    if (!clinicId) return;
    try {
      const response = await fetch(apiUrl(`/api/billing/services/${serviceId}?clinic_id=${encodeURIComponent(clinicId)}`), {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("delete failed");
      await loadBilling();
    } catch {
      showMessage("Could not delete service.", "error");
    }
  };

  const saveBill = async () => {
    if (!clinicId) return showMessage("Clinic login not found.", "error");
    if (!patientName.trim()) return showMessage("Patient name is required.", "error");
    if (!items.length) return showMessage("Select at least one service.", "error");

    setSaving(true);
    try {
      const response = await fetch(apiUrl("/api/billing/bills"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinic_id: clinicId,
          appointment_id: appointmentId,
          patient_name: patientName,
          patient_phone: patientPhone,
          token,
          bill_source: appointmentId ? "served" : "manual",
          items,
          payment_mode: paymentMode,
          payment_status: "paid",
        }),
      });
      if (!response.ok) throw new Error("save failed");
      localStorage.removeItem("krama_pending_bill_patient");
      setPendingPatient(null);
      setItems([]);
      setPatientName("");
      setPatientPhone("");
      setToken("");
      setAppointmentId(null);
      setViewedBill(null);
      await loadBilling();
      showMessage("Bill saved.");
    } catch {
      showMessage("Could not save bill.", "error");
    } finally {
      setSaving(false);
    }
  };

  const printBill = () => window.print();

  const viewSavedBill = (bill: SavedBill) => {
    setViewedBill(bill);
    setActivePanel("history");
  };

  const printSavedBill = (bill: SavedBill) => {
    setViewedBill(bill);
    setActivePanel("history");
    window.setTimeout(() => window.print(), 100);
  };

  const createBillForViewedPatient = () => {
    if (!viewedBill) return;
    setPatientName(viewedBill.patient_name || "");
    setPatientPhone(viewedBill.patient_phone || "");
    setToken(viewedBill.token || "");
    setAppointmentId(null);
    setItems([]);
    setPaymentMode("Cash");
    setViewedBill(null);
    setActivePanel("bill");
  };

  const handleSignatureUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      setTemplate((current) => ({ ...current, signature_image: result, signature_text: "" }));
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const getSignaturePoint = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const startSignature = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const context = canvas.getContext("2d");
    if (!context) return;

    const point = getSignaturePoint(event);
    isSigningRef.current = true;
    canvas.setPointerCapture(event.pointerId);
    context.lineWidth = 3;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#111827";
    context.beginPath();
    context.moveTo(point.x, point.y);
  };

  const drawSignature = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!isSigningRef.current) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;

    const point = getSignaturePoint(event);
    context.lineTo(point.x, point.y);
    context.stroke();
  };

  const finishSignature = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!isSigningRef.current) return;
    isSigningRef.current = false;
    const canvas = event.currentTarget;
    const context = canvas.getContext("2d");
    context?.closePath();
    setTemplate((current) => ({ ...current, signature_image: canvas.toDataURL("image/png"), signature_text: "" }));
  };

  const clearSignature = () => {
    const canvas = signatureCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
    setTemplate((current) => ({ ...current, signature_image: "", signature_text: "" }));
  };

  const signaturePreview = (compact = false, sourceTemplate: BillingTemplate = template) => {
    const width = compact ? 116 : 122;
    const imageHeight = compact ? 15 : 16;
    const slotHeight = compact ? 18 : 19;

    return (
    <div
      className="shrink-0 text-center font-bold"
      style={{ width, minWidth: width, maxWidth: width }}
    >
      <div
        className="flex items-end justify-center overflow-hidden"
        style={{ width, height: slotHeight, maxHeight: slotHeight }}
      >
        {sourceTemplate.signature_image ? (
          <img
            src={sourceTemplate.signature_image}
            alt="Doctor signature"
            className="object-contain"
            style={{ maxWidth: width - 8, maxHeight: imageHeight }}
          />
        ) : null}
      </div>
      <div className="border-t border-slate-500 pt-1 text-[10px] leading-tight">Authorized Signature</div>
    </div>
    );
  };

  const templateInput = (key: keyof BillingTemplate, label: string, placeholder = "") => (
    <div className="space-y-1.5">
      <Label htmlFor={String(key)}>{label}</Label>
      <Input
        id={String(key)}
        value={template[key] || ""}
        placeholder={placeholder}
        onChange={(event) => setTemplate((current) => ({ ...current, [key]: event.target.value }))}
      />
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f5f3ee] px-4 py-5 text-slate-950 print:bg-white print:p-0">
      <style>
        {`
          @media (min-width: 900px) {
            .billing-bill-grid {
              grid-template-columns: minmax(0, 1fr) minmax(380px, 0.86fr);
            }
            .billing-template-grid {
              grid-template-columns: minmax(380px, 0.82fr) minmax(0, 1fr);
            }
          }
          @media print {
            @page {
              size: A4 portrait;
              margin: 0;
            }
            html,
            body {
              width: 210mm;
              height: 297mm;
              margin: 0 !important;
              padding: 0 !important;
              overflow: hidden !important;
              background: #ffffff !important;
            }
            body * {
              visibility: hidden !important;
            }
            .billing-print-sheet,
            .billing-print-sheet * {
              visibility: visible !important;
            }
            .billing-print-sheet {
              position: fixed !important;
              inset: 0 !important;
              box-sizing: border-box !important;
              width: 210mm !important;
              max-width: 210mm !important;
              height: 297mm !important;
              min-height: 297mm !important;
              max-height: 297mm !important;
              margin: 0 !important;
              border: 1px solid #d8d2c8 !important;
              box-shadow: none !important;
              padding: 12mm !important;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
              overflow: hidden !important;
              color: #0f172a !important;
            }
            .billing-print-sheet table {
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }
            .billing-print-sheet footer {
              margin-top: 26mm !important;
            }
          }
        `}
      </style>
      {message && (
        <div className={`fixed right-4 top-4 z-50 rounded-full px-4 py-2 text-sm font-semibold shadow-lg print:hidden ${message.type === "success" ? "bg-[#00555A] text-white" : "bg-red-600 text-white"}`}>
          {message.text}
        </div>
      )}

      <header className="mx-auto mb-5 max-w-6xl print:hidden">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Link to="/clinic" className="inline-flex items-center gap-2 rounded-full border border-[#d9d2c6] bg-white px-4 py-2 text-sm font-bold text-[#00555A] shadow-sm">
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </Link>
          <div className="text-right">
            <h1 className="text-3xl font-black tracking-tight text-slate-950">Billing</h1>
            <p className="text-sm font-semibold text-slate-500">Create bills, edit template, set prices, and view saved bills.</p>
          </div>
        </div>
        <nav className="grid gap-2 rounded-[20px] border border-[#ded7ca] bg-white p-2 shadow-sm sm:grid-cols-4">
          {billingTabs.map((tab) => (
            <button
              key={tab.id}
              className={`rounded-2xl px-4 py-3 text-sm font-extrabold transition ${activePanel === tab.id ? "bg-[#00555A] text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"}`}
              onClick={() => {
                setViewedBill(null);
                setActivePanel(tab.id);
              }}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      <main className={`mx-auto gap-5 print:block ${
        showingReceipt
          ? "billing-bill-grid grid max-w-7xl items-start"
          : activePanel === "template"
            ? "billing-template-grid grid max-w-7xl items-start"
            : "max-w-3xl"
      }`}>
        {showingReceipt && (
          <section className="rounded-[22px] border border-[#ded7ca] bg-white p-5 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
            <div className="mb-5 flex items-center justify-between gap-3 print:hidden">
              <div>
                <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-[#00555A]">Template</p>
                <h2 className="text-xl font-black text-slate-950">Bill preview</h2>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="rounded-full" onClick={printBill}>
                  <Printer className="mr-2 h-4 w-4" />
                  Print
                </Button>
                <Button className="rounded-full bg-[#FFC107] text-slate-950 hover:bg-[#f2b600]" onClick={() => void saveBill()} disabled={saving || !!viewedBill}>
                  <Save className="mr-2 h-4 w-4" />
                  {viewedBill ? "Saved Receipt" : "Save Bill"}
                </Button>
              </div>
            </div>

            <article className="billing-print-sheet mx-auto min-h-[760px] max-w-[780px] border border-slate-400 bg-white p-7 text-[13px] shadow-[0_20px_70px_-55px_rgba(0,0,0,0.7)] print:min-h-0 print:max-w-none print:border-slate-500 print:p-5 print:shadow-none">
              <header className="grid grid-cols-[1fr_auto] gap-4 border-b-2 border-slate-700 pb-4">
                <div>
                  <h1 className="text-3xl font-extrabold tracking-tight text-[#00555A]">{receiptTemplate.clinic_name || "Clinic"}</h1>
                  <p className="mt-1 text-sm font-semibold text-slate-600">{receiptTemplate.doctor_name}</p>
                  <p className="mt-2 max-w-md text-xs leading-5 text-slate-600">{receiptTemplate.clinic_address}</p>
                </div>
                <div className="text-right text-xs font-semibold leading-5 text-slate-700">
                  {receiptTemplate.contact_phone && <p>Phone: {receiptTemplate.contact_phone}</p>}
                  {receiptTemplate.contact_email && <p>Email: {receiptTemplate.contact_email}</p>}
                  <p>Date: {receiptDateLabel}</p>
                </div>
              </header>

              <section className="mt-4 grid grid-cols-2 border border-slate-500 text-xs">
                <div className="border-r border-slate-500 p-2">
                  <p><span className="font-bold">Name:</span> {receiptPatientName || "Patient"}</p>
                  <p><span className="font-bold">Phone:</span> {receiptPatientPhone || "-"}</p>
                </div>
                <div className="p-2">
                  <p><span className="font-bold">Token:</span> {receiptToken || "-"}</p>
                  <p><span className="font-bold">Payment:</span> {receiptPaymentMode}</p>
                </div>
              </section>

              <h2 className="my-5 bg-slate-200 py-1 text-center text-base font-extrabold uppercase tracking-wide text-slate-900">
                {receiptTemplate.template_title || "Clinic Bill"}
              </h2>

              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="border border-slate-500 px-2 py-2">Service</th>
                    <th className="w-20 border border-slate-500 px-2 py-2 text-center">Qty</th>
                    <th className="w-28 border border-slate-500 px-2 py-2 text-right">Fee</th>
                    <th className="w-28 border border-slate-500 px-2 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {receiptItems.length ? receiptItems.map((item) => (
                    <tr key={item.name}>
                      <td className="border border-slate-500 px-2 py-2 font-semibold">{item.name}</td>
                      <td className="border border-slate-500 px-2 py-2 text-center">{item.quantity}</td>
                      <td className="border border-slate-500 px-2 py-2 text-right">{currency(item.price)}</td>
                      <td className="border border-slate-500 px-2 py-2 text-right">{currency(item.price * item.quantity)}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td className="border border-slate-500 px-2 py-12 text-center text-slate-400" colSpan={4}>
                        Select a service to build the bill.
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td className="border border-slate-500 px-2 py-2 text-right font-extrabold" colSpan={3}>Total</td>
                    <td className="border border-slate-500 px-2 py-2 text-right text-lg font-extrabold">{currency(receiptTotal)}</td>
                  </tr>
                </tbody>
              </table>

              <footer className="mt-10 flex items-end justify-between gap-8 text-xs">
                <p className="max-w-md font-semibold text-slate-600">{receiptTemplate.footer_note}</p>
                {signaturePreview(false, receiptTemplate)}
              </footer>
            </article>
          </section>
        )}

        <aside className={`rounded-[22px] border border-[#ded7ca] bg-white p-4 shadow-sm print:hidden ${showingReceipt ? "md:sticky md:top-5" : ""}`}>
          {activePanel === "history" && viewedBill && (
            <div className="space-y-3">
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-[#00555A]">Saved receipt</p>
                <h2 className="text-lg font-black text-slate-950">Viewing saved bill</h2>
              </div>
              <div className="rounded-2xl border border-[#cddce0] bg-[#f5fbfb] p-3">
                <p className="text-sm font-extrabold text-slate-950">{viewedBill.patient_name}</p>
                <p className="text-xs font-semibold text-slate-500">{viewedBill.bill_id}</p>
                <p className="mt-2 text-2xl font-black text-[#00555A]">{currency(viewedBill.total_amount)}</p>
              </div>
              <Button className="w-full rounded-full bg-[#00555A] hover:bg-[#00464a]" onClick={printBill}>
                <Printer className="mr-2 h-4 w-4" />
                Print Receipt
              </Button>
              <Button variant="outline" className="w-full rounded-full" onClick={() => setViewedBill(null)}>
                Back to History
              </Button>
              <Button variant="outline" className="w-full rounded-full" onClick={createBillForViewedPatient}>
                Create Bill for This Patient
              </Button>
            </div>
          )}

          {activePanel === "bill" && !viewedBill && (
            <div className="space-y-3">
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-[#00555A]">Bill details</p>
                <h2 className="text-lg font-black text-slate-950">Patient, services and payment</h2>
              </div>
              {pendingPatient?.patient_name && (
                <div className="rounded-2xl border border-[#b8d7da] bg-[#f3fbfb] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-[#00555A]">Ready to bill</p>
                      <p className="mt-1 text-lg font-black text-slate-950">{pendingPatient.patient_name}</p>
                      <p className="text-sm font-semibold text-slate-500">
                        {[pendingPatient.patient_phone, pendingPatient.token ? `Token ${pendingPatient.token}` : ""].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <Button className="rounded-full bg-[#FFC107] text-slate-950 hover:bg-[#f2b600]" onClick={() => fillPatient(pendingPatient)}>
                      Bill
                    </Button>
                  </div>
                </div>
              )}
              <div className="space-y-2 rounded-2xl border border-slate-200 p-3">
                <h3 className="text-sm font-extrabold text-slate-950">Who needs bill?</h3>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                  <Input className="h-9" placeholder="Patient name" value={patientName} onChange={(event) => setPatientName(event.target.value)} />
                  <Input className="h-9" placeholder="Phone" value={patientPhone} onChange={(event) => setPatientPhone(event.target.value)} />
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-3">
                <h3 className="mb-2 text-sm font-extrabold">Add service</h3>
                <div className="grid max-h-[180px] gap-1.5 overflow-y-auto pr-1">
                  {services.filter((service) => service.active !== false).map((service) => (
                    <button
                      key={service.id}
                      className="grid min-h-[38px] grid-cols-[1fr_auto_auto] items-center gap-2 rounded-xl border border-[#cddce0] px-3 py-1.5 text-left transition hover:border-[#00555A] hover:bg-[#f5fbfb]"
                      onClick={() => addServiceToBill(service)}
                    >
                      <span className="min-w-0 truncate text-sm font-extrabold text-slate-950">
                        {service.name}
                      </span>
                      <span className="text-sm font-black text-[#00555A]">{currency(service.price)}</span>
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-[#e8f6f4] text-[#00555A]">
                        <Plus className="h-3.5 w-3.5" />
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-3">
                <h3 className="mb-2 text-sm font-extrabold">Selected</h3>
                <div className="space-y-2">
                  {items.map((item) => (
                    <div key={item.name} className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5">
                      <div>
                        <p className="text-sm font-extrabold">{item.name}</p>
                        <p className="text-xs text-slate-500">{item.quantity} x {currency(item.price)}</p>
                      </div>
                      <button className="text-red-600" onClick={() => setItems((current) => current.filter((next) => next.name !== item.name))} aria-label={`Remove ${item.name}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-3">
                <h3 className="mb-2 text-sm font-extrabold">Payment</h3>
                <div className="grid grid-cols-2 gap-2">
                  {paymentModes.map(({ mode, Icon }) => (
                    <button
                      key={mode}
                      className={`flex min-h-[42px] items-center gap-2 rounded-xl border px-3 py-2 text-sm font-extrabold ${paymentMode === mode ? "border-[#00555A] bg-[#00555A] text-white" : "border-slate-200"}`}
                      onClick={() => setPaymentMode(mode)}
                    >
                      <Icon className="h-4 w-4" />
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl bg-slate-950 p-3 text-white">
                <p className="text-xs font-bold text-white/70">Total</p>
                <p className="text-3xl font-black">{currency(total)}</p>
              </div>
            </div>
          )}

          {activePanel === "template" && (
            <div className="space-y-4">
              <h2 className="text-xl font-extrabold">Template</h2>
              {templateInput("clinic_name", "Clinic name")}
              {templateInput("template_title", "Bill title")}
              {templateInput("doctor_name", "Doctor name")}
              {templateInput("clinic_address", "Address")}
              {templateInput("contact_phone", "Phone")}
              {templateInput("contact_email", "Email")}
              {templateInput("footer_note", "Footer note")}
              <div className="space-y-3 rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="doctor-signature-pad">Doctor signature</Label>
                  <Button type="button" variant="outline" className="h-8 rounded-full px-3 text-xs" onClick={clearSignature}>
                    Clear
                  </Button>
                </div>
                <canvas
                  ref={signatureCanvasRef}
                  id="doctor-signature-pad"
                  width={420}
                  height={96}
                  className="h-24 w-full touch-none rounded-xl border border-dashed border-slate-300 bg-white shadow-inner"
                  onPointerDown={startSignature}
                  onPointerMove={drawSignature}
                  onPointerUp={finishSignature}
                  onPointerCancel={finishSignature}
                  onPointerLeave={finishSignature}
                  aria-label="Doctor signature drawing pad"
                />
                <p className="text-xs font-semibold text-slate-500">
                  Sign inside the box. The drawing appears in Authorized Signature on the bill.
                </p>
                <div className="space-y-2 rounded-xl bg-slate-50 p-3">
                  <Label htmlFor="signature-image-upload">Or upload signature image</Label>
                  <Input id="signature-image-upload" type="file" accept="image/*" onChange={handleSignatureUpload} />
                  <p className="text-xs font-semibold text-slate-500">
                    Upload replaces the drawn signature. Both show at the same fixed size in the preview.
                  </p>
                </div>
              </div>
              <Button className="w-full rounded-full bg-[#00555A] hover:bg-[#00464a]" onClick={() => void saveTemplate()}>
                <Save className="mr-2 h-4 w-4" />
                Save Template
              </Button>
            </div>
          )}

          {activePanel === "services" && (
            <div className="space-y-4">
              <h2 className="text-xl font-extrabold">Service Prices</h2>
              <div className="grid gap-3">
                <Input placeholder="Service name" value={serviceName} onChange={(event) => setServiceName(event.target.value)} />
                <Input placeholder="Price" type="number" min="0" value={servicePrice} onChange={(event) => setServicePrice(event.target.value)} />
                <Button className="rounded-full bg-[#00555A] hover:bg-[#00464a]" onClick={() => void saveService()}>
                  <Save className="mr-2 h-4 w-4" />
                  {editingServiceId ? "Update Service" : "Add Service"}
                </Button>
              </div>
              <div className="space-y-2">
                {services.map((service) => (
                  <div key={service.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
                    <div>
                      <p className="font-extrabold">{service.name}</p>
                      <p className="text-sm font-black text-[#00555A]">{currency(service.price)}</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { setEditingServiceId(service.id); setServiceName(service.name); setServicePrice(String(service.price)); }} aria-label={`Edit ${service.name}`}>
                        <Pencil className="h-4 w-4 text-slate-500" />
                      </button>
                      <button onClick={() => void removeService(service.id)} aria-label={`Delete ${service.name}`}>
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activePanel === "history" && !viewedBill && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-extrabold">Saved Bills</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex flex-wrap gap-1 rounded-full border border-slate-200 bg-slate-50 p-1">
                    {historyPeriods.map((period) => (
                      <button
                        key={period.id}
                        type="button"
                        className={`rounded-full px-3 py-1 text-xs font-extrabold transition ${historyPeriod === period.id ? "bg-[#00555A] text-white" : "text-slate-600 hover:bg-white"}`}
                        onClick={() => setHistoryPeriod(period.id)}
                      >
                        {period.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 bg-white text-[#00555A] shadow-sm"
                    onClick={() => setShowRevenue((current) => !current)}
                    aria-label={showRevenue ? "Hide revenue" : "Show revenue"}
                    title={showRevenue ? "Hide revenue" : "Show revenue"}
                  >
                    {showRevenue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              {historyPeriod === "custom" && (
                <div className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="history-from-date" className="text-xs font-extrabold text-slate-600">From</Label>
                    <Input
                      id="history-from-date"
                      type="date"
                      className="mt-1 h-9 bg-white"
                      value={customFromDate}
                      onChange={(event) => setCustomFromDate(event.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="history-to-date" className="text-xs font-extrabold text-slate-600">To</Label>
                    <Input
                      id="history-to-date"
                      type="date"
                      className="mt-1 h-9 bg-white"
                      value={customToDate}
                      onChange={(event) => setCustomToDate(event.target.value)}
                    />
                  </div>
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-2xl bg-[#00555A] p-3 text-white">
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-white/70">{historyStats.periodLabel}</p>
                  <p className="mt-1 text-2xl font-black">{revenueText(historyStats.periodRevenue)}</p>
                  <p className="text-xs font-semibold text-white/70">{historyStats.periodBills} bills</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-500">Today revenue</p>
                  <p className="mt-1 text-xl font-black text-slate-950">{revenueText(historyStats.todayRevenue)}</p>
                  <p className="text-xs font-semibold text-slate-500">{historyStats.todayBills} bills</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-500">Bills today</p>
                  <p className="mt-1 text-xl font-black text-slate-950">{historyStats.todayBills}</p>
                  <p className="text-xs font-semibold text-slate-500">billing done today</p>
                </div>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  className="h-10 pl-9"
                  placeholder="Find patient by name, phone, bill ID or token"
                  value={historySearch}
                  onChange={(event) => setHistorySearch(event.target.value)}
                />
              </div>
              {filteredHistory.length ? filteredHistory.map((bill) => (
                <div key={bill.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-extrabold">{bill.patient_name}</p>
                      <p className="text-xs text-slate-500">{bill.bill_id}</p>
                    </div>
                    <p className="font-black text-[#00555A]">{revenueText(bill.total_amount)}</p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" variant="outline" className="h-9 rounded-full px-3 text-xs" onClick={() => viewSavedBill(bill)}>
                      <FileText className="mr-2 h-4 w-4" />
                      View receipt
                    </Button>
                    <Button type="button" className="h-9 rounded-full bg-[#00555A] px-3 text-xs hover:bg-[#00464a]" onClick={() => printSavedBill(bill)}>
                      <Printer className="mr-2 h-4 w-4" />
                      Print
                    </Button>
                  </div>
                </div>
              )) : (
                <div className="rounded-xl bg-slate-50 p-5 text-center text-sm font-semibold text-slate-500">
                  {history.length ? "No bills match that search." : "No saved bills yet."}
                </div>
              )}
            </div>
          )}
        </aside>

        {activePanel === "template" && (
          <section className="rounded-[22px] border border-[#ded7ca] bg-white p-5 shadow-sm print:hidden">
            <div className="mb-5">
              <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-[#00555A]">Live preview</p>
              <h2 className="text-xl font-black text-slate-950">Billing sheet</h2>
            </div>

            <article className="mx-auto max-w-[760px] border border-slate-400 bg-white p-6 text-[12px] shadow-[0_20px_70px_-55px_rgba(0,0,0,0.7)]">
              <header className="grid grid-cols-[1fr_auto] gap-4 border-b-2 border-slate-700 pb-4">
                <div>
                  <h1 className="text-2xl font-extrabold tracking-tight text-[#00555A]">{template.clinic_name || "Clinic"}</h1>
                  <p className="mt-1 text-sm font-semibold text-slate-600">{template.doctor_name}</p>
                  <p className="mt-2 max-w-md text-xs leading-5 text-slate-600">{template.clinic_address}</p>
                </div>
                <div className="text-right text-[11px] font-semibold leading-5 text-slate-700">
                  {template.contact_phone && <p>Phone: {template.contact_phone}</p>}
                  {template.contact_email && <p>Email: {template.contact_email}</p>}
                  <p>Date: {new Date().toLocaleDateString("en-IN")}</p>
                </div>
              </header>

              <section className="mt-4 grid grid-cols-2 border border-slate-500 text-[11px]">
                <div className="border-r border-slate-500 p-2">
                  <p><span className="font-bold">Name:</span> Patient</p>
                  <p><span className="font-bold">Phone:</span> -</p>
                </div>
                <div className="p-2">
                  <p><span className="font-bold">Token:</span> -</p>
                  <p><span className="font-bold">Payment:</span> Cash</p>
                </div>
              </section>

              <h2 className="my-5 bg-slate-200 py-1 text-center text-sm font-extrabold uppercase tracking-wide text-slate-900">
                {template.template_title || "Clinic Bill"}
              </h2>

              <table className="w-full border-collapse text-left text-[11px]">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="border border-slate-500 px-2 py-2">Service</th>
                    <th className="w-16 border border-slate-500 px-2 py-2 text-center">Qty</th>
                    <th className="w-24 border border-slate-500 px-2 py-2 text-right">Fee</th>
                    <th className="w-24 border border-slate-500 px-2 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-slate-500 px-2 py-8 text-center text-slate-400" colSpan={4}>
                      Services will appear here when billing.
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-slate-500 px-2 py-2 text-right font-extrabold" colSpan={3}>Total</td>
                    <td className="border border-slate-500 px-2 py-2 text-right font-extrabold">₹0</td>
                  </tr>
                </tbody>
              </table>

              <footer className="mt-10 flex items-end justify-between gap-8 text-[11px]">
                <p className="max-w-md font-semibold text-slate-600">{template.footer_note}</p>
                {signaturePreview(true)}
              </footer>
            </article>
          </section>
        )}
      </main>
    </div>
  );
};

export default ClinicBilling;
