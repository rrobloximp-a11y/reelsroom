import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Layout } from "./components/Layout";
import Home from "./pages/Home";
import Watch from "./pages/Watch";
import ChannelPage from "./pages/Channel";
import Upload from "./pages/Upload";
import Studio from "./pages/Studio";
import Subscriptions from "./pages/Subscriptions";
import SignIn from "./pages/SignIn";
import Setup from "./pages/Setup";
import ResetPassword from "./pages/ResetPassword";
import Settings from "./pages/Settings";
import Admin from "./pages/Admin";
import Shorts from "./pages/Shorts";
import PostPage from "./pages/Post";
import Decorations from "./pages/Decorations";
import type { ReactNode } from "react";

function RequireChannel({ children }: { children: ReactNode }) {
  const { ready, user, channel } = useAuth();
  if (!ready) return <div className="page-loading"><span className="spinner" /></div>;
  if (!user) return <Navigate to={`/signin?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (!channel) return <Navigate to={`/setup?next=${encodeURIComponent(location.pathname)}`} replace />;
  return <>{children}</>;
}

export default function App() {
  const { recovery } = useAuth();
  if (recovery) return <ResetPassword />;
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home mode="latest" />} />
        <Route path="/trending" element={<Home mode="popular" />} />
        <Route path="/search" element={<Home mode="search" />} />
        <Route path="/watch/:id" element={<Watch />} />
        <Route path="/shorts" element={<Shorts />} />
        <Route path="/shorts/:id" element={<Shorts />} />
        <Route path="/c/:handle" element={<ChannelPage />} />
        <Route path="/post/:id" element={<PostPage />} />
        <Route path="/subscriptions" element={<RequireChannel><Subscriptions /></RequireChannel>} />
        <Route path="/upload" element={<RequireChannel><Upload /></RequireChannel>} />
        <Route path="/studio" element={<RequireChannel><Studio /></RequireChannel>} />
        <Route path="/settings" element={<RequireChannel><Settings /></RequireChannel>} />
        <Route path="/decorations" element={<RequireChannel><Decorations /></RequireChannel>} />
        <Route path="/coins" element={<RequireChannel><Settings /></RequireChannel>} />
        <Route path="/account" element={<Navigate to="/settings#security" replace />} />
        <Route path="/admin" element={<RequireChannel><Admin /></RequireChannel>} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}

function NotFound() {
  return (
    <div className="empty">
      <div className="empty-art">404</div>
      <h2>This reel is missing</h2>
      <p>The page you wanted isn't here.</p>
      <a className="btn btn-accent" href="/">Back home</a>
    </div>
  );
}
