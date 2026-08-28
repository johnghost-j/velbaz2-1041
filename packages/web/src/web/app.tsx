import { Route, Switch, useLocation } from "wouter";
import { Provider } from "./components/provider";
import { AgentFeedback } from "@runablehq/website-runtime";
import { useAuth } from "./lib/auth";
import { Sidebar } from "./components/Sidebar";
import { useSidebar } from "./lib/sidebar";
import { useIsMobile, useIsTouch } from "./lib/useIsMobile";
import { SplashScreen } from "./components/SplashScreen";

import { AdminPanel } from "./components/AdminPanel";
import { SocialSandboxOverlay } from "./components/SocialSandboxOverlay";
import { useEffect, useState, useRef } from "react";
import Index from "./pages/index";
import Login from "./pages/login";
import Register from "./pages/register";
import ForgotPassword from "./pages/forgot-password";
import ResetPassword from "./pages/reset-password";
import AcceptInvite from "./pages/accept-invite";
import Dashboard from "./pages/dashboard";
import CompanyDetail from "./pages/company";
import Editor from "./pages/editor";
import Chat from "./pages/chat";
import Settings from "./pages/settings";
import Profile from "./pages/profile";
import Plans from "./pages/plans";
import CommunityPage from "./pages/community";
import MoneyMaker from "./pages/money-maker";
import Legal from "./pages/legal";
import Track from "./pages/track";
import Guide from "./pages/guide";
import { NotFoundGlitch } from "./components/NotFoundGlitch";
const NO_SIDEBAR = ['/login', '/register', '/forgot-password', '/reset-password', '/accept-invite', '/track', '/guide'];
const NO_SIDEBAR_PATTERNS = [/\/company\/[^/]+\/editor/];

// Redirection interne sans rechargement dur de la page (pas de window.location).
function ClientRedirect({ to }: { to: string }) {
  const [, navigate] = useLocation();
  useEffect(() => { navigate(to, { replace: true }); }, [to, navigate]);
  return null;
}

function SandboxWrapper() {
  const [open, setOpen] = useState(false);
  const [sandbox, setSandbox] = useState<any>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent;
      setSandbox(ce.detail || null);
      setOpen(true);
    };
    window.addEventListener('open-sandbox', handler as EventListener);
    return () => window.removeEventListener('open-sandbox', handler as EventListener);
  }, []);
  return <SocialSandboxOverlay open={open} onClose={() => setOpen(false)} />;
}

function AppRoutes() {
  const { init, user } = useAuth();
  const [location] = useLocation();
  const { collapsed, mobileOpen, mobileDrag, setMobileOpen, setMobileDrag } = useSidebar();
  const isMobile = useIsMobile();
  const isTouch = useIsTouch();
  const [ready, setReady] = useState(false);

  useEffect(() => { init(); }, []);

  // Skip transition on first render to prevent teleportation
  useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setReady(true));
    });
  }, []);

  const showSidebar = !NO_SIDEBAR.includes(location) && !NO_SIDEBAR_PATTERNS.some(p => p.test(location));
  // Desktop : la sidebar pousse le contenu vers la droite.
  // Mobile : barre fine en haut → on décale le contenu vers le bas.
  const sidebarWidth = showSidebar && !isMobile ? (collapsed ? 48 : 260) : 0;
  const topOffset = showSidebar && isMobile ? 52 : 0;

  // ── Swipe pour ouvrir/fermer le drawer (mobile, page home) ──
  const drawerWidth = () => window.innerWidth;
  const touch = useRef<{ x: number; y: number; active: boolean; dir: 'h' | 'v' | null }>({ x: 0, y: 0, active: false, dir: null });
  const swipeEnabled = isMobile && isTouch && showSidebar && location === '/';

  const onTouchStart = (e: React.TouchEvent) => {
    if (!swipeEnabled) return;
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY, active: true, dir: null };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!swipeEnabled || !touch.current.active) return;
    const t = e.touches[0];
    const dx = t.clientX - touch.current.x;
    const dy = t.clientY - touch.current.y;
    if (touch.current.dir == null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      touch.current.dir = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    }
    if (touch.current.dir !== 'h') return;
    // Suivi accéléré : un petit swipe suffit (distance de référence courte).
    const w = Math.min(drawerWidth() * 0.5, 200);
    // Fermé : glisser vers la droite ouvre. Ouvert : glisser vers la gauche ferme.
    const base = mobileOpen ? 1 : 0;
    const p = Math.max(0, Math.min(1, base + dx / w));
    setMobileDrag(p);
  };
  const onTouchEnd = () => {
    if (!touch.current.active) return;
    const wasDragging = mobileDrag != null;
    touch.current.active = false;
    touch.current.dir = null;
    if (!wasDragging) return;
    const p = mobileDrag ?? 0;
    setMobileOpen(p > 0.25);
    setMobileDrag(null);
  };

  // Décalage du contenu : suit le swipe, sinon ouvert/fermé.
  const contentShift = (isMobile && showSidebar)
    ? (mobileDrag != null ? mobileDrag * drawerWidth() : (mobileOpen ? drawerWidth() : 0))
    : 0;

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      {showSidebar && <Sidebar />}
      <main
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className={`flex-1 flex flex-col overflow-hidden ${ready ? 'transition-all duration-200' : ''}`}
        style={{
          marginLeft: sidebarWidth,
          marginTop: topOffset,
          height: isMobile ? 'calc(100dvh - 52px)' : undefined,
          transform: contentShift ? `translateX(${contentShift}px)` : undefined,
          transition: mobileDrag != null
            ? 'none'
            : (swipeEnabled ? 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)' : (ready ? undefined : 'none')),
        }}
      >
        <div className="flex-1 min-h-0 overflow-auto">
          <Switch>
          <Route path="/" component={Index} />
          <Route path="/chat/:id?">{(params) => <Chat key="chat-singleton" />}</Route>
          <Route path="/login" component={Login} />
          <Route path="/register" component={Register} />
          <Route path="/forgot-password" component={ForgotPassword} />
          <Route path="/reset-password" component={ResetPassword} />
          <Route path="/accept-invite" component={AcceptInvite} />
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/launch">{() => <ClientRedirect to="/" />}</Route>
          <Route path="/profile" component={Profile} />
          <Route path="/settings" component={Settings} />
          <Route path="/plans" component={Plans} />
          <Route path="/community" component={CommunityPage} />
          <Route path="/money-maker" component={MoneyMaker} />
          <Route path="/track" component={Track} />
          <Route path="/guide" component={Guide} />
          <Route path="/legal/:doc" component={Legal} />
          <Route path="/legal">{() => <ClientRedirect to="/legal/terms" />}</Route>
          <Route path="/company/:id/editor" component={Editor} />
          <Route path="/company/:id" component={CompanyDetail} />
          <Route>
            {() => <NotFoundGlitch className="min-h-screen" />}
          </Route>
          </Switch>
        </div>
      </main>
      {user?.email === 'johnemadmansour1@gmail.com' && (
        <>
          <AdminPanel userEmail={user.email} />
          <SandboxWrapper />
        </>
      )}
    </div>
  );
}

function App() {
  return (
    <Provider>
      <SplashScreen />
      <AppRoutes />
      {import.meta.env.DEV && <AgentFeedback />}
    </Provider>
  );
}

export default App;
