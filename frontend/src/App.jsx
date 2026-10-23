import { Suspense, lazy, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Shell from "./components/Shell";
import { useAuth } from "./hooks/useAuth";
import { api } from "./lib/api";
// The landing page is the first paint for most visitors, so it ships in the
// entry chunk. Everything else is its own chunk: a visitor reading one blog
// post should not download the 2,000-line inbox to do it.
import Landing from "./pages/Landing";

const Inbox = lazy(() => import("./pages/Inbox"));
const Jobs = lazy(() => import("./pages/Jobs"));
const Pipeline = lazy(() => import("./pages/Pipeline"));
const Setup = lazy(() => import("./pages/Setup"));
const Tailor = lazy(() => import("./pages/Tailor"));
const ToolsIndex = lazy(() => import("./pages/tools/ToolsIndex"));
const ResumeScore = lazy(() => import("./pages/tools/ResumeScore"));
const SalaryEstimator = lazy(() => import("./pages/tools/SalaryEstimator"));
const CoverLetterGenerator = lazy(() => import("./pages/tools/CoverLetterGenerator"));
const AuthCallback = lazy(() => import("./pages/AuthCallback"));
const Embed = lazy(() => import("./pages/Embed"));
const BlogIndex = lazy(() => import("./pages/blog/BlogIndex"));
const BlogPost = lazy(() => import("./pages/blog/BlogPost"));
const NotFound = lazy(() => import("./pages/NotFound"));

function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <span className="eyebrow animate-pulse">Loading</span>
    </div>
  );
}

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/" replace />;
  // Its own boundary, inside the shell: moving between app pages loads the
  // next page's chunk without blanking the nav around it.
  return (
    <Shell>
      <Suspense fallback={<span className="eyebrow animate-pulse">Loading</span>}>{children}</Suspense>
    </Shell>
  );
}

/**
 * Where "/" goes depends on who you are. Unauthenticated visitors see the
 * landing page with its integrated sign-in form — no redirect needed. A new
 * user has nothing to look at on the pipeline — an empty funnel is not a first
 * impression — so they land on setup. Once setup is complete the pipeline is
 * the page worth opening.
 */
function Home() {
  const { user, loading } = useAuth();
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api
      .onboarding()
      .catch(() => ({ complete: false }))
      .then((data) => !cancelled && setStatus(data));
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (loading) return <Loading />;
  if (!user) return <Landing />;
  if (!status) return <Loading />;
  return <Navigate to={status.complete ? "/pipeline" : "/setup"} replace />;
}

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/auth/callback" element={<AuthCallback />} />

        {/* The four destinations in the nav. */}
        <Route
          path="/pipeline"
          element={
            <Protected>
              <Pipeline />
            </Protected>
          }
        />
        <Route
          path="/jobs"
          element={
            <Protected>
              <Jobs />
            </Protected>
          }
        />
        <Route
          path="/inbox"
          element={
            <Protected>
              <Inbox />
            </Protected>
          }
        />
        <Route
          path="/setup"
          element={
            <Protected>
              <Setup />
            </Protected>
          }
        />

        {/* Reachable, but not a top-level destination: tailoring is something you
            do *to a job*, so it is entered from the feed rather than the nav. */}
        <Route
          path="/tailor"
          element={
            <Protected>
              <Tailor />
            </Protected>
          }
        />

        <Route path="/" element={<Home />} />

        {/* Public viral pages */}
        <Route path="/tools" element={<ToolsIndex />} />
        <Route path="/tools/resume-score" element={<ResumeScore />} />
        <Route path="/tools/salary-estimator" element={<SalaryEstimator />} />
        <Route path="/tools/cover-letter-generator" element={<CoverLetterGenerator />} />
        <Route path="/embed" element={<Embed />} />
        <Route path="/blog" element={<BlogIndex />} />
        <Route path="/blog/:slug" element={<BlogPost />} />

        {/* Old destinations, folded into the four above. */}
        <Route path="/dashboard" element={<Navigate to="/pipeline" replace />} />
        <Route path="/tracker" element={<Navigate to="/pipeline" replace />} />
        {/* Autopilot was a preferences form; its switch lives on the pipeline
            header and its fields in setup. */}
        <Route path="/autopilot" element={<Navigate to="/pipeline" replace />} />
        {/* Review was a second list of the same drafts the inbox already held. */}
        <Route path="/review" element={<Navigate to="/inbox?tab=drafts" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
