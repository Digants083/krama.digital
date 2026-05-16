import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import AuthCard from "@/components/auth/AuthCard";

import { Activity, Mail, Lock, ArrowRight } from "lucide-react";

const PatientLogin = () => {
  const navigate = useNavigate();

  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!loginIdentifier.trim()) {
      setError("Please enter your email or patient ID.");
      return;
    }

    if (!password.trim()) {
      setError("Please enter your password.");
      return;
    }

    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/patient/login", {
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

      const userData = {
        id: data.user_id,
        type: data.user_type,
        email: data.patient_data?.email || data.email || loginIdentifier,
        name: data.patient_data?.name || loginIdentifier.split('@')[0],
        patient_id: data.patient_data?.patient_id || null
      };
      localStorage.setItem("user", JSON.stringify(userData));

      navigate("/patient");
    } catch (err) {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="flex min-h-[calc(100vh-200px)]">
        {/* LEFT BRANDING PANEL */}
        <div className="hidden flex-1 items-center justify-center bg-primary/5 lg:flex">
          <div className="max-w-sm text-center">
            <Activity className="mx-auto h-12 w-12 text-primary" />
            <h2 className="mt-4 text-3xl font-bold text-foreground">
              Krama
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Skip the wait. Book clinic appointments and track your queue in real time.
            </p>
          </div>
        </div>

        {/* RIGHT LOGIN FORM */}
        <div className="flex flex-1 items-center justify-center px-4 py-6">
          <AuthCard>
            <div className="mb-4 text-center lg:text-left">
              <h1 className="text-2xl font-bold text-foreground">
                Patient Login
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Welcome back! Sign in to manage your appointments.
              </p>
            </div>

            {error && (
              <div className="mb-4 rounded-lg bg-destructive/10 px-4 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email / Patient ID</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    placeholder="PA-AB12CD or you@example.com"
                    value={loginIdentifier}
                    onChange={(e) => setLoginIdentifier(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link
                    to="/patient/forgot-password"
                    className="text-xs text-primary hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>

                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <PasswordInput
                    id="password"
                    placeholder="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Logging in..." : "Login"}
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </form>

            <p className="mt-4 text-center text-sm text-muted-foreground">
              New user?{" "}
              <Link
                to="/patient/signup"
                className="font-medium text-primary hover:underline"
              >
                Create account
              </Link>
            </p>
          </AuthCard>
        </div>
      </div>
    </>
  );
};

export default PatientLogin;
