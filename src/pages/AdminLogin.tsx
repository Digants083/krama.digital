import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shield, Lock, User, ArrowRight } from "lucide-react";
import { toast } from "sonner";

const AdminLogin = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState(import.meta.env.DEV ? "admin1" : "");
  const [password, setPassword] = useState(import.meta.env.DEV ? "Diganthadmin1" : "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Where to redirect after login (default to dashboard)
  const from = (location.state as any)?.from?.pathname || "/admin/dashboard";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Validate with backend - send as email field
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username, password }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        sessionStorage.setItem("admin_token", data.access_token);
        sessionStorage.setItem("admin_logged_in", "true");
        sessionStorage.setItem("admin_username", username);
        sessionStorage.setItem("admin_id", data.admin_id || "admin-001");
        sessionStorage.setItem("admin_session_time", Date.now().toString());
        
        toast.success("Login successful!");
        navigate(from, { replace: true });
      } else {
        setError(data.detail || "Invalid username or password");
      }
    } catch (err) {
      setError("Admin service unavailable. Please try again.");
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900">Admin Login</h1>
          <p className="text-slate-600 mt-2">Enter your credentials to access the admin dashboard</p>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-8">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="username"
                  type="text"
                  placeholder="Enter admin username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="pl-10"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter admin password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10"
                  required
                />
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Logging in..." : "Login to Admin Dashboard"}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            <p>Protected area. Authorized personnel only.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminLogin;
