import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MessageSquare, User, Mail, Phone, RefreshCw, Clock } from "lucide-react";

interface FeedbackItem {
  id: number;
  name: string;
  email: string;
  phone: string;
  message: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

const AdminFeedbackPage = () => {
  const [feedbackList, setFeedbackList] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchAllFeedback();
  }, []);

  const fetchAllFeedback = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/feedback/all");
      if (response.ok) {
        const data = await response.json();
        setFeedbackList(data.feedback || []);
      }
    } catch (error) {
      console.error("Error fetching feedback:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200 shadow-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => window.history.back()}
              className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-slate-800">All Feedback</h1>
              <p className="text-xs text-slate-500">View all user feedback submissions</p>
            </div>
          </div>
          <Button
            variant="outline"
            className="border-slate-300 text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-lg font-medium transition-all"
            onClick={fetchAllFeedback}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {/* Stats Card */}
        <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-[#00555A]/10 p-3 rounded-xl">
                <MessageSquare className="h-6 w-6 text-[#00555A]" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800">Total Feedback</h2>
                <p className="text-sm text-slate-500">All submissions received</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold text-[#00555A]">{feedbackList.length}</p>
              <p className="text-xs text-slate-500">submissions</p>
            </div>
          </div>
        </div>

        {/* Feedback List */}
        <div className="space-y-4">
          {loading ? (
            <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-8 text-center">
              <div className="animate-spin h-8 w-8 border-2 border-[#00555A] border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-slate-600">Loading feedback...</p>
            </div>
          ) : feedbackList.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-8 text-center">
              <MessageSquare className="h-12 w-12 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-600 font-medium mb-2">No feedback found</p>
              <p className="text-sm text-slate-500">No feedback submissions yet</p>
            </div>
          ) : (
            feedbackList.map((feedback) => (
              <div
                key={feedback.id}
                className="bg-white rounded-2xl shadow-lg border border-slate-100 overflow-hidden hover:shadow-md transition-shadow"
              >
                {/* Feedback Header */}
                <div className="bg-gradient-to-r from-slate-50 to-white px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="bg-slate-100 p-2 rounded-lg">
                      <MessageSquare className="h-5 w-5 text-slate-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-800">{feedback.name}</h3>
                      <p className="text-xs text-slate-500">Submitted {formatDate(feedback.created_at)}</p>
                    </div>
                  </div>
                </div>

                {/* Feedback Content */}
                <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div className="flex items-center gap-2 text-sm">
                      <Mail className="h-4 w-4 text-slate-400" />
                      <span className="text-slate-600">{feedback.email}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="h-4 w-4 text-slate-400" />
                      <span className="text-slate-600">{feedback.phone}</span>
                    </div>
                  </div>

                  <div className="bg-slate-50 rounded-xl p-4">
                    <p className="text-slate-700 leading-relaxed">{feedback.message}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
};

export default AdminFeedbackPage;