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
    `w-full rounded-lg border bg-background/80 px-4 py-3 text-sm text-foreground outline-none transition focus:ring-2 ${
      hasError
        ? "border-destructive/60 focus:border-destructive focus:ring-destructive/15"
        : "border-border focus:border-primary focus:ring-primary/15"
    }`;

  return (
    <div className="min-h-screen bg-background sm:bg-[linear-gradient(180deg,hsl(var(--secondary))_0%,hsl(var(--background))_40%,hsl(var(--background))_100%)]">
      <header className="border-b border-primary/10 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <button
            onClick={() => navigate(-1)}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card/85 text-muted-foreground shadow-sm transition hover:border-primary/30 hover:text-primary"
            aria-label="Go back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="font-display text-xl font-bold text-foreground">Feedback</h1>
            <p className="hidden text-xs text-muted-foreground sm:block">Share what worked, what did not, and what should improve.</p>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-4 px-4 py-5 sm:gap-6 sm:py-8 lg:grid-cols-[0.86fr_1.14fr] lg:py-12">
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm sm:rounded-2xl sm:border-primary/15 sm:bg-primary sm:shadow-[0_24px_70px_-38px_rgba(18,80,70,0.75)] lg:sticky lg:top-24 lg:self-start">
          <div className="p-5 text-foreground sm:p-8 sm:text-primary-foreground">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary sm:h-11 sm:w-11 sm:bg-white/12 sm:text-primary-foreground">
            <MessageSquare className="h-5 w-5" />
          </div>
          <h2 className="mt-4 font-display text-2xl font-bold leading-tight sm:mt-5 sm:text-3xl">Help Krama grow.</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground sm:mt-3 sm:text-white">
            Tell us what felt good, confusing, or slow. Short feedback is enough.
          </p>
          <div className="mt-4 space-y-2 border-t border-border pt-4 text-sm text-muted-foreground sm:mt-6 sm:space-y-3 sm:border-white/10 sm:pt-5 sm:text-white">
            <div className="flex gap-3">
              <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary sm:text-white" />
              <span>Issues, suggestions, and rough ideas help.</span>
            </div>
            <div className="flex gap-3">
              <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary sm:text-white" />
              <span>Specific notes are easier to fix.</span>
            </div>
          </div>
          </div>
          <div className="hidden grid-cols-2 border-t border-white/10 bg-white/[0.07] text-primary-foreground sm:grid">
            <div className="border-r border-white/10 p-5">
              <p className="text-2xl font-bold">10 AM</p>
              <p className="mt-1 text-xs text-white">Support starts</p>
            </div>
            <div className="p-5">
              <p className="text-2xl font-bold">4 PM</p>
              <p className="mt-1 text-xs text-white">Daily help window</p>
            </div>
          </div>
        </section>

        <section>
        {submitStatus === "success" && (
          <div className="mb-4 flex items-start gap-3 rounded-lg border border-primary/25 bg-primary/5 p-4">
            <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
            <div>
              <p className="font-semibold text-foreground">Feedback submitted</p>
              <p className="text-sm text-muted-foreground">{statusMessage}</p>
            </div>
          </div>
        )}

        {submitStatus === "error" && (
          <div className="mb-4 flex items-start gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
            <div>
              <p className="font-semibold text-foreground">Submission failed</p>
              <p className="text-sm text-muted-foreground">{statusMessage}</p>
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-border bg-card/90 shadow-sm sm:rounded-2xl sm:shadow-[0_24px_70px_-45px_rgba(18,80,70,0.65)]">
          <div className="border-b border-border bg-secondary/35 px-4 py-4 sm:bg-[linear-gradient(135deg,hsl(var(--card))_0%,hsl(var(--secondary))_100%)] sm:px-6 sm:py-5">
            <h2 className="font-display text-xl font-bold text-foreground sm:text-2xl">Send feedback</h2>
            <p className="mt-1 text-sm text-muted-foreground">A few details help us understand the exact experience.</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4 p-4 sm:space-y-5 sm:p-6">
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
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-6 font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90"
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
