import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import { useOrg } from "./org";
import { Layout } from "./components/Layout";
import Login from "./pages/Login";
import AcceptInvite from "./pages/AcceptInvite";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import MyWork from "./pages/MyWork";
import Project from "./pages/Project";
import TicketDetail from "./pages/TicketDetail";
import Members from "./pages/Members";
import OrgSettings from "./pages/OrgSettings";
import CreateOrg from "./pages/CreateOrg";
import VerifyCreateOrg from "./pages/VerifyCreateOrg";
import Profile from "./pages/Profile";
import ResetPin from "./pages/ResetPin";
import MemberDetail from "./pages/MemberDetail";


export default function App() {
  const { me, loading } = useAuth();
  const { orgs, loading: orgsLoading } = useOrg();
  const location = useLocation();

  if (loading || (me && orgsLoading)) {
    return <div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>;
  }

  // Reachable regardless of session state: a reset-password or reset-pin
  // email link may be opened in a browser that still has an active session
  // (or, for reset-pin, no session at all — the user is mid-2FA-login).
  if (location.pathname === "/reset-password" || location.pathname === "/reset-pin") {
    return (
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/reset-pin" element={<ResetPin />} />
      </Routes>
    );
  }

  if (!me) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/accept-invite" element={<AcceptInvite />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Logged in but no organisations (kicked from the last one, or edge cases):
  // offer to create one or accept an invite.
  if (orgs.length === 0) {
    return (
      <Routes>
        <Route path="/create-org" element={<CreateOrg />} />
        <Route path="/create-org/verify" element={<VerifyCreateOrg />} />
        <Route path="/accept-invite" element={<AcceptInvite />} />
        <Route path="*" element={<Navigate to="/create-org" replace />} />
      </Routes>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/my-work" element={<MyWork />} />
        <Route path="/projects/:projectId" element={<Project />} />
        <Route path="/tickets/:id" element={<TicketDetail />} />
        <Route path="/members" element={<Members />} />
        <Route path="/members/:userId" element={<MemberDetail />} />
        <Route path="/org-settings" element={<OrgSettings />} />
        <Route path="/create-org" element={<CreateOrg />} />
        <Route path="/create-org/verify" element={<VerifyCreateOrg />} />
        <Route path="/accept-invite" element={<AcceptInvite />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}