import { useState, useEffect } from "react";
import { Link, useParams, useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Star, Building2 } from "lucide-react";

interface VisitState {
  clinic_id: string;
  clinic_name: string;
  date: string;
  time: string;
}

const PatientWriteReview = () => {
  const { clinicId } = useParams<{ clinicId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [reviewText, setReviewText] = useState("");
  const [rating, setRating] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const visit = location.state?.visit as VisitState | undefined;

  useEffect(() => {
    if (!visit || !clinicId) {
      navigate("/patient/reviews");
    }
  }, [visit, clinicId, navigate]);

  const handleSubmitReview = async () => {
    if (!clinicId || !visit) return;

    setLoading(true);
    setError("");

    try {
      const userStr = localStorage.getItem("user");
      if (userStr) {
        const user = JSON.parse(userStr);

        const response = await fetch("/api/auth/reviews/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clinic_id: clinicId,
            patient_id: user.patient_id || user.id || "P-GUEST",
            patient_name: user.name || user.email?.split('@')[0] || "Patient",
            rating: rating,
            review_text: reviewText.trim()
          })
        });

        if (response.ok) {
          setSuccess(true);
          setTimeout(() => {
            navigate("/patient/reviews");
          }, 1500);
        } else {
          const data = await response.json();
          setError(data.detail || "Failed to submit review");
        }
      }
    } catch (err) {
      setError("Failed to submit review");
    } finally {
      setLoading(false);
    }
  };

  if (!visit) {
    return null;
  }

  if (success) {
    return (
      <div className="krama-ambient flex min-h-screen items-center justify-center px-4">
        <div className="motion-rise w-full max-w-md rounded-[32px] border border-white/70 bg-white/85 p-8 text-center shadow-[0_22px_70px_-44px_rgba(19,55,50,0.75)] backdrop-blur">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#f6f1e8]">
            <Star className="h-10 w-10 text-green-600 fill-current" />
          </div>
          <h2 className="font-display text-2xl font-black text-[#17312d]">Review Submitted!</h2>
          <p className="mt-2 text-muted-foreground">Thank you for your feedback.</p>
          <p className="mt-1 text-sm text-muted-foreground">Redirecting to reviews...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="krama-ambient min-h-screen">
      <header className="sticky top-0 z-50 border-b border-white/60 bg-white/75 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-3 px-4">
          <Link
            to="/patient/reviews"
            className="-ml-2 flex items-center gap-2 rounded-full px-3 py-2 text-primary transition hover:bg-white/80"
          >
            <ArrowLeft className="h-5 w-5" />
            <span className="text-sm font-bold">Back</span>
          </Link>
          <span className="font-display font-black text-[#17312d]">Write Review</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8">
        {/* Clinic Info */}
        <div className="motion-rise mb-5 rounded-[30px] border border-white/70 bg-white/80 p-5 shadow-[0_22px_70px_-46px_rgba(19,55,50,0.65)] backdrop-blur sm:p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f6f1e8] text-primary">
              <Building2 className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-primary/70">Clinic visit</p>
              <h1 className="mt-1 text-xl font-black text-[#17312d]">{visit.clinic_name}</h1>
              <p className="text-sm text-muted-foreground">{visit.date} at {visit.time}</p>
            </div>
          </div>
        </div>

        {/* Review Form */}
        <div className="motion-rise-delayed rounded-[30px] border border-white/70 bg-white/85 p-5 shadow-[0_22px_70px_-46px_rgba(19,55,50,0.65)] backdrop-blur sm:p-6">
          <h2 className="mb-6 font-display text-2xl font-black text-[#17312d]">Share your experience</h2>
          
          {error && (
            <div className="mb-4 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-600">
              {error}
            </div>
          )}

          <div className="space-y-6">
            {/* Rating */}
            <div className="space-y-3">
              <Label>Rating (1-5)</Label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(n)}
                    className="rounded-2xl p-2 transition-colors hover:bg-amber-100"
                  >
                    <Star
                      className={`h-10 w-10 ${
                        n <= rating
                          ? "fill-amber-400 text-amber-400"
                          : "text-gray-300"
                      }`}
                    />
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {rating === 5 && "Excellent"}
                {rating === 4 && "Very Good"}
                {rating === 3 && "Good"}
                {rating === 2 && "Fair"}
                {rating === 1 && "Poor"}
              </p>
            </div>

            {/* Review Text */}
            <div className="space-y-2">
              <Label htmlFor="review-text">Your review (optional)</Label>
              <textarea
                id="review-text"
                className="min-h-[140px] w-full resize-none rounded-2xl border border-primary/15 bg-[#fbfaf7] px-4 py-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="How was your experience? Share details about the service, staff, cleanliness, wait time, etc."
                value={reviewText}
                onChange={(e) => setReviewText(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {reviewText.length} characters
              </p>
            </div>

            {/* Submit Button */}
            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => navigate("/patient/reviews")}
                className="flex-1 rounded-2xl py-6 font-black"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmitReview}
                disabled={loading}
                className="flex-1 rounded-2xl bg-primary py-6 font-black hover:bg-primary/90"
              >
                {loading ? "Submitting..." : "Submit Review"}
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default PatientWriteReview;
