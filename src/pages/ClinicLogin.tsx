import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import AuthCard from "@/components/auth/AuthCard";
import { apiUrl } from "@/lib/api";

import { Building2, Lock, ArrowRight } from "lucide-react";

const CLINIC_FIRST_LOGIN_LOCATION_KEY = "clinic_first_login_location";

const ClinicLogin = () => {
  const navigate = useNavigate();

  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{text: string; type: "success" | "error"} | null>(null);
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!loginIdentifier.trim() || !password.trim()) {
      setError("Please fill all fields.");
      return;
    }

    setError("");
    setLoading(true);

    try {
      const response = await fetch(apiUrl("/api/auth/clinic/login"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: loginIdentifier,
          password: password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.detail || "Login failed");
        return;
      }

      // Store user info in localStorage
      localStorage.setItem("user", JSON.stringify({
        id: data.user_id,
        type: data.user_type,
        email: data.email || loginIdentifier
      }));

      // Also store clinic_id for profile access
      if (data.clinic_id) {
        localStorage.setItem("clinic_id", data.clinic_id);
      }
      if (data.access_token) {
        sessionStorage.setItem("clinic_access_token", data.access_token);
      }

      const adminPinnedLatitude = data.admin_pinned_latitude || (data.first_login ? data.latitude : null);
      const adminPinnedLongitude = data.admin_pinned_longitude || (data.first_login ? data.longitude : null);

      if (data.first_login) {
        localStorage.setItem(CLINIC_FIRST_LOGIN_LOCATION_KEY, JSON.stringify({
          clinic_id: data.clinic_id || "",
          address: data.address || "",
          latitude: data.latitude || null,
          longitude: data.longitude || null,
          admin_pinned_latitude: adminPinnedLatitude || null,
          admin_pinned_longitude: adminPinnedLongitude || null,
          has_pinned_location: Boolean(data.has_pinned_location),
          first_login: true,
        }));
      } else {
        localStorage.removeItem(CLINIC_FIRST_LOGIN_LOCATION_KEY);
      }

      // Redirect to clinic dashboard immediately
      navigate("/clinic");
    } catch (err) {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="flex flex-1 items-center justify-center bg-secondary/30 px-4 py-6">
        <AuthCard>
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Building2 className="h-7 w-7 text-primary" />
          </div>

          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold text-foreground">
              Clinic Staff Login
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Access your clinic's queue management dashboard.
            </p>
          </div>

          {error && (
            <div className="mb-4 rounded-lg bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {message && (
            <div className={`mb-4 rounded-lg px-4 py-2 text-sm ${message.type === "success" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
              {message.text}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="clinicId">Clinic ID / Email</Label>
              <Input
                id="clinicId"
                placeholder="FA23W3 or clinic@example.com"
                value={loginIdentifier}
                onChange={(e) => setLoginIdentifier(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  to="/clinic/forgot-password"
                  className="text-xs text-primary hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <PasswordInput
                  id="password"
                  placeholder="********"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Logging in..." : "Login"} <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            New clinic?{" "}
            <Link
              to="/clinic/register"
              className="font-medium text-primary hover:underline"
            >
              Register your clinic
            </Link>
          </p>
        </AuthCard>
      </div>

    </>
  );
};

export default ClinicLogin;
