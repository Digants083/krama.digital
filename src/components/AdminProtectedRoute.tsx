import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";

interface AdminProtectedRouteProps {
  children: React.ReactNode;
}

const AdminProtectedRoute = ({ children }: AdminProtectedRouteProps) => {
  const location = useLocation();
  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);

  const adminToken = sessionStorage.getItem("admin_token");
  const adminLoggedIn = sessionStorage.getItem("admin_logged_in");
  const adminId = sessionStorage.getItem("admin_id");

  useEffect(() => {
    const verifySession = async () => {
      if (!adminToken || !adminLoggedIn || !adminId) {
        setAuthorized(false);
        setChecking(false);
        return;
      }

      try {
        const response = await fetch("/api/admin/session", {
          headers: {
            Authorization: `Bearer ${adminToken}`,
          },
        });

        if (!response.ok) {
          throw new Error("Session expired");
        }

        setAuthorized(true);
      } catch {
        sessionStorage.removeItem("admin_token");
        sessionStorage.removeItem("admin_logged_in");
        sessionStorage.removeItem("admin_username");
        sessionStorage.removeItem("admin_id");
        sessionStorage.removeItem("admin_session_time");
        setAuthorized(false);
      } finally {
        setChecking(false);
      }
    };

    void verifySession();
  }, [adminToken, adminLoggedIn, adminId]);

  if (checking) {
    return <div className="min-h-screen bg-secondary/30" />;
  }

  if (!authorized) {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

export default AdminProtectedRoute;
