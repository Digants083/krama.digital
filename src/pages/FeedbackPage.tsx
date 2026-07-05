import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Send, ArrowLeft, MessageSquare, User, Mail, Phone, CheckCircle, AlertCircle } from "lucide-react";

const FeedbackPage = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    message: ""
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "success" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    // Name validation
    if (!formData.name.trim()) {
      newErrors.name = "Name is required";
    } else if (formData.name.trim().length < 2) {
      newErrors.name = "Name must be at least 2 characters";
    }

    // Email validation
    if (!formData.email.trim()) {
      newErrors.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = "Please enter a valid email address";
    }

    // Phone validation
    if (!formData.phone.trim()) {
      newErrors.phone = "Phone number is required";
    } else if (!/^\d{10,}$/.test(formData.phone.replace(/\D/g, ""))) {
      newErrors.phone = "Please enter a valid phone number (at least 10 digits)";
    }

    // Message validation
    if (!formData.message.trim()) {
      newErrors.message = "Message is required";
    } else if (formData.message.trim().length < 10) {
      newErrors.message = "Message must be at least 10 characters";
    } else if (formData.message.trim().length > 1000) {
      newErrors.message = "Message must be less than 1000 characters";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    // Clear error for this field when user starts typing
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: "" }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus("idle");

    try {
      const response = await fetch("/api/feedback/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (response.ok) {
        setSubmitStatus("success");
        setStatusMessage("Thank you for your feedback! We appreciate your input.");
        // Reset form
        setFormData({ name: "", email: "", phone: "", message: "" });
        setErrors({});
      } else {
        setSubmitStatus("error");
        setStatusMessage(data.detail || "Failed to submit feedback. Please try again.");
      }
    } catch (error) {
      setSubmitStatus("error");
      setStatusMessage("Network error. Please check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const messageLength = formData.message.length;
  const messageMaxLength = 1000;
  const messageRemaining = messageMaxLength - messageLength;

  const inputClass = (hasError: boolean) =>
    `w-full rounded-2xl border bg-[#fbfaf7] px-4 py-3 text-sm font-semibold text-foreground outline-none transition placeholder:text-muted-foreground focus:ring-2 ${
      hasError
        ? "border-destructive/60 focus:border-destructive focus:ring-destructive/15"
        : "border-primary/15 focus:border-primary focus:ring-primary/15"
    }`;

  return (
    <div className="krama-ambient min-h-screen">
      <header className="border-b border-white/60 bg-white/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <button
            onClick={() => navigate(-1)}
            className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/70 bg-white/80 text-primary shadow-[0_16px_38px_-30px_rgba(19,55,50,0.7)] transition hover:-translate-y-0.5 hover:bg-white"
            aria-label="Go back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="font-display text-xl font-black text-[#17312d]">Feedback</h1>
            <p className="hidden text-xs text-muted-foreground sm:block">Share what worked, what did not, and what should improve.</p>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-5 px-4 py-6 sm:gap-6 sm:px-6 sm:py-8 lg:grid-cols-[0.95fr_1.05fr] lg:py-12">
        <section className="motion-rise overflow-hidden rounded-[34px] border border-white/70 bg-[#143b34] text-white shadow-[0_30px_90px_-48px_rgba(19,55,50,0.95)] lg:sticky lg:top-24 lg:self-start">
          <div className="relative min-h-[360px]">
            <img
              src="/krama-hero-cartoon-reception.png"
              alt="Cartoon clinic reception"
              className="absolute inset-0 h-full w-full object-cover object-center"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#10251f] via-[#10251f]/68 to-[#10251f]/8" />
            <div className="relative z-10 flex min-h-[360px] flex-col justify-end p-5 sm:p-8">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/12 text-white backdrop-blur">
                <MessageSquare className="h-5 w-5" />
              </div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-[#f6d8c4]">Krama feedback</p>
              <h2 className="mt-3 max-w-md font-display text-4xl font-black leading-tight">
                Help the clinic flow feel easier.
              </h2>
              <p className="mt-3 max-w-md text-sm leading-6 text-white/78">
                Share what felt confusing, slow, or missing in booking, token tracking, queue updates, or clinic tools.
              </p>
            </div>
          </div>
          <div className="grid gap-3 border-t border-white/10 bg-[#10251f] p-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
              <CheckCircle className="h-4 w-4 text-[#f6d8c4]" />
              <p className="mt-3 text-sm font-bold">Tell us the rough screen</p>
              <p className="mt-1 text-xs leading-5 text-white/62">A page name or short note is enough.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
              <CheckCircle className="h-4 w-4 text-[#f6d8c4]" />
              <p className="mt-3 text-sm font-bold">Suggest the fix</p>
              <p className="mt-1 text-xs leading-5 text-white/62">Even a rough idea helps shape Krama.</p>
            </div>
          </div>
        </section>

        <section>
        {submitStatus === "success" && (
          <div className="mb-4 flex items-start gap-3 rounded-2xl border border-primary/25 bg-white/85 p-4 shadow-[0_16px_44px_-36px_rgba(19,55,50,0.65)] backdrop-blur">
            <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
            <div>
              <p className="font-semibold text-foreground">Feedback submitted</p>
              <p className="text-sm text-muted-foreground">{statusMessage}</p>
            </div>
          </div>
        )}

        {submitStatus === "error" && (
          <div className="mb-4 flex items-start gap-3 rounded-2xl border border-destructive/25 bg-white/85 p-4 shadow-[0_16px_44px_-36px_rgba(19,55,50,0.65)] backdrop-blur">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
            <div>
              <p className="font-semibold text-foreground">Submission failed</p>
              <p className="text-sm text-muted-foreground">{statusMessage}</p>
            </div>
          </div>
        )}

        <div className="motion-rise-delayed overflow-hidden rounded-[32px] border border-white/70 bg-white/85 shadow-[0_24px_70px_-45px_rgba(18,80,70,0.65)] backdrop-blur">
          <div className="border-b border-[#eadfce] bg-[#fbfaf7] px-5 py-5 sm:px-6">
            <h2 className="font-display text-2xl font-black text-[#17312d]">Send feedback</h2>
            <p className="mt-1 text-sm text-muted-foreground">A few details help us understand the exact experience.</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4 p-5 sm:space-y-5 sm:p-6">
            <div>
              <label className="mb-2 block text-sm font-semibold text-foreground">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-primary" />
                  Your Name
                </div>
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="Enter your full name"
                className={inputClass(Boolean(errors.name))}
                disabled={isSubmitting}
              />
              {errors.name && (
                <p className="mt-2 flex items-center gap-1 text-sm text-destructive">
                  <AlertCircle className="h-3 w-3" />
                  {errors.name}
                </p>
              )}
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-foreground">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-primary" />
                  Email Address
                </div>
              </label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="your.email@example.com"
                className={inputClass(Boolean(errors.email))}
                disabled={isSubmitting}
              />
              {errors.email && (
                <p className="mt-2 flex items-center gap-1 text-sm text-destructive">
                  <AlertCircle className="h-3 w-3" />
                  {errors.email}
                </p>
              )}
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-foreground">
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-primary" />
                  Phone Number
                </div>
              </label>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="Enter your phone number"
                className={inputClass(Boolean(errors.phone))}
                disabled={isSubmitting}
              />
              {errors.phone && (
                <p className="mt-2 flex items-center gap-1 text-sm text-destructive">
                  <AlertCircle className="h-3 w-3" />
                  {errors.phone}
                </p>
              )}
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-foreground">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-primary" />
                  Your Feedback
                </div>
              </label>
              <textarea
                name="message"
                value={formData.message}
                onChange={handleChange}
                placeholder="Share your experience, suggestions, or any issues you encountered..."
                rows={6}
                className={`${inputClass(Boolean(errors.message))} resize-none`}
                disabled={isSubmitting}
              />
              <div className="mt-2 flex items-center justify-between">
                {errors.message && (
                  <p className="flex items-center gap-1 text-sm text-destructive">
                    <AlertCircle className="h-3 w-3" />
                    {errors.message}
                  </p>
                )}
                <p className={`ml-auto text-sm ${messageRemaining < 100 ? 'text-accent' : 'text-muted-foreground'}`}>
                  {messageLength} / {messageMaxLength} characters
                </p>
              </div>
            </div>

            <Button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-6 font-black text-primary-foreground shadow-[0_16px_34px_-22px_rgba(31,92,84,0.9)] transition hover:-translate-y-0.5 hover:bg-primary/90"
            >
              {isSubmitting ? (
                <>
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  Submitting...
                </>
              ) : (
                <>
                  <Send className="h-5 w-5" />
                  Submit Feedback
                </>
              )}
            </Button>
          </form>
        </div>
        </section>
      </main>
    </div>
  );
};

export default FeedbackPage;
